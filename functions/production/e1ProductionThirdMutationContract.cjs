'use strict';

const crypto = require('node:crypto');
const { DURABLE_MODE } = require('../e1-authority-service/readRateLimiters');

const D2_STATE_DIGEST = '2923aafa890de58cb04fb5941528f7a425c22d0a131dd9fc0fcf71013468bf0b';
const COHORT_SIZE = 5;
const SYNTHETIC_COHORT_TYPE = 'controlled-synthetic-legacy-canary';
const REAL_WORLD_EVIDENCE_TYPE = 'real-world-read-only-compatibility';
const EXECUTION_EVIDENCE_PURPOSE = 'synthetic-mutation-execution';
const OBSERVATION_HOURS = 24;
const MAX_WINDOW_HOURS = 2;
const ENTRY_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
const CONTINUATION_PURPOSE = 'resume-after-authoritative-a-reserve-v1';
const CONTINUATION_JIT_PURPOSE = 'authorize-reconciled-a-reserve-suffix-v1';
const CONTINUATION_STATE_FINGERPRINT = '4b24a8a2e8253fbb086a30d52b5265533cd9cb50cade54ff900f20f8770313fa';
const CONTINUATION_PRODUCTION_RUNTIME = Object.freeze({
  releaseId: '2026-08-20.51',
  sourceSha: 'e28ffe8b29bc51bd40af4c4158ab6372bf041050',
  artifactDigest: 'c5b057fe0192f999a03d2c0ea9afa2d37be650882c4b440ea6ee870776ec12ab'
});
const CONTINUATION_PINS = Object.freeze({
  bindingFileSha: 'b2cc60151c0cc5f2d41c82737e62b2653ad026653c3487e20a08f2d05d534e3f',
  bindingDigest: '54a71b3dec0cc6db60f874d68e235e8a20120b3049c80bc30af19fbc50f2716e',
  candidatePoolDigest: '5d8f2bbf618feba394c7f403347ae88632c626830c30973c512b564c7fb88c7b',
  browserHarnessDigest: 'b2285997164d8216f46c0f8b5be64f4a6b032f437e5ce8208742ad1ea0c2f1f4',
  browserHarnessFileSha: '299a5e1776e3cf71b74acf28bf12bea74ddf277009d5f68e42fe13a7a8ea22ef',
  initialJitDigest: 'b71abc63664f4d7d50b48f823dddc58fec6b93a000b810e49edcdd7405a1d6d1',
  initialReadinessDigest: '78aee40d266698fe71d317123794f7f3a3af3b040adaf8e318fcf81b9a738589',
  initialGuardDigest: '5dc303c138b982f94169a8a1a21c85c54af318a62f225831545e8bd6de921478',
  reconciliationEvidenceDigest: 'e5a26d7749cc680762b4d6fba3304447fbe346611dd91117f3eb9119380f13c0',
  executionLedgerDigest: 'e4197538131a30071fdb8e13e15eb088cf57c9e34f0f7a0775cad53248fea39b'
});
const FIRESTORE_TRANSACTION_MAX_ATTEMPTS = 5;
const EXPECTED_COUNT_SEQUENCE = Object.freeze([12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32]);
const EXECUTION_SEQUENCE = Object.freeze(Array.from({ length: COHORT_SIZE }, (_, index) => {
  const subject = index + 1;
  return [`subject-${subject}-reserve`, `subject-${subject}-verify`, `subject-${subject}-replay`, `subject-${subject}-replay-verify`];
}).flat());
const CONTINUATION_COMPLETED_PREFIX = Object.freeze([
  Object.freeze({ slot: 'A', operation: 'reserve', resultCode: 'SUCCESS', documentCount: 16,
    committedWrites: 4, stateFingerprint: CONTINUATION_STATE_FINGERPRINT })
]);
const CONTINUATION_REMAINING_SEQUENCE = Object.freeze([
  Object.freeze({ slot: 'A', operation: 'exact-replay' }),
  ...['B', 'C', 'D', 'E'].flatMap((slot) => [
    Object.freeze({ slot, operation: 'reserve' }),
    Object.freeze({ slot, operation: 'exact-replay' })
  ])
]);
const CONTINUATION_COUNT_SEQUENCE = Object.freeze([16, 16, 20, 20, 24, 24, 28, 28, 32, 32]);
const D2_BASELINE = Object.freeze({
  totalDocuments: 12,
  accounts: 3,
  trainerHandles: 3,
  rateLimits: 3,
  operationRequests: 3,
  identityMigrations: 0,
  identityConflicts: 0,
  stateDigest: D2_STATE_DIGEST
});
const FINAL_COUNTS = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0
});
const PER_SUBJECT_DELTA = Object.freeze({
  reserveCommittedDocuments: 4,
  replayCommittedDocuments: 0,
  reserveFamilies: Object.freeze(['accounts', 'trainerHandles', 'rateLimits', 'operationRequests']),
  replayMustRemainInSameRateLimitWindow: true
});
const OPERATION_BUDGET = Object.freeze({
  gatewayCalls: 10,
  authorityCalls: 10,
  limitedUseAppCheckTokens: 10,
  logicalFirestoreTransactions: 20,
  firestoreTransactionMaxAttempts: FIRESTORE_TRANSACTION_MAX_ATTEMPTS,
  firestoreTransactionAttemptsExpected: 20,
  firestoreTransactionAttemptsMaximum: 100,
  firestoreOperationReadsExpected: 40,
  firestoreOperationReadsMaximum: 200,
  firestoreCommittedWrites: 20,
  operationRequestCreates: 5,
  rateLimitCreates: 5,
  rateLimitReplayWrites: 0,
  rtdbExactReads: 30,
  rtdbWrites: 0,
  verificationReadsImmediateMaximum: 468,
  verificationReadsObservationMaximum: 42,
  verificationReadsTotalMaximum: 510,
  firestoreReadsExpectedMaximum: 550,
  firestoreReadsRetryCeiling: 710
});
const CONTINUATION_REMAINING_BUDGET = Object.freeze({
  gatewayCalls: 9,
  authorityCalls: 9,
  limitedUseAppCheckTokens: 9,
  logicalFirestoreTransactions: 18,
  firestoreTransactionMaxAttempts: FIRESTORE_TRANSACTION_MAX_ATTEMPTS,
  firestoreTransactionAttemptsExpected: 18,
  firestoreTransactionAttemptsMaximum: 90,
  firestoreOperationReadsExpected: 36,
  firestoreOperationReadsMaximum: 180,
  firestoreCommittedWrites: 16,
  operationRequestCreates: 4,
  rateLimitCreates: 4,
  rateLimitReplayWrites: 0,
  firstWriteSubjects: 4,
  replayOperations: 5,
  rtdbExactReads: 27,
  rtdbWrites: 0
});

