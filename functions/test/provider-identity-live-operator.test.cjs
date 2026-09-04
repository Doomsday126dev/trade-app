'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const temporaryRoot = fs.realpathSync(os.tmpdir());
const { test } = require('node:test');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization.js');
const { AUTHORITY_CONFIG_PATHS } = require('../production/providerIdentityAuthorityContract.cjs');
const { sha256, classifySnapshot, runManifest, validateManifest, validateManifestSource } = require('../production/providerIdentityWindow.cjs');
const {
  APPROVAL, parseArgs, requireTarget, requireApproval, encode, decode, exact, atomicWrite,
  progressLedger, loadProgress, writeProgress, freezeDocuments, activateFreeze, releaseFreeze,
  verifyProgressAwareDrift, buildCompletionArtifact, verifyCompletionArtifact, run,
  createProductionAdapter, certificationIntent, invalidateCertification
} = require('../scripts/run-provider-identity-live-window.cjs');

function sourceFixture() {
  const existing = { name: 'Existing', uid: 'uid-existing', ...normalizeHandle('Existing') };
  const migrate = { name: 'Migrate', uid: 'uid-migrate', ...normalizeHandle('Migrate') };
  const hold = { name: 'HoldOnly', ...normalizeHandle('HoldOnly') };
  const account = { schemaVersion: 1, uid: existing.uid, canonicalTrainerName: existing.display,
    normalizedTrainerName: existing.normalized, handleKey: existing.handleKey, identityKind: 'legacy_migrated',
    legacyAccessConfigured: true, legacyUsername: existing.display, legacyAuthVersion: 1, status: 'active', revision: 1 };
  const handle = { schemaVersion: 1, uid: existing.uid, canonicalTrainerName: existing.display,
    normalizedTrainerName: existing.normalized, state: 'active', revision: 1, claimedAt: 1, updatedAt: 1 };
  return {
    authIndex: { [existing.uid]: { username: existing.name, authVersion: 1 },
      [migrate.uid]: { username: migrate.name, authVersion: 1 } },
    users: { [existing.name]: { authUid: existing.uid }, [migrate.name]: { authUid: migrate.uid }, [hold.name]: {} },
    loginDirectory: { [existing.name]: { authVersion: 1 }, [migrate.name]: { authVersion: 1 },
      [hold.name]: { authVersion: 1 } },
    accounts: { [existing.uid]: account }, trainerHandles: { [existing.handleKey]: handle }
  };
}

function manifestFixture() {
  const source = sourceFixture();
  const sourceDigests = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, sha256(value)]));
  const { manifest } = classifySnapshot(source, {
    mainCommit: 'a'.repeat(40), mainTree: 'b'.repeat(40), capturedAt: '2026-09-01T20:00:00.000Z', sourceDigests,
    currentRulesDigest: 'c'.repeat(64), provisioningContractDigest: 'd'.repeat(64)
  });
  return { manifest, source };
}

function fakeAdapter(source = sourceFixture()) {
  const documents = new Map([
    ...Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, structuredClone(value)]),
    ...Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, structuredClone(value)])
  ]);
  const state = { rtdbFreeze: null, writes: 0, sends: 0 };
  const adapter = {
    documents, state,
    async readDocument(target) { return documents.has(target) ? structuredClone(documents.get(target)) : null; },
    async readDocuments(targets) { return Object.fromEntries(await Promise.all(targets.map(async (target) =>
      [target, await this.readDocument(target)]))); },
    async verify(record) {
      for (const [target, value] of Object.entries(record.expectedResult || {})) {
        if (!exact(await this.readDocument(target), value)) throw new Error('verify_existing_failed');
      }
    },
    async createOnly(record, values) {
      state.sends += 1;
      if (Object.keys(values).some((target) => documents.has(target))) throw Object.assign(new Error('exists'), { status: 409 });
      for (const [target, value] of Object.entries(values)) documents.set(target, structuredClone(value));
      state.writes += Object.keys(values).length;
    },
    async createExactDocument(target, value) {
      if (documents.has(target) && !exact(documents.get(target), value)) throw new Error('create_only_conflict');
      if (!documents.has(target)) { documents.set(target, structuredClone(value)); state.writes += 1; }
    },
    async updateExactDocument(target, current, next) {
      if (!exact(documents.get(target), current)) throw new Error('update_precondition_changed');
      documents.set(target, structuredClone(next)); state.writes += 1;
    },
    async deleteExactDocument(target, expected) {
      if (!exact(documents.get(target), expected)) throw new Error('delete_precondition_changed');
      documents.delete(target); state.writes += 1;
    },
    async readRtdb() { return { value: structuredClone(state.rtdbFreeze) }; },
    async writeRtdbExact(target, current, next) {
      if (!exact(state.rtdbFreeze, current)) throw new Error('rtdb_precondition_changed');
      state.rtdbFreeze = structuredClone(next); state.writes += 1;
    }
  };
  return adapter;
}

