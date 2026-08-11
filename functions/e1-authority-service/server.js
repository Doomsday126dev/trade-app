'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { createFirestoreE1AuthorityAdapter } = require('./firestoreE1AuthorityAdapter');
const { validateTarget } = require('./e1TargetContracts');
const { HandleValidationError, normalizeHandle } = require('./handleNormalization');
const { createVerifiedLegacyMappingReader, validatedTarget } = require('./rtdbVerifiedLegacyMappingReader');

const GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const MUTATION_GATES = Object.freeze(GATES.slice(1));
const RATE_LIMITS = Object.freeze({
  readAccountFoundation: Object.freeze({ limit: 60, windowMs: 15 * 60 * 1000 }),
  reserveTrainerHandle: Object.freeze({ limit: 5, windowMs: 15 * 60 * 1000 }),
  repairAccountFoundation: Object.freeze({ limit: 3, windowMs: 24 * 60 * 60 * 1000 }),
  applyMigrationManifest: Object.freeze({ limit: 10, windowMs: 60 * 1000 }),
  freezeIdentityConflict: Object.freeze({ limit: 10, windowMs: 60 * 1000 })
});
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const HANDLE_KEY = /^v1_[a-f0-9]{2,512}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REQUEST_BYTES = 4096;
const FROZEN_STATUSES = new Set(['frozen', 'blocked', 'conflict', 'conflict-frozen']);
const MIGRATION_DECISIONS = new Set(['eligible', 'exact-already-migrated']);
const CONFLICT_REASONS = new Set(['legacy-binding-conflict', 'handle-owner-conflict', 'migration-manifest-conflict']);
const FORBIDDEN_PROJECT_PERMISSIONS = Object.freeze([
  'resourcemanager.projects.setIamPolicy',
  'firebaserules.releases.create',
  'cloudfunctions.functions.create',
  'cloudfunctions.functions.update',
  'run.routes.invoke',
  'datastore.databases.create',
  'datastore.databases.delete',
  'datastore.databases.update',
  'datastore.entities.delete',
  'datastore.entities.list',
  'firebasedatabase.instances.get',
  'firebasedatabase.instances.list',
  'firebasedatabase.instances.update'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function approvalWindow(env, enabled) {
  const startAt = env.REPAIR_APPROVAL_WINDOW_START;
  const expiresAt = env.REPAIR_APPROVAL_WINDOW_END;
  if (!startAt && !expiresAt && !enabled) return null;
  const start = Date.parse(startAt);
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 7 * 24 * 60 * 60 * 1000) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  return Object.freeze({ startAt, expiresAt, start, end });
}

function approvedManifestIds(value, enabled) {
  const ids = typeof value === 'string' && value ? value.split(',') : [];
  if (ids.length > 100 || ids.some((id) => !REQUEST_ID.test(id)) || new Set(ids).size !== ids.length || (enabled && !ids.length)) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  return Object.freeze(ids);
}

function loadConfiguration(env = process.env) {
  const configuration = {
    environment: env.APP_ENVIRONMENT,
    projectId: env.FIREBASE_PROJECT_ID,
    projectNumber: env.EXPECTED_PROJECT_NUMBER,
    databaseId: env.FIRESTORE_DATABASE_ID,
    region: env.SERVICE_REGION,
    serviceName: env.AUTHORITY_SERVICE_NAME,
    runtimeServiceAccount: env.EXPECTED_RUNTIME_SERVICE_ACCOUNT,
    rtdbDatabaseUrl: env.RTDB_DATABASE_URL,
    firebaseWebApiKey: env.FIREBASE_WEB_API_KEY,
    operatorEmailHash: env.EXPECTED_OPERATOR_EMAIL_HASH,
    operatorSubjectHash: env.EXPECTED_OPERATOR_SUBJECT_HASH,
    revision: env.K_REVISION || 'local'
  };
  try { validateTarget(configuration); } catch { fail('E1_CONFIGURATION_MISMATCH'); }
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(configuration.firebaseWebApiKey || '')) fail('E1_CONFIGURATION_MISMATCH');
  if (!SHA256.test(configuration.operatorEmailHash || '') || !SHA256.test(configuration.operatorSubjectHash || '')) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  try { validatedTarget({ environment: configuration.environment, projectId: configuration.projectId, databaseUrl: configuration.rtdbDatabaseUrl }); }
  catch { fail('E1_CONFIGURATION_MISMATCH'); }
  if (GATES.some((gate) => !['true', 'false'].includes(env[gate])) ||
      MUTATION_GATES.filter((gate) => env[gate] === 'true').length > 1) {
    fail('E1_OPERATION_GATE_INVALID');
  }
  const repairAccountFoundationEnabled = env.REPAIR_FOUNDATION_ENABLED === 'true';
  const applyMigrationManifestEnabled = env.APPLY_MIGRATION_ENABLED === 'true';
  return Object.freeze({
    ...configuration,
    readAccountFoundationEnabled: env.READ_ACCOUNT_FOUNDATION_ENABLED === 'true',
    reserveTrainerHandleEnabled: env.RESERVE_HANDLE_ENABLED === 'true',
    repairAccountFoundationEnabled,
    applyMigrationManifestEnabled,
    freezeIdentityConflictEnabled: env.FREEZE_CONFLICT_ENABLED === 'true',
    repairApprovalWindow: approvalWindow(env, repairAccountFoundationEnabled),
    approvedMigrationManifestIds: approvedManifestIds(env.APPROVED_MIGRATION_MANIFEST_IDS, applyMigrationManifestEnabled)
  });
}

