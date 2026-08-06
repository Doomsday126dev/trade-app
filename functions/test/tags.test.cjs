'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { context, harness, rejectsCode, requestId, tagRequest } = require('./helpers.cjs');

test('tag create succeeds only in the authenticated viewer namespace', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_raids', '  Raid Friends ', 'tag-create'), context());
  const state = adapter.inspect().userPreferences.viewer_001;
  assert.equal(state.trainerTags.tag_raids.label, 'Raid Friends');
  assert.equal(state.trainerTags.tag_raids.normalizedLabel, 'raid friends');
  assert.equal(state.trainerTags.tag_raids.revision, 1);
  assert.equal(state.trainerTags.tag_raids.operationId, requestId('tag-create'));
});

test('duplicate normalized tag labels are rejected after NFKC and case folding', async () => {
  const { operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'Ｒａｉｄ', 'tag-one'), context());
  await rejectsCode(operations.claimTrainerTagLabel(tagRequest('create', 'tag_two', 'raid', 'tag-two'), context()), 'conflict');
});

test('concurrent normalized claims create exactly one tag and one label claim', async () => {
  const { adapter, operations } = harness();
  const settled = await Promise.allSettled([
    operations.claimTrainerTagLabel(tagRequest('create', 'tag_concurrent_a', 'Ｒａｉｄ Group', 'tag-concurrent-a'), context()),
    operations.claimTrainerTagLabel(tagRequest('create', 'tag_concurrent_b', 'raid group', 'tag-concurrent-b'), context())
  ]);
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(result => result.status === 'rejected' && result.reason?.code === 'conflict').length, 1);
  const prefs = adapter.inspect().userPreferences.viewer_001;
  assert.equal(Object.values(prefs.trainerTags).filter(tag => tag.active === true).length, 1);
  assert.equal(Object.keys(prefs.trainerTagLabels).length, 1);
});

test('same tag and normalized label with a new request ID is idempotent', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'Raid Group', 'tag-idem-one'), context());
  const result = await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'ＲＡＩＤ ＧＲＯＵＰ', 'tag-idem-two'), context());
  assert.equal(result.status, 'idempotent');
  assert.equal(adapter.mutationCounts().claimTagForViewer, 1);
});

test('tag creation enforces the trusted 24-active-tag limit', async () => {
  const trainerTags = {}, trainerTagLabels = {};
  for (let index = 0; index < 24; index++) {
    const id = `tag_existing_${index}`, labelKey = `label_${index}`;
    trainerTags[id] = { label: `Label ${index}`, normalizedLabel: `label ${index}`, labelKey, active: true, deleted: false, createdAt: 1, updatedAt: 1, revision: 1, operationId: requestId(`existing-${index}`) };
    trainerTagLabels[labelKey] = id;
  }
  const { operations } = harness({ userPreferences: { viewer_001: { trainerTags, trainerTagLabels } } });
  await rejectsCode(operations.claimTrainerTagLabel(tagRequest('create', 'tag_overflow', 'Overflow', 'tag-limit'), context()), 'payload_too_large', 'tag/limit');
});

test('rename atomically releases the old claim and creates the new claim', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'Old Label', 'tag-old'), context());
  await operations.claimTrainerTagLabel(tagRequest('rename', 'tag_one', 'New Label', 'tag-new'), context());
  const prefs = adapter.inspect().userPreferences.viewer_001;
  assert.equal(Object.values(prefs.trainerTagLabels).length, 1);
  assert.equal(prefs.trainerTags.tag_one.label, 'New Label');
});

test('rename collision leaves both tags and claims unchanged', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'One', 'tag-c1'), context());
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_two', 'Two', 'tag-c2'), context());
  const before = adapter.inspect().userPreferences.viewer_001;
  await rejectsCode(operations.claimTrainerTagLabel(tagRequest('rename', 'tag_two', 'ONE', 'tag-c3'), context()), 'conflict');
  assert.deepEqual(adapter.inspect().userPreferences.viewer_001, before);
});

