'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const {
  EXPECTED,
  GATES,
  conflictManifestFingerprint,
  createHandler,
  loadConfiguration,
  migrationManifestFingerprint,
  observedLegacyFingerprint,
  repairReviewFingerprint,
  sourceMappingFingerprint,
  verifyOperatorAccessToken
} = require('../e1-authority-service/server');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');

const UID = 'firebase_uid_repair_a';
const LEGACY = Object.freeze({ status: 'ready', username: 'TrainerRepair', legacyAuthVersion: 3 });
const REVIEWED_AT = '2026-08-10T20:00:00.000Z';

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: EXPECTED.environment,
    FIREBASE_PROJECT_ID: EXPECTED.projectId,
    FIRESTORE_DATABASE_ID: EXPECTED.databaseId,
    SERVICE_REGION: EXPECTED.region,
    AUTHORITY_SERVICE_NAME: EXPECTED.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: EXPECTED.runtimeServiceAccount,
    RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: crypto.createHash('sha256').update('operator@example.test').digest('hex'),
    EXPECTED_OPERATOR_SUBJECT_HASH: crypto.createHash('sha256').update('operator-subject').digest('hex'),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function foundation(uid = UID, legacy = LEGACY) {
  const handle = normalizeHandle(legacy.username);
  return Object.freeze({
    uid,
    canonicalTrainerName: handle.display,
    normalizedTrainerName: handle.normalized,
    handleKey: handle.handleKey,
    legacyUsername: legacy.username,
    legacyAuthVersion: legacy.legacyAuthVersion
  });
}

function invoke(handler, path, body = {}, headers = {}) {
  return new Promise((resolve) => {
    const request = new EventEmitter();
    request.method = 'POST';
    request.url = path;
    request.headers = headers;
    request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(JSON.stringify(body)); };
    const output = new EventEmitter();
    output.writeHead = (status, responseHeaders) => { output.status = status; output.headers = responseHeaders; };
    output.end = (payload) => resolve({ status: output.status, body: JSON.parse(payload) });
    handler(request, output);
  });
}

function repairBody() {
  const source = sourceMappingFingerprint(foundation());
  const reference = {
    manifestId: 'manifest-repair-0001',
    reviewerDecision: 'repair-approved',
    reviewedAt: REVIEWED_AT,
    sourceMappingFingerprint: source
  };
  reference.manifestFingerprint = repairReviewFingerprint({ uid: UID, ...reference });
  return { schemaVersion: 1, operationId: 'operation-repair-0001', expectedSourceFingerprint: source, reviewReference: reference };
}

function migrationBody(decision = 'eligible') {
  const model = foundation();
  const body = {
    schemaVersion: 1,
    uid: UID,
    legacyUsername: model.legacyUsername,
    normalizedTrainerName: model.normalizedTrainerName,
    handleKey: model.handleKey,
    legacyAuthVersion: model.legacyAuthVersion,
    sourceMappingFingerprint: sourceMappingFingerprint(model),
    manifestId: 'manifest-migration-0001',
    reviewerDecision: decision,
    reviewedAt: REVIEWED_AT,
    operationId: 'operation-migration-0001'
  };
  body.manifestFingerprint = migrationManifestFingerprint(body);
  return body;
}

function freezeBody(reasonCode, legacy) {
  const model = legacy.status === 'ready' ? foundation(UID, legacy) : undefined;
  const body = {
    schemaVersion: 1,
    uid: UID,
    operationId: 'operation-freeze-0001',
    reasonCode,
    sourceMappingFingerprint: observedLegacyFingerprint(UID, legacy, model),
    manifestId: 'manifest-freeze-0001',
    reviewerDecision: 'conflict-confirmed',
    reviewedAt: REVIEWED_AT
  };
  body.manifestFingerprint = conflictManifestFingerprint(body);
  return body;
}

test('all new mutation gates fail before parsing authentication legacy reads or datastore work', async () => {
  for (const path of ['/v1/repair-account-foundation', '/v1/apply-migration-manifest', '/v1/freeze-identity-conflict']) {
    let calls = 0;
    const handler = createHandler(loadConfiguration(environment()), {
      readJsonRequest: async () => { calls += 1; },
      verifyFirebaseIdToken: async () => { calls += 1; },
      verifyOperatorAccessToken: async () => { calls += 1; },
      readLegacyBinding: async () => { calls += 1; },
      authorityStore: new Proxy({}, { get: () => async () => { calls += 1; } }),
      structuredLog: () => {}
    });
    assert.deepEqual(await invoke(handler, path), { status: 503, body: { code: 'E1_NOT_ENABLED' } });
    assert.equal(calls, 0);
  }
});

