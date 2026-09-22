'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { normalizeHandle } = require('../functions/e1-authority-service/handleNormalization');
const { POLICY_DIGEST, canonicalJson, digest, validAdmission } = require('../functions/e1-authority-service/durableProviderAdmission');
const { protectionPlan, verifyProtection } = require('../scripts/lib/protected-legacy-namespace.cjs');
const policy = require('../functions/production/permanent-legacy-allocation-policy.json');
const { STAGES, advance, rollback } = require('../scripts/lib/durable-admission-transition.cjs');
const { verifyPermanentWriterClosure } = require('../scripts/lib/permanent-legacy-writer-closure.cjs');
const { SERVICE_ACCOUNTS, EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS } =
  require('../scripts/lib/legacy-slot-reconciliation-boundary.cjs');
const rules = require('./firebase/database.rules.permanent-legacy-allocation.json');
const { sealGeneration, signActiveGeneration } = require('../scripts/lib/durable-generation-candidate.cjs');
const sources = (users, aliases = []) => ({ users: { complete: true, names: users },
  loginDirectory: { complete: true, names: users }, authIndex: { complete: true, names: users },
  aliases: { complete: true, names: aliases }, canonicalClaims: { complete: true, names: users } });

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

test('every interrupted cutover stage remains disabled until its exact evidence is present', () => {
  const evidence = [
    { temporaryRulesActive: true, browserAllocationDenied: true, requestApprovalDenied: true, adminProvisioningPaused: true },
    { pendingLegacyAllocations: 0, inflightReadbackComplete: true },
    { protectionPlanComplete: true, exactSetReadback: true, normalizationVersion: 1 },
    { permanentRulesReadbackDigest: policy.candidateRulesSha256, privilegedIamReadbackComplete: true,
      privilegedAllocationPermissionsAbsent: true, activeServiceRevisionReadbackComplete: true,
      legacyAllocationScriptsQuiesced: true },
    { operatorSealedGeneration: true, generationMatchesExactCoverage: true, generationPolicyDigest: POLICY_DIGEST },
    { boundedCertificationInvalidated: true, boundedInFlightAccounted: true },
    { operatorSignedActiveGeneration: true, durableRuntimeGateQualified: true, providerCreationGateQualified: true },
    { permanentRulesStillActive: true, oldClientAllocationStillDenied: true, providerCreationReadbackHealthy: true }
  ];
  let stage = STAGES[0];
  for (const [index, proof] of evidence.entries()) {
    assert.throws(() => advance(stage, {}), /unqualified/u);
    assert.equal(rollback(stage, false).creationEnabled, false);
    stage = advance(stage, proof);
    assert.equal(stage, STAGES[index + 1]);
  }
  assert.equal(rollback(stage, true).preserveProviderCompatibility, true);
  assert.equal(rollback(stage, true).preservePermanentLegacyClosure, true);
});

test('synthetic privileged-writer readback requires exact IAM, Rules, service revisions and drained operations', () => {
  const fixture = {
    deployedRules: rules, iamInventoryComplete: true, operatorBreakGlassPrincipals: [],
    pendingLegacyAllocations: 0, inflightReadbackComplete: true,
    provisioningScriptsQuiesced: true,
    services: Object.entries(SERVICE_ACCOUNTS).map(([name, serviceAccount]) =>
      ({ name, serviceAccount, readyRevision: 'revision-1', servingRevision: 'revision-1', trafficPercent: 100 })),
    projectPolicy: { bindings: Object.entries(EXPECTED_ROLES).flatMap(([principal, roles]) =>
      roles.map(role => ({ role, members: [`serviceAccount:${principal}`],
        ...(EXPECTED_CONDITIONS[role] ? { condition: { expression: EXPECTED_CONDITIONS[role] } } : {}) }))) },
    roles: Object.fromEntries(Object.entries(EXPECTED_PERMISSIONS).map(([role, includedPermissions]) =>
      [role, { includedPermissions }])),
    serviceAccountPolicies: Object.fromEntries(Object.keys(EXPECTED_ROLES).map(principal => [principal, { bindings: [] }]))
  };
  assert.equal(verifyPermanentWriterClosure(fixture).applicationWriterClosureVerified, true);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture, pendingLegacyAllocations: 1 }), /unqualified/u);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture, provisioningScriptsQuiesced: false }), /unqualified/u);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture, projectPolicy: { bindings: [] } }), /unqualified/u);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture, roles: { ...fixture.roles,
    [Object.keys(EXPECTED_PERMISSIONS)[0]]: { includedPermissions: ['firebaseauth.users.create'] } } }), /unqualified/u);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture, deployedRules: {} }), /unqualified/u);
  assert.throws(() => verifyPermanentWriterClosure({ ...fixture,
    projectPolicy: { bindings: [...fixture.projectPolicy.bindings, {
      role: Object.keys(EXPECTED_PERMISSIONS).find(role => EXPECTED_PERMISSIONS[role].includes('datastore.entities.create')),
      members: ['serviceAccount:unknown-writer@example.test'] }] } }), /unqualified/u);
  const plan = protectionPlan({ sourceSets: sources(['SyntheticTrainer'], ['FormerSynthetic']) });
  const readback = Object.fromEntries(plan.actions.map(item => [item.path.split('/')[1], item.document]));
  const generation = sealGeneration({ plan, protectedClaimsReadback: readback,
    writerEvidence: fixture, generationId: 'generation-synthetic-0002', sealedAt: 100 });
  const keys = crypto.generateKeyPairSync('ed25519');
  const control = signActiveGeneration({ generation, activatedAt: 200, privateKey: keys.privateKey });
  assert.equal(validAdmission(control, generation, keys.publicKey, 200, generation.generationId), true);
  assert.throws(() => sealGeneration({ plan, protectedClaimsReadback: {}, writerEvidence: fixture,
    generationId: 'generation-synthetic-0002', sealedAt: 100 }), /coverage-unqualified/u);
});
