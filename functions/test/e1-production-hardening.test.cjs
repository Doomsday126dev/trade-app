'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PRODUCTION, STAGING, validateRtdbTarget, validateTarget } = require('../e1-authority-service/e1TargetContracts');
const { EXCLUDED_PERMISSIONS, OPERATION_PERMISSIONS, PERMISSIONS, verifyPermissionInventory } = require('../production/e1CustomRole.cjs');
const { DISABLED_GATES, rollbackState } = require('../production/e1RollbackPlan.cjs');
const { guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');

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
    approvalGroup: 'B', approved: true, approvedBy: 'reviewed-operator', approvedAt: '2030-01-01T00:00:00.000Z'
  }));
  const input = {
    environment: 'production', projectId: base.project.id, projectNumber: base.project.number,
    expectedProjectNumber: base.project.number, region: base.project.region, databaseId: base.firestore.databaseId,
    rtdbDatabaseUrl: base.legacyRtdb.url, serviceName: base.authority.service,
    runtimeServiceAccount: base.authority.runtimeServiceAccount, publicInvoker: false, gatewayInvokerOnly: true,
    gatewayAppCheckEnforced: true, reserveConsumesLimitedUseAppCheck: true, productionDebugTokensRegistered: false,
    defaultComputeEditorPresent: false, credentialSource: 'production-workload-identity', staticCredentialFilePresent: false,
    gates: { ...DISABLED_GATES }, customRolePermissions: [...PERMISSIONS],
    authorityIamBindings: [{
      role: `projects/${base.project.id}/roles/${base.authority.customRoleId}`,
      databaseId: base.firestore.databaseId,
      conditionExpression: base.authority.conditionalIamExpression
    }],
    gatewayIamBindings: [{ role: 'roles/run.invoker', service: base.authority.service }]
  };
  return { input, manifestPath, readinessPath };
}

test('production guard requires reviewed project number private readiness narrow IAM private Run and disabled gates', () => {
  const fixture = guardedFixture();
  assert.deepEqual(guardProductionTarget(fixture.input, fixture), {
    ok: true, environment: 'production', targetVerified: true, allGatesDisabled: true, cloudOperations: 0
  });
  for (const [override, reason] of [
    [{ projectId: STAGING.projectId }, 'project_id_mismatch'],
    [{ publicInvoker: true }, 'cloud_run_invoker_boundary_invalid'],
    [{ productionDebugTokensRegistered: true }, 'app_check_boundary_invalid'],
    [{ defaultComputeEditorPresent: true }, 'default_compute_editor_present'],
    [{ staticCredentialFilePresent: true }, 'credential_boundary_invalid']
  ]) {
    assert.throws(() => guardProductionTarget({ ...fixture.input, ...override }, fixture), (error) => error.reasons.includes(reason));
  }
  assert.throws(() => guardProductionTarget({ ...fixture.input, gates: { ...fixture.input.gates, GATEWAY_INVOCATION_ENABLED: true } }, fixture),
    (error) => error.reasons.includes('activation_gate_not_false'));
});

test('tracked production manifest deliberately blocks deployment until project number review is recorded', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-production-readiness-'));
  const readinessPath = path.join(directory, 'readiness.json');
  fs.writeFileSync(readinessPath, JSON.stringify({ environment: 'production', approved: true }));
  assert.throws(() => guardProductionTarget({}, { readinessPath }), (error) => error.reasons.includes('project_number_not_reviewed'));
});

test('rollback disables every activation path while preserving legacy username PIN compatibility and authority records', () => {
  const result = rollbackState();
  assert.deepEqual(result.gates, DISABLED_GATES);
  assert.equal(result.legacyUsernamePinEnabled, true);
  assert.equal(result.authorityRecordsDeleted, false);
  assert.equal(result.orderedActions.at(-1), 'remove-gateway-run-invoker-for-emergency-containment');
  assert.throws(() => rollbackState({ GATEWAY_INVOCATION_ENABLED: true }), /rollback-not-contained/);
});
