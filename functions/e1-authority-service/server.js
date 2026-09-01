'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { createFirestoreE1AuthorityAdapter } = require('./firestoreE1AuthorityAdapter');
const {
  DURABLE_MODE,
  GROUP_C_PROOF_MODE,
  GROUP_E_CANARY_MODE,
  createReadLimiter,
  groupESubjectHash
} = require('./readRateLimiters');
const { validateTarget } = require('./e1TargetContracts');
const { HandleValidationError, fold: foldHandle, normalizeHandle } = require('./handleNormalization');
const { createVerifiedLegacyMappingReader, validatedTarget } = require('./rtdbVerifiedLegacyMappingReader');
const { createPublicTrainerShareReader } = require('./rtdbPublicTrainerShareReader');
const { sanitizeProviderPublicProjection } = require('./providerPublicProjection');
const {
  attemptHash: groupEAdmissionAttemptHash,
  responseBinding: groupEAdmissionResponseBinding,
  subjectHash: groupEAdmissionSubjectHash,
  validateAdmissionReceipt
} = require('./groupEAdmissionReceipt');

const GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const MUTATION_GATES = Object.freeze([
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const RATE_LIMITS = Object.freeze({
  readAccountFoundation: Object.freeze({ limit: 60, windowMs: 15 * 60 * 1000 }),
  listTrainerDirectory: Object.freeze({ limit: 30, windowMs: 15 * 60 * 1000 }),
  resolveFavoriteTrainerIdentity: Object.freeze({ limit: 240, windowMs: 15 * 60 * 1000 }),
  createProviderAccountFoundation: Object.freeze({ limit: 3, windowMs: 24 * 60 * 60 * 1000 }),
  reserveTrainerHandle: Object.freeze({ limit: 5, windowMs: 15 * 60 * 1000 }),
  repairAccountFoundation: Object.freeze({ limit: 3, windowMs: 24 * 60 * 60 * 1000 }),
  applyMigrationManifest: Object.freeze({ limit: 10, windowMs: 60 * 1000 }),
  freezeIdentityConflict: Object.freeze({ limit: 10, windowMs: 60 * 1000 })
});
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const PROOF_ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GROUP_E_MODE = 'synthetic-canary';
const HANDLE_KEY = /^v1_[a-f0-9]{2,512}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ATTEMPT_HASH = /^[a-f0-9]{16}$/;
const MAX_REQUEST_BYTES = 4096;
const PROVIDER_ACCOUNT_PROTOCOL_VERSION = 1;
const SUPPORTED_PROVIDER_ACCOUNT_PROTOCOL_VERSIONS = Object.freeze(new Set([PROVIDER_ACCOUNT_PROTOCOL_VERSION]));
const CLIENT_RELEASE = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const PROVIDER_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const PROVIDER_SUBJECT = /^[A-Za-z0-9_-]{1,512}$/u;
const DIRECTORY_QUERY_ALLOWED = /^[\p{L}\p{N} _.'-]*$/u;
const DIRECTORY_QUERY_UNSAFE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const DIRECTORY_CURSOR_PART = /^[A-Za-z0-9_-]+$/u;
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

function readProofConfiguration(env, configuration, gates, now) {
  const enabledValue = env.READ_PROOF_MODE;
  if (enabledValue !== undefined && !['true', 'false'].includes(enabledValue)) fail('E1_READ_PROOF_CONFIGURATION_INVALID');
  const enabled = enabledValue === 'true';
  const proofValues = [env.READ_PROOF_SUBJECT_UID_HASH, env.READ_PROOF_SUBJECT_TRAINER_HASH,
    env.READ_PROOF_WINDOW_START, env.READ_PROOF_WINDOW_END];
  if (!enabled) {
    if (proofValues.some((value) => value !== undefined && value !== '')) fail('E1_READ_PROOF_CONFIGURATION_INVALID');
    return Object.freeze({ enabled: false, limiterMode: DURABLE_MODE, proof: null });
  }
  const start = Date.parse(env.READ_PROOF_WINDOW_START);
  const end = Date.parse(env.READ_PROOF_WINDOW_END);
  const at = now();
  if (configuration.environment !== 'production' || gates.READ_ACCOUNT_FOUNDATION_ENABLED !== 'true' ||
      gates.READ_PROVIDER_PUBLIC_SHARE_ENABLED !== 'false' ||
      MUTATION_GATES.some((gate) => gates[gate] !== 'false') || !SHA256.test(env.READ_PROOF_SUBJECT_UID_HASH || '') ||
      !SHA256.test(env.READ_PROOF_SUBJECT_TRAINER_HASH || '') || !Number.isFinite(start) || !Number.isFinite(end) ||
      start >= end || end - start > 8 * 60 * 60 * 1000 || !Number.isSafeInteger(at) || at < start || at >= end) {
    fail('E1_READ_PROOF_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    enabled: true,
    limiterMode: GROUP_C_PROOF_MODE,
    proof: Object.freeze({
      uidHash: env.READ_PROOF_SUBJECT_UID_HASH,
      trainerHash: env.READ_PROOF_SUBJECT_TRAINER_HASH,
      start,
      end
    })
  });
}

function parseGroupEBindings(value) {
  const entries = typeof value === 'string' && value ? value.split(';') : [];
  if (entries.length !== 2) fail('E1_GROUP_E_CONFIGURATION_INVALID');
  const bindings = entries.map((entry) => {
    const [uidHashValue, trainerHash, extra] = entry.split(':');
    if (extra !== undefined || !SHA256.test(uidHashValue || '') || !SHA256.test(trainerHash || '')) {
      fail('E1_GROUP_E_CONFIGURATION_INVALID');
    }
    return Object.freeze({ uidHash: uidHashValue, trainerHash });
  });
  if (new Set(bindings.map((entry) => entry.uidHash)).size !== 2 ||
      new Set(bindings.map((entry) => entry.trainerHash)).size !== 2) fail('E1_GROUP_E_CONFIGURATION_INVALID');
  return Object.freeze(bindings);
}

function groupEConfiguration(env, configuration, gates, readProof, now) {
  const mode = env.GROUP_E_CLIENT_MODE || 'disabled';
  const values = [env.GROUP_E_SUBJECT_BINDINGS, env.GROUP_E_COHORT_DIGEST, env.GROUP_E_RUN_ID, env.GROUP_E_KEY_ID,
    env.GROUP_E_WINDOW_START, env.GROUP_E_WINDOW_END];
  if (mode === 'disabled') {
    if (values.some((value) => value !== undefined && value !== '')) fail('E1_GROUP_E_CONFIGURATION_INVALID');
    return Object.freeze({ enabled: false, mode, bindings: Object.freeze([]), cohortDigest: null, runId: null, keyId: null });
  }
  if (mode !== GROUP_E_MODE || configuration.environment !== 'production' || readProof.enabled ||
      gates.READ_ACCOUNT_FOUNDATION_ENABLED !== 'true' || gates.READ_PROVIDER_PUBLIC_SHARE_ENABLED !== 'false' ||
      MUTATION_GATES.some((gate) => gates[gate] !== 'false') ||
      !SHA256.test(env.GROUP_E_COHORT_DIGEST || '') || !PROOF_ATTEMPT_ID.test(env.GROUP_E_RUN_ID || '') ||
      !SHA256.test(env.GROUP_E_KEY_ID || '') || env.GROUP_E_WINDOW_START || env.GROUP_E_WINDOW_END) {
    fail('E1_GROUP_E_CONFIGURATION_INVALID');
  }
  return Object.freeze({ enabled: true, mode, bindings: parseGroupEBindings(env.GROUP_E_SUBJECT_BINDINGS),
    cohortDigest: env.GROUP_E_COHORT_DIGEST, runId: env.GROUP_E_RUN_ID, keyId: env.GROUP_E_KEY_ID });
}

function providerSubjectKeyRing(env) {
  const activeKey = env.PROVIDER_SUBJECT_HMAC_KEY || '';
  const activeVersion = env.PROVIDER_SUBJECT_HMAC_KEY_VERSION || '';
  const previousValue = env.PROVIDER_SUBJECT_HMAC_PREVIOUS_KEY_VERSIONS || '';
  const previousVersions = previousValue ? previousValue.split(',') : [];
  const validVersion = (value) => /^[1-9][0-9]{0,3}$/u.test(value);
  const validKey = (value) => Buffer.byteLength(value || '', 'utf8') >= 32 && Buffer.byteLength(value, 'utf8') <= 256;
  const activeConfigured = validVersion(activeVersion) && validKey(activeKey);
  if ((activeKey || activeVersion) && !activeConfigured) fail('E1_CONFIGURATION_MISMATCH');
  if (previousVersions.length && !activeConfigured) fail('E1_CONFIGURATION_MISMATCH');
  if (previousVersions.some((version) => !validVersion(version)) ||
      new Set(previousVersions).size !== previousVersions.length || previousVersions.includes(activeVersion) ||
      previousVersions.some((version) => Number(version) >= Number(activeVersion)) ||
      previousVersions.some((version, index) => index > 0 && Number(version) <= Number(previousVersions[index - 1]))) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  const declaredPrevious = new Set(previousVersions.map((version) => `PROVIDER_SUBJECT_HMAC_KEY_V${version}`));
  const observedPrevious = Object.keys(env).filter((name) => /^PROVIDER_SUBJECT_HMAC_KEY_V[1-9][0-9]{0,3}$/u.test(name));
  if (observedPrevious.some((name) => !declaredPrevious.has(name)) || declaredPrevious.size !== observedPrevious.length) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  const previous = previousVersions.map((version) => {
    const key = env[`PROVIDER_SUBJECT_HMAC_KEY_V${version}`] || '';
    if (!validKey(key)) fail('E1_CONFIGURATION_MISMATCH');
    return Object.freeze({ version: Number(version), key });
  });
  return Object.freeze(activeConfigured
    ? [Object.freeze({ version: Number(activeVersion), key: activeKey }), ...previous]
    : previous);
}

function loadConfiguration(env = process.env, now = () => Date.now()) {
  const providerSubjectHmacKeys = providerSubjectKeyRing(env);
  const providerAccountCompatibilityRequired = env.PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED === 'true';
  if (env.PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED !== undefined &&
      !['true', 'false'].includes(env.PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED)) fail('E1_CONFIGURATION_MISMATCH');
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
    providerSubjectHmacKey: env.PROVIDER_SUBJECT_HMAC_KEY || '',
    providerSubjectHmacKeyVersion: env.PROVIDER_SUBJECT_HMAC_KEY_VERSION || '',
    providerSubjectHmacKeys,
    providerAccountCompatibilityRequired,
    revision: env.K_REVISION || 'local'
  };
  try { validateTarget(configuration); } catch { fail('E1_CONFIGURATION_MISMATCH'); }
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(configuration.firebaseWebApiKey || '')) fail('E1_CONFIGURATION_MISMATCH');
  if (!SHA256.test(configuration.operatorEmailHash || '') || !SHA256.test(configuration.operatorSubjectHash || '')) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  const providerKeyConfigured = providerSubjectHmacKeys.length > 0 &&
    providerSubjectHmacKeys[0].version === Number(configuration.providerSubjectHmacKeyVersion);
  try { validatedTarget({ environment: configuration.environment, projectId: configuration.projectId, databaseUrl: configuration.rtdbDatabaseUrl }); }
  catch { fail('E1_CONFIGURATION_MISMATCH'); }
  if (GATES.some((gate) => !['true', 'false'].includes(env[gate])) ||
      MUTATION_GATES.filter((gate) => env[gate] === 'true').length > 1) {
    fail('E1_OPERATION_GATE_INVALID');
  }
  if ((env.CREATE_PROVIDER_ACCOUNT_ENABLED === 'true' || providerAccountCompatibilityRequired) && !providerKeyConfigured) {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  if (providerAccountCompatibilityRequired && env.READ_ACCOUNT_FOUNDATION_ENABLED !== 'true') {
    fail('E1_CONFIGURATION_MISMATCH');
  }
  const repairAccountFoundationEnabled = env.REPAIR_FOUNDATION_ENABLED === 'true';
  const applyMigrationManifestEnabled = env.APPLY_MIGRATION_ENABLED === 'true';
  const readProof = readProofConfiguration(env, configuration, env, now);
  const groupE = groupEConfiguration(env, configuration, env, readProof, now);
  return Object.freeze({
    ...configuration,
    readAccountFoundationEnabled: env.READ_ACCOUNT_FOUNDATION_ENABLED === 'true',
    readProviderPublicShareEnabled: env.READ_PROVIDER_PUBLIC_SHARE_ENABLED === 'true',
    createProviderAccountEnabled: env.CREATE_PROVIDER_ACCOUNT_ENABLED === 'true',
    reserveTrainerHandleEnabled: env.RESERVE_HANDLE_ENABLED === 'true',
    repairAccountFoundationEnabled,
    applyMigrationManifestEnabled,
    freezeIdentityConflictEnabled: env.FREEZE_CONFLICT_ENABLED === 'true',
    readProofMode: readProof.enabled,
    readLimiterMode: groupE.enabled ? GROUP_E_CANARY_MODE : readProof.limiterMode,
    readProof: readProof.proof,
    groupEClientMode: groupE.enabled,
    groupE,
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

let firebaseTokenVerifier;

function defaultFirebaseTokenVerifier(configuration) {
  if (!firebaseTokenVerifier) {
    const appName = 'e1-identity-authority-token-verifier';
    const app = getApps().find((candidate) => candidate.name === appName) ||
      initializeApp({ projectId: configuration.projectId }, appName);
    firebaseTokenVerifier = getAdminAuth(app);
  }
  return firebaseTokenVerifier;
}

async function verifyFirebaseIdToken(configuration, firebaseIdToken, verifier, now = () => Date.now()) {
  if (typeof firebaseIdToken !== 'string' || !firebaseIdToken) fail('AUTH_REQUIRED');
  if (Buffer.byteLength(firebaseIdToken) > 8192) fail('AUTH_INVALID');
  const tokenVerifier = verifier || defaultFirebaseTokenVerifier(configuration);
  let claims;
  try {
    claims = await tokenVerifier.verifyIdToken(firebaseIdToken, false);
  } catch {
    fail('AUTH_INVALID');
  }
  const decodedClaims = decodeFirebaseClaims(firebaseIdToken);
  const uid = claims?.uid || claims?.sub;
  const nowSeconds = Math.floor(now() / 1000);
  if (!UID.test(uid || '') || claims.sub !== uid || decodedClaims.sub !== uid ||
      claims.aud !== configuration.projectId || decodedClaims.aud !== configuration.projectId ||
      claims.iss !== `https://securetoken.google.com/${configuration.projectId}` || decodedClaims.iss !== claims.iss ||
      !Number.isFinite(claims.exp) || claims.exp <= nowSeconds || decodedClaims.exp !== claims.exp ||
      !Number.isFinite(claims.auth_time) || decodedClaims.auth_time !== claims.auth_time) fail('AUTH_INVALID');
  const firebase = claims.firebase;
  const decodedFirebase = decodedClaims.firebase;
  const signInProvider = firebase?.sign_in_provider;
  const identities = firebase?.identities;
  if ((firebase !== undefined || decodedFirebase !== undefined) &&
      JSON.stringify(firebase) !== JSON.stringify(decodedFirebase)) fail('AUTH_INVALID');
  return Object.freeze({
    uid,
    authTime: claims.auth_time * 1000,
    signInProvider: typeof signInProvider === 'string' ? signInProvider : null,
    identities: identities && typeof identities === 'object' && !Array.isArray(identities) ? identities : null
  });
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
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value, 'nullValue')) return null;
  return undefined;
}

function redactFoundationDocument(document, expectedUid) {
  const fields = document?.fields;
  const uid = firestoreScalar(fields, 'uid');
  const schemaVersion = firestoreScalar(fields, 'schemaVersion');
  const canonicalTrainerName = firestoreScalar(fields, 'canonicalTrainerName') ?? firestoreScalar(fields, 'trainerName');
  const normalizedTrainerName = firestoreScalar(fields, 'normalizedTrainerName');
  const handleKey = firestoreScalar(fields, 'handleKey');
  const legacyUsername = firestoreScalar(fields, 'legacyUsername');
  const declaredIdentityKind = firestoreScalar(fields, 'identityKind');
  const declaredLegacyAccess = firestoreScalar(fields, 'legacyAccessConfigured');
  const status = firestoreScalar(fields, 'status');
  const revision = firestoreScalar(fields, 'revision');
  let normalized;
  try { normalized = normalizeHandle(canonicalTrainerName); } catch { fail('INTERNAL_ERROR'); }
  const legacyCompatible = typeof legacyUsername === 'string' && legacyUsername === canonicalTrainerName &&
    (declaredIdentityKind === undefined || declaredIdentityKind === 'legacy_migrated') &&
    (declaredLegacyAccess === undefined || declaredLegacyAccess === true);
  const providerOnly = legacyUsername === null && declaredIdentityKind === 'provider_only' && declaredLegacyAccess === false;
  if (schemaVersion !== 1 || uid !== expectedUid || typeof canonicalTrainerName !== 'string' || !canonicalTrainerName ||
      typeof normalizedTrainerName !== 'string' || !normalizedTrainerName || !HANDLE_KEY.test(handleKey || '') ||
      normalized.normalized !== normalizedTrainerName || normalized.handleKey !== handleKey ||
      typeof status !== 'string' || (!legacyCompatible && !providerOnly) ||
      !Number.isSafeInteger(revision) || revision < 1) fail('INTERNAL_ERROR');
  return Object.freeze({
    schemaVersion,
    canonicalTrainerName,
    normalizedTrainerName,
    handleKey,
    identityKind: providerOnly ? 'provider_only' : 'legacy_migrated',
    legacyAccessConfigured: !providerOnly,
    legacyUsername,
    status,
    revision
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

function providerRequestFingerprint(input) {
  return hashParts([
    1,
    'createProviderAccountFoundation',
    input.providerAccountProtocolVersion,
    input.uid,
    input.requestId,
    input.normalizedTrainerName,
    input.handleKey,
    input.lifecycleId
  ]);
}

function providerOperationFingerprint(input) {
  return hashParts([
    1,
    'createProviderAccountFoundation',
    input.providerAccountProtocolVersion,
    input.uid,
    input.requestId,
    input.normalizedTrainerName,
    input.handleKey,
    input.providerId,
    input.providerSubjectKey,
    input.authTime,
    input.lifecycleId
  ]);
}

function providerSubjectHash(configuration, providerId, subject, keyVersion = Number(configuration.providerSubjectHmacKeyVersion)) {
  const key = configuration.providerSubjectHmacKeys?.find((candidate) => candidate.version === Number(keyVersion));
  if (!key) fail('PROVIDER_KEY_UNAVAILABLE');
  return crypto.createHmac('sha256', key.key)
    .update(`provider-subject\0v${key.version}\0${providerId}\0${subject}`, 'utf8').digest('hex');
}

function linkedGoogleProviderIdentity(configuration, verifiedToken) {
  const subjects = verifiedToken?.identities?.['google.com'];
  if (!Array.isArray(subjects) || subjects.length !== 1 || !PROVIDER_SUBJECT.test(subjects[0] || '') ||
      !Number.isSafeInteger(verifiedToken?.authTime)) {
    fail('PROVIDER_IDENTITY_REQUIRED');
  }
  if (!configuration.providerSubjectHmacKeys?.length) fail('PROVIDER_KEY_UNAVAILABLE');
  const candidates = configuration.providerSubjectHmacKeys.map(({ version }) => Object.freeze({
    providerSubjectKey: `v${version}_google_${providerSubjectHash(configuration, 'google.com', subjects[0], version)}`,
    providerSubjectKeyVersion: version
  }));
  return Object.freeze({providerKey:'google',providerId:'google.com',...candidates[0],
    providerSubjectCandidates:Object.freeze(candidates),authTime:verifiedToken.authTime});
}

function recentGoogleProviderIdentity(configuration, verifiedToken, timestamp) {
  const provider = linkedGoogleProviderIdentity(configuration, verifiedToken);
  if (verifiedToken.signInProvider !== 'google.com' || !Number.isSafeInteger(timestamp) ||
      provider.authTime > timestamp || timestamp - provider.authTime > PROVIDER_AUTH_MAX_AGE_MS) {
    fail('RECENT_PROVIDER_AUTH_REQUIRED');
  }
  return Object.freeze({providerKey:provider.providerKey,providerId:provider.providerId,
    providerSubjectKey:provider.providerSubjectKey,providerSubjectKeyVersion:provider.providerSubjectKeyVersion,
    authTime:provider.authTime});
}

async function verifyCurrentGoogleAccount(configuration, firebaseIdToken, verifiedToken, provider, fetchImpl) {
  const expectedSubject = verifiedToken.identities['google.com'][0];
  let response;
  try {
    response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(configuration.firebaseWebApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: firebaseIdToken })
    });
  } catch {
    fail('INTERNAL_ERROR');
  }
  if (!response?.ok) fail(response?.status >= 500 ? 'INTERNAL_ERROR' : 'PROVIDER_IDENTITY_REQUIRED');
  let payload;
  try { payload = await response.json(); } catch { fail('INTERNAL_ERROR'); }
  const users = payload?.users;
  const account = Array.isArray(users) && users.length === 1 ? users[0] : null;
  const googleProviders = Array.isArray(account?.providerUserInfo)
    ? account.providerUserInfo.filter((candidate) => candidate?.providerId === 'google.com')
    : [];
  if (account?.localId !== verifiedToken.uid || account?.disabled === true || googleProviders.length !== 1 ||
      googleProviders[0].federatedId !== expectedSubject) fail('PROVIDER_IDENTITY_REQUIRED');
  return provider;
}

async function verifyCurrentLinkedGoogleProviderIdentity(configuration, firebaseIdToken, verifiedToken, fetchImpl = fetch) {
  const provider = linkedGoogleProviderIdentity(configuration, verifiedToken);
  return verifyCurrentGoogleAccount(configuration, firebaseIdToken, verifiedToken, provider, fetchImpl);
}

async function verifyRecentGoogleProviderAuthentication(configuration, firebaseIdToken, verifiedToken, fetchImpl = fetch,
  timestamp = Date.now()) {
  const provider = recentGoogleProviderIdentity(configuration, verifiedToken, timestamp);
  return verifyCurrentGoogleAccount(configuration, firebaseIdToken, verifiedToken, provider, fetchImpl);
}

function exactProviderCreateRequest(body) {
  exactFields(body, [
    'schemaVersion', 'providerAccountProtocolVersion', 'requestId', 'requestedHandle', 'lifecycleId', 'clientRelease',
    'idempotencyFingerprint'
  ]);
  if (body.schemaVersion !== 1 || !SUPPORTED_PROVIDER_ACCOUNT_PROTOCOL_VERSIONS.has(body.providerAccountProtocolVersion) ||
      !REQUEST_ID.test(body.requestId || '') ||
      typeof body.lifecycleId !== 'string' || !/^auth-[1-9][0-9]{0,9}$/u.test(body.lifecycleId) ||
      !CLIENT_RELEASE.test(body.clientRelease || '') || !SHA256.test(body.idempotencyFingerprint || '') ||
      typeof body.requestedHandle !== 'string') fail('REQUEST_INVALID');
  let handle;
  try { handle = normalizeHandle(body.requestedHandle); } catch (error) {
    if (error instanceof HandleValidationError) fail('REQUEST_INVALID');
    throw error;
  }
  return Object.freeze({
    requestId: body.requestId,
    providerAccountProtocolVersion: body.providerAccountProtocolVersion,
    lifecycleId: body.lifecycleId,
    clientRelease: body.clientRelease,
    idempotencyFingerprint: body.idempotencyFingerprint,
    handle
  });
}

function exactProviderPublicShareRequest(body) {
  exactFields(body, ['schemaVersion', 'trainerHandle']);
  if (body.schemaVersion !== 1 || typeof body.trainerHandle !== 'string') fail('REQUEST_INVALID');
  try { return normalizeHandle(body.trainerHandle); }
  catch (error) {
    if (error instanceof HandleValidationError) fail('REQUEST_INVALID');
    throw error;
  }
}

function normalizeDirectoryQuery(value) {
  const display = String(value ?? '').normalize('NFKC').trim();
  const length = Array.from(display).length;
  if (length > 64 || display && length < 2 || !DIRECTORY_QUERY_ALLOWED.test(display) ||
      DIRECTORY_QUERY_UNSAFE.test(display)) fail('REQUEST_INVALID');
  return foldHandle(display);
}

function compareNormalizedHandles(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (difference) return difference;
  }
  return a.length - b.length;
}

function directoryCursorMac(configuration, payload) {
  return crypto.createHmac('sha256', configuration.operatorSubjectHash)
    .update(`${configuration.projectId}\0trainer-directory-cursor-v1\0${payload}`, 'utf8').digest('base64url');
}

function encodeDirectoryCursor(configuration, normalizedQuery, afterNormalized) {
  if (!normalizedQuery || !afterNormalized) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, q: normalizedQuery, a: afterNormalized }), 'utf8').toString('base64url');
  return `${payload}.${directoryCursorMac(configuration, payload)}`;
}

