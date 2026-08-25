'use strict';

const {
  baselineDigest,
  createAdmissionReceipt,
  validateConsumptionRecord,
  validateFinalCloseout,
  validatePreEnableAbort,
  validateReconciliationRecord,
  validateRunManifest
} = require('../e1-gateway/groupEAdmission');
const {
  DATABASE_ID,
  controlPaths,
  validateRunId,
  validateSlot
} = require('../e1-gateway/groupEControlStore');

const PROJECT_ID = 'trade-list-a4297';
const MAX_TRANSACTION_ATTEMPTS = 3;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function snapshotData(snapshot, code) {
  if (!snapshot?.exists) fail(code);
  const value = typeof snapshot.data === 'function' ? snapshot.data() : snapshot.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function createGroupEOperatorControlStore(firestore) {
  if (!firestore || typeof firestore.doc !== 'function' || typeof firestore.runTransaction !== 'function') {
    throw new TypeError('Group E operator Firestore adapter required');
  }
  return Object.freeze({
    async createRun(runManifest) {
      const run = validateRunManifest(runManifest);
      const ref = firestore.doc(controlPaths(run.runId, 'A').run);
      await ref.create(run);
      return run;
    },

    async createReconciliation(reconciliation) {
      const record = validateReconciliationRecord(reconciliation);
      const slot = validateSlot(record.slot);
      const paths = controlPaths(record.runId, slot);
      const runRef = firestore.doc(paths.run);
      const markerRef = firestore.doc(paths.consumption);
      const reconciliationRef = firestore.doc(paths.reconciliation);
      const priorARef = slot === 'B' ? firestore.doc(controlPaths(record.runId, 'A').reconciliation) : null;
      await firestore.runTransaction(async (transaction) => {
        const run = validateRunManifest(snapshotData(await transaction.get(runRef), 'GROUP_E_RUN_MISSING'));
        const marker = validateConsumptionRecord(snapshotData(
          await transaction.get(markerRef), 'GROUP_E_CONSUMPTION_MISSING'
        ));
        const receipt = createAdmissionReceipt(marker);
        if (run.runId !== record.runId || marker.runId !== record.runId || marker.slot !== slot ||
            record.consumptionRecordDigest !== marker.recordDigest ||
            record.admissionReceiptDigest !== receipt.receiptDigest ||
            record.identityBaselineDigest !== baselineDigest(run.identityBaseline)) {
          fail('GROUP_E_RECONCILIATION_MISMATCH');
        }
        if (slot === 'A') {
          if (record.priorAReconciliationDigest !== null) fail('GROUP_E_RECONCILIATION_MISMATCH');
        } else {
          const prior = validateReconciliationRecord(snapshotData(
            await transaction.get(priorARef), 'GROUP_E_A_RECONCILIATION_MISSING'
          ));
          if (prior.runId !== record.runId || prior.slot !== 'A' ||
              prior.reconciliationDigest !== record.priorAReconciliationDigest ||
              prior.sessionBoundaryDigest !== null) {
            fail('GROUP_E_RECONCILIATION_MISMATCH');
          }
        }
        if ((await transaction.get(reconciliationRef))?.exists) fail('GROUP_E_RECONCILIATION_EXISTS');
        transaction.create(reconciliationRef, record);
      }, { maxAttempts: MAX_TRANSACTION_ATTEMPTS });
      return record;
    },

    async createCloseout(closeout) {
      const record = validateFinalCloseout(closeout);
      validateRunId(record.runId);
      const paths = controlPaths(record.runId, 'A');
      const runRef = firestore.doc(paths.run);
      const closeoutRef = firestore.doc(paths.closeout);
      const reconciliationBRef = firestore.doc(controlPaths(record.runId, 'B').reconciliation);
      await firestore.runTransaction(async (transaction) => {
        const run = validateRunManifest(snapshotData(await transaction.get(runRef), 'GROUP_E_RUN_MISSING'));
        if (record.finalStateDigest !== run.identityBaseline.stateDigest) fail('GROUP_E_CLOSEOUT_MISMATCH');
        if (record.bReconciliationDigest !== null) {
          const reconciliationB = validateReconciliationRecord(snapshotData(
            await transaction.get(reconciliationBRef), 'GROUP_E_B_RECONCILIATION_MISSING'
          ));
          if (reconciliationB.runId !== record.runId || reconciliationB.slot !== 'B' ||
              reconciliationB.reconciliationDigest !== record.bReconciliationDigest) {
            fail('GROUP_E_CLOSEOUT_MISMATCH');
          }
        }
        if ((await transaction.get(closeoutRef))?.exists) fail('GROUP_E_CLOSEOUT_EXISTS');
        transaction.create(closeoutRef, record);
      }, { maxAttempts: MAX_TRANSACTION_ATTEMPTS });
      return record;
    },

    async createPreEnableAbort(abort) {
      const record = validatePreEnableAbort(abort);
      validateRunId(record.runId);
      const pathsA = controlPaths(record.runId, 'A');
      const pathsB = controlPaths(record.runId, 'B');
      const runRef = firestore.doc(pathsA.run);
      const closeoutRef = firestore.doc(pathsA.closeout);
      const absentRefs = [
        firestore.doc(pathsA.consumption), firestore.doc(pathsB.consumption),
        firestore.doc(pathsA.reconciliation), firestore.doc(pathsB.reconciliation)
      ];
      await firestore.runTransaction(async (transaction) => {
        const run = validateRunManifest(snapshotData(await transaction.get(runRef), 'GROUP_E_RUN_MISSING'));
        if (record.runManifestDigest !== run.manifestDigest ||
            record.executionLedgerDigest !== run.initialExecutionLedgerDigest) {
          fail('GROUP_E_PRE_ENABLE_ABORT_MISMATCH');
        }
        for (const reference of absentRefs) {
          if ((await transaction.get(reference))?.exists) fail('GROUP_E_PRE_ENABLE_ABORT_NOT_PRISTINE');
        }
        if ((await transaction.get(closeoutRef))?.exists) fail('GROUP_E_PRE_ENABLE_ABORT_EXISTS');
        transaction.create(closeoutRef, record);
      }, { maxAttempts: MAX_TRANSACTION_ATTEMPTS });
      return record;
    }
  });
}

function createProductionGroupEOperatorControlStore(options = {}) {
  const Firestore = options.Firestore || require('@google-cloud/firestore').Firestore;
  return createGroupEOperatorControlStore(new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID }));
}

module.exports = Object.freeze({
  MAX_TRANSACTION_ATTEMPTS,
  PROJECT_ID,
  createGroupEOperatorControlStore,
  createProductionGroupEOperatorControlStore
});
