#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  createBuildReceipt,
  createQualificationReceipt,
  dockerfile,
  expectedBuildConfig,
  sha256,
  verifyArtifactProvenance,
  verifyBuildReceipt,
  verifyBuildResult,
  verifyDependencyLock,
  verifyQualificationReceipt
} = require('../production/e1AuthorityBuildPolicy.cjs');
const verifiedBuilds = new WeakMap();
const {
  DEPLOY_CONFIRMATION,
  createDeploymentPlan,
  publicPlan,
  resolveRepositoryRoot,
  stagePinnedSource,
  verifyStagedSource
} = require('../production/e1AuthorityDeploymentPlan.cjs');
const {
  assertProviderCompatibilityDeployment,
  loadCompatibilityFloor
} = require('../production/providerAccountCompatibilityFloor.cjs');

const AUTHORITY_GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const REQUIRED_INACTIVE_ENVIRONMENT = Object.freeze({
  READ_ACCOUNT_FOUNDATION_ENABLED: 'false',
  READ_PROVIDER_PUBLIC_SHARE_ENABLED: 'false',
  CREATE_PROVIDER_ACCOUNT_ENABLED: 'false',
  RESERVE_HANDLE_ENABLED: 'false',
  REPAIR_FOUNDATION_ENABLED: 'false',
  APPLY_MIGRATION_ENABLED: 'false',
  FREEZE_CONFLICT_ENABLED: 'false',
  PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'false',
  READ_PROOF_MODE: 'false',
  GROUP_E_CLIENT_MODE: 'disabled'
});
const LEGACY_MISSING_FALSE_ENVIRONMENT = Object.freeze([
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED'
]);
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
const PROVIDER_SUBJECT_KEY_CONTRACT = Object.freeze({
  keyEnvironmentName: 'PROVIDER_SUBJECT_HMAC_KEY',
  versionEnvironmentName: 'PROVIDER_SUBJECT_HMAC_KEY_VERSION',
  previousVersionsEnvironmentName: 'PROVIDER_SUBJECT_HMAC_PREVIOUS_KEY_VERSIONS',
  previousKeyEnvironmentPrefix: 'PROVIDER_SUBJECT_HMAC_KEY_V',
  secretName: 'e1-provider-subject-hmac-key'
});

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

function privateJsonPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.basename(value) !== value.split(path.sep).at(-1)) {
    throw new Error('e1/authority-receipt-path-invalid');
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  const stat = fs.statSync(parent);
  if (!stat.isDirectory()) throw new Error('e1/authority-receipt-path-invalid');
  return resolved;
}

function writePrivateJson(file, value) {
  const resolved = privateJsonPath(file);
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.linkSync(temporary, resolved);
  } catch {
    throw new Error('e1/authority-receipt-write-failed');
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return resolved;
}

function readPrivateJson(file) {
  let resolved;
  let stat;
  try {
    resolved = privateJsonPath(file);
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error('e1/authority-receipt-file-invalid');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024) {
    throw new Error('e1/authority-receipt-file-invalid');
  }
  try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch { throw new Error('e1/authority-receipt-file-invalid'); }
}

function environment(container) {
  return Object.fromEntries((container?.env || []).map((entry) => [entry.name, String(entry.value ?? '')]));
}

function inactiveEnvironmentValid(env, options = {}) {
  const floor = options.compatibilityFloor || loadCompatibilityFloor();
  const required = floor.providerAccountsExist ? {
    ...REQUIRED_INACTIVE_ENVIRONMENT,
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'true'
  } : REQUIRED_INACTIVE_ENVIRONMENT;
  if (options.allowLegacyMissingFalseEnvironment === true &&
      LEGACY_MISSING_FALSE_ENVIRONMENT.some((name) => required[name] !== 'false')) {
    return false;
  }
  return Object.entries(required).every(([name, value]) => {
    if (name === 'READ_PROOF_MODE' && options.allowLegacyMissingReadProofMode === true && env[name] === undefined) {
      return true;
    }
    if (options.allowLegacyMissingFalseEnvironment === true && env[name] === undefined &&
        LEGACY_MISSING_FALSE_ENVIRONMENT.includes(name)) {
      return true;
    }
    return env[name] === value;
  });
}

