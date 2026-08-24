'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  ACTION_CONFIRMATIONS,
  D3_CONFIRMATIONS,
  EXPECTED_AUTHORITY,
  authorityTarget,
  createDeploymentPlan,
  deploymentArguments,
  loadManifest,
  loadResourceManifest,
  normalizeAuthorityOrigin,
  sourceFingerprint,
  stagePinnedSource,
  verifyManifestShape,
  verifyPinnedSource
} = require('../production/e1GatewayDeploymentPlan.cjs');
const { activationGatePlan, disabledGatePlan } = require('../production/e1ProductionFirstMutationGuard.cjs');
const { activationGatePlan: groupEActivationGatePlan } = require('../production/e1ProductionClientFoundationGuard.cjs');
const { keyIdFromSpki } = require('../e1-gateway/groupEAdmission');
const {
  CONTINUATION_ACCEPTED_USAGE,
  CONTINUATION_PRODUCTION_RUNTIME,
  CONTINUATION_REMAINING_BUDGET,
  CONTINUATION_REMAINING_SEQUENCE,
  continuationProgress
} = require('../production/e1ProductionThirdMutationContract.cjs');
const {
  AUTHORITY_GATES,
  argumentsMap,
  authorityReplacement,
  executePlan,
  verifyAuthorityService
} = require('../scripts/deploy-e1-production-gateway.cjs');

const REPO_ROOT = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const ORIGIN_MAIN = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'origin/main'], { encoding: 'utf8' }).trim();
const CLI = path.join(REPO_ROOT, 'functions/scripts/deploy-e1-production-gateway.cjs');
const TEST_COMMIT_A_SOURCE_SHA = '0'.repeat(40);
const TEST_GROUP_E_PUBLIC_KEY_SPKI = crypto.generateKeyPairSync('ed25519').publicKey
  .export({ format: 'der', type: 'spki' }).toString('base64url');
const COMMIT_A_SOURCE_PATHS = Object.freeze([
  'gatewayCore.js', 'groupEAdmission.js', 'groupEControlStore.js', 'index.js', 'package-lock.json', 'package.json'
]);

function candidateManifest(overrides = {}) {
  const sourceFiles = COMMIT_A_SOURCE_PATHS.map((file) => ({
    path: file,
    sha256: crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(REPO_ROOT, 'functions/e1-gateway', file)))
      .digest('hex')
  }));
  return {
    ...loadManifest(),
    sourceCommitSha: TEST_COMMIT_A_SOURCE_SHA,
    sourceFiles,
    sourceFingerprint: sourceFingerprint(sourceFiles),
    ...overrides
  };
}

function assertBranchGuard(...runs) {
  if (HEAD === ORIGIN_MAIN) return false;
  for (const run of runs) {
    assert.equal(run.status, 1);
    assert.match(run.stderr, /commit-mismatch/u);
  }
  return true;
}

function runPlan(cwd, source = 'functions/e1-gateway', expectedSha = HEAD, action = 'restore-group-d2') {
  return spawnSync(process.execPath, [CLI, '--mode=plan', `--action=${action}`, `--source=${source}`, `--expected-sha=${expectedSha}`], {
    cwd,
    encoding: 'utf8'
  });
}

function runD3Plan(cwd, action, confirmation) {
  const args = [CLI, '--mode=plan', `--action=${action}`, '--source=functions/e1-gateway', `--expected-sha=${HEAD}`];
  if (confirmation !== undefined) args.push(`--confirmation=${confirmation}`);
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

function repositoryFixture(manifest, overrides = {}) {
  const contents = Object.fromEntries(manifest.sourceFiles.map((file) => [
    `${manifest.sourceRoot}/${file.path}`,
    fs.readFileSync(path.join(REPO_ROOT, manifest.sourceRoot, file.path))
  ]));
  return {
    head: () => HEAD,
    originMain: () => HEAD,
    trackedStatus: () => '',
    sourceStatus: () => '',
    sourceFiles: () => manifest.sourceFiles.map((file) => `${manifest.sourceRoot}/${file.path}`),
    readSourceFile: (_commit, file) => contents[file],
    ...overrides
  };
}

test('canonical CLI argument names accept numeric segments and reject malformed names', () => {
  const parsed = argumentsMap([
    '--mode=plan',
    '--action=enable-group-d3',
    `--expected-sha=${HEAD}`,
    '--source=functions/e1-gateway',
    `--confirmation=${D3_CONFIRMATIONS['enable-group-d3']}`,
    '--d3-mode=continuation'
  ]);
  assert.deepEqual(parsed, {
    mode: 'plan',
    action: 'enable-group-d3',
    'expected-sha': HEAD,
    source: 'functions/e1-gateway',
    confirmation: D3_CONFIRMATIONS['enable-group-d3'],
    'd3-mode': 'continuation'
  });
  for (const argument of [
    '--D3-mode=continuation',
    '--3d-mode=continuation',
    '--d3_mode=continuation',
    '--d3-mode',
    'd3-mode=continuation',
    '---d3-mode=continuation',
    '--=continuation'
  ]) {
    assert.throws(() => argumentsMap([argument]), /gateway-deployment-argument-invalid/u, argument);
  }
});

test('tracked four-file gateway manifest remains deliberately ineligible until the later Commit B pin', () => {
  const tracked = loadManifest();
  assert.equal(tracked.sourceFiles.length, 4);
  assert.throws(() => verifyManifestShape(tracked), /gateway-source-manifest-invalid/u);
  const preview = candidateManifest();
  assert.equal(verifyManifestShape(preview), preview);
  assert.equal(preview.sourceCommitSha, TEST_COMMIT_A_SOURCE_SHA);
  assert.equal(preview.sourceFiles.length, 6);
});

test('complete canonical continuation CLI inventory reaches an isolated continuation plan', () => {
  const manifest = candidateManifest();
  const parsed = argumentsMap([
    '--mode=plan',
    '--action=enable-group-d3',
    `--expected-sha=${HEAD}`,
    `--source=${manifest.sourceRoot}`,
    `--confirmation=${D3_CONFIRMATIONS['enable-group-d3']}`,
    '--d3-mode=continuation'
  ]);
  const plan = createDeploymentPlan({
    action: parsed.action,
    expectedSha: parsed['expected-sha'],
    explicitSource: parsed.source,
    mode: parsed.mode,
    repoRoot: REPO_ROOT,
    manifest,
    repository: repositoryFixture(manifest),
    guardResult: d3ContinuationGuardResult(),
    confirmation: parsed.confirmation,
    d3Mode: parsed['d3-mode']
  });
  assert.equal(plan.d3Mode, 'continuation');
  assert.equal(plan.guardVerified, true);
  assert.equal(plan.deploymentAllowed, true);
  assert.throws(() => createDeploymentPlan({
    action: parsed.action,
    expectedSha: parsed['expected-sha'],
    explicitSource: parsed.source,
    mode: parsed.mode,
    repoRoot: REPO_ROOT,
    manifest,
    repository: repositoryFixture(manifest),
    guardResult: d3ContinuationGuardResult(),
    confirmation: parsed.confirmation,
    d3Mode: 'clean-start'
  }), /action-guard-mismatch/u);
});

test('plan chooses the exact pinned gateway source independently of cwd and creates no root ignore file', () => {
  const manifest = candidateManifest();
  const rootIgnore = path.join(REPO_ROOT, '.gcloudignore');
  assert.equal(fs.existsSync(rootIgnore), false);
  const options = { action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest) };
  const rootPlan = createDeploymentPlan(options);
  const otherPlan = createDeploymentPlan({ ...options, repository: repositoryFixture(manifest) });
  assert.equal(rootPlan.sourceRoot, 'functions/e1-gateway');
  assert.equal(rootPlan.sourceFingerprint, manifest.sourceFingerprint);
  assert.deepEqual(otherPlan, rootPlan);
  assert.equal(fs.existsSync(rootIgnore), false);
});