function currentFrom(adapter, source) {
  const output = { authIndex: structuredClone(source.authIndex), users: structuredClone(source.users),
    loginDirectory: structuredClone(source.loginDirectory), accounts: {}, trainerHandles: {},
    operationRequests: {}, identityMigrations: {} };
  for (const [target, value] of adapter.documents) {
    if (target.startsWith('accounts/') && target.split('/').length === 2) output.accounts[target.split('/')[1]] = structuredClone(value);
    else if (target.startsWith('trainerHandles/')) output.trainerHandles[target.split('/')[1]] = structuredClone(value);
    else if (target.startsWith('operationRequests/')) output.operationRequests[target] = structuredClone(value);
    else if (target.startsWith('identityMigrations/')) output.identityMigrations[target] = structuredClone(value);
  }
  return output;
}

test('production target requires every exact identifier', () => {
  const exactTarget = {
    confirmProject: 'trade-list-a4297', confirmFirestoreDatabase: 'phase-e-identity',
    confirmRtdbUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com'
  };
  assert.doesNotThrow(() => requireTarget(exactTarget));
  assert.throws(() => requireTarget({ ...exactTarget, confirmProject: 'other' }), /production_target_not_confirmed/u);
});

test('REST adapter uses resource names, create-only preconditions, and does not resend exact creates', async () => {
  const documents = new Map();
  const writes = [];
  const root = 'projects/trade-list-a4297/databases/phase-e-identity/documents/';
  const adapter = createProductionAdapter('synthetic', async (url, options) => {
    if (url.endsWith(':commit')) {
      const batch = JSON.parse(options.body).writes;
      for (const write of batch) {
        const name = write.update?.name || write.delete;
        assert.ok(name.startsWith(root));
        assert.ok(!name.includes('https:'));
        assert.ok(write.currentDocument);
        writes.push(write);
        if (write.delete) documents.delete(name);
        else documents.set(name, { ...write.update, updateTime: '2026-09-01T00:00:00Z' });
      }
      return new Response('{}');
    }
    const name = url.split('/v1/')[1];
    return documents.has(name) ? new Response(JSON.stringify(documents.get(name))) : new Response('', { status: 404 });
  });
  await adapter.createExactDocument('accounts/synthetic', { count: 1 });
  await adapter.createExactDocument('accounts/synthetic', { count: 1 });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].currentDocument, { exists: false });
  await adapter.updateExactDocument('accounts/synthetic', { count: 1 }, { count: 2 });
  await adapter.deleteExactDocument('accounts/synthetic', { count: 2 });
  assert.equal(writes.length, 3);
});

test('response-body loss after commit reconciles without a duplicate create', async () => {
  let document = null, sends = 0;
  const adapter = createProductionAdapter('synthetic', async (url, options) => {
    if (url.endsWith(':commit')) {
      sends += 1;
      document = JSON.parse(options.body).writes[0].update;
      return { ok: true, text: async () => { throw new Error('connection reset during body'); } };
    }
    return document ? new Response(JSON.stringify(document)) : new Response('', { status: 404 });
  });
  await adapter.createExactDocument('accounts/synthetic', { uid: 'synthetic' });
  assert.equal(sends, 1);
});