test('stale tag revision is rejected without changing the tag or label claim', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'One', 'tag-revision-create'), context());
  const before = adapter.inspect().userPreferences.viewer_001;
  await rejectsCode(operations.claimTrainerTagLabel(tagRequest('rename', 'tag_one', 'Updated', 'tag-revision-stale', 0), context()), 'stale_state');
  assert.deepEqual(adapter.inspect().userPreferences.viewer_001, before);
});

test('soft delete deactivates the tag and releases only its label claim', async () => {
  const { adapter, operations } = harness();
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'One', 'tag-d1'), context());
  await operations.claimTrainerTagLabel(tagRequest('soft_delete', 'tag_one', null, 'tag-d2'), context());
  const prefs = adapter.inspect().userPreferences.viewer_001;
  assert.equal(prefs.trainerTags.tag_one.active, false);
  assert.equal(prefs.trainerTags.tag_one.deleted, true);
  assert.equal(prefs.trainerTags.tag_one.revision, 2);
  assert.deepEqual(prefs.trainerTagLabels, {});
});

test('soft delete does not perform unbounded favorite assignment cleanup', async () => {
  const favoriteTrainers = { owner_001: { tagIds: { tag_one: true } } };
  const { adapter, operations } = harness({ userPreferences: { viewer_001: { favoriteTrainers } } });
  await operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'One', 'tag-f1'), context());
  await operations.claimTrainerTagLabel(tagRequest('soft_delete', 'tag_one', null, 'tag-f2'), context());
  assert.deepEqual(adapter.inspect().userPreferences.viewer_001.favoriteTrainers, favoriteTrainers);
});

test('client-supplied viewer UID is rejected as an unknown field', async () => {
  const { operations } = harness();
  await rejectsCode(operations.claimTrainerTagLabel({ ...tagRequest('create', 'tag_one', 'One', 'tag-cross'), viewerUid: 'other_001' }, context()), 'invalid_argument');
});

test('malformed action, tag ID, long label, and unknown fields are rejected', async (t) => {
  const cases = [
    { action: 'remove', tagId: 'tag_one', label: 'One', baseRevision: 0, requestId: requestId('tag-bad-action') },
    tagRequest('create', 'BAD', 'One', 'tag-bad-id'),
    tagRequest('create', 'tag_one', 'a'.repeat(41), 'tag-long'),
    { ...tagRequest('create', 'tag_one', 'One', 'tag-extra'), extra: true }
  ];
  for (const input of cases) await t.test(JSON.stringify(input.action), async () => rejectsCode(harness().operations.claimTrainerTagLabel(input, context()), 'invalid_argument'));
});

test('transaction failure leaves tag state unchanged and replay stays blocked', async () => {
  const { adapter, operations } = harness();
  adapter.injectFailure('claimTagForViewer');
  const input = tagRequest('create', 'tag_one', 'One', 'tag-failure');
  await rejectsCode(operations.claimTrainerTagLabel(input, context()), 'unavailable');
  assert.equal(adapter.inspect().userPreferences.viewer_001, undefined);
  await rejectsCode(operations.claimTrainerTagLabel(input, context()), 'unavailable');
});

test('disabled preference gate blocks tag mutation and request storage', async () => {
  const { adapter, operations } = harness({ gates: { share_visibility: true, trainer_preferences: false } });
  await rejectsCode(operations.claimTrainerTagLabel(tagRequest('create', 'tag_one', 'One', 'tag-disabled'), context()), 'unavailable');
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});

test('reusing a completed tag request ID with changed input is rejected', async () => {
  const { operations } = harness();
  const initial = tagRequest('create', 'tag_one', 'One', 'tag-reused');
  await operations.claimTrainerTagLabel(initial, context());
  await rejectsCode(operations.claimTrainerTagLabel({ ...initial, label: 'Two' }, context()), 'replay_mismatch');
});
