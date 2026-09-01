#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { guardProductionFirstMutation } = require('../production/e1ProductionFirstMutationGuard.cjs');
const { guardProductionReadProof } = require('../production/e1ProductionReadProofGuard.cjs');
const { guardProductionSecondMutation } = require('../production/e1ProductionSecondMutationGuard.cjs');
const {
  guardProductionThirdMutation,
  guardProductionThirdMutationContinuation
} = require('../production/e1ProductionThirdMutationGuard.cjs');
const { guardProductionClientFoundation } = require('../production/e1ProductionClientFoundationGuard.cjs');
const {
  applyLedgerTransition,
  recordEnablementStarted
} = require('../production/e1ProductionClientFoundationExecution.cjs');
const {
  createDeploymentPlan,
  deploymentArguments,
  publicPlan,
  resolveRepositoryRoot,
  stagePinnedSource
} = require('../production/e1GatewayDeploymentPlan.cjs');

function argumentsMap(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/u.exec(argument);
    if (!match) throw new Error('e1/gateway-deployment-argument-invalid');
    return [match[1], match[2]];
  }));
}

const GUARDS = Object.freeze({
  'group-c': Object.freeze({ input: 'E1_PRODUCTION_READ_PROOF_GUARD_INPUT', run: guardProductionReadProof }),
  'group-d1': Object.freeze({ input: 'E1_PRODUCTION_FIRST_MUTATION_GUARD_INPUT', run: guardProductionFirstMutation }),
  'group-d2': Object.freeze({ input: 'E1_PRODUCTION_SECOND_MUTATION_GUARD_INPUT', run: guardProductionSecondMutation }),
  'group-d3': Object.freeze({ input: 'E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT', run: guardProductionThirdMutation }),
  'group-e': Object.freeze({ input: 'E1_PRODUCTION_GROUP_E_GUARD_INPUT', run: guardProductionClientFoundation })
});

function privateJsonPath(value, label) {
  if (!value) throw new Error(`e1/${label}-input-required`);
  const resolved = path.resolve(value);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`e1/${label}-input-not-private`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`e1/${label}-input-permissions-invalid`);
  return resolved;
}

function privateDirectoryPath(value, label) {
  if (!value) throw new Error(`e1/${label}-input-required`);
  const resolved = path.resolve(value);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!resolved.startsWith(`${localRoot}${path.sep}`) || (fs.statSync(resolved).mode & 0o777) !== 0o700) {
    throw new Error(`e1/${label}-input-not-private`);
  }
  return resolved;
}

function groupEPrivatePaths() {
  const paths = {};
  for (const [name, key] of [['readinessPath','E1_PRODUCTION_GROUP_E_READINESS'],
    ['evidencePath','E1_PRODUCTION_GROUP_E_EVIDENCE'],['jitPath','E1_PRODUCTION_GROUP_E_JIT'],
    ['replayLedgerPath','E1_PRODUCTION_GROUP_E_REPLAY_LEDGER'],
    ['controlDeploymentPath','E1_PRODUCTION_GROUP_E_CONTROL_DEPLOYMENT']]) {
    paths[name] = privateJsonPath(process.env[key], key.toLowerCase().replaceAll('_','-'));
  }
  paths.executionLedgerPath = privateDirectoryPath(process.env.E1_PRODUCTION_GROUP_E_EXECUTION_LEDGER,
    'e1-production-group-e-execution-ledger');
  return paths;
}

