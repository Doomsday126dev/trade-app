'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PERMISSIONS, verifyPermissionInventory } = require('./e1CustomRole.cjs');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-infrastructure-activation.json');
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;

const APPROVAL_GROUPS = Object.freeze({
  A: 'production-infrastructure',
  B: 'private-authority-and-gateway-deployment',
  C: 'read-only-production-proof',
  D: 'first-mutation-cohort',
  E: 'client-foundation-activation'
});

const ALLOWED_OPERATIONS = Object.freeze([
  'enable-firestore-api',
  'enumerate-firestore-databases',
  'create-phase-e-identity-database',
  'enable-pitr-and-deletion-protection',
  'deploy-deny-all-firestore-rules',
  'create-authority-runtime-service-account',
  'create-e1-custom-firestore-role',
  'bind-e1-custom-role-conditionally',
  'create-zero-role-builder-service-account',
  'create-zero-role-deployer-service-account',
  'remediate-unused-default-compute-editor'
]);

const DENIED_OPERATIONS = Object.freeze([
  'deploy-cloud-run-authority',
  'deploy-gateway',
  'grant-cloud-run-invoker',
  'enforce-app-check',
  'apply-migration',
  'write-account-foundation',
  'activate-auth-provider',
  'activate-client-foundation'
]);

const READINESS_FIELDS = Object.freeze([
  'schemaVersion',
  'environment',
  'projectId',
  'projectNumber',
  'rtdbDatabaseUrl',
  'firestoreDatabaseId',
  'region',
  'approvalGroup',
  'approved',
  'approvedAt',
  'humanOperator',
  'teardownOwner',
  'approvalAcknowledged',
  'resourceCreationWindow',
  'authorizedOperations',
  'laterGroupsAuthorized'
]);