test('apply CLI refuses absent freeze and invalid output paths before a single identity send', async () => {
  const value = await certificationFixture();
  try {
    const args = [...value.args];
    args[args.indexOf('create-certification')] = 'apply-manifest';
    value.adapter.documents.delete(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
    value.adapter.state.rtdbFreeze = null;
    const before = value.adapter.state.writes;
    await assert.rejects(run(args, { adapter: value.adapter, env: { GCLOUD_ACCESS_TOKEN: 'synthetic' } }), /freeze_not_exact_active/);
    assert.equal(value.adapter.state.writes, before);
    value.adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, value.active);
    value.adapter.state.rtdbFreeze = value.active;
    args[args.indexOf('--completion-file') + 1] = value.files.manifestFile;
    await assert.rejects(run(args, { adapter: value.adapter, env: { GCLOUD_ACCESS_TOKEN: 'synthetic' } }), /path_collision/);
    assert.equal(value.adapter.state.writes, before);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('invalidation refuses a foreign certification and release cannot bypass invalidation', async () => {
  const { manifest, source } = manifestFixture();
  const adapter = fakeAdapter(source);
  const active = freezeDocuments(manifest, 100).active;
  const owned = { schemaVersion: 2, freezeId: active.freezeId, coverageDigest: 'a'.repeat(64) };
  const foreign = { ...owned, freezeId: 'another-window' };
  adapter.documents.set(AUTHORITY_CONFIG_PATHS.providerAccountCreation, foreign);
  adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, active);
  adapter.state.rtdbFreeze = active;
  await assert.rejects(invalidateCertification(adapter, owned), /invalidation_conflict/);
  await assert.rejects(releaseFreeze(adapter, active, 200), /must_be_invalidated/);
  assert.equal(adapter.state.writes, 0);
  adapter.documents.set(AUTHORITY_CONFIG_PATHS.providerAccountCreation, owned);
  await invalidateCertification(adapter, owned);
  await invalidateCertification(adapter, owned);
  await releaseFreeze(adapter, active, 200);
  assert.equal(adapter.state.writes, 3);
});

test('private artifacts reject traversal, symlinked parents, hardlinks and permissive directories', () => {
  const { privatePath, readPrivate } = require('../production/providerIdentityPrivateFiles.cjs');
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'provider-path-'));
  try {
    const file = path.join(directory, 'artifact.json');
    atomicWrite(file, { synthetic: true });
    assert.throws(() => privatePath(`${directory}/../${path.basename(directory)}/artifact.json`), /canonical/);
    const link = path.join(directory, 'alias');
    fs.symlinkSync(directory, link);
    assert.throws(() => readPrivate(path.join(link, 'artifact.json')), /symlink/);
    fs.linkSync(file, path.join(directory, 'hardlink.json'));
    assert.throws(() => atomicWrite(file, {}), /permissions_invalid/);
    fs.unlinkSync(path.join(directory, 'hardlink.json'));
    fs.chmodSync(directory, 0o755);
    assert.throws(() => atomicWrite(file, {}), /directory_permissions/);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unrelated UID metadata drift cannot be omitted from namespace certification', async () => {
  const { manifest, source } = manifestFixture();
  const adapter = fakeAdapter(source), progress = new Map();
  await runManifest(manifest, adapter, { progress });
  const current = currentFrom(adapter, source);
  current.identityMigrations['identityMigrations/unmanifested/operations/foreign'] = { status: 'complete' };
  assert.throws(() => verifyProgressAwareDrift(manifest, current, progress), /namespace_drift:identityMigrations/);
});

test('manifest schema and exact write paths remain enforced after a digest is recomputed', () => {
  const { manifest } = manifestFixture();
  const edited = structuredClone(manifest);
  const record = edited.records.find((r) => r.classification === 'MIGRATE_RECIPROCAL_IDENTITY');
  const original = record.targetPaths[0];
  record.targetPaths[0] = 'accounts/another-owner';
  record.expectedResult[record.targetPaths[0]] = record.expectedResult[original];
  delete record.expectedResult[original];
  edited.manifestDigest = sha256(Object.fromEntries(Object.entries(edited).filter(([key]) => key !== 'manifestDigest')));
  assert.throws(() => validateManifest(edited), /targets_invalid/);
});

test('self-consistent replacement mapping cannot be substituted for the bound source snapshot', () => {
  const { manifest, source } = manifestFixture();
  const changed = structuredClone(source);
  changed.users.Migrate.authUid = 'another-owner';
  changed.authIndex['another-owner'] = changed.authIndex['uid-migrate'];
  delete changed.authIndex['uid-migrate'];
  const alteredManifest = classifySnapshot(changed, manifest.source).manifest;
  assert.doesNotThrow(() => validateManifest(alteredManifest));
  assert.throws(() => validateManifestSource(alteredManifest, source), /snapshot_mapping_invalid/);
});

test('two-store transition matrix refuses foreign and malformed states without mutations', async () => {
  const { manifest, source } = manifestFixture();
  const active = freezeDocuments(manifest, 100).active;
  const released = { ...active, state: 'released', releasedAt: 200 };
  const states = { absent: null, active, released, foreign: { ...active, freezeId: 'foreign' },
    malformed: { state: 'active' } };
  for (const [leftName, left] of Object.entries(states)) for (const [rightName, right] of Object.entries(states)) {
    for (const action of ['activate', 'release']) {
      const adapter = fakeAdapter(source);
      if (left) adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, left);
      adapter.state.rtdbFreeze = right;
      const allowed = action === 'activate' ? ['absent', 'active'] : ['absent', 'active', 'released'];
      const operation = action === 'activate' ? activateFreeze(adapter, active) : releaseFreeze(adapter, active, 200);
      if (allowed.includes(leftName) && allowed.includes(rightName)) await operation;
      else {
        await assert.rejects(operation, /freeze_(activation|release)_conflict/);
        assert.equal(adapter.state.writes, 0);
      }
    }
  }
});

