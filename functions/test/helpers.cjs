'use strict';

const { createInMemoryTrustedAdapter } = require('../src/adapters/inMemoryTrustedAdapter');
const { snapshotFromTrainerShare } = require('../src/adapters/firebaseTrustedAdapter');
const { createTrustedOperations } = require('../src/domain/trustedOperations');

const IDS = Object.freeze({ owner: 'owner_001', viewer: 'viewer_001', other: 'other_001', admin: 'admin_001' });

function seed(overrides = {}) {
  return {
    gates: { share_visibility: true, trainer_preferences: true },
    accounts: {
      [IDS.owner]: { trainerName: 'OwnerOne', normalizedTrainerName: 'ownerone' },
      [IDS.viewer]: { trainerName: 'ViewerOne', normalizedTrainerName: 'viewerone' },
      [IDS.other]: { trainerName: 'OtherOne', normalizedTrainerName: 'otherone' }
    },
    shareDirectory: {
      ownerone: { ownerUid: IDS.owner, trainerName: 'OwnerOne', state: 'published' },
      viewerone: { ownerUid: IDS.viewer, trainerName: 'ViewerOne', state: 'published' },
      otherone: { ownerUid: IDS.other, trainerName: 'OtherOne', state: 'unpublished' }
    },
    shareVisibility: { [IDS.owner]: { mode: 'public' } },
    trainerShares: {
      [IDS.owner]: {
        shareVersion: 2,
        updatedAt: 200,
        lists: {
          wishlist: { entry_a: { p: 'H', shiny: true }, entry_b: { p: 'M', mod: 'costume' } },
          dynamax: {}, gmax: {}, costumes: {}
        }
      }
    },
    ...overrides
  };
}

function harness(overrides = {}) {
  let clock = 1000;
  const adapter = createInMemoryTrustedAdapter(seed(overrides));
  const operations = createTrustedOperations({ adapter, now: () => ++clock });
  return { adapter, operations };
}

function context(uid = IDS.viewer) { return { auth: { uid }, app: { appId: 'demo-app' } }; }
function requestId(suffix) { return `request-${suffix}-0001`; }
function tagRequest(action, tagId, label, suffix, baseRevision = action === 'create' ? 0 : 1) {
  return { action, tagId, ...(label == null ? {} : { label }), baseRevision, requestId: requestId(suffix) };
}
function historyRequest(overrides = {}) {
  const share = seed().trainerShares[IDS.owner];
  const snapshot = snapshotFromTrainerShare(share);
  return { ownerUid: IDS.owner, shareVersion: share.shareVersion, shareUpdatedAt: share.updatedAt, declaredEntryCount: Object.keys(snapshot).length, publicSnapshot: snapshot, requestId: requestId('history'), ...overrides };
}
function favoriteRequest(overrides = {}) {
  return {
    operation: 'add',
    trainerUid: IDS.owner,
    canonicalTrainerLabel: 'OwnerOne',
    expectedRevision: 0,
    requestId: requestId('favorite'),
    schemaVersion: 1,
    ...overrides
  };
}

async function rejectsCode(promise, code, reason) {
  await require('node:assert/strict').rejects(promise, (error) => error?.code === code && (!reason || error?.reason === reason));
}

module.exports = { IDS, context, favoriteRequest, harness, historyRequest, rejectsCode, requestId, seed, tagRequest };
