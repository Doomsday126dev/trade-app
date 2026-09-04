'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { setup, pipeline } = require('./fixtures/provider-identity-pipeline-fixture.cjs');
const { createProductionAdapter } = require('../scripts/run-provider-identity-live-window.cjs');
const { readProduction } = require('../scripts/prepare-provider-identity-window.cjs');
const { createFirestoreE1AuthorityAdapter } = require('../e1-authority-service/firestoreE1AuthorityAdapter.js');
const { canonicalHandle } = require('../src/domain/e1AuthorityBoundary');
const { orchestrate } = require('../production/providerIdentityOrchestrator.cjs');
const { sha256 } = require('../production/providerIdentityWindow.cjs');

test('concrete pipeline uses real Rules, REST identity writes, server clock, inventory and aborted admission transaction', async (t) => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-pogo-provider-pipeline', 'requires isolated emulator command');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:9411');
  const project = 'demo-pogo-provider-pipeline', namespace = `${project}-default-rtdb`;
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-emulator-pipeline-'));
  const repo = path.join(directory, 'source'), run = path.join(directory, 'fixture');
  fs.mkdirSync(run, { mode: 0o700 });
  execFileSync('git', ['clone', '--quiet', '--sparse', '--shared', path.resolve(__dirname, '../..'), repo]);
  const v = setup(run, repo), originalFetch = global.fetch;
  const app = initializeApp({ projectId: project }, 'provider-pipeline');
  const firestore = getFirestore(app, 'phase-e-identity');
  t.after(async () => { global.fetch = originalFetch; await deleteApp(app); fs.rmSync(directory, { recursive: true, force: true }); });
  // Only transport endpoints are changed. The production REST adapter and
  // production inventory parsers execute unmodified; no public host can escape.
  global.fetch = (input, options = {}) => {
    const url = new URL(input);
    let body = options.body;
    if (url.hostname === 'firestore.googleapis.com') {
      url.protocol = 'http:'; url.host = '127.0.0.1:9411';
      url.pathname = url.pathname.replace('/projects/trade-list-a4297/', `/projects/${project}/`);
      if (typeof body === 'string') body = body.replaceAll('projects/trade-list-a4297/', `projects/${project}/`);
    } else if (url.hostname === 'trade-list-a4297-default-rtdb.firebaseio.com') {
      url.protocol = 'http:'; url.host = '127.0.0.1:9410'; url.searchParams.set('ns', namespace);
    }
    if (url.hostname !== '127.0.0.1' || !['9410', '9411', '9499'].includes(url.port)) throw new Error('emulator_network_boundary');
    return originalFetch(url, { ...options, body });
  };
  async function db(method, target, value, token = 'owner') {
    const url = new URL(`http://127.0.0.1:9410/${target}.json`); url.searchParams.set('ns', namespace);
    const options = { method, headers: { 'content-type': 'application/json' } };
    if (token === 'owner') options.headers.authorization = 'Bearer owner';
    else if (token) url.searchParams.set('auth', token);
    if (value !== undefined) options.body = JSON.stringify(value);
    return fetch(url, options);
  }
  const signup = await fetch('http://127.0.0.1:9499/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'pipeline-admin@example.test', password: 'synthetic-emulator-only', returnSecureToken: true }) });
  assert.ok(signup.ok); const admin = await signup.json();
  const user = (uid) => ({ authUid: uid, authEmail: 'trainer@example.test', authVersion: 1, friendCode: '', isAdmin: false, isOwner: false });
  const login = { authReady: true, authVersion: 1, approvedAt: Date.now() };
  const seed = { users: Object.fromEntries(Object.entries(v.source.users).map(([name, value]) =>
    [name, value.authUid ? user(value.authUid) : { friendCode: '' }])), loginDirectory: v.source.loginDirectory,
    authIndex: v.source.authIndex, admins: { [admin.localId]: true } };
  assert.ok((await db('PUT', '', seed)).ok);
  const adapter = createProductionAdapter('owner');
  for (const [name, value] of Object.entries(v.source.accounts)) await adapter.createExactDocument(`accounts/${name}`, value);
  for (const [name, value] of Object.entries(v.source.trainerHandles)) await adapter.createExactDocument(`trainerHandles/${name}`, value);
  let lastTime = v.request.issuedAt + 1;
  async function serverTime() {
    const response = await fetch('https://firestore.googleapis.com/v1/projects/trade-list-a4297/databases/phase-e-identity/documents:batchGet', {
      method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ documents: ['projects/trade-list-a4297/databases/phase-e-identity/documents/accounts/synthetic-uid-0'] })
    });
    assert.ok(response.ok);
    const rows = await response.json();
    const at = Date.parse(rows[0].readTime);
    assert.ok(Number.isSafeInteger(at) && at >= lastTime, 'server clock monotonic');
    lastTime = at; return at;
  }
  async function probe(name, allowed) {
    const response = await db('PATCH', '', { [`users/${name}`]: user('probe-uid'), [`loginDirectory/${name}`]: login }, admin.idToken);
    assert.equal(response.ok, allowed, `provisioning ${name}: ${response.status}`);
    if (allowed) assert.ok((await db('PATCH', '', { [`users/${name}`]: null, [`loginDirectory/${name}`]: null })).ok);
  }
  const proofs = [];
  const p = pipeline(run, {}, {
    adapter: () => adapter, serverTime, inventory: () => readProduction('owner'),
    freezeState: async () => ({ firestore: await adapter.readDocument('authorityConfig/legacyProvisioningFreeze'),
      rtdb: (await adapter.readRtdb('legacyProvisioningFreeze')).value }),
    async rulesReplace(bytes) {
      const response = await db('PUT', '.settings/rules', JSON.parse(bytes));
      assert.ok(response.ok, await response.text());
      await probe('BeforeFreezeProbe', true); proofs.push('candidate-inactive-provisioning-allowed');
    },
    async frozen(active) {
      assert.deepEqual((await adapter.readRtdb('legacyProvisioningFreeze')).value, active);
      const raw = await (await db('GET', 'legacyProvisioningFreeze')).json();
      const window = {}; window.window = window;
      vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../js/domain/authenticationReadiness.js'), 'utf8'), vm.createContext({ window }));
      assert.equal(Object.hasOwn(raw, 'releasedAt'), false);
      assert.equal(window.PogoDomain.legacyProvisioningFreeze.legacyCreationDecision(raw, lastTime).status, 'frozen');
      assert.equal(window.PogoDomain.legacyProvisioningFreeze.legacyCreationDecision(raw, raw.expiresAt).status, 'expired');
      assert.equal(active.expiresAt - active.activatedAt, 2100000);
      await probe('FrozenProbe', false);
      assert.ok((await db('GET', 'loginDirectory/Trainer00', undefined, null)).ok);
      const repaired = await db('PATCH', 'users/Trainer00', { friendCode: '0000 1111 2222' }, admin.idToken);
      assert.ok(repaired.ok, await repaired.text());
      proofs.push('freeze-denies-new-preserves-existing');
    },
    async admission(cert) {
      assert.deepEqual(await adapter.readDocument('authorityConfig/providerAccountCreation'), cert);
      const before = await readProduction('owner');
      const input = { uid: 'probe-provider', ...canonicalHandle('ProviderProbe'), requestId: 'probe-request-0001',
        providerKey: 'google', providerId: 'google.com', providerSubjectKey: `v1_google_${'a'.repeat(64)}`,
        providerSubjectKeyVersion: 1, authTime: 900, lifecycleId: 'probe-auth', clientRelease: '2026-08-31.86',
        fingerprint: 'b'.repeat(64) };
      let wouldCreate = false;
      const abortedFirestore = { doc: (name) => firestore.doc(name),
        runTransaction: (callback) => firestore.runTransaction((transaction) => callback({
          get: (ref) => transaction.get(ref),
          create: () => { wouldCreate = true; throw new Error('zero_write_probe_abort'); }
        })) };
      const admission = createFirestoreE1AuthorityAdapter({ firestore: abortedFirestore, now: () => lastTime });
      await assert.rejects(admission.createProviderAccountFoundation(input), /zero_write_probe_abort/);
      assert.equal(wouldCreate, true);
      assert.equal(sha256(await readProduction('owner')), sha256(before));
      proofs.push('valid-server-admission-aborted-with-zero-writes');
    },
    async restored() {
      const freeze = (await adapter.readRtdb('legacyProvisioningFreeze')).value;
      assert.equal(freeze.state, 'released');
      await probe('AfterReleaseProbe', true);
      assert.equal(await adapter.readDocument('authorityConfig/providerAccountCreation'), null);
      proofs.push('certification-absent-provisioning-restored');
    }
  });
  const result = await orchestrate(p.context);
  assert.equal(result.phase, 'CLOSED_HEALTHY');
  assert.equal(p.store.read('closeout.json').finalIdentityCoverage, 58);
  assert.deepEqual(proofs, ['candidate-inactive-provisioning-allowed', 'freeze-denies-new-preserves-existing',
    'valid-server-admission-aborted-with-zero-writes', 'certification-absent-provisioning-restored']);
});
