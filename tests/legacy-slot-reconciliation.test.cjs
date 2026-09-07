'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, expectedFences, classifyState, reconcileLegacySlot } = require('../scripts/lib/legacy-slot-reconciliation.cjs');
const { CONTRACT, ROOT } = require('../functions/legacy-pin-reset/identity-fence');
const { createResetService } = require('../functions/legacy-pin-reset/reset');
const { createAdapter } = require('../functions/legacy-pin-reset/adapter');
const { createReconciliationTransport } = require('../scripts/lib/legacy-slot-reconciliation-transport.cjs');

function fixture() {
  const uid = 'synthetic-v3', obsolete = 'synthetic-v2', username = 'Trainer';
  const data = { users: { Doomsday126: { authUid: 'owner-uid', isAdmin: true }, Trainer: { authUid: uid, authVersion: 3, authEmail: 'trainer_v3@pogotrades.nyc' } },
    loginDirectory: { Trainer: { authReady: true, authVersion: 3 } }, authIndex: { 'owner-uid': { username: 'Doomsday126' } }, admins: { 'owner-uid': true },
    wishlist: { Trainer: { Pikachu: 'H' } }, publicShares: { Trainer: { username, lists: { wishlist: { Pikachu: 'H' } } } },
    userCommunities: { [uid]: { nyc: { username, role: 'member', joinedAt: 1 } }, [obsolete]: { nyc: { username, role: 'member', joinedAt: 1 } } },
    communities: { nyc: { ownerId: 'owner-uid', members: { [uid]: true, [obsolete]: true }, memberUsernames: { Trainer: true } } } };
  const auth = Object.fromEntries([[uid, 3], [obsolete, 2]].map(([id, version]) => [id, { uid: id, email: `trainer_v${version}@pogotrades.nyc`, disabled: false,
    metadata: { creationTime: `2026-05-0${version}T00:00:00Z` }, providerData: [{ providerId: 'password', uid: `trainer_v${version}@pogotrades.nyc` }] }]));
  auth['owner-uid'] = { uid: 'owner-uid', disabled: false };
  const fsEvidence = new Set(), reads = [], mutations = [], progress = [];
  const get = path => path.split('/').reduce((value, key) => value?.[key], data) ?? null;
  const readProtected = () => {
    const clone = structuredClone(data); delete clone.authIndex[uid];
    if (clone[ROOT]) { delete clone[ROOT][uid]; delete clone[ROOT][obsolete]; if (!Object.keys(clone[ROOT]).length) delete clone[ROOT]; }
    return fingerprint(clone);
  };
  const etag = value => value === null ? 'null_etag' : `"${fingerprint(value)}"`;
  const boundary = { resetEnabled: false, quiesced: true, pendingResetCount: 0, immutableBindingsVerified: true, fingerprint: 'b'.repeat(64),
    securityContract: CONTRACT, rulesFingerprint: 'c'.repeat(64) };
  const adapter = createAdapter({ database: { ref: path => ({ get: async () => { reads.push(path); return { val: () => structuredClone(get(path)) }; } }) },
    auth: { getUser: async id => structuredClone(auth[id]), listUsers: async () => ({ users: Object.values(auth) }) },
    firestore: { doc: path => ({ get: async () => ({ exists: fsEvidence.has(path) }) }), collection: path => {
      const query = { where: (field, op, uid) => { assert.equal(field, 'uid'); assert.equal(op, '=='); assert.equal(uid, obsolete); return query; },
        limit: count => { assert.equal(count, 1); return query; }, get: async () => ({ empty: !fsEvidence.has(path) }) };
      return query;
    } },
    updatePassword: async () => { throw Error('No PIN change in reconciliation'); } });
  const service = createResetService({ adapter, ownerUid: 'owner-uid', hmacKey: 'k'.repeat(64), journal: {}, now: () => 1800000000000 });
  const context = { uid: 'owner-uid', authTime: 1800000000, appVerified: true };
  const index = { username, authEmail: auth[uid].email, authVersion: 3 };
  const manifest = { schemaVersion: 1, operation: 'reconcile-inactive-legacy-slot', projectId: 'demo-legacy-pin-reset', username, authoritativeUid: uid, obsoleteUid: obsolete,
    authVersion: 3, obsoleteVersion: 2, protectedFingerprint: readProtected(), authoritativeAuthFingerprint: fingerprint(auth[uid]), obsoleteAuthFingerprint: fingerprint(auth[obsolete]),
    authoritativeCreatedAt: Date.parse(auth[uid].metadata.creationTime), obsoleteCreatedAt: Date.parse(auth[obsolete].metadata.creationTime), createdAt: 1800000000000,
    securityContract: CONTRACT, rulesFingerprint: boundary.rulesFingerprint, boundaryFingerprint: boundary.fingerprint,
    permittedMutations: [{ path: `${ROOT}/${uid}`, method: 'create-maintenance' }, { path: `${ROOT}/${obsolete}`, method: 'create-maintenance' },
      { path: `${ROOT}/${obsolete}`, method: 'retire-exact-maintenance' }, { uid: obsolete, method: 'disable-existing-auth', disabled: true },
      { path: `authIndex/${uid}`, method: 'create-only', value: index }, { path: `${ROOT}/${uid}`, method: 'release-exact-maintenance' }] };
  const operator = {
    readState: async () => ({ boundary: structuredClone(boundary), user: structuredClone(data.users.Trainer), directory: structuredClone(data.loginDirectory.Trainer),
      authoritativeAuth: structuredClone(auth[uid]), obsoleteAuth: structuredClone(auth[obsolete]), authoritativeIndex: get(`authIndex/${uid}`), obsoleteIndex: get(`authIndex/${obsolete}`),
      authoritativeFence: get(`${ROOT}/${uid}`), obsoleteFence: get(`${ROOT}/${obsolete}`), authoritativeFenceEtag: etag(get(`${ROOT}/${uid}`)), obsoleteFenceEtag: etag(get(`${ROOT}/${obsolete}`)),
      indexEtag: etag(get(`authIndex/${uid}`)), protectedFingerprint: readProtected(), authorityConverged: true, obsoleteHasUniqueState: false }),
    compareAndSetFence: async (target, expected, value, expectedEtag) => {
      assert.ok([uid, obsolete].includes(target)); assert.deepEqual(get(`${ROOT}/${target}`), expected); assert.equal(etag(expected), expectedEtag);
      data[ROOT] ||= {}; if (value === null) delete data[ROOT][target]; else data[ROOT][target] = structuredClone(value);
      mutations.push(target === uid ? value === null ? 'release-current' : 'hold-current' : value.state === 'retired' ? 'retire' : 'hold-old');
    },
    createIndexOnly: async (target, value, etag) => { assert.equal(target, uid); assert.equal(etag, 'null_etag'); assert.equal(get(`authIndex/${uid}`), null); data.authIndex[uid] = structuredClone(value); mutations.push('index'); },
    disableExistingAuth: async (target, expected) => { assert.equal(target, obsolete); assert.equal(fingerprint(auth[obsolete]), expected); auth[obsolete].disabled = true; mutations.push('disable'); },
    recordProgress: async value => { progress.push(value); }
  };
  return { data, auth, uid, obsolete, index, manifest, operator, service, adapter, context, fsEvidence, reads, mutations, progress, boundary, get, etag };
}
const ALL_MUTATIONS = ['hold-current', 'hold-old', 'retire', 'disable', 'index', 'release-current'];
const PHASES = ['before', 'authoritative-held', 'both-held', 'retired', 'disabled', 'indexed', 'reconciled'];

