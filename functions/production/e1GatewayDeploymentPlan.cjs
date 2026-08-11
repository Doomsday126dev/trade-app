'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-gateway-source-manifest.json');
const ACTIONS = Object.freeze({
  'enable-group-c': true,
  restore: false
});
const PRIVATE_PATH_PATTERNS = Object.freeze([
  /(^|\/)\.local(\/|$)/u,
  /(^|\/)\.env(?:\.|$)/u,
  /readiness/iu,
  /reviewed-subject/iu,
  /credential/iu,
  /token/iu,
  /private[_-]?key/iu
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceFingerprint(files) {
  const canonical = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\0${file.sha256}\n`)
    .join('');
  return sha256(canonical);
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('..') ||
      PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error('e1/gateway-source-path-invalid');
  }
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyManifestShape(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.environment !== 'production' ||
      manifest.projectId !== 'trade-list-a4297' || manifest.region !== 'us-central1' ||
      manifest.sourceRoot !== 'functions/e1-gateway' || !/^[0-9a-f]{40}$/u.test(manifest.sourceCommitSha || '') ||
      !/^[0-9a-f]{64}$/u.test(manifest.sourceFingerprint || '') || !Array.isArray(manifest.sourceFiles) ||
      manifest.sourceFiles.length !== 4 || manifest.entrypointFile !== 'index.js' ||
      !sameValues(manifest.expectedExports, ['readE1AccountFoundation', 'reserveE1TrainerHandle']) ||
      manifest.runtime !== 'nodejs22' || manifest.runtimeServiceAccount !==
        'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com' ||
      manifest.appCheckMode !== 'monitor' || manifest.rateLimitPolicy !== 'firestore-rolling-v1') {
    throw new Error('e1/gateway-source-manifest-invalid');
  }
  const paths = manifest.sourceFiles.map((file) => file.path);
  if (!sameValues(paths, ['gatewayCore.js', 'index.js', 'package-lock.json', 'package.json']) ||
      manifest.sourceFiles.some((file) => !/^[0-9a-f]{64}$/u.test(file.sha256 || ''))) {
    throw new Error('e1/gateway-source-file-inventory-invalid');
  }
  manifest.sourceFiles.forEach((file) => assertSafeRelativePath(file.path));
  if (sourceFingerprint(manifest.sourceFiles) !== manifest.sourceFingerprint) {
    throw new Error('e1/gateway-source-fingerprint-invalid');
  }
  return manifest;
}

function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}

function resolveRepositoryRoot(anchor = __dirname) {
  return commandOutput('git', ['-C', anchor, 'rev-parse', '--show-toplevel']);
}

function createGitRepository(repoRoot) {
  const git = (...args) => commandOutput('git', ['-C', repoRoot, ...args]);
  return Object.freeze({
    head: () => git('rev-parse', 'HEAD'),
    originMain: () => git('rev-parse', 'origin/main'),
    trackedStatus: () => git('status', '--porcelain', '--untracked-files=no'),
    sourceStatus: (sourceRoot) => git('status', '--porcelain', '--untracked-files=no', '--', sourceRoot),
    sourceFiles: (commit, sourceRoot) => git('ls-tree', '-r', '--name-only', commit, '--', sourceRoot)
      .split('\n').filter(Boolean),
    readSourceFile: (commit, relativePath) => execFileSync('git', [
      '-C', repoRoot, 'show', `${commit}:${relativePath}`
    ])
  });
}

function exportsFromSource(source) {
  return [...source.toString('utf8').matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)].map((match) => match[1]);
}

function verifyPinnedSource(manifest, repository) {
  const expectedPaths = manifest.sourceFiles.map((file) => `${manifest.sourceRoot}/${file.path}`);
  const actualPaths = repository.sourceFiles(manifest.sourceCommitSha, manifest.sourceRoot);
  if (!sameValues(actualPaths, expectedPaths)) throw new Error('e1/gateway-pinned-file-inventory-mismatch');
  const observed = manifest.sourceFiles.map((file) => {
    const contents = repository.readSourceFile(manifest.sourceCommitSha, `${manifest.sourceRoot}/${file.path}`);
    return { ...file, contents, observedSha256: sha256(contents) };
  });
  if (observed.some((file) => file.sha256 !== file.observedSha256)) {
    throw new Error('e1/gateway-pinned-source-hash-mismatch');
  }
  const entrypoint = observed.find((file) => file.path === manifest.entrypointFile);
  if (!entrypoint || !sameValues(exportsFromSource(entrypoint.contents), manifest.expectedExports)) {
    throw new Error('e1/gateway-export-inventory-mismatch');
  }
  return observed;
}

function createDeploymentPlan(options = {}) {
  const manifest = verifyManifestShape(options.manifest || loadManifest(options.manifestPath));
  const repoRoot = options.repoRoot || resolveRepositoryRoot();
  const explicitSource = options.explicitSource;
  if (!explicitSource) throw new Error('e1/gateway-explicit-source-required');
  const resolvedSource = path.resolve(repoRoot, explicitSource);
  const expectedSource = path.resolve(repoRoot, manifest.sourceRoot);
  if (resolvedSource !== expectedSource) throw new Error('e1/gateway-explicit-source-mismatch');
  if (!fs.existsSync(resolvedSource)) throw new Error('e1/gateway-source-missing');
  if (!Object.hasOwn(ACTIONS, options.action)) throw new Error('e1/gateway-action-invalid');
  if (!/^[0-9a-f]{40}$/u.test(options.expectedSha || '')) throw new Error('e1/gateway-expected-sha-invalid');

  const repository = options.repository || createGitRepository(repoRoot);
  const head = repository.head();
  const originMain = repository.originMain();
  if (head !== options.expectedSha || originMain !== options.expectedSha) throw new Error('e1/gateway-commit-mismatch');
  if (repository.sourceStatus(manifest.sourceRoot)) throw new Error('e1/gateway-source-dirty');
  const pinnedFiles = verifyPinnedSource(manifest, repository);
  const trackedWorkingTreeClean = repository.trackedStatus() === '';
  const deploymentAllowed = trackedWorkingTreeClean;
  if (options.mode === 'deploy' && !deploymentAllowed) throw new Error('e1/gateway-working-tree-dirty');

  return Object.freeze({
    action: options.action,
    project: manifest.projectId,
    region: manifest.region,
    functions: Object.freeze([...manifest.expectedExports]),
    runtime: manifest.runtime,
    runtimeServiceAccount: manifest.runtimeServiceAccount,
    sourceRoot: manifest.sourceRoot,
    sourcePath: expectedSource,
    sourceCommitSha: manifest.sourceCommitSha,
    sourceFingerprint: manifest.sourceFingerprint,
    sourceFiles: Object.freeze(pinnedFiles),
    expectedExports: Object.freeze([...manifest.expectedExports]),
    gateEnabled: ACTIONS[options.action],
    trackedWorkingTreeClean,
    deploymentAllowed,
    manifest: Object.freeze(manifest)
  });
}

function stagePinnedSource(plan, options = {}) {
  const temporaryRoot = options.temporaryRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'e1-gateway-source-'));
  fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  for (const file of plan.sourceFiles) {
    assertSafeRelativePath(file.path);
    const destination = path.join(temporaryRoot, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.contents, { mode: 0o600 });
  }
  const stagedFiles = fs.readdirSync(temporaryRoot).sort();
  if (!sameValues(stagedFiles, plan.manifest.sourceFiles.map((file) => file.path).sort())) {
    throw new Error('e1/gateway-staged-source-inventory-mismatch');
  }
  return temporaryRoot;
}

function deploymentArguments(plan, functionName, stagedSource) {
  const manifest = plan.manifest;
  const environment = [
    'APP_ENVIRONMENT=production',
    `FIREBASE_PROJECT_ID=${manifest.projectId}`,
    `SERVICE_REGION=${manifest.region}`,
    `E1_AUTHORITY_URL=${manifest.authorityUrl}`,
    `E1_AUTHORITY_AUDIENCE=${manifest.authorityAudience}`,
    `E1_GATEWAY_SERVICE_ACCOUNT=${manifest.runtimeServiceAccount}`,
    `GATEWAY_INVOCATION_ENABLED=${plan.gateEnabled}`,
    `APP_CHECK_ENFORCEMENT_MODE=${manifest.appCheckMode}`,
    'APP_CHECK_DEBUG_TOKENS_ALLOWED=false',
    `E1_RATE_LIMIT_POLICY=${manifest.rateLimitPolicy}`
  ].join(',');
  return [
    'functions', 'deploy', functionName, '--gen2', `--project=${manifest.projectId}`,
    `--region=${manifest.region}`, `--runtime=${manifest.runtime}`, `--source=${stagedSource}`,
    `--entry-point=${functionName}`, '--trigger-http', '--allow-unauthenticated',
    `--service-account=${manifest.runtimeServiceAccount}`, `--memory=${manifest.memory}`,
    `--timeout=${manifest.timeoutSeconds}s`, `--max-instances=${manifest.maxInstances}`,
    `--concurrency=${manifest.concurrency}`, `--set-env-vars=${environment}`, '--quiet'
  ];
}

function publicPlan(plan) {
  return Object.freeze({
    mode: 'plan',
    action: plan.action,
    project: plan.project,
    region: plan.region,
    functions: plan.functions,
    runtime: plan.runtime,
    runtimeServiceAccount: plan.runtimeServiceAccount,
    sourceRoot: plan.sourceRoot,
    sourceCommitSha: plan.sourceCommitSha,
    sourceFingerprint: plan.sourceFingerprint,
    expectedExports: plan.expectedExports,
    gateEnabled: plan.gateEnabled,
    trackedWorkingTreeClean: plan.trackedWorkingTreeClean,
    deploymentAllowed: plan.deploymentAllowed
  });
}

module.exports = Object.freeze({
  ACTIONS,
  MANIFEST_PATH,
  PRIVATE_PATH_PATTERNS,
  createDeploymentPlan,
  createGitRepository,
  deploymentArguments,
  exportsFromSource,
  loadManifest,
  publicPlan,
  resolveRepositoryRoot,
  sha256,
  sourceFingerprint,
  stagePinnedSource,
  verifyManifestShape,
  verifyPinnedSource
});