test('explicit source and expected pushed commit are mandatory', () => {
  const manifest = candidateManifest();
  const common = { action: 'restore-group-d2', expectedSha: HEAD, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest) };
  assert.throws(() => createDeploymentPlan(common), /explicit-source-required/u);
  assert.throws(() => createDeploymentPlan({ ...common, explicitSource: '.' }), /explicit-source-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, explicitSource: manifest.sourceRoot,
    expectedSha: '1'.repeat(40) }), /commit-mismatch/u);
});

test('manifest fingerprint and pinned source hashes fail closed', () => {
  const manifest = candidateManifest();
  assert.equal(sourceFingerprint(manifest.sourceFiles), manifest.sourceFingerprint);
  assert.throws(() => verifyManifestShape({ ...manifest, sourceFingerprint: '0'.repeat(64) }), /fingerprint-invalid/u);
  const repository = repositoryFixture(manifest, {
    readSourceFile: (_commit, file) => file.endsWith('gatewayCore.js') ? Buffer.from('changed') :
      fs.readFileSync(path.join(REPO_ROOT, file))
  });
  assert.throws(() => verifyPinnedSource(manifest, repository), /pinned-source-hash-mismatch/u);
});

test('production target derives URL and OIDC audience from the reviewed Cloud Run origin', () => {
  const manifest = candidateManifest();
  const resourceManifest = loadResourceManifest();
  const target = authorityTarget(resourceManifest);
  assert.equal(resourceManifest.authority.origin, EXPECTED_AUTHORITY.origin);
  assert.equal(target.origin, 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app');
  assert.equal(target.url, 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/');
  assert.equal(target.audience, target.origin);
  assert.equal(Object.hasOwn(manifest, 'authorityUrl'), false);
  assert.equal(Object.hasOwn(manifest, 'authorityAudience'), false);

  const plan = createDeploymentPlan({
    action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, resourceManifest, repository: repositoryFixture(manifest)
  });
  const staging = stagePinnedSource(plan);
  try {
    const environment = deploymentArguments(plan, plan.functions[0], staging)
      .find((value) => value.startsWith('--set-env-vars='));
    assert.match(environment, /E1_AUTHORITY_URL=https:\/\/e1-identity-authority-wrywkbfzya-uc\.a\.run\.app\//u);
    assert.match(environment, /E1_AUTHORITY_AUDIENCE=https:\/\/e1-identity-authority-wrywkbfzya-uc\.a\.run\.app(?:,|$)/u);
    assert.doesNotMatch(environment, /e1-identity-authority-production-uc/u);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('authority origin normalization is deterministic and stale or unrelated targets fail closed', () => {
  const resourceManifest = loadResourceManifest();
  assert.equal(normalizeAuthorityOrigin(`${EXPECTED_AUTHORITY.origin}/`), EXPECTED_AUTHORITY.origin);
  assert.throws(() => authorityTarget({
    ...resourceManifest, authority: { ...resourceManifest.authority, origin: 'https://e1-identity-authority-production-uc.a.run.app/' }
  }), /authority-target-mismatch/u);
  assert.throws(() => authorityTarget({
    ...resourceManifest, authority: { ...resourceManifest.authority, origin: 'https://example.com' }
  }), /authority-origin-invalid/u);
  assert.throws(() => authorityTarget({
    ...resourceManifest, authority: { ...resourceManifest.authority, origin: `${EXPECTED_AUTHORITY.origin}/health` }
  }), /authority-origin-invalid/u);
  assert.throws(() => authorityTarget({ ...resourceManifest, project: { ...resourceManifest.project, id: 'wrong-project' } }),
    /authority-target-mismatch/u);
  assert.throws(() => authorityTarget({ ...resourceManifest, project: { ...resourceManifest.project, region: 'us-east1' } }),
    /authority-target-mismatch/u);
  assert.throws(() => authorityTarget({
    ...resourceManifest, authority: { ...resourceManifest.authority, service: 'wrong-service' }
  }), /authority-target-mismatch/u);
});

test('dirty tracked gateway source and unexpected tracked gateway files fail closed', () => {
  const manifest = candidateManifest();
  assert.throws(() => createDeploymentPlan({
    action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest, { sourceStatus: () => ' M functions/e1-gateway/index.js' })
  }), /source-dirty/u);
  assert.throws(() => verifyPinnedSource(manifest, repositoryFixture(manifest, {
    sourceFiles: () => [...manifest.sourceFiles.map((file) => `${manifest.sourceRoot}/${file.path}`),
      `${manifest.sourceRoot}/unexpected.js`]
  })), /file-inventory-mismatch/u);
});

test('unexpected gateway exports fail even when a candidate manifest is self-consistent', () => {
  const original = candidateManifest();
  const modified = Buffer.from(`${fs.readFileSync(path.join(REPO_ROOT, original.sourceRoot, 'index.js'), 'utf8')}\nexports.extra = true;\n`);
  const manifest = structuredClone(original);
  const index = manifest.sourceFiles.find((file) => file.path === 'index.js');
  index.sha256 = require('node:crypto').createHash('sha256').update(modified).digest('hex');
  manifest.sourceFingerprint = sourceFingerprint(manifest.sourceFiles);
  verifyManifestShape(manifest);
  const repository = repositoryFixture(manifest, {
    readSourceFile: (_commit, file) => file.endsWith('/index.js') ? modified :
      fs.readFileSync(path.join(REPO_ROOT, file))
  });
  assert.throws(() => verifyPinnedSource(manifest, repository), /export-inventory-mismatch/u);
});

test('staging copies only reviewed files and excludes private local or repository content', () => {
  const manifest = candidateManifest();
  const plan = createDeploymentPlan({
    action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest)
  });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-gateway-stage-test-'));
  try {
    stagePinnedSource(plan, { temporaryRoot: staging });
    assert.deepEqual(fs.readdirSync(staging).sort(), [...COMMIT_A_SOURCE_PATHS]);
    assert.equal(fs.existsSync(path.join(staging, '.local')), false);
    assert.equal(fs.existsSync(path.join(staging, '.env')), false);
    assert.equal(fs.existsSync(path.join(staging, '.gcloudignore')), false);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('Group C enable and restoration use one fingerprint source and differ only in explicit gate state', () => {
  const manifest = candidateManifest();
  const repository = repositoryFixture(manifest);
  const common = { expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT, manifest, repository };
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-c', guardResult: {
    ok: true, approvalGroup: 'C', environment: 'production', targetVerified: true,
    laterGroupsAuthorized: false, cloudOperations: 0
  } });
  const restored = createDeploymentPlan({ ...common, action: 'restore-group-c' });
  assert.equal(enabled.sourceCommitSha, restored.sourceCommitSha);
  assert.equal(enabled.sourceFingerprint, restored.sourceFingerprint);
  assert.equal(enabled.authorityOrigin, restored.authorityOrigin);
  assert.equal(enabled.authorityUrl, restored.authorityUrl);
  assert.equal(enabled.authorityAudience, restored.authorityAudience);
  assert.equal(enabled.authorityAudience, EXPECTED_AUTHORITY.origin);
  assert.equal(enabled.gateEnabled, true);
  assert.equal(restored.gateEnabled, false);
  assert.equal(enabled.readProofMode, true);
  assert.equal(restored.readProofMode, false);
  const staging = stagePinnedSource(enabled);
  try {
    const enableArgs = deploymentArguments(enabled, enabled.functions[0], staging);
    const restoreArgs = deploymentArguments(restored, restored.functions[0], staging);
    assert.deepEqual(enableArgs.filter((value) => !value.startsWith('--set-env-vars=')),
      restoreArgs.filter((value) => !value.startsWith('--set-env-vars=')));
    assert.match(enableArgs.find((value) => value.startsWith('--set-env-vars=')), /GATEWAY_INVOCATION_ENABLED=true/u);
    assert.match(restoreArgs.find((value) => value.startsWith('--set-env-vars=')), /GATEWAY_INVOCATION_ENABLED=false/u);
    assert.match(enableArgs.find((value) => value.startsWith('--set-env-vars=')), /READ_PROOF_MODE=true/u);
    assert.match(restoreArgs.find((value) => value.startsWith('--set-env-vars=')), /READ_PROOF_MODE=false/u);
    assert.ok(enableArgs.includes(`--source=${staging}`));
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('deploy mode rejects any tracked worktree change while plan mode remains mutation-free', () => {
  const manifest = candidateManifest();
  const repository = repositoryFixture(manifest, { trackedStatus: () => ' M package.json' });
  const common = { action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, repoRoot: REPO_ROOT, manifest, repository };
  assert.equal(createDeploymentPlan({ ...common, mode: 'plan' }).deploymentAllowed, false);
  assert.throws(() => createDeploymentPlan({ ...common, mode: 'deploy' }), /working-tree-dirty/u);
});

function d2GuardResult(overrides = {}) {
  return {
    ok: true,
    approvalGroup: 'D',
    cohortStage: 'D2',
    environment: 'production',
    targetVerified: true,
    candidateCount: 2,
    sequentialExecutionRequired: true,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0,
    ...overrides
  };
}

function d3GuardResult(overrides = {}) {
  return {
    ok: true,
    approvalGroup: 'D',
    cohortStage: 'D3',
    cohortType: 'controlled-synthetic-legacy-canary',
    evidencePurpose: 'synthetic-mutation-execution',
    environment: 'production',
    targetVerified: true,
    subjectsBound: true,
    executionAuthorized: true,
    deploymentMode: 'clean-start',
    browserHarnessVerified: true,
    sourceSha: HEAD,
    toolingSourceSha: HEAD,
    runtimeProvenance: {
      authorityService: 'e1-identity-authority',
      authorityOrigin: EXPECTED_AUTHORITY.origin,
      authorityRevision: 'e1-identity-authority-00026-l5s',
      authorityImageDigest: `sha256:${'a'.repeat(64)}`,
      runtimeServiceAccount: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
      gatewayServiceAccount: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
      reviewed: true
    },
    securityBoundary: {
      authorityPrivate: true, gatewayRuntimeSoleAuthorityInvoker: true, publicAuthorityInvoker: false,
      projectWideRunInvoker: false, gatewayForbiddenRolesPresent: false, runtimeIamDrift: false,
      productionDebugTokensRegistered: false
    },
    startingGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    entryEvidenceFreshAtEnable: true,
    entryEvidenceExpiresAt: '2026-08-15T15:10:00.000Z',
    entryEvidenceRequiredAfterEnable: false,
    mutationWindowEnd: '2026-08-15T16:30:00.000Z',
    mutationWindowGovernsPostEnable: true,
    candidateCount: 5,
    sequentialExecutionRequired: true,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0,
    ...overrides
  };
}

function d3ContinuationGuardResult(completedOrOverrides = 0, overrides = {}) {
  const completedSuffixOperations = Number.isInteger(completedOrOverrides) ? completedOrOverrides : 0;
  const finalOverrides = Number.isInteger(completedOrOverrides) ? overrides : completedOrOverrides;
  const progress = continuationProgress(completedSuffixOperations);
  return d3GuardResult({
    deploymentMode: 'continuation',
    mode: 'authoritative-exact-prefix-continuation',
    historicalAdmissionVerified: true,
    currentStateVerified: true,
    historicalEvidenceRecollectionRequired: false,
    completedSuffixOperations,
    currentDocumentCount: progress.currentDocumentCount,
    nextOperation: progress.nextOperation,
    remainingSequence: progress.remainingSequence,
    expectedCountSequence: progress.expectedCountSequence,
    acceptedUsage: progress.acceptedUsage,
    remainingBudget: progress.remainingBudget,
    productionRuntime: CONTINUATION_PRODUCTION_RUNTIME,
    continuationArtifactDigest: 'b'.repeat(64),
    continuationPreflightDigest: 'c'.repeat(64),
    continuationJitDigest: 'd'.repeat(64),
    ...finalOverrides
  });
}

function groupEGuardResult(overrides = {}) {
  return {
    ok: true,
    environment: 'production',
    targetVerified: true,
    approvalGroup: 'E',
    cohortStage: 'client-foundation-canary',
    cohortSize: 2,
    cohortDigest: 'c'.repeat(64),
    bindings: {
      A: { uidHash: 'a'.repeat(64), trainerHash: '1'.repeat(64) },
      B: { uidHash: 'b'.repeat(64), trainerHash: '2'.repeat(64) }
    },
    provenance: {
      toolingSourceSha: HEAD,
      pagesReleaseId: '2030-01-01.99',
      pagesSourceSha: 'e'.repeat(40),
      pagesArtifactDigest: '3'.repeat(64),
      gatewaySourceSha: candidateManifest().sourceCommitSha,
      gatewaySourceFingerprint: candidateManifest().sourceFingerprint,
      authorityRevision: 'e1-identity-authority-00026-l5s',
      authorityImageDigest: `sha256:${'a'.repeat(64)}`
    },
    securityBoundary: {
      authorityPrivate: true, gatewayOnlyInvoker: true, projectWideInvoker: false,
      gatewayForbiddenRolesPresent: false, iamDrift: false, productionDebugTokensRegistered: false,
      providerLinkRoutePresent: false, controlDatabaseRules: 'deny-all'
    },
    budget: {
      expectedBrowserAttempts: 2, expectedGatewayInvocations: 2, expectedAdmittedClaims: 2,
      expectedAuthorityCalls: 2, expectedSuccessfulReads: 2, expectedControlWrites: 6,
      phaseEIdentityWrites: 0, rtdbUserDataWrites: 0, ordinaryUserWrites: 0,
      maxAdmittedA: 1, maxAdmittedB: 1, maxAuthorityCallsAfterA: 1, maxAuthorityCallsAfterB: 1,
      maxSuccessfulReads: 2, authoritativeReplayBoundary: 'e1-group-e-control-create-only-consumption'
    },
    activationGatePlan: groupEActivationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    activationWindowStart: '2030-01-01T12:00:00.000Z',
    activationWindowEnd: '2030-01-01T12:30:00.000Z',
    entryEvidenceExpiresAt: '2030-01-01T12:15:00.000Z',
    executionAuthorized: true,
    executionLedgerDigest: '9'.repeat(64),
    executionStage: 'A_READY',
    nextOperation: 'ENABLE_GATES_AND_COMMIT_A_DISPATCH',
    runId: '123e4567-e89b-42d3-a456-426614174000',
    runManifestDigest: '4'.repeat(64),
    keyId: keyIdFromSpki(TEST_GROUP_E_PUBLIC_KEY_SPKI),
    publicKeySpki: TEST_GROUP_E_PUBLIC_KEY_SPKI,
    firebaseAppIdHash: '5'.repeat(64),
    controlPlaneDeploymentDigest: '6'.repeat(64),
    controlDatabaseId: 'e1-group-e-control',
    groupEAuthorized: true,
    laterGroupsAuthorized: false,
    cloudOperations: 0,
    ...overrides
  };
}

test('D2 enable and restoration use the canonical immutable source and only approved gates differ', () => {
  const manifest = candidateManifest();
  const repository = repositoryFixture(manifest);
  const common = {
    expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT, manifest, repository
  };
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-d2', guardResult: d2GuardResult() });
  const restored = createDeploymentPlan({ ...common, action: 'restore-group-d2' });
  assert.equal(enabled.sourceCommitSha, manifest.sourceCommitSha);
  assert.equal(enabled.sourceCommitSha, restored.sourceCommitSha);
  assert.equal(enabled.sourceFingerprint, manifest.sourceFingerprint);
  assert.equal(enabled.sourceFingerprint, restored.sourceFingerprint);
  assert.deepEqual(enabled.functions, ['readE1AccountFoundation', 'reserveE1TrainerHandle']);
  assert.deepEqual(enabled.functions, restored.functions);
  assert.equal(enabled.authorityUrl, restored.authorityUrl);
  assert.equal(enabled.authorityAudience, restored.authorityAudience);
  assert.equal(enabled.gateEnabled, true);
  assert.equal(restored.gateEnabled, false);
  assert.equal(enabled.readProofMode, false);
  assert.equal(restored.readProofMode, false);
  assert.equal(enabled.guardVerified, true);
  assert.equal(restored.containmentRestore, true);
  const staging = stagePinnedSource(enabled);
  try {
    const enabledArgs = deploymentArguments(enabled, enabled.functions[0], staging);
    const restoredArgs = deploymentArguments(restored, restored.functions[0], staging);
    assert.deepEqual(enabledArgs.filter((value) => !value.startsWith('--set-env-vars=')),
      restoredArgs.filter((value) => !value.startsWith('--set-env-vars=')));
    const enabledEnvironment = enabledArgs.find((value) => value.startsWith('--set-env-vars='));
    const restoredEnvironment = restoredArgs.find((value) => value.startsWith('--set-env-vars='));
    assert.equal(enabledEnvironment.replace('GATEWAY_INVOCATION_ENABLED=true', 'GATEWAY_INVOCATION_ENABLED=false'),
      restoredEnvironment);
    assert.match(enabledEnvironment, /READ_PROOF_MODE=false/u);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('D2 enable fails closed without an exact current D2 guard result', () => {
  const manifest = candidateManifest();
  const common = {
    action: 'enable-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest)
  };
  const preview = createDeploymentPlan(common);
  assert.equal(preview.guardVerified, false);
  assert.equal(preview.deploymentAllowed, false);
  assert.throws(() => createDeploymentPlan({ ...common, mode: 'deploy' }), /action-guard-required/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d2GuardResult({ cohortStage: 'D1' }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d2GuardResult({ ok: false }) }),
    /action-guard-mismatch/u);
  const cli = spawnSync(process.execPath, [CLI, '--mode=plan', '--action=enable-group-d2',
    '--source=functions/e1-gateway', `--expected-sha=${HEAD}`], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /gateway-source-manifest-invalid/u);
});

test('D1 and D2 cannot inherit one another guard while all cohorts share one planner', () => {
  const manifest = candidateManifest();
  const common = {
    expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest)
  };
  const d1 = {
    ok: true, approvalGroup: 'D', environment: 'production', targetVerified: true,
    laterGroupsAuthorized: false, cloudOperations: 0
  };
  assert.doesNotThrow(() => createDeploymentPlan({ ...common, action: 'enable-group-d1', guardResult: d1 }));
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d2', guardResult: d1 }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d1', guardResult: d2GuardResult() }),
    /action-guard-mismatch/u);
});

test('raw cwd-dependent gateway packages and root ignore files fail before gcloud arguments exist', () => {
  const manifest = candidateManifest();
  const plan = createDeploymentPlan({
    action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest)
  });
  assert.throws(() => deploymentArguments(plan, plan.functions[0], REPO_ROOT), /staged-source-path-invalid/u);
  assert.throws(() => deploymentArguments(plan, plan.functions[0], path.join(REPO_ROOT, 'functions')), /staged-source-path-invalid/u);
  const rootIgnore = path.join(REPO_ROOT, '.gcloudignore');
  fs.writeFileSync(rootIgnore, 'temporary test fixture\n');
  try {
    assert.throws(() => createDeploymentPlan({
      action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
      repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest)
    }), /repository-root-gcloudignore-present/u);
  } finally { fs.rmSync(rootIgnore, { force: true }); }
});

test('D2 restore plans are cwd-independent and plan mode never creates root ignore state', () => {
  const rootIgnore = path.join(REPO_ROOT, '.gcloudignore');
  assert.equal(fs.existsSync(rootIgnore), false);
  const root = runPlan(REPO_ROOT);
  const unrelated = runPlan(os.tmpdir());
  assert.equal(root.status, 1);
  assert.equal(unrelated.status, 1);
  assert.match(root.stderr, /gateway-source-manifest-invalid/u);
  assert.match(unrelated.stderr, /gateway-source-manifest-invalid/u);
  assert.equal(fs.existsSync(rootIgnore), false);
});

test('D2 blocked enable previews are also cwd-independent and expose no private guard data', () => {
  const root = runPlan(REPO_ROOT, 'functions/e1-gateway', HEAD, 'enable-group-d2');
  const unrelated = runPlan(os.tmpdir(), 'functions/e1-gateway', HEAD, 'enable-group-d2');
  assert.equal(root.status, 1);
  assert.equal(unrelated.status, 1);
  assert.match(root.stderr, /gateway-source-manifest-invalid/u);
  assert.match(unrelated.stderr, /gateway-source-manifest-invalid/u);
  assert.doesNotMatch(`${root.stdout}${root.stderr}`, /firebaseUid|trainerUsername|requestId|token/iu);
});

test('D3 enable uses the canonical source only with five-subject guard and exact confirmation', () => {
  const manifest = candidateManifest();
  const common = {
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'clean-start'
  };
  const enabled = createDeploymentPlan({ ...common, guardResult: d3GuardResult() });
  assert.equal(enabled.cohortStage, 'D3');
  assert.equal(enabled.guardVerified, true);
  assert.equal(enabled.confirmationValidated, true);
  assert.equal(enabled.gateEnabled, true);
  assert.equal(enabled.readProofMode, false);
  assert.equal(enabled.entryEvidenceExpiresAt, '2026-08-15T15:10:00.000Z');
  assert.equal(enabled.entryEvidenceRequiredAfterEnable, false);
  assert.equal(enabled.mutationWindowEnd, '2026-08-15T16:30:00.000Z');
  assert.equal(enabled.mutationWindowGovernsPostEnable, true);
  assert.equal(enabled.sourceCommitSha, manifest.sourceCommitSha);
  assert.equal(enabled.sourceFingerprint, manifest.sourceFingerprint);
  assert.throws(() => createDeploymentPlan({ ...common, confirmation: 'ENABLE E1 GROUP D2 RESERVE COHORT',
    guardResult: d3GuardResult() }), /d3-confirmation-invalid/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ candidateCount: 4 }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ subjectsBound: false }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common,
    guardResult: d3GuardResult({ cohortType: 'real-world-read-only-compatibility' }) }), /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common,
    guardResult: d3GuardResult({ browserHarnessVerified: false }) }), /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ groupEAuthorized: true }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ sourceSha: '0'.repeat(40) }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common,
    guardResult: d3GuardResult({ entryEvidenceRequiredAfterEnable: true }) }), /action-guard-mismatch/u);
});