function providerSubjectKeyVersions(container) {
  const entries = Array.isArray(container?.env) ? container.env : [];
  const keys = entries.filter((entry) => entry?.name === PROVIDER_SUBJECT_KEY_CONTRACT.keyEnvironmentName);
  const versions = entries.filter((entry) => entry?.name === PROVIDER_SUBJECT_KEY_CONTRACT.versionEnvironmentName);
  const previousLists = entries.filter((entry) => entry?.name === PROVIDER_SUBJECT_KEY_CONTRACT.previousVersionsEnvironmentName);
  const previousVersions = previousLists.length === 1 && String(previousLists[0].value || '')
    ? String(previousLists[0].value).split(',') : [];
  const previousNames = new Set(previousVersions.map((version) => `${PROVIDER_SUBJECT_KEY_CONTRACT.previousKeyEnvironmentPrefix}${version}`));
  const previousKeys = entries.filter((entry) => /^PROVIDER_SUBJECT_HMAC_KEY_V[1-9][0-9]{0,3}$/u.test(entry?.name || ''));
  if (previousLists.length > 1 || previousVersions.some((version) => !/^[1-9][0-9]{0,3}$/u.test(version)) ||
      new Set(previousVersions).size !== previousVersions.length ||
      previousVersions.some((version) => Number(version) >= Number(versions[0]?.value)) ||
      previousVersions.some((version, index) => index > 0 && Number(version) <= Number(previousVersions[index - 1])) ||
      previousKeys.length !== previousNames.size || previousKeys.some((entry) => !previousNames.has(entry.name))) return null;
  if (!keys.length && !versions.length) return previousVersions.length ? null : Object.freeze([]);
  if (keys.length !== 1 || versions.length !== 1) return null;
  const key = keys[0], version = versions[0], value = String(version.value ?? '');
  const secret = key.valueFrom?.secretKeyRef;
  const activeValid = Object.keys(key).sort().join(',') === 'name,valueFrom' &&
    Object.keys(version).sort().join(',') === 'name,value' &&
    Object.keys(key.valueFrom || {}).sort().join(',') === 'secretKeyRef' &&
    Object.keys(secret || {}).sort().join(',') === 'key,name' &&
    secret.name === PROVIDER_SUBJECT_KEY_CONTRACT.secretName && secret.key === value &&
    /^[1-9][0-9]{0,3}$/u.test(value);
  if (!activeValid || previousVersions.includes(value)) return null;
  for (const previousKey of previousKeys) {
    const previousVersion = previousKey.name.slice(PROVIDER_SUBJECT_KEY_CONTRACT.previousKeyEnvironmentPrefix.length);
    const previousSecret = previousKey.valueFrom?.secretKeyRef;
    if (Object.keys(previousKey).sort().join(',') !== 'name,valueFrom' ||
        Object.keys(previousKey.valueFrom || {}).sort().join(',') !== 'secretKeyRef' ||
        Object.keys(previousSecret || {}).sort().join(',') !== 'key,name' ||
        previousSecret.name !== PROVIDER_SUBJECT_KEY_CONTRACT.secretName || previousSecret.key !== previousVersion) return null;
  }
  return Object.freeze([Number(value), ...previousVersions.map(Number)]);
}

