'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { DURABLE_MODE } = require('../e1-authority-service/readRateLimiters');
const {
  EXPECTED_APP_ID,
  EXPECTED_TOKEN_VERIFIER,
  activationGatePlan,
  disabledGatePlan
} = require('../production/e1ProductionFirstMutationGuard.cjs');
const {
  ALLOWED_OPERATIONS,
  D2_BASELINE,
  EXECUTION_SEQUENCE,
  EXPECTED_COUNT_SEQUENCE,
  EXPECTED_D3_MANIFEST,
  FINAL_COUNTS,
  OBSERVATION_CHECKS,
  OBSERVATION_HOURS,
  OPERATION_BUDGET,
  STOP_POLICY,
  expectedDocumentCount,
  subjectBindingDigest
} = require('../production/e1ProductionThirdMutationContract.cjs');
const {
  ENABLE_CONFIRMATION,
  RESTORE_CONFIRMATION,
  foundationFingerprint,
  guardProductionThirdMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validateThirdMutationAcceptance
} = require('../production/e1ProductionThirdMutationGuard.cjs');

const NOW = Date.parse('2026-08-15T15:00:00.000Z');
const START = '2026-08-15T14:30:00.000Z';
const END = '2026-08-15T16:30:00.000Z';
const MANIFEST_PATH = path.resolve(__dirname, '../production/e1-production-resource-manifest.json');

function priorCohort() {
  return {
    d2StateDigest: D2_BASELINE.stateDigest,
    members: Array.from({ length: 3 }, (_, index) => ({
      uidHash: String(index + 1).repeat(64),
      trainerHash: String(index + 4).repeat(64),
      handleKey: `v1_7072696f72${index}`
    })),
    humanReviewed: true,
    evidenceDigest: 'a'.repeat(64)
  };
}

function candidate(slot, index) {
  const reviewedSubject = { firebaseUid: `synthetic-d3-uid-${index}`, trainerUsername: `D3Trainer${slot}` };
  const subjectHashes = subjectHashesFor(reviewedSubject);
  const normalized = normalizeHandle(reviewedSubject.trainerUsername);
  const handle = { canonical: normalized.display, normalized: normalized.normalized, handleKey: normalized.handleKey };
  const requestId = `group-d3-${slot.toLowerCase()}-0000000${index}-0000-4000-8000-00000000000${index}`;
  return {
    slot,
    reviewedSubject,
    subjectHashes,
    handle,
    request: {
      requestId,
      requestIdHash: requestIdHash(requestId),
      requestBodyHash: requestBodyHash(requestId, handle.canonical),
      foundationFingerprint: foundationFingerprint(reviewedSubject, handle),
      rateLimitDocumentPath: `rateLimits/reserveTrainerHandle_${String(index).repeat(16)}`,
      rateLimitPathDerivationVerified: true
    },
    authEligibility: {
      mode: 'exact-auth-metadata',
      verifiedAt: '2026-08-15T14:55:00.000Z',
      userExists: true,
      disabledState: 'false',
      appId: EXPECTED_APP_ID,
      appCheckObtainable: true,
      currentUidHash: subjectHashes.uidHash,
      currentTrainerHash: subjectHashes.trainerHash
    },
    eligibility: {
      reciprocalLegacyOwnershipVerified: true,
      loginDirectoryReady: true,
      identityAmbiguityAbsent: true,
      migrationEvidenceAbsent: true,
      conflictEvidenceAbsent: true,
      existingAccountAbsent: true,
      existingHandleAbsent: true,
      existingOperationRequestAbsent: true,
      existingRateLimitAbsent: true,
      competingHandleAbsent: true,
      priorCohortMemberAbsent: true,
      adminOrSystemIdentityAbsent: true
    },
    targetedAuthorityState: {
      verifiedAt: '2026-08-15T14:55:00.000Z',
      accountAbsent: true,
      handleAbsent: true,
      operationRequestAbsent: true,
      reserveRateLimitAbsent: true,
      migrationAbsent: true,
      conflictAbsent: true,
      competingHandleAbsent: true
    },
    review: {
      humanReviewed: true,
      reviewedAt: '2026-08-15T14:50:00.000Z',
      selectionSource: 'explicit-private-d3-candidate'
    }
  };
}

