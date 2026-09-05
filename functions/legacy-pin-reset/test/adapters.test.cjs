'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdapter } = require('../adapter');
const { createGcsStore } = require('../journal');
const { createPasswordUpdater } = require('../password');
test('HTTP 200 without the exact returned UID is ambiguous, never success', async () => {
  for (const body of [{}, { localId: 'other-uid' }, { localId: null }]) {
    let sends = 0;
    const update = createPasswordUpdater({ projectId: 'trade-list-a4297', credential: { getAccessToken: async () => ({ access_token: 'test' }) },
      fetchImpl: async () => { sends++; return { ok: true, json: async () => body }; } });
    await assert.rejects(update('existing-uid', '001234'), { code: 'reset/auth-update-unconfirmed' });
    assert.equal(sends, 1);
  }
});
test('RTDB adapter reads only identity roots and removes credentials/profile from returned evidence', async () => {
  const paths = [], raw = { users: { Trainer: { authUid: 'uid', authEmail: 'trainer@pogotrades.nyc', authVersion: 1, pin: 'not-returned', pinHashed: true, profile: 'private' } },
    authIndex: { uid: { username: 'Trainer', accountSyncRecoveryReviews: { preserved: true } } }, loginDirectory: { Trainer: { authVersion: 1, authReady: true } }, admins: { owner: true } };
  const adapter = createAdapter({ database: { ref: path => { paths.push(path); return { get: async () => ({ val: () => raw[path] }) }; } } });
  const evidence = await adapter.readEvidence(); assert.deepEqual(paths, ['users', 'loginDirectory', 'authIndex', 'admins']);
  assert.deepEqual(evidence.users.Trainer, { authUid: 'uid', authEmail: 'trainer@pogotrades.nyc', authVersion: 1 });
  assert.deepEqual(evidence.authIndex.uid, { username: 'Trainer' }); assert.equal(raw.users.Trainer.pin, 'not-returned');
});
test('Firestore adapter reads only account, handle and bounded conflict evidence; any evidence blocks legacy reset', async () => {
  for (const blocked of ['none', 'accounts', 'trainerHandles', 'conflicts']) {
    const paths = [], adapter = createAdapter({ firestore: {
      doc: path => { paths.push(path); return { get: async () => ({ exists: path.startsWith(`${blocked}/`) }) }; },
      collection: path => { paths.push(path); return { limit: count => { assert.equal(count, 1); return { get: async () => ({ empty: blocked !== 'conflicts' }) }; } }; }
    } });
    assert.equal(await adapter.legacyOnly('uid', 'Trainer'), blocked === 'none');
    assert.deepEqual(paths, ['accounts/uid', 'trainerHandles/v1_747261696e6572', 'identityConflicts/uid/events']);
  }
});
test('GCS store pins read generation and uses conditional overwrite; missing object is never initialized', async () => {
  const calls = [], bucket = { file: (name, options) => { calls.push({ name, options }); return {
    getMetadata: async () => [{ generation: '123', size: '32' }], download: async () => [Buffer.from('{"schemaVersion":1,"records":[]}')],
    save: async (body, options) => { calls.push({ body, options }); }
  }; } };
  const store = createGcsStore(bucket), read = await store.read();
  assert.equal(read.generation, '123'); assert.equal(calls[1].options.generation, '123');
  await store.compareAndSwap(read.generation, read.value);
  assert.equal(calls[3].options.preconditionOpts.ifGenerationMatch, '123'); assert.equal(calls[3].options.resumable, false);
  const missing = createGcsStore({ file: () => ({ getMetadata: async () => { throw Object.assign(new Error(), { code: 404 }); } }) });
  await assert.rejects(missing.read());
});
test('read-only evidence acquisition errors fail closed', async () => {
  const adapter = createAdapter({ database: { ref: () => ({ get: async () => { throw new Error('permission denied'); } }) },
    firestore: { doc: () => ({ get: async () => { throw new Error('permission denied'); } }) } });
  await assert.rejects(adapter.readEvidence()); await assert.rejects(adapter.legacyOnly('uid', 'Trainer'));
});
test('deployment plan has no product write/create/delete or provider runtime authority', () => {
  const plan = require('../deployment-plan.json');
  assert.deepEqual(plan.runtimePermissions.project, ['firebaseauth.users.get', 'firebaseauth.users.update', 'firebasedatabase.instances.get']);
  assert.deepEqual(plan.runtimePermissions.identityDatabaseReadOnly.permissions, ['datastore.entities.get', 'datastore.entities.list']);
  assert.equal(plan.runtimePermissions.secret.name, 'legacy-pin-reset-hmac');
  assert.equal(plan.runtimePermissions.secret.bindingScope, 'this-secret-only');
  assert.equal(plan.runtimePermissions.journal.object, 'legacy-pin-reset/v1/ledger.json');
  assert.equal(plan.runtimePermissions.journal.publicAccessPrevention, 'enforced');
  assert.equal(plan.identityBoundary.mode, 'immutable-bindings-v1');
  assert.deepEqual(plan.identityBoundary.legacySdkReplacementPermissions, ['firebaseauth.users.get', 'firebasedatabase.instances.get']);
  assert.ok(plan.identityBoundary.legacySdkRemoveProjectRoles.includes('roles/iam.serviceAccountTokenCreator'));
  for(const permission of plan.identityBoundary.prohibitedApplicationPermissions)assert.ok(!plan.runtimePermissions.project.includes(permission));
});
test('missing GCS generation cannot degrade the ledger to an unconditional write', async () => {
  let downloads = 0;
  const store = createGcsStore({ file: () => ({ getMetadata: async () => [{ size: '32' }], download: async () => { downloads++; } }) });
  await assert.rejects(store.read(), { code: 'reset/journal-invalid' }); assert.equal(downloads, 0);
});