function providerSubjectKeyEnvironmentValid(container, { creationEnabled = false, compatibilityFloor } = {}) {
  const versions = providerSubjectKeyVersions(container);
  if (!versions) return false;
  const floor = compatibilityFloor || loadCompatibilityFloor();
  if ((creationEnabled || floor.providerAccountsExist) && !versions.length) return false;
  return floor.requiredProviderSubjectKeyVersions.every((version) => versions.includes(version));
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
  const compatibilityFloor = options.compatibilityFloor || loadCompatibilityFloor();
  const keyVersions = providerSubjectKeyVersions(container);
  const compatibilityEnvironment = options.allowLegacyMissingFalseEnvironment === true ? {
    ...Object.fromEntries(LEGACY_MISSING_FALSE_ENVIRONMENT.map((name) => [name, 'false'])),
    ...env
  } : env;
  const ready = (service?.status?.conditions || []).some((condition) =>
    condition.type === 'Ready' && String(condition.status) === 'True');
  if (service?.metadata?.name !== plan.target.service || service?.status?.url !== plan.target.origin ||
      service?.spec?.template?.spec?.serviceAccountName !== plan.target.runtimeServiceAccount ||
      !Array.isArray(containers) || containers.length !== 1 || !/@sha256:[a-f0-9]{64}$/u.test(container?.image || '') ||
      !ready || (options.requireInactive !== false && !inactiveEnvironmentValid(env, { ...options, compatibilityFloor })) ||
      !providerSubjectKeyEnvironmentValid(container, { creationEnabled: env.CREATE_PROVIDER_ACCOUNT_ENABLED === 'true', compatibilityFloor }) ||
      (options.allowPrivateEnvironment !== true && (
        GROUP_E_PRIVATE_ENVIRONMENT.some((name) => env[name] !== undefined && env[name] !== '') ||
        Object.keys(env).some((name) => name.startsWith('GROUP_E_') &&
          name !== 'GROUP_E_CLIENT_MODE' && !GROUP_E_PRIVATE_ENVIRONMENT.includes(name))))) {
    throw new Error('e1/authority-runtime-or-inactive-state-invalid');
  }
  try {
    assertProviderCompatibilityDeployment({ floor: compatibilityFloor, authoritySourceFingerprint: plan.sourceFingerprint,
      environment: compatibilityEnvironment, availableKeyVersions: keyVersions });
  } catch {
    throw new Error('e1/authority-runtime-or-inactive-state-invalid');
  }
  if (options.expectedImage && container.image !== options.expectedImage) {
    throw new Error('e1/authority-image-mismatch');
  }
  return true;
}