function subtractBudget(value, decrement, label) {
  const next = value - decrement;
  if (!Number.isInteger(next) || next < 0) throw new Error(`e1/group-d3-continuation-budget-${label}-invalid`);
  return next;
}

function continuationProgress(completedSuffixOperations = 0) {
  if (!Number.isInteger(completedSuffixOperations) || completedSuffixOperations < 0 ||
      completedSuffixOperations > CONTINUATION_REMAINING_SEQUENCE.length) {
    throw new Error('e1/group-d3-continuation-progress-invalid');
  }
  const budget = { ...CONTINUATION_REMAINING_BUDGET };
  for (const operation of CONTINUATION_REMAINING_SEQUENCE.slice(0, completedSuffixOperations)) {
    for (const [field, decrement] of [
      ['gatewayCalls', 1], ['authorityCalls', 1], ['limitedUseAppCheckTokens', 1],
      ['logicalFirestoreTransactions', 2], ['firestoreTransactionAttemptsExpected', 2],
      ['firestoreTransactionAttemptsMaximum', 10], ['firestoreOperationReadsExpected', 4],
      ['firestoreOperationReadsMaximum', 20], ['rtdbExactReads', 3]
    ]) budget[field] = subtractBudget(budget[field], decrement, field);
    if (operation.operation === 'reserve') {
      for (const [field, decrement] of [
        ['firestoreCommittedWrites', 4], ['operationRequestCreates', 1], ['rateLimitCreates', 1],
        ['firstWriteSubjects', 1]
      ]) budget[field] = subtractBudget(budget[field], decrement, field);
    } else {
      budget.replayOperations = subtractBudget(budget.replayOperations, 1, 'replayOperations');
    }
  }
  return Object.freeze({
    completedSuffixOperations,
    currentDocumentCount: CONTINUATION_COUNT_SEQUENCE[completedSuffixOperations],
    nextOperation: CONTINUATION_REMAINING_SEQUENCE[completedSuffixOperations] || null,
    remainingSequence: Object.freeze(CONTINUATION_REMAINING_SEQUENCE.slice(completedSuffixOperations)),
    remainingBudget: Object.freeze(budget),
    complete: completedSuffixOperations === CONTINUATION_REMAINING_SEQUENCE.length
  });
}
const OBSERVATION_CHECKS = Object.freeze([
  'exact-firestore-count-and-canonical-digest',
  'family-counts',
  'migration-conflict-absence',
  'replay-collision-anomalies',
  'authority-gateway-5xx',
  'oidc-app-check-anomalies',
  'authority-privacy-public-exposure',
  'iam-drift',
  'reciprocal-rtdb-ownership',
  'cost-log-anomalies',
  'temporary-gates-restored'
]);
const ELIGIBILITY_FIELDS = Object.freeze([
  'reciprocalLegacyOwnershipVerified',
  'loginDirectoryReady',
  'identityAmbiguityAbsent',
  'migrationEvidenceAbsent',
  'conflictEvidenceAbsent',
  'existingAccountAbsent',
  'existingHandleAbsent',
  'existingOperationRequestAbsent',
  'existingRateLimitAbsent',
  'competingHandleAbsent',
  'priorCohortMemberAbsent',
  'adminOrSystemIdentityAbsent'
]);
const ALLOWED_OPERATIONS = Object.freeze([
  'verify-exact-d2-baseline',
  'verify-five-bound-subjects',
  'verify-subject-eligibility-and-distinctness',
  'verify-targeted-authority-absence',
  'verify-runtime-provenance-and-privacy',
  'verify-operation-budget',
  'enable-gateway',
  'enable-reserve',
  ...Array.from({ length: COHORT_SIZE }, (_, index) => {
    const subject = index + 1;
    return [
      `subject-${subject}-reserve`,
      `verify-subject-${subject}-reserve`,
      `subject-${subject}-exact-replay`,
      `verify-subject-${subject}-replay`
    ];
  }).flat(),
  'restore-reserve',
  'restore-gateway',
  'start-24-hour-observation'
]);
const STOP_POLICY = Object.freeze({
  sequentialOnly: true,
  stopBeforeNextSubjectOnAnyFailure: true,
  restoreTemporaryGatesAfterAnyOutcome: true,
  preserveDurableEvidence: true,
  deleteSuccessfulIdentityState: false,
  groupEActivationAllowed: false
});
const DEFAULT_SUBJECT_BINDING = Object.freeze({
  cohortType: SYNTHETIC_COHORT_TYPE,
  evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
  state: 'unbound',
  cohortSize: 0,
  bindingDigest: null,
  subjectsBound: false,
  executionAuthorized: false
});
const CANDIDATE_POOL_POLICY = Object.freeze({
  cohortType: SYNTHETIC_COHORT_TYPE,
  evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
  acquisitionMode: 'guarded-synthetic-setup-exact-five',
  candidatePoolSize: COHORT_SIZE,
  automatedProductionDiscovery: false,
  toolingSelectsSubjects: false,
  fallbackCandidateSubstitution: false,
  canonicalOrder: 'privacy-safe-subject-fingerprint',
  poolValidationAuthorizesExecution: false
});
const READINESS_TIMING_POLICY = Object.freeze({
  mode: 'pre-enable-jit-v1',
  entryEvidenceMaxAgeMs: ENTRY_EVIDENCE_MAX_AGE_MS,
  requiredAt: 'enable-group-d3',
  requiredAfterEnable: false,
  mutationWindowMaxHours: MAX_WINDOW_HOURS,
  mutationWindowGovernsPostEnable: true,
  restoreAllowedAfterExpiry: true
});
const EXPECTED_D3_MANIFEST = Object.freeze({
  approvalGroup: 'D',
  cohortStage: 'D3',
  purpose: 'final-pre-group-e-reserve-cohort-validation',
  operation: 'reserve-plus-exact-replay',
  cohortSize: COHORT_SIZE,
  candidatePool: CANDIDATE_POOL_POLICY,
  subjectBinding: DEFAULT_SUBJECT_BINDING,
  readinessTiming: READINESS_TIMING_POLICY,
  maxWindowHours: MAX_WINDOW_HOURS,
  rateLimiterMode: DURABLE_MODE,
  d2Baseline: D2_BASELINE,
  documentProgression: EXPECTED_COUNT_SEQUENCE,
  perSubjectDelta: PER_SUBJECT_DELTA,
  finalCounts: FINAL_COUNTS,
  operationBudget: OPERATION_BUDGET,
  executionSequence: EXECUTION_SEQUENCE,
  stopPolicy: STOP_POLICY,
  observationHours: OBSERVATION_HOURS,
  observationChecks: OBSERVATION_CHECKS,
  laterGroupsAuthorized: false,
  groupEAuthorized: false
});

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function continuationPreflightDigest(value) {
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-continuation-preflight',
    value?.purpose,
    value?.environment,
    value?.projectId,
    value?.projectNumber,
    value?.region,
    value?.databaseId,
    value?.rtdbDatabaseUrl,
    value?.productionRuntime,
    value?.appId,
    value?.approvalGroup,
    value?.cohortStage,
    value?.cohortType,
    value?.evidencePurpose,
    value?.candidatePoolDigest,
    value?.bindingFileSha,
    value?.bindingDigest,
    value?.historicalAdmission,
    value?.interruptedSession,
    value?.reconciliation,
    value?.completedPrefix,
    value?.nextOperation,
    value?.currentState,
    value?.candidateState,
    value?.remainingBudget,
    value?.remainingSequence,
    value?.expectedCountSequence,
    value?.currentGates,
    value?.runtimeProvenance,
    value?.securityBoundary,
    value?.writeBoundary,
    value?.preflight?.verifiedAt,
    value?.preflight?.expiresAt
  ]));
}