test('exact v3 missing-index and enabled-v2 class fails before repair, then preserves authority and becomes inspectable', async () => {
  const f = fixture(), before = structuredClone(f.data), primary = structuredClone(f.auth[f.uid]);
  await assert.rejects(f.service.run(f.context, { action: 'inspect', username: 'Trainer' }), { code: 'reset/identity-conflict' });
  const result = await reconcileLegacySlot(f.manifest, f.operator);
  assert.equal(result.phase, 'reconciled'); assert.deepEqual(f.mutations, ALL_MUTATIONS);
  assert.deepEqual(f.data, { ...before, authIndex: { ...before.authIndex, [f.uid]: f.index }, [ROOT]: { [f.obsolete]: expectedFences(f.manifest).obsoleteRetired } });
  assert.deepEqual(f.auth[f.uid], primary); assert.equal(f.auth[f.obsolete].disabled, true);
  assert.equal((await f.service.run(f.context, { action: 'inspect', username: 'Trainer' })).targetUid, f.uid);
  assert.deepEqual((await reconcileLegacySlot(f.manifest, f.operator, { resume: true })).mutations, []);
  assert.deepEqual(f.mutations, ALL_MUTATIONS);
});

for (let stage = 0; stage < ALL_MUTATIONS.length; stage++) for (const lostResponse of [false, true]) {
  test(`failure ${lostResponse ? 'after' : 'before'} ${ALL_MUTATIONS[stage]} resumes without compensating or replayed writes`, async () => {
    const f = fixture(), original = { ...f.operator };
    let calls = 0;
    for (const method of ['compareAndSetFence', 'disableExistingAuth', 'createIndexOnly']) f.operator[method] = async (...args) => {
      const fail = calls++ === stage;
      if (fail && !lostResponse) throw Error('before write');
      await original[method](...args);
      if (fail) throw Error('lost response');
    };
    await assert.rejects(reconcileLegacySlot(f.manifest, f.operator));
    assert.equal(f.progress.at(-1).phase, 'verification-required');
    Object.assign(f.operator, original);
    const expectedPhase = PHASES[stage + Number(lostResponse)];
    assert.equal(classifyState(f.manifest, await f.operator.readState()), expectedPhase);
    if (expectedPhase !== 'reconciled') await assert.rejects(f.service.run(f.context, { action: 'inspect', username: 'Trainer' }), { code: 'reset/identity-conflict' });
    assert.equal((await reconcileLegacySlot(f.manifest, f.operator, { resume: true })).phase, 'reconciled');
    assert.deepEqual(f.mutations, ALL_MUTATIONS);
  });
}
test('final read failure retains retirement and exact resume performs no mutation', async () => {
  const f = fixture(), read = f.operator.readState;
  f.operator.readState = async () => { if (f.mutations.length === ALL_MUTATIONS.length) throw Error('read unavailable'); return read(); };
  await assert.rejects(reconcileLegacySlot(f.manifest, f.operator));
  f.operator.readState = read;
  assert.equal(classifyState(f.manifest, await read()), 'reconciled');
  assert.deepEqual((await reconcileLegacySlot(f.manifest, f.operator, { resume: true })).mutations, []);
  assert.deepEqual(f.mutations, ALL_MUTATIONS);
});