test('duplicate legacy UID references and divergent auth versions block classification', () => {
  const { manifest, source } = manifestFixture();
  const duplicate = structuredClone(source);
  duplicate.users.HoldOnly.authUid = 'uid-migrate';
  const classified = classifySnapshot(duplicate, manifest.source);
  assert.equal(classified.manifest.operationCounts.BLOCKED_CONFLICT, 2);
  const changed = structuredClone(source);
  changed.loginDirectory.Migrate.authVersion = 2;
  assert.equal(classifySnapshot(changed, manifest.source).manifest.operationCounts.BLOCKED_CONFLICT, 1);
});

test('inventory digests survive private JSON serialization when Auth fields are absent', () => {
  const source = { authIndex: { synthetic: { username: undefined, authVersion: undefined } },
    values: [undefined, 1] };
  assert.equal(sha256(source), sha256(JSON.parse(JSON.stringify(source))));
});

test('invalid freeze and completion timestamps cannot authorize certification', async () => {
  const value = await certificationFixture();
  try {
    for (const timestamp of [NaN, Infinity, 0, -1, 1.5]) assert.throws(() => freezeDocuments(value.manifest, timestamp), /timestamp_invalid/);
    for (const timestamp of [null, value.active.activatedAt, Date.now() + 100000, 1.5]) {
      const changed = { ...value.completion, inventoryCapturedAt: timestamp };
      changed.artifactDigest = sha256(Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'artifactDigest')));
      assert.throws(() => verifyCompletionArtifact(changed, value.manifest, value.active, value.ledger, value.current), /completion_invalid/);
    }
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('full CLI persists exact state across six real SIGKILL boundaries', () => {
  const child = path.join(__dirname, 'fixtures/provider-identity-cli-restart-child.cjs');
  for (const mode of ['before-commit', 'transport-no-commit', 'lost-response', 'after-commit', 'after-checkpoint', 'between-records']) {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, `provider-cli-${mode}-`));
    try {
      const { manifest, source } = manifestFixture();
      const active = freezeDocuments(manifest, Date.now() - 10000).active;
      const initial = { ...Object.fromEntries(Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, value])),
        ...Object.fromEntries(Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, value])) };
      atomicWrite(path.join(directory, 'manifest.json'), manifest);
      atomicWrite(path.join(directory, 'snapshot.json'), source);
      atomicWrite(path.join(directory, 'store.json'), { source, documents: {
        ...initial, [AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze]: active }, rtdbFreeze: active, sends: {} });
      fs.writeFileSync(path.join(directory, 'approval.txt'), APPROVAL, { mode: 0o600 });
      const interrupted = spawnSync(process.execPath, [child, directory, mode], { encoding: 'utf8' });
      assert.equal(interrupted.signal, 'SIGKILL', `${mode}: ${interrupted.stderr}`);
      const interruptedStore = JSON.parse(fs.readFileSync(path.join(directory, 'store.json')));
      const committedBefore = manifest.records.filter((r) => r.operation !== 'VERIFY_ONLY' && r.targetPaths &&
        r.targetPaths.every((target) => interruptedStore.documents[target]));
      const resumed = spawnSync(process.execPath, [child, directory, 'resume'], { encoding: 'utf8' });
      assert.equal(resumed.status, 0, `${mode}: ${resumed.stderr}`);
      const final = JSON.parse(fs.readFileSync(path.join(directory, 'store.json')));
      for (const record of committedBefore) {
        const key = record.targetPaths.join('|');
        assert.equal(final.sends[key], interruptedStore.sends[key], 'committed exact operation must not resend');
      }
      assert.ok(Object.entries(initial).every(([target, value]) => exact(final.documents[target], value)));
      const completion = JSON.parse(fs.readFileSync(path.join(directory, 'completion.json')));
      assert.equal(completion.completeProtectedHandleCount, 3);
      assert.equal(completion.completedOperationCount, manifest.records.length);
      const sends = Object.values(final.sends).reduce((a, b) => a + b, 0);
      assert.equal(sends, mode === 'transport-no-commit' ? 3 : 2);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('full CLI safely stops on truncated or modified progress and post-checkpoint store drift', () => {
  const child = path.join(__dirname, 'fixtures/provider-identity-cli-restart-child.cjs');
  for (const mode of ['truncated', 'modified', 'store-drift', 'already-exact']) {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, `provider-cli-${mode}-`));
    try {
      const { manifest, source } = manifestFixture();
      const active = freezeDocuments(manifest, Date.now() - 10000).active;
      atomicWrite(path.join(directory, 'manifest.json'), manifest);
      atomicWrite(path.join(directory, 'snapshot.json'), source);
      atomicWrite(path.join(directory, 'store.json'), { source, documents: {
        ...Object.fromEntries(Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, value])),
        ...Object.fromEntries(Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, value])),
        [AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze]: active }, rtdbFreeze: active, sends: {} });
      fs.writeFileSync(path.join(directory, 'approval.txt'), APPROVAL, { mode: 0o600 });
      assert.equal(spawnSync(process.execPath, [child, directory, 'resume'], { encoding: 'utf8' }).status, 0);
      const storePath = path.join(directory, 'store.json');
      const progressPath = path.join(directory, 'progress.json');
      const before = JSON.parse(fs.readFileSync(storePath));
      if (mode === 'truncated') fs.writeFileSync(progressPath, '{');
      if (mode === 'modified') {
        const ledger = JSON.parse(fs.readFileSync(progressPath));
        ledger.ledgerDigest = '0'.repeat(64);
        atomicWrite(progressPath, ledger);
      }
      if (mode === 'store-drift') {
        const changed = structuredClone(before);
        changed.documents['accounts/uid-migrate'].uid = 'wrong-owner';
        atomicWrite(storePath, changed);
      }
      if (mode === 'already-exact') fs.unlinkSync(progressPath);
      const result = spawnSync(process.execPath, [child, directory, 'resume'], { encoding: 'utf8' });
      assert.equal(result.status, mode === 'already-exact' ? 0 : 1, result.stderr);
      const after = JSON.parse(fs.readFileSync(storePath));
      assert.deepEqual(after.sends, before.sends);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('every live mutation requires the exact private approval artifact', () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'provider-approval-'));
  const approval = path.join(directory, 'approval.txt');
  try {
    fs.writeFileSync(approval, `${APPROVAL}\n`, { mode: 0o600 });
    assert.doesNotThrow(() => requireApproval({ execute: true, approvalFile: approval }));
    fs.writeFileSync(approval, 'almost approved\n', { mode: 0o600 });
    assert.throws(() => requireApproval({ execute: true, approvalFile: approval }), /live_approval_missing/u);
    fs.writeFileSync(approval, `${APPROVAL}\n`, { mode: 0o644 });
    fs.chmodSync(approval, 0o644);
    assert.throws(() => requireApproval({ execute: true, approvalFile: approval }), /permissions_invalid/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Firestore transport encoder round-trips exact canonical documents', () => {
  const value = { schemaVersion: 1, uid: 'test-uid', active: true, nullable: null,
    nested: { count: 2 }, values: ['a', 2, false] };
  assert.equal(exact(decode(encode(value)), value), true);
});

