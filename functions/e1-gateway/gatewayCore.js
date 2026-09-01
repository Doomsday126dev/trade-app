'use strict';

const crypto = require('node:crypto');
const {
  HASH,
  MODE: GROUP_E_MODE,
  PROJECT_ID: GROUP_E_PROJECT_ID,
  UUID_V4,
  appIdHash,
  attemptHash,
  exactFields,
  keyIdFromSpki,
  responseBinding,
  subjectHash,
  validateSignedRequest,
  verifyCapabilitySignature
} = require('./groupEAdmission');
const { DATABASE_ID: GROUP_E_DATABASE_ID } = require('./groupEControlStore');

const AUTHORITY_PATHS = Object.freeze({
  readAccountFoundation: '/v1/read-account-foundation',
  readProviderPublicShare: '/v1/read-provider-public-share',
  createProviderAccountFoundation: '/v1/create-provider-account-foundation',
  reserveTrainerHandle: '/v1/reserve-trainer-handle'
});
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const PROOF_ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 8192;
const GROUP_E_ENV_FIELDS = Object.freeze([
  'GROUP_E_SUBJECT_BINDINGS',
  'GROUP_E_COHORT_DIGEST',
  'GROUP_E_RUN_ID',
  'GROUP_E_RUN_MANIFEST_DIGEST',
  'GROUP_E_KEY_ID',
  'GROUP_E_PUBLIC_KEY_SPKI',
  'GROUP_E_FIREBASE_APP_ID_HASH',
  'GROUP_E_CONTROL_DATABASE_ID',
  'GROUP_E_WINDOW_START',
  'GROUP_E_WINDOW_END'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseGroupEBindings(value) {
  const entries = typeof value === 'string' && value ? value.split(';') : [];
  if (entries.length !== 2) fail('GROUP_E_CONFIGURATION_INVALID');
  const bindings = {};
  entries.forEach((entry, index) => {
    const [uidHash, trainerHash, extra] = entry.split(':');
    if (extra !== undefined || !HASH.test(uidHash || '') || !HASH.test(trainerHash || '')) {
      fail('GROUP_E_CONFIGURATION_INVALID');
    }
    bindings[index === 0 ? 'A' : 'B'] = Object.freeze({ uidHash, trainerHash });
  });
  if (bindings.A.uidHash === bindings.B.uidHash || bindings.A.trainerHash === bindings.B.trainerHash) {
    fail('GROUP_E_CONFIGURATION_INVALID');
  }
  return Object.freeze(bindings);
}

function groupEConfiguration(env, configuration) {
  const mode = env.GROUP_E_CLIENT_MODE || 'disabled';
  const supplied = GROUP_E_ENV_FIELDS.map((field) => env[field]);
  if (mode === 'disabled') {
    if (supplied.some((value) => value !== undefined && value !== '')) fail('GROUP_E_CONFIGURATION_INVALID');
    return Object.freeze({ enabled: false, mode, bindings: Object.freeze({}), cohortDigest: null,
      runId: null, runManifestDigest: null, keyId: null, publicKeySpki: null,
      firebaseAppIdHash: null, controlDatabaseId: null });
  }
  if (mode !== GROUP_E_MODE || configuration.environment !== 'production' ||
      configuration.projectId !== GROUP_E_PROJECT_ID || !configuration.gatewayEnabled || configuration.readProofMode ||
      configuration.providerPublicProjectionEnabled ||
      !HASH.test(env.GROUP_E_COHORT_DIGEST || '') || !UUID_V4.test(env.GROUP_E_RUN_ID || '') ||
      !HASH.test(env.GROUP_E_RUN_MANIFEST_DIGEST || '') || !HASH.test(env.GROUP_E_KEY_ID || '') ||
      !HASH.test(env.GROUP_E_FIREBASE_APP_ID_HASH || '') || env.GROUP_E_CONTROL_DATABASE_ID !== GROUP_E_DATABASE_ID ||
      env.GROUP_E_WINDOW_START || env.GROUP_E_WINDOW_END ||
      keyIdFromSpki(env.GROUP_E_PUBLIC_KEY_SPKI) !== env.GROUP_E_KEY_ID) {
    fail('GROUP_E_CONFIGURATION_INVALID');
  }
  return Object.freeze({
    enabled: true,
    mode,
    bindings: parseGroupEBindings(env.GROUP_E_SUBJECT_BINDINGS),
    cohortDigest: env.GROUP_E_COHORT_DIGEST,
    runId: env.GROUP_E_RUN_ID,
    runManifestDigest: env.GROUP_E_RUN_MANIFEST_DIGEST,
    keyId: env.GROUP_E_KEY_ID,
    publicKeySpki: env.GROUP_E_PUBLIC_KEY_SPKI,
    firebaseAppIdHash: env.GROUP_E_FIREBASE_APP_ID_HASH,
    controlDatabaseId: env.GROUP_E_CONTROL_DATABASE_ID
  });
}

function loadGatewayConfiguration(env = process.env) {
  const configuration = {
    environment: env.APP_ENVIRONMENT,
    projectId: env.FIREBASE_PROJECT_ID,
    region: env.SERVICE_REGION,
    authorityUrl: env.E1_AUTHORITY_URL,
    authorityAudience: env.E1_AUTHORITY_AUDIENCE,
    gatewayServiceAccount: env.E1_GATEWAY_SERVICE_ACCOUNT,
    gatewayEnabled: env.GATEWAY_INVOCATION_ENABLED === 'true',
    appCheckEnforcementMode: env.APP_CHECK_ENFORCEMENT_MODE,
    debugTokensAllowed: env.APP_CHECK_DEBUG_TOKENS_ALLOWED === 'true',
    rateLimitPolicy: env.E1_RATE_LIMIT_POLICY,
    readProofMode: env.READ_PROOF_MODE === 'true',
    providerPublicProjectionEnabled: env.PROVIDER_PUBLIC_PROJECTION_ENABLED === 'true'
  };
  let authority;
  try { authority = new URL(configuration.authorityUrl); } catch { fail('GATEWAY_CONFIGURATION_INVALID'); }
  if (!['staging', 'production', 'emulator'].includes(configuration.environment) ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(configuration.projectId || '') ||
      !['us-central1', 'local'].includes(configuration.region) || authority.protocol !== 'https:' ||
      authority.pathname !== '/' || authority.search || authority.hash ||
      configuration.authorityAudience !== authority.origin || configuration.rateLimitPolicy !== 'firestore-rolling-v1' ||
      !['monitor', 'enforced'].includes(configuration.appCheckEnforcementMode) ||
      !['true', 'false'].includes(env.GATEWAY_INVOCATION_ENABLED) ||
      !['true', 'false'].includes(env.APP_CHECK_DEBUG_TOKENS_ALLOWED) ||
      !['true', 'false'].includes(env.READ_PROOF_MODE) ||
      (env.PROVIDER_PUBLIC_PROJECTION_ENABLED !== undefined &&
        !['true', 'false'].includes(env.PROVIDER_PUBLIC_PROJECTION_ENABLED)) ||
      (configuration.readProofMode && (!configuration.gatewayEnabled || configuration.providerPublicProjectionEnabled))) {
    fail('GATEWAY_CONFIGURATION_INVALID');
  }
  if (configuration.environment === 'production' &&
      (configuration.projectId !== GROUP_E_PROJECT_ID || configuration.region !== 'us-central1' ||
       configuration.gatewayServiceAccount !== 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com' ||
       configuration.appCheckEnforcementMode !== 'monitor' || configuration.debugTokensAllowed ||
       authority.hostname.includes('staging'))) fail('GATEWAY_CONFIGURATION_INVALID');
  if (configuration.environment === 'staging' &&
      (configuration.projectId !== 'trainer-hub-staging-37ib4wct' || !authority.hostname.includes('staging'))) {
    fail('GATEWAY_CONFIGURATION_INVALID');
  }
  return Object.freeze({ ...configuration, groupE: groupEConfiguration(env, configuration) });
}

function proofAttemptHash(proofAttemptId) {
  return crypto.createHash('sha256').update(JSON.stringify([1, 'group-c-proof-attempt', proofAttemptId]), 'utf8')
    .digest('hex').slice(0, 16);
}

function exactRequest(operation, value, readProofMode = false, groupEMode = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Buffer.byteLength(JSON.stringify(value)) > MAX_REQUEST_BYTES) fail('REQUEST_INVALID');
  if (operation === 'readAccountFoundation' && groupEMode) return validateSignedRequest(value);
  const fields = operation === 'readAccountFoundation'
    ? (readProofMode ? ['proofAttemptId', 'schemaVersion'] : ['schemaVersion'])
    : operation === 'readProviderPublicShare'
      ? ['schemaVersion', 'trainerHandle']
    : operation === 'createProviderAccountFoundation'
      ? ['clientRelease', 'idempotencyFingerprint', 'lifecycleId', 'providerAccountProtocolVersion', 'requestId',
        'requestedHandle', 'schemaVersion']
      : ['requestId', 'requestedHandle', 'schemaVersion'];
  if (!exactFields(value, fields) || value.schemaVersion !== 1) fail('REQUEST_INVALID');
  if (operation === 'readProviderPublicShare' &&
      (typeof value.trainerHandle !== 'string' || !value.trainerHandle || value.trainerHandle.length > 128)) {
    fail('REQUEST_INVALID');
  }
  if (operation === 'reserveTrainerHandle' && (!REQUEST_ID.test(value.requestId || '') ||
      typeof value.requestedHandle !== 'string' || !value.requestedHandle || value.requestedHandle.length > 128)) {
    fail('REQUEST_INVALID');
  }
  if (operation === 'createProviderAccountFoundation' && (!REQUEST_ID.test(value.requestId || '') ||
      value.providerAccountProtocolVersion !== 1 ||
      typeof value.requestedHandle !== 'string' || !value.requestedHandle || value.requestedHandle.length > 128 ||
      !/^auth-[1-9][0-9]{0,9}$/u.test(value.lifecycleId || '') ||
      !/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(value.clientRelease || '') || !HASH.test(value.idempotencyFingerprint || ''))) {
    fail('REQUEST_INVALID');
  }
  if (operation === 'readAccountFoundation' && readProofMode && !PROOF_ATTEMPT_ID.test(value.proofAttemptId || '')) {
    fail('REQUEST_INVALID');
  }
  return Object.freeze({ ...value });
}

function firebaseIdToken(request) {
  const header = request.rawRequest?.headers?.authorization;
  const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/u.exec(header) : null;
  if (!match || Buffer.byteLength(match[1]) > 8192) fail('AUTH_REQUIRED');
  return match[1];
}

function validateGroupEBoundary(request, body, groupE, now) {
  const capability = verifyCapabilitySignature(body.capability, body.signature, groupE.publicKeySpki);
  const uidHash = subjectHash('uid', request.auth.uid);
  const appHash = appIdHash(request.app.appId);
  const slot = capability.slot;
  const binding = groupE.bindings[slot];
  if (!binding || capability.runId !== groupE.runId || capability.runManifestDigest !== groupE.runManifestDigest ||
      capability.keyId !== groupE.keyId || capability.cohortDigest !== groupE.cohortDigest ||
      capability.uidHash !== uidHash || capability.uidHash !== binding.uidHash ||
      capability.trainerHash !== binding.trainerHash || capability.firebaseAppIdHash !== appHash ||
      capability.firebaseAppIdHash !== groupE.firebaseAppIdHash) fail('GROUP_E_BOUNDARY_INVALID');
  const issued = Date.parse(capability.issuedAt);
  const expires = Date.parse(capability.expiresAt);
  if (!Number.isFinite(now) || now < issued || now >= expires) fail('GROUP_E_CAPABILITY_EXPIRED');
  return Object.freeze({ capability, slot, uidHash, appIdHash: appHash });
}

function verifyCallableBoundary(operation, request, readProofMode = false, groupE = { enabled: false }, now = Date.now()) {
  const publicRead = operation === 'readProviderPublicShare';
  if (!publicRead && !request.auth?.uid) fail('AUTH_REQUIRED');
  if (!request.app?.appId) fail('APP_CHECK_REQUIRED');
  if ((publicRead || operation === 'reserveTrainerHandle' || operation === 'createProviderAccountFoundation' ||
      operation === 'readAccountFoundation' && groupE.enabled) &&
      request.app.alreadyConsumed === true) fail('APP_CHECK_REPLAYED');
  const body = exactRequest(operation, request.data, readProofMode, groupE.enabled);
  const admission = operation === 'readAccountFoundation' && groupE.enabled
    ? validateGroupEBoundary(request, body, groupE, now)
    : null;
  return Object.freeze({
    uid: publicRead ? null : request.auth.uid,
    appId: request.app.appId,
    firebaseIdToken: publicRead ? null : firebaseIdToken(request),
    body,
    proofAttemptHash: operation === 'readAccountFoundation' && readProofMode
      ? proofAttemptHash(request.data.proofAttemptId)
      : null,
    groupE: admission
  });
}

function createAuthorityInvoker(configuration, { fetchImpl = fetch, getOidcToken } = {}) {
  if (typeof fetchImpl !== 'function' || typeof getOidcToken !== 'function') {
    throw new TypeError('Gateway OIDC dependencies required');
  }
  return async function invokeAuthority(operation, boundary) {
    const oidcToken = await getOidcToken(configuration.authorityAudience);
    if (typeof oidcToken !== 'string' || !oidcToken) fail('AUTHORITY_OIDC_UNAVAILABLE');
    const receipt = boundary.groupE?.receipt;
    const response = await fetchImpl(new URL(AUTHORITY_PATHS[operation], configuration.authorityUrl), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-Serverless-Authorization': `Bearer ${oidcToken}`,
        ...(boundary.firebaseIdToken ? { 'X-Firebase-ID-Token': boundary.firebaseIdToken } : {}),
        'X-E1-Rate-Limit-Policy': configuration.rateLimitPolicy,
        ...(receipt ? {
          'X-E1-Client-Mode': GROUP_E_MODE,
          'X-E1-Cohort-Digest': receipt.cohortDigest,
          'X-E1-Run-Id': receipt.runId,
          'X-E1-Key-Id': receipt.keyId,
          'X-E1-Admission-Receipt-Digest': receipt.receiptDigest
        } : {})
      },
      body: JSON.stringify(boundary.authorityBody || boundary.body)
    });
    let payload;
    try { payload = await response.json(); } catch { fail('AUTHORITY_RESPONSE_INVALID'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.code !== 'string') {
      fail('AUTHORITY_RESPONSE_INVALID');
    }
    return Object.freeze({ status: response.status, payload: Object.freeze(payload) });
  };
}

