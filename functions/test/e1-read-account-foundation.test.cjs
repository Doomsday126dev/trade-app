'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  EXPECTED,
  GATES,
  createHandler,
  loadConfiguration,
  verifyFirebaseIdToken
} = require('../e1-authority-service/server');

const UID = 'syntheticE1Uid123';
const API_KEY = 'synthetic-firebase-web-api-key-for-tests';
const NOW_SECONDS = 1_800_000_000;

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: EXPECTED.environment,
    FIREBASE_PROJECT_ID: EXPECTED.projectId,
    FIRESTORE_DATABASE_ID: EXPECTED.databaseId,
    SERVICE_REGION: EXPECTED.region,
    AUTHORITY_SERVICE_NAME: EXPECTED.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: EXPECTED.runtimeServiceAccount,
    RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    FIREBASE_WEB_API_KEY: API_KEY,
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function firebaseToken(claimOverrides = {}) {
  const claims = {
    aud: EXPECTED.projectId,
    iss: `https://securetoken.google.com/${EXPECTED.projectId}`,
    sub: UID,
    user_id: UID,
    auth_time: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 3600,
    ...claimOverrides
  };
  return `${Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`;
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function requestBody(body) {
  const raw = JSON.stringify(body);
  const request = EventEmitter.on ? new EventEmitter() : null;
  request.method = 'POST';
  request.url = '/v1/read-account-foundation';
  request.headers = { 'content-length': String(Buffer.byteLength(raw)), 'x-firebase-id-token': firebaseToken() };
  request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(raw); };
  return request;
}

function invoke(handler, { body = { schemaVersion: 1 }, token = firebaseToken(), method = 'POST' } = {}) {
  return new Promise((resolve) => {
    const input = requestBody(body);
    input.method = method;
    if (token === null) delete input.headers['x-firebase-id-token'];
    else input.headers['x-firebase-id-token'] = token;
    const output = new EventEmitter();
    output.writeHead = (status, headers) => { output.status = status; output.headers = headers; };
    output.end = (payload) => resolve({ status: output.status, headers: output.headers, body: JSON.parse(payload) });
    handler(input, output);
  });
}

function firestoreDocument(overrides = {}) {
  const fields = {
    schemaVersion: { integerValue: '1' },
    uid: { stringValue: UID },
    trainerName: { stringValue: 'SyntheticTrainer' },
    normalizedTrainerName: { stringValue: 'synthetictrainer' },
    handleKey: { stringValue: `v1_${'a'.repeat(64)}` },
    legacyUsername: { stringValue: 'legacy-synthetic' },
    status: { stringValue: 'active' },
    revision: { integerValue: '7' },
    createdAt: { integerValue: '1700000000000' },
    updatedAt: { integerValue: '1700000001000' },
    providerSubjects: { mapValue: { fields: { google: { stringValue: 'secret-provider-subject' } } } },
    migrationEvidence: { stringValue: 'never-return-this' },
    internalFingerprint: { stringValue: 'never-return-this-either' },
    ...overrides
  };
  return { name: `projects/${EXPECTED.projectId}/databases/${EXPECTED.databaseId}/documents/accounts/${UID}`, fields };
}

function enabledHandler(overrides = {}) {
  const calls = { reads: [], writes: [], logs: [] };
  const handler = createHandler(loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true' })), {
    verifyFirebaseIdToken: overrides.verifyFirebaseIdToken || (async () => ({ uid: UID })),
    readAccountDocument: overrides.readAccountDocument || (async (_configuration, uid) => {
      calls.reads.push(uid);
      return overrides.document === undefined ? null : overrides.document;
    }),
    structuredLog: (_configuration, operation, outcome, _startedAt, extra) => calls.logs.push({ operation, outcome, extra })
  });
  return { handler, calls };
}

