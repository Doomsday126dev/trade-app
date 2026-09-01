'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreE1AuthorityAdapter } = require('../src/adapters/firestoreE1AuthorityAdapter');
const { canonicalHandle } = require('../src/domain/e1AuthorityBoundary');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-pogo-e1-authority';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:9810';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9897';
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;

const app = initializeApp({ projectId: PROJECT_ID }, `e1-authority-proof-${Date.now()}`);
const firestore = getFirestore(app);
const adapter = createFirestoreE1AuthorityAdapter({ firestore, now: (() => { let value = 1000; return () => ++value; })() });

function input(uid, trainerName, requestId) {
  const handle = canonicalHandle(trainerName);
  return {
    uid,
    ...handle,
    legacyUsername: handle.trainerName,
    legacyAuthVersion: 1,
    requestId,
    fingerprint: crypto.createHash('sha256').update(`${uid}:${handle.normalizedTrainerName}:${requestId}`).digest('hex')
  };
}

function reviewed(request, operation, reviewerDecision) {
  return {
    ...request,
    sourceMappingFingerprint: crypto.createHash('sha256').update(`source:${request.uid}:${request.handleKey}`).digest('hex'),
    manifestId: `manifest-${operation}-${request.requestId}`,
    manifestFingerprint: crypto.createHash('sha256').update(`manifest:${operation}:${request.uid}:${request.requestId}:${reviewerDecision}`).digest('hex'),
    reviewerDecision,
    reviewedAt: '2026-08-10T20:00:00.000Z',
    fingerprint: crypto.createHash('sha256').update(`operation:${operation}:${request.uid}:${request.requestId}:${reviewerDecision}`).digest('hex')
  };
}

function accountDocument(request, timestamp = 1) {
  return {
    schemaVersion: 1, uid: request.uid, canonicalTrainerName: request.canonicalTrainerName,
    normalizedTrainerName: request.normalizedTrainerName, handleKey: request.handleKey,
    legacyUsername: request.legacyUsername, legacyAuthVersion: request.legacyAuthVersion,
    status: 'active', revision: 1, createdAt: timestamp, updatedAt: timestamp
  };
}

function handleDocument(request, timestamp = 1, uid = request.uid) {
  return {
    schemaVersion: 1, uid, canonicalTrainerName: request.canonicalTrainerName,
    normalizedTrainerName: request.normalizedTrainerName, state: 'active', revision: 1,
    claimedAt: timestamp, updatedAt: timestamp
  };
}

function providerInput(uid, trainerName, requestId, subjectLabel = uid) {
  const handle = canonicalHandle(trainerName);
  return {
    uid,
    ...handle,
    requestId,
    providerKey: 'google',
    providerId: 'google.com',
    providerSubjectKey: `v1_google_${crypto.createHash('sha256').update(subjectLabel).digest('hex')}`,
    authTime: 900,
    lifecycleId: 'auth-1',
    clientRelease: '2026-08-31.86',
    fingerprint: crypto.createHash('sha256').update(`provider:${uid}:${handle.handleKey}:${requestId}:${subjectLabel}`).digest('hex')
  };
}

async function certifyProviderCreation(overrides = {}) {
  await firestore.doc('authorityConfig/providerAccountCreation').set({
    schemaVersion: 1,
    state: 'certified',
    normalizationVersion: 1,
    legacyNamespaceCoverageCertified: true,
    activeLegacyHandleCount: 58,
    certifiedHandleCount: 58,
    coverageDigest: 'c'.repeat(64),
    certifiedAt: 1,
    expiresAt: 10_000,
    ...overrides
  });
}

async function clearFirestore() {
  const response = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(response.ok, await response.text());
}

test.beforeEach(clearFirestore);
test.after(async () => { await clearFirestore(); await deleteApp(app); });

