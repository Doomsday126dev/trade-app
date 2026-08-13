'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const {
  ALLOWED_OPERATIONS,
  D1_HANDLE_KEY,
  D1_OBSERVATION_END,
  D1_STATE_DIGEST,
  D1_SUBJECT_HASHES,
  EXECUTION_SEQUENCE,
  EXPECTED_PROGRESSION,
  OBSERVATION_HOURS,
  STOP_POLICY,
  expectedCandidateState,
  foundationFingerprint,
  guardProductionSecondMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validatePrivateHarnessSource
} = require('../production/e1ProductionSecondMutationGuard.cjs');
const {
  EXPECTED_APP_ID,
  EXPECTED_TOKEN_VERIFIER,
  activationGatePlan,
  disabledGatePlan
} = require('../production/e1ProductionFirstMutationGuard.cjs');
const { DURABLE_MODE } = require('../e1-authority-service/readRateLimiters');

const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function candidate(slot, uid, trainer, requestId, rateHash) {
  const reviewedSubject = { firebaseUid: uid, trainerUsername: trainer };
  const normalized = normalizeHandle(trainer);
  const handle = { canonical: normalized.display, normalized: normalized.normalized, handleKey: normalized.handleKey };
  const request = {
    requestId,
    requestIdHash: requestIdHash(requestId),
    requestBodyHash: requestBodyHash(requestId, handle.canonical),
    foundationFingerprint: foundationFingerprint(reviewedSubject, handle),
    rateLimitDocumentPath: `rateLimits/reserveTrainerHandle_${rateHash}`,
    rateLimitPathDerivationVerified: true
  };
  const value = {
    slot,
    reviewedSubject,
    subjectHashes: { ...subjectHashesFor(reviewedSubject) },
    handle,
    request,
    review: { humanReviewed: true, reviewedAt: '2030-01-01T11:40:00.000Z', selectionSource: 'explicit-private-candidate' },
    authEligibility: {
      mode: 'exact-auth-metadata',
      verifiedAt: '2030-01-01T11:55:00.000Z',
      exactAuthMetadata: {
        userExists: true,
        firebaseAuthDisabled: false,
        lookupMethod: 'exact-uid',
        observedAt: '2030-01-01T11:55:00.000Z'
      },
      browserLogin: null
    },
    eligibility: {
      reciprocalLegacyOwnershipVerified: true,
      loginDirectoryReady: true,
      identityAmbiguityAbsent: true,
      migrationEvidenceAbsent: true,
      conflictEvidenceAbsent: true
    },
    targetedAuthorityState: {
      verifiedAt: '2030-01-01T11:55:00.000Z',
      accountAbsent: true,
      handleAbsent: true,
      operationRequestAbsent: true,
      reserveRateLimitAbsent: true,
      migrationAbsent: true,
      conflictAbsent: true,
      competingHandleAbsent: true
    }
  };
  value.expectedState = JSON.parse(JSON.stringify(expectedCandidateState(value)));
  return value;
}

