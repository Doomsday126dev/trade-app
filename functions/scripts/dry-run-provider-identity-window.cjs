#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, runManifest, writePrivateJson } = require('../production/providerIdentityWindow.cjs');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith('--') || !argv[index + 1]) throw new Error('invalid_arguments');
    options[name.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return options;
}

function sameIdentity(actual, record) {
  return actual?.schemaVersion === 1 && actual.canonicalTrainerName === record.canonicalTrainerName &&
    actual.normalizedTrainerName === record.normalizedTrainerName && actual.revision === 1;
}

function createAdapter(snapshot) {
  const store = new Map([
    ...Object.entries(snapshot.accounts || {}).map(([id, value]) => [`accounts/${id}`, structuredClone(value)]),
    ...Object.entries(snapshot.trainerHandles || {}).map(([id, value]) => [`trainerHandles/${id}`, structuredClone(value)])
  ]);
  const sends = new Map();
  return {
    store,
    sends,
    async readDocument(target) { return store.has(target) ? structuredClone(store.get(target)) : null; },
    async readDocuments(targets) {
      return Object.fromEntries(targets.map((target) =>
        [target, store.has(target) ? structuredClone(store.get(target)) : null]));
    },
    async verify(record) {
      if (record.classification === 'UNPAIRED_AUTHINDEX_REVIEW') return;
      if (record.classification === 'ALREADY_CANONICAL') {
        if (!sameIdentity(store.get(record.targetPaths[0]), record) ||
            !sameIdentity(store.get(record.targetPaths[1]), record)) throw new Error('verify_existing_failed');
      }
      if (record.classification === 'CREATE_LEGACY_HANDLE_HOLD' && record.operation === 'VERIFY_ONLY' &&
          !sameIdentity(store.get(record.targetPaths[0]), record)) throw new Error('verify_hold_failed');
    },
    async createOnly(record, documents) {
      const key = record.targetPaths.join('|');
      sends.set(key, (sends.get(key) || 0) + 1);
      if (Object.keys(documents).some((target) => store.has(target))) throw new Error('create_only_precondition_failed');
      for (const [target, document] of Object.entries(documents)) store.set(target, structuredClone(document));
      return 'committed';
    },
    async readback(record, documents) {
      return Object.entries(documents).every(([target, document]) =>
        JSON.stringify(store.get(target)) === JSON.stringify(document));
    }
  };
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(options.snapshot), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
  const initialCanonicalDigest = sha256({ accounts: snapshot.accounts, trainerHandles: snapshot.trainerHandles });
  const adapter = createAdapter(snapshot);
  let progress;
  try {
    await runManifest(manifest, adapter, { timestamp: 1, interruptAfter: Number(options.interruptAfter || 11) });
  } catch (error) {
    if (error.message !== 'simulated_interruption') throw error;
    progress = error.progress;
  }
  if (!progress) throw new Error('interruption_not_reached');
  const restarted = await runManifest(manifest, adapter, {
    timestamp: 1, progress, expectedSourceMappingFingerprint: manifest.sourceMappingFingerprint
  });
  if ([...adapter.sends.values()].some((count) => count !== 1)) throw new Error('operation_resent');

  const protectedHandles = manifest.records.filter((record) =>
    ['ALREADY_CANONICAL', 'MIGRATE_RECIPROCAL_IDENTITY', 'CREATE_LEGACY_HANDLE_HOLD'].includes(record.classification));
  const activeCount = protectedHandles.filter((record) => {
    const value = adapter.store.get(`trainerHandles/${record.handleKey}`);
    return value?.state === 'active' || value?.state === 'legacy_hold';
  }).length;
  const discoveryRows = [...adapter.store.entries()].filter(([target, value]) =>
    target.startsWith('trainerHandles/') && value?.state === 'active').length;
  const originalUnchanged = Object.entries(snapshot.accounts || {}).every(([id, value]) =>
    JSON.stringify(adapter.store.get(`accounts/${id}`)) === JSON.stringify(value)) &&
    Object.entries(snapshot.trainerHandles || {}).every(([id, value]) =>
      JSON.stringify(adapter.store.get(`trainerHandles/${id}`)) === JSON.stringify(value));
  const coverageDigest = sha256(protectedHandles.map((record) => [record.handleKey,
    adapter.store.get(`trainerHandles/${record.handleKey}`)?.state]).sort());
  const capturedAt = Date.parse(manifest.source.capturedAt);
  const certificationCandidate = {
    schemaVersion: 2,
    state: 'certified',
    normalizationVersion: 1,
    provisioningModel: 'bounded-legacy-provisioning-freeze',
    freezeId: `legacy-freeze-${manifest.manifestDigest.slice(0, 16)}`,
    provisioningContractDigest: manifest.source.provisioningContractDigest,
    legacyNamespaceCoverageCertified: true,
    activeLegacyHandleCount: manifest.expectedInitialCounts.activeHandles,
    certifiedHandleCount: activeCount,
    coverageDigest,
    inventoryCapturedAt: capturedAt,
    certifiedAt: capturedAt + 1,
    expiresAt: capturedAt + 15 * 60 * 1000
  };
  const report = {
    schemaVersion: 1,
    resumeProofLevel: 'in-memory-unit-simulation',
    manifestDigest: manifest.manifestDigest,
    initialCanonicalDigest,
    operationCounts: manifest.operationCounts,
    simulatedFirestoreCreates: manifest.operationCounts.MIGRATE_RECIPROCAL_IDENTITY * 4 +
      manifest.records.filter((record) => record.operation === 'CREATE_HANDLE_HOLD').length,
    simulatedRtdbWrites: 0,
    completedOperations: restarted.progress.size,
    restartedSkippedOperations: restarted.skipped,
    duplicateSends: 0,
    originalOwnershipUnchanged: originalUnchanged,
    protectedHandleCount: activeCount,
    expectedProtectedHandleCount: manifest.expectedInitialCounts.activeHandles,
    discoveryActiveRows: discoveryRows,
    expectedDiscoveryActiveRows: manifest.operationCounts.ALREADY_CANONICAL +
      manifest.operationCounts.MIGRATE_RECIPROCAL_IDENTITY,
    holdOnlyDiscoveryRows: 0,
    coverageDigest,
    certificationCandidate,
    certificationCandidateDigest: sha256(certificationCandidate),
    ready: originalUnchanged && activeCount === manifest.expectedInitialCounts.activeHandles &&
      discoveryRows === manifest.operationCounts.ALREADY_CANONICAL + manifest.operationCounts.MIGRATE_RECIPROCAL_IDENTITY
  };
  writePrivateJson(path.resolve(options.output), report);
  console.log(JSON.stringify({
    ready: report.ready,
    resumeProofLevel: report.resumeProofLevel,
    operationCounts: report.operationCounts,
    simulatedFirestoreCreates: report.simulatedFirestoreCreates,
    simulatedRtdbWrites: 0,
    restartedSkippedOperations: report.restartedSkippedOperations,
    duplicateSends: 0,
    protectedHandleCount: report.protectedHandleCount,
    holdOnlyDiscoveryRows: 0,
    coverageDigest,
    certificationCandidateDigest: report.certificationCandidateDigest,
    output: path.resolve(options.output)
  }));
  return report;
}

module.exports = { parseArgs, createAdapter, run };

if (require.main === module) run().catch((error) => {
  console.error(`provider identity dry-run failed: ${error.message}`);
  process.exitCode = 1;
});