test('two UIDs racing one normalized handle repeatedly produce one complete winner and no partial loser', async () => {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const suffix = String(iteration).padStart(2, '0');
    const first = input(`firebase_uid_a_${suffix}`, `ConcurrentTrainer${suffix}`, `request-concurrent-a-${suffix}`);
    const second = input(`firebase_uid_b_${suffix}`, `ConcurrentTrainer${suffix}`, `request-concurrent-b-${suffix}`);
    const settled = await Promise.allSettled([adapter.reserveTrainerHandle(first), adapter.reserveTrainerHandle(second)]);
    assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(settled.filter((result) => result.status === 'rejected' && result.reason?.code === 'e1/handle-conflict').length, 1);
    const winnerUid = settled[0].status === 'fulfilled' ? first.uid : second.uid;
    const loserUid = winnerUid === first.uid ? second.uid : first.uid;
    const winnerRequestId = winnerUid === first.uid ? first.requestId : second.requestId;
    const loserRequestId = loserUid === first.uid ? first.requestId : second.requestId;
    const [winner, loser, handle, winnerRequest, loserRequest] = await Promise.all([
      firestore.doc(`accounts/${winnerUid}`).get(),
      firestore.doc(`accounts/${loserUid}`).get(),
      firestore.doc(`trainerHandles/${first.handleKey}`).get(),
      firestore.doc(`operationRequests/${winnerUid}/requests/${winnerRequestId}`).get(),
      firestore.doc(`operationRequests/${loserUid}/requests/${loserRequestId}`).get()
    ]);
    assert.equal(winner.exists, true);
    assert.equal(loser.exists, false);
    assert.equal(handle.data().uid, winnerUid);
    assert.equal(winnerRequest.exists, true);
    assert.equal(loserRequest.exists, false);
  }
});

test('identical request replay is idempotent and changed replay is rejected', async () => {
  const request = input('firebase_uid_a', 'ReplayTrainer', 'request-replay-0001');
  assert.equal((await adapter.reserveTrainerHandle(request)).status, 'reserved');
  assert.equal((await adapter.reserveTrainerHandle(request)).replay, true);
  await assert.rejects(adapter.reserveTrainerHandle({ ...request, fingerprint: 'f'.repeat(64) }), (error) => error?.code === 'e1/replay-mismatch');
});

test('same UID and handle with a new request is idempotent without a revision or timestamp bump', async () => {
  const first = input('firebase_uid_a', 'ExistingTrainer', 'request-existing-0001');
  assert.equal((await adapter.reserveTrainerHandle(first)).status, 'reserved');
  const before = (await firestore.doc(`accounts/${first.uid}`).get()).data();
  const second = input('firebase_uid_a', 'ExistingTrainer', 'request-existing-0002');
  const result = await adapter.reserveTrainerHandle(second);
  const after = (await firestore.doc(`accounts/${first.uid}`).get()).data();
  assert.equal(result.status, 'idempotent');
  assert.equal(result.revision, 1);
  assert.deepEqual(after, before);
  assert.equal((await firestore.doc(`operationRequests/${first.uid}/requests/${second.requestId}`).get()).exists, true);
});

test('partial account and partial same-owner handle states require repair and remain unchanged', async () => {
  const accountOnly = input('firebase_uid_a', 'AccountOnly', 'request-account-only');
  await firestore.doc(`accounts/${accountOnly.uid}`).set({
    schemaVersion: 1, uid: accountOnly.uid, canonicalTrainerName: accountOnly.canonicalTrainerName,
    normalizedTrainerName: accountOnly.normalizedTrainerName, handleKey: accountOnly.handleKey,
    legacyUsername: accountOnly.legacyUsername, legacyAuthVersion: 1, status: 'active', revision: 1,
    createdAt: 1, updatedAt: 1
  });
  await assert.rejects(adapter.reserveTrainerHandle(accountOnly), (error) => error?.code === 'e1/foundation-conflict');
  assert.equal((await firestore.doc(`trainerHandles/${accountOnly.handleKey}`).get()).exists, false);
  assert.equal((await firestore.doc(`operationRequests/${accountOnly.uid}/requests/${accountOnly.requestId}`).get()).exists, false);

  const handleOnly = input('firebase_uid_b', 'HandleOnly', 'request-handle-only');
  await firestore.doc(`trainerHandles/${handleOnly.handleKey}`).set({
    schemaVersion: 1, uid: handleOnly.uid, canonicalTrainerName: handleOnly.canonicalTrainerName,
    normalizedTrainerName: handleOnly.normalizedTrainerName, state: 'active', revision: 1,
    claimedAt: 2, updatedAt: 2
  });
  await assert.rejects(adapter.reserveTrainerHandle(handleOnly), (error) => error?.code === 'e1/foundation-conflict');
  assert.equal((await firestore.doc(`accounts/${handleOnly.uid}`).get()).exists, false);
  assert.equal((await firestore.doc(`operationRequests/${handleOnly.uid}/requests/${handleOnly.requestId}`).get()).exists, false);
});

