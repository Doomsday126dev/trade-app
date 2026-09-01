'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  GATES,
  createHandler,
  loadConfiguration,
  verifyFirebaseIdToken
} = require('../e1-authority-service/server');
const { STAGING: EXPECTED } = require('../e1-authority-service/e1TargetContracts');

const UID = 'syntheticE1Uid123';
const API_KEY = 'synthetic-firebase-web-api-key-for-tests';
const NOW_SECONDS = 1_800_000_000;

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

function verifier(claimOverrides = {}, error = null, calls = []) {
  return {
    async verifyIdToken(token, checkRevoked) {
      calls.push({ token, checkRevoked });
      assert.equal(token, firebaseToken(claimOverrides));
      assert.equal(checkRevoked, false);
      if (error) throw error;
      return { ...JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')), uid: claimOverrides.sub || UID };
    }
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
    consumeRateLimit: overrides.consumeRateLimit || (async () => ({ allowed: true, consumed: true })),
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

test('Firebase Admin verification accepts a valid token and rejects missing malformed wrong-project expired and unverifiable identities', async () => {
  const configuration = loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true' }));
  const calls = [];
  await assert.rejects(() => verifyFirebaseIdToken(configuration, '', verifier()), /AUTH_REQUIRED/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, 'not-a-jwt', { verifyIdToken: async () => ({ uid: UID }) }), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken({ aud: 'wrong-project' }), verifier({ aud: 'wrong-project' })), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken({ exp: NOW_SECONDS - 1 }), verifier({ exp: NOW_SECONDS - 1 }), () => NOW_SECONDS * 1000), /AUTH_INVALID/);
  await assert.rejects(() => verifyFirebaseIdToken(configuration, firebaseToken(), verifier({}, new Error('signature rejected'))), /AUTH_INVALID/);
  assert.deepEqual(await verifyFirebaseIdToken(configuration, firebaseToken(), verifier({}, null, calls), () => NOW_SECONDS * 1000), {
    uid: UID,
    authTime: (NOW_SECONDS - 60) * 1000,
    signInProvider: null,
    identities: null
  });
  assert.deepEqual(calls, [{ token: firebaseToken(), checkRevoked: false }]);
  assert.doesNotMatch(verifyFirebaseIdToken.toString(), /accounts:lookup|firebaseWebApiKey|user_id/u);
});

test('default handler verifier uses the Firebase token-verifier seam rather than the HTTP fetch seam', async () => {
  const calls = [];
  const configuration = loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true' }));
  const handler = createHandler(configuration, {
    firebaseTokenVerifier: verifier({}, null, calls),
    fetchImpl: async () => { throw new Error('Firebase token verification must not use fetch'); },
    readAccountDocument: async () => null,
    consumeRateLimit: async () => ({ allowed: true, consumed: true }),
    structuredLog: () => {}
  });
  const result = await invoke(handler);
  assert.deepEqual(result.body, { code: 'FOUNDATION_NOT_INITIALIZED' });
  assert.deepEqual(calls, [{ token: firebaseToken(), checkRevoked: false }]);
});

test('valid caller with no account receives FOUNDATION_NOT_INITIALIZED and performs one exact read with no writes', async () => {
  const { handler, calls } = enabledHandler();
  const result = await invoke(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { code: 'FOUNDATION_NOT_INITIALIZED' });
  assert.deepEqual(calls.reads, [UID]);
  assert.deepEqual(calls.writes, []);
  assert.equal(JSON.stringify(calls.logs).includes(UID), false);
  assert.equal(JSON.stringify(calls.logs).includes(firebaseToken()), false);
  assert.match(calls.logs[0].extra.uidHash, /^[a-f0-9]{16}$/);
});

test('durable read quota rejects before the authority document read', async () => {
  const error = new Error('e1/rate-limit-exceeded');
  error.code = 'e1/rate-limit-exceeded';
  const { handler, calls } = enabledHandler({ consumeRateLimit: async () => { throw error; } });
  const result = await invoke(handler);
  assert.deepEqual(result.body, { code: 'RATE_LIMITED' });
  assert.equal(result.status, 429);
  assert.deepEqual(calls.reads, []);
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