function verifiedGuardResult(action, mode, expectedSourceSha, d3Mode, runOptions = {}) {
  if (action.startsWith('restore-')) return null;
  if (action === 'enable-group-d3' && d3Mode === 'continuation') {
    return guardProductionThirdMutationContinuation({ expectedSourceSha });
  }
  if (action === 'enable-group-d3' && d3Mode !== 'clean-start') {
    if (mode === 'plan' && d3Mode === undefined) return null;
    throw new Error('e1/gateway-d3-mode-required');
  }
  const cohort = action.replace(/^(?:enable|restore)-/u, '');
  const contract = GUARDS[cohort];
  if (!contract) throw new Error('e1/gateway-action-guard-contract-missing');
  const inputValue = process.env[contract.input];
  if (!inputValue && mode === 'plan') return null;
  const inputPath = privateJsonPath(inputValue, action);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const options = { inputPath };
  if (action === 'enable-group-d2' && process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS) {
    options.readinessPath = privateJsonPath(process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS, 'group-d2-readiness');
  }
  if (action === 'enable-group-d3') {
    options.expectedSourceSha = expectedSourceSha;
    if (process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS) {
      options.readinessPath = privateJsonPath(process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS, 'group-d3-readiness');
    }
    if (process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS) {
      options.bindingPath = privateJsonPath(process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS, 'group-d3-subjects');
    }
  }
  if (action === 'enable-group-e') {
    Object.assign(options, groupEPrivatePaths());
    if (runOptions.now !== undefined) options.now = runOptions.now;
  }
  return contract.run(input, options);
}

function commitGroupEEnablementStart(guardResult, runOptions = {}) {
  if (guardResult?.executionStage !== 'A_READY' || guardResult.enablementStarted !== false) {
    throw new Error('e1/group-e-enable-start-state-invalid');
  }
  const paths = runOptions.groupEPaths || groupEPrivatePaths();
  const readiness = JSON.parse(fs.readFileSync(paths.readinessPath, 'utf8'));
  const now = runOptions.now === undefined ? Date.now() : runOptions.now;
  if (!Number.isFinite(now)) throw new Error('e1/group-e-enable-start-time-invalid');
  return applyLedgerTransition(paths.executionLedgerPath, guardResult.executionLedgerDigest,
    (ledger) => recordEnablementStarted(ledger, readiness.runManifest, {
      startedAt: new Date(now).toISOString(),
      jit: readiness.jit
    }), { mode: 'apply' });
}

function gcloudJson(spawn, args, label) {
  const result = spawn('gcloud', [...args, '--format=json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`e1/${label}-describe-failed`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`e1/${label}-describe-invalid`); }
}

function environment(container) {
  return Object.fromEntries((container?.env || []).map((entry) => [entry.name, String(entry.value ?? '')]));
}

const AUTHORITY_GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED', 'READ_PROVIDER_PUBLIC_SHARE_ENABLED', 'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED', 'REPAIR_FOUNDATION_ENABLED', 'APPLY_MIGRATION_ENABLED', 'FREEZE_CONFLICT_ENABLED'
]);

const GATEWAY_APP_CHECK_ROLE = 'roles/firebaseappcheck.tokenVerifier';
const GROUP_E_CONTROL_ROLE = 'projects/trade-list-a4297/roles/e1GroupEControlGateway';
const GROUP_E_CONTROL_CONDITION = Object.freeze({
  title: 'e1-group-e-control-only',
  description: 'Restrict Group E control access to the named database',
  expression: 'resource.type == "firestore.googleapis.com/Database" && resource.name == ' +
    '"projects/trade-list-a4297/databases/e1-group-e-control"'
});

function exactMembers(binding, member) {
  return Array.isArray(binding?.members) && binding.members.length === 1 && binding.members[0] === member;
}

function exactGroupEControlCondition(condition) {
  return condition?.title === GROUP_E_CONTROL_CONDITION.title &&
    condition.description === GROUP_E_CONTROL_CONDITION.description &&
    condition.expression === GROUP_E_CONTROL_CONDITION.expression &&
    JSON.stringify(Object.keys(condition).sort()) === JSON.stringify(['description', 'expression', 'title']);
}