function decodeDirectoryCursor(configuration, value, normalizedQuery) {
  if (value === null) return '';
  if (typeof value !== 'string' || value.length > 1024) fail('REQUEST_INVALID');
  const parts = value.split('.');
  if (parts.length !== 2 || !parts.every((part) => DIRECTORY_CURSOR_PART.test(part))) fail('REQUEST_INVALID');
  const expected = directoryCursorMac(configuration, parts[0]);
  const actualBytes = Buffer.from(parts[1], 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) fail('REQUEST_INVALID');
  let decoded;
  try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { fail('REQUEST_INVALID'); }
  exactFields(decoded, ['a', 'q', 'v']);
  if (decoded.v !== 1 || decoded.q !== normalizedQuery || typeof decoded.a !== 'string' ||
      !decoded.a.startsWith(normalizedQuery) || normalizeDirectoryQuery(decoded.a) !== decoded.a) fail('REQUEST_INVALID');
  return decoded.a;
}

function exactTrainerDirectoryRequest(configuration, body) {
  exactFields(body, ['cursor', 'pageSize', 'query', 'schemaVersion']);
  if (body.schemaVersion !== 1 || !Number.isSafeInteger(body.pageSize) || body.pageSize < 1 || body.pageSize > 25 ||
      typeof body.query !== 'string') fail('REQUEST_INVALID');
  const normalizedQuery = normalizeDirectoryQuery(body.query);
  if (!normalizedQuery && body.cursor !== null) fail('REQUEST_INVALID');
  return Object.freeze({
    normalizedQuery,
    afterNormalized: decodeDirectoryCursor(configuration, body.cursor, normalizedQuery),
    pageSize: body.pageSize
  });
}

