'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuthorityInvoker,
  createGatewayOperation,
  loadGatewayConfiguration,
  validateProviderPublicShareResponse,
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

function request(overrides = {}) {
  return {
    auth: null,
    app: { appId: 'production-app-id', alreadyConsumed: false },
    data: { schemaVersion: 1, trainerHandle: 'providertrainer' },
    rawRequest: { headers: { authorization: 'Bearer browser-token-must-not-forward' } },
    ...overrides
  };
}

function publicResult(overrides = {}) {
  return {
    code: 'SUCCESS',
    share: {
      version: 1,
      username: 'ProviderTrainer',
      profile: { friendCode: '', bio: '', discord: '', avatarPokemon: 'Pikachu', lastUpdated: 0 },
      lists: { wishlist: { Pikachu: { p: 'H', shiny: true } }, dynamax: {}, gmax: {}, costumes: {} },
      publishedListTypes: ['wishlist', 'dynamax', 'gmax', 'costumes'],
      updatedAt: 100,
      ...overrides
    }
  };
}

test('anonymous callable requires App Check consumes replay protection and never derives or forwards Auth', () => {
  const boundary = verifyCallableBoundary('readProviderPublicShare', request());
  assert.equal(boundary.uid, null);
  assert.equal(boundary.firebaseIdToken, null);
  assert.deepEqual(boundary.body, { schemaVersion: 1, trainerHandle: 'providertrainer' });
  assert.throws(() => verifyCallableBoundary('readProviderPublicShare', request({ app: null })), /APP_CHECK_REQUIRED/u);
  assert.throws(() => verifyCallableBoundary('readProviderPublicShare', request({
    app: { appId: 'production-app-id', alreadyConsumed: true }
  })), /APP_CHECK_REPLAYED/u);
});

test('independent provider projection gate blocks authority work even when the common gateway is enabled', async () => {
  let calls = 0;
  const configuration = loadGatewayConfiguration(environment({ PROVIDER_PUBLIC_PROJECTION_ENABLED: 'false' }));
  const handler = createGatewayOperation('readProviderPublicShare', configuration, {
    invokeAuthority: async () => { calls += 1; }
  });
  await assert.rejects(handler(request()), /GATEWAY_NOT_ENABLED/u);
  assert.equal(calls, 0);
});

test('enabled anonymous gateway binds exact handle and returns a deeply sanitized fixed projection', async () => {
  let boundary;
  const handler = createGatewayOperation('readProviderPublicShare', loadGatewayConfiguration(environment()), {
    invokeAuthority: async (_operation, observed) => {
      boundary = observed;
      return { status: 200, payload: publicResult() };
    }
  });
  const result = await handler(request());
  assert.equal(boundary.uid, null);
  assert.equal(boundary.firebaseIdToken, null);
  assert.equal(result.share.username, 'ProviderTrainer');
  assert.deepEqual(Object.keys(result.share).sort(), ['lists', 'profile', 'publishedListTypes', 'updatedAt', 'username', 'version']);
  assert.doesNotMatch(JSON.stringify(result), /uid|email|token|credential|providerData/iu);
});

test('gateway rejects mismatched handles private fields malformed entries and oversized projections', () => {
  assert.throws(() => validateProviderPublicShareResponse(publicResult(), 'OtherTrainer'), /AUTHORITY_RESPONSE_INVALID/u);
  assert.throws(() => validateProviderPublicShareResponse({ ...publicResult(), ownerUid: 'private' }, 'ProviderTrainer'),
    /AUTHORITY_RESPONSE_INVALID/u);
  const privateProfile = publicResult();
  privateProfile.share.profile.email = 'private@example.test';
  assert.throws(() => validateProviderPublicShareResponse(privateProfile, 'ProviderTrainer'), /AUTHORITY_RESPONSE_INVALID/u);
  const malformedEntry = publicResult();
  malformedEntry.share.lists.wishlist.Pikachu = { p: 'X' };
  assert.throws(() => validateProviderPublicShareResponse(malformedEntry, 'ProviderTrainer'), /AUTHORITY_RESPONSE_INVALID/u);
  assert.throws(() => validateProviderPublicShareResponse(publicResult({
    profile: { friendCode: '', bio: 'x'.repeat(513 * 1024), discord: '', avatarPokemon: '', lastUpdated: 0 }
  }), 'ProviderTrainer'), /AUTHORITY_RESPONSE_INVALID/u);
});

test('gateway rejects dangerous public-list dictionary names', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const result = publicResult({
      lists: JSON.parse(`{"wishlist":{"${key}":{"p":"H"}},"dynamax":{},"gmax":{},"costumes":{}}`)
    });
    assert.throws(() => validateProviderPublicShareResponse(result, 'ProviderTrainer'),
      /AUTHORITY_RESPONSE_INVALID/u, key);
  }
  assert.equal({}.polluted, undefined);
});

test('authority invoker uses only server OIDC for anonymous reads and omits the browser bearer token', async () => {
  const calls = [];
  const configuration = loadGatewayConfiguration(environment());
  const invoke = createAuthorityInvoker(configuration, {
    getOidcToken: async () => 'server-oidc-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { status: 200, json: async () => ({ code: 'SHARE_NOT_FOUND' }) };
    }
  });
  const boundary = verifyCallableBoundary('readProviderPublicShare', request());
  const result = await invoke('readProviderPublicShare', boundary);
  assert.deepEqual(result.payload, { code: 'SHARE_NOT_FOUND' });
  assert.match(calls[0].url, /\/v1\/read-provider-public-share$/u);
  assert.equal(calls[0].options.headers['X-Serverless-Authorization'], 'Bearer server-oidc-token');
  assert.equal(Object.hasOwn(calls[0].options.headers, 'X-Firebase-ID-Token'), false);
  assert.equal(JSON.stringify(calls).includes('browser-token-must-not-forward'), false);
});

test('public not-found is exact and authority failures remain unavailable', async () => {
  const missing = createGatewayOperation('readProviderPublicShare', loadGatewayConfiguration(environment()), {
    invokeAuthority: async () => ({ status: 200, payload: { code: 'SHARE_NOT_FOUND' } })
  });
  assert.deepEqual(await missing(request()), { code: 'SHARE_NOT_FOUND' });
  const unavailable = createGatewayOperation('readProviderPublicShare', loadGatewayConfiguration(environment()), {
    invokeAuthority: async () => ({ status: 503, payload: { code: 'PUBLIC_SHARE_UNAVAILABLE' } })
  });
  await assert.rejects(unavailable(request()), /AUTHORITY_UNAVAILABLE/u);
});
