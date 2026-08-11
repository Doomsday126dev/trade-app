'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalHandle, createE1AuthorityBoundary } = require('../src/domain/e1AuthorityBoundary');
const {
  conflictManifestFingerprint,
  migrationManifestFingerprint,
  repairReviewFingerprint,
  sourceMappingFingerprint
} = require('../e1-authority-service/server');

const UID = 'firebase_uid_a';
const REVIEWED_AT = '2026-08-10T20:00:00.000Z';

function foundation() {
  return { uid: UID, ...canonicalHandle('TrainerOne'), legacyUsername: 'TrainerOne', legacyAuthVersion: 3 };
}

function repairBody() {
  const source = sourceMappingFingerprint(foundation());
  const reviewReference = {
    manifestId: 'manifest-repair-0001', reviewerDecision: 'repair-approved', reviewedAt: REVIEWED_AT,
    sourceMappingFingerprint: source
  };
  reviewReference.manifestFingerprint = repairReviewFingerprint({ uid: UID, ...reviewReference });
  return { schemaVersion: 1, operationId: 'request-repair-0001', expectedSourceFingerprint: source, reviewReference };
}

function migrationBody() {
  const model = foundation();
  const body = {
    schemaVersion: 1, uid: UID, legacyUsername: model.legacyUsername,
    normalizedTrainerName: model.normalizedTrainerName, handleKey: model.handleKey, legacyAuthVersion: 3,
    sourceMappingFingerprint: sourceMappingFingerprint(model), manifestId: 'manifest-migrate-0001',
    reviewerDecision: 'eligible', reviewedAt: REVIEWED_AT, operationId: 'request-migrate-0001'
  };
  body.manifestFingerprint = migrationManifestFingerprint(body);
  return body;
}

function freezeBody() {
  const model = foundation();
  const body = {
    schemaVersion: 1, uid: UID, operationId: 'request-freeze-0001', reasonCode: 'handle-owner-conflict',
    sourceMappingFingerprint: sourceMappingFingerprint(model), manifestId: 'manifest-freeze-0001',
    reviewerDecision: 'conflict-confirmed', reviewedAt: REVIEWED_AT
  };
  body.manifestFingerprint = conflictManifestFingerprint(body);
  return body;
}

function harness() {
  const calls = [];
  const store = Object.fromEntries([
    'readAccountFoundation',
    'reserveTrainerHandle',
    'repairAccountFoundation',
    'applyMigrationManifest',
    'freezeIdentityConflict'
  ].map((method) => [method, async (...args) => { calls.push({ method, args }); return { status: method }; }]));
  const boundary = createE1AuthorityBoundary({
    async verifyFirebaseIdToken(token) { return token === 'token-a' ? { uid: 'firebase_uid_a' } : null; },
    async verifyOperatorIdentity(identity, operation) { return { authorized: identity === 'operator-a', operation }; },
    async readLegacyBinding({ verifiedUid }) {
      return verifiedUid === UID ? { status: 'ready', username: 'TrainerOne', legacyAuthVersion: 3 } : null;
    },
    store
  });
  return { boundary, calls };
}

test('user operations derive UID only from a verified Firebase ID token', async () => {
  const { boundary, calls } = harness();
  await boundary.reserveTrainerHandle({ firebaseIdToken: 'token-a', body: { schemaVersion: 1, requestedHandle: 'TrainerOne', requestId: 'request-reserve-0001' } });
  assert.equal(calls[0].args[0].uid, 'firebase_uid_a');
  await assert.rejects(
    boundary.reserveTrainerHandle({ firebaseIdToken: 'token-a', body: { schemaVersion: 1, requestedHandle: 'TrainerOne', requestId: 'request-reserve-0002', uid: 'firebase_uid_b' } }),
    /request-schema-invalid/
  );
});

test('repair derives the handle from a reciprocal legacy binding', async () => {
  const { boundary, calls } = harness();
  await boundary.repairAccountFoundation({ firebaseIdToken: 'token-a', body: repairBody() });
  assert.equal(calls[0].args[0].trainerName, 'TrainerOne');
  assert.equal(calls[0].args[0].normalizedTrainerName, 'trainerone');
  assert.equal(calls[0].args[0].handleKey, `v1_${Buffer.from('trainerone', 'utf8').toString('hex')}`);
});

test('legacy-bound users cannot reserve a different handle', async () => {
  const { boundary } = harness();
  await assert.rejects(
    boundary.reserveTrainerHandle({ firebaseIdToken: 'token-a', body: { schemaVersion: 1, requestedHandle: 'OtherTrainer', requestId: 'request-reserve-0003' } }),
    /legacy-binding-conflict/
  );
});

test('operator-only migration and freeze operations require exact authorization', async () => {
  const { boundary, calls } = harness();
  await boundary.applyMigrationManifest({ operatorIdentity: 'operator-a', firebaseIdToken: 'token-a', body: migrationBody() });
  await boundary.freezeIdentityConflict({ operatorIdentity: 'operator-a', firebaseIdToken: 'token-a', body: freezeBody() });
  assert.deepEqual(calls.map((call) => call.method), ['applyMigrationManifest', 'freezeIdentityConflict']);
  await assert.rejects(
    boundary.freezeIdentityConflict({ operatorIdentity: 'not-operator', firebaseIdToken: 'token-a', body: freezeBody() }),
    /operator-unauthorized/
  );
});

test('authority boundary exposes five fixed operations and no generic datastore capability', () => {
  const { boundary } = harness();
  assert.deepEqual(Object.keys(boundary).sort(), [
    'applyMigrationManifest',
    'freezeIdentityConflict',
    'readAccountFoundation',
    'repairAccountFoundation',
    'reserveTrainerHandle'
  ]);
  for (const method of ['read', 'write', 'set', 'update', 'delete', 'query', 'list', 'ref', 'collection']) assert.equal(boundary[method], undefined);
});
