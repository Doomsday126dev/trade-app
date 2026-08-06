'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IDS, context, favoriteRequest, harness, rejectsCode, requestId } = require('./helpers.cjs');

function favoritesOf(adapter, uid = IDS.viewer) {
  return adapter.inspect().userPreferences?.[uid]?.favoriteTrainers || {};
}

function manyTargets(count) {
  const accounts = {}, shareDirectory = {};
  for (let index = 0; index < count; index++) {
    const uid = `target_${String(index).padStart(3, '0')}`;
    const trainerName = `Trainer ${index}`;
    const normalizedTrainerName = `trainer${index}`;
    accounts[uid] = { trainerName, normalizedTrainerName };
    shareDirectory[normalizedTrainerName] = { ownerUid: uid, trainerName, state: 'published' };
  }
  return { accounts, shareDirectory };
}

function activeFavorite(trainerName, revision = 1, operationId = requestId(`seed-${trainerName.replace(/\W/g, '').slice(0, 20)}`)) {
  return { trainerName, addedAt: 10, revision, updatedAt: 10, operationId, deleted: false };
}

test('valid add derives owner from Auth and stores one canonical Favorite', async () => {
  const { adapter, operations } = harness();
  const result = await operations.mutateFavoriteTrainer(favoriteRequest(), context());
  assert.equal(result.status, 'added');
  assert.deepEqual(favoritesOf(adapter)[IDS.owner], {
    trainerName: 'OwnerOne', addedAt: 1003, revision: 1, updatedAt: 1003,
    operationId: requestId('favorite'), deleted: false
  });
  assert.equal(adapter.inspect().userPreferences[IDS.owner], undefined);
});

test('unknown fields caller UID and malformed schemas are rejected', async () => {
  const { operations } = harness();
  for (const input of [
    { ...favoriteRequest(), callerUid: IDS.other },
    { ...favoriteRequest(), ownerUid: IDS.other },
    { ...favoriteRequest(), schemaVersion: 2 },
    { ...favoriteRequest(), operation: 'bulk' },
    { ...favoriteRequest(), trainerUid: { nested: true } },
    { ...favoriteRequest(), canonicalTrainerLabel: { nested: true } }
  ]) await rejectsCode(operations.mutateFavoriteTrainer(input, context()), 'invalid_argument');
});

test('unauthenticated and disabled-gate requests fail before idempotency storage', async () => {
  await rejectsCode(harness().operations.mutateFavoriteTrainer(favoriteRequest(), {}), 'unauthenticated');
  const { adapter, operations } = harness({ gates: { share_visibility: true, trainer_preferences: false } });
  await rejectsCode(operations.mutateFavoriteTrainer(favoriteRequest(), context()), 'unavailable', 'operation/write_gate_disabled');
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});

test('canonical target identity must match accounts and directory evidence', async () => {
  await rejectsCode(harness().operations.mutateFavoriteTrainer(favoriteRequest({ canonicalTrainerLabel: 'Alias' }), context()), 'conflict', 'favorite/identity_mismatch');
  const { operations } = harness({ shareDirectory: {} });
  await rejectsCode(operations.mutateFavoriteTrainer(favoriteRequest(), context()), 'conflict', 'favorite/identity_mismatch');
});

test('same request replays and a changed payload under the same ID is rejected', async () => {
  const { adapter, operations } = harness();
  const input = favoriteRequest();
  assert.equal((await operations.mutateFavoriteTrainer(input, context())).status, 'added');
  assert.equal((await operations.mutateFavoriteTrainer(input, context())).replay, true);
  await rejectsCode(operations.mutateFavoriteTrainer({ ...input, operation: 'remove' }, context()), 'replay_mismatch');
  assert.equal(Object.keys(favoritesOf(adapter)).length, 1);
});

test('active add is idempotent and stale revisions are rejected', async () => {
  const { adapter, operations } = harness();
  await operations.mutateFavoriteTrainer(favoriteRequest(), context());
  const before = favoritesOf(adapter)[IDS.owner];
  const repeat = favoriteRequest({ expectedRevision: 1, requestId: requestId('favorite-again') });
  assert.equal((await operations.mutateFavoriteTrainer(repeat, context())).status, 'already_active');
  assert.deepEqual(favoritesOf(adapter)[IDS.owner], before);
  await rejectsCode(operations.mutateFavoriteTrainer(favoriteRequest({ expectedRevision: 0, requestId: requestId('favorite-stale') }), context()), 'stale_state');
});

