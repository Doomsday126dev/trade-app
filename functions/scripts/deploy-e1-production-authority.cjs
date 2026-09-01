#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  DEPLOY_CONFIRMATION,
  createDeploymentPlan,
  publicPlan,
  resolveRepositoryRoot,
  stagePinnedSource,
  verifyStagedSource
} = require('../production/e1AuthorityDeploymentPlan.cjs');

const AUTHORITY_GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const REQUIRED_INACTIVE_ENVIRONMENT = Object.freeze({
  READ_ACCOUNT_FOUNDATION_ENABLED: 'false',
  CREATE_PROVIDER_ACCOUNT_ENABLED: 'false',
  RESERVE_HANDLE_ENABLED: 'false',
  REPAIR_FOUNDATION_ENABLED: 'false',
  APPLY_MIGRATION_ENABLED: 'false',
  FREEZE_CONFLICT_ENABLED: 'false',
  READ_PROOF_MODE: 'false',
  GROUP_E_CLIENT_MODE: 'disabled'
});
const GROUP_E_PRIVATE_ENVIRONMENT = Object.freeze([
  'GROUP_E_SUBJECT_BINDINGS',
  'GROUP_E_COHORT_DIGEST',
  'GROUP_E_RUN_ID',
  'GROUP_E_RUN_MANIFEST_DIGEST',
  'GROUP_E_KEY_ID',
  'GROUP_E_PUBLIC_KEY_SPKI',
  'GROUP_E_FIREBASE_APP_ID_HASH',
  'GROUP_E_CONTROL_DATABASE_ID',
  'GROUP_E_WINDOW_START',
  'GROUP_E_WINDOW_END'
]);

function argumentsMap(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/u.exec(argument);
    if (!match) throw new Error('e1/authority-deployment-argument-invalid');
    return [match[1], match[2]];
  }));
}