function structuredLog(configuration, operation, outcome, startedAt, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    environment: configuration.environment,
    serviceRevision: configuration.revision,
    operation,
    outcome,
    latencyMs: Math.max(0, Date.now() - startedAt),
    callerClass: 'cloud-run-iam',
    ...extra
  })}\n`);
}

async function metadata(fetchImpl, path) {
  const response = await fetchImpl(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${path}`, {
    headers: { 'Metadata-Flavor': 'Google' }
  });
  if (!response.ok) fail('E1_METADATA_UNAVAILABLE');
  return response;
}

async function projectMetadata(fetchImpl, path) {
  const response = await fetchImpl(`http://metadata.google.internal/computeMetadata/v1/project/${path}`, {
    headers: { 'Metadata-Flavor': 'Google' }
  });
  if (!response.ok) fail('E1_METADATA_UNAVAILABLE');
  return response;
}

async function runtimeProbe(configuration, fetchImpl = fetch) {
  const email = (await (await metadata(fetchImpl, 'email')).text()).trim();
  if (email !== configuration.runtimeServiceAccount) fail('E1_RUNTIME_IDENTITY_MISMATCH');
  const projectNumber = (await (await projectMetadata(fetchImpl, 'numeric-project-id')).text()).trim();
  if (projectNumber !== configuration.projectNumber) fail('E1_RUNTIME_PROJECT_MISMATCH');
  const tokenPayload = await (await metadata(fetchImpl, 'token')).json();
  if (typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token) fail('E1_RUNTIME_TOKEN_UNAVAILABLE');
  const headers = {
    Authorization: `Bearer ${tokenPayload.access_token}`,
    'Content-Type': 'application/json',
    'X-Goog-User-Project': configuration.projectId
  };
  const databaseResponse = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${configuration.projectId}/databases/${configuration.databaseId}`,
    { method: 'GET', headers }
  );
  if (!databaseResponse.ok) fail('E1_FIRESTORE_UNAVAILABLE');
  const sentinelResponse = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${configuration.projectId}/databases/${configuration.databaseId}/documents/runtimeReadiness/e1-authority-sentinel`,
    { method: 'GET', headers }
  );
  if (!sentinelResponse.ok && sentinelResponse.status !== 404) fail('E1_FIRESTORE_UNAVAILABLE');
  const permissionsResponse = await fetchImpl(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${configuration.projectId}:testIamPermissions`,
    { method: 'POST', headers, body: JSON.stringify({ permissions: FORBIDDEN_PROJECT_PERMISSIONS }) }
  );
  if (!permissionsResponse.ok) fail('E1_PERMISSION_PROBE_UNAVAILABLE');
  const permissionResult = await permissionsResponse.json();
  if (Array.isArray(permissionResult.permissions) && permissionResult.permissions.length) fail('E1_FORBIDDEN_PERMISSION_PRESENT');
  return Object.freeze({
    runtimeIdentityVerified: true,
    firestoreConnected: true,
    requiredPermissionsVerified: true,
    forbiddenPermissionsGranted: false
  });
}

function decodeFirebaseClaims(firebaseIdToken) {
  try {
    const parts = firebaseIdToken.split('.');
    if (parts.length !== 3) fail('AUTH_INVALID');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) fail('AUTH_INVALID');
    return claims;
  } catch (error) {
    if (error?.code === 'AUTH_INVALID') throw error;
    fail('AUTH_INVALID');
  }
}

async function verifyFirebaseIdToken(configuration, firebaseIdToken, fetchImpl = fetch, now = () => Date.now()) {
  if (typeof firebaseIdToken !== 'string' || !firebaseIdToken) fail('AUTH_REQUIRED');
  if (Buffer.byteLength(firebaseIdToken) > 8192) fail('AUTH_INVALID');
  let response;
  try {
    response = await fetchImpl(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(configuration.firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: firebaseIdToken })
      }
    );
  } catch {
    fail('INTERNAL_ERROR');
  }
  if (!response.ok) {
    if (response.status >= 500) fail('INTERNAL_ERROR');
    fail('AUTH_INVALID');
  }
  const payload = await response.json();
  const user = Array.isArray(payload.users) && payload.users.length === 1 ? payload.users[0] : null;
  const claims = decodeFirebaseClaims(firebaseIdToken);
  const uid = user?.localId;
  const nowSeconds = Math.floor(now() / 1000);
  const validSince = Number(user?.validSince || 0);
  if (!UID.test(uid || '') || user.disabled === true || claims.sub !== uid || claims.user_id !== uid ||
      claims.aud !== configuration.projectId || claims.iss !== `https://securetoken.google.com/${configuration.projectId}` ||
      !Number.isFinite(claims.exp) || claims.exp <= nowSeconds || !Number.isFinite(claims.auth_time) ||
      (Number.isFinite(validSince) && validSince > 0 && claims.auth_time < validSince)) fail('AUTH_INVALID');
  return Object.freeze({ uid });
}

