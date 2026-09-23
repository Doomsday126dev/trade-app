'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeHandle } = require('../functions/e1-authority-service/handleNormalization');
const { POLICY_DIGEST, canonicalJson, digest, validAdmission } = require('../functions/e1-authority-service/durableProviderAdmission');
const { protectionPlan, verifyProtection } = require('../scripts/lib/protected-legacy-namespace.cjs');
const policy = require('../functions/production/permanent-legacy-allocation-policy.json');
const { STAGES, advance, rollback, verifyRevocationBarrier } = require('../scripts/lib/durable-admission-transition.cjs');
const { REQUIRED_SERVICES, TRACKED_DEPLOYERS, verifyPermanentWriterClosure } =
  require('../scripts/lib/permanent-legacy-writer-closure.cjs');
const { EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS } =
  require('../scripts/lib/legacy-slot-reconciliation-boundary.cjs');
const rules = require('./firebase/database.rules.permanent-legacy-allocation.json');
const temporaryRules = require('./firebase/database.rules.legacy-provisioning-freeze.json');
const temporaryContract = require('../functions/production/legacy-provisioning-contract.json');
const { sealGeneration, signActiveGeneration } = require('../scripts/lib/durable-generation-candidate.cjs');
const sources = (users, aliases = []) => ({ users: { complete: true, names: users },
  loginDirectory: { complete: true, names: users }, authIndex: { complete: true, names: users },
  aliases: { complete: true, names: aliases }, canonicalClaims: { complete: true, names: users } });
function syntheticWriterFixture() {
  const services = Object.entries(REQUIRED_SERVICES).map(([name, serviceAccount]) => ({ name, serviceAccount,
    readyRevision: 'revision-1', servingRevision: 'revision-1', trafficPercent: 100,
    imageDigest: `sha256:${'c'.repeat(64)}`, sourceFingerprint: 'b'.repeat(64), resourceEtag: `etag-${name}`,
    environment: name === 'ownerresetlegacypin' ? { LEGACY_PIN_RESET_ENABLED: 'false' } :
      { LEGACY_ALLOCATION_ENABLED: 'false' } }));
  const trackedDeployers = Object.fromEntries(TRACKED_DEPLOYERS.map(account => [account, 'absent']));
  const reviewedDeployment = { schemaVersion: 1, projectId: 'trade-list-a4297', sourceCommitSha: 'a'.repeat(40),
    reviewedAt: 50, trackedDeployers, serviceAccounts: Object.keys(EXPECTED_ROLES),
    operatorBreakGlassPrincipals: [], services: services.map(service => ({ name: service.name,
      serviceAccount: service.serviceAccount, allowedRevisions: [{ name: service.servingRevision,
        imageDigest: service.imageDigest, sourceFingerprint: service.sourceFingerprint,
        environment: service.environment }], routes: [{ service: service.name, method: 'POST', path: `/${service.name}` }] })) };
  const approvedReviewDigest = digest(reviewedDeployment);
  const fixture = {
    projectId: 'trade-list-a4297', capturedAt: 200, deployedRules: rules, rulesRelease: 'release-synthetic-1',
    iamInventoryComplete: true, serviceInventoryComplete: true, routeReadbackComplete: true,
    serviceAccountInventoryComplete: true, operatorBreakGlassPrincipals: [], trackedDeployers,
    pendingLegacyAllocations: 0, inflightReadbackComplete: true,
    inflightOperations: [], provisioningScriptsQuiesced: true, provisioningScripts: [], services,
    reachableRoutes: reviewedDeployment.services.flatMap(service => service.routes),
    serviceAccountInventory: Object.keys(EXPECTED_ROLES),
    projectPolicy: { etag: 'iam-etag-synthetic-1', bindings: Object.entries(EXPECTED_ROLES).flatMap(([principal, roles]) =>
      roles.map(role => ({ role, members: [`serviceAccount:${principal}`],
        ...(EXPECTED_CONDITIONS[role] ? { condition: { expression: EXPECTED_CONDITIONS[role] } } : {}) }))) },
    roles: Object.fromEntries(Object.entries(EXPECTED_PERMISSIONS).map(([role, includedPermissions]) =>
      [role, { includedPermissions }])),
    serviceAccountPolicies: Object.fromEntries(Object.keys(EXPECTED_ROLES).map(principal => [principal, { bindings: [] }]))
  };
  const withReadbacks = value => ({ ...value, readbackRefs: {
    rulesRelease: value.rulesRelease, projectIamEtag: value.projectPolicy?.etag,
    serviceInventoryDigest: digest(value.services), serviceAccountInventoryDigest: digest(value.serviceAccountInventory),
    routeProbeDigest: digest(value.reachableRoutes), inflightLedgerDigest: digest(value.inflightOperations),
    scriptInventoryDigest: digest(value.provisioningScripts) } });
  return { fixture, reviewedDeployment, approvedReviewDigest, withReadbacks };
}

