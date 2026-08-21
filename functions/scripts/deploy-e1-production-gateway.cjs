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
  'group-d3': Object.freeze({ input: 'E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT', run: guardProductionThirdMutation })
});

function privateJsonPath(value, label) {
  if (!value) throw new Error(`e1/${label}-input-required`);
  const resolved = path.resolve(value);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`e1/${label}-input-not-private`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`e1/${label}-input-permissions-invalid`);
  return resolved;
}

function verifiedGuardResult(action, mode, expectedSourceSha, d3Mode) {
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
  return contract.run(input, options);
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
  'READ_ACCOUNT_FOUNDATION_ENABLED', 'RESERVE_HANDLE_ENABLED', 'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED', 'FREEZE_CONFLICT_ENABLED'
]);

function verifyAuthorityIam(plan, spawn) {
  const servicePolicy = gcloudJson(spawn, ['run', 'services', 'get-iam-policy', 'e1-identity-authority',
    `--project=${plan.project}`, `--region=${plan.region}`], 'authority-iam');
  const projectPolicy = gcloudJson(spawn, ['projects', 'get-iam-policy', plan.project], 'project-iam');
  const member = `serviceAccount:${plan.runtimeServiceAccount}`;
  const invokers = (servicePolicy.bindings || []).filter((binding) => binding.role === 'roles/run.invoker')
    .flatMap((binding) => binding.members || []);
  const projectRoles = (projectPolicy.bindings || []).filter((binding) => (binding.members || []).includes(member))
    .map((binding) => binding.role).sort();
  if (invokers.length !== 1 || invokers[0] !== member ||
      JSON.stringify(projectRoles) !== JSON.stringify(['roles/firebaseappcheck.tokenVerifier'])) {
    throw new Error('e1/authority-iam-isolation-invalid');
  }
}

function verifyAuthorityService(plan, service, expectedEnabled, options = {}) {
  const container = service?.spec?.template?.spec?.containers?.[0];
  const env = environment(container);
  const expectedRuntime = 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com';
  if (service?.metadata?.name !== 'e1-identity-authority' || service?.status?.url !== plan.authorityOrigin ||
      service?.spec?.template?.spec?.serviceAccountName !== expectedRuntime ||
      service?.spec?.template?.spec?.containers?.length !== 1 || !String(container?.image || '').includes('@sha256:') ||
      AUTHORITY_GATES.some((gate) => gate === 'RESERVE_HANDLE_ENABLED' && expectedEnabled === null
        ? !['true', 'false'].includes(env[gate])
        : env[gate] !== String(gate === 'RESERVE_HANDLE_ENABLED' && expectedEnabled))) {
    throw new Error('e1/authority-runtime-or-gates-invalid');
  }
  if (options.expectedImage && container.image !== options.expectedImage) {
    throw new Error('e1/authority-image-drift');
  }
  if (options.requireGuardBinding) {
    const expected = plan.authorityRuntime;
    if (!expected || expected.service !== 'e1-identity-authority' || expected.origin !== plan.authorityOrigin ||
        expected.revision !== service.status.latestReadyRevisionName ||
        !String(container.image).endsWith(`@${expected.imageDigest}`) ||
        expected.runtimeServiceAccount !== expectedRuntime || expected.securityBoundary?.authorityPrivate !== true ||
        expected.securityBoundary?.gatewayRuntimeSoleAuthorityInvoker !== true ||
        expected.securityBoundary?.runtimeIamDrift !== false) {
      throw new Error('e1/authority-continuation-binding-invalid');
    }
  }
  return true;
}

function authorityReplacement(service, enabled) {
  const replacement = structuredClone(service);
  delete replacement.status;
  for (const key of ['creationTimestamp', 'generation', 'resourceVersion', 'selfLink', 'uid']) {
    delete replacement.metadata?.[key];
  }
  const entries = replacement.spec.template.spec.containers[0].env;
  for (const gate of AUTHORITY_GATES) {
    const entry = entries.find((candidate) => candidate.name === gate);
    if (!entry) throw new Error(`e1/authority-gate-missing:${gate}`);
    entry.value = String(gate === 'RESERVE_HANDLE_ENABLED' && enabled);
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
    fs.writeFileSync(spec, JSON.stringify(authorityReplacement(service, enabled)), { mode: 0o600 });
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
        env.GATEWAY_INVOCATION_ENABLED !== String(plan.gateEnabled) || env.READ_PROOF_MODE !== 'false') {
      throw new Error(`e1/gateway-post-deploy-verification-failed:${functionName}`);
    }
  }
}

function executePlan(plan, options = {}) {
  let stagedSource;
  try {
    stagedSource = stagePinnedSource(plan);
    if (plan.cohortStage !== 'D3') return deployGateway(plan, stagedSource, options);
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
        if (failures.length) throw new Error(`e1/d3-containment-restore-failed:${failures.join(',')}`, { cause: error });
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
  const guardResult = verifiedGuardResult(args.action, mode, args['expected-sha'], args['d3-mode']);
  const plan = createDeploymentPlan({
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
  deployGateway,
  executePlan,
  replaceAuthority,
  run,
  verifiedGuardResult,
  verifyAuthorityService
});
