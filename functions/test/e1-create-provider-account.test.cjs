'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  GATES,
  PROVIDER_ACCOUNT_PROTOCOL_VERSION,
  createHandler,
  linkedGoogleProviderIdentity,
  loadConfiguration,
  providerOperationFingerprint,
  providerRequestFingerprint,
  providerSubjectHash,
  recentGoogleProviderIdentity,
  verifyCurrentLinkedGoogleProviderIdentity,
  verifyRecentGoogleProviderAuthentication
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
const PROVIDER_HMAC_KEY = 'synthetic-provider-subject-key-material-0001';

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
    PROVIDER_SUBJECT_HMAC_KEY: PROVIDER_HMAC_KEY,
    PROVIDER_SUBJECT_HMAC_KEY_VERSION: '1',
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
    clientRelease: overrides.clientRelease || CLIENT_RELEASE,
    providerAccountProtocolVersion: overrides.providerAccountProtocolVersion || PROVIDER_ACCOUNT_PROTOCOL_VERSION
  };
  return {
    schemaVersion: 1,
    providerAccountProtocolVersion: model.providerAccountProtocolVersion,
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
    async verifyRecentGoogleProviderAuthentication(config, token, identity, timestamp) {
      calls.providerChecks.push({ token, uid: identity.uid, timestamp });
      return recentGoogleProviderIdentity(config, identity, timestamp);
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

test('provider-subject key configuration is optional while inactive but mandatory and versioned for creation',()=>{
  const inactive=environment();delete inactive.PROVIDER_SUBJECT_HMAC_KEY;delete inactive.PROVIDER_SUBJECT_HMAC_KEY_VERSION;
  assert.equal(loadConfiguration(inactive).createProviderAccountEnabled,false);
  assert.throws(()=>loadConfiguration({...inactive,CREATE_PROVIDER_ACCOUNT_ENABLED:'true'}),/E1_CONFIGURATION_MISMATCH/u);
  for(const malformed of[
    {...inactive,PROVIDER_SUBJECT_HMAC_KEY:'short',PROVIDER_SUBJECT_HMAC_KEY_VERSION:'1'},
    {...inactive,PROVIDER_SUBJECT_HMAC_KEY:PROVIDER_HMAC_KEY},
    {...inactive,PROVIDER_SUBJECT_HMAC_KEY_VERSION:'1'},
    {...inactive,PROVIDER_SUBJECT_HMAC_KEY:PROVIDER_HMAC_KEY,PROVIDER_SUBJECT_HMAC_KEY_VERSION:'0'}
  ])assert.throws(()=>loadConfiguration(malformed),/E1_CONFIGURATION_MISMATCH/u);
  const first=loadConfiguration(environment()),second=loadConfiguration(environment({
    PROVIDER_SUBJECT_HMAC_KEY:'synthetic-provider-subject-key-material-0002',PROVIDER_SUBJECT_HMAC_KEY_VERSION:'2'
  }));
  assert.equal(providerSubjectHash(first,'google.com',SUBJECT),providerSubjectHash(first,'google.com',SUBJECT));
  assert.notEqual(providerSubjectHash(first,'google.com',SUBJECT),providerSubjectHash(second,'google.com',SUBJECT));
  assert.notEqual(providerSubjectHash(first,'google.com',SUBJECT),providerSubjectHash(first,'discord.com',SUBJECT));
  const noKey={...inactive,READ_ACCOUNT_FOUNDATION_ENABLED:'true',PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED:'true'};
  assert.throws(()=>loadConfiguration(noKey),/E1_CONFIGURATION_MISMATCH/u);
  assert.throws(()=>loadConfiguration({...environment(),PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED:'true',READ_ACCOUNT_FOUNDATION_ENABLED:'false'}),
    /E1_CONFIGURATION_MISMATCH/u);
});

test('reviewed HMAC rotation retains prior read keys while creation binds only the active version',()=>{
  const configuration=loadConfiguration(environment({
    PROVIDER_SUBJECT_HMAC_KEY:'synthetic-provider-subject-key-material-0002',
    PROVIDER_SUBJECT_HMAC_KEY_VERSION:'2',
    PROVIDER_SUBJECT_HMAC_PREVIOUS_KEY_VERSIONS:'1',
    PROVIDER_SUBJECT_HMAC_KEY_V1:PROVIDER_HMAC_KEY,
    READ_ACCOUNT_FOUNDATION_ENABLED:'true',
    PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED:'true'
  }));
  const linked=linkedGoogleProviderIdentity(configuration,verifiedToken());
  assert.deepEqual(linked.providerSubjectCandidates.map(value=>value.providerSubjectKeyVersion),[2,1]);
  assert.notEqual(linked.providerSubjectCandidates[0].providerSubjectKey,linked.providerSubjectCandidates[1].providerSubjectKey);
  const recent=recentGoogleProviderIdentity(configuration,verifiedToken(),NOW);
  assert.equal(recent.providerSubjectKeyVersion,2);
  assert.equal(Object.hasOwn(recent,'providerSubjectCandidates'),false);
  assert.throws(()=>loadConfiguration(environment({
    PROVIDER_SUBJECT_HMAC_KEY:'synthetic-provider-subject-key-material-0002',
    PROVIDER_SUBJECT_HMAC_KEY_VERSION:'2',
    PROVIDER_SUBJECT_HMAC_PREVIOUS_KEY_VERSIONS:'1'
  })),/E1_CONFIGURATION_MISMATCH/u);
  assert.throws(()=>loadConfiguration(environment({
    PROVIDER_SUBJECT_HMAC_KEY:PROVIDER_HMAC_KEY,
    PROVIDER_SUBJECT_HMAC_KEY_VERSION:'1',
    PROVIDER_SUBJECT_HMAC_PREVIOUS_KEY_VERSIONS:'2',
    PROVIDER_SUBJECT_HMAC_KEY_V2:'synthetic-provider-subject-key-material-0002'
  })),/E1_CONFIGURATION_MISMATCH/u);
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

test('missing invalid non-Google and ambiguous provider evidence fails before rate limit or transaction', async () => {
  const variants = [
    [null, 'PROVIDER_IDENTITY_REQUIRED'],
    [verifiedToken({ signInProvider: 'password' }), 'RECENT_PROVIDER_AUTH_REQUIRED'],
    [verifiedToken({ identities: null }), 'PROVIDER_IDENTITY_REQUIRED'],
    [verifiedToken({ identities: { 'google.com': [SUBJECT, 'second-subject'] } }), 'PROVIDER_IDENTITY_REQUIRED']
  ];
  for (const [value, expectedCode] of variants) {
    const { handler, calls } = harness({
      async verifyFirebaseIdToken() { return value || { uid: UID }; }
    });
    const result = await invoke(handler);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, expectedCode);
    assert.equal(calls.rate.length, 0);
    assert.equal(calls.create.length, 0);
  }
});

test('provider creation accepts one-minute Google auth and rejects eleven-minute auth before writes', async () => {
  const recent = harness();
  const accepted = await invoke(recent.handler);
  assert.equal(accepted.status, 200);
  assert.equal(recent.calls.create.length, 1);

  const stale = harness({
    async verifyFirebaseIdToken() { return verifiedToken({ authTime: NOW - 11 * 60 * 1000 }); }
  });
  const rejected = await invoke(stale.handler);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.code, 'RECENT_PROVIDER_AUTH_REQUIRED');
  assert.equal(stale.calls.rate.length, 0);
  assert.equal(stale.calls.create.length, 0);
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
    ['e1/legacy-namespace-not-certified', 412, 'NAMESPACE_NOT_CERTIFIED'],
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

test('linked identity and recent authentication are distinct provider contracts', () => {
  const configuration = loadConfiguration(environment());
  const value = linkedGoogleProviderIdentity(configuration, verifiedToken({ authTime: NOW - 7 * 24 * 60 * 60 * 1000 }));
  assert.equal(value.providerKey, 'google');
  assert.equal(value.providerId, 'google.com');
  assert.match(value.providerSubjectKey, /^v1_google_[a-f0-9]{64}$/u);
  assert.notEqual(providerSubjectHash(configuration, 'google.com', SUBJECT), providerSubjectHash(configuration, 'discord.com', SUBJECT));
  assert.throws(() => recentGoogleProviderIdentity(configuration,
    verifiedToken({ authTime: NOW - 11 * 60 * 1000 }), NOW), /RECENT_PROVIDER_AUTH_REQUIRED/u);
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
  const result = await verifyCurrentLinkedGoogleProviderIdentity(configuration, TOKEN, verifiedToken(), fetchImpl);
  assert.equal(result.providerSubjectKey, `v1_google_${providerSubjectHash(configuration, 'google.com', SUBJECT)}`);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { idToken: TOKEN });
  assert.equal(JSON.stringify(result).includes('ignored@example.test'), false);
});

test('provider removed rebound disabled or wrong UID before commit fails before rate limit and Firestore transaction', async () => {
  for (const [account, expectedCode] of [
    [{ localId: UID, providerUserInfo: [] }, 'PROVIDER_IDENTITY_REQUIRED'],
    [{ localId: UID, providerUserInfo: [{ providerId: 'google.com', federatedId: 'different-subject' }] }, 'PROVIDER_IDENTITY_REQUIRED'],
    [{ localId: UID, providerUserInfo: [{ providerId: 'password', federatedId: 'ignored@example.test' }] }, 'PROVIDER_IDENTITY_REQUIRED'],
    [{ localId: UID, disabled: true, providerUserInfo: [{ providerId: 'google.com', federatedId: SUBJECT }] }, 'PROVIDER_IDENTITY_REQUIRED'],
    [{ localId: 'different-firebase-uid', providerUserInfo: [{ providerId: 'google.com', federatedId: SUBJECT }] }, 'PROVIDER_IDENTITY_REQUIRED']
  ]) {
    const instance = harness({
      async verifyRecentGoogleProviderAuthentication(configuration, token, identity, timestamp) {
        return verifyRecentGoogleProviderAuthentication(configuration, token, identity, async () => ({
          ok: true,
          status: 200,
          async json() { return { users: [account] }; }
        }), timestamp);
      }
    });
    const result = await invoke(instance.handler);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, expectedCode);
    assert.equal(instance.calls.rate.length, 0);
    assert.equal(instance.calls.create.length, 0);
  }
});

test('protocol 1 works across routine Pages releases while unsupported protocol and malformed release fail closed', async () => {
  const { handler, calls } = harness();
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
  for (const clientRelease of ['2026-09-01.87', '2026-09-02.88', '2027-01-15.120']) {
    assert.equal((await invoke(handler, { body: requestBody({ clientRelease }) })).body.code, 'SUCCESS');
  }
  assert.equal((await invoke(handler, { body: requestBody({ providerAccountProtocolVersion: 2 }) })).body.code, 'REQUEST_INVALID');
  assert.equal((await invoke(handler, { body: requestBody({ clientRelease: 'not-a-release' }) })).body.code, 'REQUEST_INVALID');
  assert.equal(calls.create.length, 3);
});
