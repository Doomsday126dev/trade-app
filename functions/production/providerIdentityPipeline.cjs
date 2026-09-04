'use strict';

const { loadBundle } = require('./providerIdentityPreparation.cjs');
const { Infrastructure, SecretCommands } = require('./providerIdentityInfrastructure.cjs');
const { ProviderDeploymentExecutor } = require('./providerIdentityDeploymentExecutor.cjs');
const { orchestrate } = require('./providerIdentityOrchestrator.cjs');
const { sha256 } = require('./providerIdentityWindow.cjs');

const MANUAL_CODES = new Set(['provider_key_compatibility_obligation', 'foreign_secret_iam',
  'temporary_iam_or_foreign_policy_drift', 'foreign_secret_configuration',
  'secret_version_conflict', 'infrastructure_ownership_conflict']);

// Production and rehearsal share this composition. Only command/REST transport
// and the data boundary are injected; executor methods cannot be substituted.
function createPipeline({ repo, store, manifest, snapshot, actualProvenance, spawn, rules, boundary,
  checkpoint = async () => {} }) {
  const { plan } = loadBundle({ repo, store, manifest, snapshot, actualProvenance });
  for (const method of ['serverTime', 'inventory', 'providerUsage', 'projectPolicy', 'freezeState',
    'verifyProvisioningSemantics', 'verifyZeroWriteAdmission', 'verifyProvisioningRestored', 'operationsDrained']) {
    if (typeof boundary[method] !== 'function') throw new Error('pipeline_boundary_incomplete');
  }
  if (!boundary.adapter) throw new Error('pipeline_adapter_missing');
  const commands = new SecretCommands({ spawn, providerUsage: () => boundary.providerUsage(),
    projectPolicy: () => boundary.projectPolicy() });
  const deployment = new ProviderDeploymentExecutor({ repo, store, plan, rules, spawn,
    providerUsage: () => boundary.providerUsage(), freezeState: () => boundary.freezeState() });
  let infrastructure;
  const executor = (p, s, guard, points) => {
    if (p !== plan || s !== store) throw new Error('pipeline_plan_substituted');
    infrastructure = new Infrastructure({ store, plan, commands, deployment, guard, checkpoint: points });
    return infrastructure;
  };
  const cloud = {
    serverTime: () => boundary.serverTime(), inventory: () => boundary.inventory(),
    prepare: (p, s, guard, points) => executor(p, s, guard, points).prepare(),
    restore: (p, s, guard, points) => executor(p, s, guard, points).restore(),
    cleanup: (p, s, guard, points) => executor(p, s, guard, points).cleanup(!!store.ledger().state.reason),
    async rollbackEvidence() { return { infrastructureDigest: store.ledger().state.infrastructureDigest,
      beforeDigest: sha256(infrastructure.journal().before) }; },
    async verifyInactive() {
      if (!(await boundary.operationsDrained())) throw new Error('pipeline_operations_pending');
      return deployment.verify(plan);
    },
    verifyProvisioningSemantics: (active) => boundary.verifyProvisioningSemantics(active),
    verifyZeroWriteAdmission: (certification) => boundary.verifyZeroWriteAdmission(certification),
    async manualReview(component, error) {
      return MANUAL_CODES.has(error.message) ? [{ component, code: error.message }] : null;
    },
    async closeoutEvidence() {
      const states = await deployment.inspectInactive();
      const provisioningRestored = await boundary.verifyProvisioningRestored();
      const operationsDrained = await boundary.operationsDrained();
      if (!provisioningRestored || !operationsDrained) throw new Error('pipeline_containment_unverified');
      const journal = infrastructure.journal();
      // No temporary project/runtime privilege is granted by these executors.
      // Foreign drift is recorded as manual review, never silently removed.
      const projectPolicy = await commands.privileges();
      const manual = store.ledger().state.manualItems || [];
      if (journal.before && sha256(projectPolicy) !== sha256(journal.before.privileges) &&
          !manual.some((v) => v.code === 'temporary_iam_or_foreign_policy_drift')) throw new Error('iam_closeout_drift');
      const inventory = await boundary.inventory();
      return { at: await boundary.serverTime(), gatesFalse: true, temporaryIamAbsent: true,
        provisioningRestored, operationsDrained, rulesAndRevisions: states,
        iamDigest: sha256(projectPolicy), finalIdentityCoverage: Object.keys(inventory.trainerHandles).length,
        accountCount: Object.keys(inventory.accounts).length };
    }
  };
  return { store, manifest, snapshot, plan, actualProvenance, cloud, adapter: boundary.adapter, checkpoint };
}

async function runPipeline(options) { return orchestrate(createPipeline(options)); }
module.exports = { createPipeline, runPipeline };