test('permanent Rules policy is pinned to the admission runtime', () => {
  assert.equal(policy.policyDigest, POLICY_DIGEST);
  assert.equal(policy.legacyCreationMayResume, false);
});

test('synthetic protection is deterministic, resumable and exact-set checked', () => {
  const canonical = normalizeHandle('ExistingTrainer');
  const existing = { schemaVersion: 1, state: 'active', uid: 'owner-a', canonicalTrainerName: 'ExistingTrainer',
    normalizedTrainerName: canonical.normalized };
  const accounts = { 'owner-a': { uid: 'owner-a', handleKey: canonical.handleKey,
    normalizedTrainerName: canonical.normalized, canonicalTrainerName: 'ExistingTrainer' } };
  const sourceSets = sources(['ExistingTrainer'], ['FormerName', 'FORMERNAME']);
  const first = protectionPlan({ sourceSets, claims: { [canonical.handleKey]: existing }, accounts });
  assert.equal(first.complete, true);
  assert.equal(first.actions.length, 1);
  assert.equal(first.normalizedCollisions.length, 1);
  assert.equal(first.actions[0].document.state, 'held');
  const heldKey = first.actions[0].path.split('/')[1];
  const readback = { [heldKey]: first.actions[0].document, [canonical.handleKey]: existing };
  assert.equal(verifyProtection(first, readback), true);
  assert.equal(verifyProtection(first, { ...readback, [heldKey]: { ...readback[heldKey], sourceNamesDigest: 'a'.repeat(64) } }), false);
  assert.equal(verifyProtection(first, { [canonical.handleKey]: existing }), false);
  const resumed = protectionPlan({ sourceSets, claims: { [canonical.handleKey]: existing }, accounts,
    completed: { [heldKey]: first.actions[0].document } });
  assert.equal(resumed.actions.length, 0);
  assert.equal(resumed.protectedClaimsDigest, first.protectedClaimsDigest);
});

test('conflicting canonical and alias evidence never overwrites a claim', () => {
  const name = normalizeHandle('Trainer');
  const claims = { [name.handleKey]: { schemaVersion: 1, state: 'active', uid: 'owner-a',
    canonicalTrainerName: 'Trainer', normalizedTrainerName: name.normalized } };
  const plan = protectionPlan({ sourceSets: sources(['Trainer'], ['TRAINER']), claims });
  assert.equal(plan.complete, false);
  assert.deepEqual(plan.conflicts, [name.handleKey]);
  assert.equal(plan.actions.length, 0);
  assert.throws(() => protectionPlan({ sourceSets: { users: { complete: true, names: ['Trainer'] } } }), /inventory-incomplete/u);
});

