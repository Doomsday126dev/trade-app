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
  CANDIDATE_POOL_POLICY,
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
  EXECUTION_SEQUENCE,
  EXPECTED_COUNT_SEQUENCE,
  EXPECTED_D3_MANIFEST,
  EXECUTION_EVIDENCE_PURPOSE,
  FINAL_COUNTS,
  OBSERVATION_CHECKS,
  OBSERVATION_HOURS,
  OPERATION_BUDGET,
  READINESS_TIMING_POLICY,
  STOP_POLICY,
  SYNTHETIC_COHORT_TYPE,
  candidatePoolDigest,
  canonicalCandidateOrder,
  continuationArtifactDigest,
  continuationJitDigest,
  continuationPreflightDigest,
  continuationProgress,
  expectedDocumentCount,
  readinessContract,
  subjectBindingDigest,
  validateThirdMutationExecutionTiming
} = require('../production/e1ProductionThirdMutationContract.cjs');
const {
  ENABLE_CONFIRMATION,
  RESTORE_CONFIRMATION,
  canonicalPoolCandidate,
  foundationFingerprint,
  guardProductionThirdMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validateCandidatePoolArtifact,
  validateThirdMutationContinuationArtifact,
  validateThirdMutationContinuationJit,
  validateThirdMutationContinuationObservationStart,
  validateThirdMutationAcceptance
} = require('../production/e1ProductionThirdMutationGuard.cjs');
const {
  APP_CHECK_MODE,
  EXPECTED_ORIGIN,
  EXPECTED_PATHNAMES,
  HARNESS_MODE,
  LOGIN_METHOD,
  appCheckRuntimeProofDigest,
  harnessDigest
} = require('../production/e1ProductionThirdMutationBrowserHarness.cjs');

const NOW = Date.parse('2026-08-15T15:00:00.000Z');
const START = '2026-08-15T14:30:00.000Z';
const END = '2026-08-15T16:30:00.000Z';
const SOURCE_SHA = 'a'.repeat(40);
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

function poolSubjects() {
  return ['A', 'B', 'C', 'D', 'E'].map((slot, index) => ({
    firebaseUid: `synthetic-d3-uid-${index + 1}`,
    trainerUsername: `D3Trainer${slot}`,
    syntheticCanary: true
  }));
}

function candidatePool(subjects = poolSubjects()) {
  const canonical = subjects.map(canonicalPoolCandidate);
  const syntheticSetupDigest = '9'.repeat(64);
  return {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    acquisitionMode: CANDIDATE_POOL_POLICY.acquisitionMode,
    candidateCount: subjects.length,
    humanSupplied: true,
    suppliedAt: '2026-08-15T14:20:00.000Z',
    candidates: subjects,
    candidatePoolDigest: candidatePoolDigest(canonical, syntheticSetupDigest),
    executionAuthorized: false,
    syntheticSetupDigest,
    laterGroupsAuthorized: false,
    groupEAuthorized: false
  };
}

function candidate(slot, index, reviewedSubject) {
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
      selectionSource: 'guarded-private-d3-synthetic-canary'
    }
  };
}