function continuationArtifactDigest(value) {
  const copy = { ...value };
  delete copy.artifactDigest;
  return sha256(JSON.stringify([1, 'e1-group-d3-continuation-artifact', copy]));
}

function continuationJitDigest(value) {
  const copy = { ...value };
  delete copy.jitDigest;
  return sha256(JSON.stringify([1, 'e1-group-d3-continuation-jit', copy]));
}

function canonicalCandidateKey(candidate) {
  return [candidate.subjectHashes.uidHash, candidate.handle.handleKey, candidate.subjectHashes.trainerHash].join(':');
}

function canonicalCandidateOrder(candidates) {
  return [...candidates].sort((left, right) => {
    const leftKey = canonicalCandidateKey(left);
    const rightKey = canonicalCandidateKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function candidatePoolDigest(candidates, syntheticSetupDigest) {
  if (!/^[a-f0-9]{64}$/u.test(syntheticSetupDigest || '')) {
    throw new Error('e1/group-d3-synthetic-setup-digest-invalid');
  }
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-synthetic-candidate-pool',
    SYNTHETIC_COHORT_TYPE,
    EXECUTION_EVIDENCE_PURPOSE,
    syntheticSetupDigest,
    D2_STATE_DIGEST,
    canonicalCandidateOrder(candidates).map((candidate) => ({
      uidHash: candidate.subjectHashes.uidHash,
      trainerHash: candidate.subjectHashes.trainerHash,
      handleKey: candidate.handle.handleKey
    }))
  ]));
}