test('signed active generation rejects malformed, stale, mismatched, invalidated and superseded evidence', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const generation = { schemaVersion: 1, state: 'sealed', generationId: 'generation-synthetic-1',
    normalizationVersion: 1, inventoryEvidenceDigest: 'a'.repeat(64),
    coveredHandleKeysDigest: 'b'.repeat(64), protectedClaimsDigest: 'c'.repeat(64),
    coveredHandleCount: 2, heldHandleCount: 1, writerPolicyDigest: POLICY_DIGEST,
    writerClosureEvidenceDigest: 'd'.repeat(64), sealedAt: 100 };
  const sign = value => ({ ...value, operatorSignature: crypto.sign(null, Buffer.from(canonicalJson(value)), privateKey).toString('base64url') });
  const active = sign({ schemaVersion: 1, state: 'active', generationId: generation.generationId,
    generationDigest: digest(generation), writerPolicyDigest: POLICY_DIGEST,
    writerClosureEvidenceDigest: generation.writerClosureEvidenceDigest, activatedAt: 200, invalidatedAt: null });
  assert.equal(validAdmission(active, generation, publicKey, 300, generation.generationId), true);
  assert.equal(validAdmission(Object.fromEntries(Object.entries(active).reverse()),
    Object.fromEntries(Object.entries(generation).reverse()), publicKey, 300, generation.generationId), true);
  for (const changed of [
    { state: 'invalidated' }, { invalidatedAt: 250 }, { generationId: 'generation-synthetic-2' },
    { generationDigest: 'e'.repeat(64) }, { writerPolicyDigest: 'e'.repeat(64) },
    { operatorSignature: 'a'.repeat(86) }, { extra: true }
  ]) assert.equal(validAdmission({ ...active, ...changed }, generation, publicKey, 300, generation.generationId), false);
  assert.equal(validAdmission(active, { ...generation, coveredHandleCount: 1 }, publicKey, 300, generation.generationId), false);
  assert.equal(validAdmission(active, generation, publicKey, 150, generation.generationId), false);
  assert.equal(validAdmission(active, generation, null, 300, generation.generationId), false);
  assert.equal(validAdmission(active, generation, publicKey, 300, 'generation-superseded-2'), false);
});

test('old signed active pointer cannot reauthorize after all routes are gated and repinned', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const generation = { schemaVersion: 1, state: 'sealed', generationId: 'generation-synthetic-old',
    normalizationVersion: 1, inventoryEvidenceDigest: 'a'.repeat(64), coveredHandleKeysDigest: 'b'.repeat(64),
    protectedClaimsDigest: 'c'.repeat(64), coveredHandleCount: 1, heldHandleCount: 1,
    writerPolicyDigest: POLICY_DIGEST, writerClosureEvidenceDigest: 'd'.repeat(64), sealedAt: 100 };
  const oldControl = signActiveGeneration({ generation, activatedAt: 150, privateKey });
  assert.equal(validAdmission(oldControl, generation, publicKey, 200, generation.generationId), true);
  const replacementGenerationId = 'generation-synthetic-never-reused';
  const servingRoutes = ['/createE1ProviderAccountFoundation', '/createProviderAccountFoundation'].map(path => ({
    path, reachable: true, revision: 'reviewed-revision', sourceFingerprint: 'a'.repeat(64),
    configuration: { CREATE_PROVIDER_ACCOUNT_ENABLED: 'false', DURABLE_ADMISSION_GENERATION_ID: replacementGenerationId } }));
  const proof = { oldGenerationId: generation.generationId, replacementGenerationId,
    expectedRouteKeys: servingRoutes.map(route => route.path), servingRoutes, routeReadbackDigest: digest(servingRoutes) };
  assert.equal(verifyRevocationBarrier(proof), true);
  assert.equal(validAdmission(oldControl, generation, publicKey, 200, replacementGenerationId), false);
  assert.equal(verifyRevocationBarrier({ ...proof, replacementGenerationId: generation.generationId }), false);
  assert.equal(verifyRevocationBarrier({ ...proof, servingRoutes: servingRoutes.slice(0, 1) }), false);
  assert.equal(verifyRevocationBarrier({ ...proof, servingRoutes: servingRoutes.map((route, index) => index ? {
    ...route, configuration: { ...route.configuration, CREATE_PROVIDER_ACCOUNT_ENABLED: 'true' } } : route),
  }), false);
});