function fixture(subjects = poolSubjects()) {
  const prior = priorCohort();
  const pool = candidatePool(subjects);
  const canonical = canonicalCandidateOrder(pool.candidates.map(canonicalPoolCandidate));
  const candidates = ['A', 'B', 'C', 'D', 'E'].map((slot, index) =>
    candidate(slot, index + 1, canonical[index].reviewedSubject));
  const bindingDigest = subjectBindingDigest(prior, candidates, pool.candidatePoolDigest);
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
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    cohortSize: 5,
    state: 'bound-reviewed',
    subjectsBound: true,
    executionAuthorized: false,
    acquisitionMode: CANDIDATE_POOL_POLICY.acquisitionMode,
    candidatePoolDigest: pool.candidatePoolDigest,
    boundAt: '2026-08-15T14:45:00.000Z',
    humanReviewed: true,
    priorCohort: prior,
    syntheticSetupDigest: pool.syntheticSetupDigest,
    candidates,
    bindingDigest
  };
  const browserHarness = {
    schemaVersion: 2,
    environment: 'production',
    projectId: 'trade-list-a4297',
    appId: EXPECTED_APP_ID,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    mode: HARNESS_MODE,
    bindingDigest,
    verifiedAt: '2026-08-15T14:55:00.000Z',
    subjects: candidates.map((value, index) => {
      const at = (offset) => new Date(Date.parse('2026-08-15T14:54:00.000Z') + offset).toISOString();
      const subject = {
        slot: value.slot,
        uidHash: value.subjectHashes.uidHash,
        trainerHash: value.subjectHashes.trainerHash,
        browserContextHash: String(index + 4).repeat(64),
        loginMethod: LOGIN_METHOD,
        exactUidMatch: true,
        previousSessionAbsent: true,
        operatorAdminSessionAbsent: true,
        firebaseIdTokenFresh: true,
        appCheckProvenance: {
          slot: value.slot,
          origin: EXPECTED_ORIGIN,
          pathname: EXPECTED_PATHNAMES[0],
          appId: EXPECTED_APP_ID,
          uidHash: value.subjectHashes.uidHash,
          trainerHash: value.subjectHashes.trainerHash,
          bindingDigest,
          probeStartedAt: at(0),
          samePageRuntimeEstablished: true,
          debugTokenGlobalAbsent: true,
          pageRuntimeBinding: { startedAt: at(0), settledAt: at(50), outcome: 'verified' },
          sdkImport: { startedAt: at(50), settledAt: at(100), outcome: 'resolved' },
          readiness: { startedAt: at(100), settledAt: at(150), outcome: 'resolved' },
          appCheckInstance: { startedAt: at(150), settledAt: at(160), outcome: 'verified', exactInstance: true },
          limitedUseToken: {
            startedAt: at(160), settledAt: at(250), outcome: 'resolved', nonEmpty: true,
            tokenFingerprint: ['b', 'c', 'd', 'e', 'f'][index].repeat(64),
            persisted: false, reused: false, sentToCallable: false
          },
          failureStage: null,
          runtimeProofDigest: ''
        },
        appCheckMode: APP_CHECK_MODE,
        debugTokenUsed: false,
        tokenPersistence: 'none',
        tokenReuseDetected: false
      };
      subject.appCheckProvenance.runtimeProofDigest = appCheckRuntimeProofDigest(subject.appCheckProvenance);
      return subject;
    }),
    debugTokensUsed: false,
    tokensPersisted: false,
    executionAuthorized: false,
    groupEAuthorized: false,
    harnessDigest: ''
  };
  browserHarness.harnessDigest = harnessDigest(browserHarness);
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
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    contractDefined: true,
    subjectsBindingDigest: bindingDigest,
    browserHarnessDigest: browserHarness.harnessDigest,
    subjectsBound: true,
    executionAuthorized: true,
    approvedAt: '2026-08-15T14:40:00.000Z',
    humanOperator: 'primary-operator',
    teardownOwner: 'primary-operator',
    approvalAcknowledged: true,
    teardownOwnerAcknowledged: true,
    readinessContract: readinessContract(SOURCE_SHA),
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
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    subjectsBindingDigest: bindingDigest,
    browserHarnessDigest: browserHarness.harnessDigest,
    subjectsBound: true,
    executionAuthorized: true,
    readinessContract: readinessContract(SOURCE_SHA),
    requestedOperations: ALLOWED_OPERATIONS,
    d2Baseline: D2_BASELINE,
    currentGates: structuredClone(disabledGatePlan()),
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
  return { pool, binding, browserHarness, readiness, input };
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
    const candidatePoolPath = writePrivate(directory, 'candidate-pool.json', values.pool);
    const readinessPath = writePrivate(directory, 'readiness.json', values.readiness);
    const browserHarnessPath = writePrivate(directory, 'browser-harness.json', values.browserHarness);
    const inputPath = writePrivate(directory, 'input.json', values.input);
    return guardProductionThirdMutation(values.input, {
      now: () => NOW,
      manifestPath: MANIFEST_PATH,
      candidatePoolPath,
      bindingPath,
      browserHarnessPath,
      readinessPath,
      inputPath,
      expectedSourceSha: SOURCE_SHA
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function continuationFixture() {
  const values = fixture();
  values.binding.bindingDigest = CONTINUATION_PINS.bindingDigest;
  values.binding.candidatePoolDigest = CONTINUATION_PINS.candidatePoolDigest;
  const candidateState = values.binding.candidates.map((candidateValue, index) => ({
    slot: candidateValue.slot,
    uidHash: candidateValue.subjectHashes.uidHash,
    trainerHash: candidateValue.subjectHashes.trainerHash,
    handleKey: candidateValue.handle.handleKey,
    requestIdHash: candidateValue.request.requestIdHash,
    requestBodyHash: candidateValue.request.requestBodyHash,
    foundationFingerprint: candidateValue.request.foundationFingerprint,
    rateLimitDocumentPath: candidateValue.request.rateLimitDocumentPath,
    accountState: index < 2 ? 'present-owned' : 'absent',
    handleState: index < 2 ? 'present-owned' : 'absent',
    rateLimitState: index < 2 ? 'present-valid' : 'absent',
    operationRequestCount: index < 2 ? 1 : 0,
    ownershipReciprocal: index < 2,
    requestBindingVerified: index < 2,
    replayEvidenceCount: index === 0 ? 1 : 0
  }));
  const artifact = {
    schemaVersion: 1,
    purpose: CONTINUATION_ARTIFACT_PURPOSE,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    region: 'us-central1',
    databaseId: 'phase-e-identity',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    productionRuntime: structuredClone(CONTINUATION_PRODUCTION_RUNTIME),
    appId: EXPECTED_APP_ID,
    approvalGroup: 'D',
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    candidatePoolDigest: CONTINUATION_PINS.candidatePoolDigest,
    bindingFileSha: CONTINUATION_PINS.bindingFileSha,
    bindingDigest: CONTINUATION_PINS.bindingDigest,
    historicalAdmission: {
      admittedAt: '2026-08-15T14:56:00.000Z',
      browserHarnessDigest: CONTINUATION_PINS.browserHarnessDigest,
      browserHarnessFileSha: CONTINUATION_PINS.browserHarnessFileSha,
      initialJitDigest: CONTINUATION_PINS.initialJitDigest,
      initialReadinessDigest: CONTINUATION_PINS.initialReadinessDigest,
      initialGuardDigest: CONTINUATION_PINS.initialGuardDigest,
      originalEvidenceValidAtAdmission: true
    },
    interruptedSession: {
      sessionIdHash: '7'.repeat(64),
      state: 'paused-closed',
      closedAt: '2026-08-15T14:57:00.000Z',
      closeReason: 'contained-after-b-reserve-authoritative-reconciliation'
    },
    reconciliation: {
      acceptedRolloverEvidenceDigest: CONTINUATION_PINS.acceptedRolloverEvidenceDigest,
      evidenceDigest: CONTINUATION_PINS.reconciliationEvidenceDigest,
      executionLedgerDigest: CONTINUATION_PINS.executionLedgerDigest,
      verifiedAt: '2026-08-15T14:58:00.000Z',
      aReserveInvocations: 1,
      aReplayInvocations: 1,
      laterSlotInvocations: 1,
      acceptedHistoricalRateLimitReplayWrites: 1,
      remainingRateLimitReplayWrites: 0,
      previousStateFingerprint: CONTINUATION_COMPLETED_PREFIX.at(-2).stateFingerprint,
      currentStateFingerprint: CONTINUATION_STATE_FINGERPRINT
    },
    completedPrefix: structuredClone(CONTINUATION_COMPLETED_PREFIX),
    acceptedUsage: structuredClone(CONTINUATION_ACCEPTED_USAGE),
    nextOperation: structuredClone(CONTINUATION_REMAINING_SEQUENCE[0]),
    currentState: {
      totalDocuments: 20,
      accounts: 5,
      trainerHandles: 5,
      rateLimits: 5,
      operationRequests: 5,
      identityMigrations: 0,
      identityConflicts: 0,
      unexpectedPaths: 0,
      ordinaryUserEffects: 0,
      canonicalFingerprint: CONTINUATION_STATE_FINGERPRINT
    },
    candidateState,
    remainingSequence: structuredClone(CONTINUATION_REMAINING_SEQUENCE),
    expectedCountSequence: structuredClone(CONTINUATION_COUNT_SEQUENCE),
    remainingBudget: structuredClone(CONTINUATION_REMAINING_BUDGET),
    currentGates: structuredClone(disabledGatePlan()),
    runtimeProvenance: values.readiness.runtimeProvenance,
    securityBoundary: values.input.securityBoundary,
    writeBoundary: values.input.writeBoundary,
    preflight: {
      verifiedAt: '2026-08-15T14:59:00.000Z',
      expiresAt: '2026-08-15T15:10:00.000Z',
      digest: ''
    },
    historicalEvidenceRecollectionRequired: false,
    executionAuthorized: false,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    artifactDigest: ''
  };
  artifact.preflight.digest = continuationPreflightDigest(artifact);
  artifact.artifactDigest = continuationArtifactDigest(artifact);
  const jit = {
    schemaVersion: 1,
    purpose: CONTINUATION_JIT_PURPOSE,
    continuationArtifactDigest: artifact.artifactDigest,
    continuationPreflightDigest: artifact.preflight.digest,
    continuationContractSourceSha: SOURCE_SHA,
    approvedAt: '2026-08-15T14:59:30.000Z',
    entryEvidenceExpiresAt: '2026-08-15T15:10:00.000Z',
    humanOperator: 'primary-operator',
    teardownOwner: 'primary-operator',
    approvalAcknowledged: true,
    teardownOwnerAcknowledged: true,
    mutationWindow: { startAt: '2026-08-15T15:00:00.000Z', endAt: '2026-08-15T16:30:00.000Z' },
    nextOperation: structuredClone(CONTINUATION_REMAINING_SEQUENCE[0]),
    remainingSequence: structuredClone(CONTINUATION_REMAINING_SEQUENCE),
    expectedCountSequence: structuredClone(CONTINUATION_COUNT_SEQUENCE),
    acceptedUsage: structuredClone(CONTINUATION_ACCEPTED_USAGE),
    remainingBudget: structuredClone(CONTINUATION_REMAINING_BUDGET),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    executionAuthorized: true,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    jitDigest: ''
  };
  jit.jitDigest = continuationJitDigest(jit);
  return { artifact, binding: values.binding, manifest: JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')), jit };
}

function refreshContinuationDigests(value) {
  value.preflight.digest = continuationPreflightDigest(value);
  value.artifactDigest = continuationArtifactDigest(value);
  return value;
}

function validateContinuation(values = continuationFixture()) {
  return validateThirdMutationContinuationArtifact(values.artifact, {
    manifest: values.manifest,
    binding: values.binding,
    historicalAdmissionVerified: true
  }, { now: () => NOW });
}

function validatePool(pool = candidatePool(), mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-d3-pool-'));
  try {
    const candidatePoolPath = writePrivate(directory, 'candidate-pool.json', pool);
    fs.chmodSync(candidatePoolPath, mode);
    return validateCandidatePoolArtifact(pool, { now: () => NOW, candidatePoolPath });
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
    cohortType: SYNTHETIC_COHORT_TYPE,
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

test('tracked D3 contract is unbound and unauthorized while defining exact reserve/replay progression and budget', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(manifest.thirdMutation, EXPECTED_D3_MANIFEST);
  assert.deepEqual(EXPECTED_COUNT_SEQUENCE, [12, 16, 16, 20, 20, 24, 24, 28, 28, 32, 32]);
  assert.deepEqual(Array.from({ length: 11 }, (_, index) => expectedDocumentCount(index)), EXPECTED_COUNT_SEQUENCE);
  assert.equal(manifest.thirdMutation.subjectBinding.subjectsBound, false);
  assert.equal(manifest.thirdMutation.subjectBinding.executionAuthorized, false);
  assert.deepEqual(manifest.thirdMutation.readinessTiming, READINESS_TIMING_POLICY);
  assert.equal(READINESS_TIMING_POLICY.entryEvidenceMaxAgeMs, ENTRY_EVIDENCE_MAX_AGE_MS);
  assert.equal(READINESS_TIMING_POLICY.requiredAt, 'enable-group-d3');
  assert.equal(READINESS_TIMING_POLICY.requiredAfterEnable, false);
  assert.equal(READINESS_TIMING_POLICY.mutationWindowGovernsPostEnable, true);
  assert.deepEqual(manifest.thirdMutation.candidatePool, CANDIDATE_POOL_POLICY);
  assert.equal(manifest.thirdMutation.candidatePool.automatedProductionDiscovery, false);
  assert.equal(manifest.thirdMutation.candidatePool.toolingSelectsSubjects, false);
  assert.equal(manifest.thirdMutation.operation, 'reserve-plus-exact-replay');
  assert.equal(OPERATION_BUDGET.gatewayCalls, 10);
  assert.equal(OPERATION_BUDGET.firestoreTransactionAttemptsMaximum, 75);
  assert.equal(OPERATION_BUDGET.operationRequestExistenceReads, 10);
  assert.equal(OPERATION_BUDGET.firestoreCommittedWrites, 20);
  assert.equal(OPERATION_BUDGET.rtdbWrites, 0);
  assert.equal(OPERATION_BUDGET.verificationReadsTotalMaximum, 510);
});

test('guarded synthetic exact-five pool validates without binding or authorization and reports no raw identity', () => {
  const pool = candidatePool();
  const result = validatePool(pool);
  assert.equal(result.ok, true);
  assert.equal(result.candidateCount, 5);
  assert.equal(result.subjectsBound, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.automatedProductionDiscovery, false);
  assert.equal(result.fallbackCandidateSubstitution, false);
  assert.equal(result.groupEAuthorized, false);
  const report = JSON.stringify(result);
  for (const subject of pool.candidates) {
    assert.doesNotMatch(report, new RegExp(subject.firebaseUid, 'u'));
    assert.doesNotMatch(report, new RegExp(subject.trainerUsername, 'u'));
  }
});

test('retired real-world eligibility artifacts cannot satisfy the synthetic D3 pool contract', () => {
  const retired = candidatePool();
  retired.cohortType = 'real-world-read-only-compatibility';
  retired.evidencePurpose = 'read-only-compatibility';
  retired.acquisitionMode = 'operator-supplied-exact-five';
  retired.candidates = retired.candidates.map(({ firebaseUid, trainerUsername }) => ({ firebaseUid, trainerUsername }));
  assert.throws(() => validatePool(retired), (error) =>
    error.reasons.includes('group_d3_candidate_pool_schema_invalid') &&
    error.reasons.includes('group_d3_candidate_pool_subject_invalid'));
});

test('mixed real and synthetic candidate pools fail closed', () => {
  const mixed = candidatePool();
  mixed.candidates[2].syntheticCanary = false;
  assert.throws(() => validatePool(mixed), (error) =>
    error.reasons.includes('group_d3_candidate_pool_subject_invalid'));
});

test('candidate pool canonical order and digest are stable across input order and harmless normalization', () => {
  const subjects = poolSubjects();
  const reordered = [subjects[3], subjects[0], subjects[4], subjects[1], subjects[2]];
  const normalizedEquivalent = structuredClone(reordered);
  const target = normalizedEquivalent.find((subject) => subject.trainerUsername === 'D3TrainerA');
  target.trainerUsername = '  Ｄ３ＴｒａｉｎｅｒＡ  ';
  const first = validatePool(candidatePool(subjects));
  const second = validatePool(candidatePool(reordered));
  const third = validatePool(candidatePool(normalizedEquivalent));
  assert.equal(first.candidatePoolDigest, second.candidatePoolDigest);
  assert.equal(first.candidatePoolDigest, third.candidatePoolDigest);
  assert.deepEqual(
    first.canonicalCandidates.map((candidate) => candidate.subjectHashes),
    third.canonicalCandidates.map((candidate) => candidate.subjectHashes)
  );
  const firstBinding = fixture(subjects).binding;
  const equivalentBinding = fixture(normalizedEquivalent).binding;
  assert.deepEqual(
    firstBinding.candidates.map((candidate) => ({
      slot: candidate.slot,
      reviewedSubject: candidate.reviewedSubject,
      subjectHashes: candidate.subjectHashes,
      handle: candidate.handle
    })),
    equivalentBinding.candidates.map((candidate) => ({
      slot: candidate.slot,
      reviewedSubject: candidate.reviewedSubject,
      subjectHashes: candidate.subjectHashes,
      handle: candidate.handle
    }))
  );
  assert.equal(firstBinding.bindingDigest, equivalentBinding.bindingDigest);
});

for (const [name, mutate, reason] of [
  ['four subjects', (value) => { value.candidates.pop(); value.candidateCount = 4; }, 'group_d3_candidate_pool_schema_invalid'],
  ['six subjects', (value) => { value.candidates.push({ firebaseUid: 'synthetic-sixth-uid', trainerUsername: 'D3TrainerF' }); value.candidateCount = 6; }, 'group_d3_candidate_pool_schema_invalid'],
  ['duplicate raw identity', (value) => { value.candidates[1] = structuredClone(value.candidates[0]); }, 'group_d3_candidate_pool_raw_duplicate'],
  ['duplicate normalized identity', (value) => { value.candidates[1].trainerUsername = value.candidates[0].trainerUsername.toLowerCase(); }, 'group_d3_candidate_pool_normalized_duplicate'],
  ['password field', (value) => { value.candidates[0].password = 'not-allowed'; }, 'group_d3_candidate_pool_subject_invalid'],
  ['PIN field', (value) => { value.candidates[0].pin = 'not-allowed'; }, 'group_d3_candidate_pool_subject_invalid'],
  ['token field', (value) => { value.candidates[0].token = 'not-allowed'; }, 'group_d3_candidate_pool_subject_invalid'],
  ['authorization', (value) => { value.executionAuthorized = true; }, 'group_d3_candidate_pool_schema_invalid']
]) {
  test(`candidate pool fails closed for ${name}`, () => {
    const value = candidatePool();
    mutate(value);
    value.candidatePoolDigest = candidatePoolDigest(value.candidates.slice(0, 5).map((subject) => {
      try { return canonicalPoolCandidate(subject); } catch { return canonicalPoolCandidate(poolSubjects()[4]); }
    }), value.syntheticSetupDigest);
    assert.throws(() => validatePool(value), (error) => error.reasons.includes(reason));
  });
}

test('candidate pool requires private 0600 permissions and tracked path remains ignored', () => {
  assert.throws(() => validatePool(candidatePool(), 0o644),
    (error) => error.reasons.includes('group_d3_candidate_pool_permissions_invalid'));
  const ignore = require('node:child_process').spawnSync('git', [
    'check-ignore', 'functions/.local/e1-production-third-mutation-candidate-pool.json'
  ], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  assert.equal(ignore.status, 0);
});

test('candidate-pool checker mode needs no readiness file and emits only privacy-safe aggregate state', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const localDirectory = path.resolve(__dirname, '../.local');
  fs.mkdirSync(localDirectory, { recursive: true });
  const candidatePoolPath = writePrivate(localDirectory, `e1-d3-pool-test-${process.pid}.json`, candidatePool());
  try {
    const run = require('node:child_process').spawnSync(process.execPath, [
      'functions/scripts/check-e1-production-third-mutation-target.cjs', '--mode=candidate-pool'
    ], {
      cwd: repoRoot,
      env: { ...process.env, E1_PRODUCTION_THIRD_MUTATION_CANDIDATE_POOL: candidatePoolPath },
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.mode, 'candidate-pool-schema-validation');
    assert.equal(report.candidateCount, 5);
    assert.equal(report.executionAuthorized, false);
    assert.equal(report.cloudOperations, 0);
    for (const subject of poolSubjects()) {
      assert.doesNotMatch(run.stdout, new RegExp(subject.firebaseUid, 'u'));
      assert.doesNotMatch(run.stdout, new RegExp(subject.trainerUsername, 'u'));
    }
  } finally { fs.rmSync(candidatePoolPath, { force: true }); }
});

test('exact five-subject private binding and authorized preflight pass without cloud operations', () => {
  const result = runGuard();
  assert.equal(result.ok, true);
  assert.equal(result.cohortStage, 'D3');
  assert.equal(result.candidateCount, 5);
  assert.equal(result.subjectsBound, true);
  assert.equal(result.executionAuthorized, true);
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.equal(result.entryEvidenceFreshAtEnable, true);
  assert.equal(result.entryEvidenceExpiresAt, '2026-08-15T15:10:00.000Z');
  assert.equal(result.entryEvidenceRequiredAfterEnable, false);
  assert.equal(result.mutationWindowEnd, END);
  assert.equal(result.mutationWindowGovernsPostEnable, true);
  assert.equal(result.d2BaselineVerified, true);
  assert.equal(result.cloudOperations, 0);
  assert.equal(result.groupEAuthorized, false);
});

test('exact reconciled prefix through B reserve authorizes only B replay after fresh JIT', () => {
  const values = continuationFixture();
  const artifactResult = validateContinuation(values);
  assert.equal(artifactResult.ok, true);
  assert.equal(artifactResult.currentDocumentCount, 20);
  assert.deepEqual(artifactResult.completedPrefix, CONTINUATION_COMPLETED_PREFIX);
  assert.deepEqual(artifactResult.nextOperation, { slot: 'B', operation: 'exact-replay' });
  assert.deepEqual(artifactResult.acceptedUsage, CONTINUATION_ACCEPTED_USAGE);
  assert.equal(artifactResult.executionAuthorized, false);
  assert.equal(artifactResult.historicalEvidenceRecollectionRequired, false);
  const jitResult = validateThirdMutationContinuationJit(values.jit, artifactResult, SOURCE_SHA, { now: () => NOW });
  assert.equal(jitResult.executionAuthorized, true);
  assert.deepEqual(jitResult.nextOperation, { slot: 'B', operation: 'exact-replay' });
  assert.equal(jitResult.remainingSequence.length, 7);
  assert.equal(jitResult.groupEAuthorized, false);
});

test('mocked continuation rehearsal advances B replay through E replay and starts observation only after restoration', () => {
  const expectedCounts = CONTINUATION_COUNT_SEQUENCE;
  for (let completed = 0; completed <= CONTINUATION_REMAINING_SEQUENCE.length; completed += 1) {
    const progress = continuationProgress(completed);
    assert.equal(progress.currentDocumentCount, expectedCounts[completed]);
    assert.deepEqual(progress.nextOperation, CONTINUATION_REMAINING_SEQUENCE[completed] || null);
    assert.deepEqual(progress.remainingSequence, CONTINUATION_REMAINING_SEQUENCE.slice(completed));
    assert.equal(progress.remainingBudget.gatewayCalls, 7 - completed);
    assert.equal(progress.remainingBudget.authorityCalls, 7 - completed);
    assert.equal(progress.remainingBudget.limitedUseAppCheckTokens, 7 - completed);
    assert.equal(progress.remainingBudget.firstWriteSubjects,
      3 - CONTINUATION_REMAINING_SEQUENCE.slice(0, completed).filter((item) => item.operation === 'reserve').length);
    assert.equal(progress.remainingBudget.replayOperations,
      4 - CONTINUATION_REMAINING_SEQUENCE.slice(0, completed).filter((item) => item.operation === 'exact-replay').length);
  }
  const finalProgress = continuationProgress(CONTINUATION_REMAINING_SEQUENCE.length);
  assert.equal(finalProgress.complete, true);
  assert.equal(finalProgress.currentDocumentCount, 32);
  assert.equal(finalProgress.remainingBudget.firestoreCommittedWrites, 0);
  assert.equal(finalProgress.remainingBudget.operationRequestCreates, 0);
  assert.equal(finalProgress.remainingBudget.rateLimitCreates, 0);
  const start = {
    completedSuffixOperations: CONTINUATION_REMAINING_SEQUENCE.length,
    acceptedUsage: CONTINUATION_ACCEPTED_USAGE,
    remainingBudget: finalProgress.remainingBudget,
    finalCounts: FINAL_COUNTS,
    finalStateDigest: 'f'.repeat(64),
    gatesRestored: disabledGatePlan(),
    securityBoundary: fixture().input.securityBoundary,
    anomaliesAbsent: true,
    startedAt: new Date(NOW - 1_000).toISOString(),
    observationHours: 24,
    groupEAuthorized: false
  };
  const observation = validateThirdMutationContinuationObservationStart(start, { now: () => NOW });
  assert.equal(Date.parse(observation.endAt) - Date.parse(observation.startAt), 24 * 60 * 60 * 1000);
  assert.throws(() => validateThirdMutationContinuationObservationStart({ ...start,
    gatesRestored: activationGatePlan() }, { now: () => NOW }), /observation-start-invalid/u);
  assert.throws(() => validateThirdMutationContinuationObservationStart({ ...start,
    completedSuffixOperations: CONTINUATION_REMAINING_SEQUENCE.length - 1 }, { now: () => NOW }), /observation-start-invalid/u);
});

test('original clean-start guard remains the unchanged 12-document all-targets-absent mode', () => {
  const result = runGuard();
  assert.equal(result.d2BaselineVerified, true);
  assert.equal(result.targetedAbsenceVerified, true);
  assert.deepEqual(result.expectedCountSequence, EXPECTED_COUNT_SEQUENCE);
  assert.equal(result.expectedCountSequence[0], 12);
});

for (const [name, mutate, reason] of [
  ['empty completed prefix', (value) => { value.completedPrefix = []; }, 'group_d3_continuation_prefix_or_next_invalid'],
  ['extra completed operation', (value) => { value.completedPrefix.push({ slot: 'A', operation: 'exact-replay' }); }, 'group_d3_continuation_prefix_or_next_invalid'],
  ['A reserve eligible again', (value) => { value.nextOperation = { slot: 'A', operation: 'reserve' }; }, 'group_d3_continuation_prefix_or_next_invalid'],
  ['skipped next operation', (value) => { value.nextOperation = { slot: 'C', operation: 'reserve' }; }, 'group_d3_continuation_prefix_or_next_invalid'],
  ['12 documents', (value) => { value.currentState.totalDocuments = 12; }, 'group_d3_continuation_current_state_invalid'],
  ['19 documents', (value) => { value.currentState.totalDocuments = 19; }, 'group_d3_continuation_current_state_invalid'],
  ['21 documents', (value) => { value.currentState.totalDocuments = 21; }, 'group_d3_continuation_current_state_invalid'],
  ['wrong family composition', (value) => { value.currentState.accounts = 6; value.currentState.trainerHandles = 4; }, 'group_d3_continuation_current_state_invalid'],
  ['wrong state fingerprint', (value) => { value.currentState.canonicalFingerprint = 'f'.repeat(64); }, 'group_d3_continuation_current_state_invalid'],
  ['A ownership mismatch', (value) => { value.candidateState[0].ownershipReciprocal = false; }, 'group_d3_continuation_candidate_a_state_invalid'],
  ['A subject mismatch', (value) => { value.candidateState[0].uidHash = 'f'.repeat(64); }, 'group_d3_continuation_candidate_a_binding_invalid'],
  ['A handle mismatch', (value) => { value.candidateState[0].handleKey = 'v1_00'; }, 'group_d3_continuation_candidate_a_binding_invalid'],
  ['A request binding mismatch', (value) => { value.candidateState[0].requestBodyHash = 'f'.repeat(64); }, 'group_d3_continuation_candidate_a_binding_invalid'],
  ['A operation request absent', (value) => { value.candidateState[0].operationRequestCount = 0; }, 'group_d3_continuation_candidate_a_state_invalid'],
  ['A operation request duplicated', (value) => { value.candidateState[0].operationRequestCount = 2; }, 'group_d3_continuation_candidate_a_state_invalid'],
  ['A replay evidence missing', (value) => { value.candidateState[0].replayEvidenceCount = 0; }, 'group_d3_continuation_candidate_a_state_invalid'],
  ['B target absent', (value) => { value.candidateState[1].accountState = 'absent'; }, 'group_d3_continuation_candidate_b_state_invalid'],
  ['B replay falsely completed', (value) => { value.candidateState[1].replayEvidenceCount = 1; }, 'group_d3_continuation_candidate_b_state_invalid'],
  ['accepted rollover digest mismatch', (value) => { value.reconciliation.acceptedRolloverEvidenceDigest = 'f'.repeat(64); }, 'group_d3_continuation_reconciliation_invalid'],
  ['reconciliation digest mismatch', (value) => { value.reconciliation.evidenceDigest = 'f'.repeat(64); }, 'group_d3_continuation_reconciliation_invalid'],
  ['execution ledger mismatch', (value) => { value.reconciliation.executionLedgerDigest = 'f'.repeat(64); }, 'group_d3_continuation_reconciliation_invalid'],
  ['A replay invocation hidden', (value) => { value.reconciliation.aReplayInvocations = 0; }, 'group_d3_continuation_reconciliation_invalid'],
  ['B reserve invocation hidden', (value) => { value.reconciliation.laterSlotInvocations = 0; }, 'group_d3_continuation_reconciliation_invalid'],
  ['historical replay write count expanded', (value) => { value.reconciliation.acceptedHistoricalRateLimitReplayWrites = 2; }, 'group_d3_continuation_reconciliation_invalid'],
  ['pre-replay state digest mismatch', (value) => { value.reconciliation.previousStateFingerprint = 'f'.repeat(64); }, 'group_d3_continuation_reconciliation_invalid'],
  ['post-replay state digest mismatch', (value) => { value.reconciliation.currentStateFingerprint = 'f'.repeat(64); }, 'group_d3_continuation_reconciliation_invalid'],
  ['historical replay usage hidden', (value) => { value.acceptedUsage.rateLimitReplayWrites = 0; }, 'group_d3_continuation_prefix_or_next_invalid'],
  ['remaining replay write allowed', (value) => { value.remainingBudget.rateLimitReplayWrites = 1; }, 'group_d3_continuation_sequence_or_budget_invalid'],
  ['historical harness mismatch', (value) => { value.historicalAdmission.browserHarnessDigest = 'f'.repeat(64); }, 'group_d3_continuation_historical_admission_invalid'],
  ['historical JIT mismatch', (value) => { value.historicalAdmission.initialJitDigest = 'f'.repeat(64); }, 'group_d3_continuation_historical_admission_invalid'],
  ['historical guard mismatch', (value) => { value.historicalAdmission.initialGuardDigest = 'f'.repeat(64); }, 'group_d3_continuation_historical_admission_invalid'],
  ['release drift', (value) => { value.productionRuntime.releaseId = '2026-08-20.52'; }, 'group_d3_continuation_schema_or_target_invalid'],
  ['source drift', (value) => { value.productionRuntime.sourceSha = 'f'.repeat(40); }, 'group_d3_continuation_schema_or_target_invalid'],
  ['app drift', (value) => { value.appId = 'wrong-app'; }, 'group_d3_continuation_schema_or_target_invalid'],
  ['cohort drift', (value) => { value.cohortType = 'ordinary-users'; }, 'group_d3_continuation_schema_or_target_invalid'],
  ['binding drift', (value) => { value.bindingDigest = 'f'.repeat(64); }, 'group_d3_continuation_schema_or_target_invalid'],
  ['stale preflight', (value) => { value.preflight.verifiedAt = '2026-08-15T14:40:00.000Z'; value.preflight.expiresAt = '2026-08-15T14:55:00.000Z'; }, 'group_d3_continuation_preflight_invalid'],
  ['enabled starting gate', (value) => { value.currentGates.RESERVE_HANDLE_ENABLED = true; }, 'group_d3_continuation_gates_not_disabled'],
  ['authority revision drift', (value) => { value.runtimeProvenance.authorityRevision = 'wrong'; }, 'group_d3_continuation_runtime_or_isolation_invalid'],
  ['public authority', (value) => { value.securityBoundary.publicAuthorityInvoker = true; }, 'group_d3_continuation_runtime_or_isolation_invalid'],
  ['unexpected path', (value) => { value.currentState.unexpectedPaths = 1; }, 'group_d3_continuation_current_state_invalid'],
  ['identity conflict', (value) => { value.currentState.identityConflicts = 1; }, 'group_d3_continuation_current_state_invalid'],
  ['identity migration', (value) => { value.currentState.identityMigrations = 1; }, 'group_d3_continuation_current_state_invalid'],
  ['ordinary-user effect', (value) => { value.currentState.ordinaryUserEffects = 1; }, 'group_d3_continuation_current_state_invalid'],
  ['expanded mutation budget', (value) => { value.remainingBudget.firstWriteSubjects = 5; }, 'group_d3_continuation_sequence_or_budget_invalid'],
  ['reordered suffix', (value) => { [value.remainingSequence[1], value.remainingSequence[2]] = [value.remainingSequence[2], value.remainingSequence[1]]; }, 'group_d3_continuation_sequence_or_budget_invalid'],
  ['skipped count state', (value) => { value.expectedCountSequence.splice(1, 1); }, 'group_d3_continuation_sequence_or_budget_invalid']
]) {
  test(`D3 continuation fails closed for ${name}`, () => {
    const values = continuationFixture();
    mutate(values.artifact);
    refreshContinuationDigests(values.artifact);
    assert.throws(() => validateContinuation(values), (error) => error.reasons.includes(reason));
  });
}

for (const [name, mutate] of [
  ['missing fresh JIT', (value) => { value.schemaVersion = 0; }],
  ['stale JIT', (value) => { value.approvedAt = '2026-08-15T14:40:00.000Z'; value.entryEvidenceExpiresAt = '2026-08-15T14:55:00.000Z'; }],
  ['wrong contract source', (value) => { value.continuationContractSourceSha = 'f'.repeat(40); }],
  ['A replay next', (value) => { value.nextOperation = { slot: 'A', operation: 'exact-replay' }; }],
  ['historical usage omitted', (value) => { delete value.acceptedUsage; }],
  ['skipped JIT suffix', (value) => { value.remainingSequence.shift(); }],
  ['skipped JIT count state', (value) => { value.expectedCountSequence.shift(); }],
  ['expanded JIT budget', (value) => { value.remainingBudget.gatewayCalls = 10; }]
]) {
  test(`D3 continuation JIT fails closed for ${name}`, () => {
    const values = continuationFixture();
    const artifactResult = validateContinuation(values);
    mutate(values.jit);
    values.jit.jitDigest = continuationJitDigest(values.jit);
    assert.throws(() => validateThirdMutationContinuationJit(values.jit, artifactResult, SOURCE_SHA, { now: () => NOW }),
      /continuation-jit-failed/u);
  });
}

test('D3 entry evidence is required at enable but is not a post-enable lease', () => {
  const exactBoundary = fixture();
  for (const candidateValue of exactBoundary.binding.candidates) {
    candidateValue.authEligibility.verifiedAt = '2026-08-15T14:45:00.000Z';
    candidateValue.targetedAuthorityState.verifiedAt = '2026-08-15T14:45:00.000Z';
  }
  assert.equal(runGuard(exactBoundary).entryEvidenceExpiresAt, '2026-08-15T15:00:00.000Z');

  const operationTimes = [
    '2026-08-15T15:00:00.500Z',
    '2026-08-15T15:00:00.900Z',
    '2026-08-15T15:00:01.001Z',
    '2026-08-15T15:20:00.000Z',
    '2026-08-15T16:00:00.000Z'
  ];
  for (const operationAt of operationTimes) {
    const execution = validateThirdMutationExecutionTiming({
      enabledAt: NOW,
      operationAt: Date.parse(operationAt),
      mutationWindow: { startAt: START, endAt: END },
      entryEvidenceExpiresAt: '2026-08-15T15:00:01.000Z'
    });
    assert.equal(execution.entryEvidenceRequiredAfterEnable, false);
    assert.equal(execution.mutationWindowGovernsPostEnable, true);
    assert.equal(execution.operationAt, operationAt);
  }
  assert.throws(() => validateThirdMutationExecutionTiming({
    enabledAt: NOW,
    operationAt: Date.parse(END),
    mutationWindow: { startAt: START, endAt: END },
    entryEvidenceExpiresAt: '2026-08-15T15:00:01.000Z'
  }), /execution-timing-invalid/u);
});

test('D3 fails closed when entry evidence expires before enable', () => {
  const values = fixture();
  for (const candidateValue of values.binding.candidates) {
    candidateValue.authEligibility.verifiedAt = '2026-08-15T14:44:59.999Z';
    candidateValue.targetedAuthorityState.verifiedAt = '2026-08-15T14:44:59.999Z';
  }
  assert.throws(() => runGuard(values), (error) =>
    error.reasons.includes('group_d3_entry_timing_invalid') &&
    error.reasons.includes('group_d3_candidate_a_auth_invalid'));
});

test('D3 enable fails closed after the mutation window expires', () => {
  const values = fixture();
  values.readiness.mutationWindow.endAt = '2026-08-15T14:59:59.999Z';
  assert.throws(() => runGuard(values), (error) =>
    error.reasons.includes('group_d3_window_invalid') &&
    error.reasons.includes('group_d3_entry_timing_invalid'));
});

test('D3 activation and input bind to the exact source while pool and subject binding remain reusable', () => {
  const values = fixture();
  const poolDigest = values.pool.candidatePoolDigest;
  const bindingDigest = values.binding.bindingDigest;
  values.readiness.readinessContract = readinessContract('b'.repeat(40));
  assert.throws(() => runGuard(values), (error) => error.reasons.includes('group_d3_readiness_contract_invalid'));
  assert.equal(values.pool.candidatePoolDigest, poolDigest);
  assert.equal(values.binding.bindingDigest, bindingDigest);
  assert.equal(candidatePoolDigest(values.pool.candidates.map(canonicalPoolCandidate), values.pool.syntheticSetupDigest), poolDigest);
  assert.equal(subjectBindingDigest(values.binding.priorCohort, values.binding.candidates, poolDigest), bindingDigest);
});

test('subject binding is separate from execution authorization and uses a deterministic reviewed digest', () => {
  const values = fixture();
  assert.equal(values.binding.executionAuthorized, false);
  assert.equal(values.readiness.executionAuthorized, true);
  assert.equal(values.binding.candidatePoolDigest, values.pool.candidatePoolDigest);
  assert.notEqual(values.binding.bindingDigest, values.binding.candidatePoolDigest);
  assert.equal(values.binding.bindingDigest, subjectBindingDigest(
    values.binding.priorCohort,
    values.binding.candidates,
    values.binding.candidatePoolDigest
  ));
  values.binding.bindingDigest = 'f'.repeat(64);
  assert.throws(() => runGuard(values), (error) => error.reasons.includes('group_d3_binding_digest_mismatch'));
});

test('boolean-only App Check evidence cannot begin D3 readiness or authorize gate enablement', () => {
  const values = fixture();
  delete values.browserHarness.subjects[0].appCheckProvenance;
  values.browserHarness.subjects[0].limitedUseAppCheckAvailable = true;
  values.browserHarness.harnessDigest = harnessDigest(values.browserHarness);
  values.readiness.browserHarnessDigest = values.browserHarness.harnessDigest;
  values.input.browserHarnessDigest = values.browserHarness.harnessDigest;
  assert.throws(() => runGuard(values), (error) =>
    error.reasons.includes('group_d3_browser_harness_subject_a_invalid'));
  assert.deepEqual(values.input.currentGates, disabledGatePlan());
});

for (const [name, mutate, reason] of [
  ['four subjects', (value) => { value.binding.candidates.pop(); }, 'group_d3_subject_binding_invalid'],
  ['six subjects', (value) => { value.binding.candidates.push(structuredClone(value.binding.candidates[0])); }, 'group_d3_subject_binding_invalid'],
  ['real-world binding type', (value) => { value.binding.cohortType = 'real-world-read-only-compatibility'; }, 'group_d3_subject_binding_invalid'],
  ['wrong activation cohort type', (value) => { value.readiness.cohortType = 'real-world-read-only-compatibility'; }, 'group_d3_approval_invalid'],
  ['stale browser binding', (value) => { value.browserHarness.bindingDigest = 'f'.repeat(64); value.browserHarness.harnessDigest = harnessDigest(value.browserHarness); }, 'group_d3_browser_harness_binding_invalid'],
  ['duplicate subject', (value) => { value.binding.candidates[1] = structuredClone(value.binding.candidates[0]); value.binding.candidates[1].slot = 'B'; }, 'group_d3_candidates_not_distinct'],
  ['prior D1 overlap', (value) => { value.binding.priorCohort.members[0].uidHash = value.binding.candidates[0].subjectHashes.uidHash; }, 'group_d3_candidate_a_prior_cohort_overlap'],
  ['prior D2 overlap', (value) => { value.binding.priorCohort.members[1].handleKey = value.binding.candidates[1].handle.handleKey; }, 'group_d3_candidate_b_prior_cohort_overlap'],
  ['pool and binding mismatch', (value) => { value.pool.candidates[0].firebaseUid = 'different-private-subject'; }, 'group_d3_candidate_pool_digest_mismatch'],
  ['noncanonical bound order', (value) => { [value.binding.candidates[0], value.binding.candidates[1]] = [value.binding.candidates[1], value.binding.candidates[0]]; value.binding.candidates[0].slot = 'A'; value.binding.candidates[1].slot = 'B'; }, 'group_d3_binding_candidate_pool_mismatch'],
  ['wrong D2 digest', (value) => { value.input.d2Baseline = { ...value.input.d2Baseline, stateDigest: 'f'.repeat(64) }; }, 'group_d3_d2_baseline_invalid'],
  ['wrong D2 count', (value) => { value.readiness.d2Baseline = { ...value.readiness.d2Baseline, accounts: 4 }; }, 'group_d3_d2_baseline_invalid'],
  ['login directory not ready', (value) => { value.binding.candidates[1].eligibility.loginDirectoryReady = false; }, 'group_d3_candidate_b_ineligible'],
  ['admin or system subject', (value) => { value.binding.candidates[1].eligibility.adminOrSystemIdentityAbsent = false; }, 'group_d3_candidate_b_ineligible'],
  ['partial durable state', (value) => { value.binding.candidates[1].targetedAuthorityState.accountAbsent = false; }, 'group_d3_candidate_b_targeted_state_invalid'],
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

test('D3 source exposes validation modes but no production subject discovery capability', () => {
  const checker = fs.readFileSync(path.resolve(__dirname, '../scripts/check-e1-production-third-mutation-target.cjs'), 'utf8');
  const runbook = fs.readFileSync(path.resolve(__dirname, '../../docs/E1-D3-RESERVE-COHORT-RUNBOOK.md'), 'utf8');
  assert.match(checker, /--mode=/u);
  assert.match(checker, /candidate-pool/u);
  assert.doesNotMatch(checker, /listUsers|collectionGroup|\.list\(|orderBy|limit\(/u);
  assert.match(runbook, /never enumerates, discovers, ranks, or selects production accounts/u);
  assert.match(runbook, /Do not choose a sixth subject/u);
});

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
  ['Group E enabled', (value) => { value.groupEAuthorized = true; }, 'group_d3_acceptance_schema_or_summary_invalid'],
  ['real-world cohort acceptance', (value) => { value.cohortType = 'real-world-read-only-compatibility'; }, 'group_d3_acceptance_schema_or_summary_invalid']
]) {
  test(`final D3 acceptance fails for ${name}`, () => {
    const value = acceptance();
    mutate(value);
    assert.throws(() => validateThirdMutationAcceptance(value, { now: () => NOW }),
      (error) => error.reasons.includes(reason));
  });
}
