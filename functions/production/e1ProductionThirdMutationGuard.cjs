'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { DURABLE_MODE, readProofSubjectHash } = require('../e1-authority-service/readRateLimiters');
const {
  ALL_GATES,
  EXPECTED_APP_ID,
  EXPECTED_TOKEN_VERIFIER,
  activationGatePlan,
  disabledGatePlan
} = require('./e1ProductionFirstMutationGuard.cjs');
const {
  ALLOWED_OPERATIONS,
  CANDIDATE_POOL_POLICY,
  COHORT_SIZE,
  CONTINUATION_ACCEPTED_USAGE,
  CONTINUATION_ARTIFACT_PURPOSE,
  CONTINUATION_COMPLETED_PREFIX,
  CONTINUATION_COUNT_SEQUENCE,
  CONTINUATION_JIT_PURPOSE,
  CONTINUATION_PINS,
  CONTINUATION_PRODUCTION_RUNTIME,
  CONTINUATION_REMAINING_BUDGET,
  CONTINUATION_REMAINING_SEQUENCE,
  CONTINUATION_STATE_FINGERPRINT,
  D2_BASELINE,
  ENTRY_EVIDENCE_MAX_AGE_MS,
  ELIGIBILITY_FIELDS,
  EXECUTION_SEQUENCE,
  EXPECTED_COUNT_SEQUENCE,
  EXPECTED_D3_MANIFEST,
  EXECUTION_EVIDENCE_PURPOSE,
  FINAL_COUNTS,
  OBSERVATION_CHECKS,
  OBSERVATION_HOURS,
  OPERATION_BUDGET,
  STOP_POLICY,
  SYNTHETIC_COHORT_TYPE,
  candidatePoolDigest,
  canonicalCandidateOrder,
  continuationArtifactDigest,
  continuationJitDigest,
  continuationPreflightDigest,
  continuationProgress,
  readinessContract,
  sha256,
  subjectBindingDigest,
  validateThirdMutationEntryTiming
} = require('./e1ProductionThirdMutationContract.cjs');
const {
  validateBrowserHarnessArtifact
} = require('./e1ProductionThirdMutationBrowserHarness.cjs');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_CANDIDATE_POOL_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-candidate-pool.json');
const PRIVATE_BINDING_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-subjects.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-activation.json');
const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-guard-input.json');
const PRIVATE_BROWSER_HARNESS_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-browser-harness.json');
const PRIVATE_SYNTHETIC_CANDIDATE_POOL_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-candidate-pool-synthetic.json');
const PRIVATE_SYNTHETIC_BINDING_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-subjects-synthetic.json');
const PRIVATE_CONTINUATION_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-continuation.json');
const PRIVATE_CONTINUATION_JIT_PATH = path.resolve(__dirname, '../.local/e1-production-third-mutation-continuation-activation.json');
const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_EVIDENCE_AGE_MS = ENTRY_EVIDENCE_MAX_AGE_MS;
const SLOTS = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const ENABLE_CONFIRMATION = 'ENABLE E1 GROUP D3 RESERVE COHORT';
const RESTORE_CONFIRMATION = 'RESTORE E1 GROUP D3 GATES';
const REQUEST_ID = /^group-d3-[a-e]-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SAFE_HASH = /^[a-f0-9]{16}$/u;
const RATE_LIMIT_PATH = /^rateLimits\/reserveTrainerHandle_[a-f0-9]{16}$/u;
const REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const BINDING_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'cohortStage', 'cohortType', 'evidencePurpose', 'cohortSize', 'state', 'subjectsBound',
  'executionAuthorized', 'acquisitionMode', 'candidatePoolDigest', 'boundAt', 'humanReviewed', 'priorCohort',
  'syntheticSetupDigest', 'candidates', 'bindingDigest'
]);
const CANDIDATE_POOL_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'cohortStage', 'cohortType', 'evidencePurpose', 'acquisitionMode', 'candidateCount',
  'humanSupplied', 'suppliedAt', 'candidates', 'candidatePoolDigest', 'executionAuthorized',
  'syntheticSetupDigest', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const CANDIDATE_POOL_SUBJECT_FIELDS = Object.freeze(['firebaseUid', 'trainerUsername', 'syntheticCanary']);