function gcloudJson(spawn, args, label) {
  const result = spawn('gcloud', [...args, '--format=json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`e1/${label}-failed`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`e1/${label}-invalid`); }
}

function environment(container) {
  return Object.fromEntries((container?.env || []).map((entry) => [entry.name, String(entry.value ?? '')]));
}

function inactiveEnvironmentValid(env, options = {}) {
  return Object.entries(REQUIRED_INACTIVE_ENVIRONMENT).every(([name, value]) => {
    if (name === 'READ_PROOF_MODE' && options.allowLegacyMissingReadProofMode === true && env[name] === undefined) {
      return true;
    }
    return env[name] === value;
  });
}

function verifyAuthorityIam(plan, spawn) {
  const policy = gcloudJson(spawn, ['run', 'services', 'get-iam-policy', plan.target.service,
    `--project=${plan.target.projectId}`, `--region=${plan.target.region}`], 'authority-iam');
  const invokerBindings = (policy.bindings || []).filter((binding) => binding.role === 'roles/run.invoker');
  const members = invokerBindings.flatMap((binding) => binding.members || []);
  const expected = `serviceAccount:e1-authority-gateway@${plan.target.projectId}.iam.gserviceaccount.com`;
  if (invokerBindings.length !== 1 || members.length !== 1 || members[0] !== expected ||
      members.includes('allUsers') || members.includes('allAuthenticatedUsers')) {
    throw new Error('e1/authority-private-iam-invalid');
  }
  return true;
}

function verifyAuthorityService(plan, service, options = {}) {
  const containers = service?.spec?.template?.spec?.containers;
  const container = containers?.[0];
  const env = environment(container);
  const ready = (service?.status?.conditions || []).some((condition) =>
    condition.type === 'Ready' && String(condition.status) === 'True');
  if (service?.metadata?.name !== plan.target.service || service?.status?.url !== plan.target.origin ||
      service?.spec?.template?.spec?.serviceAccountName !== plan.target.runtimeServiceAccount ||
      !Array.isArray(containers) || containers.length !== 1 || !/@sha256:[a-f0-9]{64}$/u.test(container?.image || '') ||
      !ready || (options.requireInactive !== false && !inactiveEnvironmentValid(env, options)) ||
      (options.allowPrivateEnvironment !== true && (
        GROUP_E_PRIVATE_ENVIRONMENT.some((name) => env[name] !== undefined && env[name] !== '') ||
        Object.keys(env).some((name) => name.startsWith('GROUP_E_') &&
          name !== 'GROUP_E_CLIENT_MODE' && !GROUP_E_PRIVATE_ENVIRONMENT.includes(name))))) {
    throw new Error('e1/authority-runtime-or-inactive-state-invalid');
  }
  if (options.expectedImage && container.image !== options.expectedImage) {
    throw new Error('e1/authority-image-mismatch');
  }
  return true;
}

function inactiveServiceSpec(plan, service, image) {
  verifyAuthorityService(plan, service, {
    allowLegacyMissingReadProofMode: true,
    allowPrivateEnvironment: true
  });
  if (!new RegExp(`^${plan.target.imageUri.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}@sha256:[a-f0-9]{64}$`, 'u').test(image)) {
    throw new Error('e1/authority-built-image-invalid');
  }
  const replacement = structuredClone(service);
  delete replacement.status;
  for (const key of ['creationTimestamp', 'generation', 'resourceVersion', 'selfLink', 'uid']) {
    delete replacement.metadata?.[key];
  }
  const annotations = replacement.spec?.template?.metadata?.annotations || {};
  delete annotations['run.googleapis.com/sources'];
  delete annotations['run.googleapis.com/base-images'];
  delete replacement.spec?.template?.spec?.runtimeClassName;
  const container = replacement.spec.template.spec.containers[0];
  container.image = image;
  delete container.command;
  delete container.args;
  const originalNames = new Set((container.env || []).map((entry) => entry.name));
  if (Object.keys(REQUIRED_INACTIVE_ENVIRONMENT)
    .some((name) => name !== 'READ_PROOF_MODE' && !originalNames.has(name))) {
    throw new Error('e1/authority-required-inactive-environment-missing');
  }
  container.env = (container.env || []).flatMap((entry) => {
    if (entry.name.startsWith('GROUP_E_') && entry.name !== 'GROUP_E_CLIENT_MODE') return [];
    if (Object.hasOwn(REQUIRED_INACTIVE_ENVIRONMENT, entry.name)) {
      return [{ name: entry.name, value: REQUIRED_INACTIVE_ENVIRONMENT[entry.name] }];
    }
    return [entry];
  });
  if (!originalNames.has('READ_PROOF_MODE')) {
    container.env.push({ name: 'READ_PROOF_MODE', value: REQUIRED_INACTIVE_ENVIRONMENT.READ_PROOF_MODE });
  }
  const fakeReady = { ...replacement, status: { url: plan.target.origin, conditions: [{ type: 'Ready', status: 'True' }] } };
  verifyAuthorityService(plan, fakeReady, { expectedImage: image });
  return replacement;
}

function cloudBuildConfig(plan) {
  return [
    'steps:',
    '- name: gcr.io/k8s-skaffold/pack',
    '  entrypoint: pack',
    '  args: [config, default-builder, gcr.io/buildpacks/builder:latest]',
    '- name: gcr.io/k8s-skaffold/pack',
    '  entrypoint: pack',
    `  args: [build, ${plan.target.imageUri}, --network, cloudbuild, --publish]`,
    '- name: gcr.io/cloud-builders/docker',
    '  entrypoint: docker',
    `  args: [pull, ${plan.target.imageUri}]`,
    'images:',
    `- ${plan.target.imageUri}`,
    'options:',
    '  logging: CLOUD_LOGGING_ONLY',
    ''
  ].join('\n');
}

function buildAuthority(plan, stagedSource, configPath, spawn) {
  const source = verifyStagedSource(plan, stagedSource);
  const result = spawn('gcloud', [
    'builds', 'submit', source,
    `--project=${plan.target.projectId}`,
    `--region=${plan.target.region}`,
    `--config=${configPath}`,
    `--service-account=${plan.target.builderServiceAccountResource}`,
    '--format=json',
    '--quiet'
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('e1/authority-build-failed');
  let build;
  try { build = JSON.parse(result.stdout); } catch { throw new Error('e1/authority-build-result-invalid'); }
  const imageDigest = build?.results?.images?.[0]?.digest;
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageDigest || '') || !/^[a-f0-9-]{20,64}$/u.test(build?.id || '')) {
    throw new Error('e1/authority-build-result-invalid');
  }
  return Object.freeze({ buildId: build.id, imageDigest, image: `${plan.target.imageUri}@${imageDigest}` });
}

function replaceAuthority(plan, built, workDirectory, spawn) {
  const before = gcloudJson(spawn, ['run', 'services', 'describe', plan.target.service,
    `--project=${plan.target.projectId}`, `--region=${plan.target.region}`], 'authority-describe');
  verifyAuthorityService(plan, before, {
    allowLegacyMissingReadProofMode: true,
    allowPrivateEnvironment: true
  });
  verifyAuthorityIam(plan, spawn);
  const specPath = path.join(workDirectory, 'service.json');
  fs.writeFileSync(specPath, `${JSON.stringify(inactiveServiceSpec(plan, before, built.image))}\n`, { mode: 0o600 });
  const replaceArgs = [
    'run', 'services', 'replace', specPath,
    `--project=${plan.target.projectId}`,
    `--region=${plan.target.region}`,
    `--impersonate-service-account=${plan.target.deployerServiceAccount}`,
    '--quiet'
  ];
  for (const dryRun of [true, false]) {
    const result = spawn('gcloud', [...replaceArgs, ...(dryRun ? ['--dry-run'] : [])], { stdio: 'ignore' });
    if (result.status !== 0) throw new Error(`e1/authority-${dryRun ? 'dry-run' : 'replace'}-failed`);
  }
  const after = gcloudJson(spawn, ['run', 'services', 'describe', plan.target.service,
    `--project=${plan.target.projectId}`, `--region=${plan.target.region}`], 'authority-post-deploy');
  verifyAuthorityService(plan, after, { expectedImage: built.image });
  verifyAuthorityIam(plan, spawn);
  const traffic = after.status?.traffic || [];
  if (after.status.latestReadyRevisionName === before.status.latestReadyRevisionName || traffic.length !== 1 ||
      traffic[0].revisionName !== after.status.latestReadyRevisionName || traffic[0].percent !== 100) {
    throw new Error('e1/authority-post-deploy-verification-invalid');
  }
  return Object.freeze({
    buildId: built.buildId,
    imageDigest: built.imageDigest,
    previousRevision: before.status.latestReadyRevisionName,
    revision: after.status.latestReadyRevisionName,
    runtimeServiceAccount: after.spec.template.spec.serviceAccountName,
    trafficPercent: 100,
    authorityPrivate: true,
    gatewayOnlyInvoker: true,
    authorityGatesDisabled: true,
    groupEClientMode: 'disabled'
  });
}

function executePlan(plan, options = {}) {
  if (!plan.deploymentAllowed) throw new Error('e1/authority-deployment-not-allowed');
  const spawn = options.spawn || spawnSync;
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-deploy-'));
  fs.chmodSync(workDirectory, 0o700);
  let stagedSource;
  try {
    stagedSource = stagePinnedSource(plan);
    const configPath = path.join(workDirectory, 'cloudbuild.yaml');
    fs.writeFileSync(configPath, cloudBuildConfig(plan), { mode: 0o600 });
    const built = buildAuthority(plan, stagedSource, configPath, spawn);
    return replaceAuthority(plan, built, workDirectory, spawn);
  } finally {
    if (stagedSource) fs.rmSync(stagedSource, { recursive: true, force: true });
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

function run(argv = process.argv.slice(2), options = {}) {
  const args = argumentsMap(argv);
  const mode = args.mode || 'plan';
  const repoRoot = options.repoRoot || resolveRepositoryRoot(__dirname);
  const rootIgnore = path.join(repoRoot, '.gcloudignore');
  if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-present');
  const plan = createDeploymentPlan({
    mode,
    expectedSha: args['expected-sha'],
    explicitSource: args.source,
    confirmation: args.confirmation,
    repoRoot,
    repository: options.repository,
    manifest: options.manifest,
    resourceManifest: options.resourceManifest
  });
  if (mode === 'deploy') return executePlan(plan, options);
  const stagedSource = stagePinnedSource(plan);
  try {
    const output = publicPlan(plan);
    (options.stdout || process.stdout).write(`${JSON.stringify(output, null, 2)}\n`);
    return output;
  } finally {
    fs.rmSync(stagedSource, { recursive: true, force: true });
    if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-created');
  }
}

if (require.main === module) {
  try {
    const result = run();
    if (result && result.buildId) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: String(error?.message || 'e1/authority-deployment-failed').slice(0, 120) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  AUTHORITY_GATES,
  DEPLOY_CONFIRMATION,
  GROUP_E_PRIVATE_ENVIRONMENT,
  REQUIRED_INACTIVE_ENVIRONMENT,
  argumentsMap,
  buildAuthority,
  cloudBuildConfig,
  environment,
  executePlan,
  inactiveEnvironmentValid,
  inactiveServiceSpec,
  replaceAuthority,
  run,
  verifyAuthorityIam,
  verifyAuthorityService
});