test('self-repair derives UID from Firebase Auth and requires exact reviewed live mapping evidence', async () => {
  let stored;
  const handler = createHandler(loadConfiguration(environment({ REPAIR_FOUNDATION_ENABLED: 'true' })), {
    verifyFirebaseIdToken: async (_configuration, token) => {
      assert.equal(token, 'subject-firebase-token');
      return { uid: UID };
    },
    readLegacyBinding: async () => LEGACY,
    repairAccountFoundation: async (input) => { stored = input; return { status: 'repaired', revision: 1, repairClass: 'handle-restored' }; },
    structuredLog: () => {}
  });
  const result = await invoke(handler, '/v1/repair-account-foundation', repairBody(), { 'x-firebase-id-token': 'subject-firebase-token' });
  assert.deepEqual(result, { status: 200, body: { code: 'SUCCESS', revision: 1, repairClass: 'handle-restored' } });
  assert.equal(stored.uid, UID);
  assert.equal(stored.handleKey, foundation().handleKey);
  assert.equal(Object.hasOwn(repairBody(), 'uid'), false);

  const changed = repairBody();
  changed.expectedSourceFingerprint = 'f'.repeat(64);
  assert.deepEqual(await invoke(handler, '/v1/repair-account-foundation', changed, { 'x-firebase-id-token': 'subject-firebase-token' }), {
    status: 400, body: { code: 'REQUEST_INVALID' }
  });
});

test('migration requires separate operator and subject authentication plus an exact executable manifest', async () => {
  const calls = [];
  const handler = createHandler(loadConfiguration(environment({ APPLY_MIGRATION_ENABLED: 'true' })), {
    verifyOperatorAccessToken: async (_configuration, token) => {
      calls.push(['operator', token]);
      return { operatorHash: 'operator-hash' };
    },
    verifyFirebaseIdToken: async (_configuration, token) => {
      calls.push(['subject', token]);
      return { uid: UID };
    },
    readLegacyBinding: async () => LEGACY,
    applyMigrationManifest: async (input) => {
      calls.push(['store', input]);
      return { status: 'migrated', revision: 1 };
    },
    structuredLog: () => {}
  });
  const result = await invoke(handler, '/v1/apply-migration-manifest', migrationBody(), {
    'x-e1-operator-access-token': 'operator-oauth-token',
    'x-e1-subject-firebase-id-token': 'subject-firebase-token'
  });
  assert.deepEqual(result, { status: 200, body: { code: 'SUCCESS', revision: 1 } });
  assert.deepEqual(calls.slice(0, 2), [['operator', 'operator-oauth-token'], ['subject', 'subject-firebase-token']]);
  assert.equal(calls[2][1].uid, UID);

  const foreignHandler = createHandler(loadConfiguration(environment({ APPLY_MIGRATION_ENABLED: 'true' })), {
    verifyOperatorAccessToken: async () => ({ operatorHash: 'operator-hash' }),
    verifyFirebaseIdToken: async () => ({ uid: 'firebase_uid_foreign' }),
    readLegacyBinding: async () => { throw new Error('must not read'); },
    structuredLog: () => {}
  });
  assert.deepEqual(await invoke(foreignHandler, '/v1/apply-migration-manifest', migrationBody(), {
    'x-e1-operator-access-token': 'operator-oauth-token',
    'x-e1-subject-firebase-id-token': 'foreign-firebase-token'
  }), { status: 400, body: { code: 'REQUEST_INVALID' } });
});

test('conflict freeze is review-bound to the currently observed legacy conflict and stores no raw legacy record', async () => {
  const legacy = { status: 'mapping-conflict', reason: 'uid-mismatch' };
  let stored;
  const handler = createHandler(loadConfiguration(environment({ FREEZE_CONFLICT_ENABLED: 'true' })), {
    verifyOperatorAccessToken: async () => ({ operatorHash: 'operator-hash' }),
    verifyFirebaseIdToken: async () => ({ uid: UID }),
    readLegacyBinding: async () => legacy,
    freezeIdentityConflict: async (input) => { stored = input; return { status: 'frozen' }; },
    structuredLog: () => {}
  });
  assert.deepEqual(await invoke(handler, '/v1/freeze-identity-conflict', freezeBody('legacy-binding-conflict', legacy), {
    'x-e1-operator-access-token': 'operator-oauth-token',
    'x-e1-subject-firebase-id-token': 'subject-firebase-token'
  }), { status: 200, body: { code: 'SUCCESS', status: 'frozen', reasonCode: 'legacy-binding-conflict' } });
  assert.equal(stored.uid, UID);
  assert.equal(stored.reasonCode, 'legacy-binding-conflict');
  assert.equal(Object.hasOwn(stored, 'legacy'), false);

  const changed = freezeBody('legacy-binding-conflict', legacy);
  changed.sourceMappingFingerprint = 'f'.repeat(64);
  changed.manifestFingerprint = conflictManifestFingerprint(changed);
  assert.deepEqual(await invoke(handler, '/v1/freeze-identity-conflict', changed, {
    'x-e1-operator-access-token': 'operator-oauth-token',
    'x-e1-subject-firebase-id-token': 'subject-firebase-token'
  }), { status: 409, body: { code: 'REVIEW_REQUIRED' } });
});

test('operator access verification accepts only the pinned verified Google identity without logging credentials', async () => {
  const configuration = loadConfiguration(environment());
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer recognizable-operator-token');
    return {
      ok: true,
      status: 200,
      async json() { return { email_verified: true, email: 'operator@example.test', sub: 'operator-subject' }; }
    };
  };
  assert.deepEqual(await verifyOperatorAccessToken(configuration, 'recognizable-operator-token', fetchImpl), {
    operatorHash: configuration.operatorSubjectHash.slice(0, 16)
  });
  await assert.rejects(verifyOperatorAccessToken(configuration, 'wrong-token', async () => ({
    ok: true, status: 200, async json() { return { email_verified: true, email: 'other@example.test', sub: 'other-subject' }; }
  })), /OPERATOR_AUTH_INVALID/);
});
