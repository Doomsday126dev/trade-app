'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { productionSimilarityRejected, validatePreflight } = require('./stagingResourcePreflight.cjs');

const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/staging-resource-inputs.json');
const EXPECTED = Object.freeze({
  environment: 'staging',
  projectId: 'trainer-hub-staging-37ib4wct',
  projectNumber: '391359988648',
  serviceRegion: 'us-central1',
  firestoreDatabaseId: 'phase-e-identity',
  rtdbDatabaseUrl: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
  serviceName: 'e1-identity-authority',
  runtimeServiceAccount: 'e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com'
});
const REQUIRED_FALSE_GATES = Object.freeze([
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const ACTIVATABLE_MUTATION_GATES = new Set(REQUIRED_FALSE_GATES.filter((gate) =>
  !['READ_PROVIDER_PUBLIC_SHARE_ENABLED', 'CREATE_PROVIDER_ACCOUNT_ENABLED', 'RESERVE_HANDLE_ENABLED'].includes(gate)));

function activeWindow(value, now) {
  const start = Date.parse(value?.startAt);
  const end = Date.parse(value?.expiresAt);
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}

function guardE1Target(input, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  if (input.environment !== EXPECTED.environment) errors.push('environment_not_staging');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(input.projectId || '')) errors.push('project_id_invalid');
  if (!String(input.projectId || '').includes('-staging-')) errors.push('staging_marker_missing');
  if (productionSimilarityRejected(input.projectId || '')) errors.push('production_project_rejected');
  if (input.projectId !== EXPECTED.projectId) errors.push('project_id_mismatch');
  if (!/^\d{6,20}$/.test(input.projectNumber || '')) errors.push('project_number_invalid');
  if (input.projectNumber !== input.expectedProjectNumber) errors.push('project_number_mismatch');
  if (input.projectNumber !== EXPECTED.projectNumber) errors.push('unexpected_project_number');
  if (input.serviceRegion !== EXPECTED.serviceRegion) errors.push('service_region_mismatch');
  if (input.firestoreDatabaseId !== EXPECTED.firestoreDatabaseId) errors.push('firestore_database_mismatch');
  if (input.rtdbDatabaseUrl !== EXPECTED.rtdbDatabaseUrl) errors.push('rtdb_database_mismatch');
  if (input.serviceName !== EXPECTED.serviceName) errors.push('authority_service_mismatch');
  if (input.runtimeServiceAccount !== EXPECTED.runtimeServiceAccount) errors.push('runtime_service_account_mismatch');
  const allowedMutationGate = options.allowedMutationGate || null;
  if (allowedMutationGate && !ACTIVATABLE_MUTATION_GATES.has(allowedMutationGate)) errors.push('operation_gate_activation_invalid');
  if (!input.operationGates || !['true', 'false'].includes(input.operationGates.READ_ACCOUNT_FOUNDATION_ENABLED) ||
      REQUIRED_FALSE_GATES.some((gate) => input.operationGates[gate] !== (gate === allowedMutationGate ? 'true' : 'false'))) {
    errors.push(allowedMutationGate ? 'operation_gate_activation_mismatch' : 'operation_gate_not_false');
  }
  const privateInputPath = options.privateInputPath || PRIVATE_INPUT_PATH;
  if (!fs.existsSync(privateInputPath)) errors.push('private_readiness_file_missing');
  else if (options.verifyPrivateProject !== false) {
    try {
      const privateInput = JSON.parse(fs.readFileSync(privateInputPath, 'utf8'));
      if (privateInput?.inputs?.STAGING_PROJECT_ID !== input.projectId) errors.push('private_project_mismatch');
      const validation = validatePreflight(privateInput, { now });
      if (validation.status !== 'inputs-valid-approval-required') errors.push('private_readiness_invalid');
      if (!activeWindow(privateInput?.inputs?.RESOURCE_CREATION_WINDOW, now)) errors.push('resource_creation_window_inactive');
      if (!activeWindow(privateInput?.inputs?.SMOKE_AND_ROLLBACK_WINDOW, now)) errors.push('smoke_window_inactive');
      if (privateInput?.inputs?.TEARDOWN_OWNER_ACKNOWLEDGED !== true) errors.push('teardown_owner_unacknowledged');
    } catch { errors.push('private_readiness_file_invalid'); }
  }
  if (errors.length) {
    const error = new Error('e1/staging-target-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    environment: 'staging',
    targetVerified: true,
    productionDenied: true,
    cloudOperations: 0
  });
}

module.exports = { ACTIVATABLE_MUTATION_GATES, EXPECTED, PRIVATE_INPUT_PATH, REQUIRED_FALSE_GATES, guardE1Target };