test('remove tombstones, repeats deliberately, and preserves earliest addedAt on restore', async () => {
  const { adapter, operations } = harness();
  await operations.mutateFavoriteTrainer(favoriteRequest(), context());
  const addedAt = favoritesOf(adapter)[IDS.owner].addedAt;
  const remove = favoriteRequest({ operation: 'remove', expectedRevision: 1, requestId: requestId('favorite-remove') });
  assert.equal((await operations.mutateFavoriteTrainer(remove, context())).status, 'removed');
  const tombstone = favoritesOf(adapter)[IDS.owner];
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.deletedAt, tombstone.updatedAt);
  assert.equal((await operations.mutateFavoriteTrainer(favoriteRequest({ operation: 'remove', expectedRevision: 2, requestId: requestId('favorite-remove-again') }), context())).status, 'already_removed');
  assert.equal((await operations.mutateFavoriteTrainer(favoriteRequest({ expectedRevision: 2, requestId: requestId('favorite-restore') }), context())).status, 'restored');
  assert.equal(favoritesOf(adapter)[IDS.owner].addedAt, addedAt);
  assert.equal(favoritesOf(adapter)[IDS.owner].revision, 3);
});

test('removing an absent Favorite is a deliberate no-op', async () => {
  const { adapter, operations } = harness();
  const result = await operations.mutateFavoriteTrainer(favoriteRequest({ operation: 'remove' }), context());
  assert.equal(result.status, 'already_absent');
  assert.deepEqual(favoritesOf(adapter), {});
});

