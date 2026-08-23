'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ENABLE_CONFIRMATION: D3_ENABLE_CONFIRMATION,
  RESTORE_CONFIRMATION: D3_RESTORE_CONFIRMATION
} = require('./e1ProductionThirdMutationGuard.cjs');
const {
  CONTINUATION_PRODUCTION_RUNTIME,
  EXECUTION_EVIDENCE_PURPOSE,
  SYNTHETIC_COHORT_TYPE,
  continuationProgress
} = require('./e1ProductionThirdMutationContract.cjs');
const { activationGatePlan, disabledGatePlan } = require('./e1ProductionFirstMutationGuard.cjs');
const {
  ENABLE_CONFIRMATION: GROUP_E_ENABLE_CONFIRMATION,
  RESTORE_CONFIRMATION: GROUP_E_RESTORE_CONFIRMATION
} = require('./e1ProductionClientFoundationGuard.cjs');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-gateway-source-manifest.json');
const RESOURCE_MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const EXPECTED_AUTHORITY = Object.freeze({
  projectId: 'trade-list-a4297',
  region: 'us-central1',
  service: 'e1-identity-authority',
  origin: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app'
});
const ACTIONS = Object.freeze({
  'enable-group-c': Object.freeze({ approvalGroup: 'C', cohortStage: 'read-proof', gateEnabled: true, readProofMode: true }),
  'restore-group-c': Object.freeze({ approvalGroup: 'C', cohortStage: 'read-proof', gateEnabled: false, readProofMode: false }),
  'enable-group-d1': Object.freeze({ approvalGroup: 'D', cohortStage: 'D1', gateEnabled: true, readProofMode: false }),
  'restore-group-d1': Object.freeze({ approvalGroup: 'D', cohortStage: 'D1', gateEnabled: false, readProofMode: false }),
  'enable-group-d2': Object.freeze({ approvalGroup: 'D', cohortStage: 'D2', gateEnabled: true, readProofMode: false }),
  'restore-group-d2': Object.freeze({ approvalGroup: 'D', cohortStage: 'D2', gateEnabled: false, readProofMode: false }),
  'enable-group-d3': Object.freeze({ approvalGroup: 'D', cohortStage: 'D3', gateEnabled: true, readProofMode: false }),
  'restore-group-d3': Object.freeze({ approvalGroup: 'D', cohortStage: 'D3', gateEnabled: false, readProofMode: false }),
  'enable-group-e': Object.freeze({ approvalGroup: 'E', cohortStage: 'client-foundation-canary', gateEnabled: true, readProofMode: false }),
  'restore-group-e': Object.freeze({ approvalGroup: 'E', cohortStage: 'client-foundation-canary', gateEnabled: false, readProofMode: false })
});
const D3_CONFIRMATIONS = Object.freeze({
  'enable-group-d3': D3_ENABLE_CONFIRMATION,
  'restore-group-d3': D3_RESTORE_CONFIRMATION
});
const ACTION_CONFIRMATIONS = Object.freeze({
  ...D3_CONFIRMATIONS,
  'enable-group-e': GROUP_E_ENABLE_CONFIRMATION,
  'restore-group-e': GROUP_E_RESTORE_CONFIRMATION
});
const D3_MODES = Object.freeze(['clean-start', 'continuation']);
const HASH = /^[a-f0-9]{64}$/u;
const D3_REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const D3_IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const D3_SECURITY_BOUNDARY = Object.freeze({
  authorityPrivate: true,
  gatewayRuntimeSoleAuthorityInvoker: true,
  publicAuthorityInvoker: false,
  projectWideRunInvoker: false,
  gatewayForbiddenRolesPresent: false,
  runtimeIamDrift: false,
  productionDebugTokensRegistered: false
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

function loadResourceManifest(manifestPath = RESOURCE_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function normalizeAuthorityOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('e1/gateway-authority-origin-invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash ||
      !/^e1-identity-authority-[a-z0-9]{10}-uc\.a\.run\.app$/u.test(parsed.hostname)) {
    throw new Error('e1/gateway-authority-origin-invalid');
  }
  return parsed.origin;
}

function authorityTarget(resourceManifest) {
  const project = resourceManifest?.project || {};
  const authority = resourceManifest?.authority || {};
  const origin = normalizeAuthorityOrigin(authority.origin);
  if (resourceManifest?.environment !== 'production' || project.id !== EXPECTED_AUTHORITY.projectId ||
      project.region !== EXPECTED_AUTHORITY.region || authority.service !== EXPECTED_AUTHORITY.service ||
      authority.region !== EXPECTED_AUTHORITY.region || origin !== EXPECTED_AUTHORITY.origin ||
      authority.runtimeServiceAccount !== 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com') {
    throw new Error('e1/gateway-authority-target-mismatch');
  }
  return Object.freeze({ service: authority.service, origin, url: `${origin}/`, audience: origin,
    runtimeServiceAccount: authority.runtimeServiceAccount });
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
      Object.hasOwn(manifest, 'authorityUrl') || Object.hasOwn(manifest, 'authorityAudience') ||
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

function verifyActionGuard(actionName, guardResult, expectedSha, d3Mode, manifest, target) {
  const action = ACTIONS[actionName];
  if (!action) throw new Error('e1/gateway-action-invalid');
  if (!guardResult) return false;
  const commonValid = guardResult.ok === true && guardResult.environment === 'production' &&
    guardResult.targetVerified === true && guardResult.laterGroupsAuthorized === false &&
    guardResult.cloudOperations === 0 && guardResult.approvalGroup === action.approvalGroup;
  let stageValid = action.cohortStage === 'read-proof' || action.cohortStage === 'D1'
    ? !Object.hasOwn(guardResult, 'cohortStage')
    : guardResult.cohortStage === action.cohortStage && guardResult.groupEAuthorized === false &&
      guardResult.candidateCount === (action.cohortStage === 'D3' ? 5 : 2) &&
      guardResult.sequentialExecutionRequired === true;
  if (action.cohortStage === 'D3') {
    const commonD3 = D3_MODES.includes(d3Mode) && guardResult.subjectsBound === true &&
      guardResult.executionAuthorized === true && guardResult.cohortType === SYNTHETIC_COHORT_TYPE &&
      guardResult.evidencePurpose === EXECUTION_EVIDENCE_PURPOSE && guardResult.browserHarnessVerified === true &&
      guardResult.sourceSha === expectedSha && guardResult.toolingSourceSha === expectedSha &&
      guardResult.entryEvidenceFreshAtEnable === true && guardResult.entryEvidenceRequiredAfterEnable === false &&
      guardResult.mutationWindowGovernsPostEnable === true &&
      Number.isFinite(Date.parse(guardResult.entryEvidenceExpiresAt)) &&
      Number.isFinite(Date.parse(guardResult.mutationWindowEnd)) &&
      JSON.stringify(guardResult.startingGates) === JSON.stringify(disabledGatePlan()) &&
      JSON.stringify(guardResult.activationGatePlan) === JSON.stringify(activationGatePlan()) &&
      JSON.stringify(guardResult.restorationGatePlan) === JSON.stringify(disabledGatePlan()) &&
      JSON.stringify(guardResult.securityBoundary) === JSON.stringify(D3_SECURITY_BOUNDARY) &&
      guardResult.runtimeProvenance?.authorityService === target.service &&
      guardResult.runtimeProvenance?.authorityOrigin === target.origin &&
      D3_REVISION.test(guardResult.runtimeProvenance?.authorityRevision || '') &&
      D3_IMAGE_DIGEST.test(guardResult.runtimeProvenance?.authorityImageDigest || '') &&
      guardResult.runtimeProvenance?.runtimeServiceAccount === target.runtimeServiceAccount &&
      guardResult.runtimeProvenance?.gatewayServiceAccount === manifest.runtimeServiceAccount &&
      guardResult.runtimeProvenance?.reviewed === true;
    const cleanStart = d3Mode === 'clean-start' && guardResult.deploymentMode === 'clean-start' &&
      !Object.hasOwn(guardResult, 'continuationArtifactDigest') &&
      !Object.hasOwn(guardResult, 'continuationJitDigest');
    let continuation = false;
    if (d3Mode === 'continuation' && guardResult.deploymentMode === 'continuation' &&
        Number.isInteger(guardResult.completedSuffixOperations)) {
      let progress;
      try { progress = continuationProgress(guardResult.completedSuffixOperations); } catch { progress = null; }
      continuation = progress?.complete === false && guardResult.mode === 'authoritative-exact-prefix-continuation' &&
        guardResult.currentStateVerified === true && guardResult.historicalAdmissionVerified === true &&
        guardResult.currentDocumentCount === progress.currentDocumentCount &&
        guardResult.historicalEvidenceRecollectionRequired === false &&
        JSON.stringify(guardResult.nextOperation) === JSON.stringify(progress.nextOperation) &&
        JSON.stringify(guardResult.remainingSequence) === JSON.stringify(progress.remainingSequence) &&
        JSON.stringify(guardResult.expectedCountSequence) === JSON.stringify(progress.expectedCountSequence) &&
        JSON.stringify(guardResult.acceptedUsage) === JSON.stringify(progress.acceptedUsage) &&
        JSON.stringify(guardResult.remainingBudget) === JSON.stringify(progress.remainingBudget) &&
        JSON.stringify(guardResult.productionRuntime) === JSON.stringify(CONTINUATION_PRODUCTION_RUNTIME) &&
        HASH.test(guardResult.continuationArtifactDigest || '') &&
        HASH.test(guardResult.continuationPreflightDigest || '') && HASH.test(guardResult.continuationJitDigest || '');
    }
    stageValid = stageValid && commonD3 && (cleanStart || continuation);
  }
  if (action.cohortStage === 'client-foundation-canary') {
    const expectedEnabled = action.gateEnabled;
    stageValid = guardResult.cohortStage === 'client-foundation-canary' && guardResult.cohortSize === 2 &&
      guardResult.groupEAuthorized === true && guardResult.executionAuthorized === true &&
      guardResult.toolingSourceSha === undefined && guardResult.provenance?.toolingSourceSha === expectedSha &&
      guardResult.budget?.applicationWrites === 0 && guardResult.budget?.firestoreWrites === 0 &&
      guardResult.budget?.rtdbWrites === 0 && guardResult.budget?.processLocalCounterAuthoritative === false &&
      guardResult.budget?.authoritativeReconciliationRequired === true &&
      JSON.stringify(guardResult.activationGatePlan) === JSON.stringify({
        ...disabledGatePlan(), CLIENT_FOUNDATION_USE_ENABLED: true, GATEWAY_INVOCATION_ENABLED: true,
        READ_ACCOUNT_FOUNDATION_ENABLED: true
      }) && JSON.stringify(guardResult.restorationGatePlan) === JSON.stringify(disabledGatePlan()) &&
      (!expectedEnabled || guardResult.entryEvidenceExpiresAt);
  }
  if (!commonValid || !stageValid) throw new Error('e1/gateway-action-guard-mismatch');
  return true;
}

function createDeploymentPlan(options = {}) {
  const manifest = verifyManifestShape(options.manifest || loadManifest(options.manifestPath));
  const target = authorityTarget(options.resourceManifest || loadResourceManifest(options.resourceManifestPath));
  const repoRoot = options.repoRoot || resolveRepositoryRoot();
  if (fs.existsSync(path.join(repoRoot, '.gcloudignore'))) {
    throw new Error('e1/repository-root-gcloudignore-present');
  }
  const explicitSource = options.explicitSource;
  if (!explicitSource) throw new Error('e1/gateway-explicit-source-required');
  const resolvedSource = path.resolve(repoRoot, explicitSource);
  const expectedSource = path.resolve(repoRoot, manifest.sourceRoot);
  if (resolvedSource !== expectedSource) throw new Error('e1/gateway-explicit-source-mismatch');
  if (!fs.existsSync(resolvedSource)) throw new Error('e1/gateway-source-missing');
  if (!Object.hasOwn(ACTIONS, options.action)) throw new Error('e1/gateway-action-invalid');
  const action = ACTIONS[options.action];
  if (Object.hasOwn(ACTION_CONFIRMATIONS, options.action) && options.confirmation !== ACTION_CONFIRMATIONS[options.action]) {
    throw new Error(options.action.includes('group-e') ? 'e1/gateway-group-e-confirmation-invalid' : 'e1/gateway-d3-confirmation-invalid');
  }
  if (!/^[0-9a-f]{40}$/u.test(options.expectedSha || '')) throw new Error('e1/gateway-expected-sha-invalid');
  const d3Mode = options.d3Mode;
  if (action.cohortStage === 'D3' && action.gateEnabled && options.mode === 'deploy' && !D3_MODES.includes(d3Mode)) {
    throw new Error('e1/gateway-d3-mode-required');
  }
  if (action.cohortStage === 'D3' && options.guardResult && !D3_MODES.includes(d3Mode)) {
    throw new Error('e1/gateway-d3-mode-required');
  }
  const guardVerified = verifyActionGuard(options.action, options.guardResult, options.expectedSha, d3Mode, manifest, target);

  const repository = options.repository || createGitRepository(repoRoot);
  const head = repository.head();
  const originMain = repository.originMain();
  if (head !== options.expectedSha || originMain !== options.expectedSha) throw new Error('e1/gateway-commit-mismatch');
  if (repository.sourceStatus(manifest.sourceRoot)) throw new Error('e1/gateway-source-dirty');
  const pinnedFiles = verifyPinnedSource(manifest, repository);
  const trackedWorkingTreeClean = repository.trackedStatus() === '';
  const deploymentAllowed = trackedWorkingTreeClean && (!action.gateEnabled || guardVerified);
  if (options.mode === 'deploy' && !trackedWorkingTreeClean) throw new Error('e1/gateway-working-tree-dirty');
  if (options.mode === 'deploy' && action.gateEnabled && !guardVerified) {
    throw new Error('e1/gateway-action-guard-required');
  }

  return Object.freeze({
    action: options.action,
    project: manifest.projectId,
    region: manifest.region,
    functions: Object.freeze([...manifest.expectedExports]),
    runtime: manifest.runtime,
    runtimeServiceAccount: manifest.runtimeServiceAccount,
    authorityOrigin: target.origin,
    authorityUrl: target.url,
    authorityAudience: target.audience,
    sourceRoot: manifest.sourceRoot,
    sourcePath: expectedSource,
    sourceCommitSha: manifest.sourceCommitSha,
    sourceFingerprint: manifest.sourceFingerprint,
    sourceFiles: Object.freeze(pinnedFiles),
    expectedExports: Object.freeze([...manifest.expectedExports]),
    approvalGroup: action.approvalGroup,
    cohortStage: action.cohortStage,
    d3Mode: action.cohortStage === 'D3' ? d3Mode || null : null,
    toolingSourceSha: options.expectedSha,
    productionRuntime: options.guardResult?.productionRuntime || null,
    authorityRuntime: ['D3', 'client-foundation-canary'].includes(action.cohortStage) && options.guardResult ? Object.freeze({
      service: options.guardResult.runtimeProvenance?.authorityService || 'e1-identity-authority',
      origin: options.guardResult.runtimeProvenance?.authorityOrigin || target.origin,
      revision: options.guardResult.runtimeProvenance?.authorityRevision || options.guardResult.provenance?.authorityRevision,
      imageDigest: options.guardResult.runtimeProvenance?.authorityImageDigest || options.guardResult.provenance?.authorityImageDigest,
      runtimeServiceAccount: options.guardResult.runtimeProvenance?.runtimeServiceAccount || target.runtimeServiceAccount,
      securityBoundary: options.guardResult.securityBoundary || null
    }) : null,
    guardVerified,
    containmentRestore: !action.gateEnabled && !guardVerified,
    gateEnabled: action.gateEnabled,
    readProofMode: action.readProofMode,
    entryEvidenceExpiresAt: action.cohortStage === 'D3' && action.gateEnabled
      ? options.guardResult?.entryEvidenceExpiresAt || null : null,
    entryEvidenceRequiredAfterEnable: action.cohortStage === 'D3' && action.gateEnabled
      ? options.guardResult?.entryEvidenceRequiredAfterEnable ?? null : null,
    mutationWindowEnd: action.cohortStage === 'D3' && action.gateEnabled
      ? options.guardResult?.mutationWindowEnd || null : null,
    mutationWindowGovernsPostEnable: action.cohortStage === 'D3' && action.gateEnabled
      ? options.guardResult?.mutationWindowGovernsPostEnable ?? null : null,
    groupEClientMode: action.cohortStage === 'client-foundation-canary' && action.gateEnabled ? 'synthetic-canary' : 'disabled',
    groupEBindings: action.cohortStage === 'client-foundation-canary' && action.gateEnabled
      ? Object.values(options.guardResult?.bindings || {}).map((binding) => `${binding.uidHash}:${binding.trainerHash}`).join(';') : null,
    groupECohortDigest: action.cohortStage === 'client-foundation-canary' && action.gateEnabled
      ? options.guardResult?.cohortDigest || null : null,
    groupEWindowStart: action.cohortStage === 'client-foundation-canary' && action.gateEnabled
      ? options.guardResult?.activationWindowStart || null : null,
    groupEWindowEnd: action.cohortStage === 'client-foundation-canary' && action.gateEnabled
      ? options.guardResult?.activationWindowEnd || null : null,
    confirmationValidated: Object.hasOwn(ACTION_CONFIRMATIONS, options.action),
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

function verifyStagedSource(plan, stagedSource) {
  const resolved = path.resolve(stagedSource || '');
  const repositoryFunctionsRoot = path.dirname(plan.sourcePath);
  const repositoryRoot = path.dirname(repositoryFunctionsRoot);
  if (!path.isAbsolute(stagedSource || '') || resolved === repositoryRoot || resolved === repositoryFunctionsRoot ||
      resolved.startsWith(`${repositoryFunctionsRoot}${path.sep}`)) {
    throw new Error('e1/gateway-staged-source-path-invalid');
  }
  const observed = fs.readdirSync(resolved).sort();
  const expected = plan.manifest.sourceFiles.map((file) => file.path).sort();
  if (!sameValues(observed, expected)) throw new Error('e1/gateway-staged-source-inventory-mismatch');
  for (const file of plan.manifest.sourceFiles) {
    if (sha256(fs.readFileSync(path.join(resolved, file.path))) !== file.sha256) {
      throw new Error('e1/gateway-staged-source-hash-mismatch');
    }
  }
  return resolved;
}

function deploymentArguments(plan, functionName, stagedSource) {
  const verifiedSource = verifyStagedSource(plan, stagedSource);
  const manifest = plan.manifest;
  const environment = [
    'APP_ENVIRONMENT=production',
    `FIREBASE_PROJECT_ID=${manifest.projectId}`,
    `SERVICE_REGION=${manifest.region}`,
    `E1_AUTHORITY_URL=${plan.authorityUrl}`,
    `E1_AUTHORITY_AUDIENCE=${plan.authorityAudience}`,
    `E1_GATEWAY_SERVICE_ACCOUNT=${manifest.runtimeServiceAccount}`,
    `GATEWAY_INVOCATION_ENABLED=${plan.gateEnabled}`,
    `READ_PROOF_MODE=${plan.readProofMode}`,
    `GROUP_E_CLIENT_MODE=${plan.groupEClientMode}`,
    ...(plan.groupEClientMode === 'synthetic-canary' ? [
      `GROUP_E_SUBJECT_BINDINGS=${plan.groupEBindings}`,
      `GROUP_E_COHORT_DIGEST=${plan.groupECohortDigest}`,
      `GROUP_E_WINDOW_START=${plan.groupEWindowStart}`,
      `GROUP_E_WINDOW_END=${plan.groupEWindowEnd}`
    ] : []),
    `APP_CHECK_ENFORCEMENT_MODE=${manifest.appCheckMode}`,
    'APP_CHECK_DEBUG_TOKENS_ALLOWED=false',
    `E1_RATE_LIMIT_POLICY=${manifest.rateLimitPolicy}`
  ].join(',');
  return [
    'functions', 'deploy', functionName, '--gen2', `--project=${manifest.projectId}`,
    `--region=${manifest.region}`, `--runtime=${manifest.runtime}`, `--source=${verifiedSource}`,
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
    authorityOrigin: plan.authorityOrigin,
    authorityUrl: plan.authorityUrl,
    authorityAudience: plan.authorityAudience,
    sourceRoot: plan.sourceRoot,
    sourcePackaging: 'immutable-git-object-staging',
    stagingSourceRoot: '<isolated-temporary-directory>',
    explicitSourceRequired: true,
    repositoryRootGcloudignoreAllowed: false,
    sourceCommitSha: plan.sourceCommitSha,
    sourceFingerprint: plan.sourceFingerprint,
    expectedExports: plan.expectedExports,
    approvalGroup: plan.approvalGroup,
    cohortStage: plan.cohortStage,
    d3Mode: plan.d3Mode,
    toolingSourceSha: plan.toolingSourceSha,
    productionRuntime: plan.productionRuntime,
    guardVerified: plan.guardVerified,
    containmentRestore: plan.containmentRestore,
    gateEnabled: plan.gateEnabled,
    readProofMode: plan.readProofMode,
    groupEClientMode: plan.groupEClientMode,
    entryEvidenceExpiresAt: plan.entryEvidenceExpiresAt,
    entryEvidenceRequiredAfterEnable: plan.entryEvidenceRequiredAfterEnable,
    mutationWindowEnd: plan.mutationWindowEnd,
    mutationWindowGovernsPostEnable: plan.mutationWindowGovernsPostEnable,
    confirmationValidated: plan.confirmationValidated,
    trackedWorkingTreeClean: plan.trackedWorkingTreeClean,
    deploymentAllowed: plan.deploymentAllowed
  });
}

module.exports = Object.freeze({
  ACTIONS,
  ACTION_CONFIRMATIONS,
  D3_CONFIRMATIONS,
  EXPECTED_AUTHORITY,
  MANIFEST_PATH,
  PRIVATE_PATH_PATTERNS,
  RESOURCE_MANIFEST_PATH,
  authorityTarget,
  createDeploymentPlan,
  createGitRepository,
  deploymentArguments,
  exportsFromSource,
  loadManifest,
  loadResourceManifest,
  normalizeAuthorityOrigin,
  publicPlan,
  resolveRepositoryRoot,
  sha256,
  sourceFingerprint,
  stagePinnedSource,
  verifyManifestShape,
  verifyPinnedSource,
  verifyActionGuard,
  verifyStagedSource
});