const PRIOR_COHORT_FIELDS = Object.freeze(['d2StateDigest', 'members', 'humanReviewed', 'evidenceDigest']);
const PRIOR_MEMBER_FIELDS = Object.freeze(['uidHash', 'trainerHash', 'handleKey']);
const CANDIDATE_FIELDS = Object.freeze([
  'slot', 'reviewedSubject', 'subjectHashes', 'handle', 'request', 'authEligibility', 'eligibility',
  'targetedAuthorityState', 'review'
]);
const SUBJECT_FIELDS = Object.freeze(['firebaseUid', 'trainerUsername']);
const SUBJECT_HASH_FIELDS = Object.freeze(['uidHash', 'trainerHash']);
const HANDLE_FIELDS = Object.freeze(['canonical', 'normalized', 'handleKey']);
const REQUEST_FIELDS = Object.freeze([
  'requestId', 'requestIdHash', 'requestBodyHash', 'foundationFingerprint', 'rateLimitDocumentPath',
  'rateLimitPathDerivationVerified'
]);
const AUTH_FIELDS = Object.freeze([
  'mode', 'verifiedAt', 'userExists', 'disabledState', 'appId', 'appCheckObtainable',
  'currentUidHash', 'currentTrainerHash'
]);
const TARGETED_FIELDS = Object.freeze([
  'verifiedAt', 'accountAbsent', 'handleAbsent', 'operationRequestAbsent', 'reserveRateLimitAbsent',
  'migrationAbsent', 'conflictAbsent', 'competingHandleAbsent'
]);
const REVIEW_FIELDS = Object.freeze(['humanReviewed', 'reviewedAt', 'selectionSource']);
const READINESS_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'projectNumber', 'region', 'firestoreDatabaseId', 'rtdbDatabaseUrl',
  'approvalGroup', 'cohortStage', 'cohortType', 'evidencePurpose', 'contractDefined', 'subjectsBindingDigest', 'browserHarnessDigest', 'subjectsBound', 'executionAuthorized',
  'approvedAt', 'humanOperator', 'teardownOwner', 'approvalAcknowledged', 'teardownOwnerAcknowledged',
  'readinessContract', 'mutationWindow', 'authorizedOperations', 'd2Baseline', 'runtimeProvenance', 'activationGatePlan',
  'restorationGatePlan', 'operationBudget', 'executionSequence', 'observationHours', 'observationChecks',
  'stopPolicy', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const INPUT_FIELDS = Object.freeze([
  'environment', 'projectId', 'projectNumber', 'expectedProjectNumber', 'region', 'databaseId', 'rtdbDatabaseUrl',
  'approvalGroup', 'cohortStage', 'cohortType', 'evidencePurpose', 'subjectsBindingDigest', 'browserHarnessDigest', 'subjectsBound', 'executionAuthorized', 'requestedOperations',
  'readinessContract', 'd2Baseline', 'currentGates', 'activationGatePlan', 'restorationGatePlan', 'runtimeProvenance', 'securityBoundary',
  'tokenVerifier', 'rateLimiterMode', 'readProofModePresent', 'reserveConsumesLimitedUseAppCheck', 'operationBudget',
  'expectedCountSequence', 'executionSequence', 'observationHours', 'observationChecks', 'stopPolicy',
  'writeBoundary', 'finalAcceptanceTemplate', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const RUNTIME_FIELDS = Object.freeze([
  'authorityService', 'authorityOrigin', 'authorityRevision', 'authorityImageDigest', 'runtimeServiceAccount',
  'gatewayServiceAccount', 'reviewed'
]);
const SECURITY_FIELDS = Object.freeze([
  'authorityPrivate', 'gatewayRuntimeSoleAuthorityInvoker', 'publicAuthorityInvoker', 'projectWideRunInvoker',
  'gatewayForbiddenRolesPresent', 'runtimeIamDrift', 'productionDebugTokensRegistered'
]);
const WRITE_BOUNDARY_FIELDS = Object.freeze([
  'legacyLoginWrites', 'e1AuthorityWrites', 'controlPlaneWrites', 'unexpectedWrites'
]);
const ACCEPTANCE_FIELDS = Object.freeze([
  'executedSubjects', 'reserveSuccesses', 'replaySuccesses', 'finalCounts', 'finalStateDigest',
  'sequenceMatched', 'ownershipReciprocal', 'anomaliesAbsent', 'gatesRestored', 'observationCompleted',
  'observationHealthy', 'groupEAuthorized', 'accepted'
]);
const ACCEPTANCE_EVIDENCE_FIELDS = Object.freeze([
  'schemaVersion', 'cohortStage', 'cohortType', 'subjectsBindingDigest', 'executedSubjects', 'reserveSuccesses', 'replaySuccesses',
  'steps', 'finalCounts', 'finalStateDigest', 'ownershipReciprocal', 'anomaliesAbsent', 'gatesRestored',
  'observation', 'unexpectedCostOrLogAnomaly', 'groupEAuthorized', 'accepted'
]);
const STEP_FIELDS = Object.freeze([
  'sequence', 'slot', 'operation', 'resultCode', 'documentCount', 'stateDigest', 'committedWrites',
  'requestFingerprintCoherent', 'ownershipReciprocal', 'rateLimitValid', 'migrationConflictAbsent', 'anomaliesAbsent'
]);
const OBSERVATION_FIELDS = Object.freeze([
  'startAt', 'endAt', 'durationHours', 'completed', 'healthy', 'stateDigestAccepted', 'familyCountsVerified',
  'migrationConflictAbsent', 'serviceAuthAnomaliesAbsent', 'privacyIamDriftAbsent', 'costLogAnomaliesAbsent'
]);
const CONTINUATION_FIELDS = Object.freeze([
  'schemaVersion', 'purpose', 'environment', 'projectId', 'projectNumber', 'region', 'databaseId', 'rtdbDatabaseUrl',
  'productionRuntime', 'appId', 'approvalGroup', 'cohortStage', 'cohortType', 'evidencePurpose', 'candidatePoolDigest',
  'bindingFileSha', 'bindingDigest', 'historicalAdmission', 'interruptedSession', 'reconciliation', 'completedPrefix',
  'acceptedUsage', 'nextOperation', 'currentState', 'candidateState', 'remainingSequence', 'expectedCountSequence', 'remainingBudget', 'currentGates',
  'runtimeProvenance', 'securityBoundary', 'writeBoundary', 'preflight', 'historicalEvidenceRecollectionRequired',
  'executionAuthorized', 'laterGroupsAuthorized', 'groupEAuthorized', 'artifactDigest'
]);
const CONTINUATION_HISTORY_FIELDS = Object.freeze([
  'admittedAt', 'browserHarnessDigest', 'browserHarnessFileSha', 'initialJitDigest', 'initialReadinessDigest',
  'initialGuardDigest', 'originalEvidenceValidAtAdmission'
]);
const CONTINUATION_SESSION_FIELDS = Object.freeze(['sessionIdHash', 'state', 'closedAt', 'closeReason']);
const CONTINUATION_RECONCILIATION_FIELDS = Object.freeze([
  'acceptedRolloverEvidenceDigest', 'evidenceDigest', 'executionLedgerDigest', 'verifiedAt',
  'aReserveInvocations', 'aReplayInvocations', 'laterSlotInvocations',
  'acceptedHistoricalRateLimitReplayWrites', 'remainingRateLimitReplayWrites', 'previousStateFingerprint',
  'currentStateFingerprint'
]);
const CONTINUATION_STATE_FIELDS = Object.freeze([
  'totalDocuments', 'accounts', 'trainerHandles', 'rateLimits', 'operationRequests', 'identityMigrations',
  'identityConflicts', 'unexpectedPaths', 'ordinaryUserEffects', 'canonicalFingerprint'
]);
const CONTINUATION_CANDIDATE_STATE_FIELDS = Object.freeze([
  'slot', 'uidHash', 'trainerHash', 'handleKey', 'requestIdHash', 'requestBodyHash', 'foundationFingerprint',
  'rateLimitDocumentPath', 'accountState', 'handleState', 'rateLimitState', 'operationRequestCount',
  'ownershipReciprocal', 'requestBindingVerified', 'replayEvidenceCount'
]);
const CONTINUATION_PREFLIGHT_FIELDS = Object.freeze(['verifiedAt', 'expiresAt', 'digest']);
const CONTINUATION_JIT_FIELDS = Object.freeze([
  'schemaVersion', 'purpose', 'continuationArtifactDigest', 'continuationPreflightDigest',
  'continuationContractSourceSha', 'approvedAt', 'entryEvidenceExpiresAt', 'humanOperator', 'teardownOwner',
  'approvalAcknowledged', 'teardownOwnerAcknowledged', 'mutationWindow', 'nextOperation', 'remainingSequence', 'expectedCountSequence',
  'acceptedUsage', 'remainingBudget', 'activationGatePlan', 'restorationGatePlan', 'executionAuthorized', 'laterGroupsAuthorized',
  'groupEAuthorized', 'jitDigest'
]);
const CONTINUATION_OBSERVATION_START_FIELDS = Object.freeze([
  'completedSuffixOperations', 'acceptedUsage', 'remainingBudget', 'finalCounts', 'finalStateDigest', 'gatesRestored', 'securityBoundary',
  'anomaliesAbsent', 'startedAt', 'observationHours', 'groupEAuthorized'
]);

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && sameValues(Object.keys(value), fields);
}

function privateMode(file) {
  try { return (fs.statSync(file).mode & 0o777) === 0o600; } catch { return false; }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fileSha256(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validIdentity(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && !/[\r\n\/#$\[\]]/u.test(value);
}

function validFirebaseUid(value) {
  return validIdentity(value) && value.length <= 128 && value === value.trim() && value === value.normalize('NFKC');
}

function subjectHashesFor(subject) {
  return Object.freeze({
    uidHash: readProofSubjectHash('uid', subject.firebaseUid),
    trainerHash: readProofSubjectHash('trainer', subject.trainerUsername)
  });
}

function canonicalPoolCandidate(subject) {
  if (!exactFields(subject, CANDIDATE_POOL_SUBJECT_FIELDS) || !validFirebaseUid(subject.firebaseUid) ||
      !validIdentity(subject.trainerUsername) || subject.syntheticCanary !== true) {
    throw new Error('group_d3_candidate_pool_subject_invalid');
  }
  const normalized = normalizeHandle(subject.trainerUsername);
  const reviewedSubject = Object.freeze({
    firebaseUid: subject.firebaseUid,
    trainerUsername: normalized.display
  });
  return Object.freeze({
    reviewedSubject,
    subjectHashes: subjectHashesFor(reviewedSubject),
    handle: Object.freeze({
      canonical: normalized.display,
      normalized: normalized.normalized,
      handleKey: normalized.handleKey
    })
  });
}

function validateCandidatePoolArtifact(pool, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const poolPath = options.candidatePoolPath || PRIVATE_CANDIDATE_POOL_PATH;
  if (!privateMode(poolPath)) errors.push('group_d3_candidate_pool_permissions_invalid');
  if (!exactFields(pool, CANDIDATE_POOL_FIELDS) || pool.schemaVersion !== 1 || pool.environment !== 'production' ||
      pool.projectId !== 'trade-list-a4297' || pool.cohortStage !== 'D3' ||
      pool.cohortType !== SYNTHETIC_COHORT_TYPE || pool.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
      pool.acquisitionMode !== CANDIDATE_POOL_POLICY.acquisitionMode || pool.candidateCount !== COHORT_SIZE ||
      pool.humanSupplied !== true || !Number.isFinite(Date.parse(pool.suppliedAt)) || Date.parse(pool.suppliedAt) > now ||
      !Array.isArray(pool.candidates) || pool.candidates.length !== COHORT_SIZE || !HASH.test(pool.candidatePoolDigest || '') ||
      !HASH.test(pool.syntheticSetupDigest || '') || pool.executionAuthorized !== false ||
      pool.laterGroupsAuthorized !== false || pool.groupEAuthorized !== false) {
    errors.push('group_d3_candidate_pool_schema_invalid');
  }
  const canonicalCandidates = [];
  if (Array.isArray(pool?.candidates)) {
    for (const subject of pool.candidates) {
      try { canonicalCandidates.push(canonicalPoolCandidate(subject)); }
      catch { errors.push('group_d3_candidate_pool_subject_invalid'); }
    }
  }
  if (canonicalCandidates.length === COHORT_SIZE) {
    const rawSubjects = pool.candidates.map((subject) => `${subject.firebaseUid}\u0000${subject.trainerUsername}`);
    if (new Set(rawSubjects).size !== rawSubjects.length) errors.push('group_d3_candidate_pool_raw_duplicate');
    for (const field of ['uidHash', 'trainerHash']) {
      const values = canonicalCandidates.map((candidate) => candidate.subjectHashes[field]);
      if (new Set(values).size !== values.length) errors.push('group_d3_candidate_pool_normalized_duplicate');
    }
    const handles = canonicalCandidates.map((candidate) => candidate.handle.handleKey);
    if (new Set(handles).size !== handles.length) errors.push('group_d3_candidate_pool_normalized_duplicate');
    const ordered = canonicalCandidateOrder(canonicalCandidates);
    if (pool.candidatePoolDigest !== candidatePoolDigest(ordered, pool.syntheticSetupDigest)) {
      errors.push('group_d3_candidate_pool_digest_mismatch');
    }
    canonicalCandidates.splice(0, canonicalCandidates.length, ...ordered);
  }
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-candidate-pool-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  const result = {
    ok: true,
    mode: 'candidate-pool-schema-validation',
    acquisitionMode: CANDIDATE_POOL_POLICY.acquisitionMode,
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    candidateCount: COHORT_SIZE,
    candidatePoolDigest: pool.candidatePoolDigest,
    syntheticSetupDigest: pool.syntheticSetupDigest,
    canonicalOrderVerified: true,
    subjectsBound: false,
    executionAuthorized: false,
    automatedProductionDiscovery: false,
    fallbackCandidateSubstitution: false,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  };
  Object.defineProperty(result, 'canonicalCandidates', {
    value: Object.freeze([...canonicalCandidates]),
    enumerable: false
  });
  return Object.freeze(result);
}

function requestIdHash(requestId) {
  return sha256(JSON.stringify([1, 'group-d3-request-id', requestId]));
}

function requestBodyHash(requestId, canonicalHandle) {
  return sha256(JSON.stringify([1, 'group-d3-reserve-body', 1, requestId, canonicalHandle]));
}

function foundationFingerprint(subject, handle) {
  return sha256(JSON.stringify([
    1,
    subject.firebaseUid,
    subject.trainerUsername,
    handle.normalized,
    handle.handleKey
  ]));
}

function validD2Baseline(value) {
  return exactFields(value, Object.keys(D2_BASELINE)) && sameJson(value, D2_BASELINE);
}

function fresh(value, now, start) {
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= start && at <= now && now - at <= MAX_EVIDENCE_AGE_MS;
}

function entryEvidenceExpiresAt(binding) {
  if (!Array.isArray(binding?.candidates) || binding.candidates.length !== COHORT_SIZE) return null;
  const timestamps = binding.candidates.flatMap((candidate) => [
    Date.parse(candidate.authEligibility?.verifiedAt),
    Date.parse(candidate.targetedAuthorityState?.verifiedAt)
  ]);
  if (timestamps.length !== COHORT_SIZE * 2 || timestamps.some((value) => !Number.isFinite(value))) return null;
  return new Date(Math.min(...timestamps) + MAX_EVIDENCE_AGE_MS).toISOString();
}

function validatePriorCohort(prior, errors) {
  if (!exactFields(prior, PRIOR_COHORT_FIELDS) || prior.d2StateDigest !== D2_BASELINE.stateDigest ||
      prior.humanReviewed !== true || !HASH.test(prior.evidenceDigest || '') || !Array.isArray(prior.members) ||
      prior.members.length !== 3 || prior.members.some((member) => !exactFields(member, PRIOR_MEMBER_FIELDS) ||
        !HASH.test(member.uidHash || '') || !HASH.test(member.trainerHash || '') || !/^v1_[a-f0-9]+$/u.test(member.handleKey || ''))) {
    errors.push('group_d3_prior_cohort_invalid');
    return;
  }
  const values = prior.members.flatMap((member) => [member.uidHash, member.trainerHash, member.handleKey]);
  if (new Set(values).size !== values.length) errors.push('group_d3_prior_cohort_not_distinct');
}

function validateCandidate(candidate, slot, prior, now, windowStart, errors) {
  if (!exactFields(candidate, CANDIDATE_FIELDS) || candidate.slot !== slot) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_schema_invalid`);
    return;
  }
  const subject = candidate.reviewedSubject;
  if (!exactFields(subject, SUBJECT_FIELDS) || !validIdentity(subject.firebaseUid) || !validIdentity(subject.trainerUsername) ||
      !exactFields(candidate.subjectHashes, SUBJECT_HASH_FIELDS) || !sameJson(candidate.subjectHashes, subjectHashesFor(subject))) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_subject_invalid`);
  }
  let normalized;
  try { normalized = normalizeHandle(candidate.handle?.canonical); } catch { normalized = null; }
  if (!exactFields(candidate.handle, HANDLE_FIELDS) || !normalized || normalized.display !== candidate.handle.canonical ||
      normalized.normalized !== candidate.handle.normalized || normalized.handleKey !== candidate.handle.handleKey) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_handle_invalid`);
  }
  const request = candidate.request;
  if (!exactFields(request, REQUEST_FIELDS) || !REQUEST_ID.test(request.requestId || '') ||
      !request.requestId.startsWith(`group-d3-${slot.toLowerCase()}-`) ||
      request.requestIdHash !== requestIdHash(request.requestId) ||
      request.requestBodyHash !== requestBodyHash(request.requestId, candidate.handle?.canonical) ||
      request.foundationFingerprint !== foundationFingerprint(subject, candidate.handle) ||
      !RATE_LIMIT_PATH.test(request.rateLimitDocumentPath || '') || request.rateLimitPathDerivationVerified !== true) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_request_invalid`);
  }
  if (!exactFields(candidate.authEligibility, AUTH_FIELDS) ||
      !['exact-auth-metadata', 'verified-browser-login'].includes(candidate.authEligibility.mode) ||
      !fresh(candidate.authEligibility.verifiedAt, now, windowStart) || candidate.authEligibility.userExists !== true ||
      !['false', 'not-independently-observed'].includes(candidate.authEligibility.disabledState) ||
      candidate.authEligibility.appId !== EXPECTED_APP_ID || candidate.authEligibility.appCheckObtainable !== true ||
      candidate.authEligibility.currentUidHash !== candidate.subjectHashes.uidHash ||
      candidate.authEligibility.currentTrainerHash !== candidate.subjectHashes.trainerHash ||
      (candidate.authEligibility.mode === 'exact-auth-metadata' && candidate.authEligibility.disabledState !== 'false') ||
      (candidate.authEligibility.mode === 'verified-browser-login' &&
        candidate.authEligibility.disabledState !== 'not-independently-observed')) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_auth_invalid`);
  }
  if (!exactFields(candidate.eligibility, ELIGIBILITY_FIELDS) ||
      ELIGIBILITY_FIELDS.some((field) => candidate.eligibility[field] !== true)) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_ineligible`);
  }
  if (!exactFields(candidate.targetedAuthorityState, TARGETED_FIELDS) ||
      !fresh(candidate.targetedAuthorityState.verifiedAt, now, windowStart) ||
      TARGETED_FIELDS.slice(1).some((field) => candidate.targetedAuthorityState[field] !== true)) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_targeted_state_invalid`);
  }
  if (!exactFields(candidate.review, REVIEW_FIELDS) || candidate.review.humanReviewed !== true ||
      candidate.review.selectionSource !== 'guarded-private-d3-synthetic-canary' ||
      !Number.isFinite(Date.parse(candidate.review.reviewedAt)) || Date.parse(candidate.review.reviewedAt) > now) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_review_invalid`);
  }
  if (prior?.members?.some((member) => member.uidHash === candidate.subjectHashes?.uidHash ||
      member.trainerHash === candidate.subjectHashes?.trainerHash || member.handleKey === candidate.handle?.handleKey)) {
    errors.push(`group_d3_candidate_${slot.toLowerCase()}_prior_cohort_overlap`);
  }
}