test('D3 continuation deployer binds exact guard mode, tooling SHA, production runtime, suffix, and budget', () => {
  const manifest = candidateManifest();
  const common = {
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'continuation'
  };
  const plan = createDeploymentPlan({ ...common, guardResult: d3ContinuationGuardResult() });
  assert.equal(plan.guardVerified, true);
  assert.equal(plan.d3Mode, 'continuation');
  assert.equal(plan.toolingSourceSha, HEAD);
  assert.deepEqual(plan.productionRuntime, CONTINUATION_PRODUCTION_RUNTIME);
  assert.equal(plan.authorityRuntime.revision, 'e1-identity-authority-00026-l5s');
  for (let completed = 0; completed < CONTINUATION_REMAINING_SEQUENCE.length; completed += 1) {
    const progress = continuationProgress(completed);
    const checkpointPlan = createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult(completed) });
    assert.equal(checkpointPlan.guardVerified, true);
    assert.deepEqual(d3ContinuationGuardResult(completed).nextOperation, progress.nextOperation);
    assert.deepEqual(d3ContinuationGuardResult(completed).remainingBudget, progress.remainingBudget);
  }
  assert.throws(() => createDeploymentPlan({ ...common,
    guardResult: d3ContinuationGuardResult(CONTINUATION_REMAINING_SEQUENCE.length) }), /action-guard-mismatch/u);
  const flagOnly = createDeploymentPlan(common);
  assert.equal(flagOnly.guardVerified, false);
  assert.equal(flagOnly.deploymentAllowed, false);
  assert.throws(() => createDeploymentPlan({ ...common, mode: 'deploy' }), /action-guard-required/u);
  for (const [name, result] of [
    ['missing mode', () => createDeploymentPlan({ ...common, d3Mode: undefined,
      guardResult: d3ContinuationGuardResult() })],
    ['clean guard in continuation mode', () => createDeploymentPlan({ ...common, guardResult: d3GuardResult() })],
    ['continuation guard in clean mode', () => createDeploymentPlan({ ...common, d3Mode: 'clean-start',
      guardResult: d3ContinuationGuardResult() })],
    ['wrong tooling source', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ toolingSourceSha: '0'.repeat(40) }) })],
    ['production source drift', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ productionRuntime: {
        ...CONTINUATION_PRODUCTION_RUNTIME, sourceSha: '0'.repeat(40) } }) })],
    ['production artifact drift', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ productionRuntime: {
        ...CONTINUATION_PRODUCTION_RUNTIME, artifactDigest: '0'.repeat(64) } }) })],
    ['starting gate enabled', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ startingGates: {
        ...disabledGatePlan(), RESERVE_HANDLE_ENABLED: true } }) })],
    ['authority isolation drift', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ securityBoundary: {
        ...d3GuardResult().securityBoundary, publicAuthorityInvoker: true } }) })],
    ['A replay retry', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ nextOperation: { slot: 'A', operation: 'exact-replay' } }) })],
    ['B reserve retry', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ nextOperation: { slot: 'B', operation: 'reserve' } }) })],
    ['B replay retry', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ nextOperation: { slot: 'B', operation: 'exact-replay' } }) })],
    ['checkpoint metadata mismatch', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ completedSuffixOperations: 1 }) })],
    ['completed C reserve retry', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult(1, { nextOperation: { slot: 'C', operation: 'reserve' } }) })],
    ['hidden accepted rollover', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ acceptedUsage: {
        ...CONTINUATION_ACCEPTED_USAGE, rateLimitReplayWrites: 0 } }) })],
    ['reordered suffix', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ remainingSequence: [...CONTINUATION_REMAINING_SEQUENCE].reverse() }) })],
    ['expanded budget', () => createDeploymentPlan({ ...common,
      guardResult: d3ContinuationGuardResult({ remainingBudget: {
        ...CONTINUATION_REMAINING_BUDGET, gatewayCalls: 10 } }) })]
  ]) assert.throws(result, /d3-mode-required|action-guard-mismatch/u, name);
});

