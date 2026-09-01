'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  GATES,
  createHandler,
  loadConfiguration,
  providerOperationFingerprint,
  providerRequestFingerprint,
  providerSubjectHash,
  verifiedGoogleProviderIdentity,
  verifyCurrentGoogleProviderIdentity
} = require('../e1-authority-service/server');
const { STAGING: EXPECTED } = require('../e1-authority-service/e1TargetContracts');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');

const NOW = Date.parse('2026-08-31T16:00:00.000Z');
const UID = 'firebase_uid_provider_a';
const TOKEN = 'verified-google-token';
const SUBJECT = 'google-provider-subject-001';
const REQUEST_ID = 'request-provider-0001';
const LIFECYCLE_ID = 'auth-7';
const CLIENT_RELEASE = '2026-08-31.86';

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: EXPECTED.environment,
    FIREBASE_PROJECT_ID: EXPECTED.projectId,
    EXPECTED_PROJECT_NUMBER: EXPECTED.projectNumber,
    FIRESTORE_DATABASE_ID: EXPECTED.databaseId,
    SERVICE_REGION: EXPECTED.region,
    AUTHORITY_SERVICE_NAME: EXPECTED.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: EXPECTED.runtimeServiceAccount,
    RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function verifiedToken(overrides = {}) {
  return {
    uid: UID,
    authTime: NOW - 60_000,
    signInProvider: 'google.com',
    identities: { 'google.com': [SUBJECT] },
    ...overrides
  };
}

function requestBody(overrides = {}) {
  const handle = normalizeHandle(overrides.requestedHandle || 'ProviderTrainer');
  const model = {
    uid: UID,
    requestId: overrides.requestId || REQUEST_ID,
    canonicalTrainerName: handle.display,
    normalizedTrainerName: handle.normalized,
    handleKey: handle.handleKey,
    lifecycleId: overrides.lifecycleId || LIFECYCLE_ID,
    clientRelease: overrides.clientRelease || CLIENT_RELEASE
  };
  return {
    schemaVersion: 1,
    requestId: model.requestId,
    requestedHandle: handle.display,
    lifecycleId: model.lifecycleId,
    clientRelease: model.clientRelease,
    idempotencyFingerprint: providerRequestFingerprint(model),
    ...overrides
  };
}

