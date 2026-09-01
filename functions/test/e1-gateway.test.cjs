'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createAuthorityInvoker,
  createGatewayOperation,
  loadGatewayConfiguration,
  proofAttemptHash,
  verifyCallableBoundary
} = require('../e1-gateway/gatewayCore');
const { createFixture: createGroupEFixture } = require('./helpers/groupEFixture.cjs');

function productionEnvironment(overrides = {}) {
  return {
    APP_ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'trade-list-a4297',
    SERVICE_REGION: 'us-central1',
    E1_AUTHORITY_URL: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/',
    E1_AUTHORITY_AUDIENCE: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    E1_GATEWAY_SERVICE_ACCOUNT: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    GATEWAY_INVOCATION_ENABLED: 'false',
    APP_CHECK_ENFORCEMENT_MODE: 'monitor',
    APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false',
    E1_RATE_LIMIT_POLICY: 'firestore-rolling-v1',
    READ_PROOF_MODE: 'false',
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
  const providerRequest = {
    schemaVersion: 1,
    requestId: 'provider-request-1',
    requestedHandle: 'Trainer',
    lifecycleId: 'auth-1',
    clientRelease: '2026-08-31.86',
    idempotencyFingerprint: 'a'.repeat(64)
  };
  assert.equal(verifyCallableBoundary('createProviderAccountFoundation', request(providerRequest)).uid,
    'firebase_uid_gateway');
  assert.throws(() => verifyCallableBoundary('createProviderAccountFoundation', request(providerRequest, {
    app: { appId: 'production-app-id', alreadyConsumed: true }
  })), /APP_CHECK_REPLAYED/);
  assert.throws(() => verifyCallableBoundary('createProviderAccountFoundation', request({
    ...providerRequest, uid: 'browser-supplied-uid'
  })), /REQUEST_INVALID/);
  const groupE={enabled:true,bindings:[{uidHash:'0'.repeat(64)},{uidHash:'1'.repeat(64)}]};
  assert.throws(()=>verifyCallableBoundary('readAccountFoundation',request({schemaVersion:1,
    attemptId:'123e4567-e89b-42d3-a456-426614174000'},{app:{appId:'production-app-id',alreadyConsumed:true}}),false,groupE),
    /APP_CHECK_REPLAYED/);
  assert.throws(() => loadGatewayConfiguration(productionEnvironment({ APP_CHECK_DEBUG_TOKENS_ALLOWED: 'true' })), /GATEWAY_CONFIGURATION_INVALID/);
  assert.throws(() => loadGatewayConfiguration(productionEnvironment({ APP_CHECK_ENFORCEMENT_MODE: 'enforced' })), /GATEWAY_CONFIGURATION_INVALID/);
  assert.throws(() => loadGatewayConfiguration(productionEnvironment({ E1_GATEWAY_SERVICE_ACCOUNT: 'default@developer.gserviceaccount.com' })),
    /GATEWAY_CONFIGURATION_INVALID/);
});

test('gateway is disabled before authentication or authority invocation', async () => {
  let calls = 0;
  const handler = createGatewayOperation('readAccountFoundation', loadGatewayConfiguration(productionEnvironment()), {
    invokeAuthority: async () => { calls += 1; }
  });
  await assert.rejects(handler({}), /GATEWAY_NOT_ENABLED/);
  assert.equal(calls, 0);
});

