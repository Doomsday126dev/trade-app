'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GATES, RATE_LIMITS, createHandler, loadConfiguration } = require('../e1-authority-service/server');
const { STAGING } = require('../e1-authority-service/e1TargetContracts');

const CALLER_UID = 'firebaseCallerUid123';
const TARGET_UID = 'firebaseTargetUid456';

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: STAGING.environment,
    FIREBASE_PROJECT_ID: STAGING.projectId,
    EXPECTED_PROJECT_NUMBER: STAGING.projectNumber,
    FIRESTORE_DATABASE_ID: STAGING.databaseId,
    SERVICE_REGION: STAGING.region,
    AUTHORITY_SERVICE_NAME: STAGING.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: STAGING.runtimeServiceAccount,
    RTDB_DATABASE_URL: STAGING.rtdbDatabaseUrl,
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    READ_PROVIDER_PUBLIC_SHARE_ENABLED: 'true',
    ...overrides
  };
}

function invoke(handler, url, body, { token = 'firebase-id-token', method = 'POST' } = {}) {
  return new Promise((resolve) => {
    const request = { method, url, headers: token ? { 'x-firebase-id-token': token } : {} };
    const response = new EventEmitter();
    response.writeHead = (status, headers) => { response.status = status; response.headers = headers; };
    response.end = (payload) => resolve({ status: response.status, body: JSON.parse(payload) });
    handler(request, response);
    request.emit?.('end');
  });
}

function fixture(overrides = {}) {
  let requestBody = null;
  const calls = { directory: [], identity: [], limits: [], logs: [] };
  const handler = createHandler(loadConfiguration(environment()), {
    readJsonRequest: async () => requestBody,
    verifyFirebaseIdToken: async (_configuration, token) => {
      if (!token) throw Object.assign(new Error('missing'), { code: 'AUTH_REQUIRED' });
      return { uid: CALLER_UID };
    },
    listTrainerDirectory: async (input) => {
      calls.directory.push(input);
      return overrides.directory || {
        handles: [
          { canonicalTrainerName: 'Alpha Trainer', normalizedTrainerName: 'alpha trainer' },
          { canonicalTrainerName: 'Alpine', normalizedTrainerName: 'alpine' }
        ],
        nextAfterNormalized: 'alpine'
      };
    },
    readPublicShareIdentity: async (input) => {
      calls.identity.push(input);
      return Object.hasOwn(overrides, 'identity') ? overrides.identity : {
        ownerUid: TARGET_UID,
        canonicalTrainerName: 'ProviderTrainer'
      };
    },
    consumeRateLimit: async (input) => { calls.limits.push(input); return { allowed: true, consumed: true }; },
    structuredLog: (_configuration, operation, outcome, _startedAt, extra) => calls.logs.push({ operation, outcome, extra })
  });
  return { handler, calls, setBody(value) { requestBody = value; } };
}

test('canonical directory requires Firebase Auth and returns only bounded public handles', async () => {
  const h = fixture();
  h.setBody({ schemaVersion: 1, query: 'al', pageSize: 2, cursor: null });
  const result = await invoke(h.handler, '/v1/list-trainer-directory', null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    code: 'SUCCESS',
    directory: { version: 1, handles: ['Alpha Trainer', 'Alpine'], nextCursor: result.body.directory.nextCursor }
  });
  assert.equal(typeof result.body.directory.nextCursor, 'string');
  assert.ok(result.body.directory.nextCursor.length < 1024);
  assert.doesNotMatch(JSON.stringify(result.body), /uid|email|provider|subject|private/iu);
  assert.deepEqual(h.calls.directory, [{ normalizedQuery: 'al', afterNormalized: '', pageSize: 2 }]);
  assert.equal(h.calls.limits.length, 1);
  assert.equal(h.calls.limits[0].operation, 'listTrainerDirectory');

  const anonymous = fixture();
  anonymous.setBody({ schemaVersion: 1, query: 'al', pageSize: 2, cursor: null });
  const denied = await invoke(anonymous.handler, '/v1/list-trainer-directory', null, { token: '' });
  assert.equal(denied.status, 401);
  assert.deepEqual(denied.body, { code: 'AUTH_REQUIRED' });
  assert.deepEqual(anonymous.calls.directory, []);
});

