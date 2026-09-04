'use strict';

const fs = require('node:fs');
const { normalizeHandle } = require('../../e1-authority-service/handleNormalization.js');
const { sha256, classifySnapshot } = require('../../production/providerIdentityWindow.cjs');
const { atomicWrite, readPrivate } = require('../../production/providerIdentityPrivateFiles.cjs');
const { RunStore, requestArtifact, approvalPhrase } = require('../../production/providerIdentityRun.cjs');
const { EXPECTED_GATEWAYS, DISABLED_AUTHORITY_GATES, DISABLED_GATEWAY_GATES } = require('../../production/providerIdentityDeploymentPlan.cjs');
const { Infrastructure, SecretCommands, SECRET, ACCESSOR, assertInactive } = require('../../production/providerIdentityInfrastructure.cjs');
const { orchestrate } = require('../../production/providerIdentityOrchestrator.cjs');

function fixture(directory) {
  const source = { authIndex: {}, users: {}, loginDirectory: {}, accounts: {}, trainerHandles: {}, operationRequests: {}, identityMigrations: {} };
  for (let i = 0; i < 58; i += 1) {
    const name = `Trainer${String(i).padStart(2, '0')}`, uid = `synthetic-uid-${i}`, normalized = normalizeHandle(name);
    source.users[name] = i < 28 ? { authUid: uid } : {};
    source.loginDirectory[name] = { authVersion: 1 };
    if (i < 28) source.authIndex[uid] = { username: name, authVersion: 1 };
    if (i < 8) {
      source.accounts[uid] = { schemaVersion: 1, uid, canonicalTrainerName: name, normalizedTrainerName: normalized.normalized,
        handleKey: normalized.handleKey, identityKind: 'legacy_migrated', legacyAccessConfigured: true,
        legacyUsername: name, legacyAuthVersion: 1, status: 'active', revision: 1 };
      source.trainerHandles[normalized.handleKey] = { schemaVersion: 1, uid, canonicalTrainerName: name,
        normalizedTrainerName: normalized.normalized, state: 'active', revision: 1, claimedAt: 1, updatedAt: 1 };
    }
  }
  for (let i = 0; i < 10; i += 1) source.authIndex[`unpaired-${i}`] = { username: `Unpaired${i}`, authVersion: 1 };
  const at = Date.now() - 100000;
  const { manifest } = classifySnapshot(source, { mainCommit: 'a'.repeat(40), mainTree: 'b'.repeat(40),
    capturedAt: new Date(at).toISOString(), sourceDigests: Object.fromEntries(Object.entries(source).map(([k, v]) => [k, sha256(v)])),
    currentRulesDigest: 'c'.repeat(64), provisioningContractDigest: 'd'.repeat(64) });
  const operator = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), authority: 'e'.repeat(64), gateway: 'f'.repeat(64) };
  const plan = { source: { commit: operator.commit, tree: operator.tree }, providerAccountsExist: false,
    authority: { sourceFingerprint: operator.authority, runtimeServiceAccount: ACCESSOR.slice(15),
      environment: { ...DISABLED_AUTHORITY_GATES, GROUP_E_CLIENT_MODE: 'disabled', READ_PROOF_MODE: 'false',
        PROVIDER_SUBJECT_HMAC_KEY_VERSION: '1', PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'false' },
      secretReference: { environmentVariable: 'PROVIDER_SUBJECT_HMAC_KEY', secret: SECRET, version: '1' } },
    gateways: { sourceFingerprint: operator.gateway, functions: [...EXPECTED_GATEWAYS],
      environment: { ...DISABLED_GATEWAY_GATES }, runtimeServiceAccount: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com' },
    rules: { candidateDigest: '1'.repeat(64), currentDigest: 'c'.repeat(64), rollbackDigest: 'c'.repeat(64) },
    secretAndIam: { accessor: ACCESSOR, role: 'roles/secretmanager.secretAccessor' }, rollback: { iamPolicyDigest: sha256({ bindings: [] }) } };
  plan.planDigest = sha256(JSON.stringify(plan));
  const request = requestArtifact({ runId: `synthetic-window-${'0'.repeat(16)}`, manifest, plan, operator,
    issuedAt: at, expiresAt: at + 7200000 });
  const store = new RunStore(directory); store.initialize(request); store.approve(approvalPhrase(request), operator, at + 1);
  const documents = Object.fromEntries([...Object.entries(source.accounts).map(([k, v]) => [`accounts/${k}`, v]),
    ...Object.entries(source.trainerHandles).map(([k, v]) => [`trainerHandles/${k}`, v])]);
  atomicWrite(store.file('fixture-input.json'), { source, manifest, plan, operator });
  atomicWrite(store.file('cloud.json'), { at: at + 2, documents, rtdbFreeze: null, api: false, secret: null,
    versions: [], policy: { version: 1, bindings: [], etag: 'before' }, projectPolicy: { bindings: [] },
    deployments: { rulesDigest: plan.rules.currentDigest, authority: 'old', gateways: {} }, writes: 0, captures: [],
    usage: { accounts: 0, providers: 0, subjects: 0 } });
  return { store, source, manifest, plan, operator, request, at };
}