async function verifyOperatorAccessToken(configuration, accessToken, fetchImpl = fetch) {
  if (typeof accessToken !== 'string' || !accessToken) fail('OPERATOR_AUTH_REQUIRED');
  if (Buffer.byteLength(accessToken) > 8192) fail('OPERATOR_AUTH_INVALID');
  let response;
  try {
    response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch {
    fail('INTERNAL_ERROR');
  }
  if (!response.ok) fail(response.status >= 500 ? 'INTERNAL_ERROR' : 'OPERATOR_AUTH_INVALID');
  const identity = await response.json();
  if (identity?.email_verified !== true || typeof identity.email !== 'string' || typeof identity.sub !== 'string' ||
      crypto.createHash('sha256').update(identity.email).digest('hex') !== configuration.operatorEmailHash ||
      crypto.createHash('sha256').update(identity.sub).digest('hex') !== configuration.operatorSubjectHash) {
    fail('OPERATOR_AUTH_INVALID');
  }
  return Object.freeze({ operatorHash: configuration.operatorSubjectHash.slice(0, 16) });
}

function exactFields(value, fields) {
  const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail('REQUEST_INVALID');
  return value;
}

function exactReviewedAt(value) {
  if (typeof value !== 'string' || value.length > 32) fail('REQUEST_INVALID');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('REQUEST_INVALID');
  return value;
}

function exactIdentifier(value) {
  if (!REQUEST_ID.test(value || '')) fail('REQUEST_INVALID');
  return value;
}

function hashParts(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function sourceMappingFingerprint(input) {
  return hashParts([
    1, input.uid, input.legacyUsername, input.normalizedTrainerName, input.handleKey, input.legacyAuthVersion
  ]);
}

function observedLegacyFingerprint(uid, legacy, foundation) {
  if (legacy?.status === 'ready' && foundation) return sourceMappingFingerprint({ uid, ...foundation });
  return hashParts([1, uid, legacy?.status || 'unknown', legacy?.reason || 'unknown']);
}

function repairReviewFingerprint(input) {
  return hashParts([
    1, 'repairAccountFoundation', input.manifestId, input.uid, input.sourceMappingFingerprint,
    input.reviewerDecision, input.reviewedAt
  ]);
}

function migrationManifestFingerprint(input) {
  return hashParts([
    1, input.manifestId, input.uid, input.legacyUsername, input.normalizedTrainerName, input.handleKey,
    input.legacyAuthVersion, input.sourceMappingFingerprint, input.reviewerDecision, input.reviewedAt
  ]);
}

function conflictManifestFingerprint(input) {
  return hashParts([
    1, 'freezeIdentityConflict', input.manifestId, input.uid, input.reasonCode,
    input.sourceMappingFingerprint, input.reviewerDecision, input.reviewedAt
  ]);
}

function exactRepairRequest(body) {
  exactFields(body, ['schemaVersion', 'operationId', 'reviewReference', 'expectedSourceFingerprint']);
  if (body.schemaVersion !== 1 || !SHA256.test(body.expectedSourceFingerprint || '')) fail('REQUEST_INVALID');
  exactFields(body.reviewReference, [
    'manifestId', 'manifestFingerprint', 'reviewerDecision', 'reviewedAt', 'sourceMappingFingerprint'
  ]);
  const reference = body.reviewReference;
  if (reference.reviewerDecision !== 'repair-approved' || !SHA256.test(reference.manifestFingerprint || '') ||
      !SHA256.test(reference.sourceMappingFingerprint || '') || reference.sourceMappingFingerprint !== body.expectedSourceFingerprint) {
    fail('REQUEST_INVALID');
  }
  return Object.freeze({
    operationId: exactIdentifier(body.operationId),
    manifestId: exactIdentifier(reference.manifestId),
    manifestFingerprint: reference.manifestFingerprint,
    reviewerDecision: reference.reviewerDecision,
    reviewedAt: exactReviewedAt(reference.reviewedAt),
    sourceMappingFingerprint: reference.sourceMappingFingerprint
  });
}

function exactMigrationRequest(body) {
  exactFields(body, [
    'schemaVersion', 'uid', 'legacyUsername', 'normalizedTrainerName', 'handleKey', 'legacyAuthVersion',
    'sourceMappingFingerprint', 'manifestId', 'manifestFingerprint', 'reviewerDecision', 'reviewedAt', 'operationId'
  ]);
  if (body.schemaVersion !== 1 || !UID.test(body.uid || '') || !Number.isSafeInteger(body.legacyAuthVersion) ||
      body.legacyAuthVersion < 1 || !SHA256.test(body.sourceMappingFingerprint || '') ||
      !SHA256.test(body.manifestFingerprint || '') || !MIGRATION_DECISIONS.has(body.reviewerDecision)) fail('REQUEST_INVALID');
  let handle;
  try { handle = normalizeHandle(body.legacyUsername); } catch { fail('REQUEST_INVALID'); }
  if (body.normalizedTrainerName !== handle.normalized || body.handleKey !== handle.handleKey) fail('REQUEST_INVALID');
  return Object.freeze({
    ...body,
    canonicalTrainerName: handle.display,
    requestId: exactIdentifier(body.operationId),
    manifestId: exactIdentifier(body.manifestId),
    reviewedAt: exactReviewedAt(body.reviewedAt)
  });
}

function exactFreezeRequest(body) {
  exactFields(body, [
    'schemaVersion', 'uid', 'operationId', 'reasonCode', 'sourceMappingFingerprint', 'manifestId',
    'manifestFingerprint', 'reviewerDecision', 'reviewedAt'
  ]);
  if (body.schemaVersion !== 1 || !UID.test(body.uid || '') || !CONFLICT_REASONS.has(body.reasonCode) ||
      body.reviewerDecision !== 'conflict-confirmed' || !SHA256.test(body.sourceMappingFingerprint || '') ||
      !SHA256.test(body.manifestFingerprint || '')) fail('REQUEST_INVALID');
  return Object.freeze({
    ...body,
    requestId: exactIdentifier(body.operationId),
    manifestId: exactIdentifier(body.manifestId),
    reviewedAt: exactReviewedAt(body.reviewedAt)
  });
}

function firestoreScalar(fields, name) {
  const value = fields?.[name];
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.hasOwn(value, 'timestampValue')) return value.timestampValue;
  return undefined;
}

function redactFoundationDocument(document) {
  const fields = document?.fields;
  const schemaVersion = firestoreScalar(fields, 'schemaVersion');
  const canonicalTrainerName = firestoreScalar(fields, 'canonicalTrainerName') ?? firestoreScalar(fields, 'trainerName');
  const normalizedTrainerName = firestoreScalar(fields, 'normalizedTrainerName');
  const handleKey = firestoreScalar(fields, 'handleKey');
  const legacyUsername = firestoreScalar(fields, 'legacyUsername');
  const status = firestoreScalar(fields, 'status');
  const revision = firestoreScalar(fields, 'revision');
  const createdAt = firestoreScalar(fields, 'createdAt');
  const updatedAt = firestoreScalar(fields, 'updatedAt');
  if (schemaVersion !== 1 || typeof canonicalTrainerName !== 'string' || !canonicalTrainerName ||
      typeof normalizedTrainerName !== 'string' || !normalizedTrainerName || !HANDLE_KEY.test(handleKey || '') ||
      typeof status !== 'string' || (!Number.isFinite(createdAt) && typeof createdAt !== 'string') ||
      (!Number.isFinite(updatedAt) && typeof updatedAt !== 'string') ||
      (legacyUsername !== undefined && typeof legacyUsername !== 'string') ||
      (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0))) fail('INTERNAL_ERROR');
  return Object.freeze({
    schemaVersion,
    canonicalTrainerName,
    normalizedTrainerName,
    handleKey,
    legacyUsername: legacyUsername ?? null,
    status,
    revision: revision ?? null,
    createdAt,
    updatedAt
  });
}

