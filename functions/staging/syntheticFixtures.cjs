'use strict';

const FIXTURE_EPOCH = 1700000000000;
const SYNTHETIC_UIDS = Object.freeze({
  owner: 'syn_owner_0001',
  viewer: 'syn_viewer_0002',
  admin: 'syn_admin_0003',
  unregistered: 'syn_unregistered_0004'
});

function generateSyntheticFixtures() {
  const { owner, viewer, admin } = SYNTHETIC_UIDS;
  return Object.freeze({
    authUsers: Object.freeze([
      Object.freeze({ uid: owner, email: 'owner-0001@example.invalid', enabled: true }),
      Object.freeze({ uid: viewer, email: 'viewer-0002@example.invalid', enabled: true }),
      Object.freeze({ uid: admin, email: 'admin-0003@example.invalid', enabled: true }),
      Object.freeze({ uid: SYNTHETIC_UIDS.unregistered, email: 'unregistered-0004@example.invalid', enabled: true })
    ]),
    rtdb: Object.freeze({
      shareVisibilityConfig: Object.freeze({ writesEnabled: false }),
      trainerPreferencesConfig: Object.freeze({ writesEnabled: false, readsEnabled: false }),
      admins: Object.freeze({ [admin]: true }),
      accounts: Object.freeze({
        [owner]: Object.freeze({ trainerName: 'SyntheticOwner', normalizedTrainerName: 'syntheticowner' }),
        [viewer]: Object.freeze({ trainerName: 'SyntheticViewer', normalizedTrainerName: 'syntheticviewer' }),
        [admin]: Object.freeze({ trainerName: 'SyntheticAdmin', normalizedTrainerName: 'syntheticadmin' })
      }),
      shareDirectory: Object.freeze({
        syntheticowner: Object.freeze({ ownerUid: owner, trainerName: 'SyntheticOwner', state: 'published' }),
        syntheticviewer: Object.freeze({ ownerUid: viewer, trainerName: 'SyntheticViewer', state: 'published' }),
        syntheticadmin: Object.freeze({ ownerUid: admin, trainerName: 'SyntheticAdmin', state: 'published' }),
        collisioncandidate: Object.freeze({ ownerUid: viewer, trainerName: 'CollisionCandidate', state: 'unpublished' })
      }),
      shareVisibility: Object.freeze({
        [owner]: Object.freeze({ mode: 'public' }),
        [viewer]: Object.freeze({ mode: 'approved_viewers' }),
        [admin]: Object.freeze({ mode: 'private' })
      }),
      shareAccess: Object.freeze({ [viewer]: Object.freeze({ [owner]: true }) }),
      trainerShares: Object.freeze({
        [owner]: Object.freeze({ shareVersion: 2, updatedAt: FIXTURE_EPOCH, lists: Object.freeze({ wishlist: Object.freeze({ entry_alpha: Object.freeze({ p: 'H' }) }), dynamax: Object.freeze({}), gmax: Object.freeze({}), costumes: Object.freeze({}) }) }),
        [viewer]: Object.freeze({ shareVersion: 1, updatedAt: FIXTURE_EPOCH, lists: Object.freeze({ wishlist: Object.freeze({ entry_beta: Object.freeze({ p: 'M' }) }), dynamax: Object.freeze({}), gmax: Object.freeze({}), costumes: Object.freeze({}) }) }),
        [admin]: Object.freeze({ shareVersion: 1, updatedAt: FIXTURE_EPOCH, lists: Object.freeze({ wishlist: Object.freeze({}), dynamax: Object.freeze({}), gmax: Object.freeze({}), costumes: Object.freeze({}) }) })
      }),
      userPreferences: Object.freeze({
        [viewer]: Object.freeze({
          trainerTags: Object.freeze({ tag_existing: Object.freeze({ label: 'Synthetic Group', normalizedLabel: 'synthetic group', labelKey: 'synthetic_group', active: true, deleted: false, createdAt: FIXTURE_EPOCH, updatedAt: FIXTURE_EPOCH, revision: 1, operationId: 'synthetic-tag-op-0001' }) }),
          trainerTagLabels: Object.freeze({ synthetic_group: 'tag_existing' }),
          trainerHistory: Object.freeze({
            [owner]: Object.freeze({ lastSeenShareVersion: 2, lastSeenUpdatedAt: FIXTURE_EPOCH, lastSeenFingerprint: 'a'.repeat(64), entryCount: 1, lastSeenSnapshot: Object.freeze({ entry_alpha: Object.freeze({ category: 'wishlist', fingerprint: 'b'.repeat(64) }) }), revision: 1, operationId: 'synthetic-history-op-0001' }),
            [admin]: Object.freeze({ lastSeenShareVersion: 3, lastSeenUpdatedAt: FIXTURE_EPOCH + 1000, lastSeenFingerprint: 'c'.repeat(64), entryCount: 0, lastSeenSnapshot: Object.freeze({}), revision: 1, operationId: 'synthetic-history-op-0002' })
          })
        })
      }),
      trustedOperationRequests: Object.freeze({
        [owner]: Object.freeze({ reserveTrainerHandle: Object.freeze({ synthetic_replay_0001: Object.freeze({ fingerprint: 'd'.repeat(64), status: 'complete', createdAt: FIXTURE_EPOCH, completedAt: FIXTURE_EPOCH + 10, expiresAt: FIXTURE_EPOCH + 7 * 86400000, result: Object.freeze({ ok: true, operation: 'reserveTrainerHandle', status: 'reserved' }) }) }) })
      })
    }),
    resetRoots: Object.freeze(['accounts', 'admins', 'shareAccess', 'shareDirectory', 'shareVisibility', 'shareVisibilityConfig', 'trainerPreferencesConfig', 'trainerShares', 'trustedOperationRequests', 'userPreferences']),
    lifecycle: Object.freeze({ generation: 'pure_local_object', reset: 'delete_only_listed_synthetic_roots_in_isolated_staging', validation: 'schema_and_expected_counts_before_canary', teardown: 'gates_false_then_remove_synthetic_roots_and_auth_users' })
  });
}

module.exports = Object.freeze({ FIXTURE_EPOCH, SYNTHETIC_UIDS, generateSyntheticFixtures });
