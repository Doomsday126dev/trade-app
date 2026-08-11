'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { GATES, createHandler, loadConfiguration } = require('../e1-authority-service/server');
const {
  DURABLE_MODE,
  GROUP_C_PROOF_MODE,
  PROOF_REQUEST_LIMIT,
  createReadLimiter,
  readProofSubjectHash
} = require('../e1-authority-service/readRateLimiters');
const { PRODUCTION } = require('../e1-authority-service/e1TargetContracts');

const UID = 'reviewedOwnerUid123';
const TRAINER = 'ReviewedOwner';
const OTHER_UID = 'differentOwnerUid456';
const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: PRODUCTION.environment,
    FIREBASE_PROJECT_ID: PRODUCTION.projectId,
    EXPECTED_PROJECT_NUMBER: '1053781218847',
    FIRESTORE_DATABASE_ID: PRODUCTION.databaseId,
    SERVICE_REGION: PRODUCTION.region,
    AUTHORITY_SERVICE_NAME: PRODUCTION.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: PRODUCTION.runtimeServiceAccount,
    RTDB_DATABASE_URL: PRODUCTION.rtdbDatabaseUrl,
    FIREBASE_WEB_API_KEY: 'synthetic-production-firebase-web-key',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function proofEnvironment(overrides = {}) {
  return environment({
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    READ_PROOF_MODE: 'true',
    READ_PROOF_SUBJECT_UID_HASH: readProofSubjectHash('uid', UID),
    READ_PROOF_SUBJECT_TRAINER_HASH: readProofSubjectHash('trainer', TRAINER),
    READ_PROOF_WINDOW_START: '2030-01-01T11:30:00.000Z',
    READ_PROOF_WINDOW_END: '2030-01-01T12:30:00.000Z',
    ...overrides
  });
}

function request(path = '/v1/read-account-foundation') {
  const raw = JSON.stringify({ schemaVersion: 1 });
  const input = new EventEmitter();
  input.method = 'POST';
  input.url = path;
  input.headers = { 'content-length': String(Buffer.byteLength(raw)), 'x-firebase-id-token': 'synthetic-token' };
  input[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(raw); };
  return input;
}

function invoke(handler, path) {
  return new Promise((resolve) => {
    const output = new EventEmitter();
    output.writeHead = (status, headers) => { output.status = status; output.headers = headers; };
    output.end = (payload) => resolve({ status: output.status, body: JSON.parse(payload) });
    handler(request(path), output);
  });
}

function proofHandler(overrides = {}) {
  const calls = { durableLimits: 0, legacyReads: 0, accountReads: 0, writes: 0 };
  const configuration = loadConfiguration(proofEnvironment(overrides.environment), () => NOW);
  const handler = createHandler(configuration, {
    now: overrides.now || (() => NOW),
    verifyFirebaseIdToken: async () => ({ uid: overrides.uid || UID }),
    readLegacyBinding: async () => {
      calls.legacyReads += 1;
      return overrides.legacy || { status: 'ready', username: TRAINER, legacyAuthVersion: 1 };
    },
    readAccountDocument: async () => {
      calls.accountReads += 1;
      return null;
    },
    consumeRateLimit: async () => {
      calls.durableLimits += 1;
      calls.writes += 1;
      return { allowed: true };
    },
    structuredLog() {}
  });
  return { calls, configuration, handler };
}

test('Group C proof mode is production-only exact bounded and mutation-gate fail closed', () => {
  const configuration = loadConfiguration(proofEnvironment(), () => NOW);
  assert.equal(configuration.readProofMode, true);
  assert.equal(configuration.readLimiterMode, GROUP_C_PROOF_MODE);
  assert.equal(configuration.readProof.uidHash, readProofSubjectHash('uid', UID));
  assert.throws(() => loadConfiguration(proofEnvironment({ READ_PROOF_WINDOW_END: undefined }), () => NOW),
    /E1_READ_PROOF_CONFIGURATION_INVALID/);
  assert.throws(() => loadConfiguration(proofEnvironment({ READ_PROOF_WINDOW_END: '2030-01-01T11:59:00.000Z' }), () => NOW),
    /E1_READ_PROOF_CONFIGURATION_INVALID/);
  assert.throws(() => loadConfiguration(proofEnvironment({ RESERVE_HANDLE_ENABLED: 'true' }), () => NOW),
    /E1_READ_PROOF_CONFIGURATION_INVALID/);
  assert.throws(() => loadConfiguration({
    ...proofEnvironment(),
    APP_ENVIRONMENT: 'staging',
    FIREBASE_PROJECT_ID: 'trainer-hub-staging-37ib4wct',
    EXPECTED_PROJECT_NUMBER: '391359988648',
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: 'e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com',
    RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com'
  }, () => NOW), /E1_READ_PROOF_CONFIGURATION_INVALID/);
});

