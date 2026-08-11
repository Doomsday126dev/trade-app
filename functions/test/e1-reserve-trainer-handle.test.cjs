'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  GATES,
  createHandler,
  loadConfiguration,
  reserveFingerprint,
  verifiedLegacyFoundation
} = require('../e1-authority-service/server');
const { STAGING: EXPECTED } = require('../e1-authority-service/e1TargetContracts');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');

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

function invoke(handler, { body, token, method = 'POST', path = '/v1/reserve-trainer-handle' } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const request = Readable.from(raw ? [raw] : []);
    request.method = method;
    request.url = path;
    request.headers = {
      ...(raw ? { 'content-length': String(Buffer.byteLength(raw)) } : {}),
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

function enabledHarness(overrides = {}) {
  const calls = { legacy: [], reserve: [], logs: [] };
  const configuration = loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true', RESERVE_HANDLE_ENABLED: 'true' }));
  const dependencies = {
    async verifyFirebaseIdToken(_configuration, token) {
      if (!token) { const error = new Error('AUTH_REQUIRED'); error.code = 'AUTH_REQUIRED'; throw error; }
      if (token !== 'valid-token') { const error = new Error('AUTH_INVALID'); error.code = 'AUTH_INVALID'; throw error; }
      return { uid: 'firebase_uid_a' };
    },
    async readLegacyBinding(input) {
      calls.legacy.push(input);
      return {
        status: 'ready',
        username: 'TrainerOne',
        legacyAuthVersion: 3
      };
    },
    async reserveTrainerHandle(input) {
      calls.reserve.push(input);
      return { status: 'reserved', handleKey: input.handleKey, revision: 1 };
    },
    async consumeRateLimit() { return { allowed: true, consumed: true }; },
    structuredLog(config, operation, outcome, startedAt, extra) {
      calls.logs.push({ config, operation, outcome, startedAt, extra });
    },
    ...overrides
  };
  return { calls, configuration, handler: createHandler(configuration, dependencies) };
}

const validBody = Object.freeze({ schemaVersion: 1, requestedHandle: 'TrainerOne', requestId: 'request-reserve-0001' });

test('disabled reserve gate fails before parsing auth legacy or Firestore dependencies', async () => {
  let dependencyCalls = 0;
  const configuration = loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true' }));
  const handler = createHandler(configuration, {
    readJsonRequest: async () => { dependencyCalls += 1; },
    verifyFirebaseIdToken: async () => { dependencyCalls += 1; },
    readLegacyBinding: async () => { dependencyCalls += 1; },
    reserveTrainerHandle: async () => { dependencyCalls += 1; },
    structuredLog() {}
  });
  const result = await invoke(handler, { body: { uid: 'forged' }, token: 'invalid-token' });
  assert.deepEqual(result.body, { code: 'E1_NOT_ENABLED' });
  assert.equal(result.status, 503);
  assert.equal(dependencyCalls, 0);
});

test('Firebase token is mandatory and client-supplied UID or unknown fields are rejected', async () => {
  const { handler, calls } = enabledHarness();
  assert.deepEqual((await invoke(handler, { body: validBody })).body, { code: 'AUTH_REQUIRED' });
  assert.deepEqual((await invoke(handler, { body: validBody, token: 'invalid-token' })).body, { code: 'AUTH_INVALID' });
  assert.deepEqual((await invoke(handler, { body: { ...validBody, uid: 'firebase_uid_b' }, token: 'valid-token' })).body, { code: 'REQUEST_INVALID' });
  assert.deepEqual((await invoke(handler, { body: { ...validBody, arbitraryPath: 'accounts/other' }, token: 'valid-token' })).body, { code: 'REQUEST_INVALID' });
  assert.equal(calls.reserve.length, 0);
});

test('reciprocal legacy mapping creates a bounded transaction input derived from token UID', async () => {
  const { handler, calls } = enabledHarness();
  const result = await invoke(handler, { body: validBody, token: 'valid-token' });
  assert.equal(result.status, 200);
  assert.equal(result.body.code, 'SUCCESS');
  assert.equal(calls.legacy.length, 1);
  assert.equal(calls.legacy[0].verifiedUid, 'firebase_uid_a');
  assert.equal(calls.legacy[0].firebaseIdToken, 'valid-token');
  assert.equal(calls.reserve.length, 1);
  assert.deepEqual(calls.reserve[0], {
    uid: 'firebase_uid_a',
    requestId: validBody.requestId,
    canonicalTrainerName: 'TrainerOne',
    normalizedTrainerName: 'trainerone',
    handleKey: `v1_${Buffer.from('trainerone', 'utf8').toString('hex')}`,
    legacyUsername: 'TrainerOne',
    legacyAuthVersion: 3,
    fingerprint: reserveFingerprint({
      uid: 'firebase_uid_a',
      requestId: validBody.requestId,
      canonicalTrainerName: 'TrainerOne',
      normalizedTrainerName: 'trainerone',
      handleKey: `v1_${Buffer.from('trainerone', 'utf8').toString('hex')}`,
      legacyUsername: 'TrainerOne',
      legacyAuthVersion: 3
    })
  });
});

test('first reserve is SUCCESS while exact replay is IDEMPOTENT and changed replay remains bounded', async () => {
  let legacyUsername = 'TrainerOne';
  let storedState;
  const { handler, calls } = enabledHarness({
    readLegacyBinding: async () => ({ status: 'ready', username: legacyUsername, legacyAuthVersion: 3 }),
    reserveTrainerHandle: async (input) => {
      if (!storedState) {
        storedState = Object.freeze({
          requestId: input.requestId,
          fingerprint: input.fingerprint,
          result: Object.freeze({ status: 'reserved', handleKey: input.handleKey, revision: 1 }),
          createdAt: 1000
        });
        return storedState.result;
      }
      if (storedState.requestId === input.requestId && storedState.fingerprint !== input.fingerprint) {
        const error = new Error('e1/replay-mismatch');
        error.code = 'e1/replay-mismatch';
        throw error;
      }
      return { ...storedState.result, replay: true };
    }
  });
  const first = await invoke(handler, { body: validBody, token: 'valid-token' });
  const stateAfterFirst = JSON.stringify(storedState);
  const replay = await invoke(handler, { body: validBody, token: 'valid-token' });
  assert.equal(first.status, 200);
  assert.equal(first.body.code, 'SUCCESS');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.code, 'IDEMPOTENT');
  assert.equal(JSON.stringify(storedState), stateAfterFirst);
  assert.equal(calls.logs.at(-1).extra.replayClass, 'exact-replay');

  legacyUsername = 'TrainerTwo';
  const mismatch = await invoke(handler, {
    body: { ...validBody, requestedHandle: 'TrainerTwo' },
    token: 'valid-token'
  });
  assert.equal(mismatch.status, 409);
  assert.deepEqual(mismatch.body, { code: 'REQUEST_INVALID' });
  assert.equal(JSON.stringify(storedState), stateAfterFirst);
});

test('missing and conflicting reciprocal legacy mappings fail without transaction calls', async () => {
  for (const [legacy, expected] of [
    [{ status: 'mapping-incomplete', reason: 'auth-index-missing' }, 'MAPPING_INCOMPLETE'],
    [{ status: 'mapping-conflict', reason: 'uid-mismatch' }, 'MAPPING_CONFLICT'],
    [{ status: 'mapping-incomplete', reason: 'login-directory-unready' }, 'MAPPING_INCOMPLETE']
  ]) {
    let reserveCalls = 0;
    const { handler } = enabledHarness({ readLegacyBinding: async () => legacy, reserveTrainerHandle: async () => { reserveCalls += 1; } });
    const result = await invoke(handler, { body: validBody, token: 'valid-token' });
    assert.deepEqual(result.body, { code: expected });
    assert.equal(result.status, 409);
    assert.equal(reserveCalls, 0);
  }
});

test('requested handle must exactly normalize to the verified legacy username', async () => {
  const { handler, calls } = enabledHarness();
  const result = await invoke(handler, {
    body: { ...validBody, requestedHandle: 'OtherTrainer' },
    token: 'valid-token'
  });
  assert.deepEqual(result.body, { code: 'MAPPING_CONFLICT' });
  assert.equal(calls.reserve.length, 0);
});

test('normalizer is NFKC deterministic and rejects reserved mixed-script illegal and oversized handles', () => {
  const canonical = normalizeHandle('  ＴｒａｉｎｅｒＯｎｅ  ');
  assert.equal(canonical.display, 'TrainerOne');
  assert.equal(canonical.normalized, 'trainerone');
  assert.equal(canonical.handleKey, `v1_${Buffer.from('trainerone', 'utf8').toString('hex')}`);
  for (const value of ['admin', 'Aа', 'bad/name', 'x'.repeat(65)]) assert.throws(() => normalizeHandle(value));
});

test('bounded result mapping and logs expose hashes but no raw identity request or token values', async () => {
  const errors = [
    ['e1/handle-conflict', 409, 'HANDLE_CONFLICT'],
    ['e1/foundation-conflict', 409, 'FOUNDATION_CONFLICT'],
    ['e1/replay-mismatch', 409, 'REQUEST_INVALID'],
    ['unexpected', 500, 'INTERNAL_ERROR']
  ];
  for (const [errorCode, status, code] of errors) {
    const { handler, calls } = enabledHarness({ reserveTrainerHandle: async () => { const error = new Error(errorCode); error.code = errorCode; throw error; } });
    const result = await invoke(handler, { body: validBody, token: 'valid-token' });
    assert.equal(result.status, status);
    assert.deepEqual(result.body, { code });
    const serialized = JSON.stringify(calls.logs);
    assert.doesNotMatch(serialized, /firebase_uid_a|TrainerOne|request-reserve|valid-token/);
    assert.match(serialized, /uidHash/);
    assert.match(serialized, /handleHash/);
  }
});

test('legacy verifier distinguishes incomplete conflict and exact reciprocal readiness', () => {
  const requested = normalizeHandle('TrainerOne');
  assert.throws(() => verifiedLegacyFoundation('firebase_uid_a', requested, null), /MAPPING_INCOMPLETE/);
  assert.throws(() => verifiedLegacyFoundation('firebase_uid_a', requested, {
    status: 'mapping-conflict', reason: 'uid-mismatch'
  }), /MAPPING_CONFLICT/);
  assert.deepEqual(verifiedLegacyFoundation('firebase_uid_a', requested, {
    status: 'ready', username: 'TrainerOne', legacyAuthVersion: 1
  }), {
    canonicalTrainerName: 'TrainerOne', normalizedTrainerName: 'trainerone',
    handleKey: requested.handleKey, legacyUsername: 'TrainerOne', legacyAuthVersion: 1
  });
});