function verifyAuthorityIam(plan, spawn) {
  const servicePolicy = gcloudJson(spawn, ['run', 'services', 'get-iam-policy', 'e1-identity-authority',
    `--project=${plan.project}`, `--region=${plan.region}`], 'authority-iam');
  const projectPolicy = gcloudJson(spawn, ['projects', 'get-iam-policy', plan.project], 'project-iam');
  const member = `serviceAccount:${plan.runtimeServiceAccount}`;
  const invokers = (servicePolicy.bindings || []).filter((binding) => binding.role === 'roles/run.invoker')
    .flatMap((binding) => binding.members || []);
  const projectBindings = (projectPolicy.bindings || []).filter((binding) =>
    (binding.members || []).includes(member));
  const appCheckBindings = projectBindings.filter((binding) => binding.role === GATEWAY_APP_CHECK_ROLE);
  const groupEControlBindings = (projectPolicy.bindings || []).filter((binding) =>
    binding.role === GROUP_E_CONTROL_ROLE);
  const appCheckExact = appCheckBindings.length === 1 && exactMembers(appCheckBindings[0], member) &&
    appCheckBindings[0].condition === undefined;
  const groupEControlExact = groupEControlBindings.length === 1 &&
    exactMembers(groupEControlBindings[0], member) &&
    exactGroupEControlCondition(groupEControlBindings[0].condition);
  if (invokers.length !== 1 || invokers[0] !== member ||
      projectBindings.length !== 2 || !appCheckExact || !groupEControlExact) {
    throw new Error('e1/authority-iam-isolation-invalid');
  }
}

function authorityGateValues(plan, enabled) {
  const cohortStage = plan.cohortStage || 'D3';
  return Object.fromEntries(AUTHORITY_GATES.map((gate) => [gate, enabled && (
    cohortStage === 'D3' ? gate === 'RESERVE_HANDLE_ENABLED' :
      cohortStage === 'client-foundation-canary' ? gate === 'READ_ACCOUNT_FOUNDATION_ENABLED' : false
  )]));
}

function verifyAuthorityService(plan, service, expectedEnabled, options = {}) {
  const container = service?.spec?.template?.spec?.containers?.[0];
  const env = environment(container);
  const expectedRuntime = 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com';
  const expectedGates = expectedEnabled === null ? null : authorityGateValues(plan, expectedEnabled);
  if (service?.metadata?.name !== 'e1-identity-authority' || service?.status?.url !== plan.authorityOrigin ||
      service?.spec?.template?.spec?.serviceAccountName !== expectedRuntime ||
      service?.spec?.template?.spec?.containers?.length !== 1 || !String(container?.image || '').includes('@sha256:') ||
      AUTHORITY_GATES.some((gate) => expectedGates === null ? !['true', 'false'].includes(env[gate]) :
        env[gate] !== String(expectedGates[gate])) ||
      (plan.cohortStage === 'client-foundation-canary' && expectedEnabled !== null &&
        ((env.GROUP_E_CLIENT_MODE || 'disabled') !== (expectedEnabled ? 'synthetic-canary' : 'disabled') ||
          (expectedEnabled && (env.GROUP_E_SUBJECT_BINDINGS !== plan.groupEBindings ||
            env.GROUP_E_COHORT_DIGEST !== plan.groupECohortDigest || env.GROUP_E_RUN_ID !== plan.groupERunId ||
            env.GROUP_E_KEY_ID !== plan.groupEKeyId))))) {
    throw new Error('e1/authority-runtime-or-gates-invalid');
  }
  if (options.expectedImage && container.image !== options.expectedImage) {
    throw new Error('e1/authority-image-drift');
  }
  if (options.requireGuardBinding) {
    const expected = plan.authorityRuntime;
    const securityValid = plan.cohortStage === 'client-foundation-canary'
      ? expected?.securityBoundary?.authorityPrivate === true && expected.securityBoundary.gatewayOnlyInvoker === true &&
        expected.securityBoundary.iamDrift === false
      : expected?.securityBoundary?.authorityPrivate === true &&
        expected.securityBoundary.gatewayRuntimeSoleAuthorityInvoker === true && expected.securityBoundary.runtimeIamDrift === false;
    if (!expected || expected.service !== 'e1-identity-authority' || expected.origin !== plan.authorityOrigin ||
        expected.revision !== service.status.latestReadyRevisionName ||
        !String(container.image).endsWith(`@${expected.imageDigest}`) ||
        expected.runtimeServiceAccount !== expectedRuntime || !securityValid) {
      throw new Error('e1/authority-continuation-binding-invalid');
    }
  }
  return true;
}

