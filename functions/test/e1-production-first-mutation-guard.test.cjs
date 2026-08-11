'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');
const { guardProductionInfrastructure } = require('../production/e1ProductionInfrastructureGuard.cjs');
const { guardProductionReadProof } = require('../production/e1ProductionReadProofGuard.cjs');
const {
  ALLOWED_OPERATIONS,
  EXPECTED_APP_ID,
  EXPECTED_HANDLE,
  EXPECTED_TOKEN_VERIFIER,
  PRIVATE_HARNESS_PATH,
  activationGatePlan,
  disabledGatePlan,
  expectedState,
  foundationFingerprint,
  guardProductionFirstMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validatePrivateHarnessSource
} = require('../production/e1ProductionFirstMutationGuard.cjs');
const { DURABLE_MODE, GROUP_C_PROOF_MODE } = require('../e1-authority-service/readRateLimiters');

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const SUBJECT = Object.freeze({ firebaseUid: 'reviewed-owner-uid', trainerUsername: 'ReviewedOwner' });
const REQUEST_ID = 'group-d-owner-00000000-0000-4000-8000-000000000000';

function fixture(readinessOverrides = {}, inputOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-first-mutation-guard-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const readinessPath = path.join(directory, 'readiness.json');
  const inputPath = path.join(directory, 'input.json');
  fs.copyFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), manifestPath);
  const subjectHashes = subjectHashesFor(SUBJECT);
  const request = {
    requestId: REQUEST_ID,
    requestIdHash: requestIdHash(REQUEST_ID),
    requestBodyHash: requestBodyHash(REQUEST_ID),
    foundationFingerprint: foundationFingerprint(SUBJECT),
    rateLimitDocumentPath: 'rateLimits/reserveTrainerHandle_0123456789abcdef'
  };
  const groupCProof = {
    accepted: true,
    acceptedAt: '2030-01-01T10:00:00.000Z',
    correlationHash: '0123456789abcdef',
    auth: 'VALID',
    appCheck: 'VALID',
    oidcPrivateAuthority: true,
    firebaseAdminVerifyIdToken: true,
    resultCode: 'FOUNDATION_NOT_INITIALIZED',
    firestoreCollectionCount: 0,
    firestoreDocumentCount: 0
  };
  const state = expectedState(SUBJECT, request);
  const readiness = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    firestoreDatabaseId: 'phase-e-identity',
    region: 'us-central1',
    approvalGroup: 'D',
    approved: true,
    approvedAt: '2030-01-01T11:55:00.000Z',
    humanOperator: 'primary-operator',
    teardownOwner: 'primary-operator',
    approvalAcknowledged: true,
    teardownOwnerAcknowledged: true,
    mutationWindow: { startAt: '2030-01-01T11:30:00.000Z', endAt: '2030-01-01T13:30:00.000Z' },
    reviewedSubject: { ...SUBJECT },
    subjectHashes: { ...subjectHashes },
    handle: { ...EXPECTED_HANDLE },
    request: { ...request },
    groupCProof: { ...groupCProof },
    tokenVerifier: { ...EXPECTED_TOKEN_VERIFIER, permissions: [...EXPECTED_TOKEN_VERIFIER.permissions] },
    cohortSize: 1,
    authorizedOperations: [...ALLOWED_OPERATIONS],
    activationGatePlan: { ...activationGatePlan() },
    restorationGatePlan: { ...disabledGatePlan() },
    rateLimiterMode: DURABLE_MODE,
    expectedState: JSON.parse(JSON.stringify(state)),
    observationHours: 24,
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
    reviewedSubject: { ...SUBJECT },
    subjectHashes: { ...subjectHashes },
    handle: { ...EXPECTED_HANDLE },
    request: { ...request },
    groupCProof: { ...groupCProof },
    tokenVerifier: { ...EXPECTED_TOKEN_VERIFIER, permissions: [...EXPECTED_TOKEN_VERIFIER.permissions] },
    cohortSize: 1,
    reciprocalLegacyOwnershipVerified: true,
    loginDirectoryReady: true,
    expectedAppId: EXPECTED_APP_ID,
    genuineAppCheckAvailable: true,
    freshAuthorityState: {
      collectionCount: 0,
      documentCount: 0,
      accountAbsent: true,
      handleAbsent: true,
      operationRequestAbsent: true,
      reserveRateLimitAbsent: true,
      migrationStateAbsent: true,
      conflictStateAbsent: true,
      competingHandleAbsent: true
    },
    preActivationGates: { ...disabledGatePlan() },
    activationGatePlan: { ...activationGatePlan() },
    restorationGatePlan: { ...disabledGatePlan() },
    readLimiterMode: DURABLE_MODE,
    groupCProofLimiterPresent: false,
    reserveConsumesLimitedUseAppCheck: true,
    expectedState: JSON.parse(JSON.stringify(state)),
    gatewayRuntimeSoleAuthorityInvoker: true,
    publicAuthorityInvoker: false,
    projectWideRunInvoker: false,
    gatewayForbiddenRolesPresent: false,
    productionDebugTokensRegistered: false,
    productionRtdbWriteCount: 0,
    productionAuthMutationCount: 0,
    productionPublicShareWriteCount: 0,
    observationHours: 24,
    ...inputOverrides
  };
  fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  return {
    input, inputPath, manifestPath, readinessPath,
    expectedSubjectHashes: subjectHashes,
    expectedRequestHashes: { requestIdHash: request.requestIdHash, requestBodyHash: request.requestBodyHash }
  };
}