function invoke(handler, { body = requestBody(), token = TOKEN, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const request = Readable.from([raw]);
    request.method = method;
    request.url = '/v1/create-provider-account-foundation';
    request.headers = {
      'content-length': String(Buffer.byteLength(raw)),
      ...(token === undefined ? {} : { 'x-firebase-id-token': token })
    };
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(payload) {
        try { resolve({ status: this.status, headers: this.headers, body: JSON.parse(payload) }); }
        catch (error) { reject(error); }
      }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function harness(overrides = {}) {
  const calls = { create: [], createOptions: [], readback: [], legacy: [], presence: [], providerChecks: [], rate: [], logs: [] };
  const configuration = loadConfiguration(environment({ CREATE_PROVIDER_ACCOUNT_ENABLED: 'true' }));
  const dependencies = {
    now: () => NOW,
    async verifyFirebaseIdToken(_configuration, token) {
      if (!token) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
      if (token !== TOKEN) throw Object.assign(new Error('AUTH_INVALID'), { code: 'AUTH_INVALID' });
      return verifiedToken();
    },
    async verifyCurrentGoogleProviderIdentity(config, token, identity, timestamp) {
      calls.providerChecks.push({ token, uid: identity.uid, timestamp });
      return verifiedGoogleProviderIdentity(config, identity, timestamp);
    },
    async readLegacyBinding(input) { calls.legacy.push(input); throw new Error('legacy reader must remain unused'); },
    async operationRequestExists(input) { calls.presence.push(input); return false; },
    async consumeRateLimit(input) { calls.rate.push(input); return { allowed: true, consumed: true }; },
    async createProviderAccountFoundation(input, options) {
      calls.create.push(input); calls.createOptions.push(options);
      return {
        status: 'created', canonicalTrainerName: input.canonicalTrainerName,
        normalizedTrainerName: input.normalizedTrainerName, handleKey: input.handleKey,
        identityKind: 'provider_only', revision: 1
      };
    },
    async readProviderAccountFoundation(input) { calls.readback.push(input); return null; },
    structuredLog(_configuration, operation, outcome, _startedAt, extra) { calls.logs.push({ operation, outcome, extra }); },
    ...overrides
  };
  return { calls, configuration, handler: createHandler(configuration, dependencies) };
}

test('provider creation gate is false by default and fails before parsing Auth or datastore access', async () => {
  let calls = 0;
  const handler = createHandler(loadConfiguration(environment()), {
    readJsonRequest: async () => { calls += 1; },
    verifyFirebaseIdToken: async () => { calls += 1; },
    createProviderAccountFoundation: async () => { calls += 1; },
    structuredLog() {}
  });
  const result = await invoke(handler);
  assert.deepEqual(result.body, { code: 'E1_NOT_ENABLED' });
  assert.equal(calls, 0);
});

test('exact request rejects client UID provider fields unknown fields and malformed lifecycle evidence', async () => {
  const { handler, calls } = harness();
  for (const body of [
    { ...requestBody(), uid: 'forged_uid' },
    { ...requestBody(), provider: 'google' },
    { ...requestBody(), email: 'private@example.test' },
    { ...requestBody(), lifecycleId: 'not-a-lifecycle' },
    { ...requestBody(), idempotencyFingerprint: 'f'.repeat(64) }
  ]) {
    const result = await invoke(handler, { body });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'REQUEST_INVALID');
  }
  assert.equal(calls.create.length, 0);
});

test('verified token UID is the sole account owner and raw provider subject never reaches durable input or logs', async () => {
  const { handler, calls, configuration } = harness();
  const result = await invoke(handler);
  assert.equal(result.status, 200);
  assert.equal(result.body.code, 'SUCCESS');
  assert.equal(calls.create.length, 1);
  const input = calls.create[0];
  assert.equal(input.uid, UID);
  assert.equal(input.providerKey, 'google');
  assert.equal(input.providerId, 'google.com');
  assert.equal(input.providerSubjectKey, `v1_google_${providerSubjectHash(configuration, 'google.com', SUBJECT)}`);
  assert.equal(input.fingerprint, providerOperationFingerprint(input));
  assert.equal(JSON.stringify({ input, logs: calls.logs }).includes(SUBJECT), false);
  assert.deepEqual(calls.providerChecks, [{ token: TOKEN, uid: UID, timestamp: NOW }]);
  assert.equal(calls.legacy.length, 0);
});

test('missing invalid non-Google ambiguous and stale provider evidence all fail before rate limit or transaction', async () => {
  const variants = [
    null,
    verifiedToken({ signInProvider: 'password' }),
    verifiedToken({ identities: null }),
    verifiedToken({ identities: { 'google.com': [SUBJECT, 'second-subject'] } }),
    verifiedToken({ authTime: NOW - (10 * 60 * 1000) - 1 })
  ];
  for (const value of variants) {
    const { handler, calls } = harness({
      async verifyFirebaseIdToken() { return value || { uid: UID }; }
    });
    const result = await invoke(handler);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'PROVIDER_IDENTITY_REQUIRED');
    assert.equal(calls.rate.length, 0);
    assert.equal(calls.create.length, 0);
  }
});

test('first create consumes bounded quota while exact replay bypasses quota and passes replayOnly', async () => {
  const first = harness();
  await invoke(first.handler);
  assert.equal(first.calls.rate.length, 1);
  assert.equal(first.calls.rate[0].operation, 'createProviderAccountFoundation');
  assert.equal(first.calls.createOptions[0].replayOnly, false);

  const replay = harness({ async operationRequestExists(input) { replay.calls.presence.push(input); return true; } });
  await invoke(replay.handler);
  assert.equal(replay.calls.rate.length, 0);
  assert.equal(replay.calls.createOptions[0].replayOnly, true);
});

test('lost transaction response performs one exact readback and accepts only a complete matching provider foundation', async () => {
  const committed = harness({
    async createProviderAccountFoundation() { throw new Error('transport result lost'); },
    async readProviderAccountFoundation(input) {
      committed.calls.readback.push(input);
      return {
        status: 'created', canonicalTrainerName: input.canonicalTrainerName,
        normalizedTrainerName: input.normalizedTrainerName, handleKey: input.handleKey,
        identityKind: 'provider_only', revision: 1
      };
    }
  });
  const result = await invoke(committed.handler);
  assert.equal(result.body.code, 'RECONCILED');
  assert.equal(committed.calls.readback.length, 1);

  const absent = harness({ async createProviderAccountFoundation() { throw new Error('transport result lost'); } });
  const failed = await invoke(absent.handler);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, 'INTERNAL_ERROR');
  assert.equal(absent.calls.readback.length, 1);
});

