'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { fixture, runtime } = require('./fixtures/provider-identity-orchestrator-fixture.cjs');
const { ProviderDeploymentExecutor, runtimeContract } = require('../production/providerIdentityDeploymentExecutor.cjs');
const { RunStore, requestArtifact, approvalPhrase } = require('../production/providerIdentityRun.cjs');
const { buildPlan, EXPECTED_GATEWAYS } = require('../production/providerIdentityDeploymentPlan.cjs');
const { ACCESSOR, assertInactive, validatePlan } = require('../production/providerIdentityInfrastructure.cjs');
const { atomicWrite, readPrivate } = require('../production/providerIdentityPrivateFiles.cjs');
const { sha256 } = require('../production/providerIdentityWindow.cjs');
const { orchestrate } = require('../production/providerIdentityOrchestrator.cjs');

const repo = path.resolve(__dirname, '../..');
function setup(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-executor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, ...fixture(directory) };
}

function deploymentFixture(t, fault) {
  const v = setup(t), runDirectory = path.join(v.directory, 'deployment-run'); fs.mkdirSync(runDirectory, { mode: 0o700 });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
  const rulesRollback = '{"rules":{}}\n', rulesCandidate = '{"rules":{"candidate":true}}\n';
  const before = { metadata: { name: 'e1-identity-authority' }, spec: { template: { spec: {
    serviceAccountName: ACCESSOR.slice(15), containers: [{ image: `image@sha256:${'0'.repeat(64)}`, env: [] }] } } },
    status: { latestReadyRevisionName: 'old-revision', traffic: [{ revisionName: 'old-revision', percent: 100 }] } };
  const after = structuredClone(before); delete after.status;
  after.spec.template.spec.containers[0].env = [...Object.entries(v.plan.authority.environment).map(([name, value]) => ({ name, value })),
    { name: 'PROVIDER_SUBJECT_HMAC_KEY', valueFrom: { secretKeyRef: { name: 'e1-provider-subject-hmac-key', key: '1' } } }];
  const authorityIam = { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${v.plan.gateways.runtimeServiceAccount}`] }] };
  const contract = { authorityBefore: before, authorityAfter: after, authorityIam, gatewayRuntime: 'nodejs22',
    gatewayEnvironment: { APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false', APP_CHECK_ENFORCEMENT_MODE: 'enforced' },
    gatewayRollback: Object.fromEntries(EXPECTED_GATEWAYS.map((name) => [name, null])), rulesRollback, rulesCandidate };
  const { plan } = buildPlan({ repoRoot: repo, sourceCommit, sourceTree, runtimeContract: contract,
    candidateRulesDigest: sha256(rulesCandidate), currentRulesDigest: sha256(rulesRollback), currentAuthorityRevision: 'old-revision',
    currentAuthorityImageDigest: before.spec.template.spec.containers[0].image, currentGatewayRevisions: {}, currentIamPolicyDigest: sha256({ bindings: [] }) });
  const operator = { commit: sourceCommit, tree: sourceTree, authority: plan.authority.sourceFingerprint, gateway: plan.gateways.sourceFingerprint };
  const request = requestArtifact({ runId: 'synthetic-deployment-00000001', manifest: v.manifest, plan, operator, issuedAt: v.at, expiresAt: v.at + 7200000 });
  const store = new RunStore(runDirectory); store.initialize(request); store.approve(approvalPhrase(request), operator, v.at + 1);
  const statePath = store.file('command-state.json');
  atomicWrite(statePath, { service: before, functions: {}, rules: rulesRollback, calls: [], faultUsed: false });
  const read = () => JSON.parse(readPrivate(statePath));
  const save = (s) => atomicWrite(statePath, s);
  const spawn = (binary, args) => {
    const state = read(), command = args.slice(0, 3).join(' ');
    state.calls.push({ binary, args });
    if (fault === command && !state.faultUsed) { state.faultUsed = true; save(state); return { status: 1, stdout: '', stderr: 'private-diagnostics-discarded' }; }
    let result = {};
    if (command === 'run services describe') result = state.service;
    else if (command === 'run services get-iam-policy') result = authorityIam;
    else if (args[0] === 'functions' && args[1] === 'list') result = Object.values(state.functions);
    else if (args[0] === 'builds' && args[1] === 'submit') result = { status: 'SUCCESS', results: { images: [{ digest: `sha256:${'a'.repeat(64)}` }] } };
    else if (command === 'run services replace') {
      state.service = JSON.parse(readPrivate(args[3]));
      state.service.status = { latestReadyRevisionName: 'new-revision', traffic: [{ revisionName: 'new-revision', percent: 100 }] };
      if (fault === 'wrong-image') state.service.spec.template.spec.containers[0].image = 'wrong-image';
      result = state.service;
    } else if (command === 'run services update-traffic') {
      state.service.status.traffic = [{ revisionName: 'old-revision', percent: 100 }]; result = state.service;
    } else if (args[0] === 'functions' && args[1] === 'deploy') {
      const name = args[2];
      state.functions[name] = { name: `projects/trade-list-a4297/locations/us-central1/functions/${name}`,
        buildConfig: { entryPoint: name, runtime: args.find((v) => v.startsWith('--runtime=')).slice(10) },
        serviceConfig: { serviceAccountEmail: plan.gateways.runtimeServiceAccount, revision: `revision-${name}`,
          environmentVariables: JSON.parse(readPrivate(args.find((v) => v.startsWith('--env-vars-file=')).slice(16))) } };
      result = state.functions[name];
    } else if (args[0] === 'functions' && args[1] === 'describe') result = state.functions[args[2]];
    else if (args[0] === 'functions' && args[1] === 'delete') delete state.functions[args[2]];
    else throw new Error(`unexpected-command:${command}`);
    save(state); return { status: 0, stdout: JSON.stringify(result), stderr: '' };
  };
  const rules = { async read() { return { bytes: read().rules, etag: sha256(read().rules) }; },
    async replace(current, bytes) {
      assert.equal(current.bytes, read().rules);
      const state = read(); state.rules = bytes; save(state);
      if (fault === 'rules-response-lost' && bytes === rulesCandidate) throw new Error('rules_response_lost');
    } };
  const executor = new ProviderDeploymentExecutor({ repo, store, plan, rules, spawn,
    providerUsage: async () => ({ accounts: 0, providers: 0, subjects: 0 }), freezeState: async () => ({ firestore: null, rtdb: null }) });
  return { executor, plan, read, store, request };
}

test('current metadata-only deployment plan cannot masquerade as an executable rollback contract', (t) => {
  const v = setup(t); assert.throws(() => runtimeContract(v.plan), /reviewed_runtime_rollback_contract_missing/);
  assert.throws(() => require('../scripts/coordinate-provider-identity-window.cjs').run(['--execute']), /live_window_audit_blocked/);
});

test('six-export command executor stages exact source and verifies inactive authority, gateways and Rules', async (t) => {
  const v = deploymentFixture(t), before = await v.executor.inspect();
  await v.executor.deployRules(); await v.executor.buildAuthority(); await v.executor.deployAuthority();
  for (const name of EXPECTED_GATEWAYS) await v.executor.deployGateway(v.plan, name);
  await v.executor.verify(v.plan);
  assert.equal(Object.keys(v.read().functions).length, 6);
  for (const call of v.read().calls) {
    assert.ok(!call.args.some((arg) => arg.includes('HMAC_KEY=') || arg.includes('latest:') || arg === '--allow-unauthenticated'));
  }
  for (const name of [...EXPECTED_GATEWAYS].reverse()) await v.executor.restoreGateway(before, name);
  await v.executor.restoreAuthority(before); await v.executor.restoreRules(before);
  assert.equal(Object.keys(v.read().functions).length, 0);
  assert.equal(v.read().rules, before.rulesBytes);
  assert.equal(v.read().service.status.traffic[0].revisionName, 'old-revision');
  for (const name of EXPECTED_GATEWAYS) await v.executor.restoreGateway(before, name);
  await v.executor.restoreRules(before);
});

test('authority build, deployment, wrong-image and Rules-response failures remain restorable', async (t) => {
  for (const fault of ['builds submit', 'run services replace', 'wrong-image', 'rules-response-lost']) await t.test(fault, async (st) => {
    const v = deploymentFixture(st, fault), before = await v.executor.inspect();
    if (fault === 'rules-response-lost') await assert.rejects(v.executor.deployRules());
    else {
      await v.executor.deployRules();
      if (fault === 'builds submit') {
        // Match the concrete command's source argument without capturing source bytes.
        const spawn = v.executor.spawn;
        v.executor.spawn = () => ({ status: 1, stdout: '', stderr: 'discarded' });
        await assert.rejects(v.executor.buildAuthority(), /cloud_command_failed/);
        v.executor.spawn = spawn;
        await v.executor.restoreRules(before);
        assert.equal(v.read().rules, before.rulesBytes);
        return;
      }
      await v.executor.buildAuthority(); await assert.rejects(v.executor.deployAuthority());
      await v.executor.restoreAuthority(before);
    }
    await v.executor.restoreRules(before); assert.equal(v.read().rules, before.rulesBytes);
  });
});

test('changed staging bytes and two-export plans fail before deployment', (t) => {
  const v = deploymentFixture(t), directory = v.executor.source('gateways');
  fs.appendFileSync(path.join(directory, 'index.js'), '\n// synthetic tamper\n');
  assert.throws(() => v.executor.source('gateways'), /staged_source_changed/);
  const changed = structuredClone(v.plan); changed.gateways.functions = changed.gateways.functions.slice(0, 2);
  assert.throws(() => validatePlan(changed, v.request), /deployment_plan_invalid/);
  assert.throws(() => assertInactive({ environment: { GATEWAY_INVOCATION_ENABLED: 'true' } }, { GATEWAY_INVOCATION_ENABLED: 'false' }), /gate_invalid/);
});

test('provider use or foreign IAM during rollback preserves compatibility and refuses further normal work', async (t) => {
  for (const kind of ['provider-use', 'foreign-iam']) await t.test(kind, async (st) => {
    const v = setup(st), r = runtime(v.directory);
    const original = r.checkpoint;
    r.checkpoint = async (point) => {
      await original(point);
      if (point === 'phase:INFRASTRUCTURE_READY') {
        const state = r.read();
        if (kind === 'provider-use') state.usage.accounts = 1;
        else state.policy.bindings.push({ role: 'roles/secretmanager.secretAccessor', members: ['user:foreign@example.test'] });
        r.save(state); throw new Error('synthetic_stop');
      }
    };
    await assert.rejects(orchestrate(r), kind === 'provider-use' ? /compatibility_obligation/ : /foreign_secret_iam/);
    assert.ok(r.read().secret);
    assert.equal(r.store.ledger().state.phase, 'FREEZE_RELEASED');
    assert.throws(() => r.store.authorize('execution', 'apply-manifest', r.store.binding(), r.read().at), /expired/);
    assert.equal(fs.existsSync(r.store.file('closeout.json')), false);
  });
});
