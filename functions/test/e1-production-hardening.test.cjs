'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRODUCTION, STAGING, validateRtdbTarget, validateTarget } = require('../e1-authority-service/e1TargetContracts');
const { EXCLUDED_PERMISSIONS, OPERATION_PERMISSIONS, PERMISSIONS, verifyPermissionInventory } = require('../production/e1CustomRole.cjs');
const { DISABLED_GATES, rollbackState } = require('../production/e1RollbackPlan.cjs');
const { ALLOWED_OPERATIONS, guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');
const {
  DATABASE_ID: GROUP_E_CONTROL_DATABASE_ID,
  DATABASE_RESOURCE: GROUP_E_CONTROL_DATABASE_RESOURCE,
  FORBIDDEN_PERMISSIONS: GROUP_E_CONTROL_FORBIDDEN_PERMISSIONS,
  IAM_CONDITION: GROUP_E_CONTROL_IAM_CONDITION,
  PERMISSIONS: GROUP_E_CONTROL_PERMISSIONS,
  loadControlPlanePlan,
  publicProvisioningPlan,
  requireDeployedControlPlane
} = require('../production/e1GroupEControlPlane.cjs');

test('authority targets are explicit for staging production and emulator with no cross-environment fallback', () => {
  assert.equal(validateTarget(STAGING).projectNumber, '391359988648');
  const production = { ...PRODUCTION, projectNumber: '123456789012' };
  assert.deepEqual(validateTarget(production), production);
  assert.equal(validateRtdbTarget({ environment: 'production', projectId: PRODUCTION.projectId, databaseUrl: PRODUCTION.rtdbDatabaseUrl }).origin,
    PRODUCTION.rtdbDatabaseUrl);
  assert.throws(() => validateTarget({ ...production, rtdbDatabaseUrl: STAGING.rtdbDatabaseUrl }), /E1_CONFIGURATION_MISMATCH/);
  assert.throws(() => validateTarget({ ...STAGING, environment: 'production' }), /E1_CONFIGURATION_MISMATCH/);
  assert.throws(() => validateRtdbTarget({ environment: 'production', projectId: PRODUCTION.projectId, databaseUrl: STAGING.rtdbDatabaseUrl }));
  assert.equal(validateTarget({
    environment: 'emulator', projectId: 'demo-e1-authority', projectNumber: '0', databaseId: 'phase-e-identity',
    region: 'local', serviceName: 'e1-identity-authority-emulator', runtimeServiceAccount: 'e1@localhost',
    rtdbDatabaseUrl: 'http://127.0.0.1:9000/'
  }).environment, 'emulator');
});

test('production custom role contains only the permissions proven necessary by operation', () => {
  assert.equal(verifyPermissionInventory().valid, true);
  assert.equal(PERMISSIONS.includes('datastore.entities.update'), true);
  assert.ok(EXCLUDED_PERMISSIONS.every((permission) => !PERMISSIONS.includes(permission)));
  for (const permissions of Object.values(OPERATION_PERMISSIONS)) assert.ok(permissions.every((permission) => PERMISSIONS.includes(permission)));
  assert.throws(() => verifyPermissionInventory([...PERMISSIONS, 'datastore.entities.list']), /permission-drift/);
  assert.throws(() => verifyPermissionInventory(PERMISSIONS.filter((permission) => permission !== 'datastore.entities.update')), /permission-drift/);
});

test('reserve replay protection grants the gateway only App Check token verification', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), 'utf8'));
  const gatewaySource = fs.readFileSync(path.resolve(__dirname, '../e1-gateway/index.js'), 'utf8');

  assert.match(gatewaySource, /exports\.readE1AccountFoundation = callable\('readAccountFoundation', configuration\.groupE\.enabled\)/);
  assert.match(gatewaySource, /exports\.reserveE1TrainerHandle = callable\('reserveTrainerHandle', true\)/);
  assert.equal(manifest.clientFoundationCanary.appCheckTokenMode,'limited-use-token-only-while-group-e-mode-enabled');
  assert.equal(manifest.clientFoundationCanary.normalReadAppCheckTokenMode,'standard-token');
  assert.deepEqual(manifest.clientFoundationCanary.clientController,{
    persistentBrowserFlag:false,deploymentArmsController:false,oneAuthorizedSlotPerGeneration:true,
    reconciliationRequiredBeforeNextSlot:true
  });
  assert.deepEqual(manifest.appCheck.tokenVerifier, {
    principal: manifest.gateway.serviceAccount,
    role: 'roles/firebaseappcheck.tokenVerifier',
    permissions: ['firebaseappcheck.appCheckTokens.verify'],
    scope: 'project'
  });
  assert.deepEqual(manifest.gateway.firestoreRoles, []);
  assert.deepEqual(manifest.gateway.rtdbRoles, []);
  assert.deepEqual(manifest.gateway.authRoles, []);
  assert.deepEqual(manifest.gateway.impersonationRoles, []);
  assert.notEqual(manifest.appCheck.tokenVerifier.role, 'roles/firebaseappcheck.admin');
});

function guardedFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-guard-'));
  const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), 'utf8'));
  base.status = 'project-number-reviewed';
  base.project.number = '123456789012';
  base.project.numberReviewed = true;
  const manifestPath = path.join(directory, 'manifest.json');
  const readinessPath = path.join(directory, 'readiness.json');
  fs.writeFileSync(manifestPath, JSON.stringify(base));
  fs.writeFileSync(readinessPath, JSON.stringify({
    environment: 'production', projectId: base.project.id, projectNumber: base.project.number,
    region: base.project.region, databaseId: base.firestore.databaseId, rtdbDatabaseUrl: base.legacyRtdb.url,
    approvalGroup: 'B', approved: true, approvalAcknowledged: true, approvedBy: 'reviewed-operator',
    operator: 'reviewed-operator', teardownOwner: 'reviewed-operator', teardownOwnerAcknowledged: true,
    approvedAt: '2030-01-01T00:00:00.000Z',
    deploymentWindow: { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-01T04:00:00.000Z' },
    authorizedOperations: [...ALLOWED_OPERATIONS], laterGroupsAuthorized: false,
    groupCAuthorized: false, groupDAuthorized: false, groupEAuthorized: false
  }));
  const input = {
    deploymentPhase: 'postdeploy',
    environment: 'production', projectId: base.project.id, projectNumber: base.project.number,
    expectedProjectNumber: base.project.number, region: base.project.region, databaseId: base.firestore.databaseId,
    rtdbDatabaseUrl: base.legacyRtdb.url, serviceName: base.authority.service,
    runtimeServiceAccount: base.authority.runtimeServiceAccount, publicInvoker: false, gatewayInvokerOnly: true,
    gatewayAppCheckMode: 'monitor', reserveConsumesLimitedUseAppCheck: true, productionDebugTokensRegistered: false,
    defaultComputeEditorPresent: false, credentialSource: 'production-workload-identity', staticCredentialFilePresent: false,
    gates: { ...DISABLED_GATES }, customRolePermissions: [...PERMISSIONS],
    authorityIamBindings: [{
      role: `projects/${base.project.id}/roles/${base.authority.customRoleId}`,
      databaseId: base.firestore.databaseId,
      conditionExpression: base.authority.conditionalIamExpression
    }],
    groupAInfrastructure: {
      databaseExists: true, location: 'us-central1', type: 'FIRESTORE_NATIVE', edition: 'STANDARD', pitrEnabled: true,
      deletionProtectionEnabled: true, applicationDocumentCount: 0, denyAllRulesActive: true, defaultDatabaseExists: false,
      builderKeyless: true, deployerKeyless: true
    },
    authorityServiceExists: true,
    gatewayDeployed: true,
    gatewayIamBindings: [{ role: 'roles/run.invoker', service: base.authority.service, scope: 'service' }]
  };
  return { input, manifestPath, readinessPath };
}

test('production guard requires reviewed project number private readiness narrow IAM private Run and disabled gates', () => {
  const fixture = guardedFixture();
  const options = { ...fixture, now: Date.parse('2030-01-01T01:00:00.000Z') };
  assert.deepEqual(guardProductionTarget(fixture.input, options), {
    ok: true, approvalGroup: 'B', environment: 'production', targetVerified: true, groupAInfrastructureVerified: true,
    deploymentPhase: 'postdeploy', allGatesDisabled: true, laterGroupsAuthorized: false, cloudOperations: 0
  });
  for (const [override, reason] of [
    [{ projectId: STAGING.projectId }, 'project_id_mismatch'],
    [{ publicInvoker: true }, 'cloud_run_invoker_boundary_invalid'],
    [{ productionDebugTokensRegistered: true }, 'app_check_boundary_invalid'],
    [{ defaultComputeEditorPresent: true }, 'default_compute_editor_present'],
    [{ staticCredentialFilePresent: true }, 'credential_boundary_invalid']
  ]) {
    assert.throws(() => guardProductionTarget({ ...fixture.input, ...override }, options), (error) => error.reasons.includes(reason));
  }
  assert.throws(() => guardProductionTarget({ ...fixture.input, gates: { ...fixture.input.gates, GATEWAY_INVOCATION_ENABLED: true } }, options),
    (error) => error.reasons.includes('activation_gate_not_false'));
});

test('Group B predeploy guard accepts completed Group A state but no future runtime resources', () => {
  const fixture = guardedFixture();
  const input = {
    ...fixture.input,
    deploymentPhase: 'predeploy',
    authorityServiceExists: false,
    gatewayDeployed: false,
    gatewayIamBindings: []
  };
  const result = guardProductionTarget(input, { ...fixture, now: Date.parse('2030-01-01T01:00:00.000Z') });
  assert.equal(result.groupAInfrastructureVerified, true);
  assert.equal(result.deploymentPhase, 'predeploy');
  assert.equal(result.laterGroupsAuthorized, false);
});

