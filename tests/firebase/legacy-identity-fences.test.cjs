'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const requireReset = createRequire(require('node:path').resolve('functions/legacy-pin-reset/package.json'));
const { initializeApp, deleteApp } = requireReset('firebase-admin/app');
const { getAuth } = requireReset('firebase-admin/auth');
const { ROOT, recordFor } = require('../../functions/legacy-pin-reset/identity-fence');
const projectId = 'demo-legacy-pin-reset';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9499');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9500');
const app = initializeApp({ projectId }, 'uid-fence-rules-tests'), auth = getAuth(app), tokens = {};
const ids = { owner: 'fence-owner', current: 'fence-current-v3', obsolete: 'fence-obsolete-v2', other: 'fence-other' };
const emails = { owner: 'fenceowner@example.test', current: 'fencetrainer_v3@pogotrades.nyc', obsolete: 'fencetrainer_v2@pogotrades.nyc', other: 'fenceother@pogotrades.nyc' };
const identity = (uid, email, version) => ({ authUid: uid, authEmail: email, authVersion: version, isAdmin: false, isOwner: false });
const manifest = { authoritativeUid: ids.current, obsoleteUid: ids.obsolete, username: 'FenceTrainer', authVersion: 3, obsoleteVersion: 2,
  authoritativeCreatedAt: 2, obsoleteCreatedAt: 1, createdAt: 3 };
