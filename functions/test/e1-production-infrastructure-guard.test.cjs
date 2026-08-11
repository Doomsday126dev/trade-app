'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PERMISSIONS } = require('../production/e1CustomRole.cjs');
const {
  ALLOWED_OPERATIONS,
  APPROVAL_GROUPS,
  DENIED_OPERATIONS,
  guardProductionInfrastructure
} = require('../production/e1ProductionInfrastructureGuard.cjs');
const { guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');

const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function fixture(readinessOverrides = {}, inputOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-infrastructure-guard-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const readinessPath = path.join(directory, 'readiness.json');
  const sourceManifest = path.resolve(__dirname, '../production/e1-production-resource-manifest.json');
  fs.copyFileSync(sourceManifest, manifestPath);
  const readiness = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    projectNumber: '1053781218847',
    rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com',
    firestoreDatabaseId: 'phase-e-identity',
    region: 'us-central1',
    approvalGroup: 'A',
    approved: true,
    approvedAt: '2030-01-01T11:55:00.000Z',
    humanOperator: 'reviewed-human-operator',
    teardownOwner: 'reviewed-teardown-owner',
    approvalAcknowledged: true,
    resourceCreationWindow: { startAt: '2030-01-01T11:30:00.000Z', endAt: '2030-01-01T13:30:00.000Z' },
    authorizedOperations: [...ALLOWED_OPERATIONS],
    laterGroupsAuthorized: false,
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
    firestoreApiEnabled: false,
    phaseEIdentityDatabaseExists: false,
    defaultFirestoreDatabaseExists: false,
    authorityRuntimeServiceAccountExists: false,
    customRoleExists: false,
    customRolePermissions: [],
    builderServiceAccountExists: false,
    deployerServiceAccountExists: false,
    cloudRunAuthorityServiceExists: false,
    publicCloudRunE1Service: false,
    gatewayExists: false,
    invokerBindingExists: false,
    appCheckProductionActivated: false,
    broadIamDrift: false,
    defaultComputeEditorPresent: false,
    ...inputOverrides
  };
  return { directory, input, manifestPath, readinessPath };
}

function run(value) {
  return guardProductionInfrastructure(value.input, { manifestPath: value.manifestPath, readinessPath: value.readinessPath, now: () => NOW });
}

function reason(value, expected) {
  assert.throws(() => run(value), (error) => error.reasons.includes(expected));
}

test('valid Group A pre-resource state passes with future resources absent and later groups denied', () => {
  const value = fixture();
  assert.deepEqual(run(value), {
    ok: true, approvalGroup: 'A', environment: 'production', targetVerified: true,
    preResourceStateVerified: true, laterGroupsAuthorized: false, cloudOperations: 0
  });
  assert.deepEqual(APPROVAL_GROUPS, {
    A: 'production-infrastructure', B: 'private-authority-and-gateway-deployment', C: 'read-only-production-proof',
    D: 'first-mutation-cohort', E: 'client-foundation-activation'
  });
  assert.ok(DENIED_OPERATIONS.every((operation) => !ALLOWED_OPERATIONS.includes(operation)));
});

test('missing readiness and an expired resource window fail closed', () => {
  const missing = fixture();
  fs.unlinkSync(missing.readinessPath);
  reason(missing, 'group_a_readiness_missing_or_invalid');
  reason(fixture({ resourceCreationWindow: { startAt: '2030-01-01T08:00:00.000Z', endAt: '2030-01-01T09:00:00.000Z' } }),
    'group_a_window_invalid');
  const permissions = fixture();
  fs.chmodSync(permissions.readinessPath, 0o644);
  reason(permissions, 'group_a_readiness_permissions_invalid');
});

test('wrong production target project number RTDB region and staging identifiers fail', () => {
  reason(fixture({}, { projectId: 'wrong-project' }), 'project_id_mismatch');
  reason(fixture({}, { projectNumber: '999999999999' }), 'project_number_mismatch');
  reason(fixture({}, { rtdbDatabaseUrl: 'https://wrong.firebaseio.com' }), 'rtdb_mismatch');
  reason(fixture({}, { region: 'us-east1' }), 'region_mismatch');
  reason(fixture({ humanOperator: 'trainer-hub-staging-37ib4wct' }), 'staging_target_present');
});

test('Group B readiness cannot satisfy Group A and Group A readiness cannot satisfy Group B', () => {
  reason(fixture({ approvalGroup: 'B' }), 'group_a_approval_invalid');
  const groupA = fixture();
  assert.throws(() => guardProductionTarget({}, { manifestPath: groupA.manifestPath, readinessPath: groupA.readinessPath }),
    (error) => error.reasons.includes('private_readiness_mismatch'));
});

test('unexpected authority resources default Compute Editor and broad IAM fail', () => {
  reason(fixture({}, { phaseEIdentityDatabaseExists: true }), 'phase_e_identity_already_exists');
  reason(fixture({}, { defaultFirestoreDatabaseExists: true }), 'default_firestore_database_exists');
  reason(fixture({}, { authorityRuntimeServiceAccountExists: true }), 'authority_runtime_identity_already_exists');
  reason(fixture({}, { customRoleExists: true, customRolePermissions: [...PERMISSIONS, 'datastore.entities.list'] }),
    'existing_custom_role_permission_drift');
  reason(fixture({}, { builderServiceAccountExists: true }), 'build_identity_already_exists');
  reason(fixture({}, { publicCloudRunE1Service: true }), 'cloud_run_authority_already_exists');
  reason(fixture({}, { defaultComputeEditorPresent: true }), 'default_compute_editor_present');
  reason(fixture({}, { broadIamDrift: true }), 'broad_iam_drift');
});

test('later-group operations requested under Group A fail', () => {
  reason(fixture({}, { requestedOperations: [...ALLOWED_OPERATIONS, 'deploy-cloud-run-authority'] }), 'group_a_operation_not_authorized');
  reason(fixture({ authorizedOperations: [...ALLOWED_OPERATIONS, 'apply-migration'] }), 'group_a_operations_invalid');
  reason(fixture({}, { unreviewedField: true }), 'group_a_input_schema_invalid');
});
