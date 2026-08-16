'use strict';

const crypto = require('node:crypto');
const { DURABLE_MODE } = require('../e1-authority-service/readRateLimiters');

const D2_STATE_DIGEST = '2923aafa890de58cb04fb5941528f7a425c22d0a131dd9fc0fcf71013468bf0b';
const COHORT_SIZE = 5;
const OBSERVATION_HOURS = 24;
const MAX_WINDOW_HOURS = 2;
const ENTRY_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
const FIRESTORE_TRANSACTION_MAX_ATTEMPTS = 5;
const EXPECTED_COUNT_SEQUENCE = Object.freeze([12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32]);
const EXECUTION_SEQUENCE = Object.freeze(Array.from({ length: COHORT_SIZE }, (_, index) => {
  const subject = index + 1;
  return [`subject-${subject}-reserve`, `subject-${subject}-verify`, `subject-${subject}-replay`, `subject-${subject}-replay-verify`];
}).flat());
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
  state: 'unbound',
  cohortSize: 0,
  bindingDigest: null,
  subjectsBound: false,
  executionAuthorized: false
});
const CANDIDATE_POOL_POLICY = Object.freeze({
  acquisitionMode: 'operator-supplied-exact-five',
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

function candidatePoolDigest(candidates) {
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-private-candidate-pool',
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
    'e1-group-d3-subject-binding',
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
  D2_BASELINE,
  D2_STATE_DIGEST,
  DEFAULT_SUBJECT_BINDING,
  ENTRY_EVIDENCE_MAX_AGE_MS,
  ELIGIBILITY_FIELDS,
  EXECUTION_SEQUENCE,
  EXPECTED_COUNT_SEQUENCE,
  EXPECTED_D3_MANIFEST,
  FINAL_COUNTS,
  FIRESTORE_TRANSACTION_MAX_ATTEMPTS,
  MAX_WINDOW_HOURS,
  OBSERVATION_CHECKS,
  OBSERVATION_HOURS,
  OPERATION_BUDGET,
  PER_SUBJECT_DELTA,
  READINESS_TIMING_POLICY,
  STOP_POLICY,
  candidatePoolDigest,
  canonicalCandidateKey,
  canonicalCandidateOrder,
  expectedDocumentCount,
  readinessContract,
  sha256,
  subjectBindingDigest,
  validateThirdMutationEntryTiming,
  validateThirdMutationExecutionTiming
});