function subjectBindingDigest(priorCohort, candidates, poolDigest) {
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-synthetic-subject-binding',
    SYNTHETIC_COHORT_TYPE,
    EXECUTION_EVIDENCE_PURPOSE,
    D2_STATE_DIGEST,
    poolDigest,
    priorCohort,
    candidates.map((candidate) => ({
      slot: candidate.slot,
      uidHash: candidate.subjectHashes.uidHash,
      trainerHash: candidate.subjectHashes.trainerHash,
      handleKey: candidate.handle.handleKey,
      requestIdHash: candidate.request.requestIdHash,
      requestBodyHash: candidate.request.requestBodyHash,
      foundationFingerprint: candidate.request.foundationFingerprint
    }))
  ]));
}

function expectedDocumentCount(step) {
  if (!Number.isSafeInteger(step) || step < 0 || step >= EXPECTED_COUNT_SEQUENCE.length) {
    throw new Error('e1/group-d3-sequence-step-invalid');
  }
  return EXPECTED_COUNT_SEQUENCE[step];
}

function readinessContract(sourceSha) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha || '')) throw new Error('e1/group-d3-source-sha-invalid');
  return Object.freeze({
    schemaVersion: 1,
    sourceSha,
    timingPolicy: READINESS_TIMING_POLICY
  });
}