test('read operation is unavailable while its gate is false and no authentication or datastore call runs', async () => {
  let touched = false;
  const handler = createHandler(loadConfiguration(environment()), {
    verifyFirebaseIdToken: async () => { touched = true; },
    readAccountDocument: async () => { touched = true; }
  });
  const result = await invoke(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { code: 'E1_NOT_ENABLED' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(touched, false);
});

test('missing malformed wrong-project expired disabled and revoked Firebase identities are rejected safely', async () => {
  const lookup = (user, status = 200) => async () => response(status, status === 200 ? { users: [user] } : { error: { message: 'private-auth-detail' } });
  const configuration = loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true' }));
  await assert.rejects(() => verifyFirebaseIdToken(configuration, '', lookup({})), /AUTH_REQUIRED/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, 'not-a-jwt', lookup({ localId: UID })), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken({ aud: 'wrong-project' }), lookup({ localId: UID })), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken({ exp: NOW_SECONDS - 1 }), lookup({ localId: UID }), () => NOW_SECONDS * 1000), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken(), lookup({ localId: UID, disabled: true })), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken(), lookup({ localId: UID, validSince: String(NOW_SECONDS) })), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken(), lookup({}, 400)), /AUTH_INVALID/);
});

test('valid caller with no account receives FOUNDATION_NOT_INITIALIZED and performs one exact read with no writes', async () => {
  const { handler, calls } = enabledHandler();
  const result = await invoke(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { code: 'FOUNDATION_NOT_INITIALIZED' });
  assert.deepEqual(calls.reads, [UID]);
  assert.deepEqual(calls.writes, []);
  assert.equal(JSON.stringify(calls.logs).includes(UID), false);
  assert.match(calls.logs[0].extra.uidHash, /^[a-f0-9]{16}$/);
});

test('existing active foundation returns only the approved redacted fields', async () => {
  const { handler, calls } = enabledHandler({ document: firestoreDocument() });
  const result = await invoke(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    code: 'SUCCESS',
    foundation: {
      schemaVersion: 1,
      canonicalTrainerName: 'SyntheticTrainer',
      normalizedTrainerName: 'synthetictrainer',
      handleKey: `v1_${'a'.repeat(64)}`,
      legacyUsername: 'legacy-synthetic',
      status: 'active',
      revision: 7,
      createdAt: 1700000000000,
      updatedAt: 1700000001000
    }
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /providerSubjects|migrationEvidence|internalFingerprint|secret-provider/);
  assert.deepEqual(calls.reads, [UID]);
});

test('frozen and blocked foundations remain redacted and never trigger repair or mutation', async () => {
  for (const status of ['frozen', 'blocked', 'conflict', 'conflict-frozen']) {
    const { handler, calls } = enabledHandler({ document: firestoreDocument({ status: { stringValue: status } }) });
    const result = await invoke(handler);
    assert.equal(result.status, 423);
    assert.equal(result.body.code, 'ACCOUNT_FROZEN');
    assert.equal(result.body.foundation.status, status);
    assert.equal(JSON.stringify(result).includes('migrationEvidence'), false);
    assert.deepEqual(calls.reads, [UID]);
    assert.deepEqual(calls.writes, []);
  }
});

test('client cannot select a UID path or trainer and malformed bodies never reach authentication or Firestore', async () => {
  const bodies = [
    { schemaVersion: 1, uid: 'another-user' },
    { schemaVersion: 1, path: 'accounts/another-user' },
    { schemaVersion: 1, trainerName: 'AnotherTrainer' },
    { schemaVersion: 2 },
    {}
  ];
  for (const body of bodies) {
    let verified = false;
    const { handler, calls } = enabledHandler({ verifyFirebaseIdToken: async () => { verified = true; return { uid: UID }; } });
    const result = await invoke(handler, { body });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { code: 'REQUEST_INVALID' });
    assert.equal(verified, false);
    assert.deepEqual(calls.reads, []);
  }
});

test('missing token and unsupported methods are bounded while reserve remains disabled', async () => {
  const { handler, calls } = enabledHandler({
    verifyFirebaseIdToken: async (_configuration, token) => {
      if (!token) {
        const error = new Error('AUTH_REQUIRED');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      return { uid: UID };
    }
  });
  assert.deepEqual((await invoke(handler, { token: null })).body, { code: 'AUTH_REQUIRED' });
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
  assert.deepEqual(calls.reads, []);
  for (const route of ['/v1/reserve-trainer-handle', '/v1/repair-account-foundation', '/v1/apply-migration-manifest', '/v1/freeze-identity-conflict']) {
    const result = await new Promise((resolve) => {
      const output = new EventEmitter();
      output.writeHead = (status) => { output.status = status; };
      output.end = (payload) => resolve({ status: output.status, body: JSON.parse(payload) });
      handler({ method: 'POST', url: route, headers: {}, async *[Symbol.asyncIterator]() {} }, output);
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { code: 'E1_NOT_ENABLED' });
  }
});
