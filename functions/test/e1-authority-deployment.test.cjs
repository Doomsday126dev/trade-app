'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  COMMIT_A_SOURCE_SHA,
  DEPLOY_CONFIRMATION,
  SOURCE_PATHS,
  authorityTarget,
  createDeploymentPlan,
  loadManifest,
  loadResourceManifest,
  sourceFingerprint,
  stagePinnedSource,
  verifyManifestShape,
  verifyPinnedSource,
  verifyStagedSource
} = require('../production/e1AuthorityDeploymentPlan.cjs');
const {
  GROUP_E_PRIVATE_ENVIRONMENT,
  REQUIRED_INACTIVE_ENVIRONMENT,
  argumentsMap,
  executePlan,
  inactiveEnvironmentValid,
  inactiveServiceSpec,
  run,
  verifyAuthorityIam,
  verifyAuthorityService
} = require('../scripts/deploy-e1-production-authority.cjs');

const REPO_ROOT = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const IMAGE_DIGEST = `sha256:${'a'.repeat(64)}`;
const NEXT_IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;

function immutableGitRepository(overrides = {}) {
  return {
    head: () => HEAD,
    main: () => HEAD,
    originMain: () => HEAD,
    trackedStatus: () => '',
    sourceStatus: () => '',
    sourceFiles: (commit, sourceRoot) => execFileSync('git', [
      '-C', REPO_ROOT, 'ls-tree', '-r', '--name-only', commit, '--', sourceRoot
    ], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    readSourceFile: (commit, file) => execFileSync('git', ['-C', REPO_ROOT, 'show', `${commit}:${file}`]),
    ...overrides
  };
}

function planFixture(mode = 'plan', overrides = {}) {
  const manifest = overrides.manifest || loadManifest();
  return createDeploymentPlan({
    mode,
    expectedSha: HEAD,
    explicitSource: manifest.sourceRoot,
    confirmation: mode === 'deploy' ? DEPLOY_CONFIRMATION : undefined,
    repoRoot: REPO_ROOT,
    manifest,
    resourceManifest: loadResourceManifest(),
    repository: overrides.repository || immutableGitRepository(),
    ...overrides
  });
}

function serviceFixture({ imageDigest = IMAGE_DIGEST, revision = 'e1-identity-authority-00052-abc' } = {}) {
  return {
    metadata: {
      name: 'e1-identity-authority',
      resourceVersion: 'private-server-value',
      annotations: { 'run.googleapis.com/ingress': 'internal-and-cloud-load-balancing' }
    },
    spec: {
      template: {
        metadata: { annotations: {
          'autoscaling.knative.dev/maxScale': '2',
          'run.googleapis.com/sources': 'private-source-record'
        } },
        spec: {
          serviceAccountName: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
          containerConcurrency: 1,
          timeoutSeconds: 30,
          containers: [{
            image: `us-central1-docker.pkg.dev/trade-list-a4297/e1-authority/e1-identity-authority@${imageDigest}`,
            env: [
              { name: 'APP_ENVIRONMENT', value: 'production' },
              { name: 'FIREBASE_PROJECT_ID', value: 'trade-list-a4297' },
              { name: 'FIREBASE_WEB_API_KEY', valueFrom: { secretKeyRef: { name: 'existing-secret', key: 'latest' } } },
              ...Object.entries(REQUIRED_INACTIVE_ENVIRONMENT).map(([name, value]) => ({ name, value }))
            ]
          }]
        }
      }
    },
    status: {
      url: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
      latestReadyRevisionName: revision,
      conditions: [{ type: 'Ready', status: 'True' }],
      traffic: [{ revisionName: revision, percent: 100 }]
    }
  };
}

function gatewayOnlyIam() {
  return { bindings: [{ role: 'roles/run.invoker', members: [
    'serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com'
  ] }] };
}

test('authority manifest pins the exact nine-file immutable Commit A source', () => {
  const manifest = loadManifest();
  assert.equal(verifyManifestShape(manifest), manifest);
  assert.equal(manifest.sourceCommitSha, COMMIT_A_SOURCE_SHA);
  assert.deepEqual(manifest.sourceFiles.map((file) => file.path), [...SOURCE_PATHS]);
  const observed = verifyPinnedSource(manifest, immutableGitRepository());
  assert.equal(observed.length, 9);
  assert.equal(observed.every((file) => file.sha256 === file.observedSha256), true);
  assert.equal(sourceFingerprint(manifest.sourceFiles), '1f28539b8486c05f31bd0922b282945ba809ff3a88622d2fa10383f9e2d76f69');
});

test('authority manifest rejects missing extra reordered changed private and wrong-commit source', () => {
  const manifest = loadManifest();
  const omitted = structuredClone(manifest);
  omitted.sourceFiles.pop();
  omitted.sourceFingerprint = sourceFingerprint(omitted.sourceFiles);
  assert.throws(() => verifyManifestShape(omitted), /manifest-invalid/u);

  const extra = structuredClone(manifest);
  extra.sourceFiles.push({ path: 'extra.js', sha256: '0'.repeat(64) });
  extra.sourceFingerprint = sourceFingerprint(extra.sourceFiles);
  assert.throws(() => verifyManifestShape(extra), /manifest-invalid/u);

  const reordered = structuredClone(manifest);
  [reordered.sourceFiles[0], reordered.sourceFiles[1]] = [reordered.sourceFiles[1], reordered.sourceFiles[0]];
  assert.throws(() => verifyManifestShape(reordered), /file-inventory-invalid/u);
  assert.throws(() => verifyManifestShape({ ...manifest, sourceCommitSha: 'f'.repeat(40) }), /manifest-invalid/u);

  const privatePath = structuredClone(manifest);
  privatePath.sourceFiles[0].path = '.env';
  privatePath.sourceFingerprint = sourceFingerprint(privatePath.sourceFiles);
  assert.throws(() => verifyManifestShape(privatePath), /file-inventory-invalid/u);

  for (const changedFile of manifest.sourceFiles) {
    assert.throws(() => verifyPinnedSource(manifest, immutableGitRepository({
      readSourceFile: (commit, file) => {
        const value = execFileSync('git', ['-C', REPO_ROOT, 'show', `${commit}:${file}`]);
        if (!file.endsWith(`/${changedFile.path}`)) return value;
        const changed = Buffer.from(value);
        changed[0] ^= 1;
        return changed;
      }
    })), /pinned-source-hash-mismatch/u, changedFile.path);
  }
});

test('authority plan uses Git objects and rejects working-tree source substitution', () => {
  const manifest = loadManifest();
  assert.throws(() => planFixture('plan', { repository: immutableGitRepository({
    sourceStatus: () => ' M functions/e1-authority-service/server.js'
  }) }), /source-dirty/u);
  assert.throws(() => verifyPinnedSource(manifest, immutableGitRepository({
    sourceFiles: () => [...manifest.sourceFiles.map((file) => `${manifest.sourceRoot}/${file.path}`),
      `${manifest.sourceRoot}/working-tree-extra.js`]
  })), /file-inventory-mismatch/u);
});

test('authority source staging is isolated exact hash-verified and CWD-independent', () => {
  const before = process.cwd();
  const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-cwd-'));
  const plan = planFixture();
  let staging;
  try {
    process.chdir(unrelated);
    const otherPlan = planFixture();
    assert.equal(otherPlan.sourceFingerprint, plan.sourceFingerprint);
    staging = stagePinnedSource(otherPlan);
    assert.deepEqual(fs.readdirSync(staging).sort(), [...SOURCE_PATHS].sort());
    assert.equal(verifyStagedSource(otherPlan, staging), staging);
    assert.throws(() => verifyStagedSource(otherPlan, otherPlan.sourcePath), /staged-source-path-invalid/u);
    fs.writeFileSync(path.join(staging, 'server.js'), 'changed');
    assert.throws(() => verifyStagedSource(otherPlan, staging), /staged-source-hash-mismatch/u);
  } finally {
    process.chdir(before);
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(unrelated, { recursive: true, force: true });
  }
});

test('authority production target is loaded exactly from the reviewed resource manifest', () => {
  const target = authorityTarget(loadResourceManifest());
  assert.deepEqual(target, {
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    region: 'us-central1',
    service: 'e1-identity-authority',
    origin: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    runtimeServiceAccount: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
    builderServiceAccount: 'e1-authority-builder@trade-list-a4297.iam.gserviceaccount.com',
    builderServiceAccountResource: 'projects/trade-list-a4297/serviceAccounts/e1-authority-builder@trade-list-a4297.iam.gserviceaccount.com',
    deployerServiceAccount: 'e1-authority-deployer@trade-list-a4297.iam.gserviceaccount.com',
    artifactRepository: 'e1-authority',
    imageUri: 'us-central1-docker.pkg.dev/trade-list-a4297/e1-authority/e1-identity-authority',
    databaseId: 'phase-e-identity',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com'
  });
  const wrong = structuredClone(loadResourceManifest());
  wrong.build.artifactRepository = 'wrong';
  assert.throws(() => authorityTarget(wrong), /production-target-invalid/u);
});

test('plan mode defaults locally stages source and performs zero cloud calls', () => {
  let cloudCalls = 0;
  let output = '';
  const result = run([
    `--expected-sha=${HEAD}`,
    '--source=functions/e1-authority-service'
  ], {
    repoRoot: REPO_ROOT,
    repository: immutableGitRepository({ trackedStatus: () => ' M functions/production/local-candidate.cjs' }),
    manifest: loadManifest(),
    resourceManifest: loadResourceManifest(),
    spawn: () => { cloudCalls += 1; return { status: 1, stdout: '', stderr: '' }; },
    stdout: { write(value) { output += value; } }
  });
  assert.equal(result.mode, 'plan');
  assert.equal(result.sourceCommitSha, COMMIT_A_SOURCE_SHA);
  assert.equal(result.iamMutations, 0);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(cloudCalls, 0);
  assert.doesNotMatch(output, /FIREBASE_WEB_API_KEY|secretKeyRef|private-server-value/u);
});

test('deploy mode requires exact confirmation clean refs and a clean tracked tree', () => {
  assert.deepEqual(argumentsMap(['--mode=deploy', `--expected-sha=${HEAD}`, '--source=functions/e1-authority-service',
    `--confirmation=${DEPLOY_CONFIRMATION}`]), {
    mode: 'deploy', 'expected-sha': HEAD, source: 'functions/e1-authority-service', confirmation: DEPLOY_CONFIRMATION
  });
  assert.throws(() => createDeploymentPlan({
    mode: 'deploy', expectedSha: HEAD, explicitSource: 'functions/e1-authority-service', confirmation: 'wrong',
    repoRoot: REPO_ROOT, repository: immutableGitRepository(), manifest: loadManifest(),
    resourceManifest: loadResourceManifest()
  }), /confirmation-invalid/u);
  assert.throws(() => planFixture('deploy', { repository: immutableGitRepository({ trackedStatus: () => ' M file' }) }),
    /working-tree-dirty/u);
  assert.throws(() => planFixture('plan', { repository: immutableGitRepository({ originMain: () => 'f'.repeat(40) }) }),
    /tooling-ref-mismatch/u);
});

test('authority service and IAM verification fail closed on public runtime or inactive-state drift', () => {
  const plan = planFixture();
  const service = serviceFixture();
  assert.equal(verifyAuthorityService(plan, service), true);
  const wrongRuntime = structuredClone(service);
  wrongRuntime.spec.template.spec.serviceAccountName = 'wrong@example.test';
  assert.throws(() => verifyAuthorityService(plan, wrongRuntime), /runtime-or-inactive-state-invalid/u);
  const enabled = structuredClone(service);
  enabled.spec.template.spec.containers[0].env.find((entry) => entry.name === 'READ_ACCOUNT_FOUNDATION_ENABLED').value = 'true';
  assert.throws(() => verifyAuthorityService(plan, enabled), /runtime-or-inactive-state-invalid/u);

  assert.equal(verifyAuthorityIam(plan, (_command, args) => ({ status: 0, stdout: JSON.stringify(gatewayOnlyIam()) })), true);
  for (const members of [['allUsers'], ['serviceAccount:other@example.test'], [
    'serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com', 'allUsers'
  ]]) {
    assert.throws(() => verifyAuthorityIam(plan, () => ({ status: 0, stdout: JSON.stringify({
      bindings: [{ role: 'roles/run.invoker', members }]
    }) })), /private-iam-invalid/u);
  }
});

test('legacy authority preflight accepts only an absent or false read proof mode', () => {
  const plan = planFixture();
  const absent = serviceFixture();
  absent.spec.template.spec.containers[0].env = absent.spec.template.spec.containers[0].env
    .filter((entry) => entry.name !== 'READ_PROOF_MODE');
  const absentEnvironment = Object.fromEntries(absent.spec.template.spec.containers[0].env
    .map((entry) => [entry.name, String(entry.value ?? '')]));
  assert.equal(inactiveEnvironmentValid(absentEnvironment, { allowLegacyMissingReadProofMode: true }), true);
  assert.equal(verifyAuthorityService(plan, absent, { allowLegacyMissingReadProofMode: true }), true);
  assert.throws(() => verifyAuthorityService(plan, absent), /runtime-or-inactive-state-invalid/u);

  const explicitFalse = serviceFixture();
  assert.equal(verifyAuthorityService(plan, explicitFalse, { allowLegacyMissingReadProofMode: true }), true);
  assert.equal(verifyAuthorityService(plan, explicitFalse), true);

  for (const value of ['true', 'unexpected']) {
    const invalid = serviceFixture();
    invalid.spec.template.spec.containers[0].env
      .find((entry) => entry.name === 'READ_PROOF_MODE').value = value;
    assert.throws(() => verifyAuthorityService(plan, invalid, { allowLegacyMissingReadProofMode: true }),
      /runtime-or-inactive-state-invalid/u);
  }

  const missingOperationGate = structuredClone(absent);
  missingOperationGate.spec.template.spec.containers[0].env =
    missingOperationGate.spec.template.spec.containers[0].env
      .filter((entry) => entry.name !== 'READ_ACCOUNT_FOUNDATION_ENABLED');
  assert.throws(() => verifyAuthorityService(plan, missingOperationGate, {
    allowLegacyMissingReadProofMode: true
  }), /runtime-or-inactive-state-invalid/u);
});

test('inactive authority replacement preserves unrelated configuration and strips all Group E activation values', () => {
  const plan = planFixture();
  const service = serviceFixture();
  const container = service.spec.template.spec.containers[0];
  container.env = container.env.filter((entry) => entry.name !== 'READ_PROOF_MODE');
  container.env.push({ name: 'GROUP_E_RUN_ID', value: 'private-run' });
  container.env.push({ name: 'GROUP_E_FUTURE_PRIVATE_VALUE', value: 'private-future' });
  assert.throws(() => verifyAuthorityService(plan, service), /runtime-or-inactive-state-invalid/u);
  const replacement = inactiveServiceSpec(plan, service, `${plan.target.imageUri}@${NEXT_IMAGE_DIGEST}`);
  const next = replacement.spec.template.spec.containers[0];
  assert.equal(next.image, `${plan.target.imageUri}@${NEXT_IMAGE_DIGEST}`);
  assert.deepEqual(next.env.find((entry) => entry.name === 'FIREBASE_WEB_API_KEY'), {
    name: 'FIREBASE_WEB_API_KEY', valueFrom: { secretKeyRef: { name: 'existing-secret', key: 'latest' } }
  });
  assert.equal(next.env.some((entry) => GROUP_E_PRIVATE_ENVIRONMENT.includes(entry.name)), false);
  assert.equal(next.env.some((entry) => entry.name.startsWith('GROUP_E_') && entry.name !== 'GROUP_E_CLIENT_MODE'), false);
  assert.deepEqual(next.env.filter((entry) => entry.name === 'READ_PROOF_MODE'), [
    { name: 'READ_PROOF_MODE', value: 'false' }
  ]);
  assert.deepEqual(Object.fromEntries(next.env.filter((entry) => Object.hasOwn(REQUIRED_INACTIVE_ENVIRONMENT, entry.name))
    .map((entry) => [entry.name, entry.value])), REQUIRED_INACTIVE_ENVIRONMENT);
  assert.equal(replacement.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'], '2');
  assert.equal(replacement.metadata.annotations['run.googleapis.com/ingress'],
    'internal-and-cloud-load-balancing');
  assert.equal(Object.hasOwn(replacement.spec.template.metadata.annotations, 'run.googleapis.com/sources'), false);
});

test('mocked deploy builds staged Commit A source then dry-runs and replaces without IAM mutation', () => {
  const plan = planFixture('deploy');
  const before = serviceFixture();
  before.spec.template.spec.containers[0].env = before.spec.template.spec.containers[0].env
    .filter((entry) => entry.name !== 'READ_PROOF_MODE');
  const after = serviceFixture({ imageDigest: NEXT_IMAGE_DIGEST, revision: 'e1-identity-authority-00053-new' });
  let describeCalls = 0;
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'builds') return { status: 0, stdout: JSON.stringify({
      id: '123e4567-e89b-42d3-a456-426614174000', results: { images: [{ digest: NEXT_IMAGE_DIGEST }] }
    }) };
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'describe') {
      describeCalls += 1;
      return { status: 0, stdout: JSON.stringify(describeCalls === 1 ? before : after) };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'get-iam-policy') {
      return { status: 0, stdout: JSON.stringify(gatewayOnlyIam()) };
    }
    if (args[0] === 'run' && args[1] === 'services' && args[2] === 'replace') return { status: 0, stdout: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const result = executePlan(plan, { spawn });
  assert.equal(result.revision, 'e1-identity-authority-00053-new');
  assert.equal(result.authorityGatesDisabled, true);
  assert.equal(result.groupEClientMode, 'disabled');
  assert.equal(calls.filter((call) => call.includes('replace')).length, 2);
  assert.equal(calls.some((call) => call.includes('--dry-run')), true);
  assert.equal(calls.some((call) => call.some((arg) => arg ===
    '--service-account=projects/trade-list-a4297/serviceAccounts/e1-authority-builder@trade-list-a4297.iam.gserviceaccount.com')), true);
  assert.equal(calls.some((call) => call.some((arg) => arg ===
    '--impersonate-service-account=e1-authority-deployer@trade-list-a4297.iam.gserviceaccount.com')), true);
  assert.equal(calls.some((call) => call.some((arg) => /add-iam-policy-binding|set-iam-policy|remove-iam-policy-binding/u.test(arg))), false);
  assert.doesNotMatch(JSON.stringify(result), /secret|FIREBASE_WEB_API_KEY|private-server-value/u);
});

test('authority helper source contains no IAM mutation command and gateway pin remains exact', () => {
  const helper = fs.readFileSync(path.resolve(__dirname, '../scripts/deploy-e1-production-authority.cjs'), 'utf8');
  assert.doesNotMatch(helper, /add-iam-policy-binding|remove-iam-policy-binding|set-iam-policy/u);
  const gateway = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../production/e1-gateway-source-manifest.json'), 'utf8'));
  assert.equal(gateway.sourceCommitSha, COMMIT_A_SOURCE_SHA);
  assert.equal(gateway.sourceFingerprint, '6efaab14358355cd2afc8a790a2cace4ae13f394f095f34a5b9c4adf2c8a5258');
  assert.deepEqual(gateway.sourceFiles.map((file) => file.path), [
    'gatewayCore.js', 'groupEAdmission.js', 'groupEControlStore.js', 'index.js', 'package-lock.json', 'package.json'
  ]);
});