function validateBinding(binding, poolResult, now, windowStart, errors) {
  if (!exactFields(binding, BINDING_FIELDS) || binding.schemaVersion !== 1 || binding.environment !== 'production' ||
      binding.projectId !== 'trade-list-a4297' || binding.cohortStage !== 'D3' || binding.cohortSize !== COHORT_SIZE ||
      binding.cohortType !== SYNTHETIC_COHORT_TYPE || binding.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
      binding.state !== 'bound-reviewed' || binding.subjectsBound !== true || binding.executionAuthorized !== false ||
      binding.acquisitionMode !== CANDIDATE_POOL_POLICY.acquisitionMode ||
      binding.candidatePoolDigest !== poolResult?.candidatePoolDigest ||
      !HASH.test(binding.syntheticSetupDigest || '') || binding.syntheticSetupDigest !== poolResult?.syntheticSetupDigest ||
      binding.humanReviewed !== true || !Number.isFinite(Date.parse(binding.boundAt)) || Date.parse(binding.boundAt) > now ||
      !Array.isArray(binding.candidates) || binding.candidates.length !== COHORT_SIZE || !HASH.test(binding.bindingDigest || '')) {
    errors.push('group_d3_subject_binding_invalid');
    return;
  }
  validatePriorCohort(binding.priorCohort, errors);
  binding.candidates.forEach((candidate, index) =>
    validateCandidate(candidate, SLOTS[index], binding.priorCohort, now, windowStart, errors));
  if (!sameJson(binding.candidates.map((candidate) => candidate.reviewedSubject),
    poolResult?.canonicalCandidates?.map((candidate) => candidate.reviewedSubject))) {
    errors.push('group_d3_binding_candidate_pool_mismatch');
  }
  const uniqueness = binding.candidates.flatMap((candidate) => [
    candidate.reviewedSubject?.firebaseUid,
    candidate.reviewedSubject?.trainerUsername,
    candidate.subjectHashes?.uidHash,
    candidate.subjectHashes?.trainerHash,
    candidate.handle?.handleKey,
    candidate.request?.requestId,
    candidate.request?.rateLimitDocumentPath
  ]);
  if (new Set(uniqueness).size !== uniqueness.length) errors.push('group_d3_candidates_not_distinct');
  if (binding.bindingDigest !== subjectBindingDigest(
    binding.priorCohort,
    binding.candidates,
    binding.candidatePoolDigest
  )) {
    errors.push('group_d3_binding_digest_mismatch');
  }
}