function fixture(readinessOverrides = {}, inputOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-second-mutation-guard-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const readinessPath = path.join(directory, 'readiness.json');
  const inputPath = path.join(directory, 'input.json');
  fs.copyFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), manifestPath);
  const candidates = [
    candidate('A', 'candidate-a-uid', 'KnownCleanAlpha', 'group-d2-a-00000000-0000-4000-8000-000000000001', '1111111111111111'),
    candidate('B', 'candidate-b-uid', 'KnownCleanBeta', 'group-d2-b-00000000-0000-4000-8000-000000000002', '2222222222222222')
  ];
  const d1Baseline = {
    applicationDocumentCount: 4,
    stateDigest: D1_STATE_DIGEST,
    accountRevision: 1,
    handleRevision: 1,
    firstResult: 'SUCCESS',
    replayResult: 'IDEMPOTENT',
    ownerSubjectHashes: { ...D1_SUBJECT_HASHES },
    ownerHandleKey: D1_HANDLE_KEY,
    exactKnownStateVerified: true,
    forbiddenRecordClassesAbsent: true
  };
  const d1Observation = {
    startAt: '2026-08-11T19:24:02.510Z',
    endAt: D1_OBSERVATION_END,
    completed: true,
    healthy: true,
    stateDigestUnchanged: true,
    documentCountUnchanged: true,
    gatesRestored: { ...disabledGatePlan() },
    laterGroupsAuthorized: false,
    groupEAuthorized: false
  };
  const tokenVerifier = { ...EXPECTED_TOKEN_VERIFIER, permissions: [...EXPECTED_TOKEN_VERIFIER.permissions] };
  const readiness = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    firestoreDatabaseId: 'phase-e-identity',
    region: 'us-central1',
    approvalGroup: 'D',
    cohortStage: 'D2',
    approved: true,
    approvedAt: '2030-01-01T11:45:00.000Z',
    humanOperator: 'primary-operator',
    teardownOwner: 'primary-operator',
    approvalAcknowledged: true,
    teardownOwnerAcknowledged: true,
    mutationWindow: { startAt: '2030-01-01T11:30:00.000Z', endAt: '2030-01-01T13:30:00.000Z' },
    candidates: JSON.parse(JSON.stringify(candidates)),
    d1Baseline: { ...d1Baseline, ownerSubjectHashes: { ...d1Baseline.ownerSubjectHashes } },
    d1Observation: { ...d1Observation, gatesRestored: { ...d1Observation.gatesRestored } },
    tokenVerifier,
    cohortSize: 2,
    authorizedOperations: [...ALLOWED_OPERATIONS],
    activationGatePlan: { ...activationGatePlan() },
    restorationGatePlan: { ...disabledGatePlan() },
    rateLimiterMode: DURABLE_MODE,
    expectedProgression: { ...EXPECTED_PROGRESSION },
    executionSequence: [...EXECUTION_SEQUENCE],
    stopPolicy: { ...STOP_POLICY },
    observationHours: OBSERVATION_HOURS,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    ...readinessOverrides
  };
  fs.writeFileSync(readinessPath, JSON.stringify(readiness), { mode: 0o600 });
  const input = {
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    expectedProjectNumber: '1053781218847',
    region: 'us-central1',
    databaseId: 'phase-e-identity',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    requestedOperations: [...ALLOWED_OPERATIONS],
    candidates: JSON.parse(JSON.stringify(readiness.candidates)),
    d1Baseline: JSON.parse(JSON.stringify(readiness.d1Baseline)),
    d1Observation: JSON.parse(JSON.stringify(readiness.d1Observation)),
    tokenVerifier: JSON.parse(JSON.stringify(tokenVerifier)),
    cohortSize: 2,
    expectedAppId: EXPECTED_APP_ID,
    genuineAppCheckAvailable: true,
    preActivationGates: { ...disabledGatePlan() },
    activationGatePlan: { ...activationGatePlan() },
    restorationGatePlan: { ...disabledGatePlan() },
    rateLimiterMode: DURABLE_MODE,
    readProofModePresent: false,
    reserveConsumesLimitedUseAppCheck: true,
    expectedProgression: { ...EXPECTED_PROGRESSION },
    executionSequence: [...EXECUTION_SEQUENCE],
    stopPolicy: { ...STOP_POLICY },
    gatewayRuntimeSoleAuthorityInvoker: true,
    publicAuthorityInvoker: false,
    projectWideRunInvoker: false,
    gatewayForbiddenRolesPresent: false,
    productionDebugTokensRegistered: false,
    writeBoundary: {
      legacyLoginWrites: [],
      e1AuthorityWrites: [],
      controlPlaneWrites: [],
      unexpectedWrites: []
    },
    observationHours: OBSERVATION_HOURS,
    laterGroupsAuthorized: false,
    groupEAuthorized: false,
    ...inputOverrides
  };
  fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  return { manifestPath, readinessPath, inputPath, readiness, input };
}

function reasons(call) {
  assert.throws(call, (error) => {
    assert.equal(error.message, 'e1/production-second-mutation-guard-failed');
    assert.ok(error.reasons.length);
    return true;
  });
}

