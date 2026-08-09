'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { context, harness, rejectsCode, requestId, IDS } = require('./helpers.cjs');

test('owner grant succeeds and changes only the exact shareAccess row', async () => {
  const { adapter, operations } = harness();
  const before = adapter.inspect();
  await operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('grant') }, context(IDS.owner));
  const after = adapter.inspect();
  assert.equal(after.shareAccess[IDS.owner][IDS.viewer], true);
  assert.deepEqual(after.userPreferences, before.userPreferences);
});

test('owner revoke succeeds immediately', async () => {
  const { adapter, operations } = harness({ shareAccess: { [IDS.owner]: { [IDS.viewer]: true } } });
  await operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'revoke', requestId: requestId('revoke') }, context(IDS.owner));
  assert.equal(adapter.inspect().shareAccess[IDS.owner][IDS.viewer], undefined);
});

test('grant and revoke are idempotent', async () => {
  const { operations } = harness({ shareAccess: { [IDS.owner]: { [IDS.viewer]: true } } });
  assert.equal((await operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('grant-idem') }, context(IDS.owner))).status, 'idempotent');
  assert.equal((await operations.setApprovedViewer({ viewerUid: IDS.other, action: 'revoke', requestId: requestId('revoke-idem') }, context(IDS.owner))).status, 'idempotent');
});

test('self grant is rejected', async () => {
  const { operations } = harness();
  await rejectsCode(operations.setApprovedViewer({ viewerUid: IDS.owner, action: 'grant', requestId: requestId('self') }, context(IDS.owner)), 'invalid_argument');
});

test('cross-owner mutation is impossible because owner UID is not accepted from input', async () => {
  const { operations } = harness();
  await rejectsCode(operations.setApprovedViewer({ ownerUid: IDS.owner, viewerUid: IDS.viewer, action: 'grant', requestId: requestId('cross') }, context(IDS.other)), 'invalid_argument');
});

test('unknown or incoherent target viewer is rejected', async () => {
  const { operations } = harness();
  await rejectsCode(operations.setApprovedViewer({ viewerUid: 'unknown_001', action: 'grant', requestId: requestId('unknown') }, context(IDS.owner)), 'invalid_argument');
  const incoherent = harness({ shareDirectory: { ownerone: { ownerUid: IDS.owner }, viewerone: { ownerUid: IDS.other }, otherone: { ownerUid: IDS.other } } });
  await rejectsCode(incoherent.operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('incoherent') }, context(IDS.owner)), 'invalid_argument');
});

test('personal favorites, tags, recents, and history remain unchanged', async () => {
  const preferences = { favoriteTrainers: { x: { active: true } }, trainerTags: { tag_x: { active: true } }, recentTrainerSlots: { '00': { ownerUid: IDS.other } }, trainerHistory: { x: { entryCount: 1 } } };
  const { adapter, operations } = harness({ userPreferences: { [IDS.owner]: preferences } });
  await operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('prefs') }, context(IDS.owner));
  assert.deepEqual(adapter.inspect().userPreferences[IDS.owner], preferences);
});

test('legacy profile privilege fields do not create admin or cross-owner authority', async () => {
  const { adapter, operations } = harness({ users: { [IDS.other]: { isOwner: true, isAdmin: true } } });
  await operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('legacy') }, context(IDS.other));
  assert.equal(adapter.inspect().shareAccess[IDS.other][IDS.viewer], true);
  assert.equal(adapter.inspect().shareAccess[IDS.owner], undefined);
});

test('removed viewer access is denied by the additive emulator rules contract', () => {
  const rules = JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../tests/firebase/database.rules.share-visibility.json'), 'utf8'));
  const expression = rules.rules.trainerShares.$ownerUid['.read'];
  assert.match(expression, /shareAccess.*\.val\(\) === true/);
  assert.doesNotMatch(expression, /favorite|community|isAdmin|isOwner/);
});

test('disabled visibility gate prevents any grant or idempotency write', async () => {
  const { adapter, operations } = harness({ gates: { share_visibility: false, trainer_preferences: true } });
  await rejectsCode(operations.setApprovedViewer({ viewerUid: IDS.viewer, action: 'grant', requestId: requestId('grant-disabled') }, context(IDS.owner)), 'unavailable');
  assert.deepEqual(adapter.inspect().shareAccess, {});
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});