test('different UID handle collision and mismatched complete foundation never reassign or repair data', async () => {
  const owner = input('firebase_uid_a', 'CollisionTrainer', 'request-owner-0001');
  await adapter.reserveTrainerHandle(owner);
  const challenger = input('firebase_uid_b', 'CollisionTrainer', 'request-challenger-0001');
  await assert.rejects(adapter.reserveTrainerHandle(challenger), (error) => error?.code === 'e1/handle-conflict');
  assert.equal((await firestore.doc(`trainerHandles/${owner.handleKey}`).get()).data().uid, owner.uid);
  assert.equal((await firestore.doc(`accounts/${challenger.uid}`).get()).exists, false);

  await firestore.doc(`accounts/${owner.uid}`).update({ legacyAuthVersion: 2 });
  const mismatch = { ...owner, requestId: 'request-owner-0002', legacyAuthVersion: 1,
    fingerprint: require('node:crypto').createHash('sha256').update('mismatch').digest('hex') };
  await assert.rejects(adapter.reserveTrainerHandle(mismatch), (error) => error?.code === 'e1/foundation-conflict');
  assert.equal((await firestore.doc(`operationRequests/${owner.uid}/requests/${mismatch.requestId}`).get()).exists, false);
});

test('reserve writes only account handle and operation evidence roots', async () => {
  const request = input('firebase_uid_a', 'ScopedTrainer', 'request-scoped-0001');
  await adapter.reserveTrainerHandle(request);
  const roots = (await firestore.listCollections()).map((collection) => collection.id).sort();
  assert.deepEqual(roots, ['accounts', 'operationRequests', 'trainerHandles']);
});

test('durable rate limiter exercises real Firestore create and update transactions through exact documents', async () => {
  const input = {
    operation: 'reserveTrainerHandle',
    subjectHash: 'a'.repeat(16),
    limit: 5,
    windowMs: 900_000,
    at: 1_000,
    attemptHash: '1'.repeat(64)
  };
  assert.equal((await adapter.consumeRateLimit(input)).consumed, true);
  assert.equal((await adapter.consumeRateLimit(input)).consumed, false);
  const nextWindow = await adapter.consumeRateLimit({ ...input, at: 901_000, attemptHash: '2'.repeat(64) });
  assert.equal(nextWindow.consumed, true);
  const document = (await firestore.doc(`rateLimits/${input.operation}_${input.subjectHash}`).get()).data();
  assert.equal(document.count, 1);
  assert.deepEqual(document.attemptHashes, ['2'.repeat(64)]);
});

test('repair restores an account-only partial while preserving its original timestamps', async () => {
  const request = reviewed(input('firebase_uid_a', 'RepairTrainer', 'request-repair-0001'), 'repair', 'repair-approved');
  await firestore.doc(`accounts/${request.uid}`).set(accountDocument(request, 55));
  const before = (await firestore.doc(`accounts/${request.uid}`).get()).data();
  const result = await adapter.repairAccountFoundation(request);
  assert.equal(result.status, 'repaired');
  assert.equal(result.repairClass, 'handle-restored');
  const snapshots = await Promise.all([
    firestore.doc(`accounts/${request.uid}`).get(),
    firestore.doc(`trainerHandles/${request.handleKey}`).get(),
    firestore.doc(`identityMigrations/${request.uid}/operations/${request.requestId}`).get(),
    firestore.doc(`operationRequests/${request.uid}/requests/${request.requestId}`).get()
  ]);
  assert.ok(snapshots.every((snapshot) => snapshot.exists));
  assert.deepEqual(snapshots[0].data(), before);
  assert.equal((await adapter.repairAccountFoundation(request)).replay, true);
});

