'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { context, harness, rejectsCode, requestId } = require('./helpers.cjs');

test('tag create succeeds only in the authenticated viewer namespace', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_raids', label: '  Raid Friends ', requestId: requestId('tag-create') }, context());
  const state = adapter.inspect().userPreferences.viewer_001;
  assert.equal(state.trainerTags.tag_raids.label, 'Raid Friends');
  assert.equal(state.trainerTags.tag_raids.normalizedLabel, 'raid friends');
});

test('duplicate normalized tag labels are rejected after NFKC and case folding', async () => {
  const { operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'Ｒａｉｄ', requestId: requestId('tag-one') }, context());
  await rejectsCode(operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_two', label: 'raid', requestId: requestId('tag-two') }, context()), 'conflict');
});

test('same tag and normalized label with a new request ID is idempotent', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'Raid Group', requestId: requestId('tag-idem-one') }, context());
  const result = await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'ＲＡＩＤ ＧＲＯＵＰ', requestId: requestId('tag-idem-two') }, context());
  assert.equal(result.status, 'idempotent');
  assert.equal(adapter.mutationCounts().claimTagForViewer, 1);
});

test('rename atomically releases the old claim and creates the new claim', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'Old Label', requestId: requestId('tag-old') }, context());
  await operations.claimTrainerTagLabel({ action: 'rename', tagId: 'tag_one', label: 'New Label', requestId: requestId('tag-new') }, context());
  const prefs = adapter.inspect().userPreferences.viewer_001;
  assert.equal(Object.values(prefs.trainerTagLabels).length, 1);
  assert.equal(prefs.trainerTags.tag_one.label, 'New Label');
});

test('rename collision leaves both tags and claims unchanged', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-c1') }, context());
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_two', label: 'Two', requestId: requestId('tag-c2') }, context());
  const before = adapter.inspect().userPreferences.viewer_001;
  await rejectsCode(operations.claimTrainerTagLabel({ action: 'rename', tagId: 'tag_two', label: 'ONE', requestId: requestId('tag-c3') }, context()), 'conflict');
  assert.deepEqual(adapter.inspect().userPreferences.viewer_001, before);
});

test('soft delete deactivates the tag and releases only its label claim', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-d1') }, context());
  await operations.claimTrainerTagLabel({ action: 'soft_delete', tagId: 'tag_one', requestId: requestId('tag-d2') }, context());
  const prefs = adapter.inspect().userPreferences.viewer_001;
  assert.equal(prefs.trainerTags.tag_one.active, false);
  assert.deepEqual(prefs.trainerTagLabels, {});
});

test('soft delete does not perform unbounded favorite assignment cleanup', async () => {
  const favoriteTrainers = { owner_001: { tagIds: { tag_one: true } } };
  const { adapter, operations } = harness({ userPreferences: { viewer_001: { favoriteTrainers } } });
  await operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-f1') }, context());
  await operations.claimTrainerTagLabel({ action: 'soft_delete', tagId: 'tag_one', requestId: requestId('tag-f2') }, context());
  assert.deepEqual(adapter.inspect().userPreferences.viewer_001.favoriteTrainers, favoriteTrainers);
});

test('client-supplied viewer UID is rejected as an unknown field', async () => {
  const { operations } = harness();
  await rejectsCode(operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-cross'), viewerUid: 'other_001' }, context()), 'invalid_argument');
});

test('malformed action, tag ID, long label, and unknown fields are rejected', async (t) => {
  const cases = [
    { action: 'remove', tagId: 'tag_one', label: 'One', requestId: requestId('tag-bad-action') },
    { action: 'create', tagId: 'BAD', label: 'One', requestId: requestId('tag-bad-id') },
    { action: 'create', tagId: 'tag_one', label: 'a'.repeat(41), requestId: requestId('tag-long') },
    { action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-extra'), extra: true }
  ];
  for (const input of cases) await t.test(JSON.stringify(input.action), async () => rejectsCode(harness().operations.claimTrainerTagLabel(input, context()), 'invalid_argument'));
});

test('transaction failure leaves tag state unchanged and replay stays blocked', async () => {
  const { adapter, operations } = harness();
  adapter.injectFailure('claimTagForViewer');
  const input = { action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-failure') };
  await rejectsCode(operations.claimTrainerTagLabel(input, context()), 'unavailable');
  assert.equal(adapter.inspect().userPreferences.viewer_001, undefined);
  await rejectsCode(operations.claimTrainerTagLabel(input, context()), 'unavailable');
});

test('disabled preference gate blocks tag mutation and request storage', async () => {
  const { adapter, operations } = harness({ gates: { share_visibility: true, trainer_preferences: false } });
  await rejectsCode(operations.claimTrainerTagLabel({ action: 'create', tagId: 'tag_one', label: 'One', requestId: requestId('tag-disabled') }, context()), 'unavailable');
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});
