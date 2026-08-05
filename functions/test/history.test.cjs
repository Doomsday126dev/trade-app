'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint } = require('../src/domain/fingerprints');
const { context, harness, historyRequest, rejectsCode, requestId, IDS } = require('./helpers.cjs');

test('history verifies the actual count and server-authorized public projection', async () => {
  const { adapter, operations } = harness();
  const result = await operations.verifyTrainerHistory(historyRequest(), context());
  assert.equal(result.status, 'recorded');
  assert.equal(adapter.inspect().userPreferences.viewer_001.trainerHistory.owner_001.entryCount, 2);
});

test('declared count mismatch is rejected', async () => {
  const { operations } = harness();
  await rejectsCode(operations.verifyTrainerHistory(historyRequest({ declaredEntryCount: 1 }), context()), 'invalid_argument');
});

test('more than 1500 entries is rejected', async () => {
  const { operations } = harness();
  const publicSnapshot = Object.fromEntries(Array.from({ length: 1501 }, (_, index) => [`entry_${index}`, { category: 'wishlist', fingerprint: 'a'.repeat(64) }]));
  await rejectsCode(operations.verifyTrainerHistory(historyRequest({ publicSnapshot, declaredEntryCount: 1501 }), context()), 'payload_too_large');
});

test('unknown and private fields are rejected', async () => {
  const { operations } = harness();
  const input = historyRequest();
  input.publicSnapshot.entry_a.privateNote = 'secret';
  await rejectsCode(operations.verifyTrainerHistory(input, context()), 'invalid_argument');
});

test('client snapshot differing from exact authorized share is rejected', async () => {
  const { operations } = harness();
  const input = historyRequest();
  input.publicSnapshot.entry_a.fingerprint = 'b'.repeat(64);
  await rejectsCode(operations.verifyTrainerHistory(input, context()), 'stale_state');
});

test('restricted or unavailable source cannot create a mass-removal history record', async () => {
  const { adapter, operations } = harness({ shareVisibility: { [IDS.owner]: { mode: 'private' } } });
  await rejectsCode(operations.verifyTrainerHistory(historyRequest(), context()), 'permission_denied');
  assert.equal(adapter.inspect().userPreferences.viewer_001, undefined);
});

test('approved viewer can verify an exact approved-viewers projection', async () => {
  const { operations } = harness({ shareVisibility: { [IDS.owner]: { mode: 'approved_viewers' } }, shareAccess: { [IDS.owner]: { [IDS.viewer]: true } } });
  assert.equal((await operations.verifyTrainerHistory(historyRequest(), context())).status, 'recorded');
});

test('protected admin authority comes only from the admins registry', async () => {
  const privateVisibility = { shareVisibility: { [IDS.owner]: { mode: 'private' } } };
  const allowed = harness({ ...privateVisibility, admins: { [IDS.admin]: true } });
  assert.equal((await allowed.operations.verifyTrainerHistory(historyRequest({ requestId: requestId('history-admin') }), context(IDS.admin))).status, 'recorded');
  const denied = harness({ ...privateVisibility, users: { [IDS.admin]: { isAdmin: true, isOwner: true } } });
  await rejectsCode(denied.operations.verifyTrainerHistory(historyRequest({ requestId: requestId('history-legacy-admin') }), context(IDS.admin)), 'permission_denied');
});

test('backward version and older timestamp are rejected', async () => {
  const initial = historyRequest();
  const existing = { lastSeenShareVersion: 3, lastSeenUpdatedAt: 300, lastSeenFingerprint: fingerprint(initial.publicSnapshot), entryCount: 2, lastSeenSnapshot: initial.publicSnapshot };
  const { operations } = harness({ userPreferences: { [IDS.viewer]: { trainerHistory: { [IDS.owner]: existing } } } });
  await rejectsCode(operations.verifyTrainerHistory(initial, context()), 'stale_state');
});

test('same version and same fingerprint is idempotent', async () => {
  const input = historyRequest();
  const existing = { lastSeenShareVersion: 2, lastSeenUpdatedAt: 200, lastSeenFingerprint: fingerprint(input.publicSnapshot), entryCount: 2, lastSeenSnapshot: input.publicSnapshot };
  const { operations } = harness({ userPreferences: { [IDS.viewer]: { trainerHistory: { [IDS.owner]: existing } } } });
  assert.equal((await operations.verifyTrainerHistory(input, context())).status, 'idempotent');
});

test('same version with conflicting stored fingerprint is rejected', async () => {
  const input = historyRequest();
  const existing = { lastSeenShareVersion: 2, lastSeenUpdatedAt: 200, lastSeenFingerprint: 'f'.repeat(64), entryCount: 2, lastSeenSnapshot: input.publicSnapshot };
  const { operations } = harness({ userPreferences: { [IDS.viewer]: { trainerHistory: { [IDS.owner]: existing } } } });
  await rejectsCode(operations.verifyTrainerHistory(input, context()), 'stale_state');
});

test('history transaction failure leaves no partial row', async () => {
  const { adapter, operations } = harness();
  adapter.injectFailure('advanceHistoryForViewer');
  await rejectsCode(operations.verifyTrainerHistory(historyRequest({ requestId: requestId('history-failure') }), context()), 'unavailable');
  assert.equal(adapter.inspect().userPreferences.viewer_001, undefined);
});

test('history uses public share source and never private owned lists', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/adapters/firebaseTrustedAdapter.js'), 'utf8');
  assert.doesNotMatch(source, /wishlist\/|dynamax\/|gmax\/|costumes\/|users\//);
  assert.match(source, /trainerShares\/\$\{ownerUid\}/);
});