function run(value) {
  return guardProductionFirstMutation(value.input, {
    manifestPath: value.manifestPath,
    readinessPath: value.readinessPath,
    inputPath: value.inputPath,
    expectedSubjectHashes: value.expectedSubjectHashes,
    expectedRequestHashes: value.expectedRequestHashes,
    now: () => NOW
  });
}

function reason(value, expected) {
  assert.throws(() => run(value), (error) => error.reasons.includes(expected));
}

test('valid Group D state authorizes one owner reservation and exact replay only', () => {
  assert.deepEqual(run(fixture()), {
    ok: true,
    approvalGroup: 'D',
    environment: 'production',
    targetVerified: true,
    reviewedOwnerVerified: true,
    handleVerified: true,
    preMutationStateVerified: true,
    expectedFirstWriteDocuments: 4,
    expectedReplayDocuments: 4,
    rateLimiterMode: DURABLE_MODE,
    cohortSize: 1,
    observationHours: 24,
    laterGroupsAuthorized: false,
    cloudOperations: 0
  });
});

test('Group A B C and E approval material cannot satisfy Group D or inherit it', () => {
  for (const approvalGroup of ['A', 'B', 'C', 'E']) reason(fixture({ approvalGroup }), 'group_d_approval_invalid');
  const groupD = fixture();
  assert.throws(() => guardProductionInfrastructure({}, {
    manifestPath: groupD.manifestPath, readinessPath: groupD.readinessPath, now: () => NOW
  }), (error) => error.reasons.includes('group_a_approval_invalid'));
  assert.throws(() => guardProductionTarget({}, {
    manifestPath: groupD.manifestPath, readinessPath: groupD.readinessPath, now: NOW
  }), (error) => error.reasons.includes('private_readiness_mismatch'));
  assert.throws(() => guardProductionReadProof({}, {
    manifestPath: groupD.manifestPath, readinessPath: groupD.readinessPath, now: () => NOW
  }), (error) => error.reasons.includes('group_c_approval_invalid'));
  reason(fixture({ groupEAuthorized: true }), 'group_d_approval_invalid');
});