test('CLI defaults to zero-write planning until execute is explicit', () => {
  const options = parseArgs(['--action', 'apply-manifest', '--manifest', '/private/manifest.json']);
  assert.equal(options.execute, undefined);
  assert.equal(options.action, 'apply-manifest');
});

test('unqualified production CLI cannot consume approval or reach a production request', async () => {
  const args = ['--action', 'activate-freeze', '--execute', '--confirm-project', 'trade-list-a4297',
    '--confirm-firestore-database', 'phase-e-identity', '--confirm-rtdb-url',
    'https://trade-list-a4297-default-rtdb.firebaseio.com', '--approval-file', '/does-not-exist'];
  await assert.rejects(run(args), /live_window_audit_blocked/);
});

test('operator certification path is the exact authority adapter contract', () => {
  const authoritySource = fs.readFileSync(path.join(__dirname, '../e1-authority-service/firestoreE1AuthorityAdapter.js'), 'utf8');
  const operatorSource = fs.readFileSync(path.join(__dirname, '../scripts/run-provider-identity-live-window.cjs'), 'utf8');
  assert.equal(AUTHORITY_CONFIG_PATHS.providerAccountCreation, 'authorityConfig/providerAccountCreation');
  assert.match(authoritySource, /firestore\.doc\('authorityConfig\/providerAccountCreation'\)/u);
  assert.match(operatorSource, /AUTHORITY_CONFIG_PATHS\.providerAccountCreation/u);
  assert.doesNotMatch(operatorSource, /providerCreationCertification/u);
});