test('every interrupted cutover stage remains disabled until its exact evidence is present', () => {
  const { fixture, reviewedDeployment, approvedReviewDigest, withReadbacks } = syntheticWriterFixture();
  const writerEvidence = withReadbacks(fixture);
  const plan = protectionPlan({ sourceSets: sources(['SyntheticTrainer'], ['FormerSynthetic']) });
  const protectedClaimsReadback = Object.fromEntries(plan.actions.map(item => [item.path.split('/')[1], item.document]));
  const generation = sealGeneration({ plan, protectedClaimsReadback, writerEvidence, reviewedDeployment,
    approvedReviewDigest, generationId: 'generation-synthetic-0002', sealedAt: 100 });
  const keys = crypto.generateKeyPairSync('ed25519');
  const control = signActiveGeneration({ generation, activatedAt: 150, privateKey: keys.privateKey });
  const freeze = { schemaVersion: 1, state: 'active', provisioningContractDigest:
    temporaryContract.provisioningContractDigest, activatedAt: 50, releasedAt: null };
  const temporaryBarrier = { rules: temporaryRules, rulesRelease: 'temporary-synthetic-1', freeze,
    capturedAt: 200, provisioningScripts: [], readbackRefs: { rulesRelease: 'temporary-synthetic-1',
      freezeDigest: digest(freeze), scriptInventoryDigest: digest([]) } };
  const runtimeConfiguration = { CREATE_PROVIDER_ACCOUNT_ENABLED: 'true', DURABLE_PROVIDER_ADMISSION_ENABLED: 'true',
    DURABLE_ADMISSION_GENERATION_ID: generation.generationId };
  const providerSmoke = { status: 'SUCCESS', appCheckCode: 'app-check/initialized' };
  const releasedFreeze = { ...freeze, state: 'released', releasedAt: 201 };
  const evidence = { temporaryBarrier, legacyOperations: [], legacyOperationsDigest: digest([]),
    protectionPlan: plan, protectedClaimsReadback, writerEvidence, reviewedDeployment, approvedReviewDigest,
    generation, boundedCertification: null, boundedInFlightOperations: [], boundedInFlightDigest: digest([]),
    control, runtimePublicKey: keys.publicKey, runtimeConfiguration,
    runtimeConfigurationDigest: digest(runtimeConfiguration), providerSmoke, providerSmokeDigest: digest(providerSmoke) };
  let stage = STAGES[0];
  for (let index = 0; index < STAGES.length - 1; index++) {
    assert.throws(() => advance(stage, {}), /unqualified/u);
    assert.equal(rollback(stage, false).creationEnabled, false);
    assert.throws(() => advance(stage, { temporaryRulesActive: true, writerClosureComplete: true,
      operatorSignedActiveGeneration: true, providerCreationReadbackHealthy: true }), /unqualified/u);
    const current = index === STAGES.length - 2 ? { ...evidence, temporaryBarrier: { ...temporaryBarrier,
      freeze: releasedFreeze, readbackRefs: { ...temporaryBarrier.readbackRefs, freezeDigest: digest(releasedFreeze) } } } : evidence;
    if (index === STAGES.length - 2) {
      assert.throws(() => advance(stage, { ...current, control: { ...control, state: 'invalidated' } }), /unqualified/u);
      assert.throws(() => advance(stage, { ...current, temporaryBarrier: { ...current.temporaryBarrier,
        readbackRefs: { ...current.temporaryBarrier.readbackRefs, freezeDigest: 'a'.repeat(64) } } }), /unqualified/u);
    }
    stage = advance(stage, current);
    assert.equal(stage, STAGES[index + 1]);
  }
  assert.equal(rollback(stage, true).preserveProviderCompatibility, true);
  assert.equal(rollback(stage, true).preservePermanentLegacyClosure, true);
});