test('Group D requires a private active window no longer than two hours', () => {
  const missing = fixture();
  fs.unlinkSync(missing.readinessPath);
  reason(missing, 'group_d_readiness_missing_or_invalid');
  reason(fixture({ mutationWindow: { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' } }),
    'group_d_window_invalid');
  reason(fixture({ mutationWindow: { startAt: '2030-01-01T08:00:00.000Z', endAt: '2030-01-01T09:00:00.000Z' } }),
    'group_d_window_invalid');
  const permissions = fixture();
  fs.chmodSync(permissions.readinessPath, 0o644);
  reason(permissions, 'group_d_readiness_permissions_invalid');
});

test('Group D binds one exact reviewed subject handle and request', () => {
  reason(fixture({}, { cohortSize: 2 }), 'group_d_owner_ineligible');
  reason(fixture({ cohortSize: 2 }), 'group_d_approval_invalid');
  reason(fixture({}, { subjectHashes: { uidHash: '0'.repeat(64), trainerHash: '1'.repeat(64) } }),
    'group_d_subject_hash_mismatch');
  reason(fixture({}, { handle: { ...EXPECTED_HANDLE, canonical: 'OtherTrainer' } }), 'group_d_handle_mismatch');
  const changedRequest = fixture();
  changedRequest.input.request.requestIdHash = '0'.repeat(64);
  reason(changedRequest, 'group_d_request_contract_invalid');
  reason(fixture({}, { expectedAppId: 'wrong-app' }), 'group_d_owner_ineligible');
});

test('Group C proof App Check verifier and empty authority state are mandatory', () => {
  reason(fixture({}, { groupCProof: { accepted: false } }), 'group_d_group_c_proof_invalid');
  reason(fixture({}, { tokenVerifier: { ...EXPECTED_TOKEN_VERIFIER, present: false } }), 'group_d_token_verifier_invalid');
  reason(fixture({}, { freshAuthorityState: {
    collectionCount: 1, documentCount: 1, accountAbsent: false, handleAbsent: true, operationRequestAbsent: true,
    reserveRateLimitAbsent: true, migrationStateAbsent: true, conflictStateAbsent: true, competingHandleAbsent: true
  } }), 'group_d_authority_state_not_zero');
  reason(fixture({}, { genuineAppCheckAvailable: false }), 'group_d_owner_ineligible');
});

test('only gateway and reserve may activate with the durable limiter', () => {
  reason(fixture({}, { activationGatePlan: { ...activationGatePlan(), READ_ACCOUNT_FOUNDATION_ENABLED: true } }),
    'group_d_gate_plan_invalid');
  reason(fixture({}, { activationGatePlan: { ...activationGatePlan(), REPAIR_FOUNDATION_ENABLED: true } }),
    'group_d_gate_plan_invalid');
  reason(fixture({}, { readLimiterMode: GROUP_C_PROOF_MODE, groupCProofLimiterPresent: true }),
    'group_d_limiter_or_app_check_invalid');
  reason(fixture({}, { reserveConsumesLimitedUseAppCheck: false }), 'group_d_limiter_or_app_check_invalid');
  reason(fixture({}, { requestedOperations: [...ALLOWED_OPERATIONS, 'apply-migration'] }), 'group_d_operations_invalid');
});

test('the first write and replay model is exact and idempotent', () => {
  const firstCount = fixture();
  firstCount.input.expectedState.firstWriteDocumentCount = 5;
  reason(firstCount, 'group_d_expected_state_invalid');
  const replayCount = fixture();
  replayCount.input.expectedState.replayDocumentCount = 5;
  reason(replayCount, 'group_d_expected_state_invalid');
  const requestId = fixture();
  requestId.input.expectedState.sameRequestId = false;
  reason(requestId, 'group_d_expected_state_invalid');
  const fingerprint = fixture();
  fingerprint.input.expectedState.sameFoundationFingerprint = false;
  reason(fingerprint, 'group_d_expected_state_invalid');
  const write = fixture();
  write.input.expectedState.identityWrittenOnReplay = true;
  reason(write, 'group_d_expected_state_invalid');
});

test('security drift and unrelated production writes fail closed', () => {
  reason(fixture({}, { publicAuthorityInvoker: true }), 'group_d_security_boundary_invalid');
  reason(fixture({}, { projectWideRunInvoker: true }), 'group_d_security_boundary_invalid');
  reason(fixture({}, { gatewayForbiddenRolesPresent: true }), 'group_d_security_boundary_invalid');
  reason(fixture({}, { productionDebugTokensRegistered: true }), 'group_d_security_boundary_invalid');
  reason(fixture({}, { productionRtdbWriteCount: 1 }), 'group_d_pre_activation_write_detected');
  reason(fixture({}, { productionAuthMutationCount: 1 }), 'group_d_pre_activation_write_detected');
  reason(fixture({}, { productionPublicShareWriteCount: 1 }), 'group_d_pre_activation_write_detected');
});

test('tracked manifest drift fails before Group D can run', () => {
  const value = fixture();
  const manifest = JSON.parse(fs.readFileSync(value.manifestPath, 'utf8'));
  manifest.firstMutation.expectedFirstWriteDocuments = 3;
  fs.writeFileSync(value.manifestPath, JSON.stringify(manifest));
  reason(value, 'group_d_manifest_contract_invalid');
});

test('restoration covers every outcome and observation is a separate 24-hour checkpoint', () => {
  const value = fixture();
  const manifest = JSON.parse(fs.readFileSync(value.manifestPath, 'utf8'));
  assert.deepEqual(manifest.firstMutation.restorationRequiredAfterOutcomes,
    ['first-success', 'first-failure', 'replay-success', 'replay-failure']);
  assert.equal(manifest.firstMutation.observationHours, 24);
  assert.deepEqual(manifest.firstMutation.observationChecks, [
    'authority-gateway-5xx',
    'app-check-failures',
    'replay-duplicate-anomalies',
    'collision-conflict-metrics',
    'exact-firestore-state',
    'iam-drift',
    'rtdb-auth-public-share-isolation',
    'cost-anomalies'
  ]);
});

test('private harness is pinned, limited-use, exactly-once, and non-persistent', () => {
  const source = fs.readFileSync(PRIVATE_HARNESS_PATH, 'utf8');
  const result = validatePrivateHarnessSource(source);
  assert.equal(result.ok, true);
  assert.equal(result.firstInvocationCount, 1);
  assert.equal(result.replayInvocationCount, 1);
  assert.equal(result.limitedUseAppCheckTokens, true);
  assert.equal(result.persistentStorage, false);
  assert.equal(fs.statSync(PRIVATE_HARNESS_PATH).mode & 0o777, 0o600);
  assert.equal(source.includes('firstSucceeded = true'), true);
  assert.equal(source.includes("resultCode !== 'SUCCESS'"), true);
  assert.equal(source.includes("resultCode !== 'IDEMPOTENT'"), true);
});