function inactiveServiceSpec(plan, service, image) {
  const compatibilityFloor = loadCompatibilityFloor();
  verifyAuthorityService(plan, service, {
    allowLegacyMissingFalseEnvironment: true,
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
  const requiredEnvironment = compatibilityFloor.providerAccountsExist ? {
    ...REQUIRED_INACTIVE_ENVIRONMENT,
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'true'
  } : REQUIRED_INACTIVE_ENVIRONMENT;
  const originalNames = new Set((container.env || []).map((entry) => entry.name));
  const permittedMissingNames = new Set(['READ_PROOF_MODE', ...LEGACY_MISSING_FALSE_ENVIRONMENT]);
  if (Object.keys(requiredEnvironment)
    .some((name) => !permittedMissingNames.has(name) && !originalNames.has(name))) {
    throw new Error('e1/authority-required-inactive-environment-missing');
  }
  container.env = (container.env || []).flatMap((entry) => {
    if (entry.name.startsWith('GROUP_E_') && entry.name !== 'GROUP_E_CLIENT_MODE') return [];
    if (Object.hasOwn(requiredEnvironment, entry.name)) {
      return [{ name: entry.name, value: requiredEnvironment[entry.name] }];
    }
    return [entry];
  });
  for (const name of permittedMissingNames) {
    if (!originalNames.has(name)) container.env.push({ name, value: requiredEnvironment[name] });
  }
  const fakeReady = { ...replacement, status: { url: plan.target.origin, conditions: [{ type: 'Ready', status: 'True' }] } };
  verifyAuthorityService(plan, fakeReady, { expectedImage: image });
  return replacement;
}

function cloudBuildConfig(plan, requestId) {
  return `${JSON.stringify(expectedBuildConfig(plan, requestId), null, 2)}\n`;
}

function prepareBuildSource(plan, stagedSource, workDirectory) {
  const source = verifyStagedSource(plan, stagedSource);
  const context = path.join(workDirectory, 'context');
  fs.mkdirSync(context, { mode: 0o700 });
  for (const file of plan.manifest.sourceFiles) {
    const bytes = fs.readFileSync(path.join(source, file.path));
    if (sha256(bytes) !== file.sha256) throw new Error('e1/authority-staged-source-hash-mismatch');
    if (file.path === 'package-lock.json') verifyDependencyLock(bytes);
    fs.writeFileSync(path.join(context, file.path), bytes, { mode: 0o600, flag: 'wx' });
  }
  fs.writeFileSync(path.join(context, 'Dockerfile'), dockerfile(), { mode: 0o600, flag: 'wx' });
  const archive = path.join(workDirectory, 'source.tgz');
  execFileSync('tar', ['-czf', archive, '-C', context,
    ...plan.manifest.sourceFiles.map((file) => file.path), 'Dockerfile'], { stdio: 'pipe' });
  fs.chmodSync(archive, 0o600);
  return Object.freeze({ archive, archiveSha256: sha256(fs.readFileSync(archive)) });
}

function verifyBuildArchive(plan, archive, expectedSha256) {
  if (sha256(fs.readFileSync(archive)) !== expectedSha256) throw new Error('e1/authority-build-archive-hash-mismatch');
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .trim().split('\n').filter(Boolean);
  const expectedMembers = [...plan.manifest.sourceFiles.map((file) => file.path), 'Dockerfile'];
  if (JSON.stringify(members) !== JSON.stringify(expectedMembers) || new Set(members).size !== members.length ||
      members.some((member) => path.isAbsolute(member) || member.includes('..') || member.includes('\\'))) {
    throw new Error('e1/authority-build-archive-inventory-mismatch');
  }
  for (const file of plan.manifest.sourceFiles) {
    const bytes = execFileSync('tar', ['-xOzf', archive, file.path], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (sha256(bytes) !== file.sha256) throw new Error('e1/authority-build-archive-source-mismatch');
  }
  const observedDockerfile = execFileSync('tar', ['-xOzf', archive, 'Dockerfile'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (observedDockerfile !== dockerfile()) throw new Error('e1/authority-build-archive-dockerfile-mismatch');
  return true;
}

function submitAuthorityBuild(plan, stagedSource, workDirectory, receiptPath, spawn) {
  if (!plan.deploymentAllowed || plan.mode !== 'build') throw new Error('e1/authority-build-not-allowed');
  const source = prepareBuildSource(plan, stagedSource, workDirectory);
  const requestId = randomUUID();
  const config = expectedBuildConfig(plan, requestId);
  const configPath = path.join(workDirectory, 'cloudbuild.json');
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  const submittedAt = Date.now();
  const submitted = gcloudJson(spawn, [
    'builds', 'submit', source.archive,
    `--project=${plan.target.projectId}`,
    `--region=${plan.target.region}`,
    `--config=${configPath}`,
    `--service-account=${plan.target.builderServiceAccountResource}`,
    '--async',
    '--quiet'
  ], 'authority-build-submit');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(submitted?.id || '')) {
    throw new Error('e1/authority-build-result-invalid');
  }
  const receipt = createBuildReceipt(plan, {
    archiveSha256: source.archiveSha256,
    buildId: submitted.id,
    config,
    requestId,
    submittedAt
  });
  const persisted = writePrivateJson(receiptPath, receipt);
  return Object.freeze({
    state: 'submitted',
    buildId: receipt.buildId,
    receiptPath: persisted,
    receiptSha256: receipt.receiptSha256
  });
}

function inspectAuthorityBuild(plan, buildReceipt, workDirectory, spawn) {
  const expectedReceipt = verifyBuildReceipt(plan, buildReceipt);
  const build = gcloudJson(spawn, ['builds', 'describe', buildReceipt.buildId,
    `--project=${plan.target.projectId}`, `--region=${plan.target.region}`], 'authority-build-readback');
  const expected = Object.freeze({ ...expectedReceipt,
    storageSource: structuredClone(build?.source?.storageSource) });
  const built = verifyBuildResult(plan, build, expected);
  const storage = expected.storageSource;
  const archive = path.join(workDirectory, 'resolved-source.tgz');
  const copied = spawn('gcloud', ['storage', 'cp',
    `gs://${storage.bucket}/${storage.object}#${storage.generation}`, archive,
    `--project=${plan.target.projectId}`, '--quiet'], { stdio: 'ignore' });
  if (copied.status !== 0) throw new Error('e1/authority-build-source-download-failed');
  fs.chmodSync(archive, 0o600);
  verifyBuildArchive(plan, archive, expected.archiveSha256);
  const artifact = gcloudJson(spawn, ['artifacts', 'docker', 'images', 'describe', built.image,
    '--show-provenance', `--project=${plan.target.projectId}`], 'authority-provenance');
  verifyArtifactProvenance(plan, artifact, build, expected, built);
  return Object.freeze({ build, built, expected });
}

function qualifyAuthorityBuild(plan, receiptPath, qualificationPath, workDirectory, spawn) {
  if (!plan.deploymentAllowed || plan.mode !== 'qualify') throw new Error('e1/authority-qualification-not-allowed');
  const buildReceipt = readPrivateJson(receiptPath);
  const inspected = inspectAuthorityBuild(plan, buildReceipt, workDirectory, spawn);
  const qualification = createQualificationReceipt(plan, buildReceipt, inspected.build,
    inspected.expected, inspected.built);
  const persisted = writePrivateJson(qualificationPath, qualification);
  return Object.freeze({
    state: 'qualified',
    buildId: inspected.built.buildId,
    imageDigest: inspected.built.imageDigest,
    image: inspected.built.image,
    qualificationPath: persisted,
    qualificationSha256: qualification.qualificationSha256
  });
}

function requalifyAuthorityBuild(plan, receiptPath, qualificationPath, workDirectory, spawn) {
  const buildReceipt = readPrivateJson(receiptPath);
  const qualification = readPrivateJson(qualificationPath);
  verifyQualificationReceipt(plan, buildReceipt, qualification);
  const inspected = inspectAuthorityBuild(plan, buildReceipt, workDirectory, spawn);
  const observed = createQualificationReceipt(plan, buildReceipt, inspected.build,
    inspected.expected, inspected.built, Date.parse(qualification.qualifiedAt));
  if (JSON.stringify(observed) !== JSON.stringify(qualification)) {
    throw new Error('e1/authority-qualification-readback-mismatch');
  }
  verifiedBuilds.set(inspected.built, plan);
  return inspected.built;
}

function replaceAuthority(plan, built, workDirectory, spawn) {
  if (!plan.deploymentAllowed || plan.mode !== 'replace' || verifiedBuilds.get(built) !== plan) {
    throw new Error('e1/authority-unverified-build');
  }
  verifiedBuilds.delete(built);
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

function executeBuild(plan, receiptPath, options = {}) {
  const spawn = options.spawn || spawnSync;
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-build-'));
  fs.chmodSync(workDirectory, 0o700);
  let stagedSource;
  try {
    stagedSource = stagePinnedSource(plan);
    return submitAuthorityBuild(plan, stagedSource, workDirectory, receiptPath, spawn);
  } finally {
    if (stagedSource) fs.rmSync(stagedSource, { recursive: true, force: true });
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

function executeQualification(plan, receiptPath, qualificationPath, options = {}) {
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-qualify-'));
  fs.chmodSync(workDirectory, 0o700);
  try {
    return qualifyAuthorityBuild(plan, receiptPath, qualificationPath, workDirectory, options.spawn || spawnSync);
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

function executeReplacement(plan, receiptPath, qualificationPath, approvedQualificationSha256, options = {}) {
  const qualification = readPrivateJson(qualificationPath);
  if (!/^[a-f0-9]{64}$/u.test(approvedQualificationSha256 || '')) {
    throw new Error('e1/authority-qualification-approval-required');
  }
  if (qualification.qualificationSha256 !== approvedQualificationSha256) {
    throw new Error('e1/authority-qualification-approval-mismatch');
  }
  const spawn = options.spawn || spawnSync;
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-replace-'));
  fs.chmodSync(workDirectory, 0o700);
  try {
    const built = requalifyAuthorityBuild(plan, receiptPath, qualificationPath, workDirectory, spawn);
    return replaceAuthority(plan, built, workDirectory, spawn);
  } finally {
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
  if (mode === 'build') return executeBuild(plan, args.receipt, options);
  if (mode === 'qualify') return executeQualification(plan, args.receipt, args.qualification, options);
  if (mode === 'replace') return executeReplacement(plan, args.receipt, args.qualification,
    args['approved-qualification-sha256'], options);
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
  LEGACY_MISSING_FALSE_ENVIRONMENT,
  PROVIDER_SUBJECT_KEY_CONTRACT,
  REQUIRED_INACTIVE_ENVIRONMENT,
  argumentsMap,
  cloudBuildConfig,
  environment,
  executeBuild,
  executeQualification,
  executeReplacement,
  inactiveEnvironmentValid,
  inspectAuthorityBuild,
  prepareBuildSource,
  qualifyAuthorityBuild,
  providerSubjectKeyVersions,
  providerSubjectKeyEnvironmentValid,
  inactiveServiceSpec,
  readPrivateJson,
  requalifyAuthorityBuild,
  replaceAuthority,
  run,
  submitAuthorityBuild,
  verifyAuthorityIam,
  verifyBuildArchive,
  verifyAuthorityService,
  writePrivateJson
});