function validRuntimeProvenance(value, manifest) {
  return exactFields(value, RUNTIME_FIELDS) && value.authorityService === manifest?.authority?.service &&
    value.authorityOrigin === manifest?.authority?.origin && REVISION.test(value.authorityRevision || '') &&
    IMAGE_DIGEST.test(value.authorityImageDigest || '') &&
    value.runtimeServiceAccount === manifest?.authority?.runtimeServiceAccount &&
    value.gatewayServiceAccount === manifest?.gateway?.serviceAccount && value.reviewed === true;
}

function validSecurityBoundary(value) {
  return exactFields(value, SECURITY_FIELDS) && value.authorityPrivate === true &&
    value.gatewayRuntimeSoleAuthorityInvoker === true && value.publicAuthorityInvoker === false &&
    value.projectWideRunInvoker === false && value.gatewayForbiddenRolesPresent === false &&
    value.runtimeIamDrift === false && value.productionDebugTokensRegistered === false;
}

function validWriteBoundary(value) {
  return exactFields(value, WRITE_BOUNDARY_FIELDS) && WRITE_BOUNDARY_FIELDS.every((field) =>
    Array.isArray(value[field]) && value[field].length === 0);
}

function validAcceptanceTemplate(value) {
  return exactFields(value, ACCEPTANCE_FIELDS) && value.executedSubjects === 0 && value.reserveSuccesses === 0 &&
    value.replaySuccesses === 0 && sameJson(value.finalCounts, FINAL_COUNTS) && value.finalStateDigest === null &&
    value.sequenceMatched === false && value.ownershipReciprocal === false && value.anomaliesAbsent === false &&
    value.gatesRestored === false && value.observationCompleted === false && value.observationHealthy === false &&
    value.groupEAuthorized === false && value.accepted === false;
}

function validateThirdMutationAcceptance(value, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  if (!exactFields(value, ACCEPTANCE_EVIDENCE_FIELDS) || value.schemaVersion !== 1 || value.cohortStage !== 'D3' ||
      value.cohortType !== SYNTHETIC_COHORT_TYPE ||
      !HASH.test(value.subjectsBindingDigest || '') || value.executedSubjects !== COHORT_SIZE ||
      value.reserveSuccesses !== COHORT_SIZE || value.replaySuccesses !== COHORT_SIZE ||
      !Array.isArray(value.steps) || value.steps.length !== COHORT_SIZE * 2 || !sameJson(value.finalCounts, FINAL_COUNTS) ||
      !HASH.test(value.finalStateDigest || '') || value.ownershipReciprocal !== true || value.anomaliesAbsent !== true ||
      !sameJson(value.gatesRestored, disabledGatePlan()) || value.unexpectedCostOrLogAnomaly !== false ||
      value.groupEAuthorized !== false || value.accepted !== true) errors.push('group_d3_acceptance_schema_or_summary_invalid');
  if (Array.isArray(value?.steps)) {
    value.steps.forEach((step, index) => {
      const reserve = index % 2 === 0;
      const expectedSlot = SLOTS[Math.floor(index / 2)];
      const expectedCount = EXPECTED_COUNT_SEQUENCE[index + 1];
      if (!exactFields(step, STEP_FIELDS) || step.sequence !== index + 1 || step.slot !== expectedSlot ||
          step.operation !== (reserve ? 'reserve' : 'exact-replay') ||
          step.resultCode !== (reserve ? 'SUCCESS' : 'IDEMPOTENT') || step.documentCount !== expectedCount ||
          !HASH.test(step.stateDigest || '') || step.committedWrites !== (reserve ? 4 : 0) ||
          step.requestFingerprintCoherent !== true || step.ownershipReciprocal !== true || step.rateLimitValid !== true ||
          step.migrationConflictAbsent !== true || step.anomaliesAbsent !== true ||
          (!reserve && index > 0 && step.stateDigest !== value.steps[index - 1]?.stateDigest)) {
        errors.push(`group_d3_acceptance_step_${index + 1}_invalid`);
      }
    });
  }
  const observation = value?.observation;
  const start = Date.parse(observation?.startAt);
  const end = Date.parse(observation?.endAt);
  if (!exactFields(observation, OBSERVATION_FIELDS) || !Number.isFinite(start) || !Number.isFinite(end) ||
      start >= end || end - start !== OBSERVATION_HOURS * 60 * 60 * 1000 || end > now ||
      observation.durationHours !== OBSERVATION_HOURS || observation.completed !== true || observation.healthy !== true ||
      observation.stateDigestAccepted !== true || observation.familyCountsVerified !== true ||
      observation.migrationConflictAbsent !== true || observation.serviceAuthAnomaliesAbsent !== true ||
      observation.privacyIamDriftAbsent !== true || observation.costLogAnomaliesAbsent !== true) {
    errors.push('group_d3_acceptance_observation_invalid');
  }
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-acceptance-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    executedSubjects: COHORT_SIZE,
    finalDocumentCount: FINAL_COUNTS.totalDocuments,
    finalStateDigest: value.finalStateDigest,
    gatesRestored: true,
    observationHours: OBSERVATION_HOURS,
    observationCompleted: true,
    groupEAuthorized: false,
    accepted: true
  });
}