for (const [name, change] of [
  ['enabled reset', f => f.boundary.resetEnabled = true], ['unquiesced reset', f => f.boundary.quiesced = false],
  ['pending reset', f => f.boundary.pendingResetCount = 1], ['changed boundary', f => f.boundary.fingerprint = 'c'.repeat(64)],
  ['missing immutable exclusion', f => f.boundary.immutableBindingsVerified = false],
  ['old unfenced contract', f => f.boundary.securityContract = 'immutable-bindings-v1'],
  ['Rules drift', f => f.boundary.rulesFingerprint = 'd'.repeat(64)],
  ['changed forward UID', f => f.data.users.Trainer.authUid = 'another-uid'],
  ['new obsolete data', f => f.data.accountSync = { [f.obsolete]: { unique: true } }],
  ['changed public data', f => f.data.publicShares.Trainer.lists.wishlist.Pikachu = 'M'],
  ['Auth recreation', f => f.auth[f.obsolete].metadata.creationTime = '2026-09-07T00:00:00Z'],
  ['conflicting index', f => f.data.authIndex[f.uid] = { username: 'Other' }],
  ['unknown partial state', f => f.auth[f.obsolete].disabled = true],
  ['extra mutation', f => f.manifest.permittedMutations.push({ path: 'users/Other', method: 'delete' })]
]) test(`operator rejects ${name} before a production-capable mutation`, async () => {
  const f = fixture(); change(f); await assert.rejects(reconcileLegacySlot(f.manifest, f.operator)); assert.deepEqual(f.mutations, []);
});