function syncCandidates(value) {
  value.input.candidates = JSON.parse(JSON.stringify(value.readiness.candidates));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
}

function browserLoginEvidence(candidate, overrides = {}) {
  return {
    mode: 'verified-browser-login',
    verifiedAt: '2030-01-01T11:55:00.000Z',
    exactAuthMetadata: null,
    browserLogin: {
      loginSucceeded: true,
      currentUserPresent: true,
      reviewedUidHash: candidate.subjectHashes.uidHash,
      reviewedTrainerHash: candidate.subjectHashes.trainerHash,
      browserUidHash: candidate.subjectHashes.uidHash,
      browserTrainerHash: candidate.subjectHashes.trainerHash,
      appId: EXPECTED_APP_ID,
      appCheckObtainable: true,
      authIndexUsernameMatches: true,
      userAuthUidMatches: true,
      loginDirectoryReady: true,
      mappingVerifiedAt: '2030-01-01T11:55:00.000Z',
      firebaseAuthDisabledMetadata: 'not-independently-observed',
      writeAuditComplete: true,
      ...overrides
    }
  };
}

function loginWrite(candidate, service, path, operation, purpose, changedFields, overrides = {}) {
  return {
    candidateSlot: candidate.slot,
    service,
    path,
    operation,
    purpose,
    recordCreated: false,
    changedFields,
    ownershipMappingChanged: false,
    privilegeStateChanged: false,
    e1AuthorityDataTouched: false,
    credentialUpgradeOnly: false,
    ...overrides
  };
}

function useBrowserLogin(value, index, overrides = {}) {
  const candidateValue = value.readiness.candidates[index];
  candidateValue.authEligibility = browserLoginEvidence(candidateValue, overrides);
  value.input.writeBoundary.legacyLoginWrites.push(loginWrite(
    candidateValue,
    'firebase-auth',
    `users/${candidateValue.reviewedSubject.firebaseUid}/metadata/lastSignInTime`,
    'platform-sign-in',
    'authentication-session-metadata',
    ['lastSignInTime']
  ));
  syncCandidates(value);
}

test('D2 guard accepts exactly two reviewed distinct candidates on the known healthy D1 baseline', () => {
  const value = fixture();
  const result = guardProductionSecondMutation(value.input, { now: () => NOW, ...value });
  assert.deepEqual(result.expectedProgression, EXPECTED_PROGRESSION);
  assert.equal(result.cohortStage, 'D2');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.observationHours, 48);
  assert.equal(result.groupEAuthorized, false);
});

test('exact Auth metadata mode requires a fresh exact lookup of an enabled user', () => {
  const value = fixture();
  assert.equal(guardProductionSecondMutation(value.input, { now: () => NOW, ...value }).authEligibilityVerified, true);
  value.readiness.candidates[0].authEligibility.exactAuthMetadata.firebaseAuthDisabled = true;
  syncCandidates(value);
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));

  const stale = fixture();
  stale.readiness.candidates[0].authEligibility.verifiedAt = '2030-01-01T11:30:00.000Z';
  stale.readiness.candidates[0].authEligibility.exactAuthMetadata.observedAt = '2030-01-01T11:30:00.000Z';
  syncCandidates(stale);
  reasons(() => guardProductionSecondMutation(stale.input, { now: () => NOW, ...stale }));
});

test('browser-login mode accepts matching fresh Auth App Check and reciprocal evidence without disabled metadata', () => {
  const value = fixture();
  useBrowserLogin(value, 0);
  const proof = value.readiness.candidates[0].authEligibility;
  assert.equal(proof.exactAuthMetadata, null);
  assert.equal(proof.browserLogin.firebaseAuthDisabledMetadata, 'not-independently-observed');
  assert.equal(guardProductionSecondMutation(value.input, { now: () => NOW, ...value }).writeBoundaryVerified, true);
});