function parseMutationWindow(mutationWindow) {
  const startAt = Date.parse(mutationWindow?.startAt);
  const endAt = Date.parse(mutationWindow?.endAt);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt ||
      endAt - startAt > MAX_WINDOW_HOURS * 60 * 60 * 1000) {
    throw new Error('e1/group-d3-mutation-window-invalid');
  }
  return Object.freeze({ startAt, endAt });
}

function validateThirdMutationEntryTiming({ at, mutationWindow, entryEvidenceExpiresAt }) {
  const window = parseMutationWindow(mutationWindow);
  const evidenceExpiry = Date.parse(entryEvidenceExpiresAt);
  if (!Number.isFinite(at) || !Number.isFinite(evidenceExpiry) || at < window.startAt || at >= window.endAt ||
      at > evidenceExpiry) {
    throw new Error('e1/group-d3-entry-timing-invalid');
  }
  return Object.freeze({
    entryEvidenceFreshAtEnable: true,
    entryEvidenceExpiresAt: new Date(evidenceExpiry).toISOString(),
    mutationWindowStart: new Date(window.startAt).toISOString(),
    mutationWindowEnd: new Date(window.endAt).toISOString()
  });
}

function validateThirdMutationExecutionTiming({ enabledAt, operationAt, mutationWindow, entryEvidenceExpiresAt }) {
  const entry = validateThirdMutationEntryTiming({
    at: enabledAt,
    mutationWindow,
    entryEvidenceExpiresAt
  });
  const operation = typeof operationAt === 'number' ? operationAt : Date.parse(operationAt);
  if (!Number.isFinite(operation) || operation < enabledAt || operation >= Date.parse(entry.mutationWindowEnd)) {
    throw new Error('e1/group-d3-execution-timing-invalid');
  }
  return Object.freeze({
    ...entry,
    operationAt: new Date(operation).toISOString(),
    entryEvidenceRequiredAfterEnable: false,
    mutationWindowGovernsPostEnable: true
  });
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  CANDIDATE_POOL_POLICY,
  COHORT_SIZE,
  CONTINUATION_ARTIFACT_PURPOSE: CONTINUATION_PURPOSE,
  CONTINUATION_COMPLETED_PREFIX,
  CONTINUATION_COUNT_SEQUENCE,
  CONTINUATION_JIT_PURPOSE,
  CONTINUATION_PINS,
  CONTINUATION_PRODUCTION_RUNTIME,
  CONTINUATION_REMAINING_BUDGET,
  CONTINUATION_REMAINING_SEQUENCE,
  CONTINUATION_STATE_FINGERPRINT,
  D2_BASELINE,
  D2_STATE_DIGEST,
  DEFAULT_SUBJECT_BINDING,
  ENTRY_EVIDENCE_MAX_AGE_MS,
  ELIGIBILITY_FIELDS,
  EXECUTION_SEQUENCE,
  EXPECTED_COUNT_SEQUENCE,
  EXPECTED_D3_MANIFEST,
  EXECUTION_EVIDENCE_PURPOSE,
  FINAL_COUNTS,
  FIRESTORE_TRANSACTION_MAX_ATTEMPTS,
  MAX_WINDOW_HOURS,
  OBSERVATION_CHECKS,
  OBSERVATION_HOURS,
  OPERATION_BUDGET,
  PER_SUBJECT_DELTA,
  READINESS_TIMING_POLICY,
  REAL_WORLD_EVIDENCE_TYPE,
  STOP_POLICY,
  SYNTHETIC_COHORT_TYPE,
  candidatePoolDigest,
  canonicalCandidateKey,
  canonicalCandidateOrder,
  continuationProgress,
  expectedDocumentCount,
  continuationArtifactDigest,
  continuationJitDigest,
  continuationPreflightDigest,
  readinessContract,
  sha256,
  subjectBindingDigest,
  validateThirdMutationEntryTiming,
  validateThirdMutationExecutionTiming
});