function authorityReplacement(service, enabled, plan = { cohortStage: 'D3' }) {
  const replacement = structuredClone(service);
  delete replacement.status;
  for (const key of ['creationTimestamp', 'generation', 'resourceVersion', 'selfLink', 'uid']) {
    delete replacement.metadata?.[key];
  }
  const entries = replacement.spec.template.spec.containers[0].env;
  const gates = authorityGateValues(plan, enabled);
  for (const gate of AUTHORITY_GATES) {
    const entry = entries.find((candidate) => candidate.name === gate);
    if (!entry) throw new Error(`e1/authority-gate-missing:${gate}`);
    entry.value = String(gates[gate]);
  }
  const upsert = (name, value) => {
    const entry = entries.find((candidate) => candidate.name === name);
    if (entry) entry.value = value;
    else entries.push({ name, value });
  };
  const privateNames = ['GROUP_E_SUBJECT_BINDINGS','GROUP_E_COHORT_DIGEST','GROUP_E_RUN_ID','GROUP_E_KEY_ID',
    'GROUP_E_WINDOW_START','GROUP_E_WINDOW_END'];
  if (plan.cohortStage === 'client-foundation-canary') {
    upsert('GROUP_E_CLIENT_MODE', enabled ? 'synthetic-canary' : 'disabled');
    for (const name of privateNames) {
      const index = entries.findIndex((entry) => entry.name === name);
      const value = {
        GROUP_E_SUBJECT_BINDINGS: plan.groupEBindings,
        GROUP_E_COHORT_DIGEST: plan.groupECohortDigest,
        GROUP_E_RUN_ID: plan.groupERunId,
        GROUP_E_KEY_ID: plan.groupEKeyId
      }[name];
      if (enabled && value !== undefined) upsert(name, value);
      else if (index >= 0) entries.splice(index, 1);
    }
  }
  return replacement;
}

