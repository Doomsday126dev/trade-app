'use strict';

const crypto = require('node:crypto');

const AUTHORITY_PATHS = Object.freeze({
  readAccountFoundation: '/v1/read-account-foundation',
  reserveTrainerHandle: '/v1/reserve-trainer-handle'
});
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PROOF_ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 4096;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
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
    readProofMode: env.READ_PROOF_MODE === 'true'
  };
  let authority;
  try { authority = new URL(configuration.authorityUrl); } catch { fail('GATEWAY_CONFIGURATION_INVALID'); }
  if (!['staging', 'production', 'emulator'].includes(configuration.environment) ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(configuration.projectId || '') ||
      !['us-central1', 'local'].includes(configuration.region) || authority.protocol !== 'https:' ||
      authority.pathname !== '/' || authority.search || authority.hash ||
      configuration.authorityAudience !== authority.origin || configuration.rateLimitPolicy !== 'firestore-rolling-v1' ||
      !['monitor', 'enforced'].includes(configuration.appCheckEnforcementMode) ||
      !['true', 'false'].includes(env.GATEWAY_INVOCATION_ENABLED) || !['true', 'false'].includes(env.APP_CHECK_DEBUG_TOKENS_ALLOWED) ||
      !['true', 'false'].includes(env.READ_PROOF_MODE) || (configuration.readProofMode && !configuration.gatewayEnabled)) {
    fail('GATEWAY_CONFIGURATION_INVALID');
  }
  if (configuration.environment === 'production' &&
      (configuration.projectId !== 'trade-list-a4297' || configuration.region !== 'us-central1' ||
       configuration.gatewayServiceAccount !== 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com' ||
       configuration.appCheckEnforcementMode !== 'monitor' || configuration.debugTokensAllowed || authority.hostname.includes('staging'))) {
    fail('GATEWAY_CONFIGURATION_INVALID');
  }
  if (configuration.environment === 'staging' &&
      (configuration.projectId !== 'trainer-hub-staging-37ib4wct' || !authority.hostname.includes('staging'))) fail('GATEWAY_CONFIGURATION_INVALID');
  return Object.freeze(configuration);
}

function proofAttemptHash(proofAttemptId) {
  return crypto.createHash('sha256').update(JSON.stringify([1, 'group-c-proof-attempt', proofAttemptId]), 'utf8')
    .digest('hex').slice(0, 16);
}

function exactRequest(operation, value, readProofMode = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_REQUEST_BYTES) {
    fail('REQUEST_INVALID');
  }
  const fields = operation === 'readAccountFoundation'
    ? (readProofMode ? ['proofAttemptId', 'schemaVersion'] : ['schemaVersion'])
    : ['requestId', 'requestedHandle', 'schemaVersion'];
  const actual = Object.keys(value).sort();
  if (actual.length !== fields.length || actual.some((field, index) => field !== [...fields].sort()[index]) || value.schemaVersion !== 1) {
    fail('REQUEST_INVALID');
  }
  if (operation === 'reserveTrainerHandle' && (!REQUEST_ID.test(value.requestId || '') ||
      typeof value.requestedHandle !== 'string' || !value.requestedHandle || value.requestedHandle.length > 128)) fail('REQUEST_INVALID');
  if (operation === 'readAccountFoundation' && readProofMode && !PROOF_ATTEMPT_ID.test(value.proofAttemptId || '')) fail('REQUEST_INVALID');
  return Object.freeze({ ...value });
}

function firebaseIdToken(request) {
  const header = request.rawRequest?.headers?.authorization;
  const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/u.exec(header) : null;
  if (!match || Buffer.byteLength(match[1]) > 8192) fail('AUTH_REQUIRED');
  return match[1];
}

function verifyCallableBoundary(operation, request, readProofMode = false) {
  if (!request.auth?.uid) fail('AUTH_REQUIRED');
  if (!request.app?.appId) fail('APP_CHECK_REQUIRED');
  if (operation === 'reserveTrainerHandle' && request.app.alreadyConsumed === true) fail('APP_CHECK_REPLAYED');
  return Object.freeze({
    uid: request.auth.uid,
    firebaseIdToken: firebaseIdToken(request),
    body: exactRequest(operation, request.data, readProofMode),
    proofAttemptHash: operation === 'readAccountFoundation' && readProofMode
      ? proofAttemptHash(request.data.proofAttemptId)
      : null
  });
}

function createAuthorityInvoker(configuration, { fetchImpl = fetch, getOidcToken } = {}) {
  if (typeof fetchImpl !== 'function' || typeof getOidcToken !== 'function') throw new TypeError('Gateway OIDC dependencies required');
  return async function invokeAuthority(operation, boundary) {
    const oidcToken = await getOidcToken(configuration.authorityAudience);
    if (typeof oidcToken !== 'string' || !oidcToken) fail('AUTHORITY_OIDC_UNAVAILABLE');
    const response = await fetchImpl(new URL(AUTHORITY_PATHS[operation], configuration.authorityUrl), {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Serverless-Authorization': `Bearer ${oidcToken}`,
        'X-Firebase-ID-Token': boundary.firebaseIdToken,
        'X-E1-Rate-Limit-Policy': configuration.rateLimitPolicy
      },
      body: JSON.stringify(boundary.body)
    });
    let payload;
    try { payload = await response.json(); } catch { fail('AUTHORITY_RESPONSE_INVALID'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.code !== 'string') fail('AUTHORITY_RESPONSE_INVALID');
    return Object.freeze({ status: response.status, payload: Object.freeze(payload) });
  };
}

function createGatewayOperation(operation, configuration, dependencies) {
  if (!Object.hasOwn(AUTHORITY_PATHS, operation)) throw new TypeError('Unknown E.1 gateway operation');
  const invokeAuthority = dependencies.invokeAuthority || createAuthorityInvoker(configuration, dependencies);
  const log = dependencies.structuredLog || ((entry) => console.log(JSON.stringify(entry)));
  return async function gatewayOperation(request) {
    if (!configuration.gatewayEnabled) fail('GATEWAY_NOT_ENABLED');
    const boundary = verifyCallableBoundary(operation, request, configuration.readProofMode);
    if (boundary.proofAttemptHash) {
      log({ schemaVersion: 1, operation, outcome: 'proof_attempt', proofAttemptHash: boundary.proofAttemptHash });
    }
    const result = await invokeAuthority(operation, boundary);
    if (result.status === 429 || result.payload.code === 'RATE_LIMITED') fail('RATE_LIMITED');
    if (result.status >= 500) fail('AUTHORITY_UNAVAILABLE');
    if (result.status >= 400) {
      const error = new Error(result.payload.code);
      error.code = result.payload.code;
      throw error;
    }
    return result.payload;
  };
}

module.exports = Object.freeze({
  AUTHORITY_PATHS,
  createAuthorityInvoker,
  createGatewayOperation,
  exactRequest,
  loadGatewayConfiguration,
  proofAttemptHash,
  verifyCallableBoundary
});