function validateContinuationCandidateState(states, binding, errors) {
  if (!Array.isArray(states) || states.length !== COHORT_SIZE) {
    errors.push('group_d3_continuation_candidate_state_invalid');
    return;
  }
  states.forEach((state, index) => {
    const slot = SLOTS[index];
    const candidate = binding?.candidates?.[index];
    if (!exactFields(state, CONTINUATION_CANDIDATE_STATE_FIELDS) || state.slot !== slot ||
        state.uidHash !== candidate?.subjectHashes?.uidHash || state.trainerHash !== candidate?.subjectHashes?.trainerHash ||
        state.handleKey !== candidate?.handle?.handleKey || state.requestIdHash !== candidate?.request?.requestIdHash ||
        state.requestBodyHash !== candidate?.request?.requestBodyHash ||
        state.foundationFingerprint !== candidate?.request?.foundationFingerprint ||
        state.rateLimitDocumentPath !== candidate?.request?.rateLimitDocumentPath) {
      errors.push(`group_d3_continuation_candidate_${slot.toLowerCase()}_binding_invalid`);
      return;
    }
    const completed = CONTINUATION_COMPLETED_PREFIX.filter((operation) => operation.slot === slot);
    const reserveCompleted = completed.some((operation) => operation.operation === 'reserve');
    const replayCompleted = completed.some((operation) => operation.operation === 'exact-replay');
    if (reserveCompleted) {
      if (state.accountState !== 'present-owned' || state.handleState !== 'present-owned' ||
          state.rateLimitState !== 'present-valid' || state.operationRequestCount !== 1 ||
          state.ownershipReciprocal !== true || state.requestBindingVerified !== true ||
          state.replayEvidenceCount !== (replayCompleted ? 1 : 0)) {
        errors.push(`group_d3_continuation_candidate_${slot.toLowerCase()}_state_invalid`);
      }
    } else if (state.accountState !== 'absent' || state.handleState !== 'absent' ||
        state.rateLimitState !== 'absent' || state.operationRequestCount !== 0 ||
        state.ownershipReciprocal !== false || state.requestBindingVerified !== false ||
        state.replayEvidenceCount !== 0) {
      errors.push(`group_d3_continuation_candidate_${slot.toLowerCase()}_state_invalid`);
    }
  });
}

function validateThirdMutationContinuationArtifact(value, context = {}, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifest = context.manifest;
  const binding = context.binding;
  const history = value?.historicalAdmission;
  const session = value?.interruptedSession;
  const reconciliation = value?.reconciliation;
  const state = value?.currentState;
  const preflight = value?.preflight;
  const preflightVerifiedAt = Date.parse(preflight?.verifiedAt);
  const preflightExpiresAt = Date.parse(preflight?.expiresAt);
  const closedAt = Date.parse(session?.closedAt);
  const reconciledAt = Date.parse(reconciliation?.verifiedAt);

  if (!exactFields(value, CONTINUATION_FIELDS) || value.schemaVersion !== 1 ||
      value.purpose !== CONTINUATION_ARTIFACT_PURPOSE || value.environment !== 'production' ||
      value.projectId !== 'trade-list-a4297' || value.projectNumber !== '1053781218847' ||
      value.region !== 'us-central1' || value.databaseId !== 'phase-e-identity' ||
      value.rtdbDatabaseUrl !== 'https://trade-list-a4297-default-rtdb.firebaseio.com' ||
      !sameJson(value.productionRuntime, CONTINUATION_PRODUCTION_RUNTIME) || value.appId !== EXPECTED_APP_ID ||
      value.approvalGroup !== 'D' || value.cohortStage !== 'D3' || value.cohortType !== SYNTHETIC_COHORT_TYPE ||
      value.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
      value.candidatePoolDigest !== CONTINUATION_PINS.candidatePoolDigest ||
      value.bindingFileSha !== CONTINUATION_PINS.bindingFileSha || value.bindingDigest !== CONTINUATION_PINS.bindingDigest ||
      binding?.bindingDigest !== CONTINUATION_PINS.bindingDigest ||
      binding?.candidatePoolDigest !== CONTINUATION_PINS.candidatePoolDigest ||
      value.historicalEvidenceRecollectionRequired !== false || value.executionAuthorized !== false ||
      value.laterGroupsAuthorized !== false || value.groupEAuthorized !== false) {
    errors.push('group_d3_continuation_schema_or_target_invalid');
  }
  if (manifest && (manifest.environment !== 'production' || manifest.project?.id !== value?.projectId ||
      manifest.project?.number !== value?.projectNumber || manifest.project?.region !== value?.region ||
      manifest.firestore?.databaseId !== value?.databaseId || manifest.legacyRtdb?.url !== value?.rtdbDatabaseUrl ||
      !sameJson(manifest.thirdMutation, EXPECTED_D3_MANIFEST))) {
    errors.push('group_d3_continuation_manifest_invalid');
  }
  if (!exactFields(history, CONTINUATION_HISTORY_FIELDS) ||
      !Number.isFinite(Date.parse(history?.admittedAt)) || Date.parse(history?.admittedAt) > now ||
      history.browserHarnessDigest !== CONTINUATION_PINS.browserHarnessDigest ||
      history.browserHarnessFileSha !== CONTINUATION_PINS.browserHarnessFileSha ||
      history.initialJitDigest !== CONTINUATION_PINS.initialJitDigest ||
      history.initialReadinessDigest !== CONTINUATION_PINS.initialReadinessDigest ||
      history.initialGuardDigest !== CONTINUATION_PINS.initialGuardDigest ||
      history.originalEvidenceValidAtAdmission !== true || context.historicalAdmissionVerified !== true) {
    errors.push('group_d3_continuation_historical_admission_invalid');
  }
  if (!exactFields(session, CONTINUATION_SESSION_FIELDS) || !HASH.test(session?.sessionIdHash || '') ||
      session.state !== 'paused-closed' || !Number.isFinite(closedAt) ||
      session.closeReason !== 'contained-after-b-reserve-authoritative-reconciliation') {
    errors.push('group_d3_continuation_session_invalid');
  }
  if (!exactFields(reconciliation, CONTINUATION_RECONCILIATION_FIELDS) ||
      reconciliation.acceptedRolloverEvidenceDigest !== CONTINUATION_PINS.acceptedRolloverEvidenceDigest ||
      reconciliation.evidenceDigest !== CONTINUATION_PINS.reconciliationEvidenceDigest ||
      reconciliation.executionLedgerDigest !== CONTINUATION_PINS.executionLedgerDigest ||
      !Number.isFinite(reconciledAt) || reconciledAt > now || reconciliation.aReserveInvocations !== 1 ||
      reconciliation.aReplayInvocations !== 1 || reconciliation.laterSlotInvocations !== 1 ||
      reconciliation.acceptedHistoricalRateLimitReplayWrites !== 1 ||
      reconciliation.remainingRateLimitReplayWrites !== 0 ||
      reconciliation.previousStateFingerprint !== CONTINUATION_COMPLETED_PREFIX.at(-2).stateFingerprint ||
      reconciliation.currentStateFingerprint !== CONTINUATION_STATE_FINGERPRINT) {
    errors.push('group_d3_continuation_reconciliation_invalid');
  }
  if (!sameJson(value?.completedPrefix, CONTINUATION_COMPLETED_PREFIX) ||
      !sameJson(value?.acceptedUsage, CONTINUATION_ACCEPTED_USAGE) ||
      !sameJson(value?.nextOperation, CONTINUATION_REMAINING_SEQUENCE[0])) {
    errors.push('group_d3_continuation_prefix_or_next_invalid');
  }
  if (!exactFields(state, CONTINUATION_STATE_FIELDS) || state.totalDocuments !== 20 || state.accounts !== 5 ||
      state.trainerHandles !== 5 || state.rateLimits !== 5 || state.operationRequests !== 5 ||
      state.identityMigrations !== 0 || state.identityConflicts !== 0 || state.unexpectedPaths !== 0 ||
      state.ordinaryUserEffects !== 0 || state.canonicalFingerprint !== CONTINUATION_STATE_FINGERPRINT) {
    errors.push('group_d3_continuation_current_state_invalid');
  }
  validateContinuationCandidateState(value?.candidateState, binding, errors);
  if (!sameJson(value?.remainingSequence, CONTINUATION_REMAINING_SEQUENCE) ||
      !sameJson(value?.expectedCountSequence, CONTINUATION_COUNT_SEQUENCE) ||
      !sameJson(value?.remainingBudget, CONTINUATION_REMAINING_BUDGET)) {
    errors.push('group_d3_continuation_sequence_or_budget_invalid');
  }
  if (!sameJson(value?.currentGates, disabledGatePlan())) errors.push('group_d3_continuation_gates_not_disabled');
  if (!validRuntimeProvenance(value?.runtimeProvenance, manifest) || !validSecurityBoundary(value?.securityBoundary)) {
    errors.push('group_d3_continuation_runtime_or_isolation_invalid');
  }
  if (!validWriteBoundary(value?.writeBoundary)) errors.push('group_d3_continuation_write_boundary_invalid');
  if (!exactFields(preflight, CONTINUATION_PREFLIGHT_FIELDS) || !Number.isFinite(preflightVerifiedAt) ||
      !Number.isFinite(preflightExpiresAt) || preflightVerifiedAt > now || now >= preflightExpiresAt ||
      preflightExpiresAt - preflightVerifiedAt > MAX_EVIDENCE_AGE_MS ||
      preflight?.digest !== continuationPreflightDigest(value)) {
    errors.push('group_d3_continuation_preflight_invalid');
  }
  if (value?.artifactDigest !== continuationArtifactDigest(value)) {
    errors.push('group_d3_continuation_artifact_digest_invalid');
  }
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-continuation-artifact-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    mode: 'reconciled-through-b-reserve-continuation-preflight',
    continuationArtifactDigest: value.artifactDigest,
    continuationPreflightDigest: preflight.digest,
    historicalEvidenceRecollectionRequired: false,
    completedPrefix: CONTINUATION_COMPLETED_PREFIX,
    acceptedUsage: CONTINUATION_ACCEPTED_USAGE,
    nextOperation: CONTINUATION_REMAINING_SEQUENCE[0],
    remainingSequence: CONTINUATION_REMAINING_SEQUENCE,
    remainingBudget: CONTINUATION_REMAINING_BUDGET,
    currentDocumentCount: 20,
    executionAuthorized: false,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

function validateThirdMutationContinuationJit(value, artifactResult, expectedSourceSha, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const approvedAt = Date.parse(value?.approvedAt);
  const expiresAt = Date.parse(value?.entryEvidenceExpiresAt);
  const windowStart = Date.parse(value?.mutationWindow?.startAt);
  const windowEnd = Date.parse(value?.mutationWindow?.endAt);
  if (!exactFields(value, CONTINUATION_JIT_FIELDS) || value.schemaVersion !== 1 ||
      value.purpose !== CONTINUATION_JIT_PURPOSE || value.continuationArtifactDigest !== artifactResult?.continuationArtifactDigest ||
      value.continuationPreflightDigest !== artifactResult?.continuationPreflightDigest ||
      value.continuationContractSourceSha !== expectedSourceSha || !/^[a-f0-9]{40}$/u.test(expectedSourceSha || '') ||
      !Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || approvedAt > now || now >= expiresAt ||
      expiresAt - approvedAt > MAX_EVIDENCE_AGE_MS || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd) ||
      windowStart > now || now >= windowEnd || windowStart < approvedAt || windowEnd - windowStart > MAX_WINDOW_MS ||
      !validIdentity(value.humanOperator) || value.humanOperator !== value.teardownOwner ||
      value.approvalAcknowledged !== true || value.teardownOwnerAcknowledged !== true ||
      !sameJson(value.nextOperation, CONTINUATION_REMAINING_SEQUENCE[0]) ||
      !sameJson(value.remainingSequence, CONTINUATION_REMAINING_SEQUENCE) ||
      !sameJson(value.expectedCountSequence, CONTINUATION_COUNT_SEQUENCE) ||
      !sameJson(value.acceptedUsage, CONTINUATION_ACCEPTED_USAGE) ||
      !sameJson(value.remainingBudget, CONTINUATION_REMAINING_BUDGET) ||
      !sameJson(value.activationGatePlan, activationGatePlan()) ||
      !sameJson(value.restorationGatePlan, disabledGatePlan()) || value.executionAuthorized !== true ||
      value.laterGroupsAuthorized !== false || value.groupEAuthorized !== false ||
      value.jitDigest !== continuationJitDigest(value)) {
    errors.push('group_d3_continuation_jit_invalid');
  }
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-continuation-jit-failed');
    error.reasons = Object.freeze(errors);
    throw error;
  }
  return Object.freeze({
    ok: true,
    executionAuthorized: true,
    nextOperation: CONTINUATION_REMAINING_SEQUENCE[0],
    remainingSequence: CONTINUATION_REMAINING_SEQUENCE,
    acceptedUsage: CONTINUATION_ACCEPTED_USAGE,
    mutationWindowStart: value.mutationWindow.startAt,
    mutationWindowEnd: value.mutationWindow.endAt,
    entryEvidenceExpiresAt: value.entryEvidenceExpiresAt,
    laterGroupsAuthorized: false,
    groupEAuthorized: false
  });
}

