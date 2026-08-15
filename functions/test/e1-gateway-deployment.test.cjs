'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
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

const REPO_ROOT = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const CLI = path.join(REPO_ROOT, 'functions/scripts/deploy-e1-production-gateway.cjs');

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
    execFileSync('git', ['-C', REPO_ROOT, 'show', `${manifest.sourceCommitSha}:${manifest.sourceRoot}/${file.path}`])
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

test('plan chooses the exact pinned gateway source independently of cwd and creates no root ignore file', () => {
  const rootIgnore = path.join(REPO_ROOT, '.gcloudignore');
  assert.equal(fs.existsSync(rootIgnore), false);
  const root = runPlan(REPO_ROOT);
  const other = runPlan(os.tmpdir());
  assert.equal(root.status, 0, root.stderr);
  assert.equal(other.status, 0, other.stderr);
  const rootPlan = JSON.parse(root.stdout);
  const otherPlan = JSON.parse(other.stdout);
  assert.equal(rootPlan.sourceRoot, 'functions/e1-gateway');
  assert.equal(rootPlan.sourceFingerprint, 'd3b999dee62d7498493bc780cff2d2e1f56bf7921826248d9abc4a5a6c9a7713');
  assert.deepEqual(otherPlan, rootPlan);
  assert.equal(fs.existsSync(rootIgnore), false);
});

test('explicit source and expected pushed commit are mandatory', () => {
  const missing = spawnSync(process.execPath, [CLI, '--mode=plan', '--action=restore-group-d2', `--expected-sha=${HEAD}`], {
    cwd: REPO_ROOT, encoding: 'utf8'
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /explicit-source-required/u);
  const repoRootSource = runPlan(REPO_ROOT, '.');
  assert.equal(repoRootSource.status, 1);
  assert.match(repoRootSource.stderr, /explicit-source-mismatch/u);
  const wrongCommit = runPlan(REPO_ROOT, 'functions/e1-gateway', '0'.repeat(40));
  assert.equal(wrongCommit.status, 1);
  assert.match(wrongCommit.stderr, /commit-mismatch/u);
});

test('manifest fingerprint and pinned source hashes fail closed', () => {
  const manifest = loadManifest();
  assert.equal(sourceFingerprint(manifest.sourceFiles), manifest.sourceFingerprint);
  assert.throws(() => verifyManifestShape({ ...manifest, sourceFingerprint: '0'.repeat(64) }), /fingerprint-invalid/u);
  const repository = repositoryFixture(manifest, {
    readSourceFile: (_commit, file) => file.endsWith('gatewayCore.js') ? Buffer.from('changed') :
      fs.readFileSync(path.join(REPO_ROOT, file))
  });
  assert.throws(() => verifyPinnedSource(manifest, repository), /pinned-source-hash-mismatch/u);
});

test('production target derives URL and OIDC audience from the reviewed Cloud Run origin', () => {
  const manifest = loadManifest();
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
  const manifest = loadManifest();
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
  const original = loadManifest();
  const modified = Buffer.from(`${fs.readFileSync(path.join(REPO_ROOT, original.sourceRoot, 'index.js'), 'utf8')}\nexports.extra = true;\n`);
  const manifest = structuredClone(original);
  const index = manifest.sourceFiles.find((file) => file.path === 'index.js');
  index.sha256 = require('node:crypto').createHash('sha256').update(modified).digest('hex');
  manifest.sourceFingerprint = sourceFingerprint(manifest.sourceFiles);
  verifyManifestShape(manifest);
  const repository = repositoryFixture(manifest, {
    readSourceFile: (_commit, file) => file.endsWith('/index.js') ? modified :
      execFileSync('git', ['-C', REPO_ROOT, 'show', `${original.sourceCommitSha}:${file}`])
  });
  assert.throws(() => verifyPinnedSource(manifest, repository), /export-inventory-mismatch/u);
});

test('staging copies only reviewed files and excludes private local or repository content', () => {
  const manifest = loadManifest();
  const plan = createDeploymentPlan({
    action: 'restore-group-d2', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest)
  });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-gateway-stage-test-'));
  try {
    stagePinnedSource(plan, { temporaryRoot: staging });
    assert.deepEqual(fs.readdirSync(staging).sort(), ['gatewayCore.js', 'index.js', 'package-lock.json', 'package.json']);
    assert.equal(fs.existsSync(path.join(staging, '.local')), false);
    assert.equal(fs.existsSync(path.join(staging, '.env')), false);
    assert.equal(fs.existsSync(path.join(staging, '.gcloudignore')), false);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('Group C enable and restoration use one fingerprint source and differ only in explicit gate state', () => {
  const manifest = loadManifest();
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
  const manifest = loadManifest();
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
    environment: 'production',
    targetVerified: true,
    subjectsBound: true,
    executionAuthorized: true,
    candidateCount: 5,
    sequentialExecutionRequired: true,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0,
    ...overrides
  };
}

test('D2 enable and restoration use the canonical immutable source and only approved gates differ', () => {
  const manifest = loadManifest();
  const repository = repositoryFixture(manifest);
  const common = {
    expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT, manifest, repository
  };
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-d2', guardResult: d2GuardResult() });
  const restored = createDeploymentPlan({ ...common, action: 'restore-group-d2' });
  assert.equal(enabled.sourceCommitSha, 'c74d5cb291310f83ff1ec08d032de5bcde3467ba');
  assert.equal(enabled.sourceCommitSha, restored.sourceCommitSha);
  assert.equal(enabled.sourceFingerprint, 'd3b999dee62d7498493bc780cff2d2e1f56bf7921826248d9abc4a5a6c9a7713');
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
  const manifest = loadManifest();
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
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).guardVerified, false);
  assert.equal(JSON.parse(cli.stdout).deploymentAllowed, false);
});

test('D1 and D2 cannot inherit one another guard while all cohorts share one planner', () => {
  const manifest = loadManifest();
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
  const manifest = loadManifest();
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
  assert.equal(root.status, 0, root.stderr);
  assert.equal(unrelated.status, 0, unrelated.stderr);
  assert.deepEqual(JSON.parse(root.stdout), JSON.parse(unrelated.stdout));
  assert.equal(fs.existsSync(rootIgnore), false);
});

test('D2 blocked enable previews are also cwd-independent and expose no private guard data', () => {
  const root = runPlan(REPO_ROOT, 'functions/e1-gateway', HEAD, 'enable-group-d2');
  const unrelated = runPlan(os.tmpdir(), 'functions/e1-gateway', HEAD, 'enable-group-d2');
  assert.equal(root.status, 0, root.stderr);
  assert.equal(unrelated.status, 0, unrelated.stderr);
  const plan = JSON.parse(root.stdout);
  assert.deepEqual(plan, JSON.parse(unrelated.stdout));
  assert.equal(plan.approvalGroup, 'D');
  assert.equal(plan.cohortStage, 'D2');
  assert.equal(plan.guardVerified, false);
  assert.equal(plan.deploymentAllowed, false);
  assert.equal(plan.gateEnabled, true);
  assert.equal(plan.readProofMode, false);
  assert.doesNotMatch(root.stdout, /candidate|firebaseUid|trainerUsername|requestId|token/iu);
});

test('D3 enable uses the canonical source only with five-subject guard and exact confirmation', () => {
  const manifest = loadManifest();
  const common = {
    action: 'enable-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['enable-group-d3']
  };
  const enabled = createDeploymentPlan({ ...common, guardResult: d3GuardResult() });
  assert.equal(enabled.cohortStage, 'D3');
  assert.equal(enabled.guardVerified, true);
  assert.equal(enabled.confirmationValidated, true);
  assert.equal(enabled.gateEnabled, true);
  assert.equal(enabled.readProofMode, false);
  assert.equal(enabled.sourceCommitSha, 'c74d5cb291310f83ff1ec08d032de5bcde3467ba');
  assert.equal(enabled.sourceFingerprint, 'd3b999dee62d7498493bc780cff2d2e1f56bf7921826248d9abc4a5a6c9a7713');
  assert.throws(() => createDeploymentPlan({ ...common, confirmation: 'ENABLE E1 GROUP D2 RESERVE COHORT',
    guardResult: d3GuardResult() }), /d3-confirmation-invalid/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ candidateCount: 4 }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ subjectsBound: false }) }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, guardResult: d3GuardResult({ groupEAuthorized: true }) }),
    /action-guard-mismatch/u);
});