test('Group B guard rejects an expired window altered operations and later-group authorization', () => {
  const fixture = guardedFixture();
  const readiness = JSON.parse(fs.readFileSync(fixture.readinessPath, 'utf8'));
  for (const override of [
    { deploymentWindow: { startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-01T09:00:00.000Z' } },
    { authorizedOperations: [...ALLOWED_OPERATIONS, 'migrate-user'] },
    { laterGroupsAuthorized: true, groupCAuthorized: true }
  ]) {
    fs.writeFileSync(fixture.readinessPath, JSON.stringify({ ...readiness, ...override }));
    assert.throws(() => guardProductionTarget(fixture.input, {
      ...fixture, now: Date.parse('2030-01-01T01:00:00.000Z')
    }), (error) => error.reasons.includes('private_readiness_mismatch'));
  }
});

test('reviewed production project number still leaves Group B deployment blocked without its private readiness', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), 'utf8'));
  assert.equal(manifest.project.number, '1053781218847');
  assert.equal(manifest.project.numberReviewed, true);
  const missingReadiness = path.join(os.tmpdir(), `e1-production-readiness-missing-${process.pid}.json`);
  assert.throws(() => guardProductionTarget({}, { readinessPath: missingReadiness }),
    (error) => error.reasons.includes('private_readiness_file_missing_or_invalid'));
});

test('rollback disables every activation path while preserving legacy username PIN compatibility and authority records', () => {
  const result = rollbackState();
  assert.deepEqual(result.gates, DISABLED_GATES);
  assert.equal(result.legacyUsernamePinEnabled, true);
  assert.equal(result.authorityRecordsDeleted, false);
  assert.equal(result.orderedActions.at(-1), 'remove-gateway-run-invoker-for-emergency-containment');
  assert.throws(() => rollbackState({ GATEWAY_INVOCATION_ENABLED: true }), /rollback-not-contained/);
});

test('Group E control plane remains an exact deny-all planned resource with narrow database-conditioned IAM', () => {
  const plan = loadControlPlanePlan();
  const publicPlan = publicProvisioningPlan();
  const productionManifest = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../production/e1-production-resource-manifest.json'), 'utf8'
  ));
  const rules = fs.readFileSync(path.resolve(__dirname, '../production/e1-group-e-control.rules'), 'utf8');

  assert.deepEqual(plan.planned.database, {
    databaseId: 'e1-group-e-control',
    location: 'us-central1',
    type: 'FIRESTORE_NATIVE',
    edition: 'STANDARD',
    deletionProtection: true,
    pitr: 'ENABLED',
    ttl: null,
    mobileWebRules: 'deny-all',
    status: 'NOT_CREATED'
  });
  assert.equal(plan.deployed, null);
  assert.equal(publicPlan.cloudOperations, 0);
  assert.equal(publicPlan.deployed, false);
  assert.equal(GROUP_E_CONTROL_DATABASE_ID, 'e1-group-e-control');
  assert.equal(GROUP_E_CONTROL_DATABASE_RESOURCE,
    'projects/trade-list-a4297/databases/e1-group-e-control');
  assert.equal(GROUP_E_CONTROL_IAM_CONDITION,
    'resource.type == "firestore.googleapis.com/Database" && resource.name == ' +
    '"projects/trade-list-a4297/databases/e1-group-e-control"');
  assert.deepEqual(GROUP_E_CONTROL_PERMISSIONS.gateway, [
    'datastore.databases.get',
    'datastore.databases.getMetadata',
    'datastore.entities.get',
    'datastore.entities.create'
  ]);
  assert.deepEqual(GROUP_E_CONTROL_PERMISSIONS.operator, GROUP_E_CONTROL_PERMISSIONS.gateway);
  assert.deepEqual(GROUP_E_CONTROL_PERMISSIONS.reviewer, [
    'datastore.databases.get',
    'datastore.databases.getMetadata',
    'datastore.entities.get'
  ]);
  for (const permissions of Object.values(GROUP_E_CONTROL_PERMISSIONS)) {
    assert.equal(permissions.some((permission) => GROUP_E_CONTROL_FORBIDDEN_PERMISSIONS.includes(permission)), false);
  }
  assert.match(rules, /allow read, write: if false;/u);
  assert.doesNotMatch(rules, /allow\s+(?:read|write):\s*if\s+true/iu);
  assert.throws(() => requireDeployedControlPlane(null), /group_e_control_deployment_absent/);
  assert.equal(Object.hasOwn(productionManifest, 'groupEControlPlane'), false);
  assert.equal(JSON.stringify(productionManifest).includes('e1-group-e-control'), false);
});