function authorityServiceFixture(reserveEnabled = false) {
  return {
    metadata: { name: 'e1-identity-authority' },
    status: { url: EXPECTED_AUTHORITY.origin, latestReadyRevisionName: 'e1-identity-authority-00026-l5s' },
    spec: { template: { spec: {
      serviceAccountName: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
      containers: [{ image: `us-central1-docker.pkg.dev/project/authority@sha256:${'a'.repeat(64)}`, env: [
        ['READ_ACCOUNT_FOUNDATION_ENABLED', false], ['RESERVE_HANDLE_ENABLED', reserveEnabled],
        ['REPAIR_FOUNDATION_ENABLED', false], ['APPLY_MIGRATION_ENABLED', false],
        ['FREEZE_CONFLICT_ENABLED', false]
      ].map(([name, value]) => ({ name, value: String(value) })) }]
    } } }
  };
}

test('mocked D3 continuation deployment enables only reserve plus gateway', () => {
  const manifest = candidateManifest();
  const plan = createDeploymentPlan({
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'continuation',
    guardResult: d3ContinuationGuardResult()
  });
  let authority = authorityServiceFixture(false);
  const calls = [];
  const spawn = (_command, args) => {
    calls.push([...args]);
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'describe') {
      return { status: 0, stdout: JSON.stringify(authority), stderr: '' };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'get-iam-policy') {
      return { status: 0, stdout: JSON.stringify({ bindings: [{ role: 'roles/run.invoker',
        members: ['serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com'] }] }), stderr: '' };
    }
    if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
      return { status: 0, stdout: JSON.stringify({ bindings: [{ role: 'roles/firebaseappcheck.tokenVerifier',
        members: ['serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com'] }] }), stderr: '' };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'replace') {
      if (!args.includes('--dry-run')) {
        const spec = JSON.parse(fs.readFileSync(args[3], 'utf8'));
        authority = { ...spec, status: { url: EXPECTED_AUTHORITY.origin,
          latestReadyRevisionName: 'e1-identity-authority-00027-new' } };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'functions' && args[1] === 'deploy') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'functions' && args[1] === 'describe') return { status: 0, stderr: '', stdout: JSON.stringify({
      serviceConfig: { serviceAccountEmail: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
        environmentVariables: { GATEWAY_INVOCATION_ENABLED: String(plan.gateEnabled), READ_PROOF_MODE: 'false' } }
    }) };
    throw new Error(`unexpected mocked command: ${args.join(' ')}`);
  };
  executePlan(plan, { spawn });
  verifyAuthorityService(plan, authority, true);
  const replacements = calls.filter((args) => args[0] === 'run' && args[1] === 'services' && args[2] === 'replace');
  assert.equal(replacements.length, 2);
  assert.equal(calls.filter((args) => args[0] === 'functions' && args[1] === 'deploy').length, 2);
  assert.equal(calls.some((args) => args.includes('functions/.local')), false);
  const enabled = authorityReplacement(authorityServiceFixture(false), true);
  const values = Object.fromEntries(enabled.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry.value]));
  assert.equal(values.RESERVE_HANDLE_ENABLED, 'true');
  assert.deepEqual(Object.entries(values).filter(([name]) => name !== 'RESERVE_HANDLE_ENABLED')
    .map(([, value]) => value), ['false', 'false', 'false', 'false']);
});

