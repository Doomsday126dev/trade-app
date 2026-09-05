'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createResetService } = require('../reset');
const { createJournal } = require('../journal');
const { createAdapter } = require('../adapter');
const { createPasswordUpdater } = require('../password');
const now = 1800000000000;
const context = { uid: 'owner-uid', authTime: now / 1000, appVerified: true };
function fixture() {
  const evidence = { users: { Doomsday126: { authUid: 'owner-uid', isAdmin: true }, Trainer: { authUid: 'trainer-uid', authEmail: 'trainer@pogotrades.nyc', authVersion: 1 } },
    admins: { 'owner-uid': true }, authIndex: { 'owner-uid': { username: 'Doomsday126' }, 'trainer-uid': { username: 'Trainer' } },
    loginDirectory: { Trainer: { authReady: true, authVersion: 1 } } };
  const user = { uid: 'trainer-uid', email: 'trainer@pogotrades.nyc', disabled: false, metadata: { creationTime: '2026-01-01T00:00:00Z' },
    providerData: [{ providerId: 'password', uid: 'trainer@pogotrades.nyc' }, { providerId: 'google.com', uid: 'synthetic-provider-subject' }] };
  const data = { accountSync: { 'trainer-uid': { entries: [{ lane: 'lf', name: 'Pikachu' }, { lane: 'ft', name: 'Eevee' }], favorites: ['Mazer'], tags: ['NYC'],
    migration: { state: 'complete' }, recovery: Array.from({ length: 66 }, (_, i) => ({ id: i, resolved: true, active: false })) } },
    users: { Trainer: { profile: 'unchanged', specialTradeBoard: { lf: ['Pikachu'], ft: ['Eevee'] } } }, publicShares: { Trainer: { ownerUid: user.uid } } };
  let ledger = { schemaVersion: 1, records: [] }, generation = 1, password = '123456', mutations = 0;
  const store = { read: async () => ({ generation, value: structuredClone(ledger) }), compareAndSwap: async (expected, value) => {
    if (expected !== generation) throw Object.assign(new Error(), { code: 412 }); ledger = structuredClone(value); generation++;
  } };
  const adapter = { readEvidence: async () => structuredClone(evidence), getAuthUser: async uid => uid === 'owner-uid' ? { uid, disabled: false } : structuredClone(user),
    listAuthIdentities: async () => [{ uid: user.uid, email: user.email }], legacyOnly: async () => true,
    updatePassword: async (uid, pin) => { assert.equal(uid, user.uid); password = pin; mutations++; } };
  const service = createResetService({ adapter, journal: createJournal(store), ownerUid: context.uid, hmacKey: 'k'.repeat(64), now: () => now });
  return { evidence, user, data, adapter, store, service, ledger: () => ledger, mutations: () => mutations, password: () => password };
}
async function request(f) { return { action: 'reset', ...(await f.service.run(context, { action: 'inspect', username: 'Trainer' })), requestId: randomUUID(), pin: '654321' }; }
async function resetRequest(f) { const r = await request(f); delete r.created; return r; }