test('exact 100-active limit rejects an additional add without losing rows', async () => {
  const targets = manyTargets(101);
  const seeded = Object.fromEntries(Object.entries(targets.accounts).slice(0, 100).map(([uid, account]) => [uid, activeFavorite(account.trainerName)]));
  const { adapter, operations } = harness({ ...targets, userPreferences: { [IDS.viewer]: { favoriteTrainers: seeded } } });
  await rejectsCode(operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_100', canonicalTrainerLabel: 'Trainer 100' }), context()), 'payload_too_large', 'favorite/limit_reached');
  assert.equal(Object.keys(favoritesOf(adapter)).length, 100);
});

test('99 Favorites plus two concurrent adds commits one and never exceeds 100', async () => {
  const targets = manyTargets(101);
  const seeded = Object.fromEntries(Object.entries(targets.accounts).slice(0, 99).map(([uid, account]) => [uid, activeFavorite(account.trainerName)]));
  const { adapter, operations } = harness({ ...targets, userPreferences: { [IDS.viewer]: { favoriteTrainers: seeded } } });
  const results = await Promise.allSettled([
    operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_099', canonicalTrainerLabel: 'Trainer 99', requestId: requestId('concurrent-a') }), context()),
    operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_100', canonicalTrainerLabel: 'Trainer 100', requestId: requestId('concurrent-b') }), context())
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(Object.values(favoritesOf(adapter)).filter((record) => record.deleted === false).length, 100);
  assert.equal(Object.keys(favoritesOf(adapter)).length, 100);
});

test('100 Favorites plus concurrent add and remove stays bounded without losing unrelated rows', async () => {
  const targets = manyTargets(101);
  const seeded = Object.fromEntries(Object.entries(targets.accounts).slice(0, 100).map(([uid, account]) => [uid, activeFavorite(account.trainerName)]));
  const { adapter, operations } = harness({ ...targets, userPreferences: { [IDS.viewer]: { favoriteTrainers: seeded } } });
  const results = await Promise.allSettled([
    operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_100', canonicalTrainerLabel: 'Trainer 100', requestId: requestId('bounded-add') }), context()),
    operations.mutateFavoriteTrainer(favoriteRequest({ operation: 'remove', trainerUid: 'target_000', canonicalTrainerLabel: 'Trainer 0', expectedRevision: 1, requestId: requestId('bounded-remove') }), context())
  ]);
  assert.equal(results[1].status, 'fulfilled');
  assert.ok(Object.values(favoritesOf(adapter)).filter((record) => record.deleted === false).length <= 100);
  assert.equal(favoritesOf(adapter).target_000.deleted, true);
  assert.equal(favoritesOf(adapter).target_050.trainerName, 'Trainer 50');
});

test('two different trainers added concurrently both survive below the bound', async () => {
  const targets = manyTargets(2);
  const { adapter, operations } = harness(targets);
  const results = await Promise.allSettled([
    operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_000', canonicalTrainerLabel: 'Trainer 0', requestId: requestId('different-a') }), context()),
    operations.mutateFavoriteTrainer(favoriteRequest({ trainerUid: 'target_001', canonicalTrainerLabel: 'Trainer 1', requestId: requestId('different-b') }), context())
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 2);
  assert.equal(favoritesOf(adapter).target_000.deleted, false);
  assert.equal(favoritesOf(adapter).target_001.deleted, false);
});

test('concurrent same-trainer adds have one winner and preserve unrelated Favorites', async () => {
  const { adapter, operations } = harness({ userPreferences: { [IDS.viewer]: { favoriteTrainers: { [IDS.other]: activeFavorite('OtherOne') } } } });
  const results = await Promise.allSettled([
    operations.mutateFavoriteTrainer(favoriteRequest({ requestId: requestId('same-a') }), context()),
    operations.mutateFavoriteTrainer(favoriteRequest({ requestId: requestId('same-b') }), context())
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(favoritesOf(adapter)[IDS.other].trainerName, 'OtherOne');
  assert.equal(Object.keys(favoritesOf(adapter)).length, 2);
});

test('add/remove races and stale remove versus newer add cannot corrupt the map', async () => {
  const existing = activeFavorite('OwnerOne');
  const { adapter, operations } = harness({ userPreferences: { [IDS.viewer]: { favoriteTrainers: { [IDS.owner]: existing, [IDS.other]: activeFavorite('OtherOne') } } } });
  const results = await Promise.allSettled([
    operations.mutateFavoriteTrainer(favoriteRequest({ expectedRevision: 1, requestId: requestId('race-add') }), context()),
    operations.mutateFavoriteTrainer(favoriteRequest({ operation: 'remove', expectedRevision: 1, requestId: requestId('race-remove') }), context())
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 2);
  assert.equal(favoritesOf(adapter)[IDS.other].trainerName, 'OtherOne');
  const current = favoritesOf(adapter)[IDS.owner];
  assert.equal(current.deleted, true);
  assert.equal(current.revision, 2);
  await rejectsCode(operations.mutateFavoriteTrainer(favoriteRequest({ operation: 'remove', expectedRevision: 1, requestId: requestId('stale-remove') }), context()), 'stale_state');
});

test('cross-UID calls remain in exact Auth-owned partitions', async () => {
  const { adapter, operations } = harness();
  await operations.mutateFavoriteTrainer(favoriteRequest(), context(IDS.viewer));
  await operations.mutateFavoriteTrainer(favoriteRequest({ requestId: requestId('owner-partition') }), context(IDS.other));
  assert.equal(favoritesOf(adapter, IDS.viewer)[IDS.owner].deleted, false);
  assert.equal(favoritesOf(adapter, IDS.other)[IDS.owner].deleted, false);
});

test('Favorite mutation does not touch shares grants tags notes or history', async () => {
  const seedPreferences = { trainerMetadata: { x: { note: 'private' } }, trainerTags: { tag_x: { active: true } }, trainerHistory: { x: { entryCount: 1 } } };
  const { adapter, operations } = harness({ userPreferences: { [IDS.viewer]: seedPreferences }, shareAccess: { [IDS.viewer]: { [IDS.other]: true } } });
  const before = adapter.inspect();
  await operations.mutateFavoriteTrainer(favoriteRequest(), context());
  const after = adapter.inspect();
  assert.deepEqual(after.shareAccess, before.shareAccess);
  assert.deepEqual(after.trainerShares, before.trainerShares);
  assert.deepEqual(after.userPreferences[IDS.viewer].trainerMetadata, seedPreferences.trainerMetadata);
  assert.deepEqual(after.userPreferences[IDS.viewer].trainerTags, seedPreferences.trainerTags);
  assert.deepEqual(after.userPreferences[IDS.viewer].trainerHistory, seedPreferences.trainerHistory);
});