function exactReserveRequest(body) {
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : [];
  if (keys.length !== 3 || keys[0] !== 'requestId' || keys[1] !== 'requestedHandle' || keys[2] !== 'schemaVersion' ||
      body.schemaVersion !== 1 || !REQUEST_ID.test(body.requestId || '') || typeof body.requestedHandle !== 'string') {
    fail('REQUEST_INVALID');
  }
  let handle;
  try { handle = normalizeHandle(body.requestedHandle); } catch (error) {
    if (error instanceof HandleValidationError) fail('REQUEST_INVALID');
    throw error;
  }
  return Object.freeze({ requestId: body.requestId, handle });
}

function verifiedLegacyFoundation(uid, requestedHandle, legacy) {
  if (legacy?.status === 'mapping-incomplete') fail('MAPPING_INCOMPLETE');
  if (legacy?.status === 'mapping-conflict') fail('MAPPING_CONFLICT');
  if (legacy?.status === 'permission-denied') fail('MAPPING_PERMISSION_DENIED');
  if (legacy?.status === 'unavailable') fail('MAPPING_UNAVAILABLE');
  if (legacy?.status !== 'ready' || typeof legacy.username !== 'string' || !legacy.username ||
      !Number.isSafeInteger(legacy.legacyAuthVersion) || legacy.legacyAuthVersion < 1) fail('MAPPING_INCOMPLETE');
  const username = legacy.username;
  let canonical;
  try { canonical = normalizeHandle(username); } catch (error) {
    if (error instanceof HandleValidationError) fail('MAPPING_CONFLICT');
    throw error;
  }
  if (canonical.normalized !== requestedHandle.normalized || canonical.handleKey !== requestedHandle.handleKey) fail('MAPPING_CONFLICT');
  return Object.freeze({
    canonicalTrainerName: canonical.display,
    normalizedTrainerName: canonical.normalized,
    handleKey: canonical.handleKey,
    legacyUsername: username,
    legacyAuthVersion: legacy.legacyAuthVersion
  });
}

function reserveFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify([
    1,
    input.uid,
    input.legacyUsername,
    input.normalizedTrainerName,
    input.handleKey
  ]), 'utf8').digest('hex');
}

function createDefaultAuthorityStore(configuration) {
  const { Firestore } = require('@google-cloud/firestore');
  const firestore = new Firestore({ projectId: configuration.projectId, databaseId: configuration.databaseId });
  return createFirestoreE1AuthorityAdapter({ firestore });
}

function assertRuntimeDependencies(configuration, requireImpl = require) {
  if (typeof fetch !== 'function') fail('E1_RUNTIME_DEPENDENCY_MISSING');
  try {
    const firestore = requireImpl('@google-cloud/firestore');
    if (typeof firestore?.Firestore !== 'function') fail('E1_RUNTIME_DEPENDENCY_MISSING');
  } catch { fail('E1_RUNTIME_DEPENDENCY_MISSING'); }
  return true;
}