test('durable progress is sealed, private, and replaced after each verified operation', async () => {
  const { manifest, source } = manifestFixture();
  const adapter = fakeAdapter(source);
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'provider-progress-'));
  const file = path.join(directory, 'progress.json');
  let checkpoints = 0;
  try {
    const progress = new Map();
    await runManifest(manifest, adapter, { progress, checkpoint: async (value) => {
      checkpoints += 1;
      writeProgress(file, manifest, value);
    } });
    const loaded = loadProgress(file, manifest);
    assert.equal(checkpoints, manifest.records.length);
    assert.equal(loaded.progress.size, manifest.records.length);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(loaded.ledger.ledgerDigest, progressLedger(manifest, loaded.progress).ledgerDigest);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('separate processes recover post-commit, post-checkpoint, and committed ambiguous interruptions', () => {
  const child = path.join(__dirname, 'fixtures/provider-identity-restart-child.cjs');
  for (const [mode, crashCode] of [['after-commit', 81], ['after-checkpoint', 82], ['ambiguous', 81]]) {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, `provider-process-${mode}-`));
    try {
      const { manifest, source } = manifestFixture();
      const manifestFile = path.join(directory, 'manifest.json');
      const storeFile = path.join(directory, 'store.json');
      const progressFile = path.join(directory, 'progress.json');
      atomicWrite(manifestFile, manifest);
      atomicWrite(storeFile, { schemaVersion: 1, documents: {
        ...Object.fromEntries(Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, value])),
        ...Object.fromEntries(Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, value]))
      }, sends: {} });
      const interrupted = spawnSync(process.execPath, [child, manifestFile, storeFile, progressFile, mode], { encoding: 'utf8' });
      assert.equal(interrupted.status, crashCode, `${mode}: ${interrupted.stderr}`);
      const resumed = spawnSync(process.execPath, [child, manifestFile, storeFile, progressFile, 'resume'], { encoding: 'utf8' });
      assert.equal(resumed.status, 0, `${mode}: ${resumed.stderr}`);
      const summary = JSON.parse(resumed.stdout.trim());
      const persisted = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      const loaded = loadProgress(progressFile, manifest);
      assert.equal(summary.completed, manifest.records.length);
      assert.equal(summary.expected, manifest.records.length);
      assert.equal(summary.duplicateSends, 0);
      assert.equal(Object.values(persisted.sends).every((count) => count === 1), true);
      assert.equal(loaded.progress.size, manifest.records.length);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('progress-aware drift permits exact verified manifest state and rejects every other namespace change', async () => {
  const { manifest, source } = manifestFixture();
  const adapter = fakeAdapter(source);
  const progress = new Map();
  await runManifest(manifest, adapter, { progress });
  const current = currentFrom(adapter, source);
  assert.doesNotThrow(() => verifyProgressAwareDrift(manifest, current, progress));
  const changedRtdb = structuredClone(current);
  changedRtdb.users.Unexpected = {};
  assert.throws(() => verifyProgressAwareDrift(manifest, changedRtdb, progress), /unexpected_source_drift:users/u);
  const changedOwner = structuredClone(current);
  changedOwner.accounts['uid-migrate'].uid = 'other';
  assert.throws(() => verifyProgressAwareDrift(manifest, changedOwner, progress), /unexpected_namespace_drift:accounts/u);
  const unknown = structuredClone(current);
  unknown.identityMigrations['identityMigrations/uid-migrate/operations/unknown'] = { unexpected: true };
  assert.throws(() => verifyProgressAwareDrift(manifest, unknown, progress), /unexpected_namespace_drift:identityMigrations/u);
});

test('freeze activation resumes either partial store and exact activation is idempotent', async () => {
  const { manifest, source } = manifestFixture();
  const active = freezeDocuments(manifest, 100).active;
  for (const [firestore, rtdb, expectedWrites] of [
    [null, null, 2], [active, null, 1], [null, active, 1], [active, active, 0]
  ]) {
    const adapter = fakeAdapter(source);
    if (firestore) adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(firestore));
    adapter.state.rtdbFreeze = structuredClone(rtdb);
    await activateFreeze(adapter, active);
    assert.equal(adapter.state.writes, expectedWrites);
  }
  const conflict = fakeAdapter(source);
  conflict.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, { ...active, freezeId: 'other-freeze' });
  await assert.rejects(activateFreeze(conflict, active), /freeze_activation_conflict/u);
});

