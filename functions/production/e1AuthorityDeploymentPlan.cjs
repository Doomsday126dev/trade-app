'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-authority-source-manifest.json');
const RESOURCE_MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const DEPLOY_CONFIRMATION = 'DEPLOY INACTIVE E1 GROUP E AUTHORITY';
const COMMIT_A_SOURCE_SHA = 'ad2edab9be2b1c0e6851dfded3a0f3f71a73b987';
const SOURCE_PATHS = Object.freeze([
  'e1TargetContracts.js',
  'firestoreE1AuthorityAdapter.js',
  'groupEAdmissionReceipt.js',
  'handleNormalization.js',
  'package-lock.json',
  'package.json',
  'readRateLimiters.js',
  'rtdbVerifiedLegacyMappingReader.js',
  'server.js'
]);
const HASH = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const PRIVATE_PATH_PATTERNS = Object.freeze([
  /(^|\/)\.local(\/|$)/u,
  /(^|\/)\.env(?:\.|$)/u,
  /credential/iu,
  /token/iu,
  /private[_-]?key/iu
]);

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceFingerprint(files) {
  return sha256(files.map((file) => `${file.path}\0${file.sha256}\n`).join(''));
}

function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('/') || value.includes('..') ||
      PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error('e1/authority-source-path-invalid');
  }
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function loadResourceManifest(manifestPath = RESOURCE_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyManifestShape(manifest) {
  if (!exactFields(manifest, [
    'schemaVersion', 'environment', 'projectId', 'region', 'service', 'sourceRoot', 'sourceCommitSha',
    'sourceFingerprint', 'sourceFiles', 'entrypointFile', 'packageFile', 'runtimeServiceAccount'
  ]) || manifest.schemaVersion !== 1 || manifest.environment !== 'production' ||
      manifest.projectId !== 'trade-list-a4297' || manifest.region !== 'us-central1' ||
      manifest.service !== 'e1-identity-authority' || manifest.sourceRoot !== 'functions/e1-authority-service' ||
      manifest.sourceCommitSha !== COMMIT_A_SOURCE_SHA || !HASH.test(manifest.sourceFingerprint || '') ||
      !Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length !== SOURCE_PATHS.length ||
      manifest.entrypointFile !== 'server.js' || manifest.packageFile !== 'package.json' ||
      manifest.runtimeServiceAccount !== 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com') {
    throw new Error('e1/authority-source-manifest-invalid');
  }
  if (!sameValues(manifest.sourceFiles.map((file) => file.path), SOURCE_PATHS) ||
      manifest.sourceFiles.some((file) => !exactFields(file, ['path', 'sha256']) || !HASH.test(file.sha256 || ''))) {
    throw new Error('e1/authority-source-file-inventory-invalid');
  }
  manifest.sourceFiles.forEach((file) => assertSafeRelativePath(file.path));
  if (sourceFingerprint(manifest.sourceFiles) !== manifest.sourceFingerprint) {
    throw new Error('e1/authority-source-fingerprint-invalid');
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
    main: () => git('rev-parse', 'main'),
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

function verifyPackageShape(observed, manifest) {
  const byPath = Object.fromEntries(observed.map((file) => [file.path, file.contents]));
  let packageJson;
  let packageLock;
  try {
    packageJson = JSON.parse(byPath[manifest.packageFile].toString('utf8'));
    packageLock = JSON.parse(byPath['package-lock.json'].toString('utf8'));
  } catch {
    throw new Error('e1/authority-package-invalid');
  }
  const rootPackage = packageLock?.packages?.[''];
  if (packageJson.name !== 'trainer-hub-e1-identity-authority-shell' || packageJson.private !== true ||
      packageJson.scripts?.start !== `node ${manifest.entrypointFile}` || packageJson.engines?.node !== '>=24' ||
      packageLock.name !== packageJson.name || packageLock.lockfileVersion !== 3 ||
      JSON.stringify(rootPackage?.dependencies) !== JSON.stringify(packageJson.dependencies) ||
      !byPath[manifest.entrypointFile].includes(Buffer.from("http.createServer", 'utf8'))) {
    throw new Error('e1/authority-package-invalid');
  }
  return true;
}

function verifyPinnedSource(manifest, repository) {
  const expectedPaths = manifest.sourceFiles.map((file) => `${manifest.sourceRoot}/${file.path}`);
  const actualPaths = repository.sourceFiles(manifest.sourceCommitSha, manifest.sourceRoot);
  if (!sameValues(actualPaths, expectedPaths)) throw new Error('e1/authority-pinned-file-inventory-mismatch');
  const observed = manifest.sourceFiles.map((file) => {
    const contents = repository.readSourceFile(manifest.sourceCommitSha, `${manifest.sourceRoot}/${file.path}`);
    return Object.freeze({ ...file, contents, observedSha256: sha256(contents) });
  });
  if (observed.some((file) => file.sha256 !== file.observedSha256)) {
    throw new Error('e1/authority-pinned-source-hash-mismatch');
  }
  verifyPackageShape(observed, manifest);
  return observed;
}

function authorityTarget(resourceManifest) {
  const project = resourceManifest?.project || {};
  const authority = resourceManifest?.authority || {};
  const build = resourceManifest?.build || {};
  const firestore = resourceManifest?.firestore || {};
  const legacyRtdb = resourceManifest?.legacyRtdb || {};
  if (resourceManifest?.schemaVersion !== 1 || resourceManifest.environment !== 'production' ||
      project.id !== 'trade-list-a4297' || project.number !== '1053781218847' || project.numberReviewed !== true ||
      project.region !== 'us-central1' || authority.service !== 'e1-identity-authority' ||
      authority.origin !== 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app' ||
      authority.runtimeServiceAccount !== 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com' ||
      authority.private !== true || authority.region !== project.region ||
      build.builderServiceAccount !== 'e1-authority-builder@trade-list-a4297.iam.gserviceaccount.com' ||
      build.deployerServiceAccount !== 'e1-authority-deployer@trade-list-a4297.iam.gserviceaccount.com' ||
      build.artifactRepository !== 'e1-authority' || firestore.databaseId !== 'phase-e-identity' ||
      legacyRtdb.url !== 'https://trade-list-a4297-default-rtdb.firebaseio.com') {
    throw new Error('e1/authority-production-target-invalid');
  }
  return Object.freeze({
    projectId: project.id,
    projectNumber: project.number,
    region: project.region,
    service: authority.service,
    origin: authority.origin,
    runtimeServiceAccount: authority.runtimeServiceAccount,
    builderServiceAccount: build.builderServiceAccount,
    builderServiceAccountResource: `projects/${project.id}/serviceAccounts/${build.builderServiceAccount}`,
    deployerServiceAccount: build.deployerServiceAccount,
    artifactRepository: build.artifactRepository,
    imageUri: `${project.region}-docker.pkg.dev/${project.id}/${build.artifactRepository}/${authority.service}`,
    databaseId: firestore.databaseId,
    rtdbDatabaseUrl: legacyRtdb.url
  });
}

function createDeploymentPlan(options = {}) {
  const manifest = verifyManifestShape(options.manifest || loadManifest(options.manifestPath));
  const target = authorityTarget(options.resourceManifest || loadResourceManifest(options.resourceManifestPath));
  const repoRoot = options.repoRoot || resolveRepositoryRoot();
  if (fs.existsSync(path.join(repoRoot, '.gcloudignore'))) {
    throw new Error('e1/repository-root-gcloudignore-present');
  }
  if (!['plan', 'deploy'].includes(options.mode)) throw new Error('e1/authority-deployment-mode-invalid');
  if (!GIT_SHA.test(options.expectedSha || '')) throw new Error('e1/authority-expected-sha-invalid');
  const resolvedSource = path.resolve(repoRoot, options.explicitSource || '');
  const expectedSource = path.resolve(repoRoot, manifest.sourceRoot);
  if (!options.explicitSource || resolvedSource !== expectedSource) {
    throw new Error('e1/authority-explicit-source-mismatch');
  }
  if (!fs.existsSync(expectedSource)) throw new Error('e1/authority-source-missing');
  if (options.mode === 'deploy' && options.confirmation !== DEPLOY_CONFIRMATION) {
    throw new Error('e1/authority-deployment-confirmation-invalid');
  }
  const repository = options.repository || createGitRepository(repoRoot);
  if (repository.head() !== options.expectedSha || repository.main() !== options.expectedSha ||
      repository.originMain() !== options.expectedSha) {
    throw new Error('e1/authority-tooling-ref-mismatch');
  }
  if (repository.sourceStatus(manifest.sourceRoot)) throw new Error('e1/authority-source-dirty');
  const sourceFiles = verifyPinnedSource(manifest, repository);
  const trackedWorkingTreeClean = repository.trackedStatus() === '';
  if (options.mode === 'deploy' && !trackedWorkingTreeClean) throw new Error('e1/authority-working-tree-dirty');
  return Object.freeze({
    mode: options.mode,
    toolingSourceSha: options.expectedSha,
    sourceRoot: manifest.sourceRoot,
    sourcePath: expectedSource,
    sourceCommitSha: manifest.sourceCommitSha,
    sourceFingerprint: manifest.sourceFingerprint,
    sourceFiles: Object.freeze(sourceFiles),
    manifest: Object.freeze(manifest),
    target,
    trackedWorkingTreeClean,
    deploymentAllowed: options.mode === 'deploy' && trackedWorkingTreeClean && options.confirmation === DEPLOY_CONFIRMATION
  });
}

function stagePinnedSource(plan, options = {}) {
  const temporaryRoot = options.temporaryRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-source-'));
  fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(temporaryRoot, 0o700);
  for (const file of plan.sourceFiles) {
    const destination = path.join(temporaryRoot, file.path);
    fs.writeFileSync(destination, file.contents, { mode: 0o600 });
  }
  verifyStagedSource(plan, temporaryRoot);
  return temporaryRoot;
}

function verifyStagedSource(plan, stagedSource) {
  const resolved = path.resolve(stagedSource || '');
  const repositoryRoot = path.dirname(path.dirname(plan.sourcePath));
  if (!path.isAbsolute(stagedSource || '') || resolved === repositoryRoot || resolved === plan.sourcePath ||
      resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('e1/authority-staged-source-path-invalid');
  }
  const observed = fs.readdirSync(resolved, { withFileTypes: true });
  if (observed.some((entry) => !entry.isFile()) ||
      !sameValues(observed.map((entry) => entry.name).sort(), [...SOURCE_PATHS].sort())) {
    throw new Error('e1/authority-staged-source-inventory-mismatch');
  }
  for (const file of plan.manifest.sourceFiles) {
    if (sha256(fs.readFileSync(path.join(resolved, file.path))) !== file.sha256) {
      throw new Error('e1/authority-staged-source-hash-mismatch');
    }
  }
  return resolved;
}

function publicPlan(plan) {
  return Object.freeze({
    mode: plan.mode,
    projectId: plan.target.projectId,
    region: plan.target.region,
    service: plan.target.service,
    origin: plan.target.origin,
    sourceRoot: plan.sourceRoot,
    sourcePackaging: 'immutable-git-object-staging',
    sourceCommitSha: plan.sourceCommitSha,
    sourceFingerprint: plan.sourceFingerprint,
    sourceFiles: plan.manifest.sourceFiles.map((file) => ({ path: file.path, sha256: file.sha256 })),
    builderServiceAccount: plan.target.builderServiceAccount,
    deployerServiceAccount: plan.target.deployerServiceAccount,
    artifactRepository: plan.target.artifactRepository,
    runtimeServiceAccount: plan.target.runtimeServiceAccount,
    databaseId: plan.target.databaseId,
    rtdbDatabaseUrl: plan.target.rtdbDatabaseUrl,
    inactiveOnly: true,
    iamMutations: 0,
    trackedWorkingTreeClean: plan.trackedWorkingTreeClean,
    deploymentAllowed: plan.deploymentAllowed
  });
}

module.exports = Object.freeze({
  COMMIT_A_SOURCE_SHA,
  DEPLOY_CONFIRMATION,
  MANIFEST_PATH,
  PRIVATE_PATH_PATTERNS,
  RESOURCE_MANIFEST_PATH,
  SOURCE_PATHS,
  assertSafeRelativePath,
  authorityTarget,
  createDeploymentPlan,
  createGitRepository,
  loadManifest,
  loadResourceManifest,
  publicPlan,
  resolveRepositoryRoot,
  sha256,
  sourceFingerprint,
  stagePinnedSource,
  verifyManifestShape,
  verifyPackageShape,
  verifyPinnedSource,
  verifyStagedSource
});