const INPUT_FIELDS = Object.freeze([
  'environment',
  'projectId',
  'projectNumber',
  'expectedProjectNumber',
  'region',
  'databaseId',
  'rtdbDatabaseUrl',
  'requestedOperations',
  'firestoreApiEnabled',
  'phaseEIdentityDatabaseExists',
  'defaultFirestoreDatabaseExists',
  'authorityRuntimeServiceAccountExists',
  'customRoleExists',
  'customRolePermissions',
  'builderServiceAccountExists',
  'deployerServiceAccountExists',
  'cloudRunAuthorityServiceExists',
  'publicCloudRunE1Service',
  'gatewayExists',
  'invokerBindingExists',
  'appCheckProductionActivated',
  'broadIamDrift',
  'defaultComputeEditorPresent'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function validIdentity(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && !/[\r\n]/u.test(value);
}

function guardProductionInfrastructure(input, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  let manifest;
  let readiness;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('group_a_readiness_missing_or_invalid'); }
  const project = manifest?.project || {};

  if (!input || !sameValues(Object.keys(input).sort(), INPUT_FIELDS)) errors.push('group_a_input_schema_invalid');
  const booleanFields = INPUT_FIELDS.filter((field) => field.endsWith('Enabled') || field.endsWith('Exists') ||
    field === 'publicCloudRunE1Service' || field === 'invokerBindingExists' || field === 'appCheckProductionActivated' ||
    field === 'broadIamDrift' || field === 'defaultComputeEditorPresent');
  if (booleanFields.some((field) => typeof input?.[field] !== 'boolean')) errors.push('group_a_input_schema_invalid');

  if (manifest?.environment !== 'production' || input?.environment !== 'production') errors.push('environment_not_production');
  if (project.id !== 'trade-list-a4297' || input?.projectId !== project.id) errors.push('project_id_mismatch');
  if (project.number !== '1053781218847' || project.numberReviewed !== true ||
      input?.projectNumber !== project.number || input?.expectedProjectNumber !== project.number) errors.push('project_number_mismatch');
  if (project.region !== 'us-central1' || input?.region !== project.region) errors.push('region_mismatch');
  if (manifest?.firestore?.databaseId !== 'phase-e-identity' || input?.databaseId !== manifest?.firestore?.databaseId) {
    errors.push('firestore_database_mismatch');
  }
  if (manifest?.legacyRtdb?.url !== 'https://trade-list-a4297-default-rtdb.firebaseio.com' ||
      input?.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url) errors.push('rtdb_mismatch');
  if (JSON.stringify({ manifest, input, readiness }).includes('trainer-hub-staging-37ib4wct')) errors.push('staging_target_present');

  if (readiness) {
    const fields = Object.keys(readiness).sort();
    if (!sameValues(fields, READINESS_FIELDS)) errors.push('group_a_readiness_schema_invalid');
    if (readiness.schemaVersion !== 1 || readiness.environment !== 'production' || readiness.projectId !== project.id ||
        readiness.projectNumber !== project.number || readiness.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url ||
        readiness.firestoreDatabaseId !== manifest?.firestore?.databaseId || readiness.region !== project.region) {
      errors.push('group_a_readiness_target_mismatch');
    }
    if (readiness.approvalGroup !== 'A' || readiness.approved !== true || readiness.approvalAcknowledged !== true ||
        readiness.laterGroupsAuthorized !== false) errors.push('group_a_approval_invalid');
    if (!validIdentity(readiness.humanOperator) || !validIdentity(readiness.teardownOwner)) errors.push('group_a_operator_invalid');
    const start = Date.parse(readiness.resourceCreationWindow?.startAt);
    const end = Date.parse(readiness.resourceCreationWindow?.endAt);
    const approvedAt = Date.parse(readiness.approvedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(approvedAt) || start >= end ||
        end - start > MAX_WINDOW_MS || now < start || now > end || approvedAt > now) errors.push('group_a_window_invalid');
    if (!sameValues(readiness.authorizedOperations, ALLOWED_OPERATIONS)) errors.push('group_a_operations_invalid');
    try {
      if ((fs.statSync(readinessPath).mode & 0o777) !== 0o600) errors.push('group_a_readiness_permissions_invalid');
    } catch { errors.push('group_a_readiness_permissions_invalid'); }
  }

  if (!sameValues(input?.requestedOperations, ALLOWED_OPERATIONS) ||
      input?.requestedOperations?.some((operation) => DENIED_OPERATIONS.includes(operation))) errors.push('group_a_operation_not_authorized');
  try { verifyPermissionInventory(manifest?.authority?.customRolePermissions || []); }
  catch { errors.push('custom_role_permission_drift'); }

  if (input?.phaseEIdentityDatabaseExists === true) errors.push('phase_e_identity_already_exists');
  if (input?.defaultFirestoreDatabaseExists === true) errors.push('default_firestore_database_exists');
  if (input?.authorityRuntimeServiceAccountExists === true) errors.push('authority_runtime_identity_already_exists');
  if (input?.customRoleExists === true) errors.push('e1_custom_role_already_exists');
  if (input?.customRoleExists === true && !sameValues(input.customRolePermissions, PERMISSIONS)) errors.push('existing_custom_role_permission_drift');
  if (input?.builderServiceAccountExists === true || input?.deployerServiceAccountExists === true) errors.push('build_identity_already_exists');
  if (input?.cloudRunAuthorityServiceExists === true || input?.publicCloudRunE1Service === true) errors.push('cloud_run_authority_already_exists');
  if (input?.gatewayExists === true || input?.invokerBindingExists === true) errors.push('gateway_boundary_already_exists');
  if (input?.appCheckProductionActivated === true) errors.push('app_check_already_activated');
  if (input?.broadIamDrift === true) errors.push('broad_iam_drift');
  if (input?.defaultComputeEditorPresent === true) errors.push('default_compute_editor_present');

  if (errors.length) {
    const error = new Error('e1/production-infrastructure-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'A',
    environment: 'production',
    targetVerified: true,
    preResourceStateVerified: true,
    laterGroupsAuthorized: false,
    cloudOperations: 0
  });
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  APPROVAL_GROUPS,
  DENIED_OPERATIONS,
  MANIFEST_PATH,
  MAX_WINDOW_MS,
  PRIVATE_READINESS_PATH,
  READINESS_FIELDS,
  INPUT_FIELDS,
  guardProductionInfrastructure
});