test('known conflicts never invoke reconciliation and preserve precise public outcomes', async () => {
  const cases = [
    ['e1/legacy-namespace-not-certified', 503, 'NAMESPACE_NOT_CERTIFIED'],
    ['e1/account-conflict', 409, 'ACCOUNT_EXISTS'],
    ['e1/handle-conflict', 409, 'HANDLE_CONFLICT'],
    ['e1/provider-subject-conflict', 409, 'PROVIDER_CONFLICT'],
    ['e1/provider-foundation-conflict', 409, 'FOUNDATION_CONFLICT'],
    ['e1/replay-mismatch', 409, 'REQUEST_INVALID'],
    ['e1/rate-limit-exceeded', 429, 'RATE_LIMITED']
  ];
  for (const [code, status, publicCode] of cases) {
    const error = Object.assign(new Error(code), { code });
    const options = code === 'e1/rate-limit-exceeded'
      ? { async consumeRateLimit() { throw error; } }
      : { async createProviderAccountFoundation() { throw error; } };
    const instance = harness(options);
    const result = await invoke(instance.handler);
    assert.equal(result.status, status);
    assert.equal(result.body.code, publicCode);
    assert.equal(instance.calls.readback.length, 0);
  }
});

test('response is provider-only and contains no UID provider subject email token or invented legacy access', async () => {
  const { handler } = harness();
  const result = await invoke(handler);
  assert.deepEqual(result.body.foundation, {
    schemaVersion: 1,
    canonicalTrainerName: 'ProviderTrainer',
    normalizedTrainerName: 'providertrainer',
    handleKey: `v1_${Buffer.from('providertrainer', 'utf8').toString('hex')}`,
    legacyUsername: null,
    identityKind: 'provider_only',
    legacyAccessConfigured: false,
    status: 'active',
    revision: 1
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /firebase_uid|google-provider-subject|private@example|verified-google-token|pin/i);
});

test('provider identity verifier accepts exactly one recent Google subject and hashes by provider domain', () => {
  const configuration = loadConfiguration(environment());
  const value = verifiedGoogleProviderIdentity(configuration, verifiedToken(), NOW);
  assert.equal(value.providerKey, 'google');
  assert.equal(value.providerId, 'google.com');
  assert.match(value.providerSubjectKey, /^v1_google_[a-f0-9]{64}$/u);
  assert.notEqual(providerSubjectHash(configuration, 'google.com', SUBJECT), providerSubjectHash(configuration, 'discord.com', SUBJECT));
});

test('current Firebase account lookup requires the same still-linked Google subject without persisting profile fields', async () => {
  const configuration = loadConfiguration(environment());
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { users: [{
          localId: UID,
          email: 'ignored@example.test',
          displayName: 'Ignored Profile',
          providerUserInfo: [{ providerId: 'google.com', federatedId: SUBJECT, photoUrl: 'https://example.test/private.png' }]
        }] };
      }
    };
  };
  const result = await verifyCurrentGoogleProviderIdentity(configuration, TOKEN, verifiedToken(), fetchImpl, NOW);
  assert.equal(result.providerSubjectKey, `v1_google_${providerSubjectHash(configuration, 'google.com', SUBJECT)}`);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { idToken: TOKEN });
  assert.equal(JSON.stringify(result).includes('ignored@example.test'), false);
});

test('provider removed or rebound before commit fails before rate limit and Firestore transaction', async () => {
  for (const providerUserInfo of [
    [],
    [{ providerId: 'google.com', federatedId: 'different-subject' }],
    [{ providerId: 'password', federatedId: 'ignored@example.test' }]
  ]) {
    const instance = harness({
      async verifyCurrentGoogleProviderIdentity(configuration, token, identity, timestamp) {
        return verifyCurrentGoogleProviderIdentity(configuration, token, identity, async () => ({
          ok: true,
          status: 200,
          async json() { return { users: [{ localId: UID, providerUserInfo }] }; }
        }), timestamp);
      }
    });
    const result = await invoke(instance.handler);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'PROVIDER_IDENTITY_REQUIRED');
    assert.equal(instance.calls.rate.length, 0);
    assert.equal(instance.calls.create.length, 0);
  }
});

test('unsupported method and oversized or stale-release requests fail closed', async () => {
  const { handler, calls } = harness();
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
  assert.equal((await invoke(handler, { body: requestBody({ clientRelease: '2026-08-31.85' }) })).body.code, 'REQUEST_INVALID');
  assert.equal(calls.create.length, 0);
});
