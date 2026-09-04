'use strict';

const fs = require('node:fs');
const { NORMAL_MS, RESTORE_MS, exclusive } = require('./providerIdentityRun.cjs');
const { sha256, stableJson, validateManifestSource, runManifest } = require('./providerIdentityWindow.cjs');
const { activateFreeze, releaseFreeze, verifyActiveFreeze, invalidateCertification, preflightManifest,
  verifyProgressAwareDrift, progressLedger, buildCompletionArtifact, verifyCompletionArtifact,
  certificationFromCompletion } = require('../scripts/run-provider-identity-live-window.cjs');
const { AUTHORITY_CONFIG_PATHS } = require('./providerIdentityAuthorityContract.cjs');
const { readPrivate } = require('./providerIdentityPrivateFiles.cjs');

const same = (a, b) => stableJson(a) === stableJson(b);

// A killed process leaves the lease behind. Only a demonstrably dead local PID
// permits takeover, and every takeover is restoration-only.
function acquireLease(store) {
  const file = store.file('operator-lease.json');
  let restarted = false;
  if (fs.existsSync(file)) {
    const lease = JSON.parse(readPrivate(file));
    if (!Number.isSafeInteger(lease.pid) || lease.pid <= 0) throw new Error('operator_lease_invalid');
    try { process.kill(lease.pid, 0); throw new Error('operator_already_running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(file);
    restarted = true;
  }
  exclusive(file, { pid: process.pid, runId: store.request().runId });
  return { restarted, release() { fs.unlinkSync(file); } };
}

async function orchestrate({ store, manifest, snapshot, plan, actualProvenance, cloud, adapter, checkpoint = async () => {} }) {
  validateManifestSource(manifest, snapshot);
  const request = store.request();
  if (request.manifestDigest !== manifest.manifestDigest || request.planDigest !== plan.planDigest ||
      request.rulesDigest !== plan.rules.candidateDigest || !same(request.operator, actualProvenance)) {
    throw new Error('orchestrator_provenance_mismatch');
  }
  const { planDigest, ...unsigned } = plan;
  if (require('node:crypto').createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') !== planDigest) {
    throw new Error('orchestrator_plan_changed');
  }
  let ledger = store.ledger();
  if (ledger.state.terminal) return ledger.state;
  const lease = acquireLease(store);
  if (fs.existsSync(store.file('closeout.json'))) {
    try { return store.finalizeCloseout().state; } finally { lease.release(); }
  }
  let interrupted = null;
  const onSignal = (signal) => { interrupted = signal; };
  const sigint = () => onSignal('SIGINT'), sigterm = () => onSignal('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  // Clock values must come from the cloud adapter, not CLI-supplied timestamps.
  const now = async () => {
    const at = await cloud.serverTime();
    if (!Number.isSafeInteger(at) || at < store.ledger().at) throw new Error('authoritative_clock_invalid');
    return at;
  };
  const transition = async (phase, changes = {}, action = phase) => {
    ledger = store.ledger();
    ledger = store.append(ledger, { ...ledger.state, ...changes, phase }, action, await now());
    await checkpoint(`phase:${phase}`);
  };
  const guard = async (kind, action, allowance = 30000) => {
    if (kind === 'execution' && interrupted) throw new Error('operator_interrupted');
    return store.authorize(kind, action, store.binding(), await now(), kind === 'execution' ? allowance : 0);
  };
  const step = async (kind, action, operation) => {
    ledger = await guard(kind, action);
    ledger = store.append(ledger, { ...ledger.state, pending: action }, `intent:${action}`, await now());
    await checkpoint(`before:${action}`);
    const result = await operation();
    await checkpoint(`after:${action}`);
    ledger = store.ledger();
    ledger = store.append(ledger, { ...ledger.state, pending: null,
      completedActions: [...ledger.state.completedActions, action] }, `verified:${action}`, await now());
    return result;
  };
  const frozen = async () => {
    const active = store.ledger().state.freeze;
    if (!active || (await now()) >= active.expiresAt) throw new Error('freeze_expired');
    return verifyActiveFreeze(adapter, active);
  };
  const persist = async (name, value) => {
    if (fs.existsSync(store.file(name))) {
      if (!same(store.read(name), value)) throw new Error('run_artifact_conflict');
    } else exclusive(store.file(name), store.seal(value));
  };
  try {
    if (lease.restarted || ledger.sequence > 0) {
      await transition('RESTORING', { reason: ledger.state.reason || 'unfinished_run_restart', pending: null });
    } else {
      try {
        await step('execution', 'prepare-infrastructure', () => cloud.prepare(plan, store, guard, checkpoint));
        await transition('INFRASTRUCTURE_READY', { rollback: await cloud.rollbackEvidence() });
        await cloud.verifyInactive();
        const activatedAt = await now();
        const active = { schemaVersion: 2, state: 'active', provisioningModel: 'bounded-legacy-provisioning-freeze',
          freezeId: `legacy-freeze-${request.runId}`, provisioningContractDigest: manifest.source.provisioningContractDigest,
          activatedAt, expiresAt: activatedAt + NORMAL_MS + RESTORE_MS, releasedAt: null };
        // Persist the immutable intent before either store is touched. Activation
        // latency consumes the budget conservatively; restart never resets it.
        await transition('FREEZE_ACTIVATING', { activatedAt, normalDeadline: Math.min(request.expiresAt, activatedAt + NORMAL_MS),
          hardDeadline: active.expiresAt, freeze: active });
        await step('execution', 'activate-freeze', () => activateFreeze(adapter, active));
        await transition('FROZEN');
        await cloud.verifyProvisioningSemantics(active);
        await transition('MANIFEST_APPLYING');
        let progress = new Map();
        await step('execution', 'apply-manifest', async () => {
          await frozen();
          const save = async (value) => {
            // Append progress hashes to the sealed chain, never trust a mutable progress file.
            const event = store.ledger();
            store.append(event, { ...event.state, progress: progressLedger(manifest, value) }, 'identity-checkpoint', await now());
          };
          await preflightManifest(manifest, adapter, progress, save);
          verifyProgressAwareDrift(manifest, await cloud.inventory(), progress);
          await runManifest(manifest, adapter, { progress, checkpoint: save,
            beforeCommit: async () => { await guard('execution', 'apply-manifest'); await frozen(); },
            afterCommitBeforeCheckpoint: async ({ record }) => {
              await checkpoint('identity:committed');
              await checkpoint(`identity:committed:${record.classification}`);
            },
            afterCheckpoint: async () => checkpoint('identity:checkpoint') });
        });
        const completion = await step('execution', 'verify-coverage', async () => {
          await frozen();
          const current = await cloud.inventory();
          verifyProgressAwareDrift(manifest, current, progress);
          const finalLedger = progressLedger(manifest, progress);
          const value = buildCompletionArtifact(manifest, active, finalLedger, current, await now());
          verifyCompletionArtifact(value, manifest, active, finalLedger, current);
          await persist('completion.json', value);
          return value;
        });
        await transition('COVERAGE_VERIFIED');
        await step('execution', 'create-certification', async () => {
          await frozen();
          const certification = certificationFromCompletion(manifest, active, completion, await now());
          certification.expiresAt = Math.min(certification.expiresAt, active.expiresAt, store.ledger().state.normalDeadline);
          const event = store.ledger();
          store.append(event, { ...event.state, certification }, 'certification-intent', await now());
          await adapter.createExactDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation, certification);
          if (!same(await adapter.readDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation), certification)) {
            throw new Error('certification_readback_mismatch');
          }
        });
        await transition('CERTIFICATION_CREATED');
        await step('execution', 'verify-zero-write', async () => {
          await frozen();
          await cloud.verifyZeroWriteAdmission(store.ledger().state.certification);
        });
        await transition('ZERO_WRITE_VERIFIED');
        await transition('RESTORING');
      } catch (error) {
        // Do not persist arbitrary provider errors: they may contain credentials.
        await transition('RESTORING', { reason: 'normal_execution_failed', pending: null });
      }
    }
    await step('restoration', 'invalidate-certification', () =>
      invalidateCertification(adapter, store.ledger().state.certification));
    await transition('CERTIFICATION_INVALIDATED');
    const active = store.ledger().state.freeze;
    await step('restoration', 'release-freeze', async () => {
      if (active) await releaseFreeze(adapter, active, await now());
    });
    await transition('FREEZE_RELEASED');
    const infrastructureStep = async (action, operation) => {
      try { await step('restoration', action, operation); }
      catch (error) {
        // Only an executor-classified ownership/compatibility conflict can
        // become manual review. Transport failures still require restoration.
        const items = cloud.manualReview && await cloud.manualReview(action, error);
        if (!Array.isArray(items) || !items.length) throw error;
        const event = store.ledger();
        store.append(event, { ...event.state, reason: event.state.reason || 'infrastructure_manual_review',
          manualItems: [...(event.state.manualItems || []), ...items], pending: null },
        'manual-infrastructure-review', await now());
      }
    };
    if (store.ledger().state.reason) {
      await infrastructureStep('restore-infrastructure', () => cloud.restore(plan, store, guard, checkpoint));
    }
    await infrastructureStep('cleanup-privileges', () => cloud.cleanup(plan, store, guard, checkpoint));
    await transition('PRIVILEGES_CLEANED');
    const evidence = await step('restoration', 'verify-restored', async () => {
      const state = await cloud.closeoutEvidence(manifest);
      const certification = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation);
      const freezes = [await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze),
        (await adapter.readRtdb('legacyProvisioningFreeze')).value];
      return { ...state, certificationAbsent: !certification,
        freezesInactive: freezes.every((v) => !v || v.state === 'released' || (v.schemaVersion === 2 && v.expiresAt <= state.at)),
        freezes, manifestDigest: manifest.manifestDigest };
    });
    return store.closeout(evidence, await now()).state;
  } finally {
    process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
    lease.release();
  }
}

module.exports = { acquireLease, orchestrate };