function createGatewayOperation(operation, configuration, dependencies = {}) {
  if (!Object.hasOwn(AUTHORITY_PATHS, operation)) throw new TypeError('Unknown E.1 gateway operation');
  const invokeAuthority = dependencies.invokeAuthority || createAuthorityInvoker(configuration, dependencies);
  const log = dependencies.structuredLog || ((entry) => console.log(JSON.stringify(entry)));
  const now = dependencies.now || Date.now;
  const controlStore = dependencies.controlStore;
  if (configuration.groupE.enabled && operation === 'readAccountFoundation' &&
      (!controlStore || typeof controlStore.consumeAdmission !== 'function' ||
      Object.keys(controlStore).some((key) => key !== 'consumeAdmission'))) {
    throw new TypeError('Narrow Group E control-store adapter required');
  }
  return async function gatewayOperation(request) {
    if (!configuration.gatewayEnabled) fail('GATEWAY_NOT_ENABLED');
    if (operation === 'readProviderPublicShare' && !configuration.providerPublicProjectionEnabled) {
      fail('GATEWAY_NOT_ENABLED');
    }
    if (configuration.groupE.enabled && operation !== 'readAccountFoundation') fail('GROUP_E_OPERATION_DENIED');
    const at = now();
    const boundary = verifyCallableBoundary(operation, request, configuration.readProofMode, configuration.groupE, at);
    if (boundary.proofAttemptHash) {
      log({ schemaVersion: 1, operation, outcome: 'proof_attempt', proofAttemptHash: boundary.proofAttemptHash });
    }
    let authorityBoundary = boundary;
    if (boundary.groupE) {
      const consumedAt = new Date(at).toISOString();
      const accepted = await controlStore.consumeAdmission({
        capability: boundary.groupE.capability,
        uid: boundary.uid,
        appId: boundary.appId,
        consumedAt,
        expectedRunManifestDigest: configuration.groupE.runManifestDigest
      });
      const receipt = accepted.receipt;
      log({ schemaVersion: 1, operation, outcome: 'group_e_admitted', canarySlot: receipt.slot,
        attemptHash: receipt.attemptHash.slice(0, 16), admissionReceiptDigest: receipt.receiptDigest,
        runIdHash: crypto.createHash('sha256').update(receipt.runId, 'utf8').digest('hex').slice(0, 16) });
      authorityBoundary = Object.freeze({
        ...boundary,
        authorityBody: Object.freeze({ schemaVersion: 1, attemptId: boundary.body.attemptId,
          admissionReceipt: receipt }),
        groupE: Object.freeze({ ...boundary.groupE, receipt })
      });
    }
    const result = await invokeAuthority(operation, authorityBoundary);
    if (result.status === 429 || result.payload.code === 'RATE_LIMITED') fail('RATE_LIMITED');
    if (result.status >= 500) fail('AUTHORITY_UNAVAILABLE');
    if (result.status >= 400 && !(boundary.groupE && result.status === 423 && result.payload.code === 'ACCOUNT_FROZEN')) {
      const error = new Error(result.payload.code);
      error.code = result.payload.code;
      throw error;
    }
    if (boundary.groupE) {
      const receipt = authorityBoundary.groupE.receipt;
      const expectedAttempt = receipt.attemptHash.slice(0, 16);
      const expectedSubject = responseBinding(boundary.uid, boundary.body.attemptId, receipt.receiptDigest);
      if (result.payload.schemaVersion !== 1 || result.payload.attemptHash !== expectedAttempt ||
          result.payload.admissionReceiptDigest !== receipt.receiptDigest ||
          result.payload.subjectBinding !== expectedSubject) fail('AUTHORITY_RESPONSE_INVALID');
    }
    return operation === 'readProviderPublicShare'
      ? validateProviderPublicShareResponse(result.payload, boundary.body.trainerHandle)
      : result.payload;
  };
}