test('clean-start D3 execution preserves the original gateway-only deploy behavior', () => {
  const manifest = candidateManifest();
  const plan = createDeploymentPlan({
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'clean-start',
    guardResult: d3GuardResult()
  });
  const calls = [];
  const spawn = (_command, args) => {
    calls.push([...args]);
    if (args[0] === 'functions' && args[1] === 'deploy') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'functions' && args[1] === 'describe') return { status: 0, stderr: '', stdout: JSON.stringify({
      serviceConfig: { serviceAccountEmail: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
        environmentVariables: { GATEWAY_INVOCATION_ENABLED: 'true', READ_PROOF_MODE: 'false' } }
    }) };
    throw new Error(`clean-start invoked an unexpected command: ${args.join(' ')}`);
  };
  executePlan(plan, { spawn });
  assert.equal(calls.filter((args) => args[0] === 'functions' && args[1] === 'deploy').length, 2);
  assert.equal(calls.some((args) => args[0] === 'run'), false);
});

test('mocked D3 continuation deployment restores gateway and authority after enablement failure', () => {
  const manifest = candidateManifest();
  const plan = createDeploymentPlan({
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'continuation',
    guardResult: d3ContinuationGuardResult()
  });
  let authority = authorityServiceFixture(false);
  let gatewayEnabled = false;
  let deploymentAttempts = 0;
  const calls = [];
  const spawn = (_command, args) => {
    calls.push([...args]);
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'describe') {
      return { status: 0, stdout: JSON.stringify(authority), stderr: '' };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'get-iam-policy') {
      return { status: 0, stdout: JSON.stringify({ bindings: [{ role: 'roles/run.invoker',
        members: ['serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com'] }] }), stderr: '' };
    }
    if (args[0] === 'projects' && args[1] === 'get-iam-policy') {
      return { status: 0, stdout: JSON.stringify({ bindings: [{ role: 'roles/firebaseappcheck.tokenVerifier',
        members: ['serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com'] }] }), stderr: '' };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'replace') {
      if (!args.includes('--dry-run')) {
        const spec = JSON.parse(fs.readFileSync(args[3], 'utf8'));
        authority = { ...spec, status: { url: EXPECTED_AUTHORITY.origin,
          latestReadyRevisionName: 'e1-identity-authority-00027-new' } };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'functions' && args[1] === 'deploy') {
      deploymentAttempts += 1;
      if (deploymentAttempts === 1) return { status: 1, stdout: '', stderr: 'contained mock failure' };
      gatewayEnabled = args.find((value) => value.startsWith('--set-env-vars='))
        .includes('GATEWAY_INVOCATION_ENABLED=true');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'functions' && args[1] === 'describe') return { status: 0, stderr: '', stdout: JSON.stringify({
      serviceConfig: { serviceAccountEmail: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
        environmentVariables: { GATEWAY_INVOCATION_ENABLED: String(gatewayEnabled), READ_PROOF_MODE: 'false' } }
    }) };
    throw new Error(`unexpected mocked command: ${args.join(' ')}`);
  };
  assert.throws(() => executePlan(plan, { spawn }), /gateway-deployment-failed/u);
  assert.equal(Object.fromEntries(authority.spec.template.spec.containers[0].env
    .map((entry) => [entry.name, entry.value])).RESERVE_HANDLE_ENABLED, 'false');
  assert.equal(gatewayEnabled, false);
  assert.equal(calls.filter((args) => args[0] === 'run' && args[1] === 'services' && args[2] === 'replace').length, 4);
  assert.equal(deploymentAttempts, 3);
});

