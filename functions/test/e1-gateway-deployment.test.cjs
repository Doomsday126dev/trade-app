'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
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

function runPlan(cwd, source = 'functions/e1-gateway', expectedSha = HEAD) {
  return spawnSync(process.execPath, [CLI, '--mode=plan', '--action=restore', `--source=${source}`, `--expected-sha=${expectedSha}`], {
    cwd,
    encoding: 'utf8'
  });
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
  assert.equal(rootPlan.sourceFingerprint, '09f05caf0624da66f69e37bf34e75e4594a7ef225594f10954b8523400a3729d');
  assert.deepEqual(otherPlan, rootPlan);
  assert.equal(fs.existsSync(rootIgnore), false);
});

test('explicit source and expected pushed commit are mandatory', () => {
  const missing = spawnSync(process.execPath, [CLI, '--mode=plan', '--action=restore', `--expected-sha=${HEAD}`], {
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
    action: 'restore', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
    manifest, resourceManifest, repository: repositoryFixture(manifest)
  });
  const environment = deploymentArguments(plan, plan.functions[0], '/tmp/pinned-source')
    .find((value) => value.startsWith('--set-env-vars='));
  assert.match(environment, /E1_AUTHORITY_URL=https:\/\/e1-identity-authority-wrywkbfzya-uc\.a\.run\.app\//u);
  assert.match(environment, /E1_AUTHORITY_AUDIENCE=https:\/\/e1-identity-authority-wrywkbfzya-uc\.a\.run\.app(?:,|$)/u);
  assert.doesNotMatch(environment, /e1-identity-authority-production-uc/u);
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
    action: 'restore', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
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
    readSourceFile: (_commit, file) => file.endsWith('/index.js') ? modified : fs.readFileSync(path.join(REPO_ROOT, file))
  });
  assert.throws(() => verifyPinnedSource(manifest, repository), /export-inventory-mismatch/u);
});

test('staging copies only reviewed files and excludes private local or repository content', () => {
  const manifest = loadManifest();
  const plan = createDeploymentPlan({
    action: 'restore', expectedSha: HEAD, explicitSource: manifest.sourceRoot, mode: 'plan', repoRoot: REPO_ROOT,
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
  const enabled = createDeploymentPlan({ ...common, action: 'enable-group-c' });
  const restored = createDeploymentPlan({ ...common, action: 'restore' });
  assert.equal(enabled.sourceCommitSha, restored.sourceCommitSha);
  assert.equal(enabled.sourceFingerprint, restored.sourceFingerprint);
  assert.equal(enabled.authorityOrigin, restored.authorityOrigin);
  assert.equal(enabled.authorityUrl, restored.authorityUrl);
  assert.equal(enabled.authorityAudience, restored.authorityAudience);
  assert.equal(enabled.authorityAudience, EXPECTED_AUTHORITY.origin);
  assert.equal(enabled.gateEnabled, true);
  assert.equal(restored.gateEnabled, false);
  const enableArgs = deploymentArguments(enabled, enabled.functions[0], '/tmp/pinned-source');
  const restoreArgs = deploymentArguments(restored, restored.functions[0], '/tmp/pinned-source');
  assert.deepEqual(enableArgs.filter((value) => !value.startsWith('--set-env-vars=')),
    restoreArgs.filter((value) => !value.startsWith('--set-env-vars=')));
  assert.match(enableArgs.find((value) => value.startsWith('--set-env-vars=')), /GATEWAY_INVOCATION_ENABLED=true/u);
  assert.match(restoreArgs.find((value) => value.startsWith('--set-env-vars=')), /GATEWAY_INVOCATION_ENABLED=false/u);
  assert.ok(enableArgs.includes('--source=/tmp/pinned-source'));
});

test('deploy mode rejects any tracked worktree change while plan mode remains mutation-free', () => {
  const manifest = loadManifest();
  const repository = repositoryFixture(manifest, { trackedStatus: () => ' M package.json' });
  const common = { action: 'restore', expectedSha: HEAD, explicitSource: manifest.sourceRoot, repoRoot: REPO_ROOT, manifest, repository };
  assert.equal(createDeploymentPlan({ ...common, mode: 'plan' }).deploymentAllowed, false);
  assert.throws(() => createDeploymentPlan({ ...common, mode: 'deploy' }), /working-tree-dirty/u);
});