function runtime(directory, injection = {}) {
  const store = new RunStore(directory);
  const { source, manifest, plan, operator } = JSON.parse(readPrivate(store.file('fixture-input.json')));
  const read = () => JSON.parse(readPrivate(store.file('cloud.json')));
  const save = (value) => atomicWrite(store.file('cloud.json'), value);
  let tripped = false;
  async function checkpoint(point) {
    if (injection.capture) injection.capture.push(point);
    if (!tripped && injection.point === point) {
      tripped = true;
      if (injection.kill) process.kill(process.pid, 'SIGKILL');
      if (injection.signal) { process.emit(injection.signal); return; }
      throw new Error('synthetic_material_failure');
    }
  }
  function mutate(action) { const value = read(); action(value); value.writes += 1; save(value); }
  const exact = (a, b) => sha256(a ?? null) === sha256(b ?? null);
  const adapter = {
    async readDocument(target) { return read().documents[target] ?? null; },
    async readDocuments(targets) { return Object.fromEntries(targets.map((k) => [k, read().documents[k] ?? null])); },
    async verify(record) { for (const [k, v] of Object.entries(record.expectedResult || {})) if (!exact(read().documents[k], v)) throw new Error('verify_failed'); },
    async createOnly(record, documents) {
      mutate((v) => { if (Object.keys(documents).some((k) => Object.hasOwn(v.documents, k))) throw new Error('create_conflict');
        Object.assign(v.documents, documents); });
    },
    async createExactDocument(target, value) {
      if (exact(read().documents[target], value)) return;
      mutate((v) => { if (v.documents[target]) throw new Error('create_conflict'); v.documents[target] = value; });
      await checkpoint(`store:create:${target}`);
    },
    async updateExactDocument(target, current, next) {
      mutate((v) => { if (!exact(v.documents[target], current)) throw new Error('update_conflict'); v.documents[target] = next; });
      await checkpoint(`store:update:${target}`);
    },
    async deleteExactDocument(target, value) {
      mutate((v) => { if (!exact(v.documents[target], value)) throw new Error('delete_conflict'); delete v.documents[target]; });
      await checkpoint(`store:delete:${target}`);
    },
    async readRtdb() { return { value: read().rtdbFreeze }; },
    async writeRtdbExact(target, current, next) {
      mutate((v) => { if (!exact(v.rtdbFreeze, current)) throw new Error('rtdb_conflict'); v.rtdbFreeze = next; });
      await checkpoint(`store:rtdb:${next.state}`);
    }
  };
  const inventory = async () => {
    const output = { ...structuredClone(source), accounts: {}, trainerHandles: {}, operationRequests: {}, identityMigrations: {} };
    for (const [k, v] of Object.entries(read().documents)) {
      const root = k.split('/')[0];
      if (['accounts', 'trainerHandles'].includes(root)) output[root][k.slice(root.length + 1)] = v;
      if (['operationRequests', 'identityMigrations'].includes(root)) output[root][k] = v;
    }
    return output;
  };
  const spawn = (binary, args, options) => {
    const cmd = args.slice(0, 3).join(' ');
    // Store command arguments and only the existence/length of stdin, never its bytes.
    const value = read(); value.captures.push({ binary, args, stdinLength: options.input?.length || 0 }); save(value);
    let result;
    if (cmd === 'services list --enabled') result = read().api ? [{ config: { name: 'secretmanager.googleapis.com' } }] : [];
    else if (cmd === 'services enable secretmanager.googleapis.com') { mutate((v) => { v.api = true; }); result = {}; }
    else if (args[0] === 'secrets' && args[1] === 'list') result = read().secret ? [read().secret] : [];
    else if (cmd === `secrets create ${SECRET}`) { mutate((v) => { v.secret = { name: `projects/1053781218847/secrets/${SECRET}`,
      labels: { 'provider-window': args.find((a) => a.startsWith('--labels=')).split('=').at(-1) }, replication: { automatic: {} } }; }); result = {}; }
    else if (cmd === 'secrets versions list') result = read().versions;
    else if (cmd === 'secrets versions add') {
      if (!Buffer.isBuffer(options.input) || options.input.length < 48) throw new Error('secret_input_missing');
      if (injection.versionBefore) return { status: 1, stderr: 'discarded', stdout: '' };
      mutate((v) => { if (v.versions.length) throw new Error('duplicate_version');
        v.versions = [{ name: `projects/1053781218847/secrets/${SECRET}/versions/1`, state: 'ENABLED' }]; });
      if (injection.versionLost) return { status: 1, stdout: '', stderr: 'discarded' };
      result = {};
    } else if (cmd === `secrets get-iam-policy ${SECRET}`) result = read().policy;
    else if (cmd === `secrets set-iam-policy ${SECRET}`) { mutate((v) => { v.policy = JSON.parse(options.input); }); result = read().policy; }
    else if (cmd === `secrets delete ${SECRET}`) { mutate((v) => { v.secret = null; v.versions = []; v.policy = { bindings: [] }; }); result = {}; }
    else throw new Error(`unexpected_fixture_command:${cmd}`);
    return { status: 0, stdout: JSON.stringify(result), stderr: '' };
  };
  const commands = new SecretCommands({ spawn, providerUsage: async () => read().usage, projectPolicy: async () => read().projectPolicy });
  const deployment = {
    async inspect() { return { ...read().deployments, freezeActive: !!read().rtdbFreeze, providerAccountsExist: false, gatesFalse: true }; },
    async deployRules(p) { mutate((v) => { v.deployments.rulesDigest = p.rules.candidateDigest; }); },
    async buildAuthority() { mutate((v) => { v.builtImage = `sha256:${'a'.repeat(64)}`; }); return { image: read().builtImage }; },
    async deployAuthority(p) { assertInactive(p.authority, DISABLED_AUTHORITY_GATES); mutate((v) => { v.deployments.authority = p.authority.sourceFingerprint; }); },
    async deployGateway(p, name) {
      if (!EXPECTED_GATEWAYS.includes(name)) throw new Error('unexpected_gateway');
      assertInactive(p.gateways, DISABLED_GATEWAY_GATES); mutate((v) => { v.deployments.gateways[name] = p.gateways.sourceFingerprint; });
    },
    async verify(p) {
      const v = read();
      if (v.deployments.rulesDigest !== p.rules.candidateDigest || v.deployments.authority !== p.authority.sourceFingerprint ||
          !exact(Object.keys(v.deployments.gateways).sort(), [...EXPECTED_GATEWAYS].sort())) throw new Error('deployment_verify_failed');
    },
    async restoreGateway(before, name) { mutate((v) => { if (before.gateways[name]) v.deployments.gateways[name] = before.gateways[name]; else delete v.deployments.gateways[name]; }); },
    async restoreAuthority(before) { mutate((v) => { v.deployments.authority = before.authority; }); },
    async restoreRules(before) { mutate((v) => { v.deployments.rulesDigest = before.rulesDigest; }); }
  };
  let infrastructure;
  const cloud = {
    async serverTime() { const value = read(); value.at += 1; save(value); return value.at; },
    inventory,
    async prepare(p, s, guard, points) {
      infrastructure = new Infrastructure({ store: s, plan: p, commands, deployment, guard, checkpoint: points });
      await infrastructure.prepare();
    },
    async restore(p, s, guard, points) {
      infrastructure = new Infrastructure({ store: s, plan: p, commands, deployment, guard, checkpoint: points });
      await infrastructure.restore();
    },
    async cleanup(p, s, guard, points) {
      infrastructure = new Infrastructure({ store: s, plan: p, commands, deployment, guard, checkpoint: points });
      await infrastructure.cleanup(!!s.ledger().state.reason);
    },
    async rollbackEvidence() { return infrastructure.journal().before.deployment; },
    async verifyInactive() { await deployment.verify(plan); },
    async verifyProvisioningSemantics(active) { if (read().rtdbFreeze.expiresAt !== active.expiresAt) throw new Error('freeze_semantics_failed'); },
    async verifyZeroWriteAdmission(cert) {
      const before = read().writes;
      if (!cert || cert.expiresAt <= read().at || read().usage.accounts) throw new Error('admission_verify_failed');
      if (read().writes !== before) throw new Error('zero_write_failed');
    },
    async closeoutEvidence() {
      const current = await inventory();
      return { at: read().at, gatesFalse: true, temporaryIamAbsent: exact(read().projectPolicy, { bindings: [] }),
        rulesAndRevisions: read().deployments, iamDigest: sha256(read().policy),
        finalIdentityCoverage: Object.keys(current.trainerHandles).length, accountCount: Object.keys(current.accounts).length };
    }
  };
  return { store, manifest, snapshot: source, plan, actualProvenance: operator, cloud, adapter, checkpoint, read, save, injection, spawn };
}

module.exports = { fixture, runtime };
if (require.main === module) {
  const [directory, point] = process.argv.slice(2);
  orchestrate(runtime(directory, { point, kill: !!point })).then((state) => {
    process.stdout.write(`${state.phase}\n`);
  }).catch(() => { process.stderr.write('rehearsal_restoration_required\n'); process.exitCode = 1; });
}