function exactFavoriteIdentityRequest(body) {
  exactFields(body, ['expectedTargetUid', 'schemaVersion', 'trainerHandle']);
  if (body.schemaVersion !== 1 || typeof body.trainerHandle !== 'string' ||
      typeof body.expectedTargetUid !== 'string' || body.expectedTargetUid && !UID.test(body.expectedTargetUid)) {
    fail('REQUEST_INVALID');
  }
  let handle;
  try { handle = normalizeHandle(body.trainerHandle); }
  catch (error) {
    if (error instanceof HandleValidationError) fail('REQUEST_INVALID');
    throw error;
  }
  return Object.freeze({ handle, expectedTargetUid: body.expectedTargetUid });
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

function exactReadRequest(body, readProofMode, groupEClientMode = false) {
  const expectedFields = groupEClientMode ? ['admissionReceipt', 'attemptId', 'schemaVersion'] :
    readProofMode ? ['proofAttemptId', 'schemaVersion'] : ['schemaVersion'];
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : [];
  if (!body || typeof body !== 'object' || Array.isArray(body) || fields.length !== expectedFields.length ||
      fields.some((field, index) => field !== expectedFields[index]) || body.schemaVersion !== 1 ||
      (readProofMode && !PROOF_ATTEMPT_ID.test(body.proofAttemptId || '')) ||
      (groupEClientMode && !PROOF_ATTEMPT_ID.test(body.attemptId || ''))) {
    fail('REQUEST_INVALID');
  }
  return Object.freeze({ ...body });
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

function proofAttemptHash(proofAttemptId) {
  return crypto.createHash('sha256').update(JSON.stringify([1, 'group-c-proof-attempt', proofAttemptId]), 'utf8')
    .digest('hex').slice(0, 16);
}

function groupEAttemptHash(attemptId) {
  return groupEAdmissionAttemptHash(attemptId).slice(0, 16);
}

function groupECohortBindingHash(cohortDigest) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([1, 'group-e-client-foundation-cohort-log-binding', cohortDigest]), 'utf8')
    .digest('hex').slice(0, 16);
}

