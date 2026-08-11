'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createAuthorityInvoker,
  createGatewayOperation,
  loadGatewayConfiguration,
  verifyCallableBoundary
} = require('../e1-gateway/gatewayCore');

function productionEnvironment(overrides = {}) {
  return {
    APP_ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'trade-list-a4297',
    SERVICE_REGION: 'us-central1',
    E1_AUTHORITY_URL: 'https://e1-identity-authority-production-uc.a.run.app/',
    E1_AUTHORITY_AUDIENCE: 'https://e1-identity-authority-production-uc.a.run.app',
    GATEWAY_INVOCATION_ENABLED: 'false',
    APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false',
    E1_RATE_LIMIT_POLICY: 'firestore-rolling-v1',
    ...overrides
  };
}

function request(data = { schemaVersion: 1 }, overrides = {}) {
  return {
    auth: { uid: 'firebase_uid_gateway' },
    app: { appId: 'production-app-id', alreadyConsumed: false },
    data,
    rawRequest: { headers: { authorization: 'Bearer firebase-id-token' } },
    ...overrides
  };
}

test('production gateway requires Auth App Check exact request shape and rejects debug-token configuration', () => {
  const config = loadGatewayConfiguration(productionEnvironment());
  assert.equal(config.gatewayEnabled, false);
  assert.equal(verifyCallableBoundary('readAccountFoundation', request()).uid, 'firebase_uid_gateway');
  assert.throws(() => verifyCallableBoundary('readAccountFoundation', request(undefined, { auth: null })), /AUTH_REQUIRED/);
  assert.throws(() => verifyCallableBoundary('readAccountFoundation', request(undefined, { app: null })), /APP_CHECK_REQUIRED/);
  assert.throws(() => verifyCallableBoundary('reserveTrainerHandle', request({ schemaVersion: 1, requestId: 'request-gateway-1', requestedHandle: 'Trainer' }, {
    app: { appId: 'production-app-id', alreadyConsumed: true }
  })), /APP_CHECK_REPLAYED/);
  assert.throws(() => loadGatewayConfiguration(productionEnvironment({ APP_CHECK_DEBUG_TOKENS_ALLOWED: 'true' })), /GATEWAY_CONFIGURATION_INVALID/);
});

test('gateway is disabled before authentication or authority invocation', async () => {
  let calls = 0;
  const handler = createGatewayOperation('readAccountFoundation', loadGatewayConfiguration(productionEnvironment()), {
    invokeAuthority: async () => { calls += 1; }
  });
  await assert.rejects(handler({}), /GATEWAY_NOT_ENABLED/);
  assert.equal(calls, 0);
});

test('gateway uses Google OIDC serverless authorization and forwards the subject token separately', async () => {
  const calls = [];
  const configuration = loadGatewayConfiguration(productionEnvironment({ GATEWAY_INVOCATION_ENABLED: 'true' }));
  const invoke = createAuthorityInvoker(configuration, {
    async getOidcToken(audience) { calls.push(['audience', audience]); return 'google-oidc-token'; },
    async fetchImpl(url, options) {
      calls.push(['request', String(url), options]);
      return { status: 200, async json() { return { code: 'FOUNDATION_NOT_INITIALIZED' }; } };
    }
  });
  const handler = createGatewayOperation('readAccountFoundation', configuration, { invokeAuthority: invoke });
  assert.deepEqual(await handler(request()), { code: 'FOUNDATION_NOT_INITIALIZED' });
  const options = calls[1][2];
  assert.equal(options.headers['X-Serverless-Authorization'], 'Bearer google-oidc-token');
  assert.equal(options.headers['X-Firebase-ID-Token'], 'firebase-id-token');
  assert.equal(options.headers['X-E1-Rate-Limit-Policy'], 'firestore-rolling-v1');
  assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  assert.equal(JSON.stringify(calls).includes('service-account-key'), false);
});

test('gateway exports only the two reviewed public operations and delegates durable quota to authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../e1-gateway/index.js'), 'utf8');
  const exported = [...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)].map((match) => match[1]);
  assert.deepEqual(exported, ['readE1AccountFoundation', 'reserveE1TrainerHandle']);
  assert.match(source, /enforceAppCheck:\s*true/u);
  assert.match(source, /callable\('reserveTrainerHandle', true\)/u);
  assert.doesNotMatch(source, /firebase-admin|Firestore|Database|serviceAccountTokenCreator|private_key/u);
});
