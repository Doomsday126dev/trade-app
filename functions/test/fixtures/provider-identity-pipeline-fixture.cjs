'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture, runtime } = require('./provider-identity-orchestrator-fixture.cjs');
const { prepareBundle } = require('../../production/providerIdentityPreparation.cjs');
const { RunStore, approvalPhrase, TARGET } = require('../../production/providerIdentityRun.cjs');
const { classifySnapshot, sha256 } = require('../../production/providerIdentityWindow.cjs');
const { EXPECTED_GATEWAYS } = require('../../production/providerIdentityDeploymentPlan.cjs');
const { readPrivate, atomicWrite } = require('../../production/providerIdentityPrivateFiles.cjs');
const { createPipeline } = require('../../production/providerIdentityPipeline.cjs');
const { orchestrate } = require('../../production/providerIdentityOrchestrator.cjs');

const ROOT = path.resolve(__dirname, '../../..');
function setup(directory, repo) {
  const seed = path.join(directory, 'data'), run = path.join(directory, 'run');
  fs.mkdirSync(seed, { mode: 0o700 }); fs.mkdirSync(run, { mode: 0o700 });
  const base = fixture(seed), r = runtime(seed);
  const rulesCandidate = fs.readFileSync(path.join(ROOT, 'tests/firebase/database.rules.provider-identity-window.json'), 'utf8');
  const rulesRollback = fs.readFileSync(path.join(ROOT, 'tests/firebase/database.rules.sec02-production.json'), 'utf8');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
  const contractDigest = sha256(JSON.parse(fs.readFileSync(path.join(ROOT, 'functions/production/legacy-provisioning-contract.json'))));
  const { manifest } = classifySnapshot(base.source, { mainCommit: commit, mainTree: tree,
    capturedAt: new Date(base.at).toISOString(),
    sourceDigests: Object.fromEntries(Object.entries(base.source).map(([key, value]) => [key, sha256(value)])),
    currentRulesDigest: sha256(rulesRollback), provisioningContractDigest: contractDigest });
  const before = { metadata: { name: 'e1-identity-authority' }, spec: { template: { spec: {
    serviceAccountName: base.plan.authority.runtimeServiceAccount,
    containers: [{ image: `image@sha256:${'0'.repeat(64)}`, env: Object.entries(base.plan.authority.environment).map(([name, value]) => ({ name, value })) }] } } },
    status: { latestReadyRevisionName: 'prior-revision', traffic: [{ revisionName: 'prior-revision', percent: 100 }] } };
  const after = structuredClone(before); delete after.status;
  after.spec.template.spec.containers[0].env.push({ name: 'PROVIDER_SUBJECT_HMAC_KEY',
    valueFrom: { secretKeyRef: { name: 'e1-provider-subject-hmac-key', key: '1' } } });
  const authorityIam = { bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${base.plan.gateways.runtimeServiceAccount}`] }] };
  const contract = { authorityBefore: before, authorityAfter: after, authorityIam, gatewayRuntime: 'nodejs22',
    gatewayEnvironment: { APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false', APP_CHECK_ENFORCEMENT_MODE: 'enforced' },
    gatewayRollback: Object.fromEntries(EXPECTED_GATEWAYS.map((name) => [name, null])), rulesCandidate, rulesRollback };
  const store = new RunStore(run);
  const { bundle, request } = prepareBundle({ repo, store, manifest, snapshot: base.source, runId: 'synthetic-pipeline-00000001',
    issuedAt: base.at, expiresAt: base.at + 7200000, runtime: { target: TARGET, contract, providerUsage: r.read().usage,
      freeze: { firestore: null, rtdb: null }, rulesRelease: { etag: 'rules-0' }, projectIam: r.read().projectPolicy } });
  store.approve(approvalPhrase(request), request.operator, base.at + 1);
  atomicWrite(path.join(directory, 'input.json'), { manifest, source: base.source, operator: request.operator, repo });
  const state = r.read();
  Object.assign(state, { service: before, authorityIam, functions: {}, rules: { bytes: rulesRollback, etag: 'rules-0' },
    ruleSequence: 0, commandSequence: 0, commandMutations: {}, operations: {}, proof: [], faultUsed: false });
  r.save(state);
  return { store, manifest, bundle, request, source: base.source };
}

function pipeline(directory, injection = {}, hooks = {}) {
  const r = runtime(path.join(directory, 'data'));
  const { manifest, source, operator, repo } = JSON.parse(readPrivate(path.join(directory, 'input.json')));
  const store = new RunStore(path.join(directory, 'run'));
  const plan = store.read('preparation.json').plan;
  const save = (state) => r.save(state), read = () => r.read();
  const fail = (point) => {
    const state = read();
    if (!state.faultUsed && injection.point === point) {
      state.faultUsed = true; save(state);
      if (injection.kill) process.kill(process.pid, 'SIGKILL');
      throw new Error('synthetic_pipeline_failure');
    }
  };
  const checkpoint = async (point) => {
    if (injection.points) injection.points.push(point);
    if (point === injection.anomalyAt) {
      const state = read();
      if (!state.faultUsed) {
        state.faultUsed = true;
        if (injection.anomaly === 'provider-use') state.usage.accounts = 1;
        if (injection.anomaly === 'foreign-iam') state.policy.bindings.push({
          role: 'roles/secretmanager.secretAccessor', members: ['user:foreign@example.test'] });
        if (injection.anomaly === 'foreign-authority') state.service.metadata.foreignRevision = true;
        save(state); throw new Error('synthetic_anomaly');
      }
    }
    fail(point);
  };
  const spawn = (binary, args, options) => {
    if (args[0] === 'services' || args[0] === 'secrets') {
      fail(`command:before:${args.slice(0, 3).join(':')}`);
      const result = r.spawn(binary, args, options);
      fail(`command:after:${args.slice(0, 3).join(':')}`);
      return result;
    }
    const state = read(), command = args.slice(0, 3).join(' ');
    state.captures.push({ binary, args, stdinLength: options?.input?.length || 0 });
    let result = {};
    if (command === 'run services describe') result = state.service;
    else if (command === 'run services get-iam-policy') result = state.authorityIam;
    else if (args[0] === 'functions' && args[1] === 'list') result = Object.values(state.functions);
    else if (args[0] === 'functions' && args[1] === 'describe') result = state.functions[args[2]];
    else {
      state.commandSequence += 1; state.writes += 1;
      const key = args.slice(0, args[0] === 'functions' ? 3 : 2).join(':');
      state.commandMutations[key] = (state.commandMutations[key] || 0) + 1;
      if (args[0] === 'builds' && args[1] === 'submit') result = { status: 'SUCCESS', results: { images: [{ digest: `sha256:${'a'.repeat(64)}` }] } };
      else if (command === 'run services replace') {
        state.service = JSON.parse(readPrivate(args[3]));
        const revision = `run-revision-${state.commandSequence}`;
        state.service.status = { latestReadyRevisionName: revision, traffic: [{ revisionName: revision, percent: 100 }] };
        result = state.service;
      } else if (command === 'run services update-traffic') {
        state.service.status.traffic = [{ revisionName: 'prior-revision', percent: 100 }]; result = state.service;
      } else if (args[0] === 'functions' && args[1] === 'deploy') {
        const name = args[2];
        state.functions[name] = { name: `projects/${TARGET.projectId}/locations/us-central1/functions/${name}`,
          buildConfig: { entryPoint: name, runtime: args.find((v) => v.startsWith('--runtime=')).slice(10) },
          serviceConfig: { serviceAccountEmail: plan.gateways.runtimeServiceAccount, revision: `function-${state.commandSequence}`,
            environmentVariables: JSON.parse(readPrivate(args.find((v) => v.startsWith('--env-vars-file=')).slice(16))) } };
        result = state.functions[name];
      } else if (args[0] === 'functions' && args[1] === 'delete') delete state.functions[args[2]];
      else throw new Error('unsupported_fake_command');
    }
    save(state);
    fail(`command:after:${args.slice(0, 3).join(':')}`);
    return { status: 0, stdout: JSON.stringify(result), stderr: '' };
  };
  const rules = { async read() { return read().rules; }, async replace(current, bytes) {
    const state = read();
    if (sha256(current) !== sha256(state.rules)) throw new Error('rules_precondition_changed');
    if (hooks.rulesReplace) await hooks.rulesReplace(bytes);
    state.ruleSequence += 1; state.rules = { bytes, etag: `rules-${state.ruleSequence}` }; state.writes += 1;
    save(state); fail('command:after:rules:replace');
    return read().rules;
  } };
  const record = (name) => { const state = read(); state.proof.push(name); save(state); };
  const boundary = {
    adapter: r.adapter, serverTime: hooks.serverTime || r.cloud.serverTime, inventory: hooks.inventory || r.cloud.inventory,
    providerUsage: async () => read().usage, projectPolicy: async () => read().projectPolicy,
    freezeState: hooks.freezeState || (async () => ({ firestore: read().documents['authorityConfig/legacyProvisioningFreeze'] ?? null, rtdb: read().rtdbFreeze })),
    async verifyProvisioningSemantics(active) {
      if (hooks.frozen) await hooks.frozen(active);
      if (!hooks.adapter && read().rtdbFreeze.expiresAt !== active.expiresAt) throw new Error('freeze_clock_mismatch');
      record('frozen-semantics');
    },
    async verifyZeroWriteAdmission(cert) {
      if (hooks.admission) await hooks.admission(cert, read().documents);
      await r.cloud.verifyZeroWriteAdmission(cert); record('zero-write-admission');
    },
    async verifyProvisioningRestored() {
      const value = read().rtdbFreeze;
      if (value && value.state !== 'released' && value.expiresAt > read().at) return false;
      if (hooks.restored) await hooks.restored(value);
      record('provisioning-restored'); return true;
    },
    async operationsDrained() { return Object.values(read().operations).every((v) => ['succeeded', 'failed'].includes(v.status)); }
  };
  if (hooks.adapter) boundary.adapter = hooks.adapter(boundary.adapter);
  const context = createPipeline({ repo, store, manifest, snapshot: source, actualProvenance: operator,
    spawn, rules, boundary, checkpoint });
  return { context, read, save, store };
}

module.exports = { setup, pipeline };
if (require.main === module) {
  const [directory, point] = process.argv.slice(2);
  orchestrate(pipeline(directory, { point, kill: !!point }).context)
    .then((result) => process.stdout.write(`${result.phase}\n`))
    .catch(() => { process.stderr.write('pipeline_incomplete\n'); process.exitCode = 1; });
}