test('repair restores a handle-only partial and creates only bounded evidence roots', async () => {
  const request = reviewed(input('firebase_uid_b', 'HandleRepair', 'request-repair-0002'), 'repair', 'repair-approved');
  await firestore.doc(`trainerHandles/${request.handleKey}`).set(handleDocument(request, 77));
  const before = (await firestore.doc(`trainerHandles/${request.handleKey}`).get()).data();
  const result = await adapter.repairAccountFoundation(request);
  assert.equal(result.repairClass, 'account-restored');
  assert.deepEqual((await firestore.doc(`trainerHandles/${request.handleKey}`).get()).data(), before);
  assert.deepEqual((await firestore.listCollections()).map((collection) => collection.id).sort(), [
    'accounts', 'identityMigrations', 'operationRequests', 'trainerHandles'
  ]);
});

test('repair refuses fully missing and ambiguous states without partial writes', async () => {
  const missing = reviewed(input('firebase_uid_a', 'NothingToRepair', 'request-repair-0003'), 'repair', 'repair-approved');
  await assert.rejects(adapter.repairAccountFoundation(missing), (error) => error?.code === 'e1/repair-review-required');
  const owner = reviewed(input('firebase_uid_owner', 'OwnedElsewhere', 'request-owner-repair'), 'repair', 'repair-approved');
  await firestore.doc(`trainerHandles/${owner.handleKey}`).set(handleDocument(owner, 1, owner.uid));
  const challenger = reviewed({ ...owner, uid: 'firebase_uid_challenger', requestId: 'request-repair-0004' }, 'repair', 'repair-approved');
  await assert.rejects(adapter.repairAccountFoundation(challenger), (error) => error?.code === 'e1/handle-conflict');
  assert.equal((await firestore.doc(`accounts/${challenger.uid}`).get()).exists, false);
  assert.equal((await firestore.doc(`operationRequests/${challenger.uid}/requests/${challenger.requestId}`).get()).exists, false);
});

test('a conflicting repair leaves no partial account migration or request state', async () => {
  const owner = input('firebase_uid_a', 'TakenTrainer', 'request-owner-0001');
  await adapter.reserveTrainerHandle(owner);
  const loser = reviewed(input('firebase_uid_b', 'TakenTrainer', 'request-loser-0001'), 'repair', 'repair-approved');
  await assert.rejects(adapter.repairAccountFoundation(loser), (error) => error?.code === 'e1/handle-conflict');
  const snapshots = await Promise.all([
    firestore.doc(`accounts/${loser.uid}`).get(),
    firestore.doc(`identityMigrations/${loser.uid}/operations/${loser.requestId}`).get(),
    firestore.doc(`operationRequests/${loser.uid}/requests/${loser.requestId}`).get()
  ]);
  assert.ok(snapshots.every((snapshot) => !snapshot.exists));
});

test('migration is atomic idempotent and rejects changed replay or partial targets', async () => {
  const request = reviewed(input('firebase_uid_migrate', 'MigrationTrainer', 'request-migrate-0001'), 'migration', 'eligible');
  const first = await adapter.applyMigrationManifest(request);
  assert.equal(first.status, 'migrated');
  assert.equal((await adapter.applyMigrationManifest(request)).replay, true);
  await assert.rejects(adapter.applyMigrationManifest({ ...request, fingerprint: 'f'.repeat(64) }), (error) => error?.code === 'e1/replay-mismatch');
  const account = (await firestore.doc(`accounts/${request.uid}`).get()).data();
  assert.equal(account.revision, 1);

  const partial = reviewed(input('firebase_uid_partial', 'PartialMigration', 'request-migrate-0002'), 'migration', 'eligible');
  await firestore.doc(`accounts/${partial.uid}`).set(accountDocument(partial));
  await assert.rejects(adapter.applyMigrationManifest(partial), (error) => error?.code === 'e1/migration-conflict');
  assert.equal((await firestore.doc(`identityMigrations/${partial.uid}/operations/${partial.requestId}`).get()).exists, false);
});

