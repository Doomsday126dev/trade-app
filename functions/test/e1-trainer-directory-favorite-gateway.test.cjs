'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTHORITY_PATHS,
  createGatewayOperation,
  loadGatewayConfiguration,
  validateFavoriteIdentityResponse,
  validateTrainerDirectoryResponse,
  verifyCallableBoundary
} = require('../e1-gateway/gatewayCore');

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'trade-list-a4297',
    SERVICE_REGION: 'us-central1',
    E1_AUTHORITY_URL: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/',
    E1_AUTHORITY_AUDIENCE: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    E1_GATEWAY_SERVICE_ACCOUNT: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    GATEWAY_INVOCATION_ENABLED: 'true',
    PROVIDER_PUBLIC_PROJECTION_ENABLED: 'true',
    APP_CHECK_ENFORCEMENT_MODE: 'monitor',
    APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false',
    E1_RATE_LIMIT_POLICY: 'firestore-rolling-v1',
    READ_PROOF_MODE: 'false',
    ...overrides
  };
}

function request(data, overrides = {}) {
  return {
    auth: { uid: 'firebaseCallerUid123' },
    app: { appId: 'production-app-id', alreadyConsumed: false },
    data,
    rawRequest: { headers: { authorization: 'Bearer exact-browser-token' } },
    ...overrides
  };
}

test('directory and Favorite resolver are fixed authenticated App Check operations', () => {
  const directory = request({ schemaVersion: 1, query: 'pr', pageSize: 25, cursor: null });
  const favorite = request({ schemaVersion: 1, trainerHandle: 'ProviderTrainer', expectedTargetUid: '' });
  assert.equal(verifyCallableBoundary('listTrainerDirectory', directory).uid, 'firebaseCallerUid123');
  assert.equal(verifyCallableBoundary('resolveFavoriteTrainerIdentity', favorite).firebaseIdToken, 'exact-browser-token');
  for (const [operation, value] of [['listTrainerDirectory', directory], ['resolveFavoriteTrainerIdentity', favorite]]) {
    assert.throws(() => verifyCallableBoundary(operation, { ...value, auth: null }), /AUTH_REQUIRED/u);
    assert.throws(() => verifyCallableBoundary(operation, { ...value, app: null }), /APP_CHECK_REQUIRED/u);
    assert.throws(() => verifyCallableBoundary(operation, {
      ...value, app: { appId: 'production-app-id', alreadyConsumed: true }
    }), /APP_CHECK_REPLAYED/u);
    assert.throws(() => verifyCallableBoundary(operation, {
      ...value, data: { ...value.data, collection: 'accounts' }
    }), /REQUEST_INVALID/u);
  }
  assert.equal(AUTHORITY_PATHS.listTrainerDirectory, '/v1/list-trainer-directory');
  assert.equal(AUTHORITY_PATHS.resolveFavoriteTrainerIdentity, '/v1/resolve-favorite-trainer-identity');
});

test('gateway validates a bounded sorted UID-free directory response', async () => {
  const handler = createGatewayOperation('listTrainerDirectory', loadGatewayConfiguration(environment()), {
    invokeAuthority: async () => ({ status: 200, payload: {
      code: 'SUCCESS', directory: { version: 1, handles: ['Provider A', 'Provider B'], nextCursor: 'cursor-token' }
    } })
  });
  assert.deepEqual(await handler(request({ schemaVersion: 1, query: 'pr', pageSize: 25, cursor: null })), {
    code: 'SUCCESS', directory: { version: 1, handles: ['Provider A', 'Provider B'], nextCursor: 'cursor-token' }
  });
  assert.throws(() => validateTrainerDirectoryResponse({
    code: 'SUCCESS', directory: { version: 1, handles: ['Provider B', 'Provider A'], nextCursor: null }
  }, 25, 'provider'), /AUTHORITY_RESPONSE_INVALID/u);
  assert.throws(() => validateTrainerDirectoryResponse({
    code: 'SUCCESS', directory: { version: 1, handles: ['Unrelated Trainer'], nextCursor: null }
  }, 25, 'provider'), /AUTHORITY_RESPONSE_INVALID/u);
  assert.throws(() => validateTrainerDirectoryResponse({
    code: 'SUCCESS', directory: { version: 1, handles: ['Provider A'], nextCursor: null, uid: 'private' }
  }, 25), /AUTHORITY_RESPONSE_INVALID/u);
  assert.doesNotThrow(() => validateTrainerDirectoryResponse({
    code: 'SUCCESS', directory: { version: 1, handles: ['Zulu', 'Éclair'], nextCursor: null }
  }, 25));
});

test('gateway returns the minimal exact Favorite identity and fails malformed or conflicting results closed', async () => {
  const body = { schemaVersion: 1, trainerHandle: 'providertrainer', expectedTargetUid: '' };
  const handler = createGatewayOperation('resolveFavoriteTrainerIdentity', loadGatewayConfiguration(environment()), {
    invokeAuthority: async () => ({ status: 200, payload: { code: 'SUCCESS', favorite: {
      version: 1, targetUid: 'firebaseTargetUid456', canonicalTrainerName: 'ProviderTrainer'
    } } })
  });
  assert.deepEqual(await handler(request(body)), { code: 'SUCCESS', favorite: {
    version: 1, targetUid: 'firebaseTargetUid456', canonicalTrainerName: 'ProviderTrainer'
  } });
  assert.deepEqual(validateFavoriteIdentityResponse({ code: 'TARGET_NOT_FOUND' }, 'MissingTrainer', ''), {
    code: 'TARGET_NOT_FOUND'
  });
  assert.throws(() => validateFavoriteIdentityResponse({ code: 'SUCCESS', favorite: {
    version: 1, targetUid: 'firebaseTargetUid456', canonicalTrainerName: 'OtherTrainer'
  } }, 'ProviderTrainer', ''), /AUTHORITY_RESPONSE_INVALID/u);
  assert.throws(() => validateFavoriteIdentityResponse({ code: 'SUCCESS', favorite: {
    version: 1, targetUid: 'differentTargetUid789', canonicalTrainerName: 'ProviderTrainer'
  } }, 'ProviderTrainer', 'firebaseTargetUid456'), /AUTHORITY_RESPONSE_INVALID/u);
});

test('provider read compatibility gate disables all three fixed read operations together', async () => {
  const configuration = loadGatewayConfiguration(environment({ PROVIDER_PUBLIC_PROJECTION_ENABLED: 'false' }));
  for (const [operation, data] of [
    ['readProviderPublicShare', { schemaVersion: 1, trainerHandle: 'ProviderTrainer' }],
    ['listTrainerDirectory', { schemaVersion: 1, query: 'pr', pageSize: 25, cursor: null }],
    ['resolveFavoriteTrainerIdentity', { schemaVersion: 1, trainerHandle: 'ProviderTrainer', expectedTargetUid: '' }]
  ]) {
    let calls = 0;
    const handler = createGatewayOperation(operation, configuration, { invokeAuthority: async () => { calls += 1; } });
    await assert.rejects(handler(request(data)), /GATEWAY_NOT_ENABLED/u);
    assert.equal(calls, 0);
  }
});