test('authority gate-only replacement rejects immutable image drift', () => {
  const service = authorityServiceFixture(true);
  const plan = { authorityOrigin: EXPECTED_AUTHORITY.origin, authorityRuntime: null };
  assert.throws(() => verifyAuthorityService(plan, service, true, {
    expectedImage: `us-central1-docker.pkg.dev/project/authority@sha256:${'b'.repeat(64)}`
  }), /authority-image-drift/u);
});

test('D3 restoration remains available after readiness expiry and preserves immutable source', () => {
  const manifest = candidateManifest();
  const restored = createDeploymentPlan({
    action: 'restore-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['restore-group-d3']
  });
  assert.equal(restored.guardVerified, false);
  assert.equal(restored.containmentRestore, true);
  assert.equal(restored.gateEnabled, false);
  assert.equal(restored.readProofMode, false);
  assert.equal(restored.entryEvidenceExpiresAt, null);
  assert.equal(restored.mutationWindowEnd, null);
  assert.equal(restored.confirmationValidated, true);
  assert.equal(restored.deploymentAllowed, true);
  assert.equal(restored.sourceCommitSha, manifest.sourceCommitSha);
  assert.equal(restored.sourceFingerprint, manifest.sourceFingerprint);
  assert.throws(() => createDeploymentPlan({
    action: 'restore-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest)
  }), /d3-confirmation-invalid/u);
});