test('exact already-migrated evidence does not bump account revision or timestamps', async () => {
  const initial = reviewed(input('firebase_uid_existing', 'ExistingMigration', 'request-migrate-initial'), 'migration', 'eligible');
  await adapter.applyMigrationManifest(initial);
  const accountRef = firestore.doc(`accounts/${initial.uid}`);
  const before = (await accountRef.get()).data();
  const evidence = reviewed({ ...initial, requestId: 'request-migrate-evidence' }, 'migration', 'exact-already-migrated');
  const result = await adapter.applyMigrationManifest(evidence);
  assert.equal(result.status, 'already-migrated');
  assert.deepEqual((await accountRef.get()).data(), before);
  assert.equal((await firestore.doc(`identityMigrations/${evidence.uid}/operations/${evidence.requestId}`).get()).exists, true);
});

test('concurrent eligible migrations for one normalized handle produce one complete winner', async () => {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const trainer = `MigrateRace${String(iteration).padStart(2, '0')}`;
    const first = reviewed(input(`firebase_migrate_a_${iteration}`, trainer, `request-migrate-a-${iteration}`), 'migration', 'eligible');
    const second = reviewed(input(`firebase_migrate_b_${iteration}`, trainer, `request-migrate-b-${iteration}`), 'migration', 'eligible');
    const settled = await Promise.allSettled([adapter.applyMigrationManifest(first), adapter.applyMigrationManifest(second)]);
    assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(settled.filter((result) => result.status === 'rejected' && result.reason?.code === 'e1/handle-conflict').length, 1);
    const winner = settled[0].status === 'fulfilled' ? first : second;
    const loser = winner.uid === first.uid ? second : first;
    assert.equal((await firestore.doc(`accounts/${winner.uid}`).get()).exists, true);
    assert.equal((await firestore.doc(`accounts/${loser.uid}`).get()).exists, false);
  }
});

test('freezing a reviewed handle conflict records bounded evidence without mutating accounts or handles', async () => {
  const owner = input('firebase_uid_owner', 'FrozenHandle', 'request-owner-freeze');
  await adapter.reserveTrainerHandle(owner);
  const challenger = reviewed(input('firebase_uid_challenger', 'FrozenHandle', 'request-freeze-0001'), 'freeze', 'conflict-confirmed');
  challenger.reasonCode = 'handle-owner-conflict';
  const ownerAccountBefore = (await firestore.doc(`accounts/${owner.uid}`).get()).data();
  const ownerHandleBefore = (await firestore.doc(`trainerHandles/${owner.handleKey}`).get()).data();
  const result = await adapter.freezeIdentityConflict(challenger);
  assert.equal(result.status, 'frozen');
  assert.equal((await adapter.freezeIdentityConflict(challenger)).replay, true);
  assert.deepEqual((await firestore.doc(`accounts/${owner.uid}`).get()).data(), ownerAccountBefore);
  assert.deepEqual((await firestore.doc(`trainerHandles/${owner.handleKey}`).get()).data(), ownerHandleBefore);
  assert.equal((await firestore.doc(`accounts/${challenger.uid}`).get()).exists, false);
  const conflict = (await firestore.doc(`identityConflicts/${challenger.uid}/events/${challenger.requestId}`).get()).data();
  assert.deepEqual(Object.keys(conflict).sort(), [
    'createdAt', 'fingerprint', 'manifestFingerprint', 'manifestId', 'reasonCode', 'reviewedAt',
    'reviewerDecision', 'schemaVersion', 'sourceMappingFingerprint', 'status', 'uid'
  ]);
});

test('provider creation atomically writes canonical account handle provider reverse claim and operation evidence', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_a', 'ProviderTrainer', 'request-provider-create-a');
  const result = await adapter.createProviderAccountFoundation(request);
  assert.equal(result.status, 'created');
  const snapshots = await Promise.all([
    firestore.doc(`accounts/${request.uid}`).get(),
    firestore.doc(`trainerHandles/${request.handleKey}`).get(),
    firestore.doc(`accounts/${request.uid}/providers/google`).get(),
    firestore.doc(`providerSubjects/${request.providerSubjectKey}`).get(),
    firestore.doc(`operationRequests/${request.uid}/requests/${request.requestId}`).get()
  ]);
  assert.ok(snapshots.every((snapshot) => snapshot.exists));
  assert.equal(snapshots[0].data().identityKind, 'provider_only');
  assert.equal(snapshots[0].data().legacyAccessConfigured, false);
  assert.equal(snapshots[0].data().legacyUsername, null);
  assert.equal(snapshots[2].data().providerSubjectKey, request.providerSubjectKey);
  assert.equal(snapshots[3].data().uid, request.uid);
  assert.equal(snapshots[4].data().operation, 'createProviderAccountFoundation');
});