function validateThirdMutationContinuationObservationStart(value, options = {}) {
  const now = options.now ? options.now() : Date.now();
  const startedAt = Date.parse(value?.startedAt);
  const completedProgress = continuationProgress(CONTINUATION_REMAINING_SEQUENCE.length);
  if (!exactFields(value, CONTINUATION_OBSERVATION_START_FIELDS) ||
      value.completedSuffixOperations !== CONTINUATION_REMAINING_SEQUENCE.length ||
      !sameJson(value.acceptedUsage, CONTINUATION_ACCEPTED_USAGE) ||
      !sameJson(value.remainingBudget, completedProgress.remainingBudget) ||
      !sameJson(value.finalCounts, FINAL_COUNTS) || !HASH.test(value.finalStateDigest || '') ||
      !sameJson(value.gatesRestored, disabledGatePlan()) || !validSecurityBoundary(value.securityBoundary) ||
      value.anomaliesAbsent !== true || !Number.isFinite(startedAt) || startedAt > now || now - startedAt > 60_000 ||
      value.observationHours !== OBSERVATION_HOURS || value.groupEAuthorized !== false) {
    throw new Error('e1/production-third-mutation-continuation-observation-start-invalid');
  }
  return Object.freeze({
    ok: true,
    startAt: new Date(startedAt).toISOString(),
    endAt: new Date(startedAt + (OBSERVATION_HOURS * 60 * 60 * 1000)).toISOString(),
    observationHours: OBSERVATION_HOURS,
    gatesRestored: true,
    groupEAuthorized: false
  });
}