test('D3 deployment CLI fails closed at the deliberately stale source pin before any readiness path', () => {
  const restore = runD3Plan(os.tmpdir(), 'restore-group-d3', D3_CONFIRMATIONS['restore-group-d3']);
  const enable = runD3Plan(REPO_ROOT, 'enable-group-d3', D3_CONFIRMATIONS['enable-group-d3']);
  const missing = runD3Plan(REPO_ROOT, 'restore-group-d3');
  const wrong = runD3Plan(REPO_ROOT, 'enable-group-d3', D3_CONFIRMATIONS['restore-group-d3']);
  for (const result of [restore, enable, missing, wrong]) {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /gateway-source-manifest-invalid/u);
  }
});

test('D1, D2, and D3 guards cannot authorize another cohort', () => {
  const manifest = candidateManifest();
  const common = {
    expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest)
  };
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d2', guardResult: d3GuardResult() }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d3',
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], d3Mode: 'clean-start',
    guardResult: d2GuardResult() }), /action-guard-mismatch/u);
});

test('Group E enable and restore plans are exact cohort-bound zero-write containment actions', () => {
  const manifest = candidateManifest();
  const common = { expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest) };
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-e', guardResult: groupEGuardResult(),
    confirmation: ACTION_CONFIRMATIONS['enable-group-e'] });
  const restored = createDeploymentPlan({ ...common, action: 'restore-group-e',
    confirmation: ACTION_CONFIRMATIONS['restore-group-e'] });
  assert.equal(enabled.guardVerified, true);
  assert.equal(enabled.groupEClientMode, 'synthetic-canary');
  assert.equal(groupEActivationGatePlan().CLIENT_FOUNDATION_USE_ENABLED,false);
  assert.equal(groupEActivationGatePlan().GATEWAY_INVOCATION_ENABLED,true);
  assert.equal(groupEActivationGatePlan().READ_ACCOUNT_FOUNDATION_ENABLED,true);
  assert.equal(enabled.groupECohortDigest, 'c'.repeat(64));
  assert.match(enabled.groupEBindings, /^[a-f0-9]{64}:[a-f0-9]{64};[a-f0-9]{64}:[a-f0-9]{64}$/u);
  assert.equal(restored.groupEClientMode, 'disabled');
  assert.equal(restored.groupEBindings, null);
  assert.equal(restored.containmentRestore, true);
  assert.equal(restored.sourceCommitSha, enabled.sourceCommitSha);
  assert.equal(restored.sourceFingerprint, enabled.sourceFingerprint);
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-e', guardResult: d3GuardResult(),
    confirmation: ACTION_CONFIRMATIONS['enable-group-e'] }), /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-e', guardResult: groupEGuardResult(),
    confirmation: 'ENABLE E1 GROUP D3 RESERVE COHORT' }), /group-e-confirmation-invalid/u);
});

