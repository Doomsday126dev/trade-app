'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const requireReset = createRequire(require('node:path').resolve('functions/legacy-pin-reset/package.json'));
const { initializeApp, deleteApp } = requireReset('firebase-admin/app');
const { getAuth } = requireReset('firebase-admin/auth');
const { createResetService } = require('../../functions/legacy-pin-reset/reset');
const { createPasswordUpdater } = require('../../functions/legacy-pin-reset/password');
const { createJournal } = require('../../functions/legacy-pin-reset/journal');
const projectId = 'demo-legacy-pin-reset';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9499');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9500');
const app = initializeApp({ projectId }, 'identity-guard-tests'), auth = getAuth(app), tokens = {};
const users = { Doomsday126: 'owner-uid', Trainer: 'trainer-uid', Other: 'other-uid', New: 'new-uid' };
async function db(method, target, value, actor = 'fixture') {
  const url = new URL(`http://127.0.0.1:9500/${target}.json`);
  url.searchParams.set('ns', `${projectId}-default-rtdb`);
  if (actor !== 'fixture') url.searchParams.set('auth', tokens[actor]);
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(actor === 'fixture' ? { Authorization: 'Bearer owner' } : {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: response.status, value: await response.json() };
}
async function denied(method, target, value, actor = 'Doomsday126') {
  const r = await db(method, target, value, actor);
  assert.ok([401, 403].includes(r.status), `Expected identity-write denial at ${target}, got ${r.status}`);
}
before(async () => {
  const evidence = { users: {}, authIndex: {}, loginDirectory: {}, admins: { 'owner-uid': true } };
  for (const [name, uid] of Object.entries(users)) {
    const email = `${name.toLowerCase()}@pogotrades.nyc`;
    await auth.createUser({ uid, email, password: '123456' });
    const login = await fetch('http://127.0.0.1:9499/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: '123456', returnSecureToken: true }) });
    tokens[name] = (await login.json()).idToken;
    if (name === 'New') continue;
    evidence.users[name] = { authUid: uid, authEmail: email, authVersion: 1, isAdmin: name === 'Doomsday126', isOwner: name === 'Doomsday126' };
    evidence.authIndex[uid] = { username: name };
    evidence.loginDirectory[name] = { authReady: true, authVersion: 1 };
  }
  assert.equal((await db('PUT', '', evidence)).status, 200);
});
after(async () => { await deleteApp(app); });
test('established binding cannot be replaced or deleted by Admin, owner, partial writes, parent writes, or atomic swaps', async () => {
  for (const actor of ['Doomsday126', 'Trainer', 'Other']) {
    await denied('PUT', 'users/Trainer/authUid', 'other-uid', actor);
    await denied('DELETE', 'users/Trainer/authUid', undefined, actor);
    await denied('DELETE', 'users/Trainer', undefined, actor);
    await denied('PUT', 'users/Trainer', { authUid: 'other-uid', authEmail: 'other@pogotrades.nyc', authVersion: 2 }, actor);
    await denied('PATCH', '', { 'users/Trainer/authUid': 'other-uid', 'users/Other/authUid': 'trainer-uid', 'authIndex/trainer-uid/username': 'Other', 'authIndex/other-uid/username': 'Trainer' }, actor);
  }
  await denied('DELETE', 'users');
  await denied('PUT', 'authIndex/trainer-uid/username', 'Other');
  await denied('DELETE', 'authIndex/trainer-uid');
  await denied('PUT', 'authIndex/other-uid', { username: 'Trainer' });
  await denied('PUT', 'users/Alias', { authUid: 'trainer-uid', authEmail: 'trainer@pogotrades.nyc', authVersion: 1 });
  await denied('PUT', 'users/Trainer/authVersion', 2);
  await denied('PUT', 'users/Trainer/authEmail', 'trainer_v2@pogotrades.nyc');
  await denied('PUT', 'loginDirectory/Trainer/authVersion', 2);
  await denied('DELETE', 'loginDirectory/Trainer');
});
test('same-UID repair, ordinary profile updates, review receipts and new unbound provisioning remain possible', async () => {
  for (const actor of ['Doomsday126', 'Trainer']) {
    assert.equal((await db('PATCH', 'users/Trainer', { bio: 'synthetic', authUid: 'trainer-uid', authVersion: 1 }, actor)).status, 200);
  }
  assert.equal((await db('PATCH', 'authIndex/trainer-uid', { lastSeen: 123, accountSyncRecoveryReviews: { synthetic: { candidateCount: 66 } } }, 'Trainer')).status, 200);
  assert.equal((await db('PUT', 'loginDirectory/Trainer', { authReady: true, authVersion: 1 }, 'Doomsday126')).status, 200);
  assert.equal((await db('PUT', 'users/New', { authUid: 'new-uid', authEmail: 'new@pogotrades.nyc', authVersion: 1, isAdmin: false, isOwner: false }, 'New')).status, 200);
  assert.equal((await db('PUT', 'authIndex/new-uid', { username: 'New' }, 'New')).status, 200);
});
test('real Rules reject ownership repair inside the final-read/password-write interval; reset stays same UID', async () => {
  let ledger = { schemaVersion: 1, records: [] }, generation = 1, writes = 0;
  const journal = createJournal({ read: async () => ({ generation, value: structuredClone(ledger) }), compareAndSwap: async (expected, next) => { assert.equal(expected, generation); ledger = structuredClone(next); generation++; } });
  const update = createPasswordUpdater({ projectId, emulatorHost: '127.0.0.1:9499' });
  const reset = createResetService({ ownerUid: 'owner-uid', hmacKey: 'test-only'.repeat(8), journal, adapter: {
    readEvidence: async () => (await db('GET', '')).value, getAuthUser: uid => auth.getUser(uid),
    listAuthIdentities: async () => (await auth.listUsers()).users, legacyOnly: async () => true,
    updatePassword: async (uid, pin) => {
      await denied('PATCH', '', { 'users/Trainer/authUid': 'other-uid', 'authIndex/trainer-uid/username': 'Other' });
      await denied('DELETE', 'users/Trainer', undefined, 'Trainer');
      await update(uid, pin); writes++;
    }
  } });
  const context = { uid: 'owner-uid', appVerified: true, authTime: Math.floor(Date.now() / 1000) };
  const { created, ...binding } = await reset.run(context, { action: 'inspect', username: 'Trainer' });
  const input = { action: 'reset', ...binding, requestId: randomUUID(), pin: '654321' };
  assert.equal((await reset.run(context, input)).status, 'completed');
  assert.equal((await reset.run(context, input)).status, 'completed'); assert.equal(writes, 1);
  assert.equal((await db('GET', 'users/Trainer/authUid')).value, 'trainer-uid');
  assert.equal((await auth.getUser('trainer-uid')).email, 'trainer@pogotrades.nyc');
});