test('password-only reset preserves exact UID, every product surface, links and reviewed66; exact replay does not mutate', async () => {
  const f = fixture(), before = structuredClone({ evidence: f.evidence, user: f.user, data: f.data });
  const input = await resetRequest(f), result = await f.service.run(context, input);
  assert.equal(result.status, 'completed'); assert.equal(f.password(), input.pin); assert.equal(f.mutations(), 1);
  assert.deepEqual({ evidence: f.evidence, user: f.user, data: f.data }, before);
  assert.equal((await f.service.run(context, input)).status, 'completed'); assert.equal(f.mutations(), 1);
  const journal = JSON.stringify(f.ledger()); assert.ok(!journal.includes(input.pin)); assert.ok(!journal.includes('123456'));
});
for (const [name, change] of [
  ['missing username', f => delete f.evidence.users.Trainer],
  ['missing authIndex', f => delete f.evidence.authIndex['trainer-uid']],
  ['missing UID', f => delete f.evidence.users.Trainer.authUid],
  ['missing directory', f => delete f.evidence.loginDirectory.Trainer],
  ['malformed UID', f => f.evidence.users.Trainer.authUid = '../uid'],
  ['wrong synthetic slot', f => f.user.email = 'trainer_v2@pogotrades.nyc'],
  ['missing Auth account', f => f.adapter.getAuthUser = async uid => uid === 'owner-uid' ? { uid, disabled: false } : null],
  ['reciprocal mismatch', f => f.evidence.authIndex['trainer-uid'].username = 'Other'],
  ['conflicting UID mapping', f => f.evidence.users.Other = { ...f.evidence.users.Trainer }],
  ['conflicting username mapping', f => f.evidence.authIndex.other = { username: 'Trainer' }],
  ['synthetic email alias', f => f.evidence.loginDirectory.trainer = { authReady: true, authVersion: 1 }],
  ['malformed version', f => f.evidence.users.Trainer.authVersion = '1'],
  ['directory version mismatch', f => f.evidence.loginDirectory.Trainer.authVersion = 2],
  ['Auth UID mismatch', f => f.user.uid = 'wrong'],
  ['disabled Auth user', f => f.user.disabled = true],
  ['frozen legacy identity', f => f.evidence.authIndex['trainer-uid'].frozen = true],
  ['Firestore ownership or conflict', f => f.adapter.legacyOnly = async () => false],
  ['provider-only credential', f => f.user.providerData = f.user.providerData.filter(p => p.providerId !== 'password')],
  ['duplicate Auth slot', f => f.adapter.listAuthIdentities = async () => [{ uid: 'trainer-uid', email: 'trainer@pogotrades.nyc' }, { uid: 'other', email: 'trainer_v2@pogotrades.nyc' }]],
  ['missing creation proof', f => delete f.user.metadata.creationTime]
]) test(`rejects ${name}`, async () => { const f = fixture(); change(f); await assert.rejects(f.service.run(context, { action: 'inspect', username: 'Trainer' })); assert.equal(f.mutations(), 0); });
for (const [name, caller] of [['unauthenticated', {}], ['ordinary user', { ...context, uid: 'trainer-uid' }], ['wrong owner', { ...context, uid: 'wrong' }],
  ['missing App Check', { ...context, appVerified: false }], ['stale owner login', { ...context, authTime: context.authTime - 1000 }]]) {
  test(`rejects ${name}`, async () => { const f = fixture(); await assert.rejects(f.service.run(caller, { action: 'inspect', username: 'Trainer' })); assert.equal(f.mutations(), 0); });
}
test('rejects revoked server admin and mismatched owner mapping', async () => {
  const f = fixture(); f.evidence.admins[context.uid] = false;
  await assert.rejects(f.service.run(context, { action: 'inspect', username: 'Trainer' }));
  f.evidence.admins[context.uid] = true; f.evidence.authIndex[context.uid].username = 'Other';
  await assert.rejects(f.service.run(context, { action: 'inspect', username: 'Trainer' }));
});
test('invalid PIN, generic updates, arbitrary UID, cross-account and stale fingerprint all rejected before mutation', async () => {
  const f = fixture(), input = await resetRequest(f);
  for (const invalid of [{ pin: 654321 }, { pin: '12345' }, { pin: '1234567' }, { pin: ' 654321' }, { pin: 'abcdef' }, { password: '654321' },
    { targetUid: 'other-uid' }, { username: 'Other' }, { fingerprint: '0'.repeat(64) }, { requestId: '../invalid' }, { email: 'other@example.test' }]) {
    await assert.rejects(f.service.run(context, { ...input, ...invalid }));
  }
  assert.equal(f.mutations(), 0);
});
test('changed replay target or credential rejected, and status never needs or returns PIN', async () => {
  const f = fixture(), input = await resetRequest(f); await f.service.run(context, input);
  for (const change of [{ pin: '777777' }, { targetUid: 'other-uid' }, { username: 'Other' }, { fingerprint: 'a'.repeat(64) }]) {
    await assert.rejects(f.service.run(context, { ...input, ...change }), { code: 'reset/replay-mismatch' });
  }
  const { pin, ...status } = input;
  assert.equal((await f.service.run(context, { ...status, action: 'status' })).status, 'completed');
  assert.equal(f.mutations(), 1);
});
test('Auth lost response stays ambiguous; exact replay and a different request cannot repeat mutation', async () => {
  const f = fixture(), input = await resetRequest(f), update = f.adapter.updatePassword;
  f.adapter.updatePassword = async (...args) => { await update(...args); throw new Error('lost response'); };
  assert.equal((await f.service.run(context, input)).status, 'ambiguous');
  assert.equal((await f.service.run(context, input)).status, 'ambiguous');
  await assert.rejects(f.service.run(context, { ...input, requestId: randomUUID() }), { code: 'reset/target-locked' });
  assert.equal(f.mutations(), 1);
});
test('lost completion response reconciles from durable completion, without repeating password update', async () => {
  const f = fixture(), input = await resetRequest(f), save = f.store.compareAndSwap;
  f.store.compareAndSwap = async (...args) => { await save(...args); if (f.ledger().records[0]?.status === 'completed') throw new Error('lost acknowledgement'); };
  assert.equal((await f.service.run(context, input)).status, 'ambiguous');
  assert.equal((await f.service.run(context, input)).status, 'completed'); assert.equal(f.mutations(), 1);
});
test('lost reservation acknowledgement never starts mutation or takes over a pending request', async () => {
  const f = fixture(), input = await resetRequest(f), save = f.store.compareAndSwap;
  f.store.compareAndSwap = async (...args) => { await save(...args); throw new Error('lost acknowledgement'); };
  await assert.rejects(f.service.run(context, input));
  assert.equal((await f.service.run(context, input)).status, 'pending'); assert.equal(f.mutations(), 0);
});
test('concurrent same-target requests are serialized by durable CAS, not instance memory', async () => {
  const f = fixture(), input = await resetRequest(f);
  const result = await Promise.allSettled([f.service.run(context, input), f.service.run(context, { ...input, requestId: randomUUID() })]);
  assert.equal(f.mutations(), 1); assert.ok(result.some(r => r.status === 'fulfilled' && r.value.status === 'completed'));
});
test('identity changes after inspection or reservation stop credential mutation', async () => {
  const f = fixture(), input = await resetRequest(f), save = f.store.compareAndSwap;
  f.store.compareAndSwap = async (...args) => { await save(...args); f.evidence.users.Trainer.authUid = 'other'; };
  assert.equal((await f.service.run(context, input)).status, 'aborted'); assert.equal(f.mutations(), 0);
});
test('missing ledger is fail-closed, not an empty replay history', async () => {
  const f = fixture(), input = await resetRequest(f); f.store.read = async () => ({ generation: 0, value: null });
  await assert.rejects(f.service.run(context, input)); assert.equal(f.mutations(), 0);
});
test('concrete adapter exposes only password update; no write is possible through product adapters', async () => {
  const calls = [], adapter = createAdapter({ database: {}, firestore: {}, auth: {}, updatePassword: createPasswordUpdater({
    projectId: 'trade-list-a4297', credential: { getAccessToken: async () => ({ access_token: 'test-token' }) },
    fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body), redirect: options.redirect }); return { ok: true, json: async () => ({ localId: 'existing-uid' }) }; }
  }) });
  await adapter.updatePassword('existing-uid', '654321');
  assert.deepEqual(calls, [{ url: 'https://identitytoolkit.googleapis.com/v1/projects/trade-list-a4297/accounts:update', body: { localId: 'existing-uid', password: '654321' }, redirect: 'error' }]);
  assert.deepEqual(Object.keys(adapter).sort(), ['getAuthUser', 'legacyOnly', 'listAuthIdentities', 'readEvidence', 'updatePassword']);
});
test('password transport never retries 503 or lost HTTP responses and cannot select a non-emulator alternate project', async () => {
  for (const failure of ['503', 'network']) {
    let calls = 0;
    const update = createPasswordUpdater({ projectId: 'trade-list-a4297', credential: { getAccessToken: async () => ({ access_token: 'test-token' }) },
      fetchImpl: async () => { calls++; if (failure === 'network') throw new Error('lost'); return { ok: false }; } });
    await assert.rejects(update('existing-uid', '654321')); assert.equal(calls, 1);
  }
  assert.throws(() => createPasswordUpdater({ projectId: 'trade-list-a4297', emulatorHost: '127.0.0.1:9399' }));
});
test('control-plane bypass of enforced Rules is detected as ambiguous, never repaired by reset', async () => {
  const f = fixture(), input = await resetRequest(f), update = f.adapter.updatePassword;
  f.adapter.updatePassword = async (...args) => {
    // Deliberately bypass the Rules tested in legacy-identity-guard.test.cjs.
    f.evidence.users.Trainer.authUid = 'new-binding-uid';
    f.evidence.authIndex['trainer-uid'].username = 'Other';
    await update(...args);
  };
  assert.equal((await f.service.run(context, input)).status, 'ambiguous');
  assert.equal(f.mutations(), 1, 'This is a control-plane bypass diagnostic, not an exclusion proof');
  await assert.rejects(f.service.run(context, { ...input, requestId: randomUUID() }));
});
test('control-plane Auth recreation bypass is ambiguous; application writers must lack create/delete IAM', async () => {
  const f = fixture(), input = await resetRequest(f), update = f.adapter.updatePassword;
  f.adapter.updatePassword = async (...args) => {
    f.user.metadata.creationTime = '2026-09-05T00:00:00Z';
    await update(...args);
  };
  assert.equal((await f.service.run(context, input)).status, 'ambiguous');
  assert.equal(f.mutations(), 1, 'Deployment must prove denied create/delete; no read can fence a project owner');
});
test('Unicode compatibility aliases in legacy identity roots fail closed', async () => {
  for (const root of ['users', 'loginDirectory', 'authIndex']) {
    const f = fixture(), alias = '\uFF34rainer';
    if (root === 'authIndex') f.evidence[root].other = { username: alias };
    else f.evidence[root][alias] = { authUid: 'other', authReady: true, authVersion: 1 };
    await assert.rejects(f.service.run(context, { action: 'inspect', username: 'Trainer' }));
    assert.equal(f.mutations(), 0);
  }
});
test('malformed completed receipts cannot claim a successful status', async () => {
  const corruptions = [r => delete r.credentialFingerprint, r => r.startedAt = 'yesterday', r => delete r.finishedAt,
    r => r.credentialFingerprint = '123456', r => r.pin = '123456'];
  for (const corrupt of corruptions) {
    const f = fixture(), input = await resetRequest(f);
    await f.service.run(context, input);
    corrupt(f.ledger().records[0]);
    const { pin, ...status } = input;
    await assert.rejects(f.service.run(context, { ...status, action: 'status' }), { code: 'reset/journal-invalid' });
    assert.equal(f.mutations(), 1);
  }
});
test('leading zero is preserved and concurrent identical requests mutate once', async () => {
  const f = fixture(), input = { ...await resetRequest(f), pin: '001234' };
  const results = await Promise.all([f.service.run(context, input), f.service.run(context, input)]);
  assert.ok(results.some(r => r.status === 'completed'));
  assert.equal(f.mutations(), 1); assert.equal(f.password(), '001234');
});
test('process death after mutation leaves pending receipt locked without a retry', async () => {
  const f = fixture(), input = await resetRequest(f), update = f.adapter.updatePassword;
  let reached;
  const mutation = new Promise(resolve => { reached = resolve; });
  f.adapter.updatePassword = async (...args) => { await update(...args); reached(); return new Promise(() => {}); };
  // Abandon the first invocation, exactly where a terminated process leaves it.
  void f.service.run(context, input);
  await mutation;
  const restarted = createResetService({ adapter: f.adapter, journal: createJournal(f.store), ownerUid: context.uid, hmacKey: 'k'.repeat(64), now: () => now });
  assert.equal((await restarted.run(context, input)).status, 'pending');
  await assert.rejects(restarted.run(context, { ...input, requestId: randomUUID() }), { code: 'reset/target-locked' });
  assert.equal(f.mutations(), 1);
});
for (const authTime of [undefined, null, '1800000000', NaN, 0, context.authTime + 31, context.authTime - 901]) {
  test(`malformed or nonrecent auth_time ${String(authTime)} fails before mutation despite fresh iat`, async () => {
    const f = fixture();
    await assert.rejects(f.service.run({ ...context, authTime, iat: context.authTime }, await resetRequest(f)));
    assert.equal(f.mutations(), 0);
  });
}
module.exports = { fixture, context, resetRequest };