test('state changes after the index write retain the maintenance fence and exact index for review', async () => {
  const f = fixture(), write = f.operator.createIndexOnly;
  f.operator.createIndexOnly = async (...args) => { await write(...args); f.data.users.Trainer.authUid = 'changed-uid'; };
  await assert.rejects(reconcileLegacySlot(f.manifest, f.operator), { code: 'repair/precondition-changed' });
  assert.deepEqual(f.mutations, ALL_MUTATIONS.slice(0, 5)); assert.deepEqual(f.data.authIndex[f.uid], f.index); assert.equal(f.auth[f.obsolete].disabled, true);
  assert.equal(f.data[ROOT][f.uid].state, 'maintenance');
});

for (const [name, change] of [
  ['active duplicate', f => f.auth[f.obsolete].disabled = false],
  ['mapped obsolete UID', f => f.data.users.Other = { authUid: f.obsolete }],
  ['directory obsolete UID', f => f.data.loginDirectory.Other = { authUid: f.obsolete }],
  ['obsolete index', f => f.data.authIndex[f.obsolete] = { username: 'Other' }],
  ['obsolete admin', f => f.data.admins[f.obsolete] = true],
  ['obsolete linked provider', f => f.auth[f.obsolete].providerData.push({ providerId: 'google.com', uid: 'subject' })],
  ['obsolete claims', f => f.auth[f.obsolete].customClaims = { admin: true }],
  ['obsolete phone', f => f.auth[f.obsolete].phoneNumber = '+15555550100'],
  ['obsolete MFA', f => f.auth[f.obsolete].multiFactor = { enrolledFactors: [{}] }],
  ['future credential version', f => f.auth[f.obsolete].email = 'trainer_v4@pogotrades.nyc'],
  ['newer Auth incarnation', f => f.auth[f.obsolete].metadata.creationTime = '2026-06-01T00:00:00Z'],
  ['unique canonical data', f => f.data.accountSync = { [f.obsolete]: { meta: { initialized: true } } }],
  ['unique preferences', f => f.data.userPreferences = { [f.obsolete]: { unique: true } }],
  ['unique community', f => f.data.userCommunities[f.obsolete].another = { username: 'Trainer', role: 'member', joinedAt: 1 }],
  ['community owner', f => f.data.communities.nyc.ownerId = f.obsolete],
  ['community admin', f => f.data.communities.nyc.admins = { [f.obsolete]: true }],
  ['unmatched forward membership', f => f.data.communities.other = { members: { [f.obsolete]: true } }],
  ['Firestore account', f => f.fsEvidence.add(`accounts/${f.obsolete}`)],
  ['orphan provider document', f => f.fsEvidence.add(`accounts/${f.obsolete}/providers`)],
  ['migration authority', f => f.fsEvidence.add(`identityMigrations/${f.obsolete}/operations`)],
  ['identity conflict', f => f.fsEvidence.add(`identityConflicts/${f.obsolete}/events`)]
]) test(`normal reset still rejects ${name} after otherwise valid reconciliation`, async () => {
  const f = fixture(); await reconcileLegacySlot(f.manifest, f.operator); change(f);
  await assert.rejects(f.service.run(f.context, { action: 'inspect', username: 'Trainer' }), { code: 'reset/identity-conflict' });
});