test('Group E alone selects limited-use App Check consumption while restored and normal reads remain standard',()=>{
  const fixture=createGroupEFixture();
  const enabled=loadGatewayConfiguration(productionEnvironment({GATEWAY_INVOCATION_ENABLED:'true',
    GROUP_E_CLIENT_MODE:'synthetic-canary',
    GROUP_E_SUBJECT_BINDINGS:Object.values(fixture.bindings).map((binding)=>
      `${binding.uidHash}:${binding.trainerHash}`).join(';'),
    GROUP_E_COHORT_DIGEST:fixture.cohortDigest,
    GROUP_E_RUN_ID:fixture.run.runId,
    GROUP_E_RUN_MANIFEST_DIGEST:fixture.run.manifestDigest,
    GROUP_E_KEY_ID:fixture.run.keyId,
    GROUP_E_PUBLIC_KEY_SPKI:fixture.run.publicKeySpki,
    GROUP_E_FIREBASE_APP_ID_HASH:fixture.run.firebaseAppIdHash,
    GROUP_E_CONTROL_DATABASE_ID:'e1-group-e-control'}));
  assert.equal(enabled.groupE.enabled,true);
  assert.equal(enabled.groupE.runId,fixture.run.runId);
  assert.equal(enabled.groupE.keyId,fixture.run.keyId);
  assert.throws(()=>loadGatewayConfiguration(productionEnvironment({GATEWAY_INVOCATION_ENABLED:'true',
    GROUP_E_CLIENT_MODE:'synthetic-canary',GROUP_E_SUBJECT_BINDINGS:`${'a'.repeat(64)}:${'1'.repeat(64)};${'b'.repeat(64)}:${'2'.repeat(64)}`,
    GROUP_E_COHORT_DIGEST:'c'.repeat(64),GROUP_E_WINDOW_START:'2030-01-01T12:00:00.000Z',
    GROUP_E_WINDOW_END:'2030-01-01T12:30:00.000Z'})),/GROUP_E_CONFIGURATION_INVALID/);
  const restored=loadGatewayConfiguration(productionEnvironment({GROUP_E_CLIENT_MODE:'disabled'}));
  assert.equal(restored.groupE.enabled,false);
  const source=fs.readFileSync(path.resolve(__dirname,'../e1-gateway/index.js'),'utf8');
  assert.match(source,/readE1AccountFoundation = callable\('readAccountFoundation', configuration\.groupE\.enabled\)/u);
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
  assert.deepEqual(calls[0], ['audience', 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app']);
  assert.equal(calls[1][1], 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/v1/read-account-foundation');
  const options = calls[1][2];
  assert.equal(options.headers['X-Serverless-Authorization'], 'Bearer google-oidc-token');
  assert.equal(options.headers['X-Firebase-ID-Token'], 'firebase-id-token');
  assert.equal(options.headers['X-E1-Rate-Limit-Policy'], 'firestore-rolling-v1');
  assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  assert.equal(JSON.stringify(options).includes('app-check-token'), false);
  assert.equal(JSON.stringify(calls).includes('service-account-key'), false);
});

test('gateway preserves the namespace precondition but never trusts the same code from a generic 5xx response', async () => {
  const configuration = loadGatewayConfiguration(productionEnvironment({ GATEWAY_INVOCATION_ENABLED: 'true' }));
  const precondition = createGatewayOperation('createProviderAccountFoundation', configuration, {
    invokeAuthority: async () => ({ status: 412, payload: { code: 'NAMESPACE_NOT_CERTIFIED' } })
  });
  const body = {
    schemaVersion: 1,
    requestId: 'provider-request-1',
    requestedHandle: 'Trainer',
    lifecycleId: 'auth-1',
    clientRelease: '2026-08-31.86',
    idempotencyFingerprint: 'a'.repeat(64)
  };
  await assert.rejects(precondition(request(body)), (error) => error?.code === 'NAMESPACE_NOT_CERTIFIED');

  const unavailable = createGatewayOperation('createProviderAccountFoundation', configuration, {
    invokeAuthority: async () => ({ status: 503, payload: { code: 'NAMESPACE_NOT_CERTIFIED' } })
  });
  await assert.rejects(unavailable(request(body)), (error) => error?.code === 'AUTHORITY_UNAVAILABLE');
});

test('gateway forwards only the original callable bearer token and never substitutes decoded Auth or App Check context', () => {
  const boundary = verifyCallableBoundary('readAccountFoundation', request(undefined, {
    auth: { uid: 'firebase_uid_gateway', token: { uid: 'decoded-context-must-not-be-forwarded' } },
    app: { appId: 'app-check-context-must-not-be-forwarded', token: 'app-check-token-must-not-be-forwarded' }
  }));
  assert.equal(boundary.firebaseIdToken, 'firebase-id-token');
  assert.notEqual(boundary.firebaseIdToken, boundary.uid);
  assert.throws(() => verifyCallableBoundary('readAccountFoundation', request(undefined, {
    rawRequest: { headers: { 'x-firebase-appcheck': 'app-check-token' } }
  })), /AUTH_REQUIRED/);
});

test('Group C proof attempt is exact bounded propagated and safely logged without affecting authentication', async () => {
  const proofAttemptId = '123e4567-e89b-42d3-a456-426614174000';
  const logs = [];
  let forwarded;
  const configuration = loadGatewayConfiguration(productionEnvironment({
    GATEWAY_INVOCATION_ENABLED: 'true',
    READ_PROOF_MODE: 'true'
  }));
  const handler = createGatewayOperation('readAccountFoundation', configuration, {
    structuredLog: (entry) => logs.push(entry),
    invokeAuthority: async (_operation, boundary) => {
      forwarded = boundary;
      return { status: 200, payload: { code: 'FOUNDATION_NOT_INITIALIZED' } };
    }
  });
  assert.deepEqual(await handler(request({ schemaVersion: 1, proofAttemptId })), { code: 'FOUNDATION_NOT_INITIALIZED' });
  assert.deepEqual(forwarded.body, { schemaVersion: 1, proofAttemptId });
  assert.equal(forwarded.uid, 'firebase_uid_gateway');
  assert.equal(forwarded.proofAttemptHash, proofAttemptHash(proofAttemptId));
  assert.deepEqual(logs, [{
    schemaVersion: 1,
    operation: 'readAccountFoundation',
    outcome: 'proof_attempt',
    proofAttemptHash: proofAttemptHash(proofAttemptId)
  }]);
  assert.equal(JSON.stringify(logs).includes(proofAttemptId), false);
  await assert.rejects(handler(request({ schemaVersion: 1, proofAttemptId }, { auth: null })), /AUTH_REQUIRED/);
});

test('proof attempt schema fails closed outside Group C and for malformed IDs or mutation operations', () => {
  const proofAttemptId = '123e4567-e89b-42d3-a456-426614174000';
  assert.throws(() => verifyCallableBoundary('readAccountFoundation', request({ schemaVersion: 1, proofAttemptId }), false), /REQUEST_INVALID/);
  for (const invalid of ['', 'not-a-uuid', '123e4567-e89b-12d3-a456-426614174000', `${'a'.repeat(128)}`]) {
    assert.throws(() => verifyCallableBoundary('readAccountFoundation', request({ schemaVersion: 1, proofAttemptId: invalid }), true), /REQUEST_INVALID/);
  }
  assert.throws(() => verifyCallableBoundary('readAccountFoundation', request({ schemaVersion: 1 }), true), /REQUEST_INVALID/);
  assert.throws(() => verifyCallableBoundary('reserveTrainerHandle', request({
    schemaVersion: 1,
    requestId: 'request-gateway-1',
    requestedHandle: 'Trainer',
    proofAttemptId
  }), true), /REQUEST_INVALID/);
  assert.throws(() => loadGatewayConfiguration(productionEnvironment({ READ_PROOF_MODE: 'true' })), /GATEWAY_CONFIGURATION_INVALID/);
});

test('gateway exports only the three reviewed operations and delegates durable quota to authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../e1-gateway/index.js'), 'utf8');
  const exported = [...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)].map((match) => match[1]);
  assert.deepEqual(exported, [
    'readE1AccountFoundation',
    'createE1ProviderAccountFoundation',
    'reserveE1TrainerHandle'
  ]);
  assert.match(source, /enforceAppCheck:\s*configuration\.appCheckEnforcementMode === 'enforced'/u);
  assert.match(source, /serviceAccount:\s*configuration\.gatewayServiceAccount/u);
  assert.match(source, /callable\('createProviderAccountFoundation', true\)/u);
  assert.match(source, /callable\('reserveTrainerHandle', true\)/u);
  assert.match(source, /callable\('readAccountFoundation', configuration\.groupE\.enabled\)/u);
  assert.doesNotMatch(source, /firebase-admin|Firestore|Database|serviceAccountTokenCreator|private_key/u);
});