const fence = (uid, state = 'retired') => recordFor(manifest, uid, state, 'a'.repeat(64));
const alias = identity(ids.obsolete, emails.obsolete, 2);
const baseline = {
  users: { Doomsday126: { ...identity(ids.owner, emails.owner, 1), isAdmin: true, isOwner: true },
    FenceTrainer: identity(ids.current, emails.current, 3), FenceOther: identity(ids.other, emails.other, 1) },
  loginDirectory: { FenceTrainer: { authReady: true, authVersion: 3 }, FenceOther: { authReady: true, authVersion: 1 } },
  authIndex: { [ids.owner]: { username: 'Doomsday126' }, [ids.other]: { username: 'FenceOther' } }, admins: { [ids.owner]: true },
  wishlist: { FenceOther: { Pikachu: 'H' } }, publicShares: { FenceOther: { username: 'FenceOther', lists: { wishlist: { Pikachu: 'H' } } } }
};
async function db(method, target, value, actor = 'fixture') {
  const url = new URL(`http://127.0.0.1:9500/${target}.json`);
  url.searchParams.set('ns', `${projectId}-default-rtdb`);
  if (actor !== 'fixture' && actor !== 'anonymous') url.searchParams.set('auth', tokens[actor]);
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(actor === 'fixture' ? { Authorization: 'Bearer owner' } : {}) },
    body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(10000) });
  return { status: response.status, value: await response.json() };
}
async function allowed(method, path, value, actor) { const r = await db(method, path, value, actor); assert.equal(r.status, 200, path); return r.value; }
async function denied(method, path, value, actor) { const r = await db(method, path, value, actor); assert.ok([401, 403].includes(r.status), `${path}: expected Rules denial, got ${r.status}`); }
async function retire(uid = ids.obsolete, state = 'retired') { await allowed('PUT', `${ROOT}/${uid}`, fence(uid, state), 'fixture'); }
before(async () => {
  for (const [actor, uid] of Object.entries(ids)) {
    await auth.createUser({ uid, email: emails[actor], password: '123456' });
    const response = await fetch('http://127.0.0.1:9499/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emails[actor], password: '123456', returnSecureToken: true }) });
    assert.equal(response.status, 200); tokens[actor] = (await response.json()).idToken;
  }
});
beforeEach(async () => { await allowed('PUT', '', baseline, 'fixture'); });
after(async () => { await deleteApp(app); });

test('before fencing, a pre-issued obsolete token reproduces the exact reciprocal-alias race', async () => {
  await allowed('PUT', 'users/SyntheticAlias', alias, 'obsolete');
  await allowed('PUT', `authIndex/${ids.obsolete}`, { username: 'SyntheticAlias' }, 'obsolete');
  assert.equal((await auth.getUser(ids.obsolete)).disabled, false);
});
for (const state of ['maintenance', 'retired']) test(`${state} immediately rejects the same token while Auth is still enabled`, async () => {
  await retire(ids.obsolete, state);
  await denied('PUT', 'users/SyntheticAlias', alias, 'obsolete');
  await allowed('PUT', 'users/PreviouslyBoundAlias', alias, 'fixture');
  await denied('PUT', `authIndex/${ids.obsolete}`, { username: 'PreviouslyBoundAlias' }, 'obsolete');
  assert.equal((await auth.getUser(ids.obsolete)).disabled, false, 'Token revocation/disable is not the enforcement mechanism');
});
test('temporary current-UID hold closes the missing-index alias window too', async () => {
  await retire(ids.current, 'maintenance');
  await denied('PUT', 'users/CurrentAlias', identity(ids.current, emails.current, 3), 'current');
  await denied('PUT', `authIndex/${ids.current}`, { username: 'FenceTrainer' }, 'current');
  await denied('PUT', `authIndex/${ids.current}`, { username: 'FenceTrainer' }, 'owner');
});
for (const actor of ['obsolete', 'current', 'other', 'owner', 'anonymous']) test(`${actor} cannot read, enumerate, remove or modify private retirement evidence`, async () => {
  await retire();
  await denied('GET', ROOT, undefined, actor);
  await denied('GET', `${ROOT}/${ids.obsolete}`, undefined, actor);
  await denied('PUT', `${ROOT}/${ids.obsolete}`, null, actor);
  await denied('DELETE', `${ROOT}/${ids.obsolete}`, undefined, actor);
  await denied('PATCH', `${ROOT}/${ids.obsolete}`, { state: 'maintenance' }, actor);
  await denied('PUT', `${ROOT}/${ids.other}`, fence(ids.other), actor);
  await denied('PUT', ROOT, {}, actor);
});
test('owner/admin cannot bind, index, provision directory or grant admin authority to a fenced UID', async () => {
  await retire();
  await denied('PUT', 'users/SyntheticAlias', alias, 'owner');
  await allowed('PUT', 'users/PreviouslyBoundAlias', alias, 'fixture');
  await denied('PUT', `authIndex/${ids.obsolete}`, { username: 'PreviouslyBoundAlias' }, 'owner');
  await denied('PUT', 'loginDirectory/PreviouslyBoundAlias', { authReady: true, authVersion: 2 }, 'owner');
  await denied('PUT', 'loginDirectory/SyntheticAlias', { authReady: true, authVersion: 2, authUid: ids.obsolete }, 'owner');
  await denied('PUT', `admins/${ids.obsolete}`, true, 'owner');
});
test('a pre-issued token with an admin bit cannot bypass actor retirement checks', async () => {
  await retire();
  await allowed('PUT', `admins/${ids.obsolete}`, true, 'fixture');
  await denied('PATCH', 'users/FenceOther', { authUid: ids.other }, 'obsolete');
  await denied('PATCH', `authIndex/${ids.other}`, { lastSeen: 123 }, 'obsolete');
  await denied('PUT', 'loginDirectory/FenceOther', { authReady: true, authVersion: 1 }, 'obsolete');
  await denied('PUT', `admins/${ids.other}`, true, 'obsolete');
});
test('atomic alias creation, identity-field patches, parent writes and fence deletion cannot bypass retirement', async () => {
  await retire();
  await denied('PATCH', '', { 'users/SyntheticAlias': alias, [`authIndex/${ids.obsolete}`]: { username: 'SyntheticAlias' } }, 'obsolete');
  await denied('PATCH', '', { [`${ROOT}/${ids.obsolete}`]: null, 'users/SyntheticAlias': alias }, 'obsolete');
  await denied('PUT', 'users', { SyntheticAlias: alias }, 'owner');
  await denied('PATCH', 'users/SyntheticAlias', alias, 'obsolete');
  await denied('PUT', 'users/FenceTrainer/authUid', ids.obsolete, 'owner');
  assert.deepEqual(await allowed('GET', 'users/FenceTrainer', undefined, 'fixture'), baseline.users.FenceTrainer);
});
test('unknown handle/provisioning namespaces remain denied rather than becoming new grants', async () => {
  await retire();
  for (const path of ['trainerHandles/alias', 'accounts/alias', 'durableAuthConfig/repair', 'identityMigrations/alias', 'shareDirectory/alias']) {
    await denied('PUT', path, { uid: ids.obsolete }, 'obsolete');
    await denied('PUT', path, { uid: ids.obsolete }, 'owner');
  }
});
test('retirement preserves public reads, unrelated profile/list/index writes, and existing access denials', async () => {
  await retire();
  await allowed('PATCH', 'users/FenceOther', { bio: 'ordinary profile' }, 'other');
  await allowed('PUT', 'wishlist/FenceOther', { Pikachu: 'M' }, 'other');
  await allowed('PATCH', `authIndex/${ids.other}`, { accountSyncRecoveryReviews: { synthetic: { candidateCount: 66 } } }, 'other');
  await allowed('PUT', 'publicShares/FenceOther', baseline.publicShares.FenceOther, 'other');
  assert.deepEqual(await allowed('GET', 'publicShares/FenceOther', undefined, 'anonymous'), baseline.publicShares.FenceOther);
  assert.deepEqual(await allowed('GET', 'loginDirectory', undefined, 'anonymous'), baseline.loginDirectory);
  await denied('PUT', 'wishlist/FenceOther', { Pikachu: 'L' }, 'obsolete');
  await allowed('PUT', '_ping', true, 'obsolete');
});
const entryId = 'te_WzEsInBvZ28tYWNjb3VudC10cmFkZS1lbnRyeSIsIm15LWxpc3QiLCJ3aXNobGlzdCIsInBva2Vtb246cGlrYWNodSJd';
function canonical(uid) {
  const hash = 'a'.repeat(64), mutation = 'op_0000000000000001';
  const entity = (entityType, entityId, identity, values, field) => ({ schemaVersion: 1, ownerUid: uid, entityType, entityId, identity,
    generation: 1, revision: 1, deleted: false, createdAt: 100, updatedAt: 100, values, fieldRevisions: { [field]: 1 },
    fieldMutations: { [field]: mutation }, fieldMutationHashes: { [field]: hash }, lifecycleMutation: mutation, lifecycleMutationHash: hash });
  return {
    meta: { schemaVersion: 1, ownerUid: uid, initialized: true, initializedAt: 100, updatedAt: 100, featureVersion: 1 },
    [`tradeEntries/${entryId}`]: entity('tradeEntry', entryId, { surface: 'my-list', lane: 'wishlist', catalogId: 'pokemon:pikachu' }, { priority: 'H' }, 'f_cHJpb3JpdHk'),
    [`favorites/${ids.other}`]: entity('favorite', ids.other, { targetUid: ids.other }, { displayName: 'Other Trainer' }, 'f_ZGlzcGxheU5hbWU'),
    'tags/tag_example': entity('tag', 'tag_example', { tagId: 'tag_example' }, { label: 'Local' }, 'f_bGFiZWw'),
    [`migrations/migration_${hash}`]: { schemaVersion: 1, ownerUid: uid, deviceMigrationId: `migration_${hash}`, sourceFingerprint: hash,
      deviceInstallHash: hash, createdAt: 100, completedAt: 101, seedCount: 0, candidateCount: 0, verified: true, legacyRetained: true },
    [`recoveryCandidates/candidate_${hash}`]: { schemaVersion: 1, ownerUid: uid, candidateId: `candidate_${hash}`, reason: 'stale-device-cache',
      entityType: 'tradeEntry', entityId: entryId, identity: { surface: 'my-list', lane: 'wishlist', catalogId: 'pokemon:pikachu' },
      values: { priority: 'L' }, source: 'legacy-local', createdAt: 100, resolved: false }
  };
}
for (const path of Object.keys(canonical(ids.current))) test(`canonical ${path.split('/')[0]} creation stays valid for active UID and cannot revive a fenced UID`, async () => {
  await retire();
  await allowed('PUT', `accountSync/${ids.current}/${path}`, canonical(ids.current)[path], 'current');
  await denied('PUT', `accountSync/${ids.obsolete}/${path}`, canonical(ids.obsolete)[path], 'obsolete');
});
test('retirement does not erase historical canonical records or revoke their existing read/update contract', async () => {
  const path = `accountSync/${ids.obsolete}/meta`, original = canonical(ids.obsolete).meta;
  await allowed('PUT', path, original, 'obsolete');
  await retire();
  assert.deepEqual(await allowed('GET', path, undefined, 'obsolete'), original);
  await allowed('PUT', path, { ...original, updatedAt: 101 }, 'obsolete');
  await denied('PUT', path, { ...original, ownerUid: ids.current, updatedAt: 102 }, 'obsolete');
});
