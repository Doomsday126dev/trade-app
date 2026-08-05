'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { context, harness, rejectsCode, requestId } = require('./helpers.cjs');

test('valid handle reservation applies NFKC and case folding while preserving display case', async () => {
  const { adapter, operations } = harness();
  await operations.reserveTrainerHandle({ requestedHandle: '  ＮｅｗTrainer  ', requestId: requestId('handle-valid') }, context('newuid_001'));
  const state = adapter.inspect();
  assert.deepEqual(state.accounts.newuid_001, { trainerName: 'NewTrainer', normalizedTrainerName: 'newtrainer' });
  assert.equal(state.shareDirectory.newtrainer.ownerUid, 'newuid_001');
});

test('same request replay returns the terminal result without a second mutation', async () => {
  const { adapter, operations } = harness();
  const input = { requestedHandle: 'ReplayOne', requestId: requestId('handle-replay') };
  await operations.reserveTrainerHandle(input, context('newuid_002'));
  const replay = await operations.reserveTrainerHandle(input, context('newuid_002'));
  assert.equal(replay.replay, true);
  assert.equal(adapter.mutationCounts().reserveHandleForUid, 1);
});

test('same request ID with different input is rejected', async () => {
  const { operations } = harness();
  const id = requestId('handle-mismatch');
  await operations.reserveTrainerHandle({ requestedHandle: 'FirstOne', requestId: id }, context('newuid_003'));
  await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: 'SecondOne', requestId: id }, context('newuid_003')), 'replay_mismatch');
});

test('concurrent duplicate execution produces one domain mutation', async () => {
  const { adapter, operations } = harness();
  const input = { requestedHandle: 'ConcurrentOne', requestId: requestId('handle-concurrent') };
  const results = await Promise.allSettled([operations.reserveTrainerHandle(input, context('newuid_004')), operations.reserveTrainerHandle(input, context('newuid_004'))]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(adapter.mutationCounts().reserveHandleForUid, 1);
});

test('collision with another UID is rejected', async () => {
  const { operations } = harness();
  await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: 'OwnerOne', requestId: requestId('handle-collision') }, context('newuid_005')), 'conflict');
});

test('an established handle cannot be changed by reservation', async () => {
  const { operations } = harness();
  await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: 'DifferentName', requestId: requestId('handle-change') }, context('viewer_001')), 'conflict');
});

test('an incomplete established identity is rejected without automatic repair', async () => {
  const { adapter, operations } = harness({
    accounts: { viewer_001: { trainerName: 'ViewerONE', normalizedTrainerName: 'viewerone' } },
    shareDirectory: { ownerone: { ownerUid: 'owner_001' }, otherone: { ownerUid: 'other_001' } }
  });
  await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: 'viewerone', requestId: requestId('handle-display') }, context('viewer_001')), 'conflict');
  assert.equal(adapter.inspect().accounts.viewer_001.trainerName, 'ViewerONE');
  assert.equal(adapter.inspect().shareDirectory.viewerone, undefined);
});

for (const [label, value] of [['reserved', 'Admin'], ['mixed-script', 'A\u0430Name'], ['illegal-key', 'bad/name'], ['invisible', 'bad\u200bname'], ['too-long', 'a'.repeat(65)]]) {
  test(`invalid handle is rejected: ${label}`, async () => {
    const { operations } = harness();
    await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: value, requestId: requestId(`handle-${label}`) }, context('newuid_006')), 'invalid_argument');
  });
}

test('handle reservation does not mutate authIndex or Auth identities', async () => {
  const { adapter, operations } = harness({ authIndex: { original: { username: 'Original' } }, authIdentities: { original: { enabled: true } } });
  const before = adapter.inspect();
  await operations.reserveTrainerHandle({ requestedHandle: 'NoIdentityWrite', requestId: requestId('handle-scope') }, context('newuid_007'));
  const after = adapter.inspect();
  assert.deepEqual(after.authIndex, before.authIndex);
  assert.deepEqual(after.authIdentities, before.authIdentities);
});

test('disabled share visibility gate blocks before idempotency storage', async () => {
  const { adapter, operations } = harness({ gates: { share_visibility: false, trainer_preferences: true } });
  await rejectsCode(operations.reserveTrainerHandle({ requestedHandle: 'DisabledOne', requestId: requestId('handle-disabled') }, context('newuid_008')), 'unavailable');
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});
