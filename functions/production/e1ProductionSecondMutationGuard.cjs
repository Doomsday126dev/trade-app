'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { DURABLE_MODE, readProofSubjectHash } = require('../e1-authority-service/readRateLimiters');
const {
  ALL_GATES,
  EXPECTED_APP_ID,
  EXPECTED_TOKEN_VERIFIER,
  disabledGatePlan,
  activationGatePlan
} = require('./e1ProductionFirstMutationGuard.cjs');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-second-mutation-activation.json');
const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/e1-production-second-mutation-guard-input.json');
const PRIVATE_HARNESS_PATHS = Object.freeze({
  A: path.resolve(__dirname, '../.local/e1-group-d2-candidate-a-console.js'),
  B: path.resolve(__dirname, '../.local/e1-group-d2-candidate-b-console.js')
});
const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_TARGETED_STATE_AGE_MS = 15 * 60 * 1000;
const OBSERVATION_HOURS = 48;
const D1_OBSERVATION_END = '2026-08-12T19:24:02.510Z';
const D1_STATE_DIGEST = 'f3e8bb34e8ae0eb95eeb603065f2852bd927bcc3dba3e9fcad2789cced6505e4';
const D1_SUBJECT_HASHES = Object.freeze({
  uidHash: '51604d9a78f7486fa0e7c4814594a51de5f69135fcefe466de3468e07ca3833f',
  trainerHash: 'c3a47f6d040ffa1eb2f186cb17ceee6447f952c80cb50b1b98642fb62756461b'
});
const D1_HANDLE_KEY = 'v1_646f6f6d73646179313236';
const EXPECTED_PROGRESSION = Object.freeze({
  beforeD2: 4,
  afterCandidateAFirst: 8,
  afterCandidateAReplay: 8,
  afterCandidateBFirst: 12,
  afterCandidateBReplay: 12
});
const EXECUTION_SEQUENCE = Object.freeze([
  'candidate-a-first',
  'candidate-a-verify',
  'candidate-a-replay',
  'candidate-a-replay-verify',
  'candidate-b-first',
  'candidate-b-verify',
  'candidate-b-replay',
  'candidate-b-replay-verify'
]);
const STOP_POLICY = Object.freeze({
  candidateAFailureStopsBeforeCandidateB: true,
  candidateBFailureRestoresAndStops: true,
  restoreGatesAfterAnyOutcome: true,
  preserveValidEvidence: true
});
const EXPECTED_SECOND_MUTATION_MANIFEST = Object.freeze({
  approvalGroup: 'D',
  cohortStage: 'D2',
  cohortSize: 2,
  maxWindowHours: 2,
  rateLimiterMode: DURABLE_MODE,
  baselineDocuments: 4,
  documentProgression: Object.freeze([4, 8, 8, 12, 12]),
  executionSequence: EXECUTION_SEQUENCE,
  observationHours: OBSERVATION_HOURS,
  laterGroupsAuthorized: false,
  groupEAuthorized: false
});
const ALLOWED_OPERATIONS = Object.freeze([
  'verify-d1-durable-baseline',
  'verify-d1-observation-complete',
  'verify-reviewed-candidate-a',
  'verify-reviewed-candidate-b',
  'verify-targeted-authority-absence-a',
  'verify-targeted-authority-absence-b',
  'verify-candidate-distinctness',
  'verify-app-check-token-verifier',
  'enable-gateway',
  'enable-reserve',
  'candidate-a-first-reserve',
  'verify-candidate-a-first-state',
  'candidate-a-exact-replay',
  'verify-candidate-a-idempotent-state',
  'candidate-b-first-reserve',
  'verify-candidate-b-first-state',
  'candidate-b-exact-replay',
  'verify-candidate-b-idempotent-state',
  'restore-reserve',
  'restore-gateway',
  'start-48-hour-observation'
]);
const ROOT_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'projectNumber', 'rtdbDatabaseUrl', 'firestoreDatabaseId', 'region',
  'approvalGroup', 'cohortStage', 'approved', 'approvedAt', 'humanOperator', 'teardownOwner',
  'approvalAcknowledged', 'teardownOwnerAcknowledged', 'mutationWindow', 'candidates', 'd1Baseline', 'd1Observation',
  'tokenVerifier', 'cohortSize', 'authorizedOperations', 'activationGatePlan', 'restorationGatePlan', 'rateLimiterMode',
  'expectedProgression', 'executionSequence', 'stopPolicy', 'observationHours', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const INPUT_FIELDS = Object.freeze([
  'environment', 'projectId', 'projectNumber', 'expectedProjectNumber', 'region', 'databaseId', 'rtdbDatabaseUrl',
  'requestedOperations', 'candidates', 'd1Baseline', 'd1Observation', 'tokenVerifier', 'cohortSize',
  'expectedAppId', 'genuineAppCheckAvailable', 'preActivationGates', 'activationGatePlan', 'restorationGatePlan',
  'rateLimiterMode', 'readProofModePresent', 'reserveConsumesLimitedUseAppCheck', 'expectedProgression',
  'executionSequence', 'stopPolicy', 'gatewayRuntimeSoleAuthorityInvoker', 'publicAuthorityInvoker',
  'projectWideRunInvoker', 'gatewayForbiddenRolesPresent', 'productionDebugTokensRegistered',
  'productionRtdbWriteCount', 'productionAuthMutationCount', 'productionPublicShareWriteCount',
  'observationHours', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const CANDIDATE_FIELDS = Object.freeze([
  'slot', 'reviewedSubject', 'subjectHashes', 'handle', 'request', 'review', 'eligibility', 'targetedAuthorityState',
  'expectedState'
]);
const SUBJECT_FIELDS = Object.freeze(['firebaseUid', 'trainerUsername']);
const HASH_FIELDS = Object.freeze(['uidHash', 'trainerHash']);
const HANDLE_FIELDS = Object.freeze(['canonical', 'normalized', 'handleKey']);
const REQUEST_FIELDS = Object.freeze([
  'requestId', 'requestIdHash', 'requestBodyHash', 'foundationFingerprint', 'rateLimitDocumentPath',
  'rateLimitPathDerivationVerified'
]);
const REVIEW_FIELDS = Object.freeze(['humanReviewed', 'reviewedAt', 'selectionSource']);
const ELIGIBILITY_FIELDS = Object.freeze([
  'firebaseAuthUserExists', 'firebaseAuthDisabled', 'reciprocalLegacyOwnershipVerified', 'loginDirectoryReady',
  'identityAmbiguityAbsent', 'migrationEvidenceAbsent', 'conflictEvidenceAbsent'
]);
const TARGETED_STATE_FIELDS = Object.freeze([
  'verifiedAt', 'accountAbsent', 'handleAbsent', 'operationRequestAbsent', 'reserveRateLimitAbsent',
  'migrationAbsent', 'conflictAbsent', 'competingHandleAbsent'
]);
const EXPECTED_STATE_FIELDS = Object.freeze([
  'firstResultCode', 'replayResultCode', 'firstWriteDocumentCount', 'replayDocumentCount', 'documentPaths',
  'identityTransactionPaths', 'sameRequestId', 'sameHandle', 'sameHandleKey', 'sameFoundationFingerprint',
  'sameSemanticBody', 'rateLimitUpdatedOnReplay', 'identityWrittenOnReplay', 'ownershipUnchanged',
  'requestEvidenceUnchanged'
]);
const D1_BASELINE_FIELDS = Object.freeze([
  'applicationDocumentCount', 'stateDigest', 'accountRevision', 'handleRevision', 'firstResult', 'replayResult',
  'ownerSubjectHashes', 'ownerHandleKey', 'exactKnownStateVerified', 'forbiddenRecordClassesAbsent'
]);
const D1_OBSERVATION_FIELDS = Object.freeze([
  'startAt', 'endAt', 'completed', 'healthy', 'stateDigestUnchanged', 'documentCountUnchanged', 'gatesRestored',
  'laterGroupsAuthorized', 'groupEAuthorized'
]);
const TOKEN_FIELDS = Object.freeze(['principal', 'role', 'permissions', 'scope', 'present']);
const REQUEST_ID = /^group-d2-([ab])-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RATE_LIMIT_PATH = /^rateLimits\/reserveTrainerHandle_[a-f0-9]{16}$/u;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && sameValues(Object.keys(value), fields);
}

function validIdentity(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && !/[\r\n\/#$\[\]]/u.test(value);
}

function validSubject(value) {
  return exactFields(value, SUBJECT_FIELDS) && validIdentity(value.firebaseUid) && validIdentity(value.trainerUsername);
}

function subjectHashesFor(subject) {
  return Object.freeze({
    uidHash: readProofSubjectHash('uid', subject.firebaseUid),
    trainerHash: readProofSubjectHash('trainer', subject.trainerUsername)
  });
}

function requestIdHash(requestId) {
  return sha256(JSON.stringify([1, 'group-d2-request-id', requestId]));
}

function requestBodyHash(requestId, canonicalHandle) {
  return sha256(JSON.stringify([1, 'group-d2-reserve-body', 1, requestId, canonicalHandle]));
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

function expectedCandidateState(candidate) {
  const account = `accounts/${candidate.reviewedSubject.firebaseUid}`;
  const handle = `trainerHandles/${candidate.handle.handleKey}`;
  const operation = `operationRequests/${candidate.reviewedSubject.firebaseUid}/requests/${candidate.request.requestId}`;
  return Object.freeze({
    firstResultCode: 'SUCCESS',
    replayResultCode: 'IDEMPOTENT',
    firstWriteDocumentCount: 4,
    replayDocumentCount: 4,
    documentPaths: Object.freeze([candidate.request.rateLimitDocumentPath, account, handle, operation]),
    identityTransactionPaths: Object.freeze([account, handle, operation]),
    sameRequestId: true,
    sameHandle: true,
    sameHandleKey: true,
    sameFoundationFingerprint: true,
    sameSemanticBody: true,
    rateLimitUpdatedOnReplay: false,
    identityWrittenOnReplay: false,
    ownershipUnchanged: true,
    requestEvidenceUnchanged: true
  });
}

function validTokenVerifier(value, manifest) {
  return exactFields(value, TOKEN_FIELDS) && sameJson(value, EXPECTED_TOKEN_VERIFIER) &&
    sameJson(manifest?.appCheck?.tokenVerifier, {
      principal: EXPECTED_TOKEN_VERIFIER.principal,
      role: EXPECTED_TOKEN_VERIFIER.role,
      permissions: EXPECTED_TOKEN_VERIFIER.permissions,
      scope: EXPECTED_TOKEN_VERIFIER.scope
    });
}

function validD1Baseline(value) {
  return exactFields(value, D1_BASELINE_FIELDS) && value.applicationDocumentCount === 4 &&
    value.stateDigest === D1_STATE_DIGEST && value.accountRevision === 1 && value.handleRevision === 1 &&
    value.firstResult === 'SUCCESS' && value.replayResult === 'IDEMPOTENT' &&
    sameJson(value.ownerSubjectHashes, D1_SUBJECT_HASHES) && value.ownerHandleKey === D1_HANDLE_KEY &&
    value.exactKnownStateVerified === true && value.forbiddenRecordClassesAbsent === true;
}

function validD1Observation(value, now) {
  const start = Date.parse(value?.startAt);
  const end = Date.parse(value?.endAt);
  return exactFields(value, D1_OBSERVATION_FIELDS) && Number.isFinite(start) && Number.isFinite(end) && start < end &&
    value.endAt === D1_OBSERVATION_END && now >= end && value.completed === true && value.healthy === true &&
    value.stateDigestUnchanged === true && value.documentCountUnchanged === true &&
    sameJson(value.gatesRestored, disabledGatePlan()) && value.laterGroupsAuthorized === false && value.groupEAuthorized === false;
}

function privateMode(file) {
  try { return (fs.statSync(file).mode & 0o777) === 0o600; } catch { return false; }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateCandidate(candidate, slot, now, windowStart, errors) {
  if (!exactFields(candidate, CANDIDATE_FIELDS) || candidate.slot !== slot) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_schema_invalid`);
    return;
  }
  const subject = candidate.reviewedSubject;
  if (!validSubject(subject) || !exactFields(candidate.subjectHashes, HASH_FIELDS) ||
      !sameJson(candidate.subjectHashes, validSubject(subject) ? subjectHashesFor(subject) : null)) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_subject_invalid`);
  }
  let normalized;
  try { normalized = normalizeHandle(candidate.handle?.canonical); } catch { normalized = null; }
  if (!exactFields(candidate.handle, HANDLE_FIELDS) || !normalized || normalized.display !== candidate.handle.canonical ||
      normalized.normalized !== candidate.handle.normalized || normalized.handleKey !== candidate.handle.handleKey) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_handle_invalid`);
  }
  const expectedRequestPrefix = `group-d2-${slot.toLowerCase()}-`;
  const request = candidate.request;
  if (!exactFields(request, REQUEST_FIELDS) || !REQUEST_ID.test(request.requestId || '') ||
      !request.requestId.startsWith(expectedRequestPrefix) || request.requestIdHash !== requestIdHash(request.requestId) ||
      request.requestBodyHash !== requestBodyHash(request.requestId, candidate.handle?.canonical) ||
      request.foundationFingerprint !== foundationFingerprint(subject || {}, candidate.handle || {}) ||
      !RATE_LIMIT_PATH.test(request.rateLimitDocumentPath || '') || request.rateLimitPathDerivationVerified !== true) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_request_invalid`);
  }
  const reviewedAt = Date.parse(candidate.review?.reviewedAt);
  if (!exactFields(candidate.review, REVIEW_FIELDS) || candidate.review.humanReviewed !== true ||
      candidate.review.selectionSource !== 'explicit-private-candidate' || !Number.isFinite(reviewedAt) || reviewedAt > now) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_review_invalid`);
  }
  if (!exactFields(candidate.eligibility, ELIGIBILITY_FIELDS) || candidate.eligibility.firebaseAuthUserExists !== true ||
      candidate.eligibility.firebaseAuthDisabled !== false ||
      ELIGIBILITY_FIELDS.slice(2).some((field) => candidate.eligibility[field] !== true)) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_ineligible`);
  }
  const verifiedAt = Date.parse(candidate.targetedAuthorityState?.verifiedAt);
  if (!exactFields(candidate.targetedAuthorityState, TARGETED_STATE_FIELDS) || !Number.isFinite(verifiedAt) ||
      verifiedAt < windowStart || verifiedAt > now || now - verifiedAt > MAX_TARGETED_STATE_AGE_MS ||
      TARGETED_STATE_FIELDS.slice(1).some((field) => candidate.targetedAuthorityState[field] !== true)) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_targeted_state_invalid`);
  }
  const modeled = exactFields(candidate, CANDIDATE_FIELDS) ? expectedCandidateState(candidate) : null;
  if (!exactFields(candidate.expectedState, EXPECTED_STATE_FIELDS) || !sameJson(candidate.expectedState, modeled)) {
    errors.push(`group_d2_candidate_${slot.toLowerCase()}_expected_state_invalid`);
  }
}

function guardProductionSecondMutation(input, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  const inputPath = options.inputPath;
  let manifest;
  let readiness;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('group_d2_readiness_missing_or_invalid'); }

  if (!exactFields(input, INPUT_FIELDS)) errors.push('group_d2_input_schema_invalid');
  if (readiness && !exactFields(readiness, ROOT_FIELDS)) errors.push('group_d2_readiness_schema_invalid');
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
  if (!sameJson(manifest?.secondMutation, EXPECTED_SECOND_MUTATION_MANIFEST)) errors.push('group_d2_manifest_contract_invalid');
  if (JSON.stringify({ manifest, input, readiness }).includes('trainer-hub-staging-37ib4wct')) errors.push('staging_target_present');

  let windowStart = NaN;
  if (readiness) {
    if (readiness.schemaVersion !== 1 || readiness.environment !== 'production' || readiness.projectId !== project.id ||
        readiness.projectNumber !== project.number || readiness.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url ||
        readiness.firestoreDatabaseId !== manifest?.firestore?.databaseId || readiness.region !== project.region) {
      errors.push('group_d2_readiness_target_mismatch');
    }
    if (readiness.approvalGroup !== 'D' || readiness.cohortStage !== 'D2' || readiness.approved !== true ||
        readiness.approvalAcknowledged !== true || readiness.teardownOwnerAcknowledged !== true ||
        readiness.humanOperator !== readiness.teardownOwner || !validIdentity(readiness.humanOperator) ||
        readiness.cohortSize !== 2 || readiness.laterGroupsAuthorized !== false || readiness.groupEAuthorized !== false) {
      errors.push('group_d2_approval_invalid');
    }
    windowStart = Date.parse(readiness.mutationWindow?.startAt);
    const windowEnd = Date.parse(readiness.mutationWindow?.endAt);
    const approvedAt = Date.parse(readiness.approvedAt);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || !Number.isFinite(approvedAt) ||
        windowStart >= windowEnd || windowEnd - windowStart > MAX_WINDOW_MS || now < windowStart || now >= windowEnd ||
        approvedAt > now) errors.push('group_d2_window_invalid');
    if (!privateMode(readinessPath)) errors.push('group_d2_readiness_permissions_invalid');
  }
  if (inputPath && !privateMode(inputPath)) errors.push('group_d2_input_permissions_invalid');
  if (!sameValues(readiness?.authorizedOperations, ALLOWED_OPERATIONS) ||
      !sameValues(input?.requestedOperations, ALLOWED_OPERATIONS)) errors.push('group_d2_operations_invalid');
  if (!Array.isArray(readiness?.candidates) || readiness.candidates.length !== 2 ||
      !Array.isArray(input?.candidates) || input.candidates.length !== 2 ||
      !sameJson(readiness?.candidates, input?.candidates)) errors.push('group_d2_candidates_invalid');

  const candidates = readiness?.candidates || [];
  validateCandidate(candidates[0], 'A', now, windowStart, errors);
  validateCandidate(candidates[1], 'B', now, windowStart, errors);
  if (candidates.length === 2) {
    const [a, b] = candidates;
    if (a.reviewedSubject?.firebaseUid === b.reviewedSubject?.firebaseUid ||
        a.reviewedSubject?.trainerUsername === b.reviewedSubject?.trainerUsername ||
        a.subjectHashes?.uidHash === b.subjectHashes?.uidHash || a.subjectHashes?.trainerHash === b.subjectHashes?.trainerHash ||
        a.handle?.handleKey === b.handle?.handleKey || a.request?.requestId === b.request?.requestId ||
        a.request?.rateLimitDocumentPath === b.request?.rateLimitDocumentPath) errors.push('group_d2_candidate_distinctness_invalid');
    if ([a.subjectHashes?.uidHash, b.subjectHashes?.uidHash].includes(D1_SUBJECT_HASHES.uidHash) ||
        [a.subjectHashes?.trainerHash, b.subjectHashes?.trainerHash].includes(D1_SUBJECT_HASHES.trainerHash) ||
        [a.handle?.handleKey, b.handle?.handleKey].includes(D1_HANDLE_KEY)) errors.push('group_d2_d1_collision');
  }

  if (!validD1Baseline(readiness?.d1Baseline) || !validD1Baseline(input?.d1Baseline) ||
      !sameJson(readiness?.d1Baseline, input?.d1Baseline)) errors.push('group_d2_d1_baseline_invalid');
  if (!validD1Observation(readiness?.d1Observation, now) || !validD1Observation(input?.d1Observation, now) ||
      !sameJson(readiness?.d1Observation, input?.d1Observation)) errors.push('group_d2_d1_observation_invalid');
  if (!validTokenVerifier(readiness?.tokenVerifier, manifest) || !validTokenVerifier(input?.tokenVerifier, manifest) ||
      !sameJson(readiness?.tokenVerifier, input?.tokenVerifier)) errors.push('group_d2_token_verifier_invalid');

  const disabled = disabledGatePlan();
  const enabled = activationGatePlan();
  if (!sameJson(input?.preActivationGates, disabled) || !sameJson(readiness?.activationGatePlan, enabled) ||
      !sameJson(input?.activationGatePlan, enabled) || !sameJson(readiness?.restorationGatePlan, disabled) ||
      !sameJson(input?.restorationGatePlan, disabled)) errors.push('group_d2_gate_plan_invalid');
  if (readiness?.rateLimiterMode !== DURABLE_MODE || input?.rateLimiterMode !== DURABLE_MODE ||
      input?.readProofModePresent !== false || input?.reserveConsumesLimitedUseAppCheck !== true) {
    errors.push('group_d2_limiter_or_app_check_invalid');
  }
  if (!sameJson(readiness?.expectedProgression, EXPECTED_PROGRESSION) ||
      !sameJson(input?.expectedProgression, EXPECTED_PROGRESSION) ||
      !sameJson(readiness?.executionSequence, EXECUTION_SEQUENCE) ||
      !sameJson(input?.executionSequence, EXECUTION_SEQUENCE) || !sameJson(readiness?.stopPolicy, STOP_POLICY) ||
      !sameJson(input?.stopPolicy, STOP_POLICY)) errors.push('group_d2_sequence_or_progression_invalid');
  if (readiness?.observationHours !== OBSERVATION_HOURS || input?.observationHours !== OBSERVATION_HOURS) {
    errors.push('group_d2_observation_invalid');
  }
  if (input?.cohortSize !== 2 || input?.expectedAppId !== EXPECTED_APP_ID || input?.genuineAppCheckAvailable !== true ||
      input?.laterGroupsAuthorized !== false || input?.groupEAuthorized !== false) errors.push('group_d2_input_approval_invalid');
  if (input?.gatewayRuntimeSoleAuthorityInvoker !== true || input?.publicAuthorityInvoker !== false ||
      input?.projectWideRunInvoker !== false || input?.gatewayForbiddenRolesPresent !== false ||
      input?.productionDebugTokensRegistered !== false) errors.push('group_d2_security_boundary_invalid');
  if (input?.productionRtdbWriteCount !== 0 || input?.productionAuthMutationCount !== 0 ||
      input?.productionPublicShareWriteCount !== 0) errors.push('group_d2_pre_activation_write_detected');

  if (errors.length) {
    const error = new Error('e1/production-second-mutation-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'D',
    cohortStage: 'D2',
    environment: 'production',
    targetVerified: true,
    d1BaselineVerified: true,
    d1ObservationVerified: true,
    candidateCount: 2,
    candidatesDistinct: true,
    targetedAbsenceVerified: true,
    sequentialExecutionRequired: true,
    expectedProgression: EXPECTED_PROGRESSION,
    rateLimiterMode: DURABLE_MODE,
    observationHours: OBSERVATION_HOURS,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

function validatePrivateHarnessSource(source, candidate) {
  const errors = [];
  const slot = candidate?.slot;
  const lower = String(slot || '').toLowerCase();
  if (!['A', 'B'].includes(slot) || !exactFields(candidate, CANDIDATE_FIELDS)) errors.push('group_d2_harness_candidate_invalid');
  for (const required of [
    `const candidateSlot = '${slot}'`,
    `const requestId = '${candidate?.request?.requestId}'`,
    EXPECTED_APP_ID,
    candidate?.subjectHashes?.uidHash,
    candidate?.subjectHashes?.trainerHash,
    `requestedHandle: '${candidate?.handle?.canonical}'`,
    'limitedUseAppCheckTokens: true',
    "'reserveE1TrainerHandle'",
    `window.__E1_GROUP_D2_${slot}_FIRST_ATTEMPTED__`,
    `window.__E1_GROUP_D2_${slot}_REPLAY_ATTEMPTED__`,
    'firstSucceeded !== true',
    'callable(requestBody)'
  ]) if (!String(source).includes(required)) errors.push('group_d2_harness_contract_missing');
  if ((String(source).match(/callable\(requestBody\)/gu) || []).length !== 2 ||
      (String(source).match(/const requestId =/gu) || []).length !== 1 || String(source).includes('crypto.randomUUID')) {
    errors.push('group_d2_harness_invocation_contract_invalid');
  }
  if (!String(source).includes("candidate.name === 'pogo'") || !String(source).includes('getApps()') ||
      String(source).includes('initializeApp(')) errors.push('group_d2_harness_app_boundary_invalid');
  if (/localStorage|sessionStorage|indexedDB/iu.test(String(source))) errors.push('group_d2_harness_persistence_forbidden');
  if (/signIn|signOut|firebase-database|\.firebaseio\.com|e1-identity-authority|fetch\s*\(/iu.test(String(source))) {
    errors.push('group_d2_harness_direct_or_auth_operation_forbidden');
  }
  if (/readE1AccountFoundation|repairAccountFoundation|applyMigrationManifest|freezeIdentityConflict/iu.test(String(source))) {
    errors.push('group_d2_harness_callable_forbidden');
  }
  if (errors.length) {
    const error = new Error('e1/group-d2-harness-invalid');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    candidateSlot: slot,
    requestIdHash: requestIdHash(candidate.request.requestId),
    firstInvocationCount: 1,
    replayInvocationCount: 1,
    limitedUseAppCheckTokens: true,
    persistentStorage: false,
    windowSentinelPrefix: `__E1_GROUP_D2_${slot}_`
  });
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  D1_HANDLE_KEY,
  D1_OBSERVATION_END,
  D1_STATE_DIGEST,
  D1_SUBJECT_HASHES,
  EXECUTION_SEQUENCE,
  EXPECTED_PROGRESSION,
  EXPECTED_SECOND_MUTATION_MANIFEST,
  INPUT_FIELDS,
  MANIFEST_PATH,
  MAX_TARGETED_STATE_AGE_MS,
  MAX_WINDOW_MS,
  OBSERVATION_HOURS,
  PRIVATE_HARNESS_PATHS,
  PRIVATE_INPUT_PATH,
  PRIVATE_READINESS_PATH,
  ROOT_FIELDS,
  STOP_POLICY,
  expectedCandidateState,
  foundationFingerprint,
  guardProductionSecondMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validatePrivateHarnessSource
});