function fixture() {
  const prior = priorCohort();
  const candidates = ['A', 'B', 'C', 'D', 'E'].map((slot, index) => candidate(slot, index + 1));
  const bindingDigest = subjectBindingDigest(prior, candidates);
  const runtimeProvenance = {
    authorityService: 'e1-identity-authority',
    authorityOrigin: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    authorityRevision: 'e1-identity-authority-00001-abc',
    authorityImageDigest: `sha256:${'b'.repeat(64)}`,
    runtimeServiceAccount: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
    gatewayServiceAccount: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    reviewed: true
  };
  const binding = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    cohortStage: 'D3',
    cohortSize: 5,
    state: 'bound-reviewed',
    subjectsBound: true,
    executionAuthorized: false,
    boundAt: '2026-08-15T14:45:00.000Z',
    humanReviewed: true,
    priorCohort: prior,
    candidates,
    bindingDigest
  };
  const readiness = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    region: 'us-central1',
    firestoreDatabaseId: 'phase-e-identity',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    approvalGroup: 'D',
    cohortStage: 'D3',
    contractDefined: true,
    subjectsBindingDigest: bindingDigest,
    subjectsBound: true,
    executionAuthorized: true,
    approvedAt: '2026-08-15T14:40:00.000Z',
    humanOperator: 'primary-operator',
    teardownOwner: 'primary-operator',
    approvalAcknowledged: true,
    teardownOwnerAcknowledged: true,
    mutationWindow: { startAt: START, endAt: END },
    authorizedOperations: ALLOWED_OPERATIONS,
    d2Baseline: D2_BASELINE,
    runtimeProvenance,
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    operationBudget: OPERATION_BUDGET,
    executionSequence: EXECUTION_SEQUENCE,
    observationHours: OBSERVATION_HOURS,
    observationChecks: OBSERVATION_CHECKS,
    stopPolicy: STOP_POLICY,
    laterGroupsAuthorized: false,
    groupEAuthorized: false
  };
  const input = {
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    expectedProjectNumber: '1053781218847',
    region: 'us-central1',
    databaseId: 'phase-e-identity',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    approvalGroup: 'D',
    cohortStage: 'D3',
    subjectsBindingDigest: bindingDigest,
    subjectsBound: true,
    executionAuthorized: true,
    requestedOperations: ALLOWED_OPERATIONS,
    d2Baseline: D2_BASELINE,
    currentGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    runtimeProvenance,
    securityBoundary: {
      authorityPrivate: true,
      gatewayRuntimeSoleAuthorityInvoker: true,
      publicAuthorityInvoker: false,
      projectWideRunInvoker: false,
      gatewayForbiddenRolesPresent: false,
      runtimeIamDrift: false,
      productionDebugTokensRegistered: false
    },
    tokenVerifier: EXPECTED_TOKEN_VERIFIER,
    rateLimiterMode: DURABLE_MODE,
    readProofModePresent: false,
    reserveConsumesLimitedUseAppCheck: true,
    operationBudget: OPERATION_BUDGET,
    expectedCountSequence: EXPECTED_COUNT_SEQUENCE,
    executionSequence: EXECUTION_SEQUENCE,
    observationHours: OBSERVATION_HOURS,
    observationChecks: OBSERVATION_CHECKS,
    stopPolicy: STOP_POLICY,
    writeBoundary: { legacyLoginWrites: [], e1AuthorityWrites: [], controlPlaneWrites: [], unexpectedWrites: [] },
    finalAcceptanceTemplate: {
      executedSubjects: 0,
      reserveSuccesses: 0,
      replaySuccesses: 0,
      finalCounts: FINAL_COUNTS,
      finalStateDigest: null,
      sequenceMatched: false,
      ownershipReciprocal: false,
      anomaliesAbsent: false,
      gatesRestored: false,
      observationCompleted: false,
      observationHealthy: false,
      groupEAuthorized: false,
      accepted: false
    },
    laterGroupsAuthorized: false,
    groupEAuthorized: false
  };
  return { binding, readiness, input };
}

