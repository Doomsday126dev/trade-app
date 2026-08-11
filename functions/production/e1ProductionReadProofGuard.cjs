'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-read-proof-activation.json');
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;
const AUTHORITY_GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const ALLOWED_OPERATIONS = Object.freeze([
  'read-production-control-plane-inventory',
  'read-reviewed-subject-reciprocal-legacy-paths',
  'enable-authority-read-gate',
  'enable-gateway-invocation-gate',
  'invoke-read-account-foundation',
  'exercise-reviewed-negative-read-paths',
  'restore-read-gates-disabled',
  'read-post-proof-integrity-inventory'
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
  'approvalAcknowledged',
  'proofWindow',
  'reviewedSubject',
  'authorizedOperations',
  'leaveReadPathEnabledAfterProof',
  'laterGroupsAuthorized'
]);
const SUBJECT_FIELDS = Object.freeze(['firebaseUid', 'trainerUsername']);
const INPUT_FIELDS = Object.freeze([
  'environment',
  'projectId',
  'projectNumber',
  'expectedProjectNumber',
  'region',
  'databaseId',
  'rtdbDatabaseUrl',
  'requestedOperations',
  'reviewedSubject',
  'reciprocalLegacyOwnershipVerified',
  'groupAInfrastructureHealthy',
  'authorityHealthy',
  'gatewayDeployed',
  'gatewayRuntimeSoleAuthorityInvoker',
  'publicAuthorityInvoker',
  'authorityGates',
  'gatewayInvocationEnabled',
  'clientFoundationUseEnabled',
  'appCheckMode',
  'productionDebugTokensRegistered',
  'phaseEIdentityDocumentCount',
  'denyAllRulesActive',
  'defaultFirestoreDatabaseExists',
  'defaultComputeEditorPresent',
  'defaultAppEngineEditorPresent',
  'broadIamDrift',
  'productionRtdbWriteCount',
  'productionAuthMutationCount',
  'productionPublicShareWriteCount',
  'readPathRateLimitPersistence'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && sameValues(Object.keys(value), fields);
}

function validIdentity(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && !/[\r\n]/u.test(value);
}

function validSubject(subject) {
  return exactFields(subject, SUBJECT_FIELDS) && validIdentity(subject.firebaseUid) &&
    validIdentity(subject.trainerUsername) && !/[\/.#$\[\]]/u.test(subject.firebaseUid) &&
    !/[\/.#$\[\]]/u.test(subject.trainerUsername);
}

function sameSubject(actual, expected) {
  return validSubject(actual) && validSubject(expected) &&
    actual.firebaseUid === expected.firebaseUid && actual.trainerUsername === expected.trainerUsername;
}

function guardProductionReadProof(input, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  let manifest;
  let readiness;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('group_c_readiness_missing_or_invalid'); }
  const project = manifest?.project || {};

  if (!exactFields(input, INPUT_FIELDS)) errors.push('group_c_input_schema_invalid');
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
  if (JSON.stringify({ manifest, input, readiness }).includes('trainer-hub-staging-37ib4wct')) errors.push('staging_target_present');

  if (readiness) {
    if (!exactFields(readiness, READINESS_FIELDS)) errors.push('group_c_readiness_schema_invalid');
    if (readiness.schemaVersion !== 1 || readiness.environment !== 'production' || readiness.projectId !== project.id ||
        readiness.projectNumber !== project.number || readiness.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url ||
        readiness.firestoreDatabaseId !== manifest?.firestore?.databaseId || readiness.region !== project.region) {
      errors.push('group_c_readiness_target_mismatch');
    }
    if (readiness.approvalGroup !== 'C' || readiness.approved !== true || readiness.approvalAcknowledged !== true ||
        readiness.leaveReadPathEnabledAfterProof !== false || readiness.laterGroupsAuthorized !== false) {
      errors.push('group_c_approval_invalid');
    }
    if (!validIdentity(readiness.humanOperator) || !validSubject(readiness.reviewedSubject)) errors.push('group_c_identity_invalid');
    const start = Date.parse(readiness.proofWindow?.startAt);
    const end = Date.parse(readiness.proofWindow?.endAt);
    const approvedAt = Date.parse(readiness.approvedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(approvedAt) || start >= end ||
        end - start > MAX_WINDOW_MS || now < start || now > end || approvedAt > now) errors.push('group_c_window_invalid');
    if (!sameValues(readiness.authorizedOperations, ALLOWED_OPERATIONS)) errors.push('group_c_operations_invalid');
    try {
      if ((fs.statSync(readinessPath).mode & 0o777) !== 0o600) errors.push('group_c_readiness_permissions_invalid');
    } catch { errors.push('group_c_readiness_permissions_invalid'); }
  }

  if (!sameValues(input?.requestedOperations, ALLOWED_OPERATIONS)) errors.push('group_c_operation_not_authorized');
  if (!sameSubject(input?.reviewedSubject, readiness?.reviewedSubject)) errors.push('group_c_subject_mismatch');
  if (input?.reciprocalLegacyOwnershipVerified !== true) errors.push('group_c_reciprocal_ownership_unverified');
  if (input?.groupAInfrastructureHealthy !== true || input?.authorityHealthy !== true || input?.gatewayDeployed !== true ||
      input?.gatewayRuntimeSoleAuthorityInvoker !== true || input?.publicAuthorityInvoker !== false ||
      input?.denyAllRulesActive !== true || input?.defaultFirestoreDatabaseExists !== false ||
      input?.defaultComputeEditorPresent !== false || input?.defaultAppEngineEditorPresent !== false ||
      input?.broadIamDrift !== false) errors.push('group_c_production_boundary_invalid');
  if (!exactFields(input?.authorityGates, AUTHORITY_GATES) ||
      AUTHORITY_GATES.some((gate) => input.authorityGates[gate] !== false) ||
      input?.gatewayInvocationEnabled !== false || input?.clientFoundationUseEnabled !== false) {
    errors.push('group_c_preproof_gate_state_invalid');
  }
  if (input?.appCheckMode !== 'monitor' || input?.productionDebugTokensRegistered !== false) {
    errors.push('group_c_app_check_boundary_invalid');
  }
  if (input?.phaseEIdentityDocumentCount !== 0) errors.push('group_c_authority_store_not_empty');
  if (input?.productionRtdbWriteCount !== 0 || input?.productionAuthMutationCount !== 0 ||
      input?.productionPublicShareWriteCount !== 0) errors.push('group_c_preproof_write_detected');
  if (input?.readPathRateLimitPersistence !== 'none') errors.push('group_c_read_path_would_mutate');

  if (errors.length) {
    const error = new Error('e1/production-read-proof-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
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
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  AUTHORITY_GATES,
  INPUT_FIELDS,
  MANIFEST_PATH,
  MAX_WINDOW_MS,
  PRIVATE_READINESS_PATH,
  READINESS_FIELDS,
  SUBJECT_FIELDS,
  guardProductionReadProof
});