test('Group E staged gateway arguments carry private hashes only while restore removes them', () => {
  const manifest = candidateManifest();
  const common = { expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest) };
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-e', guardResult: groupEGuardResult(),
    confirmation: ACTION_CONFIRMATIONS['enable-group-e'] });
  const restored = createDeploymentPlan({ ...common, action: 'restore-group-e',
    confirmation: ACTION_CONFIRMATIONS['restore-group-e'] });
  const staging = stagePinnedSource(enabled);
  try {
    const enableArgs = deploymentArguments(enabled, 'readE1AccountFoundation', staging).join(' ');
    const restoreArgs = deploymentArguments(restored, 'readE1AccountFoundation', staging).join(' ');
    assert.match(enableArgs, /GROUP_E_CLIENT_MODE=synthetic-canary/u);
    assert.match(enableArgs, /GROUP_E_SUBJECT_BINDINGS=[a-f0-9]{64}:[a-f0-9]{64};/u);
    assert.match(enableArgs, /GROUP_E_COHORT_DIGEST=[a-f0-9]{64}/u);
    assert.match(restoreArgs, /GROUP_E_CLIENT_MODE=disabled/u);
    assert.doesNotMatch(restoreArgs, /GROUP_E_SUBJECT_BINDINGS|GROUP_E_COHORT_DIGEST|GROUP_E_WINDOW_/u);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('Group E authority replacement enables only read and restore strips private cohort values', () => {
  const plan = { cohortStage: 'client-foundation-canary', groupEBindings: `${'a'.repeat(64)}:${'1'.repeat(64)};${'b'.repeat(64)}:${'2'.repeat(64)}`,
    groupECohortDigest: 'c'.repeat(64), groupEWindowStart: '2030-01-01T12:00:00.000Z',
    groupEWindowEnd: '2030-01-01T12:30:00.000Z' };
  const enabled = authorityReplacement(authorityServiceFixture(false), true, plan);
  const enabledEnv = Object.fromEntries(enabled.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry.value]));
  assert.equal(enabledEnv.READ_ACCOUNT_FOUNDATION_ENABLED, 'true');
  assert.deepEqual(Object.fromEntries(['RESERVE_HANDLE_ENABLED','REPAIR_FOUNDATION_ENABLED','APPLY_MIGRATION_ENABLED',
    'FREEZE_CONFLICT_ENABLED'].map((name) => [name, enabledEnv[name]])), {
    RESERVE_HANDLE_ENABLED:'false',REPAIR_FOUNDATION_ENABLED:'false',APPLY_MIGRATION_ENABLED:'false',FREEZE_CONFLICT_ENABLED:'false'
  });
  assert.equal(enabledEnv.GROUP_E_CLIENT_MODE, 'synthetic-canary');
  const restored = authorityReplacement(enabled, false, plan);
  const restoredEnv = Object.fromEntries(restored.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry.value]));
  assert.equal(restoredEnv.GROUP_E_CLIENT_MODE, 'disabled');
  assert.equal(Object.hasOwn(restoredEnv, 'GROUP_E_SUBJECT_BINDINGS'), false);
  assert.deepEqual(Object.fromEntries(AUTHORITY_GATES.map((name) => [name, restoredEnv[name]])),
    Object.fromEntries(AUTHORITY_GATES.map((name) => [name, 'false'])));
});

test('tracked scripts expose only the canonical gateway deploy entrypoint', () => {
  const scripts = spawnSync('rg', [
    '-n', 'gcloud functions deploy', 'functions/scripts', 'functions/production',
    '-g', '!functions/.local/**'
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(scripts.status, 1, scripts.stderr);
  assert.equal(scripts.stdout.trim(), '');
  const deploySource = fs.readFileSync(CLI, 'utf8');
  assert.match(deploySource, /stagePinnedSource\(plan\)/u);
  assert.match(deploySource, /deploymentArguments\(plan, functionName, stagedSource\)/u);
  assert.match(deploySource, /guardProductionThirdMutationContinuation\(\{ expectedSourceSha \}\)/u);
  assert.match(deploySource, /args\['d3-mode'\]/u);
  assert.match(deploySource,/plan\.cohortStage === 'client-foundation-canary' \? 'group-e' : 'd3'/u);
  assert.match(deploySource,/e1\/\$\{scope\}-containment-restore-failed/u);
  assert.doesNotMatch(deploySource, /gcloud['"`]?,\s*\[['"`]functions['"`],\s*['"`]deploy/u);
});