test('synthetic privileged-writer readback requires exact IAM, Rules, service revisions and drained operations', () => {
  const { fixture, reviewedDeployment, approvedReviewDigest, withReadbacks } = syntheticWriterFixture();
  const review = { reviewedDeployment, approvedReviewDigest };
  const check = value => verifyPermanentWriterClosure(withReadbacks(value), review);
  assert.equal(check(fixture).kind, 'verified-permanent-writer-closure');
  assert.throws(() => check({ ...fixture, pendingLegacyAllocations: 1 }), /unqualified/u);
  assert.throws(() => check({ ...fixture, provisioningScriptsQuiesced: false }), /unqualified/u);
  assert.throws(() => check({ ...fixture, projectPolicy: { etag: 'other', bindings: [] } }), /unqualified/u);
  assert.throws(() => check({ ...fixture, roles: { ...fixture.roles,
    [Object.keys(EXPECTED_PERMISSIONS)[0]]: { includedPermissions: ['firebaseauth.users.create'] } } }), /unqualified/u);
  assert.throws(() => check({ ...fixture, deployedRules: {} }), /unqualified/u);
  assert.throws(() => check({ ...fixture,
    projectPolicy: { bindings: [...fixture.projectPolicy.bindings, {
      role: Object.keys(EXPECTED_PERMISSIONS).find(role => EXPECTED_PERMISSIONS[role].includes('datastore.entities.create')),
      members: ['serviceAccount:unknown-writer@example.test'] }], etag: fixture.projectPolicy.etag } }), /unqualified/u);
  for (const permission of ['resourcemanager.projects.setIamPolicy', 'iam.roles.update',
    'iam.serviceAccounts.setIamPolicy', 'run.services.update', 'cloudfunctions.functions.update']) {
    assert.throws(() => check({ ...fixture,
      projectPolicy: { bindings: [...fixture.projectPolicy.bindings,
        { role: 'projects/demo/roles/rogue', members: ['serviceAccount:unknown-writer@example.test'] }],
        etag: fixture.projectPolicy.etag },
      roles: { ...fixture.roles, 'projects/demo/roles/rogue': { includedPermissions: [permission] } }
    }), /unqualified/u, permission);
  }
  const unreviewed = { ...fixture, services: fixture.services.map((service, index) => index ? service : {
    ...service, readyRevision: 'unreviewed-revision', servingRevision: 'unreviewed-revision',
    imageDigest: `sha256:${'d'.repeat(64)}`, environment: { LEGACY_PIN_RESET_ENABLED: 'true' } }) };
  assert.throws(() => check(unreviewed), /unqualified/u,
    'correct account, matching serving revision and traffic cannot hide an unreviewed writer-enabled image');
  assert.throws(() => check({ ...fixture, reachableRoutes: [...fixture.reachableRoutes,
    { service: 'ownerresetlegacypin', method: 'POST', path: '/unreviewed-writer' }] }), /unqualified/u);
  assert.throws(() => check({ ...fixture, serviceInventoryComplete: false }), /unqualified/u);
  const plan = protectionPlan({ sourceSets: sources(['SyntheticTrainer'], ['FormerSynthetic']) });
  const readback = Object.fromEntries(plan.actions.map(item => [item.path.split('/')[1], item.document]));
  const generation = sealGeneration({ plan, protectedClaimsReadback: readback,
    writerEvidence: withReadbacks(fixture), ...review, generationId: 'generation-synthetic-0002', sealedAt: 100 });
  const keys = crypto.generateKeyPairSync('ed25519');
  const control = signActiveGeneration({ generation, activatedAt: 200, privateKey: keys.privateKey });
  assert.equal(validAdmission(control, generation, keys.publicKey, 200, generation.generationId), true);
  assert.throws(() => sealGeneration({ plan, protectedClaimsReadback: {}, writerEvidence: withReadbacks(fixture), ...review,
    generationId: 'generation-synthetic-0002', sealedAt: 100 }), /coverage-unqualified/u);
});
