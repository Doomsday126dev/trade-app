'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXPECTED, REQUIRED_FALSE_GATES, guardE1Target } = require('../staging/e1DeploymentGuard.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-guard-'));
  const privateInputPath = path.join(directory, 'staging-resource-inputs.json');
  const startAt = '2030-01-01T12:00:00Z';
  const expiresAt = '2030-01-01T14:00:00Z';
  const approvals = Object.fromEntries([
    'resourceCreation', 'additiveRulesDeployment', 'functionsDeployment', 'appCheckRegistration',
    'syntheticFixtureCreation', 'shareVisibilityWriteGate', 'trainerPreferencesWriteGate',
    'syntheticCanary', 'appCheckEnforcement', 'stagingClientWiring', 'productionAction'
  ].map((key) => [key, { approvalStatus: 'undecided', approvedBy: '', approvedAt: '' }]));
  fs.writeFileSync(privateInputPath, JSON.stringify({
    inputs: {
      APP_SLUG: 'trainer-hub', RANDOM_SUFFIX: '37ib4wct', STAGING_PROJECT_ID: EXPECTED.projectId,
      BILLING_ACCOUNT: 'billingAccounts/AAAAAA-BBBBBB-CCCCCC', BILLING_OPERATOR: 'operator@example.test',
      STAGING_WEB_APP_NAME: 'Trainer Hub Staging', RUNTIME_SERVICE_ACCOUNT: 'trainer-hub-runtime-stg',
      DEPLOYMENT_SERVICE_ACCOUNT: 'trainer-hub-deployer-stg', RULES_OPERATOR_IDENTITY: 'operator@example.test',
      HUMAN_OPERATOR: 'operator@example.test', BILLING_ALERT_RECIPIENT: 'operator@example.test',
      BILLING_ESCALATION_TARGET: 'operator@example.test',
      RESOURCE_LABELS: { environment: 'staging', data_classification: 'synthetic', managed_by: 'manual-reviewed', lifecycle: 'temporary', application: 'trainer-hub' },
      RESOURCE_CREATION_WINDOW: { startAt, expiresAt }, SMOKE_AND_ROLLBACK_WINDOW: { startAt, expiresAt },
      TEARDOWN_OWNER: 'operator@example.test', TEARDOWN_OWNER_ACKNOWLEDGED: true
    },
    approvals
  }), { mode: 0o600 });
  return privateInputPath;
}

const valid = Object.freeze({
  environment: EXPECTED.environment,
  projectId: EXPECTED.projectId,
  projectNumber: EXPECTED.projectNumber,
  expectedProjectNumber: EXPECTED.projectNumber,
  serviceRegion: EXPECTED.serviceRegion,
  firestoreDatabaseId: EXPECTED.firestoreDatabaseId,
  rtdbDatabaseUrl: EXPECTED.rtdbDatabaseUrl,
  serviceName: EXPECTED.serviceName,
  runtimeServiceAccount: EXPECTED.runtimeServiceAccount,
  operationGates: {
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    ...Object.fromEntries(REQUIRED_FALSE_GATES.map((gate) => [gate, 'false']))
  }
});

test('staging target guard verifies every explicit target without cloud access', () => {
  assert.deepEqual(guardE1Target(valid, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), {
    ok: true, environment: 'staging', targetVerified: true, productionDenied: true, cloudOperations: 0
  });
});

test('staging target guard rejects production ambiguity mismatches and absent readiness state', () => {
  const missing = path.join(os.tmpdir(), 'e1-does-not-exist', 'inputs.json');
  assert.throws(() => guardE1Target({ ...valid, environment: 'production', projectId: 'trade-list-a4297' }, { privateInputPath: missing }), (error) => {
    assert.ok(error.reasons.includes('environment_not_staging'));
    assert.ok(error.reasons.includes('production_project_rejected'));
    assert.ok(error.reasons.includes('private_readiness_file_missing'));
    return true;
  });
  assert.throws(() => guardE1Target({ ...valid, projectNumber: '999999999999' }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('project_number_mismatch'));
  assert.throws(() => guardE1Target({ ...valid, firestoreDatabaseId: '(default)' }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('firestore_database_mismatch'));
  assert.throws(() => guardE1Target({ ...valid, rtdbDatabaseUrl: 'https://trade-list-a4297.firebaseio.com' }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('rtdb_database_mismatch'));
  assert.throws(() => guardE1Target({ ...valid, operationGates: { ...valid.operationGates, RESERVE_HANDLE_ENABLED: 'true' } }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('operation_gate_not_false'));
  assert.throws(() => guardE1Target({ ...valid, operationGates: { ...valid.operationGates, READ_ACCOUNT_FOUNDATION_ENABLED: 'invalid' } }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('operation_gate_not_false'));
  assert.throws(() => guardE1Target({ ...valid, operationGates: { ...valid.operationGates, READ_PROVIDER_PUBLIC_SHARE_ENABLED: 'true' } }, { privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z') }), (error) => error.reasons.includes('operation_gate_not_false'));
});

test('staging activation guard permits exactly one reviewed legacy mutation gate and rejects unapproved identity activation', () => {
  const repair = {
    ...valid,
    operationGates: { ...valid.operationGates, REPAIR_FOUNDATION_ENABLED: 'true' }
  };
  assert.equal(guardE1Target(repair, {
    privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z'), allowedMutationGate: 'REPAIR_FOUNDATION_ENABLED'
  }).ok, true);
  assert.throws(() => guardE1Target({
    ...repair,
    operationGates: { ...repair.operationGates, APPLY_MIGRATION_ENABLED: 'true' }
  }, {
    privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z'), allowedMutationGate: 'REPAIR_FOUNDATION_ENABLED'
  }), (error) => error.reasons.includes('operation_gate_activation_mismatch'));
  assert.throws(() => guardE1Target({
    ...valid,
    operationGates: { ...valid.operationGates, RESERVE_HANDLE_ENABLED: 'true' }
  }, {
    privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z'), allowedMutationGate: 'RESERVE_HANDLE_ENABLED'
  }), (error) => error.reasons.includes('operation_gate_activation_invalid'));
  assert.throws(() => guardE1Target({
    ...valid,
    operationGates: { ...valid.operationGates, CREATE_PROVIDER_ACCOUNT_ENABLED: 'true' }
  }, {
    privateInputPath: fixture(), now: Date.parse('2030-01-01T13:00:00Z'), allowedMutationGate: 'CREATE_PROVIDER_ACCOUNT_ENABLED'
  }), (error) => error.reasons.includes('operation_gate_activation_invalid'));
});