const PUBLIC_LIST_TYPES = Object.freeze(['wishlist', 'dynamax', 'gmax', 'costumes']);
const PUBLIC_PROFILE_FIELDS = Object.freeze(['avatarPokemon', 'bio', 'discord', 'friendCode', 'lastUpdated']);
const PUBLIC_ENTRY_FIELDS = Object.freeze(['backgroundId', 'lucky', 'mod', 'p', 'shiny', 'xxl', 'xxs']);
const PUBLIC_PRIORITIES = new Set(['H', 'M', 'L']);
const PUBLIC_BACKGROUND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PUBLIC_CONTROL = /[\u0000-\u001f\u007f]/u;
const PUBLIC_DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function publicString(value, max, { empty = true } = {}) {
  return typeof value === 'string' && !PUBLIC_CONTROL.test(value) && value.length <= max && (empty || value.length > 0);
}

function publicDynamicKey(value, max) {
  return publicString(value, max, { empty: false }) && !PUBLIC_DANGEROUS_KEYS.has(value);
}

function optionalPublicFields(value, fields) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => fields.includes(key));
}

function publicEntry(value) {
  if (typeof value === 'string') return publicString(value, 512, { empty: false });
  if (!optionalPublicFields(value, PUBLIC_ENTRY_FIELDS) || !PUBLIC_PRIORITIES.has(value.p)) return false;
  if (Object.hasOwn(value, 'mod') && !publicString(value.mod, 200)) return false;
  for (const field of ['lucky', 'shiny', 'xxl', 'xxs']) {
    if (Object.hasOwn(value, field) && typeof value[field] !== 'boolean') return false;
  }
  return !Object.hasOwn(value, 'backgroundId') || value.backgroundId === '' ||
    publicString(value.backgroundId, 120, { empty: false }) && PUBLIC_BACKGROUND_ID.test(value.backgroundId);
}