function groupETerminalLogFields(configuration, attemptHash, uid, responseSubjectBinding, admissionReceiptDigest) {
  if (!configuration.groupEClientMode || !SAFE_ATTEMPT_HASH.test(attemptHash || '')) return {};
  const slotIndex = uid
    ? configuration.groupE.bindings.findIndex((binding) => binding.uidHash === groupESubjectHash('uid', uid))
    : -1;
  return {
    groupEAttemptHash: attemptHash,
    ...(slotIndex >= 0 ? { canarySlot: String.fromCharCode(65 + slotIndex) } : {}),
    cohortBindingHash: groupECohortBindingHash(configuration.groupE.cohortDigest),
    ...(SHA256.test(admissionReceiptDigest || '') ? { admissionReceiptDigest } : {}),
    ...(SHA256.test(responseSubjectBinding || '') ? { responseSubjectBinding } : {}),
    authoritativeCallBudget: false
  };
}

function groupEResponseBinding(uid, attemptId, admissionReceiptDigest) {
  return groupEAdmissionResponseBinding(uid, attemptId, admissionReceiptDigest);
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
  const verifyToken = dependencies.verifyFirebaseIdToken ||
    ((config, token) => verifyFirebaseIdToken(config, token, dependencies.firebaseTokenVerifier));
  const verifyCurrentLinkedProvider = dependencies.verifyCurrentLinkedGoogleProviderIdentity ||
    ((config, token, verifiedToken) =>
      verifyCurrentLinkedGoogleProviderIdentity(config, token, verifiedToken, fetchImpl));
  const verifyRecentProviderAuthentication = dependencies.verifyRecentGoogleProviderAuthentication ||
    ((config, token, verifiedToken, timestamp) =>
      verifyRecentGoogleProviderAuthentication(config, token, verifiedToken, fetchImpl, timestamp));
  const verifyOperator = dependencies.verifyOperatorAccessToken || ((config, token) => verifyOperatorAccessToken(config, token, fetchImpl));
  const readAccount = dependencies.readAccountDocument || ((config, uid) => readAccountDocument(config, uid, fetchImpl));
  const legacyReader = dependencies.legacyReader || createVerifiedLegacyMappingReader({
    environment: configuration.environment,
    projectId: configuration.projectId,
    databaseUrl: configuration.rtdbDatabaseUrl,
    fetchImpl,
    onEvent: dependencies.legacyReadEvent
  });
  const publicShareReader = dependencies.publicShareReader || createPublicTrainerShareReader({
    environment: configuration.environment,
    projectId: configuration.projectId,
    databaseUrl: configuration.rtdbDatabaseUrl,
    fetchImpl,
    onEvent: dependencies.publicShareReadEvent
  });
  const readLegacyBinding = dependencies.readLegacyBinding || ((input) => legacyReader.readVerifiedLegacyMapping(input));
  let authorityStore = dependencies.authorityStore;
  const reserveHandle = dependencies.reserveTrainerHandle || (async (input, options) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.reserveTrainerHandle(input, options);
  });
  const createProviderAccount = dependencies.createProviderAccountFoundation || (async (input, options) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.createProviderAccountFoundation(input, options);
  });
  const readProviderAccount = dependencies.readProviderAccountFoundation || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.readProviderAccountFoundation(input);
  });
  const readPublicIdentity = dependencies.readPublicShareIdentity || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.readPublicShareIdentity(input);
  });
  const listDirectory = dependencies.listTrainerDirectory || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.listTrainerDirectory(input);
  });
  const readPublicShare = dependencies.readPublicTrainerShare || ((ownerUid) => publicShareReader.read(ownerUid));
  const repairFoundation = dependencies.repairAccountFoundation || (async (input, options) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.repairAccountFoundation(input, options);
  });
  const applyManifest = dependencies.applyMigrationManifest || (async (input, options) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.applyMigrationManifest(input, options);
  });
  const freezeConflict = dependencies.freezeIdentityConflict || (async (input, options) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.freezeIdentityConflict(input, options);
  });
  const operationRequestExists = dependencies.operationRequestExists || (async (input) => {
    authorityStore ||= createDefaultAuthorityStore(configuration);
    return authorityStore.operationRequestExists(input);
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
  const readLimiter = dependencies.readLimiter || createReadLimiter({
    mode: configuration.readLimiterMode,
    proof: configuration.readProof,
    groupE: configuration.groupE,
    consumeRateLimit: applyRateLimit,
    rateLimit: RATE_LIMITS.readAccountFoundation,
    now,
    randomId,
    rateAttemptHash
  });
  return async function handler(request, response) {
    const startedAt = Date.now();
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/v1/read-account-foundation') {
      let callerHash;
      let attemptHash;
      let groupEAttempt;
      let groupEUid;
      let groupEResponseSubjectBinding;
      let groupEAdmissionReceiptDigest;
      const logFields = () => ({
        ...(callerHash ? { uidHash: callerHash } : {}),
        ...(attemptHash ? { proofAttemptHash: attemptHash } : {}),
        ...groupETerminalLogFields(configuration, groupEAttempt, groupEUid, groupEResponseSubjectBinding,
          groupEAdmissionReceiptDigest)
      });
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readAccountFoundationEnabled) fail('E1_NOT_ENABLED');
        const readRequest = exactReadRequest(await parseBody(request), configuration.readProofMode, configuration.groupEClientMode);
        attemptHash = readRequest.proofAttemptId ? proofAttemptHash(readRequest.proofAttemptId) : undefined;
        let groupEReceipt;
        if (configuration.groupEClientMode) {
          groupEReceipt = validateAdmissionReceipt(readRequest.admissionReceipt, {
            runId: configuration.groupE.runId,
            cohortDigest: configuration.groupE.cohortDigest,
            keyId: configuration.groupE.keyId,
            attemptHash: groupEAdmissionAttemptHash(readRequest.attemptId)
          });
          groupEAttempt = groupEReceipt.attemptHash.slice(0, 16);
          groupEAdmissionReceiptDigest = groupEReceipt.receiptDigest;
          if (request.headers?.['x-e1-client-mode'] !== GROUP_E_MODE ||
              request.headers?.['x-e1-cohort-digest'] !== configuration.groupE.cohortDigest ||
              request.headers?.['x-e1-run-id'] !== configuration.groupE.runId ||
              request.headers?.['x-e1-key-id'] !== configuration.groupE.keyId ||
              request.headers?.['x-e1-admission-receipt-digest'] !== groupEReceipt.receiptDigest) {
            fail('E1_GROUP_E_BOUNDARY_INVALID');
          }
        }
        const firebaseIdToken = firebaseTokenHeader(request);
        const verifiedToken = await verifyToken(configuration, firebaseIdToken);
        const { uid } = verifiedToken;
        groupEUid = configuration.groupEClientMode ? uid : undefined;
        if (configuration.groupEClientMode) {
          const slotIndex = configuration.groupE.bindings.findIndex((binding) =>
            binding.uidHash === groupEAdmissionSubjectHash('uid', uid));
          if (slotIndex < 0 || groupEReceipt.slot !== String.fromCharCode(65 + slotIndex) ||
              groupEReceipt.uidHash !== configuration.groupE.bindings[slotIndex].uidHash) {
            fail('E1_GROUP_E_SUBJECT_DENIED');
          }
          groupEResponseSubjectBinding = groupEResponseBinding(uid, readRequest.attemptId,
            groupEReceipt.receiptDigest);
        }
        callerHash = uidHash(configuration, uid);
        readLimiter.assertUid(uid);
        if (configuration.readProofMode || configuration.groupEClientMode) {
          const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
          if (legacy?.status === 'mapping-incomplete' || legacy?.status === 'mapping-conflict') {
            fail(configuration.groupEClientMode ? 'E1_GROUP_E_MAPPING_NOT_READY' : 'E1_READ_PROOF_MAPPING_NOT_READY');
          }
          if (legacy?.status === 'permission-denied') fail(configuration.groupEClientMode ? 'E1_GROUP_E_SUBJECT_DENIED' : 'E1_READ_PROOF_MAPPING_DENIED');
          if (legacy?.status !== 'ready') fail(configuration.groupEClientMode ? 'E1_GROUP_E_MAPPING_UNAVAILABLE' : 'E1_READ_PROOF_MAPPING_UNAVAILABLE');
          await readLimiter.consume({ uid, trainerUsername: legacy.username });
        } else {
          await readLimiter.consume({ uid, subjectHash: callerHash });
        }
        const document = await readAccount(configuration, uid);
        const canaryEnvelope = configuration.groupEClientMode ? {
          schemaVersion: 1,
          attemptHash: groupEAttempt,
          admissionReceiptDigest: groupEAdmissionReceiptDigest,
          subjectBinding: groupEResponseSubjectBinding
        } : {};
        if (!document) {
          log(configuration, 'readAccountFoundation', 'not_initialized', startedAt, logFields());
          return json(response, 200, { ...canaryEnvelope, code: 'FOUNDATION_NOT_INITIALIZED' });
        }
        let foundation = redactFoundationDocument(document, uid);
        if (FROZEN_STATUSES.has(foundation.status)) {
          log(configuration, 'readAccountFoundation', 'frozen', startedAt, logFields());
          return json(response, 423, { ...canaryEnvelope, code: 'ACCOUNT_FROZEN', foundation });
        }
        if (foundation.status !== 'active') fail('INTERNAL_ERROR');
        if (foundation.identityKind === 'provider_only') {
          const provider = await verifyCurrentLinkedProvider(configuration, firebaseIdToken, verifiedToken);
          const exact = await readProviderAccount(Object.freeze({ uid, ...foundation, ...provider }));
          if (!exact) fail('FOUNDATION_CONFLICT');
          foundation = exact;
        } else {
          const requestedHandle = normalizeHandle(foundation.canonicalTrainerName);
          const legacy = verifiedLegacyFoundation(uid, requestedHandle,
            await readLegacyBinding({ verifiedUid: uid, firebaseIdToken }));
          if (legacy.canonicalTrainerName !== foundation.canonicalTrainerName ||
              legacy.normalizedTrainerName !== foundation.normalizedTrainerName || legacy.handleKey !== foundation.handleKey ||
              legacy.legacyUsername !== foundation.legacyUsername) fail('FOUNDATION_CONFLICT');
        }
        log(configuration, 'readAccountFoundation', 'success', startedAt, logFields());
        return json(response, 200, { ...canaryEnvelope, code: 'SUCCESS', foundation });
      } catch (error) {
        const code = ['E1_NOT_ENABLED', 'AUTH_REQUIRED', 'AUTH_INVALID', 'REQUEST_INVALID', 'REQUEST_TOO_LARGE', 'METHOD_NOT_ALLOWED',
          'E1_READ_PROOF_SUBJECT_DENIED', 'E1_READ_PROOF_EXPIRED', 'E1_READ_PROOF_MAPPING_NOT_READY',
          'E1_READ_PROOF_MAPPING_DENIED', 'E1_READ_PROOF_MAPPING_UNAVAILABLE', 'E1_GROUP_E_BOUNDARY_INVALID',
          'E1_GROUP_E_SUBJECT_DENIED', 'E1_GROUP_E_RECEIPT_INVALID', 'E1_GROUP_E_RECEIPT_MISMATCH',
          'E1_GROUP_E_MAPPING_NOT_READY', 'E1_GROUP_E_MAPPING_UNAVAILABLE', 'PROVIDER_IDENTITY_REQUIRED',
          'PROVIDER_KEY_UNAVAILABLE', 'FOUNDATION_CONFLICT', 'MAPPING_INCOMPLETE', 'MAPPING_CONFLICT',
          'MAPPING_PERMISSION_DENIED', 'MAPPING_UNAVAILABLE', 'e1/provider-foundation-conflict'].includes(error?.code)
          ? error.code : 'INTERNAL_ERROR';
        const status = code === 'E1_NOT_ENABLED' ? 503 : code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ? 401 :
          code === 'REQUEST_TOO_LARGE' ? 413 : code === 'METHOD_NOT_ALLOWED' ? 405 : code === 'REQUEST_INVALID' ? 400 :
            ['E1_READ_PROOF_SUBJECT_DENIED', 'E1_READ_PROOF_MAPPING_DENIED', 'E1_GROUP_E_SUBJECT_DENIED',
              'E1_GROUP_E_BOUNDARY_INVALID', 'E1_GROUP_E_RECEIPT_INVALID', 'E1_GROUP_E_RECEIPT_MISMATCH'].includes(code) ? 403 :
              ['E1_READ_PROOF_MAPPING_NOT_READY', 'E1_GROUP_E_MAPPING_NOT_READY'].includes(code) ? 409 :
                ['E1_READ_PROOF_EXPIRED', 'E1_READ_PROOF_MAPPING_UNAVAILABLE', 'E1_GROUP_E_MAPPING_UNAVAILABLE'].includes(code) ? 503 :
            code === 'PROVIDER_IDENTITY_REQUIRED' ? 403 :
              ['FOUNDATION_CONFLICT', 'MAPPING_INCOMPLETE', 'MAPPING_CONFLICT', 'e1/provider-foundation-conflict'].includes(code) ? 409 :
                ['PROVIDER_KEY_UNAVAILABLE', 'MAPPING_UNAVAILABLE'].includes(code) ? 503 :
                  code === 'MAPPING_PERMISSION_DENIED' ? 403 : error?.code === 'e1/rate-limit-exceeded' ? 429 : 500;
        const responseCode = error?.code === 'e1/rate-limit-exceeded' ? 'RATE_LIMITED' :
          ['MAPPING_INCOMPLETE', 'MAPPING_CONFLICT', 'MAPPING_PERMISSION_DENIED', 'MAPPING_UNAVAILABLE',
            'e1/provider-foundation-conflict'].includes(code) ? 'FOUNDATION_CONFLICT' : code;
        log(configuration, 'readAccountFoundation', responseCode.toLowerCase(), startedAt, logFields());
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
    if (url.pathname === '/v1/read-provider-public-share') {
      let handleHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readProviderPublicShareEnabled) fail('E1_NOT_ENABLED');
        const handle = exactProviderPublicShareRequest(await parseBody(request));
        handleHash = handleCorrelationHash(configuration, handle.handleKey);
        const identity = await readPublicIdentity({
          canonicalTrainerName: handle.display,
          normalizedTrainerName: handle.normalized,
          handleKey: handle.handleKey
        });
        if (!identity) {
          log(configuration, 'readProviderPublicShare', 'not_found', startedAt, { handleHash });
          return json(response, 200, { code: 'SHARE_NOT_FOUND' });
        }
        const share = await readPublicShare(identity.ownerUid);
        if (share?.status === 'not-found') {
          log(configuration, 'readProviderPublicShare', 'not_found', startedAt, { handleHash });
          return json(response, 200, { code: 'SHARE_NOT_FOUND' });
        }
        if (share?.status === 'permission-denied') fail('PUBLIC_SHARE_PERMISSION_DENIED');
        if (share?.status !== 'ready') fail('PUBLIC_SHARE_UNAVAILABLE');
        const projection = sanitizeProviderPublicProjection(share.value, {
          trainerName: identity.canonicalTrainerName
        });
        if (!projection) fail('PUBLIC_SHARE_INVALID');
        log(configuration, 'readProviderPublicShare', 'success', startedAt, { handleHash });
        return json(response, 200, { code: 'SUCCESS', share: projection });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], REQUEST_INVALID: [400, 'REQUEST_INVALID'],
          REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          PUBLIC_SHARE_PERMISSION_DENIED: [503, 'PUBLIC_SHARE_UNAVAILABLE'],
          PUBLIC_SHARE_UNAVAILABLE: [503, 'PUBLIC_SHARE_UNAVAILABLE'],
          PUBLIC_SHARE_INVALID: [409, 'PUBLIC_SHARE_INVALID'],
          'e1/public-identity-conflict': [409, 'PUBLIC_IDENTITY_CONFLICT']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'readProviderPublicShare', code.toLowerCase(), startedAt,
          handleHash ? { handleHash } : {});
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/list-trainer-directory') {
      let callerHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readProviderPublicShareEnabled) fail('E1_NOT_ENABLED');
        const directoryRequest = exactTrainerDirectoryRequest(configuration, await parseBody(request));
        const firebaseIdToken = firebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        callerHash = uidHash(configuration, uid);
        await limitOperation('listTrainerDirectory', callerHash,
          rateAttemptHash('listTrainerDirectory', callerHash, [directoryRequest.normalizedQuery,
            directoryRequest.afterNormalized, directoryRequest.pageSize]));
        const result = await listDirectory(directoryRequest);
        if (!result || !Array.isArray(result.handles) || result.handles.length > directoryRequest.pageSize ||
            result.handles.some((entry) => typeof entry?.canonicalTrainerName !== 'string' ||
              typeof entry?.normalizedTrainerName !== 'string') ||
            !(result.nextAfterNormalized === null || typeof result.nextAfterNormalized === 'string')) fail('INTERNAL_ERROR');
        let previous = directoryRequest.afterNormalized;
        for (const entry of result.handles) {
          let canonical;
          try { canonical = normalizeHandle(entry.canonicalTrainerName); }
          catch { fail('INTERNAL_ERROR'); }
          if (canonical.normalized !== entry.normalizedTrainerName ||
              directoryRequest.normalizedQuery && !entry.normalizedTrainerName.startsWith(directoryRequest.normalizedQuery) ||
              previous && compareNormalizedHandles(entry.normalizedTrainerName, previous) <= 0) fail('INTERNAL_ERROR');
          previous = entry.normalizedTrainerName;
        }
        if (result.nextAfterNormalized !== null &&
            (!result.handles.length || result.nextAfterNormalized !== result.handles.at(-1).normalizedTrainerName)) {
          fail('INTERNAL_ERROR');
        }
        const handles = result.handles.map((entry) => entry.canonicalTrainerName);
        const nextCursor = directoryRequest.normalizedQuery
          ? encodeDirectoryCursor(configuration, directoryRequest.normalizedQuery, result.nextAfterNormalized)
          : null;
        log(configuration, 'listTrainerDirectory', 'success', startedAt, {
          uidHash: callerHash, resultCount: handles.length, hasNextPage: nextCursor !== null
        });
        return json(response, 200, { code: 'SUCCESS', directory: { version: 1, handles, nextCursor } });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'],
          METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'], 'e1/rate-limit-exceeded': [429, 'RATE_LIMITED'],
          'e1/directory-input-invalid': [400, 'REQUEST_INVALID'],
          'e1/directory-identity-conflict': [409, 'DIRECTORY_IDENTITY_CONFLICT']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'listTrainerDirectory', code.toLowerCase(), startedAt,
          callerHash ? { uidHash: callerHash } : {});
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/resolve-favorite-trainer-identity') {
      let callerHash;
      let handleHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.readProviderPublicShareEnabled) fail('E1_NOT_ENABLED');
        const favoriteRequest = exactFavoriteIdentityRequest(await parseBody(request));
        const firebaseIdToken = firebaseTokenHeader(request);
        const { uid } = await verifyToken(configuration, firebaseIdToken);
        callerHash = uidHash(configuration, uid);
        handleHash = handleCorrelationHash(configuration, favoriteRequest.handle.handleKey);
        await limitOperation('resolveFavoriteTrainerIdentity', callerHash,
          rateAttemptHash('resolveFavoriteTrainerIdentity', callerHash,
            [favoriteRequest.handle.handleKey, favoriteRequest.expectedTargetUid]));
        const identity = await readPublicIdentity({
          canonicalTrainerName: favoriteRequest.handle.display,
          normalizedTrainerName: favoriteRequest.handle.normalized,
          handleKey: favoriteRequest.handle.handleKey
        });
        if (!identity) {
          log(configuration, 'resolveFavoriteTrainerIdentity', 'not_found', startedAt,
            { uidHash: callerHash, handleHash });
          return json(response, 200, { code: 'TARGET_NOT_FOUND' });
        }
        if (favoriteRequest.expectedTargetUid && favoriteRequest.expectedTargetUid !== identity.ownerUid) {
          fail('FAVORITE_IDENTITY_CONFLICT');
        }
        log(configuration, 'resolveFavoriteTrainerIdentity', 'success', startedAt,
          { uidHash: callerHash, handleHash });
        return json(response, 200, { code: 'SUCCESS', favorite: {
          version: 1,
          targetUid: identity.ownerUid,
          canonicalTrainerName: identity.canonicalTrainerName
        } });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          REQUEST_INVALID: [400, 'REQUEST_INVALID'], REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'],
          METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'], FAVORITE_IDENTITY_CONFLICT: [409, 'FAVORITE_IDENTITY_CONFLICT'],
          'e1/public-identity-conflict': [409, 'FAVORITE_IDENTITY_CONFLICT'],
          'e1/rate-limit-exceeded': [429, 'RATE_LIMITED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'resolveFavoriteTrainerIdentity', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}), ...(handleHash ? { handleHash } : {})
        });
        return json(response, status, { code });
      }
    }
    if (url.pathname === '/v1/create-provider-account-foundation') {
      let callerHash;
      let handleHash;
      try {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
        if (!configuration.createProviderAccountEnabled) fail('E1_NOT_ENABLED');
        const providerRequest = exactProviderCreateRequest(await parseBody(request));
        const firebaseIdToken = firebaseTokenHeader(request);
        const verifiedToken = await verifyToken(configuration, firebaseIdToken);
        const uid = verifiedToken.uid;
        callerHash = uidHash(configuration, uid);
        handleHash = handleCorrelationHash(configuration, providerRequest.handle.handleKey);
        const provider = await verifyRecentProviderAuthentication(configuration, firebaseIdToken, verifiedToken, now());
        const baseInput = Object.freeze({
          uid,
          providerAccountProtocolVersion: providerRequest.providerAccountProtocolVersion,
          requestId: providerRequest.requestId,
          canonicalTrainerName: providerRequest.handle.display,
          normalizedTrainerName: providerRequest.handle.normalized,
          handleKey: providerRequest.handle.handleKey,
          lifecycleId: providerRequest.lifecycleId,
          clientRelease: providerRequest.clientRelease,
          ...provider
        });
        if (providerRequest.idempotencyFingerprint !== providerRequestFingerprint(baseInput)) fail('REQUEST_INVALID');
        const input = Object.freeze({ ...baseInput, fingerprint: providerOperationFingerprint(baseInput) });
        const replayOnly = await operationRequestExists({
          operation: 'createProviderAccountFoundation', uid, requestId: providerRequest.requestId
        });
        if (!replayOnly) {
          await limitOperation('createProviderAccountFoundation', callerHash,
            rateAttemptHash('createProviderAccountFoundation', callerHash,
              [providerRequest.requestId, providerRequest.handle.handleKey, provider.providerSubjectKey]));
        }
        let result;
        let reconciled = false;
        try {
          result = await createProviderAccount(input, { replayOnly });
        } catch (error) {
          const expected = new Set([
            'e1/replay-mismatch', 'e1/replay-not-found', 'e1/legacy-namespace-not-certified',
            'e1/account-conflict', 'e1/handle-conflict', 'e1/provider-foundation-conflict',
            'e1/provider-subject-conflict'
          ]);
          if (expected.has(error?.code)) throw error;
          result = await readProviderAccount(input);
          if (!result) throw error;
          reconciled = true;
        }
        const exactResultStatus = result?.status === 'created' || reconciled && result?.status === 'active';
        if (!exactResultStatus || result.handleKey !== input.handleKey ||
            result.canonicalTrainerName !== input.canonicalTrainerName || result.identityKind !== 'provider_only') {
          fail('INTERNAL_ERROR');
        }
        const code = result.replay === true ? 'IDEMPOTENT' : reconciled ? 'RECONCILED' : 'SUCCESS';
        log(configuration, 'createProviderAccountFoundation', code.toLowerCase(), startedAt, {
          uidHash: callerHash,
          handleHash,
          provider: 'google',
          replayClass: result.replay === true ? 'exact-replay' : reconciled ? 'exact-readback' : 'first-write'
        });
        return json(response, 200, {
          code,
          foundation: {
            schemaVersion: 1,
            canonicalTrainerName: result.canonicalTrainerName,
            normalizedTrainerName: result.normalizedTrainerName,
            handleKey: result.handleKey,
            legacyUsername: null,
            identityKind: 'provider_only',
            legacyAccessConfigured: false,
            status: 'active',
            revision: result.revision || 1
          }
        });
      } catch (error) {
        const mapping = {
          E1_NOT_ENABLED: [503, 'E1_NOT_ENABLED'], AUTH_REQUIRED: [401, 'AUTH_REQUIRED'], AUTH_INVALID: [401, 'AUTH_INVALID'],
          PROVIDER_IDENTITY_REQUIRED: [403, 'PROVIDER_IDENTITY_REQUIRED'],
          RECENT_PROVIDER_AUTH_REQUIRED: [403, 'RECENT_PROVIDER_AUTH_REQUIRED'], REQUEST_INVALID: [400, 'REQUEST_INVALID'],
          REQUEST_TOO_LARGE: [413, 'REQUEST_INVALID'], METHOD_NOT_ALLOWED: [405, 'METHOD_NOT_ALLOWED'],
          'e1/legacy-namespace-not-certified': [412, 'NAMESPACE_NOT_CERTIFIED'],
          'e1/account-conflict': [409, 'ACCOUNT_EXISTS'], 'e1/handle-conflict': [409, 'HANDLE_CONFLICT'],
          'e1/provider-foundation-conflict': [409, 'FOUNDATION_CONFLICT'],
          'e1/provider-subject-conflict': [409, 'PROVIDER_CONFLICT'],
          'e1/replay-mismatch': [409, 'REQUEST_INVALID'], 'e1/replay-not-found': [409, 'REQUEST_INVALID'],
          'e1/rate-limit-exceeded': [429, 'RATE_LIMITED']
        };
        const [status, code] = mapping[error?.code] || [500, 'INTERNAL_ERROR'];
        log(configuration, 'createProviderAccountFoundation', code.toLowerCase(), startedAt, {
          ...(callerHash ? { uidHash: callerHash } : {}),
          ...(handleHash ? { handleHash } : {})
        });
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
        const replayOnly = await operationRequestExists({ operation: 'reserveTrainerHandle', uid, requestId });
        if (!replayOnly) {
          await limitOperation('reserveTrainerHandle', callerHash,
            rateAttemptHash('reserveTrainerHandle', callerHash, [requestId, handle.handleKey]));
        }
        const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
        const foundation = verifiedLegacyFoundation(uid, handle, legacy);
        const input = Object.freeze({ uid, requestId, ...foundation });
        const result = await reserveHandle(Object.freeze({ ...input, fingerprint: reserveFingerprint(input) }), { replayOnly });
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
        const replayOnly = await operationRequestExists({ operation: 'repairAccountFoundation', uid,
          requestId: reviewed.operationId });
        if (!replayOnly) {
          await limitOperation('repairAccountFoundation', callerHash,
            rateAttemptHash('repairAccountFoundation', callerHash, [reviewed.operationId, reviewed.manifestFingerprint]));
        }
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
        const result = await repairFoundation(input, { replayOnly });
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
        const replayOnly = await operationRequestExists({ operation: 'applyMigrationManifest', uid,
          requestId: manifest.operationId });
        if (!replayOnly) {
          await limitOperation('applyMigrationManifest', operatorHash,
            rateAttemptHash('applyMigrationManifest', operatorHash, [manifest.operationId, manifest.manifestFingerprint]));
        }
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
        const result = await applyManifest(input, { replayOnly });
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
        const replayOnly = await operationRequestExists({ operation: 'freezeIdentityConflict', uid,
          requestId: reviewed.operationId });
        if (!replayOnly) {
          await limitOperation('freezeIdentityConflict', operatorHash,
            rateAttemptHash('freezeIdentityConflict', operatorHash, [reviewed.operationId, reviewed.manifestFingerprint]));
        }
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
        const result = await freezeConflict(input, { replayOnly });
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
  PROVIDER_ACCOUNT_PROTOCOL_VERSION,
  RATE_LIMITS,
  SUPPORTED_PROVIDER_ACCOUNT_PROTOCOL_VERSIONS,
  assertRuntimeDependencies,
  createHandler,
  conflictManifestFingerprint,
  loadConfiguration,
  migrationManifestFingerprint,
  observedLegacyFingerprint,
  providerOperationFingerprint,
  decodeDirectoryCursor,
  encodeDirectoryCursor,
  exactFavoriteIdentityRequest,
  exactTrainerDirectoryRequest,
  exactProviderPublicShareRequest,
  providerRequestFingerprint,
  providerSubjectHash,
  readAccountDocument,
  proofAttemptHash,
  groupEAttemptHash,
  groupECohortBindingHash,
  groupEResponseBinding,
  repairReviewFingerprint,
  reserveFingerprint,
  redactFoundationDocument,
  runtimeProbe,
  sourceMappingFingerprint,
  start,
  verifiedLegacyFoundation,
  linkedGoogleProviderIdentity,
  recentGoogleProviderIdentity,
  verifyCurrentLinkedGoogleProviderIdentity,
  verifyRecentGoogleProviderAuthentication,
  verifyFirebaseIdToken,
  verifyOperatorAccessToken
});