for (const [name, change] of [
  ['missing retirement record', f => delete f.data[ROOT][f.obsolete]],
  ['unfinished retirement', f => f.data[ROOT][f.obsolete].state = 'maintenance'],
  ['active maintenance', f => f.data[ROOT][f.uid] = expectedFences(f.manifest).authoritative],
  ['wrong canonical UID', f => f.data[ROOT][f.obsolete].authoritativeUid = 'another'],
  ['wrong username', f => f.data[ROOT][f.obsolete].username = 'Other'],
  ['wrong version', f => f.data[ROOT][f.obsolete].obsoleteVersion = 1],
  ['wrong incarnation', f => f.data[ROOT][f.obsolete].obsoleteCreatedAt++],
  ['unexpected metadata', f => f.data[ROOT][f.obsolete].extra = true]
]) test(`strict reset rejects ${name}`, async () => {
  const f = fixture(); await reconcileLegacySlot(f.manifest, f.operator); change(f);
  await assert.rejects(f.service.run(f.context, { action: 'inspect', username: 'Trainer' }), { code: 'reset/identity-conflict' });
});

function heldFixture() {
  const f = fixture(), fences = expectedFences(f.manifest);
  f.data[ROOT] = { [f.uid]: fences.authoritative, [f.obsolete]: fences.obsoleteRetired };
  return f;
}
function transportOptions(f) {
  return { manifest: f.manifest, authEmulatorHost: '127.0.0.1:9499', databaseEmulatorHost: '127.0.0.1:9500',
    readObsoleteAuth: async () => structuredClone(f.auth[f.obsolete]), readIndex: async uid => f.get(`authIndex/${uid}`),
    readFence: async uid => { const value = f.get(`${ROOT}/${uid}`); return { value, etag: f.etag(value) }; } };
}
test('network adapter permits only exact create-only index and one disable-existing request, never a PIN or generic update', async () => {
  const f = heldFixture(), calls = [];
  const transport = createReconciliationTransport({ ...transportOptions(f), fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, redirect: options.redirect, etag: options.headers['if-match'], body: JSON.parse(options.body) });
      if (options.method === 'POST') f.auth[f.obsolete].disabled = true;
      return { ok: true, json: async () => options.method === 'PUT' ? f.index : { localId: f.obsolete } };
    } });
  for (const target of ['other-uid', f.obsolete]) await assert.rejects(transport.createIndexOnly(target, f.index, 'null_etag'));
  await assert.rejects(transport.createIndexOnly(f.uid, { ...f.index, pin: '123456' }, 'null_etag'));
  await assert.rejects(transport.createIndexOnly(f.uid, f.index, 'ordinary-etag'));
  await assert.rejects(transport.disableExistingAuth(f.uid, f.manifest.obsoleteAuthFingerprint));
  assert.equal(calls.length, 0);
  await transport.disableExistingAuth(f.obsolete, f.manifest.obsoleteAuthFingerprint);
  await transport.createIndexOnly(f.uid, f.index, 'null_etag');
  assert.deepEqual(calls, [
    { url: 'http://127.0.0.1:9499/identitytoolkit.googleapis.com/v1/projects/demo-legacy-pin-reset/accounts:update', method: 'POST', redirect: 'error', etag: undefined, body: { localId: f.obsolete, disableUser: true } },
    { url: `http://127.0.0.1:9500/authIndex/${f.uid}.json?ns=demo-legacy-pin-reset-default-rtdb`, method: 'PUT', redirect: 'error', etag: 'null_etag', body: f.index }
  ]);
});