function foldedPublicHandle(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function validateProviderPublicShareResponse(payload, expectedTrainerHandle = '') {
  if (exactFields(payload, ['code']) && payload.code === 'SHARE_NOT_FOUND') return Object.freeze({ code: payload.code });
  if (!exactFields(payload, ['code', 'share']) || payload.code !== 'SUCCESS' ||
      Buffer.byteLength(JSON.stringify(payload)) > 512 * 1024) {
    fail('AUTHORITY_RESPONSE_INVALID');
  }
  const share = payload.share;
  if (!exactFields(share, ['lists', 'profile', 'publishedListTypes', 'updatedAt', 'username', 'version']) ||
      share.version !== 1 || !publicString(share.username, 64, { empty: false }) ||
      foldedPublicHandle(share.username) !== foldedPublicHandle(expectedTrainerHandle) ||
      !Number.isSafeInteger(share.updatedAt) || share.updatedAt < 1 ||
      !exactFields(share.profile, PUBLIC_PROFILE_FIELDS) || !exactFields(share.lists, PUBLIC_LIST_TYPES) ||
      !Array.isArray(share.publishedListTypes) || share.publishedListTypes.length !== PUBLIC_LIST_TYPES.length ||
      !PUBLIC_LIST_TYPES.every((type, index) => share.publishedListTypes[index] === type &&
        share.lists[type] && typeof share.lists[type] === 'object' && !Array.isArray(share.lists[type]))) {
    fail('AUTHORITY_RESPONSE_INVALID');
  }
  const profile = share.profile;
  if (!publicString(profile.friendCode, 32) || !publicString(profile.bio, 120) ||
      !publicString(profile.discord, 40) || !publicString(profile.avatarPokemon, 80) ||
      !Number.isSafeInteger(profile.lastUpdated) || profile.lastUpdated < 0) fail('AUTHORITY_RESPONSE_INVALID');
  let entryCount = 0;
  const lists = Object.create(null);
  for (const type of PUBLIC_LIST_TYPES) {
    lists[type] = Object.create(null);
    for (const [name, entry] of Object.entries(share.lists[type])) {
      entryCount += 1;
      if (entryCount > 2000 || !publicDynamicKey(name, 200) || !publicEntry(entry)) {
        fail('AUTHORITY_RESPONSE_INVALID');
      }
      lists[type][name] = entry && typeof entry === 'object' ? Object.freeze({ ...entry }) : entry;
    }
    Object.freeze(lists[type]);
  }
  const sanitized = Object.freeze({
    version: 1,
    username: share.username,
    profile: Object.freeze({ ...profile }),
    lists: Object.freeze(lists),
    publishedListTypes: Object.freeze([...PUBLIC_LIST_TYPES]),
    updatedAt: share.updatedAt
  });
  return Object.freeze({ code: 'SUCCESS', share: sanitized });
}

function groupEAttemptHash(attemptId) {
  return attemptHash(attemptId).slice(0, 16);
}

module.exports = Object.freeze({
  AUTHORITY_PATHS,
  GROUP_E_ENV_FIELDS,
  createAuthorityInvoker,
  createGatewayOperation,
  exactRequest,
  groupEAttemptHash,
  groupEResponseBinding: responseBinding,
  groupESubjectHash: subjectHash,
  loadGatewayConfiguration,
  parseGroupEBindings,
  proofAttemptHash,
  validateGroupEBoundary,
  validateProviderPublicShareResponse,
  verifyCallableBoundary
});