test('directory cursor is query-bound and malformed query or cursor fails before a Firestore read', async () => {
  const first = fixture();
  first.setBody({ schemaVersion: 1, query: 'al', pageSize: 2, cursor: null });
  const page = await invoke(first.handler, '/v1/list-trainer-directory', null);

  const next = fixture({ directory: { handles: [], nextAfterNormalized: null } });
  next.setBody({ schemaVersion: 1, query: 'al', pageSize: 2, cursor: page.body.directory.nextCursor });
  assert.equal((await invoke(next.handler, '/v1/list-trainer-directory', null)).status, 200);
  assert.deepEqual(next.calls.directory, [{ normalizedQuery: 'al', afterNormalized: 'alpine', pageSize: 2 }]);

  for (const body of [
    { schemaVersion: 1, query: 'a', pageSize: 2, cursor: null },
    { schemaVersion: 1, query: 'al', pageSize: 26, cursor: null },
    { schemaVersion: 1, query: 'be', pageSize: 2, cursor: page.body.directory.nextCursor },
    { schemaVersion: 1, query: 'al', pageSize: 2, cursor: `${page.body.directory.nextCursor}x` },
    { schemaVersion: 1, query: 'al', pageSize: 2, cursor: null, collection: 'accounts' }
  ]) {
    const invalid = fixture();
    invalid.setBody(body);
    const result = await invoke(invalid.handler, '/v1/list-trainer-directory', null);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.body, { code: 'REQUEST_INVALID' });
    assert.deepEqual(invalid.calls.directory, []);
  }
});

test('directory response validation follows Firestore ordering for international handles', async () => {
  const h = fixture({ directory: {
    handles: [
      { canonicalTrainerName: 'Zulu', normalizedTrainerName: 'zulu' },
      { canonicalTrainerName: 'Éclair', normalizedTrainerName: 'éclair' }
    ],
    nextAfterNormalized: null
  } });
  h.setBody({ schemaVersion: 1, query: '', pageSize: 25, cursor: null });
  const result = await invoke(h.handler, '/v1/list-trainer-directory', null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.directory.handles, ['Zulu', 'Éclair']);
});

test('authenticated Favorite resolver returns the exact UID only and detects handle rebinding', async () => {
  const h = fixture();
  h.setBody({ schemaVersion: 1, trainerHandle: 'providertrainer', expectedTargetUid: '' });
  const result = await invoke(h.handler, '/v1/resolve-favorite-trainer-identity', null);
  assert.deepEqual(result, {
    status: 200,
    body: {
      code: 'SUCCESS',
      favorite: { version: 1, targetUid: TARGET_UID, canonicalTrainerName: 'ProviderTrainer' }
    }
  });
  assert.equal(h.calls.limits.at(-1).operation, 'resolveFavoriteTrainerIdentity');
  assert.equal(JSON.stringify(h.calls.logs).includes(TARGET_UID), false);

  const rebound = fixture();
  rebound.setBody({ schemaVersion: 1, trainerHandle: 'ProviderTrainer', expectedTargetUid: 'differentTargetUid789' });
  const conflict = await invoke(rebound.handler, '/v1/resolve-favorite-trainer-identity', null);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, { code: 'FAVORITE_IDENTITY_CONFLICT' });
});

test('Favorite resolver is exact, authenticated, not-found safe, and exposes no profile metadata', async () => {
  const missing = fixture({ identity: null });
  missing.setBody({ schemaVersion: 1, trainerHandle: 'MissingTrainer', expectedTargetUid: '' });
  assert.deepEqual(await invoke(missing.handler, '/v1/resolve-favorite-trainer-identity', null), {
    status: 200, body: { code: 'TARGET_NOT_FOUND' }
  });

  const anonymous = fixture();
  anonymous.setBody({ schemaVersion: 1, trainerHandle: 'ProviderTrainer', expectedTargetUid: '' });
  assert.equal((await invoke(anonymous.handler, '/v1/resolve-favorite-trainer-identity', null, { token: '' })).status, 401);

  const malformed = fixture();
  malformed.setBody({ schemaVersion: 1, trainerHandle: 'bad/name', expectedTargetUid: '' });
  assert.equal((await invoke(malformed.handler, '/v1/resolve-favorite-trainer-identity', null)).status, 400);
  assert.deepEqual(malformed.calls.identity, []);
});

test('Favorite resolver rate window supports full hydration plus one explicit refresh', () => {
  assert.ok(RATE_LIMITS.resolveFavoriteTrainerIdentity.limit >= 200);
  assert.ok(RATE_LIMITS.resolveFavoriteTrainerIdentity.limit <= 300);
  assert.equal(RATE_LIMITS.resolveFavoriteTrainerIdentity.windowMs, 15 * 60 * 1000);
});