test('freeze release resumes partial activation or release and never reactivates', async () => {
  const { manifest, source } = manifestFixture();
  const active = freezeDocuments(manifest, 100).active;
  const released = { ...active, state: 'released', releasedAt: 200 };
  for (const [firestore, rtdb, expectedWrites] of [
    [active, active, 2], [released, active, 1], [active, released, 1], [released, released, 0],
    [null, active, 1], [active, null, 1], [null, null, 0]
  ]) {
    const adapter = fakeAdapter(source);
    adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(firestore));
    adapter.state.rtdbFreeze = structuredClone(rtdb);
    await releaseFreeze(adapter, active, 200);
    assert.equal(adapter.state.writes, expectedWrites);
    assert.equal((await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze))?.state ?? null,
      firestore ? 'released' : null);
  }
  for (const [firestore, rtdb] of [[{ ...active, freezeId: 'wrong' }, active],
    [{ ...released, releasedAt: 201 }, released], [{ ...released, releasedAt: null }, active]]) {
    const adapter = fakeAdapter(source);
    if (firestore) adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(firestore));
    adapter.state.rtdbFreeze = structuredClone(rtdb);
    await assert.rejects(releaseFreeze(adapter, active, 200), /freeze_release_(conflict|timestamp_invalid)/u);
  }
});

test('freeze transitions recover after either store mutation is interrupted', async () => {
  const { manifest, source } = manifestFixture();
  const active = freezeDocuments(manifest, 100).active;
  const activation = fakeAdapter(source);
  const create = activation.createExactDocument.bind(activation);
  activation.createExactDocument = async (...args) => { await create(...args); throw new Error('synthetic-crash'); };
  await assert.rejects(activateFreeze(activation, active), /synthetic-crash/u);
  activation.createExactDocument = create;
  await activateFreeze(activation, active);
  const release = fakeAdapter(source);
  release.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(active));
  release.state.rtdbFreeze = structuredClone(active);
  const update = release.updateExactDocument.bind(release);
  release.updateExactDocument = async (...args) => { await update(...args); throw new Error('synthetic-crash'); };
  await assert.rejects(releaseFreeze(release, active, 200), /synthetic-crash/u);
  release.updateExactDocument = update;
  await releaseFreeze(release, active, 200);
  assert.equal(release.state.rtdbFreeze.state, 'released');

  const activationRtdb = fakeAdapter(source);
  activationRtdb.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(active));
  const writeActivation = activationRtdb.writeRtdbExact.bind(activationRtdb);
  activationRtdb.writeRtdbExact = async (...args) => { await writeActivation(...args); throw new Error('synthetic-crash'); };
  await assert.rejects(activateFreeze(activationRtdb, active), /synthetic-crash/u);
  activationRtdb.writeRtdbExact = writeActivation;
  await activateFreeze(activationRtdb, active);

  const releaseRtdb = fakeAdapter(source);
  const released = { ...active, state: 'released', releasedAt: 200 };
  releaseRtdb.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(released));
  releaseRtdb.state.rtdbFreeze = structuredClone(active);
  const writeRelease = releaseRtdb.writeRtdbExact.bind(releaseRtdb);
  releaseRtdb.writeRtdbExact = async (...args) => { await writeRelease(...args); throw new Error('synthetic-crash'); };
  await assert.rejects(releaseFreeze(releaseRtdb, active, 200), /synthetic-crash/u);
  releaseRtdb.writeRtdbExact = writeRelease;
  await releaseFreeze(releaseRtdb, active, 200);
  assert.equal(releaseRtdb.state.rtdbFreeze.state, 'released');
});

async function certificationFixture() {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'provider-certification-'));
  const { manifest, source } = manifestFixture();
  const adapter = fakeAdapter(source);
  const progress = new Map();
  await runManifest(manifest, adapter, { progress });
  const active = freezeDocuments(manifest, Date.parse(manifest.source.capturedAt) + 1).active;
  adapter.documents.set(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, structuredClone(active));
  adapter.state.rtdbFreeze = structuredClone(active);
  const manifestFile = path.join(directory, 'manifest.json');
  const snapshotFile = path.join(directory, 'snapshot.json');
  const progressFile = path.join(directory, 'progress.json');
  const completionFile = path.join(directory, 'completion.json');
  const certificationFile = path.join(directory, 'certification-intent.json');
  const approvalFile = path.join(directory, 'approval.txt');
  atomicWrite(manifestFile, manifest);
  atomicWrite(snapshotFile, source);
  const ledger = writeProgress(progressFile, manifest, progress);
  const current = currentFrom(adapter, source);
  const completion = buildCompletionArtifact(manifest, active, ledger, current, active.activatedAt + 1);
  atomicWrite(completionFile, completion);
  fs.writeFileSync(approvalFile, `${APPROVAL}\n`, { mode: 0o600 });
  const args = ['--action', 'create-certification', '--manifest', manifestFile, '--progress-file', progressFile,
    '--snapshot', snapshotFile,
    '--certification-file', certificationFile,
    '--completion-file', completionFile, '--approval-file', approvalFile, '--confirm-project', 'trade-list-a4297',
    '--confirm-firestore-database', 'phase-e-identity', '--confirm-rtdb-url',
    'https://trade-list-a4297-default-rtdb.firebaseio.com', '--certified-at', String(active.activatedAt + 2), '--execute'];
  return { directory, manifest, source, adapter, progress, active, ledger, current, completion, files: {
    manifestFile, progressFile, completionFile, approvalFile, certificationFile }, args };
}