test('absent or false proof mode keeps normal production reads on the durable limiter', async () => {
  for (const value of [undefined, 'false']) {
    let durableLimits = 0;
    const env = environment({ READ_ACCOUNT_FOUNDATION_ENABLED: 'true', READ_PROOF_MODE: value });
    const configuration = loadConfiguration(env, () => NOW);
    assert.equal(configuration.readProofMode, false);
    assert.equal(configuration.readLimiterMode, DURABLE_MODE);
    const handler = createHandler(configuration, {
      now: () => NOW,
      randomId: () => 'normal-read-attempt',
      verifyFirebaseIdToken: async () => ({ uid: UID }),
      consumeRateLimit: async (input) => {
        durableLimits += 1;
        assert.equal(input.operation, 'readAccountFoundation');
        return { allowed: true, consumed: true };
      },
      readAccountDocument: async () => null,
      structuredLog() {}
    });
    assert.deepEqual(await invoke(handler), { status: 200, body: { code: 'FOUNDATION_NOT_INITIALIZED' } });
    assert.equal(durableLimits, 1);
  }
  assert.throws(() => loadConfiguration(environment({ READ_PROOF_MODE: 'sometimes' }), () => NOW),
    /E1_READ_PROOF_CONFIGURATION_INVALID/);
  assert.throws(() => loadConfiguration(environment({
    READ_PROOF_MODE: 'false', READ_PROOF_SUBJECT_UID_HASH: readProofSubjectHash('uid', UID)
  }), () => NOW), /E1_READ_PROOF_CONFIGURATION_INVALID/);
  assert.throws(() => createReadLimiter({ mode: 'unknown' }), /E1_READ_LIMITER_MODE_INVALID/);
});

test('reviewed proof subject receives absent-foundation response with reciprocal read and zero persistent writes', async () => {
  const { calls, handler } = proofHandler();
  assert.deepEqual(await invoke(handler), { status: 200, body: { code: 'FOUNDATION_NOT_INITIALIZED' } });
  assert.deepEqual(calls, { durableLimits: 0, legacyReads: 1, accountReads: 1, writes: 0 });
});

test('proof mode rejects a different UID before RTDB and a different reciprocal trainer before Firestore', async () => {
  const wrongUid = proofHandler({ uid: OTHER_UID });
  assert.deepEqual(await invoke(wrongUid.handler), { status: 403, body: { code: 'E1_READ_PROOF_SUBJECT_DENIED' } });
  assert.deepEqual(wrongUid.calls, { durableLimits: 0, legacyReads: 0, accountReads: 0, writes: 0 });

  const wrongTrainer = proofHandler({ legacy: { status: 'ready', username: 'DifferentTrainer', legacyAuthVersion: 1 } });
  assert.deepEqual(await invoke(wrongTrainer.handler), { status: 403, body: { code: 'E1_READ_PROOF_SUBJECT_DENIED' } });
  assert.deepEqual(wrongTrainer.calls, { durableLimits: 0, legacyReads: 1, accountReads: 0, writes: 0 });
});

test('proof mode rejects expired requests and non-ready reciprocal ownership without persistence', async () => {
  const expired = proofHandler({ now: () => Date.parse('2030-01-01T12:31:00.000Z') });
  assert.deepEqual(await invoke(expired.handler), { status: 503, body: { code: 'E1_READ_PROOF_EXPIRED' } });
  assert.deepEqual(expired.calls, { durableLimits: 0, legacyReads: 0, accountReads: 0, writes: 0 });

  const incomplete = proofHandler({ legacy: { status: 'mapping-incomplete' } });
  assert.deepEqual(await invoke(incomplete.handler), { status: 409, body: { code: 'E1_READ_PROOF_MAPPING_NOT_READY' } });
  assert.deepEqual(incomplete.calls, { durableLimits: 0, legacyReads: 1, accountReads: 0, writes: 0 });
});

test('proof limiter is process-local bounded and never becomes a persistent substitute', async () => {
  const value = proofHandler();
  for (let index = 0; index < PROOF_REQUEST_LIMIT; index += 1) {
    assert.equal((await invoke(value.handler)).status, 200);
  }
  assert.deepEqual(await invoke(value.handler), { status: 429, body: { code: 'RATE_LIMITED' } });
  assert.equal(value.calls.durableLimits, 0);
  assert.equal(value.calls.writes, 0);
  const source = fs.readFileSync(path.resolve(__dirname, '../e1-authority-service/readRateLimiters.js'), 'utf8');
  assert.doesNotMatch(source, /@google-cloud\/firestore|firebase-admin|runTransaction|\.doc\(/u);
});

test('proof mode cannot handle reserve repair migration or conflict freeze', async () => {
  const value = proofHandler();
  for (const path of ['/v1/reserve-trainer-handle', '/v1/repair-account-foundation', '/v1/apply-migration-manifest', '/v1/freeze-identity-conflict']) {
    assert.deepEqual(await invoke(value.handler, path), { status: 503, body: { code: 'E1_NOT_ENABLED' } });
  }
  assert.deepEqual(value.calls, { durableLimits: 0, legacyReads: 0, accountReads: 0, writes: 0 });
});
