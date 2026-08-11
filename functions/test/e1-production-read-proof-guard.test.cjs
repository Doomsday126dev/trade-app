'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ALLOWED_OPERATIONS, AUTHORITY_GATES, guardProductionReadProof } =
  require('../production/e1ProductionReadProofGuard.cjs');
const { guardProductionInfrastructure } = require('../production/e1ProductionInfrastructureGuard.cjs');
const { guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');

const NOW = Date.parse('2030-01-01T12:00:00.000Z');
const SUBJECT = Object.freeze({ firebaseUid: 'reviewed-owner-uid', trainerUsername: 'ReviewedOwner' });

function fixture(readinessOverrides = {}, inputOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-read-proof-guard-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const readinessPath = path.join(directory, 'readiness.json');
  fs.copyFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), manifestPath);
  const readiness = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    firestoreDatabaseId: 'phase-e-identity',
    region: 'us-central1',
    approvalGroup: 'C',
    approved: true,
    approvedAt: '2030-01-01T11:55:00.000Z',
    humanOperator: 'reviewed-human-operator',
    approvalAcknowledged: true,
    proofWindow: { startAt: '2030-01-01T11:30:00.000Z', endAt: '2030-01-01T13:30:00.000Z' },
    reviewedSubject: { ...SUBJECT },
    authorizedOperations: [...ALLOWED_OPERATIONS],
    leaveReadPathEnabledAfterProof: false,
    laterGroupsAuthorized: false,
    ...readinessOverrides
  };
  fs.writeFileSync(readinessPath, JSON.stringify(readiness), { mode: 0o600 });
  const authorityGates = Object.fromEntries(AUTHORITY_GATES.map((gate) => [gate, false]));
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
    reciprocalLegacyOwnershipVerified: true,
    groupAInfrastructureHealthy: true,
    authorityHealthy: true,
    gatewayDeployed: true,
    gatewayRuntimeSoleAuthorityInvoker: true,
    publicAuthorityInvoker: false,
    authorityGates,
    gatewayInvocationEnabled: false,
    clientFoundationUseEnabled: false,
    appCheckMode: 'monitor',
    productionDebugTokensRegistered: false,
    phaseEIdentityDocumentCount: 0,
    denyAllRulesActive: true,
    defaultFirestoreDatabaseExists: false,
    defaultComputeEditorPresent: false,
    defaultAppEngineEditorPresent: false,
    broadIamDrift: false,
    productionRtdbWriteCount: 0,
    productionAuthMutationCount: 0,
    productionPublicShareWriteCount: 0,
    readPathRateLimitPersistence: 'none',
    ...inputOverrides
  };
  return { input, manifestPath, readinessPath };
}

function run(value) {
  return guardProductionReadProof(value.input, {
    manifestPath: value.manifestPath,
    readinessPath: value.readinessPath,
    now: () => NOW
  });
}

function reason(value, expected) {
  assert.throws(() => run(value), (error) => error.reasons.includes(expected));
}

test('valid Group C pre-proof state is subject-bound mutation-free and restores read gates afterward', () => {
  assert.deepEqual(run(fixture()), {
    ok: true,
    approvalGroup: 'C',
    environment: 'production',
    targetVerified: true,
    reviewedSubjectVerified: true,
    preProofStateVerified: true,
    readPathMutationFree: true,
    leaveReadPathEnabledAfterProof: false,
    laterGroupsAuthorized: false,
    cloudOperations: 0
  });
});

test('Group A and Group B readiness cannot satisfy Group C and Group C cannot satisfy A or B', () => {
  reason(fixture({ approvalGroup: 'A' }), 'group_c_approval_invalid');
  reason(fixture({ approvalGroup: 'B' }), 'group_c_approval_invalid');
  const groupC = fixture();
  assert.throws(() => guardProductionInfrastructure({}, {
    manifestPath: groupC.manifestPath,
    readinessPath: groupC.readinessPath,
    now: () => NOW
  }), (error) => error.reasons.includes('group_a_approval_invalid'));
  assert.throws(() => guardProductionTarget({}, {
    manifestPath: groupC.manifestPath,
    readinessPath: groupC.readinessPath,
    now: NOW
  }), (error) => error.reasons.includes('private_readiness_mismatch'));
});

test('Group C rejects missing expired or permissive readiness', () => {
  const missing = fixture();
  fs.unlinkSync(missing.readinessPath);
  reason(missing, 'group_c_readiness_missing_or_invalid');
  reason(fixture({ proofWindow: { startAt: '2030-01-01T08:00:00.000Z', endAt: '2030-01-01T09:00:00.000Z' } }),
    'group_c_window_invalid');
  reason(fixture({ laterGroupsAuthorized: true }), 'group_c_approval_invalid');
  reason(fixture({ leaveReadPathEnabledAfterProof: true }), 'group_c_approval_invalid');
});

test('Group C binds the exact reviewed production subject without enumeration', () => {
  reason(fixture({}, { reviewedSubject: { firebaseUid: 'another-owner-uid', trainerUsername: SUBJECT.trainerUsername } }),
    'group_c_subject_mismatch');
  reason(fixture({ reviewedSubject: { firebaseUid: SUBJECT.firebaseUid, trainerUsername: 'OtherTrainer' } }),
    'group_c_subject_mismatch');
  reason(fixture({}, { reviewedSubject: { firebaseUid: SUBJECT.firebaseUid, trainerUsername: 'bad/name' } }),
    'group_c_subject_mismatch');
  reason(fixture({}, { reciprocalLegacyOwnershipVerified: false }), 'group_c_reciprocal_ownership_unverified');
});

test('Group C rejects gate IAM App Check and authority-store drift', () => {
  reason(fixture({}, { authorityGates: { ...Object.fromEntries(AUTHORITY_GATES.map((gate) => [gate, false])), READ_ACCOUNT_FOUNDATION_ENABLED: true } }),
    'group_c_preproof_gate_state_invalid');
  reason(fixture({}, { gatewayInvocationEnabled: true }), 'group_c_preproof_gate_state_invalid');
  reason(fixture({}, { publicAuthorityInvoker: true }), 'group_c_production_boundary_invalid');
  reason(fixture({}, { gatewayRuntimeSoleAuthorityInvoker: false }), 'group_c_production_boundary_invalid');
  reason(fixture({}, { appCheckMode: 'enforce' }), 'group_c_app_check_boundary_invalid');
  reason(fixture({}, { phaseEIdentityDocumentCount: 1 }), 'group_c_authority_store_not_empty');
});

test('Group C fails closed when a read would persist durable rate-limit state', () => {
  reason(fixture({}, { readPathRateLimitPersistence: 'firestore-rolling-v1' }), 'group_c_read_path_would_mutate');
  reason(fixture({}, { readPathRateLimitPersistence: 'unknown' }), 'group_c_read_path_would_mutate');
});

test('Group C rejects any pre-proof production application write', () => {
  reason(fixture({}, { productionRtdbWriteCount: 1 }), 'group_c_preproof_write_detected');
  reason(fixture({}, { productionAuthMutationCount: 1 }), 'group_c_preproof_write_detected');
  reason(fixture({}, { productionPublicShareWriteCount: 1 }), 'group_c_preproof_write_detected');
});

test('Group C rejects mutation and later-group operations', () => {
  reason(fixture({}, { requestedOperations: [...ALLOWED_OPERATIONS, 'reserve-trainer-handle'] }), 'group_c_operation_not_authorized');
  reason(fixture({ authorizedOperations: [...ALLOWED_OPERATIONS, 'apply-migration'] }), 'group_c_operations_invalid');
});