function replaceAuthority(plan, enabled, options = {}) {
  const spawn = options.spawn || spawnSync;
  const service = gcloudJson(spawn, ['run', 'services', 'describe', 'e1-identity-authority',
    `--project=${plan.project}`, `--region=${plan.region}`], 'authority');
  verifyAuthorityService(plan, service, enabled ? false : null, { requireGuardBinding: enabled });
  verifyAuthorityIam(plan, spawn);
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'e1-authority-gates-'));
  const spec = path.join(directory, 'service.json');
  try {
    fs.writeFileSync(spec, JSON.stringify(authorityReplacement(service, enabled, plan)), { mode: 0o600 });
    for (const dryRun of [true, false]) {
      const args = ['run', 'services', 'replace', spec, `--project=${plan.project}`, `--region=${plan.region}`,
        ...(dryRun ? ['--dry-run'] : []), '--quiet'];
      const result = spawn('gcloud', args, { stdio: 'ignore' });
      if (result.status !== 0) throw new Error(`e1/authority-${enabled ? 'enable' : 'restore'}-failed`);
    }
    const after = gcloudJson(spawn, ['run', 'services', 'describe', 'e1-identity-authority',
      `--project=${plan.project}`, `--region=${plan.region}`], 'authority-post-deploy');
    verifyAuthorityService(plan, after, enabled, { expectedImage: service.spec.template.spec.containers[0].image });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function deployGateway(plan, stagedSource, options = {}) {
  const spawn = options.spawn || spawnSync;
  for (const functionName of plan.functions) {
    const result = spawn('gcloud', deploymentArguments(plan, functionName, stagedSource), { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`e1/gateway-deployment-failed:${functionName}`);
    const service = gcloudJson(spawn, ['functions', 'describe', functionName, '--gen2',
      `--project=${plan.project}`, `--region=${plan.region}`], `gateway-${functionName}`);
    const env = service?.serviceConfig?.environmentVariables || {};
    if (service?.serviceConfig?.serviceAccountEmail !== plan.runtimeServiceAccount ||
        env.GATEWAY_INVOCATION_ENABLED !== String(plan.gateEnabled) || env.READ_PROOF_MODE !== 'false' ||
        env.PROVIDER_PUBLIC_PROJECTION_ENABLED !== 'false' ||
        (env.GROUP_E_CLIENT_MODE || 'disabled') !== (plan.groupEClientMode || 'disabled') ||
        (plan.groupEClientMode === 'synthetic-canary' &&
          (env.GROUP_E_RUN_ID !== plan.groupERunId || env.GROUP_E_RUN_MANIFEST_DIGEST !== plan.groupERunManifestDigest ||
           env.GROUP_E_KEY_ID !== plan.groupEKeyId || env.GROUP_E_CONTROL_DATABASE_ID !== plan.groupEControlDatabaseId))) {
      throw new Error(`e1/gateway-post-deploy-verification-failed:${functionName}`);
    }
  }
}

function executePlan(plan, options = {}) {
  let stagedSource;
  try {
    stagedSource = stagePinnedSource(plan);
    if (!['D3','client-foundation-canary'].includes(plan.cohortStage)) return deployGateway(plan, stagedSource, options);
    if (plan.gateEnabled && plan.d3Mode === 'clean-start') return deployGateway(plan, stagedSource, options);
    if (plan.gateEnabled) {
      try {
        replaceAuthority(plan, true, options);
        deployGateway(plan, stagedSource, options);
      } catch (error) {
        const restorePlan = { ...plan, gateEnabled: false, readProofMode: false, guardVerified: false,
          containmentRestore: true };
        const failures = [];
        try { deployGateway(restorePlan, stagedSource, options); } catch (restoreError) {
          failures.push(restoreError.message);
        }
        try { replaceAuthority(restorePlan, false, options); } catch (restoreError) {
          failures.push(restoreError.message);
        }
        if (failures.length) {
          const scope = plan.cohortStage === 'client-foundation-canary' ? 'group-e' : 'd3';
          throw new Error(`e1/${scope}-containment-restore-failed:${failures.join(',')}`, { cause: error });
        }
        throw error;
      }
    } else {
      deployGateway(plan, stagedSource, options);
      replaceAuthority(plan, false, options);
    }
  } finally {
    if (stagedSource) fs.rmSync(stagedSource, { recursive: true, force: true });
  }
}

function run(argv = process.argv.slice(2), options = {}) {
  const args = argumentsMap(argv);
  const mode = args.mode;
  if (!['plan', 'deploy'].includes(mode)) throw new Error('e1/gateway-deployment-mode-invalid');
  const repoRoot = resolveRepositoryRoot(__dirname);
  const rootIgnore = path.join(repoRoot, '.gcloudignore');
  if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-present');
  let guardResult = verifiedGuardResult(args.action, mode, args['expected-sha'], args['d3-mode'], options);
  let plan = createDeploymentPlan({
    action: args.action,
    expectedSha: args['expected-sha'],
    explicitSource: args.source,
    mode,
    repoRoot,
    guardResult,
    confirmation: args.confirmation,
    d3Mode: args['d3-mode']
  });
  if (mode === 'plan') {
    process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
    if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-created');
    return plan;
  }
  if (args.action === 'enable-group-e' && guardResult.enablementStarted === false) {
    commitGroupEEnablementStart(guardResult, options);
    guardResult = verifiedGuardResult(args.action, mode, args['expected-sha'], args['d3-mode'], options);
    plan = createDeploymentPlan({
      action: args.action,
      expectedSha: args['expected-sha'],
      explicitSource: args.source,
      mode,
      repoRoot,
      guardResult,
      confirmation: args.confirmation,
      d3Mode: args['d3-mode']
    });
    if (plan.groupEEnablementStarted !== true) throw new Error('e1/group-e-enable-start-not-durable');
  }
  executePlan(plan, options);
  if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-created');
  return plan;
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  AUTHORITY_GATES,
  argumentsMap,
  authorityReplacement,
  commitGroupEEnablementStart,
  deployGateway,
  executePlan,
  replaceAuthority,
  run,
  verifiedGuardResult,
  verifyAuthorityIam,
  verifyAuthorityService,
  privateDirectoryPath,
  groupEPrivatePaths
});