function guardProductionThirdMutationContinuation(options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const candidatePoolPath = options.candidatePoolPath || PRIVATE_SYNTHETIC_CANDIDATE_POOL_PATH;
  const bindingPath = options.bindingPath || PRIVATE_SYNTHETIC_BINDING_PATH;
  const browserHarnessPath = options.browserHarnessPath || PRIVATE_BROWSER_HARNESS_PATH;
  const continuationPath = options.continuationPath || PRIVATE_CONTINUATION_PATH;
  const continuationJitPath = options.continuationJitPath || PRIVATE_CONTINUATION_JIT_PATH;
  let manifest;
  let candidatePool;
  let binding;
  let browserHarness;
  let continuation;
  let jit;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { candidatePool = readJson(candidatePoolPath); } catch { errors.push('group_d3_candidate_pool_missing_or_invalid'); }
  try { binding = readJson(bindingPath); } catch { errors.push('group_d3_subject_binding_missing_or_invalid'); }
  try { browserHarness = readJson(browserHarnessPath); } catch { errors.push('group_d3_browser_harness_missing_or_invalid'); }
  try { continuation = readJson(continuationPath); } catch { errors.push('group_d3_continuation_missing_or_invalid'); }
  try { jit = readJson(continuationJitPath); } catch { errors.push('group_d3_continuation_jit_missing_or_invalid'); }
  for (const [file, reason] of [[candidatePoolPath, 'group_d3_candidate_pool_permissions_invalid'],
    [bindingPath, 'group_d3_subject_binding_permissions_invalid'],
    [browserHarnessPath, 'group_d3_browser_harness_permissions_invalid'],
    [continuationPath, 'group_d3_continuation_permissions_invalid'],
    [continuationJitPath, 'group_d3_continuation_jit_permissions_invalid']]) {
    if (!privateMode(file)) errors.push(reason);
  }
  if (binding && fileSha256(bindingPath) !== CONTINUATION_PINS.bindingFileSha) errors.push('group_d3_continuation_binding_file_sha_invalid');
  if (browserHarness && fileSha256(browserHarnessPath) !== CONTINUATION_PINS.browserHarnessFileSha) {
    errors.push('group_d3_continuation_browser_harness_file_sha_invalid');
  }
  let poolResult;
  try { poolResult = validateCandidatePoolArtifact(candidatePool, { now: () => now, candidatePoolPath }); }
  catch (error) { errors.push(...(error.reasons || ['group_d3_candidate_pool_invalid'])); }
  const historicalAt = Date.parse(continuation?.historicalAdmission?.admittedAt);
  if (Number.isFinite(historicalAt)) {
    const bindingEvidenceAt = Math.max(...(binding?.candidates || []).flatMap((candidate) => [
      Date.parse(candidate.authEligibility?.verifiedAt),
      Date.parse(candidate.targetedAuthorityState?.verifiedAt)
    ]));
    if (!Number.isFinite(bindingEvidenceAt) || bindingEvidenceAt > historicalAt) {
      errors.push('group_d3_continuation_historical_binding_time_invalid');
    } else {
      validateBinding(binding, poolResult, bindingEvidenceAt,
        bindingEvidenceAt - MAX_EVIDENCE_AGE_MS, errors);
    }
    try {
      const harnessResult = validateBrowserHarnessArtifact(browserHarness, {
        now: () => historicalAt,
        harnessPath: browserHarnessPath
      });
      if (harnessResult.harnessDigest !== CONTINUATION_PINS.browserHarnessDigest ||
          harnessResult.bindingDigest !== CONTINUATION_PINS.bindingDigest) {
        errors.push('group_d3_continuation_historical_harness_invalid');
      }
    } catch (error) { errors.push(...(error.reasons || ['group_d3_continuation_historical_harness_invalid'])); }
  } else {
    errors.push('group_d3_continuation_historical_time_invalid');
  }
  let artifactResult;
  try {
    artifactResult = validateThirdMutationContinuationArtifact(continuation, {
      manifest,
      binding,
      historicalAdmissionVerified: errors.length === 0
    }, { now: () => now });
  } catch (error) { errors.push(...(error.reasons || ['group_d3_continuation_artifact_invalid'])); }
  let jitResult;
  try { jitResult = validateThirdMutationContinuationJit(jit, artifactResult, options.expectedSourceSha, { now: () => now }); }
  catch (error) { errors.push(...(error.reasons || ['group_d3_continuation_jit_invalid'])); }
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-continuation-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'D',
    cohortStage: 'D3',
    deploymentMode: 'continuation',
    mode: 'reconciled-through-b-reserve-continuation',
    environment: 'production',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    targetVerified: true,
    historicalAdmissionVerified: true,
    currentStateVerified: true,
    historicalEvidenceRecollectionRequired: false,
    executionAuthorized: true,
    nextOperation: jitResult.nextOperation,
    remainingSequence: jitResult.remainingSequence,
    acceptedUsage: CONTINUATION_ACCEPTED_USAGE,
    remainingBudget: CONTINUATION_REMAINING_BUDGET,
    currentDocumentCount: 20,
    sourceSha: options.expectedSourceSha,
    toolingSourceSha: options.expectedSourceSha,
    productionRuntime: CONTINUATION_PRODUCTION_RUNTIME,
    runtimeProvenance: continuation.runtimeProvenance,
    securityBoundary: continuation.securityBoundary,
    startingGates: continuation.currentGates,
    activationGatePlan: jit.activationGatePlan,
    restorationGatePlan: jit.restorationGatePlan,
    continuationArtifactDigest: artifactResult.continuationArtifactDigest,
    continuationPreflightDigest: artifactResult.continuationPreflightDigest,
    continuationJitDigest: jit.jitDigest,
    entryEvidenceFreshAtEnable: true,
    entryEvidenceExpiresAt: jitResult.entryEvidenceExpiresAt,
    entryEvidenceRequiredAfterEnable: false,
    mutationWindowStart: jitResult.mutationWindowStart,
    mutationWindowEnd: jitResult.mutationWindowEnd,
    mutationWindowGovernsPostEnable: true,
    candidateCount: COHORT_SIZE,
    subjectsBound: true,
    browserHarnessVerified: true,
    sequentialExecutionRequired: true,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

function guardProductionThirdMutation(input, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const candidatePoolPath = options.candidatePoolPath || PRIVATE_CANDIDATE_POOL_PATH;
  const bindingPath = options.bindingPath || PRIVATE_BINDING_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  const inputPath = options.inputPath || PRIVATE_INPUT_PATH;
  const browserHarnessPath = options.browserHarnessPath || PRIVATE_BROWSER_HARNESS_PATH;
  const expectedSourceSha = options.expectedSourceSha;
  let manifest;
  let candidatePool;
  let candidatePoolResult;
  let binding;
  let readiness;
  let browserHarness;
  let browserHarnessResult;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { candidatePool = readJson(candidatePoolPath); } catch { errors.push('group_d3_candidate_pool_missing_or_invalid'); }
  try { binding = readJson(bindingPath); } catch { errors.push('group_d3_subject_binding_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('group_d3_readiness_missing_or_invalid'); }
  try { browserHarness = readJson(browserHarnessPath); } catch { errors.push('group_d3_browser_harness_missing_or_invalid'); }

  if (!exactFields(input, INPUT_FIELDS)) errors.push('group_d3_input_schema_invalid');
  if (readiness && !exactFields(readiness, READINESS_FIELDS)) errors.push('group_d3_readiness_schema_invalid');
  if (!/^[a-f0-9]{40}$/u.test(expectedSourceSha || '')) errors.push('group_d3_source_sha_invalid');
  try { candidatePoolResult = validateCandidatePoolArtifact(candidatePool, { now: () => now, candidatePoolPath }); }
  catch (error) { errors.push(...(error.reasons || ['group_d3_candidate_pool_invalid'])); }
  try { browserHarnessResult = validateBrowserHarnessArtifact(browserHarness, { now: () => now, harnessPath: browserHarnessPath }); }
  catch (error) { errors.push(...(error.reasons || ['group_d3_browser_harness_invalid'])); }
  if (!privateMode(bindingPath)) errors.push('group_d3_subject_binding_permissions_invalid');
  if (!privateMode(readinessPath)) errors.push('group_d3_readiness_permissions_invalid');
  if (!privateMode(inputPath)) errors.push('group_d3_input_permissions_invalid');
  const project = manifest?.project || {};
  if (manifest?.environment !== 'production' || input?.environment !== 'production') errors.push('environment_not_production');
  if (project.id !== 'trade-list-a4297' || input?.projectId !== project.id) errors.push('project_id_mismatch');
  if (project.number !== '1053781218847' || project.numberReviewed !== true || input?.projectNumber !== project.number ||
      input?.expectedProjectNumber !== project.number) errors.push('project_number_mismatch');
  if (project.region !== 'us-central1' || input?.region !== project.region) errors.push('region_mismatch');
  if (manifest?.firestore?.databaseId !== 'phase-e-identity' || input?.databaseId !== manifest?.firestore?.databaseId) {
    errors.push('firestore_database_mismatch');
  }
  if (manifest?.legacyRtdb?.url !== 'https://trade-list-a4297-default-rtdb.firebaseio.com' ||
      input?.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url) errors.push('rtdb_mismatch');
  if (!sameJson(manifest?.thirdMutation, EXPECTED_D3_MANIFEST)) errors.push('group_d3_manifest_contract_invalid');
  if (JSON.stringify({ manifest, input, candidatePool, binding, readiness, browserHarness }).includes('trainer-hub-staging-37ib4wct')) {
    errors.push('staging_target_present');
  }

  let windowStart = NaN;
  if (readiness) {
    if (readiness.schemaVersion !== 1 || readiness.environment !== 'production' || readiness.projectId !== project.id ||
        readiness.projectNumber !== project.number || readiness.region !== project.region ||
        readiness.firestoreDatabaseId !== manifest?.firestore?.databaseId ||
        readiness.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url) errors.push('group_d3_readiness_target_mismatch');
    if (readiness.approvalGroup !== 'D' || readiness.cohortStage !== 'D3' || readiness.contractDefined !== true ||
        readiness.cohortType !== SYNTHETIC_COHORT_TYPE || readiness.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
        readiness.subjectsBound !== true || readiness.executionAuthorized !== true ||
        readiness.approvalAcknowledged !== true || readiness.teardownOwnerAcknowledged !== true ||
        readiness.humanOperator !== readiness.teardownOwner || !validIdentity(readiness.humanOperator) ||
        readiness.laterGroupsAuthorized !== false || readiness.groupEAuthorized !== false) errors.push('group_d3_approval_invalid');
    windowStart = Date.parse(readiness.mutationWindow?.startAt);
    const windowEnd = Date.parse(readiness.mutationWindow?.endAt);
    const approvedAt = Date.parse(readiness.approvedAt);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || !Number.isFinite(approvedAt) ||
        windowStart >= windowEnd || windowEnd - windowStart > MAX_WINDOW_MS || now < windowStart || now >= windowEnd ||
        approvedAt > now) errors.push('group_d3_window_invalid');
  }

  let expectedReadinessContract;
  try { expectedReadinessContract = readinessContract(expectedSourceSha); }
  catch { expectedReadinessContract = null; }
  if (!sameJson(readiness?.readinessContract, expectedReadinessContract) ||
      !sameJson(input?.readinessContract, expectedReadinessContract)) {
    errors.push('group_d3_readiness_contract_invalid');
  }

  validateBinding(binding, candidatePoolResult, now, windowStart, errors);
  if (browserHarnessResult?.bindingDigest !== binding?.bindingDigest ||
      readiness?.browserHarnessDigest !== browserHarnessResult?.harnessDigest ||
      input?.browserHarnessDigest !== browserHarnessResult?.harnessDigest) {
    errors.push('group_d3_browser_harness_binding_invalid');
  }
  const evidenceExpiresAt = entryEvidenceExpiresAt(binding);
  let entryTiming;
  try {
    entryTiming = validateThirdMutationEntryTiming({
      at: now,
      mutationWindow: readiness?.mutationWindow,
      entryEvidenceExpiresAt: evidenceExpiresAt
    });
  } catch { errors.push('group_d3_entry_timing_invalid'); }
  if (readiness?.subjectsBindingDigest !== binding?.bindingDigest || input?.subjectsBindingDigest !== binding?.bindingDigest ||
      input?.subjectsBound !== true || input?.executionAuthorized !== true || input?.approvalGroup !== 'D' ||
      input?.cohortStage !== 'D3' || input?.cohortType !== SYNTHETIC_COHORT_TYPE ||
      input?.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE) errors.push('group_d3_binding_or_authorization_invalid');
  if (!sameValues(readiness?.authorizedOperations, ALLOWED_OPERATIONS) ||
      !sameValues(input?.requestedOperations, ALLOWED_OPERATIONS)) errors.push('group_d3_operations_invalid');
  if (!validD2Baseline(readiness?.d2Baseline) || !validD2Baseline(input?.d2Baseline) ||
      !sameJson(readiness?.d2Baseline, input?.d2Baseline)) errors.push('group_d3_d2_baseline_invalid');
  if (!sameJson(input?.currentGates, disabledGatePlan()) || !sameJson(readiness?.activationGatePlan, activationGatePlan()) ||
      !sameJson(input?.activationGatePlan, activationGatePlan()) || !sameJson(readiness?.restorationGatePlan, disabledGatePlan()) ||
      !sameJson(input?.restorationGatePlan, disabledGatePlan())) errors.push('group_d3_gate_plan_invalid');
  if (!validRuntimeProvenance(readiness?.runtimeProvenance, manifest) ||
      !sameJson(readiness?.runtimeProvenance, input?.runtimeProvenance)) errors.push('group_d3_runtime_provenance_invalid');
  if (!validSecurityBoundary(input?.securityBoundary)) errors.push('group_d3_security_boundary_invalid');
  if (!sameJson(input?.tokenVerifier, EXPECTED_TOKEN_VERIFIER) ||
      !sameJson(manifest?.appCheck?.tokenVerifier, {
        principal: EXPECTED_TOKEN_VERIFIER.principal,
        role: EXPECTED_TOKEN_VERIFIER.role,
        permissions: EXPECTED_TOKEN_VERIFIER.permissions,
        scope: EXPECTED_TOKEN_VERIFIER.scope
      })) errors.push('group_d3_token_verifier_invalid');
  if (input?.rateLimiterMode !== DURABLE_MODE || input?.readProofModePresent !== false ||
      input?.reserveConsumesLimitedUseAppCheck !== true) errors.push('group_d3_limiter_or_app_check_invalid');
  if (!sameJson(readiness?.operationBudget, OPERATION_BUDGET) || !sameJson(input?.operationBudget, OPERATION_BUDGET)) {
    errors.push('group_d3_budget_invalid');
  }
  if (!sameJson(input?.expectedCountSequence, EXPECTED_COUNT_SEQUENCE) ||
      !sameJson(readiness?.executionSequence, EXECUTION_SEQUENCE) || !sameJson(input?.executionSequence, EXECUTION_SEQUENCE) ||
      !sameJson(readiness?.stopPolicy, STOP_POLICY) || !sameJson(input?.stopPolicy, STOP_POLICY)) {
    errors.push('group_d3_sequence_invalid');
  }
  if (readiness?.observationHours !== OBSERVATION_HOURS || input?.observationHours !== OBSERVATION_HOURS ||
      !sameJson(readiness?.observationChecks, OBSERVATION_CHECKS) ||
      !sameJson(input?.observationChecks, OBSERVATION_CHECKS)) errors.push('group_d3_observation_invalid');
  if (!validWriteBoundary(input?.writeBoundary)) errors.push('group_d3_write_boundary_invalid');
  if (!validAcceptanceTemplate(input?.finalAcceptanceTemplate)) errors.push('group_d3_acceptance_template_invalid');
  if (input?.laterGroupsAuthorized !== false || input?.groupEAuthorized !== false) errors.push('group_d3_later_group_forbidden');

  if (errors.length) {
    const error = new Error('e1/production-third-mutation-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'D',
    cohortStage: 'D3',
    deploymentMode: 'clean-start',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    environment: 'production',
    targetVerified: true,
    contractDefined: true,
    d2BaselineVerified: true,
    candidatePoolValidated: true,
    candidatePoolDigest: candidatePoolResult.candidatePoolDigest,
    browserHarnessVerified: true,
    browserHarnessDigest: browserHarnessResult.harnessDigest,
    subjectsBound: true,
    executionAuthorized: true,
    sourceSha: expectedSourceSha,
    toolingSourceSha: expectedSourceSha,
    runtimeProvenance: readiness.runtimeProvenance,
    securityBoundary: input.securityBoundary,
    startingGates: input.currentGates,
    activationGatePlan: readiness.activationGatePlan,
    restorationGatePlan: readiness.restorationGatePlan,
    candidateCount: COHORT_SIZE,
    candidatesDistinct: true,
    targetedAbsenceVerified: true,
    entryEvidenceFreshAtEnable: true,
    entryEvidenceExpiresAt: entryTiming.entryEvidenceExpiresAt,
    entryEvidenceRequiredAfterEnable: false,
    mutationWindowStart: entryTiming.mutationWindowStart,
    mutationWindowEnd: entryTiming.mutationWindowEnd,
    mutationWindowGovernsPostEnable: true,
    runtimeProvenanceVerified: true,
    securityBoundaryVerified: true,
    budgetVerified: true,
    sequentialExecutionRequired: true,
    expectedCountSequence: EXPECTED_COUNT_SEQUENCE,
    rateLimiterMode: DURABLE_MODE,
    observationHours: OBSERVATION_HOURS,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

module.exports = Object.freeze({
  ACCEPTANCE_FIELDS,
  ACCEPTANCE_EVIDENCE_FIELDS,
  ALLOWED_OPERATIONS,
  BINDING_FIELDS,
  CANDIDATE_POOL_FIELDS,
  CANDIDATE_POOL_SUBJECT_FIELDS,
  CANDIDATE_FIELDS,
  CONTINUATION_FIELDS,
  CONTINUATION_JIT_FIELDS,
  CONTINUATION_OBSERVATION_START_FIELDS,
  ENABLE_CONFIRMATION,
  INPUT_FIELDS,
  MANIFEST_PATH,
  MAX_EVIDENCE_AGE_MS,
  MAX_WINDOW_MS,
  PRIVATE_BINDING_PATH,
  PRIVATE_BROWSER_HARNESS_PATH,
  PRIVATE_CANDIDATE_POOL_PATH,
  PRIVATE_CONTINUATION_JIT_PATH,
  PRIVATE_CONTINUATION_PATH,
  PRIVATE_INPUT_PATH,
  PRIVATE_READINESS_PATH,
  PRIVATE_SYNTHETIC_BINDING_PATH,
  PRIVATE_SYNTHETIC_CANDIDATE_POOL_PATH,
  READINESS_FIELDS,
  RESTORE_CONFIRMATION,
  SLOTS,
  canonicalPoolCandidate,
  foundationFingerprint,
  entryEvidenceExpiresAt,
  guardProductionThirdMutation,
  guardProductionThirdMutationContinuation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validateCandidatePoolArtifact,
  validateThirdMutationContinuationArtifact,
  validateThirdMutationContinuationJit,
  validateThirdMutationContinuationObservationStart,
  validateThirdMutationAcceptance
});