test('missing stale malformed or incomplete namespace certification blocks provider creation without partial writes', async () => {
  const variants = [
    null,
    { state: 'pending' },
    { legacyNamespaceCoverageCertified: false },
    { certifiedHandleCount: 57 },
    { coverageDigest: 'bad' },
    { expiresAt: 1 }
  ];
  for (let index = 0; index < variants.length; index += 1) {
    await clearFirestore();
    if (variants[index]) await certifyProviderCreation(variants[index]);
    const request = providerInput(`firebase_provider_cert_${index}`, `CertTrainer${index}`, `request-provider-cert-${index}`);
    await assert.rejects(adapter.createProviderAccountFoundation(request),
      (error) => error?.code === 'e1/legacy-namespace-not-certified');
    assert.equal((await firestore.doc(`accounts/${request.uid}`).get()).exists, false);
    assert.equal((await firestore.doc(`trainerHandles/${request.handleKey}`).get()).exists, false);
    assert.equal((await firestore.doc(`operationRequests/${request.uid}/requests/${request.requestId}`).get()).exists, false);
  }
});

test('identical provider creation replay returns the recorded result and changed evidence is rejected', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_replay', 'ProviderReplay', 'request-provider-replay');
  assert.equal((await adapter.createProviderAccountFoundation(request)).status, 'created');
  assert.equal((await adapter.createProviderAccountFoundation(request)).replay, true);
  await assert.rejects(adapter.createProviderAccountFoundation({ ...request, fingerprint: 'f'.repeat(64) }),
    (error) => error?.code === 'e1/replay-mismatch');
});

test('provider replay validates all canonical records and rejects deleted or altered evidence', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_integrity', 'ProviderIntegrity', 'request-provider-integrity');
  await adapter.createProviderAccountFoundation(request);
  await firestore.doc(`accounts/${request.uid}/providers/google`).update({ state: 'pending' });
  await assert.rejects(adapter.createProviderAccountFoundation(request),
    (error) => error?.code === 'e1/provider-foundation-conflict');
});

test('same UID cannot create a second provider account or claim a second handle', async () => {
  await certifyProviderCreation();
  const first = providerInput('firebase_provider_single', 'SingleIdentity', 'request-provider-single-a');
  await adapter.createProviderAccountFoundation(first);
  const second = providerInput(first.uid, 'SecondIdentity', 'request-provider-single-b');
  await assert.rejects(adapter.createProviderAccountFoundation(second), (error) => error?.code === 'e1/account-conflict');
  assert.equal((await firestore.doc(`trainerHandles/${second.handleKey}`).get()).exists, false);
});

test('legacy-only handle hold blocks provider claim without requiring an RTDB read', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_legacy_hold', 'LegacyHeld', 'request-provider-legacy-hold');
  await firestore.doc(`trainerHandles/${request.handleKey}`).set({
    schemaVersion: 1,
    canonicalTrainerName: request.canonicalTrainerName,
    normalizedTrainerName: request.normalizedTrainerName,
    state: 'legacy_hold',
    revision: 1
  });
  await assert.rejects(adapter.createProviderAccountFoundation(request), (error) => error?.code === 'e1/handle-conflict');
  assert.equal((await firestore.doc(`accounts/${request.uid}`).get()).exists, false);
});

