'use strict';

const {
  PROJECT_ID,
  SLOTS,
  UUID_V4,
  appIdHash,
  capabilityDigest,
  createAdmissionReceipt,
  createConsumptionRecord,
  jtiHash,
  subjectHash,
  validateCapabilityAgainstRun,
  validateReconciliationRecord,
  validateRunManifest
} = require('./groupEAdmission');

const DATABASE_ID = 'e1-group-e-control';
const MAX_TRANSACTION_ATTEMPTS = 3;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateRunId(runId) {
  if (!UUID_V4.test(runId || '')) fail('GROUP_E_RUN_ID_INVALID');
  return runId;
}

function validateSlot(slot) {
  if (!SLOTS.includes(slot)) fail('GROUP_E_SLOT_INVALID');
  return slot;
}

function controlPaths(runId, slot) {
  const acceptedRunId = validateRunId(runId);
  const acceptedSlot = validateSlot(slot);
  const run = `runs/${acceptedRunId}`;
  return Object.freeze({
    run,
    consumption: `${run}/consumptions/${acceptedSlot}`,
    reconciliation: `${run}/reconciliations/${acceptedSlot}`,
    closeout: `${run}/closeouts/final`
  });
}

function snapshotData(snapshot, code) {
  if (!snapshot?.exists) fail(code);
  const value = typeof snapshot.data === 'function' ? snapshot.data() : snapshot.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function createGroupEControlStore(firestore) {
  if (!firestore || typeof firestore.doc !== 'function' || typeof firestore.runTransaction !== 'function') {
    throw new TypeError('Group E Firestore adapter required');
  }

  return Object.freeze({
    async consumeAdmission({ capability, uid, appId, consumedAt, expectedRunManifestDigest }) {
      const consumedAtMs = Date.parse(consumedAt);
      if (!Number.isFinite(consumedAtMs) || typeof uid !== 'string' || !uid ||
          subjectHash('uid', uid) !== capability?.uidHash || appIdHash(appId) !== capability?.firebaseAppIdHash) {
        fail('GROUP_E_RUNTIME_BINDING_INVALID');
      }
      const paths = controlPaths(capability?.runId, capability?.slot);
      const runRef = firestore.doc(paths.run);
      const markerRef = firestore.doc(paths.consumption);
      const reconciliationARef = capability.slot === 'B'
        ? firestore.doc(controlPaths(capability.runId, 'A').reconciliation)
        : null;
      let accepted;

      await firestore.runTransaction(async (transaction) => {
        const runSnapshot = await transaction.get(runRef);
        const run = validateRunManifest(snapshotData(runSnapshot, 'GROUP_E_RUN_MISSING'), {
          expectedManifestDigest: expectedRunManifestDigest,
          now: consumedAtMs
        });
        validateCapabilityAgainstRun(capability, run, { now: consumedAtMs });

        let reconciliationA = null;
        if (capability.slot === 'B') {
          reconciliationA = validateReconciliationRecord(snapshotData(
            await transaction.get(reconciliationARef),
            'GROUP_E_A_RECONCILIATION_MISSING'
          ));
          if (reconciliationA.runId !== capability.runId || reconciliationA.slot !== 'A' ||
              reconciliationA.reconciliationDigest !== capability.priorAReconciliationDigest ||
              reconciliationA.sessionBoundaryDigest !== null ||
              reconciliationA.remainingAdmittedCallBudget !== 1) {
            fail('GROUP_E_B_DEPENDENCY_INVALID');
          }
        }

        const existing = await transaction.get(markerRef);
        if (existing?.exists) fail('GROUP_E_ADMISSION_CONSUMED');
        const binding = run.bindings[capability.slot];
        if (capability.uidHash !== binding.uidHash || capability.trainerHash !== binding.trainerHash) {
          fail('GROUP_E_SUBJECT_DENIED');
        }
        const marker = createConsumptionRecord({
          runId: capability.runId,
          slot: capability.slot,
          capabilityDigest: capabilityDigest(capability),
          jtiHash: jtiHash(capability.jti),
          attemptHash: capability.attemptHash,
          uidHash: capability.uidHash,
          appIdHash: capability.firebaseAppIdHash,
          cohortDigest: capability.cohortDigest,
          keyId: capability.keyId,
          createdAt: consumedAt
        });
        transaction.create(markerRef, marker);
        accepted = Object.freeze({ run, marker, reconciliationA });
      }, { maxAttempts: MAX_TRANSACTION_ATTEMPTS });

      if (!accepted) fail('GROUP_E_ADMISSION_NOT_COMMITTED');
      return Object.freeze({
        run: accepted.run,
        consumption: accepted.marker,
        reconciliationA: accepted.reconciliationA,
        receipt: createAdmissionReceipt(accepted.marker)
      });
    }
  });
}

function createProductionGroupEControlStore(options = {}) {
  const Firestore = options.Firestore || require('@google-cloud/firestore').Firestore;
  const firestore = new Firestore({
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID
  });
  return createGroupEControlStore(firestore);
}

module.exports = Object.freeze({
  DATABASE_ID,
  MAX_TRANSACTION_ATTEMPTS,
  controlPaths,
  createGroupEControlStore,
  createProductionGroupEControlStore,
  validateRunId,
  validateSlot
});
