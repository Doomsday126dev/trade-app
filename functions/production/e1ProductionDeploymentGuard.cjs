'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PERMISSIONS, verifyPermissionInventory } = require('./e1CustomRole.cjs');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-activation.json');
const REQUIRED_FALSE_GATES = Object.freeze([
  'CLIENT_FOUNDATION_USE_ENABLED',
  'GATEWAY_INVOCATION_ENABLED',
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;
const ALLOWED_OPERATIONS = Object.freeze([
  'enable-reviewed-runtime-apis',
  'assign-builder-control-plane-role',
  'assign-deployer-control-plane-role',
  'grant-deployer-authority-runtime-act-as',
  'create-authority-artifact-repository',
  'build-immutable-authority-image',
  'deploy-private-authority-service',
  'create-gateway-runtime-service-account',
  'deploy-disabled-two-export-gateway',
  'grant-service-level-authority-invoker',
  'configure-app-check-monitor-mode',
  'create-redacted-observability',
  'create-budget-guardrails',
  'remediate-unused-default-compute-editor'
]);

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function guardProductionTarget(input, options = {}) {
  const errors = [];
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  let manifest;
  let readiness;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('private_readiness_file_missing_or_invalid'); }
  const now = options.now ?? Date.now();
  const project = manifest?.project || {};
  if (manifest?.environment !== 'production' || input.environment !== 'production') errors.push('environment_not_production');
  if (project.id !== 'trade-list-a4297' || input.projectId !== project.id) errors.push('project_id_mismatch');
  if (project.numberReviewed !== true || !/^\d{6,20}$/.test(project.number || '')) errors.push('project_number_not_reviewed');
  if (input.projectNumber !== project.number || input.expectedProjectNumber !== project.number) errors.push('project_number_mismatch');
  if (input.region !== project.region || input.region !== 'us-central1') errors.push('region_mismatch');
  if (input.databaseId !== manifest?.firestore?.databaseId || input.databaseId !== 'phase-e-identity') errors.push('database_mismatch');
  if (input.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url) errors.push('rtdb_mismatch');
  if (input.serviceName !== manifest?.authority?.service || input.runtimeServiceAccount !== manifest?.authority?.runtimeServiceAccount) {
    errors.push('authority_target_mismatch');
  }
  if (JSON.stringify({ manifest, input }).includes('trainer-hub-staging-37ib4wct')) errors.push('staging_target_present');
  const start = Date.parse(readiness?.deploymentWindow?.startAt);
  const end = Date.parse(readiness?.deploymentWindow?.endAt);
  const approvedAt = Date.parse(readiness?.approvedAt);
  if (readiness?.environment !== 'production' || readiness?.projectId !== project.id || readiness?.projectNumber !== project.number ||
      readiness?.region !== project.region || readiness?.databaseId !== manifest?.firestore?.databaseId ||
      readiness?.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url || readiness?.approvalGroup !== 'B' || readiness?.approved !== true ||
      readiness?.approvalAcknowledged !== true || readiness?.operator !== readiness?.approvedBy ||
      typeof readiness?.operator !== 'string' || !readiness.operator || readiness?.teardownOwner !== readiness?.operator ||
      readiness?.teardownOwnerAcknowledged !== true || readiness?.laterGroupsAuthorized !== false ||
      readiness?.groupCAuthorized !== false || readiness?.groupDAuthorized !== false || readiness?.groupEAuthorized !== false ||
      !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(approvedAt) || start >= end ||
      end - start > MAX_WINDOW_MS || now < start || now > end || approvedAt > now ||
      !sameValues(readiness?.authorizedOperations, ALLOWED_OPERATIONS)) errors.push('private_readiness_mismatch');
  if (!['predeploy', 'postdeploy'].includes(input.deploymentPhase)) errors.push('deployment_phase_invalid');
  if (input.publicInvoker !== false || input.gatewayInvokerOnly !== true) errors.push('cloud_run_invoker_boundary_invalid');
  if (input.gatewayAppCheckMode !== 'monitor' || input.reserveConsumesLimitedUseAppCheck !== true ||
      input.productionDebugTokensRegistered !== false) errors.push('app_check_boundary_invalid');
  if (input.defaultComputeEditorPresent !== false) errors.push('default_compute_editor_present');
  if (input.credentialSource !== 'production-workload-identity' || input.staticCredentialFilePresent !== false) errors.push('credential_boundary_invalid');
  if (!input.gates || REQUIRED_FALSE_GATES.some((gate) => input.gates[gate] !== false)) errors.push('activation_gate_not_false');
  try {
    verifyPermissionInventory(input.customRolePermissions || []);
    verifyPermissionInventory(manifest?.authority?.customRolePermissions || []);
  } catch { errors.push('custom_role_permission_drift'); }
  const authorityBinding = input.authorityIamBindings || [];
  if (authorityBinding.length !== 1 || authorityBinding[0]?.role !== `projects/${project.id}/roles/${manifest?.authority?.customRoleId}` ||
      authorityBinding[0]?.databaseId !== 'phase-e-identity' ||
      authorityBinding[0]?.conditionExpression !== manifest?.authority?.conditionalIamExpression) errors.push('authority_iam_drift');
  const groupA = input.groupAInfrastructure || {};
  if (groupA.databaseExists !== true || groupA.location !== manifest?.firestore?.location ||
      groupA.type !== manifest?.firestore?.type || groupA.edition !== manifest?.firestore?.edition ||
      groupA.pitrEnabled !== true || groupA.deletionProtectionEnabled !== true || groupA.applicationDocumentCount !== 0 ||
      groupA.denyAllRulesActive !== true || groupA.defaultDatabaseExists !== false ||
      groupA.builderKeyless !== true || groupA.deployerKeyless !== true) errors.push('group_a_infrastructure_drift');
  const gatewayBinding = input.gatewayIamBindings || [];
  if (input.deploymentPhase === 'predeploy') {
    if (input.authorityServiceExists !== false || input.gatewayDeployed !== false || gatewayBinding.length !== 0) {
      errors.push('group_b_prestate_invalid');
    }
  } else if (input.authorityServiceExists !== true || input.gatewayDeployed !== true ||
      gatewayBinding.length !== 1 || gatewayBinding[0]?.role !== 'roles/run.invoker' ||
      gatewayBinding[0]?.service !== 'e1-identity-authority' || gatewayBinding[0]?.scope !== 'service') {
    errors.push('gateway_iam_drift');
  }
  if (errors.length) {
    const error = new Error('e1/production-target-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'B',
    environment: 'production',
    targetVerified: true,
    groupAInfrastructureVerified: true,
    deploymentPhase: input.deploymentPhase,
    allGatesDisabled: true,
    laterGroupsAuthorized: false,
    cloudOperations: 0
  });
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  MANIFEST_PATH,
  MAX_WINDOW_MS,
  PERMISSIONS,
  PRIVATE_READINESS_PATH,
  REQUIRED_FALSE_GATES,
  guardProductionTarget
});