test('provider subject already owned by another UID cannot be rebound', async () => {
  await certifyProviderCreation();
  const owner = providerInput('firebase_provider_subject_owner', 'SubjectOwner', 'request-provider-subject-owner', 'shared-subject');
  await adapter.createProviderAccountFoundation(owner);
  const challenger = providerInput('firebase_provider_subject_challenger', 'SubjectChallenger', 'request-provider-subject-challenger', 'shared-subject');
  await assert.rejects(adapter.createProviderAccountFoundation(challenger),
    (error) => error?.code === 'e1/provider-subject-conflict');
  assert.equal((await firestore.doc(`accounts/${challenger.uid}`).get()).exists, false);
});

test('two provider UIDs racing for one handle produce one complete foundation and no partial loser', async () => {
  await certifyProviderCreation();
  const first = providerInput('firebase_provider_race_a', 'ProviderRace', 'request-provider-race-a');
  const second = providerInput('firebase_provider_race_b', 'ProviderRace', 'request-provider-race-b');
  const settled = await Promise.allSettled([
    adapter.createProviderAccountFoundation(first),
    adapter.createProviderAccountFoundation(second)
  ]);
  assert.equal(settled.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((entry) => entry.status === 'rejected' && entry.reason?.code === 'e1/handle-conflict').length, 1);
  const winner = settled[0].status === 'fulfilled' ? first : second;
  const loser = winner.uid === first.uid ? second : first;
  assert.equal((await firestore.doc(`accounts/${winner.uid}`).get()).exists, true);
  assert.equal((await firestore.doc(`accounts/${loser.uid}`).get()).exists, false);
  assert.equal((await firestore.doc(`providerSubjects/${loser.providerSubjectKey}`).get()).exists, false);
});

test('two tabs for one UID create at most one account and only the winning request evidence', async () => {
  await certifyProviderCreation();
  const first = providerInput('firebase_provider_tabs', 'ProviderTabs', 'request-provider-tabs-a');
  const second = providerInput(first.uid, first.canonicalTrainerName, 'request-provider-tabs-b', 'same-subject');
  first.providerSubjectKey = second.providerSubjectKey;
  const settled = await Promise.allSettled([
    adapter.createProviderAccountFoundation(first),
    adapter.createProviderAccountFoundation(second)
  ]);
  assert.equal(settled.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((entry) => entry.status === 'rejected').length, 1);
  const requestSnapshots = await Promise.all([
    firestore.doc(`operationRequests/${first.uid}/requests/${first.requestId}`).get(),
    firestore.doc(`operationRequests/${second.uid}/requests/${second.requestId}`).get()
  ]);
  assert.equal(requestSnapshots.filter((snapshot) => snapshot.exists).length, 1);
});

test('exact provider foundation readback accepts complete state and rejects partial or conflicting state', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_readback', 'ProviderReadback', 'request-provider-readback');
  assert.equal(await adapter.readProviderAccountFoundation(request), null);
  await adapter.createProviderAccountFoundation(request);
  assert.equal((await adapter.readProviderAccountFoundation(request)).identityKind, 'provider_only');
  await firestore.doc(`providerSubjects/${request.providerSubjectKey}`).update({ uid: 'firebase_other_owner' });
  await assert.rejects(adapter.readProviderAccountFoundation(request),
    (error) => error?.code === 'e1/provider-foundation-conflict');
});

test('provider creation writes no RTDB-shaped identity or product roots', async () => {
  await certifyProviderCreation();
  const request = providerInput('firebase_provider_roots', 'ProviderRoots', 'request-provider-roots');
  await adapter.createProviderAccountFoundation(request);
  const roots = (await firestore.listCollections()).map((collection) => collection.id).sort();
  assert.deepEqual(roots, ['accounts', 'authorityConfig', 'operationRequests', 'providerSubjects', 'trainerHandles']);
  for (const forbidden of ['authIndex', 'loginDirectory', 'users', 'accountSync', 'publicShares']) {
    assert.equal(roots.includes(forbidden), false);
  }
});

test('browser-authenticated Firestore REST access remains denied by the locked ruleset', async () => {
  const signup = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'authority-proof@example.test', password: 'local-proof-password', returnSecureToken: true })
  });
  const signupBody = await signup.json();
  assert.equal(signup.status, 200, JSON.stringify(signupBody));
  const token = signupBody.idToken;
  const response = await fetch(`http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/accounts/firebase_uid_a`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403, await response.text());
});