for (const failure of ['503', 'network', 'wrong-uid', '412']) test(`transport ${failure} fails without hidden retries or compensation`, async () => {
  const f = heldFixture(); let calls = 0;
  if (failure === '412') f.auth[f.obsolete].disabled = true;
  const transport = createReconciliationTransport({ ...transportOptions(f),
    fetchImpl: async () => { calls++; if (failure === 'network') throw Error('lost'); return { ok: failure === 'wrong-uid', status: Number(failure), json: async () => ({ localId: 'other-uid' }) }; } });
  await assert.rejects(failure === '412' ? transport.createIndexOnly(f.uid, f.index, 'null_etag') : transport.disableExistingAuth(f.obsolete, f.manifest.obsoleteAuthFingerprint));
  assert.equal(calls, 1);
});

test('transport rereads the obsolete Auth incarnation immediately before disable', async () => {
  const f = heldFixture(); let sends = 0;
  const transport = createReconciliationTransport({ ...transportOptions(f),
    readObsoleteAuth: async () => ({ ...f.auth[f.obsolete], uid: 'replacement' }), fetchImpl: async () => { sends++; } });
  await assert.rejects(transport.disableExistingAuth(f.obsolete, f.manifest.obsoleteAuthFingerprint), { code: 'repair/precondition-changed' });
  assert.equal(sends, 0);
});

test('unfenced manifests cannot enable production apply or its transport', async () => {
  const f = fixture(), manifest = { ...f.manifest, projectId: 'trade-list-a4297', securityContract: 'immutable-bindings-v1' };
  let reads = 0;
  const operator = { ...f.operator, readState: async () => { reads++; return f.operator.readState(); } };
  await assert.rejects(reconcileLegacySlot(manifest, operator), { code: 'repair/manifest-invalid' });
  assert.throws(() => createReconciliationTransport({ manifest }), { code: 'repair/manifest-invalid' });
  assert.equal(reads, 0); assert.deepEqual(f.mutations, []);
  assert.equal((await reconcileLegacySlot(f.manifest, f.operator, { verifyOnly: true })).phase, 'before');
});
test('transport requires both exact fences before disabling or creating the index', async () => {
  for (const target of ['uid', 'obsolete']) {
    const f = heldFixture(); delete f.data[ROOT][f[target]];
    let sends = 0;
    const transport = createReconciliationTransport({ ...transportOptions(f), fetchImpl: async () => { sends++; } });
    await assert.rejects(transport.disableExistingAuth(f.obsolete, f.manifest.obsoleteAuthFingerprint), { code: 'repair/fence-precondition-failed' });
    await assert.rejects(transport.createIndexOnly(f.uid, f.index, 'null_etag'), { code: 'repair/fence-precondition-failed' });
    assert.equal(sends, 0);
  }
});
test('transport never releases retirement, foreign maintenance, or a hold before exact index verification', async () => {
  const f = heldFixture(), fences = expectedFences(f.manifest); let sends = 0;
  const transport = createReconciliationTransport({ ...transportOptions(f), fetchImpl: async () => { sends++; } });
  for (const [uid, expected, next, etag] of [[f.obsolete, fences.obsoleteRetired, null, f.etag(fences.obsoleteRetired)],
    ['other', null, fences.authoritative, 'null_etag'], [f.uid, null, { ...fences.authoritative, extra: true }, 'null_etag']]) {
    await assert.rejects(transport.compareAndSetFence(uid, expected, next, etag), { code: 'repair/mutation-scope-invalid' });
  }
  f.auth[f.obsolete].disabled = true;
  await assert.rejects(transport.compareAndSetFence(f.uid, fences.authoritative, null, f.etag(fences.authoritative)), { code: 'repair/index-precondition-failed' });
  f.data.authIndex[f.uid] = f.index;
  await assert.rejects(transport.compareAndSetFence(f.uid, fences.authoritative, null, 'stale-etag'), { code: 'repair/fence-precondition-failed' });
  assert.equal(sends, 0);
});
