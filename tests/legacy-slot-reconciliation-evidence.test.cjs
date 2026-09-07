'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, classifyState } = require('../scripts/lib/legacy-slot-reconciliation.cjs');
const { CONTRACT } = require('../functions/legacy-pin-reset/identity-fence');
const { createEvidenceReader, manifestFromState, projectAuth, readIdentityInventory } = require('../scripts/lib/legacy-slot-reconciliation-evidence.cjs');
function fixture() {
  const data = { users: { Trainer: { authUid: 'current', authVersion: 3, authEmail: 'trainer_v3@pogotrades.nyc' } },
    loginDirectory: { Trainer: { authReady: true, authVersion: 3 } }, authIndex: {}, admins: {} };
  const accounts = Object.fromEntries([['old', 2], ['current', 3]].map(([uid, v]) => [uid, { uid, email: `trainer_v${v}@pogotrades.nyc`, disabled: false,
    providerData: [{ providerId: 'password', uid: `trainer_v${v}@pogotrades.nyc` }], metadata: { creationTime: `2026-01-0${v}T00:00:00Z` } }]));
  const paths = [], firestoreRecords = new Set();
  const readDatabase = async (path, options) => {
    paths.push({ path, ...options }); const value = path.split('/').reduce((v, p) => v?.[p], data) ?? null;
    return { value: options?.shallow && value ? Object.fromEntries(Object.keys(value).map(k => [k, true])) : structuredClone(value),
      etag: value === null ? 'null_etag' : fingerprint(value) };
  };
  const auth = { getUser: async uid => structuredClone(accounts[uid]), listUsers: async () => ({ users: Object.values(accounts) }) };
  const firestore = { doc: path => ({ get: async () => ({ exists: firestoreRecords.has(path) }) }), collection: path => {
    const query = { where: () => query, limit: () => query, get: async () => ({ empty: !firestoreRecords.has(path) }) }; return query;
  } };
  const boundary = { resetEnabled: false, quiesced: true, pendingResetCount: 0, immutableBindingsVerified: true,
    fingerprint: 'b'.repeat(64), securityContract: CONTRACT, rulesFingerprint: 'c'.repeat(64) };
  const read = createEvidenceReader({ username: 'Trainer', authoritativeUid: 'current', obsoleteUid: 'old', readDatabase, auth, firestore, readBoundary: async () => boundary });
  const plan = state => manifestFromState({ projectId: 'demo-legacy-pin-reset', username: 'Trainer', state, now: 1800000000000 });
  return { read, plan, data, accounts, paths, firestoreRecords, boundary, auth, readDatabase };
}
test('fresh read derives exact eligible manifest without caller-supplied safety flags', async () => {
  const f = fixture(), state = await f.read(), manifest = f.plan(state);
  assert.equal(classifyState(manifest, state), 'before'); assert.equal(manifest.authVersion, 3); assert.equal(manifest.obsoleteVersion, 2);
  assert.equal(manifest.permittedMutations.length, 6);
});
test('identity inventory never reads user profile or credential fields', async () => {
  const f = fixture(); f.data.users.Trainer.pin = 'secret-never-read';
  const inventory = await readIdentityInventory(f.readDatabase);
  assert.equal(inventory.users.Trainer.pin, undefined);
  assert.deepEqual(f.paths.filter(p => p.path === 'users'), [{ path: 'users', shallow: true }]);
  assert.equal(f.paths.some(p => p.path.includes('/pin') || p.path === 'users/Trainer'), false);
});
test('Auth projection omits secret exports and volatile session timestamps', () => {
  const f = fixture(), user = f.accounts.old;
  const before = projectAuth(user);
  assert.deepEqual(projectAuth({ ...user, passwordHash: 'secret', salt: 'secret', tokensValidAfterTime: 'later', refreshToken: 'secret',
    metadata: { ...user.metadata, lastSignInTime: 'later', lastRefreshTime: 'later' } }), before);
  assert.equal(JSON.stringify(before).includes('secret'), false);
});
for (const [name, drift] of [
  ['alias', f => f.data.users.Alias = { authUid: 'old' }],
  ['Unicode collision', f => f.data.users['\uFF34rainer'] = { authUid: 'someone' }],
  ['conflicting index', f => f.data.authIndex.other = { username: 'Trainer' }],
  ['old index', f => f.data.authIndex.old = { username: 'Other' }],
  ['directory claim', f => f.data.loginDirectory.Other = { authUid: 'old' }],
  ['directory disagreement', f => f.data.loginDirectory.Trainer.authVersion = 2],
  ['old admin', f => f.data.admins.old = true],
  ['frozen current', f => f.data.users.Trainer.frozen = true],
  ['old provider', f => f.accounts.old.providerData.push({ providerId: 'google.com', uid: 'subject' })],
  ['old claims', f => f.accounts.old.customClaims = { admin: true }],
  ['old MFA', f => f.accounts.old.multiFactor = { enrolledFactors: [{ uid: 'factor' }] }],
  ['future slot', f => f.accounts.future = { ...f.accounts.old, uid: 'future', email: 'trainer_v4@pogotrades.nyc' }],
  ['unique canonical', f => f.data.accountSync = { old: { meta: { ownerUid: 'old' } } }],
  ['current canonical owner mismatch', f => f.data.accountSync = { current: { meta: { ownerUid: 'old' } } }],
  ['public owner mismatch', f => f.data.publicShares = { Trainer: { ownerUid: 'old' } }],
  ['public username mismatch', f => f.data.publicShares = { Trainer: { username: 'Other' } }],
  ['unique membership', f => f.data.userCommunities = { old: { nyc: { username: 'Trainer', role: 'member', joinedAt: 1 } } }],
  ['current provider authority', f => f.firestoreRecords.add('accounts/current')],
  ['orphan reverse provider', f => f.firestoreRecords.add('providerSubjects')],
  ['orphan migration parent', f => f.firestoreRecords.add('identityMigrations/old')],
  ['old Rules contract', f => f.boundary.securityContract = 'immutable-bindings-v1'],
  ['reset enabled', f => f.boundary.resetEnabled = true]
]) test(`fresh evidence rejects ${name} before any write`, async () => {
  const f = fixture(); drift(f); const state = await f.read(); assert.throws(() => f.plan(state), error => error.code?.startsWith('repair/'));
});
test('protected product drift changes the fingerprint without returning product content', async () => {
  const f = fixture(), before = await f.read(); f.data.publicShares = { Trainer: { lists: { privateFixture: 'changed' } } };
  const after = await f.read(); assert.notEqual(after.protectedFingerprint, before.protectedFingerprint);
  assert.equal(JSON.stringify(after).includes('privateFixture'), false);
});
test('Auth inventory pagination and evidence read errors fail closed', async () => {
  const f = fixture(); f.auth.listUsers = async () => ({ users: [], pageToken: 'more' });
  await assert.rejects(f.read(), { code: 'repair/auth-inventory-too-large' });
});