test('browser-login mode fails on wrong UID trainer missing App Check or stale proof', () => {
  for (const override of [
    { browserUidHash: '0'.repeat(64) },
    { browserTrainerHash: '1'.repeat(64) },
    { appCheckObtainable: false },
    { mappingVerifiedAt: '2030-01-01T11:30:00.000Z' }
  ]) {
    const value = fixture();
    useBrowserLogin(value, 0, override);
    if (override.mappingVerifiedAt) value.readiness.candidates[0].authEligibility.verifiedAt = override.mappingVerifiedAt;
    syncCandidates(value);
    reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
  }
});

test('unknown missing or contradictory Auth evidence fails closed', () => {
  for (const mutate of [
    (candidateValue) => { candidateValue.authEligibility.mode = 'unknown'; },
    (candidateValue) => { delete candidateValue.authEligibility; },
    (candidateValue) => { candidateValue.authEligibility.browserLogin = browserLoginEvidence(candidateValue).browserLogin; }
  ]) {
    const value = fixture();
    mutate(value.readiness.candidates[0]);
    syncCandidates(value);
    reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
  }
});

test('one candidate browser proof cannot satisfy the other candidate', () => {
  const value = fixture();
  const candidateA = value.readiness.candidates[0];
  const candidateB = value.readiness.candidates[1];
  candidateB.authEligibility = browserLoginEvidence(candidateA);
  value.input.writeBoundary.legacyLoginWrites.push(loginWrite(
    candidateB, 'firebase-auth', `users/${candidateB.reviewedSubject.firebaseUid}/metadata/lastSignInTime`,
    'platform-sign-in', 'authentication-session-metadata', ['lastSignInTime']
  ));
  syncCandidates(value);
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('only exact committed legacy login-session writes are allowed during browser proof', () => {
  const value = fixture();
  useBrowserLogin(value, 0);
  const candidateA = value.readiness.candidates[0];
  value.input.writeBoundary.legacyLoginWrites.push(
    loginWrite(candidateA, 'rtdb', `authIndex/${candidateA.reviewedSubject.firebaseUid}/lastSeen`, 'update',
      'login-session-refresh', ['lastSeen']),
    loginWrite(candidateA, 'rtdb', `users/${candidateA.reviewedSubject.trainerUsername}`, 'set',
      'login-user-refresh', ['lastSeen', 'authEmail', 'authVersion'])
  );
  assert.equal(guardProductionSecondMutation(value.input, { now: () => NOW, ...value }).writeBoundaryVerified, true);
});

test('unexpected legacy E1 authority or control-plane writes fail closed', () => {
  for (const mutate of [
    (value) => value.input.writeBoundary.legacyLoginWrites.push(loginWrite(
      value.readiness.candidates[0], 'rtdb', 'loginDirectory/KnownCleanAlpha', 'set', 'login-user-refresh', ['lastSeen'])),
    (value) => value.input.writeBoundary.legacyLoginWrites.push(loginWrite(
      value.readiness.candidates[0], 'rtdb', `authIndex/${value.readiness.candidates[0].reviewedSubject.firebaseUid}/lastSeen`,
      'update', 'login-session-refresh', ['lastSeen'], { recordCreated: true })),
    (value) => value.input.writeBoundary.legacyLoginWrites.push(loginWrite(
      value.readiness.candidates[0], 'rtdb', `users/${value.readiness.candidates[0].reviewedSubject.trainerUsername}`,
      'set', 'login-user-refresh', ['lastSeen', 'authUid'], { ownershipMappingChanged: true })),
    (value) => value.input.writeBoundary.e1AuthorityWrites.push('accounts/candidate-a-uid'),
    (value) => value.input.writeBoundary.controlPlaneWrites.push('run-service-update'),
    (value) => value.input.writeBoundary.unexpectedWrites.push('publicShares/KnownCleanAlpha')
  ]) {
    const value = fixture();
    mutate(value);
    reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
  }
});

test('D1 authorization and a one-user cohort cannot satisfy D2', () => {
  const value = fixture({ cohortStage: undefined, cohortSize: 1, candidates: [fixture().readiness.candidates[0]] });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('candidate UID trainer handle request and rate-limit paths must all be distinct', () => {
  const value = fixture();
  value.input.candidates[1].reviewedSubject.firebaseUid = value.input.candidates[0].reviewedSubject.firebaseUid;
  value.readiness.candidates = JSON.parse(JSON.stringify(value.input.candidates));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('neither D2 candidate may collide with the D1 owner subject or handle', () => {
  const value = fixture();
  value.input.candidates[0].subjectHashes.uidHash = D1_SUBJECT_HASHES.uidHash;
  value.readiness.candidates = JSON.parse(JSON.stringify(value.input.candidates));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('stale targeted absence evidence fails closed', () => {
  const value = fixture();
  value.input.candidates[0].targetedAuthorityState.verifiedAt = '2030-01-01T11:30:00.000Z';
  value.readiness.candidates = JSON.parse(JSON.stringify(value.input.candidates));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('ownership ambiguity or migration evidence fails closed independently of Auth evidence mode', () => {
  const value = fixture();
  value.input.candidates[1].eligibility.identityAmbiguityAbsent = false;
  value.readiness.candidates = JSON.parse(JSON.stringify(value.input.candidates));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('D1 digest and completed healthy observation are mandatory', () => {
  const value = fixture();
  value.input.d1Baseline.stateDigest = '0'.repeat(64);
  value.readiness.d1Baseline = JSON.parse(JSON.stringify(value.input.d1Baseline));
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('sequential progression and stop policy cannot be weakened', () => {
  const value = fixture();
  value.input.executionSequence = [...EXECUTION_SEQUENCE].reverse();
  value.readiness.executionSequence = [...value.input.executionSequence];
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('only gateway and reserve gates may be enabled and proof mode stays absent', () => {
  const value = fixture();
  value.input.activationGatePlan.READ_ACCOUNT_FOUNDATION_ENABLED = true;
  value.readiness.activationGatePlan.READ_ACCOUNT_FOUNDATION_ENABLED = true;
  fs.writeFileSync(value.readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('Group E or later-group authorization fails closed', () => {
  const value = fixture({ groupEAuthorized: true }, { groupEAuthorized: true });
  reasons(() => guardProductionSecondMutation(value.input, { now: () => NOW, ...value }));
});

test('D2 harness binds one candidate and exposes separate one-shot first and replay controls', () => {
  const value = fixture();
  const candidateA = value.readiness.candidates[0];
  const source = `
    const candidateSlot = 'A';
    const requestId = '${candidateA.request.requestId}';
    const app = getApps().find(candidate => candidate.name === 'pogo');
    const appId = '${EXPECTED_APP_ID}';
    const uidHash = '${candidateA.subjectHashes.uidHash}';
    const trainerHash = '${candidateA.subjectHashes.trainerHash}';
    const callable = httpsCallable(getFunctions(app, 'us-central1'), 'reserveE1TrainerHandle', { limitedUseAppCheckTokens: true });
    const requestBody = { schemaVersion: 1, requestId, requestedHandle: '${candidateA.handle.canonical}' };
    async function first(){ if(window.__E1_GROUP_D2_A_FIRST_ATTEMPTED__) return; window.__E1_GROUP_D2_A_FIRST_ATTEMPTED__=true; await callable(requestBody); }
    let firstSucceeded = true;
    async function replay(){ if(firstSucceeded !== true || window.__E1_GROUP_D2_A_REPLAY_ATTEMPTED__) return; window.__E1_GROUP_D2_A_REPLAY_ATTEMPTED__=true; await callable(requestBody); }
  `;
  assert.equal(validatePrivateHarnessSource(source, candidateA).candidateSlot, 'A');
});

test('D2 harness rejects automatic IDs persistent storage and forbidden callables', () => {
  const value = fixture();
  reasonsHarness(() => validatePrivateHarnessSource('crypto.randomUUID(); localStorage.x=1; repairAccountFoundation();', value.readiness.candidates[0]));
});

function reasonsHarness(call) {
  assert.throws(call, (error) => {
    assert.equal(error.message, 'e1/group-d2-harness-invalid');
    return true;
  });
}