test('live completion artifact is sealed to final inventory, progress, coverage, and post-freeze time', async () => {
  const value = await certificationFixture();
  try {
    assert.doesNotThrow(() => verifyCompletionArtifact(value.completion, value.manifest, value.active, value.ledger, value.current));
    const stale = { ...value.completion, coverageDigest: '0'.repeat(64) };
    assert.throws(() => verifyCompletionArtifact(stale, value.manifest, value.active, value.ledger, value.current),
      /live_completion_invalid/u);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('certification creates and verifies only the shared authority document from live completion evidence', async () => {
  const value = await certificationFixture();
  try {
    const dependencies = { adapter: value.adapter, env: { GCLOUD_ACCESS_TOKEN: 'test' }, now: () => value.active.activatedAt + 3,
      readProduction: async () => currentFrom(value.adapter, value.source) };
    const before = value.adapter.state.writes;
    await run(value.args, dependencies);
    assert.equal(value.adapter.state.writes, before + 1);
    assert.equal(value.adapter.documents.has(AUTHORITY_CONFIG_PATHS.providerAccountCreation), true);
    const verifyArgs = value.args.filter((argument) => argument !== '--execute');
    verifyArgs[verifyArgs.indexOf('create-certification')] = 'verify-certification';
    verifyArgs.push('--execute');
    await run(verifyArgs, dependencies);
    assert.equal(value.adapter.state.writes, before + 1);
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
});

test('certification rejects incomplete, stale, conflicting, or dry-run-derived evidence without writing', async (t) => {
  const cases = [
    ['apply never ran', (v) => writeProgress(v.files.progressFile, v.manifest, new Map())],
    ['only one completed', (v) => writeProgress(v.files.progressFile, v.manifest, new Map([...v.progress].slice(0, 1)))],
    ['progress claims complete but document missing', (v) => v.adapter.documents.delete('accounts/uid-migrate')],
    ['documents exact but progress incomplete', (v) => writeProgress(v.files.progressFile, v.manifest, new Map([...v.progress].slice(0, -1)))],
    ['unexpected namespace record', (v) => v.adapter.documents.set('identityMigrations/uid-migrate/operations/unknown', {})],
    ['one hold differs', (v) => { const key = normalizeHandle('HoldOnly').handleKey;
      v.adapter.documents.set(`trainerHandles/${key}`, { ...v.adapter.documents.get(`trainerHandles/${key}`), state: 'active' }); }],
    ['one account owner differs', (v) => v.adapter.documents.set('accounts/uid-migrate',
      { ...v.adapter.documents.get('accounts/uid-migrate'), uid: 'other' })],
    ['freeze exists on one store', (v) => { v.adapter.state.rtdbFreeze = null; }],
    ['freeze ids differ', (v) => { v.adapter.state.rtdbFreeze = { ...v.active, freezeId: 'legacy-freeze-different' }; }],
    ['completion belongs to another manifest', (v) => atomicWrite(v.files.completionFile,
      { ...v.completion, manifestDigest: '0'.repeat(64) })],
    ['edited dry run report is refused', (v) => v.args.splice(v.args.length - 1, 0, '--dry-run-report', path.join(v.directory, 'edited.json'))],
    ['coverage count matches but digest differs', (v) => atomicWrite(v.files.completionFile,
      { ...v.completion, coverageDigest: '0'.repeat(64) })]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const value = await certificationFixture();
    try {
      mutate(value);
      const before = value.adapter.state.writes;
      await assert.rejects(run(value.args, { adapter: value.adapter, env: { GCLOUD_ACCESS_TOKEN: 'test' },
        readProduction: async () => currentFrom(value.adapter, value.source) }));
      assert.equal(value.adapter.state.writes, before);
      assert.equal(value.adapter.documents.has(AUTHORITY_CONFIG_PATHS.providerAccountCreation), false);
    } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
  });
});