async function readAccountDocument(configuration, uid, fetchImpl = fetch) {
  const tokenPayload = await (await metadata(fetchImpl, 'token')).json();
  if (typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token) fail('E1_RUNTIME_TOKEN_UNAVAILABLE');
  const response = await fetchImpl(
    `https://firestore.googleapis.com/v1/projects/${configuration.projectId}/databases/${configuration.databaseId}/documents/accounts/${encodeURIComponent(uid)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        'X-Goog-User-Project': configuration.projectId
      }
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) fail('INTERNAL_ERROR');
  return response.json();
}

function exactReadRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || body.schemaVersion !== 1) {
    fail('REQUEST_INVALID');
  }
  return body;
}

async function readJsonRequest(request) {
  const declaredLength = Number(request.headers?.['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) fail('REQUEST_TOO_LARGE');
  let raw = '';
  for await (const chunk of request) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) fail('REQUEST_TOO_LARGE');
  }
  try { return JSON.parse(raw); } catch { fail('REQUEST_INVALID'); }
}

function firebaseTokenHeader(request) {
  const value = request.headers?.['x-firebase-id-token'];
  return Array.isArray(value) ? value[0] : value;
}

function subjectFirebaseTokenHeader(request) {
  const value = request.headers?.['x-e1-subject-firebase-id-token'];
  return Array.isArray(value) ? value[0] : value;
}

function operatorAccessTokenHeader(request) {
  const value = request.headers?.['x-e1-operator-access-token'];
  return Array.isArray(value) ? value[0] : value;
}

function uidHash(configuration, uid) {
  return crypto.createHmac('sha256', configuration.operatorSubjectHash)
    .update(`${configuration.projectId}\0uid\0${uid}`, 'utf8').digest('hex').slice(0, 16);
}

function handleCorrelationHash(configuration, handleKey) {
  return crypto.createHmac('sha256', configuration.operatorSubjectHash)
    .update(`${configuration.projectId}\0handle\0${handleKey}`, 'utf8').digest('hex').slice(0, 16);
}

function rateAttemptHash(operation, subjectHash, parts) {
  return hashParts([1, 'rate-limit', operation, subjectHash, ...parts]);
}

function assertApprovalWindow(window, now) {
  if (!window || now < window.start || now >= window.end) fail('APPROVAL_WINDOW_CLOSED');
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function createHandler(configuration, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const probe = dependencies.runtimeProbe || ((config) => runtimeProbe(config, fetchImpl));
  const verifyToken = dependencies.verifyFirebaseIdToken || ((config, token) => verifyFirebaseIdToken(config, token, fetchImpl));
  const verifyOperator = dependencies.verifyOperatorAccessToken || ((config, token) => verifyOperatorAccessToken(config, token, fetchImpl));
  const readAccount = dependencies.readAccountDocument || ((config, uid) => readAccountDocument(config, uid, fetchImpl));
  const legacyReader = dependencies.legacyReader || createVerifiedLegacyMappingReader({
    environment: configuration.environment,
    projectId: configuration.projectId,
    databaseUrl: configuration.rtdbDatabaseUrl,
    fetchImpl,
    onEvent: dependencies.legacyReadEvent
  });
  const readLegacyBinding = dependencies.readLegacyBinding || ((input) => legacyReader.readVerifiedLegacyMapping(input));
  let authorityStore = dependencies.authorityStore;
  const reserveHandle = dependencies.reserveTrainerHandle || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.reserveTrainerHandle(input);
  });
  const repairFoundation = dependencies.repairAccountFoundation || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.repairAccountFoundation(input);
  });
  const applyManifest = dependencies.applyMigrationManifest || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.applyMigrationManifest(input);
  });
  const freezeConflict = dependencies.freezeIdentityConflict || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.freezeIdentityConflict(input);
  });
  const parseBody = dependencies.readJsonRequest || readJsonRequest;
  const log = dependencies.structuredLog || structuredLog;
  const now = dependencies.now || (() => Date.now());
  const randomId = dependencies.randomId || (() => crypto.randomUUID());
  const applyRateLimit = dependencies.consumeRateLimit || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.consumeRateLimit(input);
  });
  const limitOperation = (operation, subjectHash, attemptHash) => applyRateLimit({
    operation,
    subjectHash,
    attemptHash,
    ...RATE_LIMITS[operation],
    at: now()
  });
  return async function handler(request, response) {
    const startedAt = Date.now();
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/v1/read-account-foundation') {
      let callerHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readAccountFoundationEnabled) fail('E1_NOT_ENABLED');
        exactReadRequest(await parseBody(request));
        const { uid } = await verifyToken(configuration, firebaseTokenHeader(request));
        callerHash = uidHash(configuration, uid);
        await limitOperation('readAccountFoundation', callerHash, rateAttemptHash('readAccountFoundation', callerHash, [randomId()]));
        const document = await readAccount(configuration, uid);
        if (!document) {
          log(configuration, 'readAccountFoundation', 'not_initialized', startedAt, { uidHash: callerHash });
          return json(response, 200, { code: 'FOUNDATION_NOT_INITIALIZED' });
        }
        const foundation = redactFoundationDocument(document);
        if (FROZEN_STATUSES.has(foundation.status)) {
          log(configuration, 'readAccountFoundation', 'frozen', startedAt, { uidHash: callerHash });
          return json(response, 423, { code: 'ACCOUNT_FROZEN', foundation });
        }
        if (foundation.status !== 'active') fail('INTERNAL_ERROR');
        log(configuration, 'readAccountFoundation', 'success', startedAt, { uidHash: callerHash });
        return json(response, 200, { code: 'SUCCESS', foundation });
      } catch (error) {
        const code = ['E1_NOT_ENABLED', 'AUTH_REQUIRED', 'AUTH_INVALID', 'REQUEST_INVALID', 'REQUEST_TOO_LARGE', 'METHOD_NOT_ALLOWED'].includes(error?.code)
          ? error.code : 'INTERNAL_ERROR';
        const status = code === 'E1_NOT_ENABLED' ? 503 : code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ? 401 :
          code === 'REQUEST_TOO_LARGE' ? 413 : code === 'METHOD_NOT_ALLOWED' ? 405 : code === 'REQUEST_INVALID' ? 400 :
            error?.code === 'e1/rate-limit-exceeded' ? 429 : 500;
        const responseCode = error?.code === 'e1/rate-limit-exceeded' ? 'RATE_LIMITED' : code;
        log(configuration, 'readAccountFoundation', responseCode.toLowerCase(), startedAt, callerHash ? { uidHash: callerHash } : {});
        return json(response, status, { code: responseCode === 'REQUEST_TOO_LARGE' ? 'REQUEST_INVALID' : responseCode });
      }
    }
    if (url.pathname === '/v1/read-legacy-mapping-readiness') {
      let callerHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readAccountFoundationEnabled) fail('E1_NOT_ENABLED');
        exactReadRequest(await parseBody(request));
        const firebaseIdToken = firebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        callerHash = uidHash(configuration, uid);
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        const responses = {
          ready: [200, { code: 'MAPPING_READY', legacyAuthVersion: legacy.legacyAuthVersion }],
          'mapping-incomplete': [200, { code: 'MAPPING_INCOMPLETE' }],
          'mapping-conflict': [409, { code: 'MAPPING_CONFLICT' }],
          'permission-denied': [403, { code: 'MAPPING_PERMISSION_DENIED' }],
          unavailable: [503, { code: 'MAPPING_UNAVAILABLE' }]
        };
        const [status, body] = responses[legacy?.status] || [500, { code: 'INTERNAL_ERROR' }];
        log(configuration, 'readLegacyMappingReadiness', body.code.toLowerCase(), startedAt, { uidHash: callerHash });
        return json(response, status, body);
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'readLegacyMappingReadiness', code.toLowerCase(), startedAt, callerHash ? { uidHash: callerHash } : {});
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/reserve-trainer-handle') {
      let callerHash;
      let handleHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.reserveTrainerHandleEnabled) fail('E1_NOT_ENABLED');
        const { requestId, handle } = exactReserveRequest(await parseBody(request));
        const firebaseIdToken = firebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        callerHash = uidHash(configuration, uid);
        handleHash = handleCorrelationHash(configuration, handle.handleKey);
        await limitOperation('reserveTrainerHandle', callerHash,
          rateAttemptHash('reserveTrainerHandle', callerHash, [requestId, handle.handleKey]));
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        const foundation = verifiedLegacyFoundation(uid, handle, legacy);
        const input = Object.freeze({ uid, requestId, ...foundation });
        const result = await reserveHandle(Object.freeze({ ...input, fingerprint: reserveFingerprint(input) }));
        if (!['reserved', 'idempotent'].includes(result.status)) fail('INTERNAL_ERROR');
        const code = result.replay === true || result.status === 'idempotent' ? 'IDEMPOTENT' : 'SUCCESS';
        log(configuration, 'reserveTrainerHandle', code.toLowerCase(), startedAt, {
          uidHash: callerHash,
          handleHash,
          replayClass: result.replay === true ? 'exact-replay' : result.status === 'idempotent' ? 'existing-foundation' : 'first-write'
        });
        return json(response, 200, { code, foundation: { canonicalTrainerName: foundation.canonicalTrainerName, normalizedTrainerName: foundation.normalizedTrainerName, handleKey: foundation.handleKey, status: 'active', revision: result.revision || 1 } });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          MAPPING_INCOMPLETE: [409, 'MAPPING_INCOMPLETE'], MAPPING_CONFLICT: [409, 'MAPPING_CONFLICT'],
          MAPPING_PERMISSION_DENIED: [403, 'MAPPING_PERMISSION_DENIED'], MAPPING_UNAVAILABLE: [503, 'MAPPING_UNAVAILABLE'],
          'e1/handle-conflict': [409, 'HANDLE_CONFLICT'], 'e1/foundation-conflict': [409, 'FOUNDATION_CONFLICT'],
          'e1/replay-mismatch': [409, 'REQUEST_INVALID'], 'e1/rate-limit-exceeded': [429, 'RATE_LIMITED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'reserveTrainerHandle', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}),
          ...(handleHash ? { handleHash } : {})
        });
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/repair-account-foundation') {
      let callerHash;
      let handleHash;
      let operatorHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.repairAccountFoundationEnabled) fail('E1_NOT_ENABLED');
        const reviewed = exactRepairRequest(await parseBody(request));
        ({ operatorHash } = await verifyOperator(configuration, operatorAccessTokenHeader(request)));
        assertApprovalWindow(configuration.repairApprovalWindow, now());
        const firebaseIdToken = subjectFirebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        callerHash = uidHash(configuration, uid);
        await limitOperation('repairAccountFoundation', callerHash,
          rateAttemptHash('repairAccountFoundation', callerHash, [reviewed.operationId, reviewed.manifestFingerprint]));
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        if (legacy?.status === 'mapping-incomplete') fail('MAPPING_INCOMPLETE');
        if (legacy?.status === 'mapping-conflict') fail('MAPPING_CONFLICT');
        if (legacy?.status === 'permission-denied') fail('MAPPING_PERMISSION_DENIED');
        if (legacy?.status === 'unavailable') fail('MAPPING_UNAVAILABLE');
        let requestedHandle;
        try { requestedHandle = normalizeHandle(legacy?.username); } catch { fail('MAPPING_CONFLICT'); }
        const foundation = verifiedLegacyFoundation(uid, requestedHandle, legacy);
        const sourceFingerprint = sourceMappingFingerprint({ uid, ...foundation });
        if (reviewed.sourceMappingFingerprint !== sourceFingerprint ||
            reviewed.manifestFingerprint !== repairReviewFingerprint({ uid, ...reviewed })) fail('REVIEW_REQUIRED');
        handleHash = handleCorrelationHash(configuration, foundation.handleKey);
        const input = Object.freeze({
          uid,
          requestId: reviewed.operationId,
          ...foundation,
          ...reviewed,
          sourceMappingFingerprint: sourceFingerprint,
          fingerprint: hashParts([1, 'repairAccountFoundation', uid, reviewed.operationId, reviewed.manifestFingerprint, sourceFingerprint])
        });
        const result = await repairFoundation(input);
        const code = result.replay === true ? 'IDEMPOTENT' : 'SUCCESS';
        log(configuration, 'repairAccountFoundation', code.toLowerCase(), startedAt, {
          uidHash: callerHash,
          operatorHash,
          handleHash,
          replayClass: result.replay === true ? 'exact-replay' : 'first-write',
          repairClass: result.repairClass
        });
        return json(response, 200, { code, repairClass: result.repairClass, revision: result.revision || 1 });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], OPERATOR_AUTH_REQUIRED: [401, 'OPERATOR_AUTH_REQUIRED'],
          OPERATOR_AUTH_INVALID: [403, 'OPERATOR_AUTH_INVALID'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          MAPPING_INCOMPLETE: [409, 'REVIEW_REQUIRED'], MAPPING_CONFLICT: [409, 'FOUNDATION_CONFLICT'],
          MAPPING_PERMISSION_DENIED: [403, 'REVIEW_REQUIRED'], MAPPING_UNAVAILABLE: [503, 'MAPPING_UNAVAILABLE'], REVIEW_REQUIRED: [409, 'REVIEW_REQUIRED'],
          'e1/handle-conflict': [409, 'FOUNDATION_CONFLICT'], 'e1/foundation-conflict': [409, 'FOUNDATION_CONFLICT'],
          APPROVAL_WINDOW_CLOSED: [403, 'APPROVAL_WINDOW_CLOSED'], 'e1/rate-limit-exceeded': [429, 'RATE_LIMITED'],
          'e1/repair-review-required': [409, 'REVIEW_REQUIRED'], 'e1/replay-mismatch': [409, 'REQUEST_INVALID']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'repairAccountFoundation', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}), ...(handleHash ? { handleHash } : {}),
          ...(operatorHash ? { operatorHash } : {})
        });
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/apply-migration-manifest') {
      let callerHash;
      let operatorHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.applyMigrationManifestEnabled) fail('E1_NOT_ENABLED');
        const manifest = exactMigrationRequest(await parseBody(request));
        ({ operatorHash } = await verifyOperator(configuration, operatorAccessTokenHeader(request)));
        if (!configuration.approvedMigrationManifestIds.includes(manifest.manifestId)) fail('REVIEW_REQUIRED');
        const firebaseIdToken = subjectFirebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        if (uid !== manifest.uid) fail('REQUEST_INVALID');
        callerHash = uidHash(configuration, uid);
        await limitOperation('applyMigrationManifest', operatorHash,
          rateAttemptHash('applyMigrationManifest', operatorHash, [manifest.operationId, manifest.manifestFingerprint]));
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        const requestedHandle = Object.freeze({
          display: manifest.canonicalTrainerName,
          normalized: manifest.normalizedTrainerName,
          handleKey: manifest.handleKey
        });
        const foundation = verifiedLegacyFoundation(uid, requestedHandle, legacy);
        const sourceFingerprint = sourceMappingFingerprint({ uid, ...foundation });
        if (manifest.sourceMappingFingerprint !== sourceFingerprint ||
            manifest.manifestFingerprint !== migrationManifestFingerprint(manifest)) fail('REVIEW_REQUIRED');
        const input = Object.freeze({
          uid,
          requestId: manifest.operationId,
          ...foundation,
          ...manifest,
          sourceMappingFingerprint: sourceFingerprint,
          fingerprint: hashParts([1, 'applyMigrationManifest', uid, manifest.operationId, manifest.manifestFingerprint])
        });
        const result = await applyManifest(input);
        const code = result.replay === true ? 'IDEMPOTENT' : result.status === 'already-migrated' ? 'ALREADY_MIGRATED' : 'SUCCESS';
        log(configuration, 'applyMigrationManifest', code.toLowerCase(), startedAt, {
          uidHash: callerHash, operatorHash, replayClass: result.replay === true ? 'exact-replay' : result.status
        });
        return json(response, 200, { code, revision: result.revision || 1 });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], OPERATOR_AUTH_REQUIRED: [401, 'OPERATOR_AUTH_REQUIRED'],
          OPERATOR_AUTH_INVALID: [403, 'OPERATOR_AUTH_INVALID'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          MAPPING_INCOMPLETE: [409, 'REVIEW_REQUIRED'], MAPPING_CONFLICT: [409, 'FOUNDATION_CONFLICT'],
          MAPPING_PERMISSION_DENIED: [403, 'REVIEW_REQUIRED'], MAPPING_UNAVAILABLE: [503, 'MAPPING_UNAVAILABLE'], REVIEW_REQUIRED: [409, 'REVIEW_REQUIRED'],
          'e1/handle-conflict': [409, 'FOUNDATION_CONFLICT'], 'e1/foundation-conflict': [409, 'FOUNDATION_CONFLICT'],
          'e1/migration-conflict': [409, 'FOUNDATION_CONFLICT'], 'e1/migration-review-required': [409, 'REVIEW_REQUIRED'],
          'e1/replay-mismatch': [409, 'REQUEST_INVALID'], 'e1/rate-limit-exceeded': [429, 'RATE_LIMITED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'applyMigrationManifest', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}), ...(operatorHash ? { operatorHash } : {})
        });
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/freeze-identity-conflict') {
      let callerHash;
      let operatorHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.freezeIdentityConflictEnabled) fail('E1_NOT_ENABLED');
        const reviewed = exactFreezeRequest(await parseBody(request));
        ({ operatorHash } = await verifyOperator(configuration, operatorAccessTokenHeader(request)));
        const firebaseIdToken = subjectFirebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        if (uid !== reviewed.uid) fail('REQUEST_INVALID');
        callerHash = uidHash(configuration, uid);
        await limitOperation('freezeIdentityConflict', operatorHash,
          rateAttemptHash('freezeIdentityConflict', operatorHash, [reviewed.operationId, reviewed.manifestFingerprint]));
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        let foundation;
        if (legacy?.status === 'ready') {
          let requestedHandle;
          try { requestedHandle = normalizeHandle(legacy.username); } catch { fail('REVIEW_REQUIRED'); }
          foundation = verifiedLegacyFoundation(uid, requestedHandle, legacy);
        }
        const allowed = reviewed.reasonCode === 'legacy-binding-conflict'
          ? ['mapping-conflict', 'permission-denied'].includes(legacy?.status)
          : reviewed.reasonCode === 'migration-manifest-conflict'
            ? ['mapping-incomplete', 'mapping-conflict', 'permission-denied'].includes(legacy?.status)
            : legacy?.status === 'ready';
        const observedFingerprint = observedLegacyFingerprint(uid, legacy, foundation);
        if (!allowed || reviewed.sourceMappingFingerprint !== observedFingerprint ||
            reviewed.manifestFingerprint !== conflictManifestFingerprint(reviewed)) fail('REVIEW_REQUIRED');
        const input = Object.freeze({
          ...reviewed,
          ...(foundation || {}),
          requestId: reviewed.operationId,
          fingerprint: hashParts([1, 'freezeIdentityConflict', uid, reviewed.operationId, reviewed.manifestFingerprint])
        });
        const result = await freezeConflict(input);
        const code = result.replay === true ? 'IDEMPOTENT' : 'SUCCESS';
        log(configuration, 'freezeIdentityConflict', code.toLowerCase(), startedAt, {
          uidHash: callerHash, operatorHash, replayClass: result.replay === true ? 'exact-replay' : 'first-write'
        });
        return json(response, 200, { code, status: 'frozen', reasonCode: reviewed.reasonCode });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], OPERATOR_AUTH_REQUIRED: [401, 'OPERATOR_AUTH_REQUIRED'],
          OPERATOR_AUTH_INVALID: [403, 'OPERATOR_AUTH_INVALID'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          REVIEW_REQUIRED: [409, 'REVIEW_REQUIRED'], MAPPING_UNAVAILABLE: [503, 'MAPPING_UNAVAILABLE'],
          'e1/conflict-record-mismatch': [409, 'REVIEW_REQUIRED'], 'e1/conflict-not-observed': [409, 'REVIEW_REQUIRED'],
          'e1/replay-mismatch': [409, 'REQUEST_INVALID'], 'e1/rate-limit-exceeded': [429, 'RATE_LIMITED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'freezeIdentityConflict', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}), ...(operatorHash ? { operatorHash } : {})
        });
        return json(response, status, { code });
      }
    }
    if (request.method !== 'GET') {
      log(configuration, 'request', 'method_not_allowed', startedAt);
      return json(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    if (url.pathname === '/health') {
      log(configuration, 'health', 'healthy', startedAt);
      return json(response, 200, { status: 'healthy' });
    }
    if (url.pathname === '/ready') {
      try {
        const result = await probe(configuration);
        if (!result.runtimeIdentityVerified || !result.firestoreConnected || !result.requiredPermissionsVerified ||
            result.forbiddenPermissionsGranted !== false) fail('E1_READY_CHECK_FAILED');
        log(configuration, 'ready', 'ready', startedAt, { runtimeIdentityVerified: true, requiredPermissionsVerified: true });
        return json(response, 200, {
          status: 'ready', runtimeIdentity: 'verified', firestore: 'connected', permissions: 'bounded', rtdbTarget: 'validated'
        });
      } catch (error) {
        log(configuration, 'ready', 'not_ready', startedAt, { errorClass: error.code || 'E1_READY_CHECK_FAILED' });
        return json(response, 503, { code: 'E1_NOT_READY' });
      }
    }
    if (url.pathname === '/operations') {
      log(configuration, 'operations', 'disabled', startedAt);
      return json(response, 503, { code: 'E1_NOT_ENABLED' });
    }
    log(configuration, 'request', 'not_found', startedAt);
    return json(response, 404, { code: 'NOT_FOUND' });
  };
}

function start(env = process.env) {
  const configuration = loadConfiguration(env);
  assertRuntimeDependencies(configuration);
  const authorityStore = createDefaultAuthorityStore(configuration);
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('E1_PORT_INVALID');
  const server = http.createServer(createHandler(configuration, { authorityStore }));
  server.listen(port, '0.0.0.0', () => structuredLog(configuration, 'startup', 'ready', Date.now()));
  return server;
}

if (require.main === module) start();

module.exports = Object.freeze({
  FORBIDDEN_PROJECT_PERMISSIONS,
  GATES,
  RATE_LIMITS,
  assertRuntimeDependencies,
  createHandler,
  conflictManifestFingerprint,
  loadConfiguration,
  migrationManifestFingerprint,
  observedLegacyFingerprint,
  readAccountDocument,
  repairReviewFingerprint,
  reserveFingerprint,
  redactFoundationDocument,
  runtimeProbe,
  sourceMappingFingerprint,
  start,
  verifiedLegacyFoundation,
  verifyFirebaseIdToken,
  verifyOperatorAccessToken
});