test('D3 restoration remains available after readiness expiry and preserves immutable source', () => {
  const manifest = loadManifest();
  const restored = createDeploymentPlan({
    action: 'restore-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest),
    confirmation: D3_CONFIRMATIONS['restore-group-d3']
  });
  assert.equal(restored.guardVerified, false);
  assert.equal(restored.containmentRestore, true);
  assert.equal(restored.gateEnabled, false);
  assert.equal(restored.readProofMode, false);
  assert.equal(restored.confirmationValidated, true);
  assert.equal(restored.deploymentAllowed, true);
  assert.equal(restored.sourceCommitSha, manifest.sourceCommitSha);
  assert.equal(restored.sourceFingerprint, manifest.sourceFingerprint);
  assert.throws(() => createDeploymentPlan({
    action: 'restore-group-d3', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan',
    repoRoot: REPO_ROOT, manifest, repository: repositoryFixture(manifest)
  }), /d3-confirmation-invalid/u);
});

test('D3 deployment CLI requires exact confirmation and keeps enable fail-closed without private readiness', () => {
  const restore = runD3Plan(os.tmpdir(), 'restore-group-d3', D3_CONFIRMATIONS['restore-group-d3']);
  assert.equal(restore.status, 0, restore.stderr);
  const restorePlan = JSON.parse(restore.stdout);
  assert.equal(restorePlan.cohortStage, 'D3');
  assert.equal(restorePlan.containmentRestore, true);
  assert.equal(restorePlan.confirmationValidated, true);
  const enable = runD3Plan(REPO_ROOT, 'enable-group-d3', D3_CONFIRMATIONS['enable-group-d3']);
  assert.equal(enable.status, 0, enable.stderr);
  assert.equal(JSON.parse(enable.stdout).guardVerified, false);
  assert.equal(JSON.parse(enable.stdout).deploymentAllowed, false);
  const missing = runD3Plan(REPO_ROOT, 'restore-group-d3');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /d3-confirmation-invalid/u);
  const wrong = runD3Plan(REPO_ROOT, 'enable-group-d3', D3_CONFIRMATIONS['restore-group-d3']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /d3-confirmation-invalid/u);
});

test('D1, D2, and D3 guards cannot authorize another cohort', () => {
  const manifest = loadManifest();
  const common = {
    expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, repository: repositoryFixture(manifest)
  };
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d2', guardResult: d3GuardResult() }),
    /action-guard-mismatch/u);
  assert.throws(() => createDeploymentPlan({ ...common, action: 'enable-group-d3',
    confirmation: D3_CONFIRMATIONS['enable-group-d3'], guardResult: d2GuardResult() }), /action-guard-mismatch/u);
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
  assert.doesNotMatch(deploySource, /gcloud['"`]?,\s*\[['"`]functions['"`],\s*['"`]deploy/u);
});