function writePrivate(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function runGuard(values = fixture()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-d3-guard-'));
  try {
    const bindingPath = writePrivate(directory, 'subjects.json', values.binding);
    const readinessPath = writePrivate(directory, 'readiness.json', values.readiness);
    const inputPath = writePrivate(directory, 'input.json', values.input);
    return guardProductionThirdMutation(values.input, {
      now: () => NOW,
      manifestPath: MANIFEST_PATH,
      bindingPath,
      readinessPath,
      inputPath
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function acceptance() {
  const steps = Array.from({ length: 10 }, (_, index) => {
    const reserve = index % 2 === 0;
    const pairDigest = String(Math.floor(index / 2) + 1).repeat(64);
    return {
      sequence: index + 1,
      slot: ['A', 'B', 'C', 'D', 'E'][Math.floor(index / 2)],
      operation: reserve ? 'reserve' : 'exact-replay',
      resultCode: reserve ? 'SUCCESS' : 'IDEMPOTENT',
      documentCount: EXPECTED_COUNT_SEQUENCE[index + 1],
      stateDigest: pairDigest,
      committedWrites: reserve ? 4 : 0,
      requestFingerprintCoherent: true,
      ownershipReciprocal: true,
      rateLimitValid: true,
      migrationConflictAbsent: true,
      anomaliesAbsent: true
    };
  });
  return {
    schemaVersion: 1,
    cohortStage: 'D3',
    subjectsBindingDigest: 'a'.repeat(64),
    executedSubjects: 5,
    reserveSuccesses: 5,
    replaySuccesses: 5,
    steps,
    finalCounts: FINAL_COUNTS,
    finalStateDigest: steps.at(-1).stateDigest,
    ownershipReciprocal: true,
    anomaliesAbsent: true,
    gatesRestored: disabledGatePlan(),
    observation: {
      startAt: '2026-08-14T14:00:00.000Z',
      endAt: '2026-08-15T14:00:00.000Z',
      durationHours: 24,
      completed: true,
      healthy: true,
      stateDigestAccepted: true,
      familyCountsVerified: true,
      migrationConflictAbsent: true,
      serviceAuthAnomaliesAbsent: true,
      privacyIamDriftAbsent: true,
      costLogAnomaliesAbsent: true
    },
    unexpectedCostOrLogAnomaly: false,
    groupEAuthorized: false,
    accepted: true
  };
}

test('tracked D3 contract is unbound and unauthorized while defining exact reserve-only progression and budget', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(manifest.thirdMutation, EXPECTED_D3_MANIFEST);
  assert.deepEqual(EXPECTED_COUNT_SEQUENCE, [12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32]);
  assert.deepEqual(Array.from({ length: 11 }, (_, index) => expectedDocumentCount(index)), EXPECTED_COUNT_SEQUENCE);
  assert.equal(manifest.thirdMutation.subjectBinding.subjectsBound, false);
  assert.equal(manifest.thirdMutation.subjectBinding.executionAuthorized, false);
  assert.equal(manifest.thirdMutation.operation, 'reserve-plus-exact-replay');
  assert.equal(OPERATION_BUDGET.gatewayCalls, 10);
  assert.equal(OPERATION_BUDGET.firestoreTransactionAttemptsMaximum, 100);
  assert.equal(OPERATION_BUDGET.firestoreCommittedWrites, 20);
  assert.equal(OPERATION_BUDGET.rtdbWrites, 0);
  assert.equal(OPERATION_BUDGET.verificationReadsTotalMaximum, 510);
});

test('exact five-subject private binding and authorized preflight pass without cloud operations', () => {
  const result = runGuard();
  assert.equal(result.ok, true);
  assert.equal(result.cohortStage, 'D3');
  assert.equal(result.candidateCount, 5);
  assert.equal(result.subjectsBound, true);
  assert.equal(result.executionAuthorized, true);
  assert.equal(result.d2BaselineVerified, true);
  assert.equal(result.cloudOperations, 0);
  assert.equal(result.groupEAuthorized, false);
});

test('subject binding is separate from execution authorization and uses a deterministic reviewed digest', () => {
  const values = fixture();
  assert.equal(values.binding.executionAuthorized, false);
  assert.equal(values.readiness.executionAuthorized, true);
  assert.equal(values.binding.bindingDigest, subjectBindingDigest(values.binding.priorCohort, values.binding.candidates));
  values.binding.bindingDigest = 'f'.repeat(64);
  assert.throws(() => runGuard(values), (error) => error.reasons.includes('group_d3_binding_digest_mismatch'));
});

for (const [name, mutate, reason] of [
  ['four subjects', (value) => { value.binding.candidates.pop(); }, 'group_d3_subject_binding_invalid'],
  ['six subjects', (value) => { value.binding.candidates.push(structuredClone(value.binding.candidates[0])); }, 'group_d3_subject_binding_invalid'],
  ['duplicate subject', (value) => { value.binding.candidates[1] = structuredClone(value.binding.candidates[0]); value.binding.candidates[1].slot = 'B'; }, 'group_d3_candidates_not_distinct'],
  ['prior cohort overlap', (value) => { value.binding.priorCohort.members[0].uidHash = value.binding.candidates[0].subjectHashes.uidHash; }, 'group_d3_candidate_a_prior_cohort_overlap'],
  ['wrong D2 digest', (value) => { value.input.d2Baseline = { ...value.input.d2Baseline, stateDigest: 'f'.repeat(64) }; }, 'group_d3_d2_baseline_invalid'],
  ['wrong D2 count', (value) => { value.readiness.d2Baseline = { ...value.readiness.d2Baseline, accounts: 4 }; }, 'group_d3_d2_baseline_invalid'],
  ['migration evidence present', (value) => { value.binding.candidates[2].eligibility.migrationEvidenceAbsent = false; }, 'group_d3_candidate_c_ineligible'],
  ['conflict evidence present', (value) => { value.binding.candidates[3].targetedAuthorityState.conflictAbsent = false; }, 'group_d3_candidate_d_targeted_state_invalid'],
  ['broken reciprocity', (value) => { value.binding.candidates[4].eligibility.reciprocalLegacyOwnershipVerified = false; }, 'group_d3_candidate_e_ineligible'],
  ['operation fingerprint mismatch', (value) => { value.binding.candidates[0].request.requestBodyHash = 'e'.repeat(64); }, 'group_d3_candidate_a_request_invalid'],
  ['budget overflow', (value) => { value.input.operationBudget = { ...value.input.operationBudget, gatewayCalls: 11 }; }, 'group_d3_budget_invalid'],
  ['gate already enabled', (value) => { value.input.currentGates = { ...value.input.currentGates, RESERVE_HANDLE_ENABLED: true }; }, 'group_d3_gate_plan_invalid'],
  ['public authority', (value) => { value.input.securityBoundary.publicAuthorityInvoker = true; }, 'group_d3_security_boundary_invalid'],
  ['wrong runtime identity', (value) => { value.readiness.runtimeProvenance.runtimeServiceAccount = 'wrong@example.iam.gserviceaccount.com'; }, 'group_d3_runtime_provenance_invalid'],
  ['Group E authorization', (value) => { value.input.groupEAuthorized = true; }, 'group_d3_later_group_forbidden'],
  ['observation duration wrong', (value) => { value.readiness.observationHours = 23; }, 'group_d3_observation_invalid'],
  ['unexpected preflight write', (value) => { value.input.writeBoundary.e1AuthorityWrites.push('accounts/example'); }, 'group_d3_write_boundary_invalid'],
  ['premature acceptance', (value) => { value.input.finalAcceptanceTemplate.accepted = true; }, 'group_d3_acceptance_template_invalid']
]) {
  test(`D3 fails closed for ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => runGuard(value), (error) => error.reasons.includes(reason));
  });
}

test('D3 confirmation strings are stage-specific', () => {
  assert.equal(ENABLE_CONFIRMATION, 'ENABLE E1 GROUP D3 RESERVE COHORT');
  assert.equal(RESTORE_CONFIRMATION, 'RESTORE E1 GROUP D3 GATES');
  assert.notEqual(ENABLE_CONFIRMATION, RESTORE_CONFIRMATION);
});

test('acceptance remains impossible before a captured digest, exact final state, restored gates, and 24-hour observation', () => {
  const template = fixture().input.finalAcceptanceTemplate;
  assert.equal(template.finalStateDigest, null);
  assert.deepEqual(template.finalCounts, FINAL_COUNTS);
  assert.equal(template.observationCompleted, false);
  assert.equal(template.accepted, false);
  assert.equal(OBSERVATION_HOURS, 24);
  assert.deepEqual(disabledGatePlan(), Object.fromEntries(Object.keys(disabledGatePlan()).map((gate) => [gate, false])));
});

test('final D3 acceptance requires ten exact ordered reserve/replay records and a healthy 24-hour observation', () => {
  const result = validateThirdMutationAcceptance(acceptance(), { now: () => NOW });
  assert.equal(result.ok, true);
  assert.equal(result.finalDocumentCount, 32);
  assert.equal(result.observationHours, 24);
  assert.equal(result.groupEAuthorized, false);
});

for (const [name, mutate, reason] of [
  ['replay writes', (value) => { value.steps[1].committedWrites = 1; }, 'group_d3_acceptance_step_2_invalid'],
  ['replay digest drift', (value) => { value.steps[5].stateDigest = 'f'.repeat(64); }, 'group_d3_acceptance_step_6_invalid'],
  ['wrong final count', (value) => { value.finalCounts = { ...value.finalCounts, totalDocuments: 33 }; }, 'group_d3_acceptance_schema_or_summary_invalid'],
  ['short observation', (value) => { value.observation.endAt = '2026-08-15T13:59:59.000Z'; }, 'group_d3_acceptance_observation_invalid'],
  ['unrestored gate', (value) => { value.gatesRestored = { ...value.gatesRestored, GATEWAY_INVOCATION_ENABLED: true }; }, 'group_d3_acceptance_schema_or_summary_invalid'],
  ['Group E enabled', (value) => { value.groupEAuthorized = true; }, 'group_d3_acceptance_schema_or_summary_invalid']
]) {
  test(`final D3 acceptance fails for ${name}`, () => {
    const value = acceptance();
    mutate(value);
    assert.throws(() => validateThirdMutationAcceptance(value, { now: () => NOW }),
      (error) => error.reasons.includes(reason));
  });
}
