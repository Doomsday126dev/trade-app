'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerifiedLegacyMappingReader, validatedTarget } = require('../e1-authority-service/rtdbVerifiedLegacyMappingReader');
const { EXPECTED, GATES, createHandler, loadConfiguration } = require('../e1-authority-service/server');
const { EventEmitter } = require('node:events');

const TOKEN = 'recognizable.fake.firebase.token-never-log';
const UID = 'firebase_uid_a';
const TARGET = 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com';

function response(status, value) {
  const body = JSON.stringify(value);
  return { status, ok: status >= 200 && status < 300, headers: { get: () => String(Buffer.byteLength(body)) }, async text() { return body; } };
}

function harness(values = {}, throwValue) {
  const calls = [];
  const events = [];
  const reader = createVerifiedLegacyMappingReader({
    environment: 'staging', projectId: 'trainer-hub-staging-37ib4wct', databaseUrl: TARGET,
    async fetchImpl(url, options) {
      calls.push({ pathname: url.pathname, authMatches: url.searchParams.get('auth') === TOKEN, method: options.method });
      if (throwValue) throw new Error(throwValue);
      const entry = values[url.pathname];
      return entry || response(404, null);
    },
    onEvent(event) { events.push(event); }
  });
  return { calls, events, reader };
}

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: EXPECTED.environment,
    FIREBASE_PROJECT_ID: EXPECTED.projectId,
    FIRESTORE_DATABASE_ID: EXPECTED.databaseId,
    SERVICE_REGION: EXPECTED.region,
    AUTHORITY_SERVICE_NAME: EXPECTED.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: EXPECTED.runtimeServiceAccount,
    RTDB_DATABASE_URL: TARGET,
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    ...overrides
  };
}

function invoke(handler, path, body, token = TOKEN) {
  return new Promise((resolve) => {
    const request = new EventEmitter();
    request.method = 'POST';
    request.url = path;
    request.headers = { 'x-firebase-id-token': token };
    request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(JSON.stringify(body)); };
    const output = new EventEmitter();
    output.writeHead = (status) => { output.status = status; };
    output.end = (payload) => resolve({ status: output.status, body: JSON.parse(payload) });
    handler(request, output);
  });
}

const complete = Object.freeze({
  '/authIndex/firebase_uid_a/username.json': response(200, 'TrainerOne'),
  '/users/TrainerOne/authUid.json': response(200, UID),
  '/loginDirectory/TrainerOne.json': response(200, { authReady: true, authVersion: 3 })
});

test('reader performs only the three exact token-authenticated GETs and returns bounded ready evidence', async () => {
  const { calls, reader } = harness(complete);
  assert.deepEqual(await reader.readVerifiedLegacyMapping({ verifiedUid: UID, firebaseIdToken: TOKEN }), {
    status: 'ready', username: 'TrainerOne', legacyAuthVersion: 3
  });
  assert.deepEqual(calls, [
    { pathname: '/authIndex/firebase_uid_a/username.json', authMatches: true, method: 'GET' },
    { pathname: '/users/TrainerOne/authUid.json', authMatches: true, method: 'GET' },
    { pathname: '/loginDirectory/TrainerOne.json', authMatches: true, method: 'GET' }
  ]);
  assert.deepEqual(Object.keys(reader), ['readVerifiedLegacyMapping']);
});

test('missing reciprocal and unready states remain distinguishable and bounded', async () => {
  for (const [values, expected] of [
    [{ ...complete, '/authIndex/firebase_uid_a/username.json': response(200, null) }, { status: 'mapping-incomplete', reason: 'auth-index-missing' }],
    [{ ...complete, '/users/TrainerOne/authUid.json': response(200, null) }, { status: 'mapping-incomplete', reason: 'user-auth-uid-missing' }],
    [{ ...complete, '/users/TrainerOne/authUid.json': response(200, 'firebase_uid_b') }, { status: 'mapping-conflict', reason: 'uid-mismatch' }],
    [{ ...complete, '/loginDirectory/TrainerOne.json': response(200, { authReady: false, authVersion: 3 }) }, { status: 'mapping-incomplete', reason: 'login-directory-unready' }]
  ]) {
    const { reader } = harness(values);
    assert.deepEqual(await reader.readVerifiedLegacyMapping({ verifiedUid: UID, firebaseIdToken: TOKEN }), expected);
  }
});

test('permission denial and network failure never expose token URL or raw exception text', async () => {
  const denied = harness({ '/authIndex/firebase_uid_a/username.json': response(403, { error: 'Permission denied' }) });
  assert.deepEqual(await denied.reader.readVerifiedLegacyMapping({ verifiedUid: UID, firebaseIdToken: TOKEN }), {
    status: 'permission-denied', reason: 'auth-index-username'
  });
  const thrown = harness({}, `failed URL ${TARGET}/authIndex/${UID}.json?auth=${TOKEN}`);
  const unavailable = await thrown.reader.readVerifiedLegacyMapping({ verifiedUid: UID, firebaseIdToken: TOKEN });
  assert.deepEqual(unavailable, { status: 'unavailable', reason: 'network' });
  for (const serialized of [JSON.stringify(denied.events), JSON.stringify(thrown.events), JSON.stringify(unavailable)]) {
    assert.doesNotMatch(serialized, /recognizable\.fake|auth=|firebase_uid_a|TrainerOne|firebaseio/);
  }
});

test('staging target validation rejects missing emulator and production-like URLs', () => {
  for (const databaseUrl of [undefined, 'https://trade-list-a4297.firebaseio.com', 'https://trainer-hub-staging-37ib4wct.firebaseio.com', 'http://trainer-hub-staging-37ib4wct-e1.firebaseio.com']) {
    assert.throws(() => validatedTarget({ environment: 'staging', projectId: 'trainer-hub-staging-37ib4wct', databaseUrl }), /E1_RTDB_CONFIGURATION_INVALID/);
  }
  assert.throws(() => validatedTarget({ environment: 'staging', projectId: 'trade-list-a4297', databaseUrl: TARGET }), /E1_RTDB_CONFIGURATION_INVALID/);
});

test('fixed readiness endpoint returns only bounded mapping classes and never mutates', async () => {
  const outcomes = [
    [{ status: 'ready', username: 'TrainerOne', legacyAuthVersion: 3 }, 200, { code: 'MAPPING_READY', legacyAuthVersion: 3 }],
    [{ status: 'mapping-incomplete', reason: 'login-directory-unready' }, 200, { code: 'MAPPING_INCOMPLETE' }],
    [{ status: 'mapping-conflict', reason: 'uid-mismatch' }, 409, { code: 'MAPPING_CONFLICT' }],
    [{ status: 'permission-denied', reason: 'user-auth-uid' }, 403, { code: 'MAPPING_PERMISSION_DENIED' }]
  ];
  for (const [legacy, status, body] of outcomes) {
    let calls = 0;
    const handler = createHandler(loadConfiguration(environment()), {
      verifyFirebaseIdToken: async () => ({ uid: UID }),
      readLegacyBinding: async ({ verifiedUid, firebaseIdToken }) => {
        calls += 1;
        assert.equal(verifiedUid, UID);
        assert.equal(firebaseIdToken, TOKEN);
        return legacy;
      },
      structuredLog: () => {},
      authorityStore: { reserveTrainerHandle: async () => { throw new Error('unexpected write'); } }
    });
    assert.deepEqual(await invoke(handler, '/v1/read-legacy-mapping-readiness', { schemaVersion: 1 }), { status, body });
    assert.equal(calls, 1);
  }
});
