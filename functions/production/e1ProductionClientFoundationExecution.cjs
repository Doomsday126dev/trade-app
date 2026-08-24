'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { disabledGatePlan } = require('./e1ProductionFirstMutationGuard.cjs');
const {
  BASELINE_FIELDS,
  FAMILY_COUNT_FIELDS,
  GATE_FIELDS,
  HASH,
  MAX_PASSIVE_OBSERVATION_MS,
  MIN_PASSIVE_OBSERVATION_MS,
  PROHIBITED_WRITE_FIELDS,
  PROVENANCE_FIELDS,
  SECURITY_FIELDS,
  SESSION_GENERATION_FIELDS,
  SLOTS,
  UUID_V4,
  attemptHash,
  baselineDigest,
  canonicalCapabilityBytes,
  capabilityDigest,
  createFinalCloseout,
  createReconciliationRecord,
  createRunManifest,
  digestArray,
  exactFields,
  jtiHash,
  sessionGenerationDigest,
  validateCapabilityShape,
  validateReconciliationRecord,
  validateRunManifest
} = require('../e1-gateway/groupEAdmission');
const { controlPaths } = require('../e1-gateway/groupEControlStore');

const PRIVATE_EXECUTION_LEDGER_PATH = path.resolve(
  __dirname,
  '../.local/e1-production-group-e-client-foundation-execution-ledger'
);
const PURPOSE = 'group-e-durable-at-most-once-execution-ledger-v1';
const SCHEMA_VERSION = 1;
const STAGES = Object.freeze({
  A_READY: 'A_READY',
  A_DISPATCH_COMMITTED: 'A_DISPATCH_COMMITTED',
  A_TERMINAL_UNRECONCILED: 'A_TERMINAL_UNRECONCILED',
  A_RECONCILED_SESSION_BOUNDARY_PENDING: 'A_RECONCILED_SESSION_BOUNDARY_PENDING',
  A_RECONCILED_B_PENDING: 'A_RECONCILED_B_PENDING',
  B_DISPATCH_COMMITTED: 'B_DISPATCH_COMMITTED',
  B_TERMINAL_UNRECONCILED: 'B_TERMINAL_UNRECONCILED',
  AB_RECONCILED_RESTORATION_REQUIRED: 'AB_RECONCILED_RESTORATION_REQUIRED',
  RESTORED_OBSERVATION_PENDING: 'RESTORED_OBSERVATION_PENDING',
  CLOSED_HEALTHY: 'CLOSED_HEALTHY',
  BLOCKED_RESTORATION_REQUIRED: 'BLOCKED_RESTORATION_REQUIRED',
  CLOSED_BLOCKED: 'CLOSED_BLOCKED'
});
const NEXT_ACTION = Object.freeze({
  [STAGES.A_READY]: 'ENABLE_GATES_AND_COMMIT_A_DISPATCH',
  [STAGES.A_DISPATCH_COMMITTED]: 'DELIVER_A_CAPABILITY_ONCE',
  [STAGES.A_TERMINAL_UNRECONCILED]: 'RECONCILE_A',
  [STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING]: 'VERIFY_A_SESSION_BOUNDARY',
  [STAGES.A_RECONCILED_B_PENDING]: 'COMMIT_B_DISPATCH',
  [STAGES.B_DISPATCH_COMMITTED]: 'DELIVER_B_CAPABILITY_ONCE',
  [STAGES.B_TERMINAL_UNRECONCILED]: 'RECONCILE_B',
  [STAGES.AB_RECONCILED_RESTORATION_REQUIRED]: 'RESTORE_GATES',
  [STAGES.RESTORED_OBSERVATION_PENDING]: 'ACCEPT_PASSIVE_OBSERVATION_AND_CLOSE',
  [STAGES.CLOSED_HEALTHY]: 'STOP_CLOSED_HEALTHY',
  [STAGES.CLOSED_BLOCKED]: 'STOP_CLOSED_BLOCKED'
});
const POST_ENABLE_STAGES = Object.freeze([
  STAGES.A_DISPATCH_COMMITTED,
  STAGES.A_TERMINAL_UNRECONCILED,
  STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING,
  STAGES.A_RECONCILED_B_PENDING,
  STAGES.B_DISPATCH_COMMITTED,
  STAGES.B_TERMINAL_UNRECONCILED,
  STAGES.AB_RECONCILED_RESTORATION_REQUIRED,
  STAGES.BLOCKED_RESTORATION_REQUIRED
]);
const D3_CLOSEOUT = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0,
  stateDigest: '6f0caa5435ac7ef027fc8640bce814bd3bd3bbdd272e6c5d5cee46885916f2bb',
  gatesRestored: true,
  observationCompleted: true,
  observationHealthy: true
});
const IDENTITY_BASELINE = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0,
  stateDigest: D3_CLOSEOUT.stateDigest
});
const ZERO_WRITES = Object.freeze({
  phaseEIdentityWrites: 0,
  rtdbWrites: 0,
  ordinaryUserWrites: 0,
  unexpectedControlWrites: 0
});
const SECURITY_BOUNDARY = Object.freeze({
  authorityPrivate: true,
  gatewayOnlyInvoker: true,
  projectWideInvoker: false,
  gatewayForbiddenRolesPresent: false,
  iamDrift: false,
  productionDebugTokensRegistered: false,
  providerLinkRoutePresent: false,
  controlDatabaseRules: 'deny-all'
});
const OUTCOMES = new Set(['SUCCESS', 'TIMEOUT', 'NETWORK_ERROR', 'MALFORMED_RESPONSE', 'REJECTED']);
const BLOCK_REASONS = new Set([
  'CAPABILITY_DELIVERY_UNCERTAIN',
  'A_RECONCILIATION_INCONCLUSIVE',
  'B_RECONCILIATION_INCONCLUSIVE',
  'RUNTIME_INSTANCE_LOST',
  'UNEXPECTED_CALL_OR_WRITE',
  'STATE_OR_SECURITY_DRIFT',
  'OPERATOR_CONTAINMENT'
]);
const GIT_SHA = /^[a-f0-9]{40}$/u;
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const LEDGER_FIELDS = Object.freeze([
  'schemaVersion', 'purpose', 'runId', 'runManifestDigest', 'sequence', 'priorTransitionDigest',
  'transitionDigest', 'stage', 'nextAction', 'completedPrefix', 'remainingAdmittedBudget', 'controlPaths',
  'bindings', 'provenance', 'admission', 'identityBaseline', 'sessionContext', 'dispatches', 'terminals',
  'pendingAReconciliation', 'reconciliations', 'sessionBoundary', 'sessionBoundaryDigest', 'gates', 'outcome', 'blockedReason',
  'createdAt', 'updatedAt'
]);
const CONTROL_PATH_FIELDS = Object.freeze(['run', 'consumptionA', 'consumptionB', 'reconciliationA', 'reconciliationB', 'closeout']);
const ADMISSION_FIELDS = Object.freeze(['evidenceDigest', 'replayLedgerDigest', 'jitDigest']);
const SESSION_CONTEXT_FIELDS = Object.freeze(['environment', 'projectId', 'cohortDigest', 'firebaseAppIdHash']);
const DISPATCH_FIELDS = Object.freeze([
  'slot', 'generationId', 'sessionGeneration', 'jtiHash', 'attemptHash', 'browserContextDigest',
  'runtimeInstanceDigest', 'sessionGenerationDigest', 'committedAt'
]);
const TERMINAL_FIELDS = Object.freeze([
  'slot', 'clientOutcome', 'callableBoundaryCrossed', 'admissionReceiptDigest', 'responseDigest', 'observedAt'
]);
const RECONCILIATION_EVIDENCE_FIELDS = Object.freeze([
  'slot', 'consumptionRecordDigest', 'admissionReceiptDigest', 'gatewayRecordDigest', 'authorityRecordDigest',
  'responseDigest', 'resultDigest', 'resultCode', 'foundationStatus', 'familyCounts', 'prohibitedWrites',
  'gates', 'securityBoundary', 'runtimeDigest', 'createdAt'
]);
const SESSION_BOUNDARY_FIELDS = Object.freeze([
  'schemaVersion', 'aDispatchDigest', 'aReconciliationDigest', 'aControllerTerminal', 'aControllerClosed',
  'aInMemoryResultCleared', 'signOutVerified', 'before', 'after', 'verifiedAt', 'boundaryDigest'
]);
const BOUNDARY_SESSION_FIELDS = Object.freeze([...SESSION_GENERATION_FIELDS, 'sessionGenerationDigest']);
const HEAD_FIELDS = Object.freeze(['schemaVersion', 'sequence', 'snapshotFile', 'transitionDigest']);
const ALLOWED_STAGE_TRANSITIONS = Object.freeze({
  [STAGES.A_READY]: Object.freeze([STAGES.A_DISPATCH_COMMITTED]),
  [STAGES.A_DISPATCH_COMMITTED]: Object.freeze([
    STAGES.A_TERMINAL_UNRECONCILED, STAGES.BLOCKED_RESTORATION_REQUIRED, STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.A_TERMINAL_UNRECONCILED]: Object.freeze([
    STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING, STAGES.BLOCKED_RESTORATION_REQUIRED,
    STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING]: Object.freeze([
    STAGES.A_RECONCILED_B_PENDING, STAGES.BLOCKED_RESTORATION_REQUIRED, STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.A_RECONCILED_B_PENDING]: Object.freeze([
    STAGES.B_DISPATCH_COMMITTED, STAGES.BLOCKED_RESTORATION_REQUIRED, STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.B_DISPATCH_COMMITTED]: Object.freeze([
    STAGES.B_TERMINAL_UNRECONCILED, STAGES.BLOCKED_RESTORATION_REQUIRED, STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.B_TERMINAL_UNRECONCILED]: Object.freeze([
    STAGES.AB_RECONCILED_RESTORATION_REQUIRED, STAGES.BLOCKED_RESTORATION_REQUIRED,
    STAGES.RESTORED_OBSERVATION_PENDING
  ]),
  [STAGES.AB_RECONCILED_RESTORATION_REQUIRED]: Object.freeze([STAGES.RESTORED_OBSERVATION_PENDING]),
  [STAGES.BLOCKED_RESTORATION_REQUIRED]: Object.freeze([STAGES.RESTORED_OBSERVATION_PENDING]),
  [STAGES.RESTORED_OBSERVATION_PENDING]: Object.freeze([STAGES.CLOSED_HEALTHY, STAGES.CLOSED_BLOCKED]),
  [STAGES.CLOSED_HEALTHY]: Object.freeze([]),
  [STAGES.CLOSED_BLOCKED]: Object.freeze([])
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function groupEActivationGatePlan() {
  return Object.freeze({
    ...disabledGatePlan(),
    GATEWAY_INVOCATION_ENABLED: true,
    READ_ACCOUNT_FOUNDATION_ENABLED: true
  });
}

function unconditionalRestorationPlan() {
  return Object.freeze({
    confirmation: 'RESTORE E1 GROUP E CLIENT FOUNDATION GATES',
    gates: disabledGatePlan(),
    requiresFreshEvidence: false,
    requiresJit: false,
    requiresReadableLedger: false,
    requiresControlStore: false,
    invokesCanary: false,
    changesIam: false
  });
}

function canonicalControlPaths(runId) {
  const a = controlPaths(runId, 'A');
  const b = controlPaths(runId, 'B');
  return Object.freeze({
    run: a.run,
    consumptionA: a.consumption,
    consumptionB: b.consumption,
    reconciliationA: a.reconciliation,
    reconciliationB: b.reconciliation,
    closeout: a.closeout
  });
}

function provenanceDigest(value) {
  return digestArray('group-e-execution-provenance', [PROVENANCE_FIELDS.map((field) => value[field])]);
}

function orderedValues(value, fields) {
  return value === null ? null : fields.map((field) => value?.[field]);
}

function canonicalReconciliationEvidence(value) {
  if (value === null) return null;
  return [
    value.slot, value.consumptionRecordDigest, value.admissionReceiptDigest, value.gatewayRecordDigest,
    value.authorityRecordDigest, value.responseDigest, value.resultDigest, value.resultCode, value.foundationStatus,
    FAMILY_COUNT_FIELDS.map((field) => value.familyCounts?.[field]),
    PROHIBITED_WRITE_FIELDS.map((field) => value.prohibitedWrites?.[field]),
    GATE_FIELDS.map((field) => value.gates?.[field]),
    SECURITY_FIELDS.map((field) => value.securityBoundary?.[field]), value.runtimeDigest, value.createdAt
  ];
}

function canonicalSessionBoundary(value) {
  if (value === null) return null;
  return [
    value.schemaVersion, value.aDispatchDigest, value.aReconciliationDigest,
    value.aControllerTerminal, value.aControllerClosed, value.aInMemoryResultCleared, value.signOutVerified,
    orderedValues(value.before, BOUNDARY_SESSION_FIELDS),
    orderedValues(value.after, BOUNDARY_SESSION_FIELDS),
    value.verifiedAt
  ];
}

function canonicalTransitionArray(value) {
  return [
    SCHEMA_VERSION, PURPOSE, value.schemaVersion, value.purpose, value.runId, value.runManifestDigest,
    value.sequence, value.priorTransitionDigest, value.stage, value.nextAction, value.completedPrefix,
    value.remainingAdmittedBudget, orderedValues(value.controlPaths, CONTROL_PATH_FIELDS),
    SLOTS.flatMap((slot) => [slot, value.bindings?.[slot]?.uidHash, value.bindings?.[slot]?.trainerHash]),
    orderedValues(value.provenance, PROVENANCE_FIELDS), orderedValues(value.admission, ADMISSION_FIELDS),
    orderedValues(value.identityBaseline, BASELINE_FIELDS),
    orderedValues(value.sessionContext, SESSION_CONTEXT_FIELDS),
    SLOTS.map((slot) => orderedValues(value.dispatches?.[slot], DISPATCH_FIELDS)),
    SLOTS.map((slot) => orderedValues(value.terminals?.[slot], TERMINAL_FIELDS)),
    canonicalReconciliationEvidence(value.pendingAReconciliation),
    SLOTS.map((slot) => value.reconciliations?.[slot]?.reconciliationDigest || null),
    canonicalSessionBoundary(value.sessionBoundary), value.sessionBoundaryDigest,
    orderedValues(value.gates, GATE_FIELDS), value.outcome, value.blockedReason,
    value.createdAt, value.updatedAt
  ];
}

function canonicalLedgerDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalTransitionArray(value)), 'utf8').digest('hex');
}

function expectedPrefix(stage, ledger) {
  if ([STAGES.A_RECONCILED_B_PENDING, STAGES.B_DISPATCH_COMMITTED, STAGES.B_TERMINAL_UNRECONCILED].includes(stage)) {
    return ['A'];
  }
  if ([STAGES.AB_RECONCILED_RESTORATION_REQUIRED, STAGES.CLOSED_HEALTHY].includes(stage)) return ['A', 'B'];
  if ([STAGES.RESTORED_OBSERVATION_PENDING, STAGES.BLOCKED_RESTORATION_REQUIRED,
    STAGES.CLOSED_BLOCKED].includes(stage)) return ledger.completedPrefix;
  return [];
}

function expectedBudget(stage, ledger) {
  if ([STAGES.A_READY, STAGES.A_DISPATCH_COMMITTED, STAGES.A_TERMINAL_UNRECONCILED,
    STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING].includes(stage)) return 2;
  if ([STAGES.A_RECONCILED_B_PENDING, STAGES.B_DISPATCH_COMMITTED, STAGES.B_TERMINAL_UNRECONCILED].includes(stage)) return 1;
  if ([STAGES.AB_RECONCILED_RESTORATION_REQUIRED, STAGES.CLOSED_HEALTHY].includes(stage)) return 0;
  return ledger.remainingAdmittedBudget;
}

function expectedNextAction(ledger) {
  if (ledger.stage === STAGES.BLOCKED_RESTORATION_REQUIRED) {
    return sameJson(ledger.gates, disabledGatePlan()) ? 'OBSERVE_AND_CLOSE_BLOCKED' : 'RESTORE_GATES';
  }
  return NEXT_ACTION[ledger.stage];
}

function validBindings(bindings) {
  return exactFields(bindings, SLOTS) && SLOTS.every((slot) => exactFields(bindings[slot], ['uidHash', 'trainerHash']) &&
    HASH.test(bindings[slot].uidHash || '') && HASH.test(bindings[slot].trainerHash || '')) &&
    bindings.A.uidHash !== bindings.B.uidHash && bindings.A.trainerHash !== bindings.B.trainerHash;
}

function validProvenance(value) {
  return exactFields(value, PROVENANCE_FIELDS) && GIT_SHA.test(value.toolingSourceSha || '') &&
    RELEASE_ID.test(value.pagesReleaseId || '') && GIT_SHA.test(value.pagesSourceSha || '') &&
    HASH.test(value.pagesArtifactDigest || '') && GIT_SHA.test(value.gatewaySourceSha || '') &&
    HASH.test(value.gatewaySourceFingerprint || '') && REVISION.test(value.authorityRevision || '') &&
    IMAGE.test(value.authorityImageDigest || '');
}

function validAdmission(value) {
  return exactFields(value, ADMISSION_FIELDS) && HASH.test(value.evidenceDigest || '') &&
    HASH.test(value.replayLedgerDigest || '') && HASH.test(value.jitDigest || '');
}

function validSessionContext(value) {
  return exactFields(value, SESSION_CONTEXT_FIELDS) && value.environment === 'production' &&
    value.projectId === 'trade-list-a4297' && HASH.test(value.cohortDigest || '') &&
    HASH.test(value.firebaseAppIdHash || '');
}

function dispatchSessionGenerationContext(ledger, dispatch) {
  const binding = ledger.bindings?.[dispatch?.slot];
  return {
    schemaVersion: 1,
    environment: ledger.sessionContext?.environment,
    projectId: ledger.sessionContext?.projectId,
    runId: ledger.runId,
    cohortDigest: ledger.sessionContext?.cohortDigest,
    slot: dispatch?.slot,
    uidHash: binding?.uidHash,
    trainerHash: binding?.trainerHash,
    generationId: dispatch?.generationId,
    sessionGeneration: dispatch?.sessionGeneration,
    firebaseAppIdHash: ledger.sessionContext?.firebaseAppIdHash,
    browserContextDigest: dispatch?.browserContextDigest,
    runtimeInstanceDigest: dispatch?.runtimeInstanceDigest
  };
}

function executionDispatchDigest(ledger, dispatch) {
  return digestArray('group-e-execution-dispatch', [
    ledger.runId, ledger.runManifestDigest, orderedValues(ledger.sessionContext, SESSION_CONTEXT_FIELDS),
    dispatch?.slot, ledger.bindings?.[dispatch?.slot]?.uidHash, ledger.bindings?.[dispatch?.slot]?.trainerHash,
    orderedValues(dispatch, DISPATCH_FIELDS)
  ]);
}

function validDispatch(value, slot, ledger) {
  return exactFields(value, DISPATCH_FIELDS) && value.slot === slot && UUID_V4.test(value.generationId || '') &&
    Number.isSafeInteger(value.sessionGeneration) && value.sessionGeneration >= 0 &&
    HASH.test(value.jtiHash || '') && HASH.test(value.attemptHash || '') && HASH.test(value.browserContextDigest || '') &&
    HASH.test(value.runtimeInstanceDigest || '') && HASH.test(value.sessionGenerationDigest || '') &&
    validTimestamp(value.committedAt) &&
    value.sessionGenerationDigest === sessionGenerationDigest(dispatchSessionGenerationContext(ledger, value));
}

function validTerminal(value, slot) {
  return exactFields(value, TERMINAL_FIELDS) && value.slot === slot && OUTCOMES.has(value.clientOutcome) &&
    value.callableBoundaryCrossed === true && (value.admissionReceiptDigest === null || HASH.test(value.admissionReceiptDigest || '')) &&
    (value.responseDigest === null || HASH.test(value.responseDigest || '')) && validTimestamp(value.observedAt);
}

function validReconciliationEvidence(value, slot) {
  return exactFields(value, RECONCILIATION_EVIDENCE_FIELDS) && value.slot === slot &&
    ['consumptionRecordDigest', 'admissionReceiptDigest', 'gatewayRecordDigest', 'authorityRecordDigest',
      'responseDigest', 'resultDigest', 'runtimeDigest'].every((field) => HASH.test(value[field] || '')) &&
    value.resultCode === 'SUCCESS' && value.foundationStatus === 'active' &&
    sameJson(value.familyCounts, { totalDocuments: 32, accounts: 8, trainerHandles: 8, rateLimits: 8,
      operationRequests: 8, identityMigrations: 0, identityConflicts: 0 }) &&
    sameJson(value.prohibitedWrites, ZERO_WRITES) && sameJson(value.gates, groupEActivationGatePlan()) &&
    sameJson(value.securityBoundary, SECURITY_BOUNDARY) && validTimestamp(value.createdAt);
}

function reconciliationEvidenceFromRecord(value) {
  return Object.fromEntries(RECONCILIATION_EVIDENCE_FIELDS.map((field) => [field, value?.[field]]));
}

function aReconciliationRecord(ledger, evidence) {
  return createReconciliationRecord({
    runId: ledger.runId,
    slot: 'A',
    ...structuredClone(evidence),
    identityBaselineDigest: baselineDigest(ledger.identityBaseline),
    remainingAdmittedCallBudget: 1,
    priorAReconciliationDigest: null,
    sessionBoundaryDigest: null
  });
}

function sessionBoundaryDigest(value) {
  return digestArray('group-e-session-boundary', canonicalSessionBoundary(value));
}

function validBoundarySession(value, expected) {
  if (!exactFields(value, BOUNDARY_SESSION_FIELDS) || !sameJson(
    Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, value[field]])), expected
  ) || !HASH.test(value.sessionGenerationDigest || '')) return false;
  try { return value.sessionGenerationDigest === sessionGenerationDigest(expected); }
  catch { return false; }
}

function validSessionBoundary(value, ledger) {
  if (!exactFields(value, SESSION_BOUNDARY_FIELDS) || value.schemaVersion !== 1 ||
      value.aControllerTerminal !== true || value.aControllerClosed !== true ||
      value.aInMemoryResultCleared !== true || value.signOutVerified !== true ||
      !validTimestamp(value.verifiedAt) || !HASH.test(value.aDispatchDigest || '') ||
      !HASH.test(value.aReconciliationDigest || '') || !HASH.test(value.boundaryDigest || '') ||
      !ledger.dispatches?.A || !validSessionContext(ledger.sessionContext)) return false;
  const aEvidence = ledger.pendingAReconciliation || reconciliationEvidenceFromRecord(ledger.reconciliations?.A);
  if (!validReconciliationEvidence(aEvidence, 'A')) return false;
  let aReconciliation;
  try { aReconciliation = ledger.reconciliations?.A || aReconciliationRecord(ledger, aEvidence); }
  catch { return false; }
  const before = dispatchSessionGenerationContext(ledger, ledger.dispatches.A);
  const after = {
    schemaVersion: 1,
    environment: ledger.sessionContext.environment,
    projectId: ledger.sessionContext.projectId,
    runId: ledger.runId,
    cohortDigest: ledger.sessionContext.cohortDigest,
    slot: 'B',
    uidHash: ledger.bindings.B.uidHash,
    trainerHash: ledger.bindings.B.trainerHash,
    generationId: value.after?.generationId,
    sessionGeneration: value.after?.sessionGeneration,
    firebaseAppIdHash: ledger.sessionContext.firebaseAppIdHash,
    browserContextDigest: value.after?.browserContextDigest,
    runtimeInstanceDigest: value.after?.runtimeInstanceDigest
  };
  return value.aDispatchDigest === executionDispatchDigest(ledger, ledger.dispatches.A) &&
    value.aReconciliationDigest === aReconciliation.reconciliationDigest &&
    validBoundarySession(value.before, before) && validBoundarySession(value.after, after) &&
    value.after.generationId !== value.before.generationId &&
    value.after.browserContextDigest === value.before.browserContextDigest &&
    value.after.runtimeInstanceDigest === value.before.runtimeInstanceDigest &&
    Number.isSafeInteger(value.after.sessionGeneration) && value.after.sessionGeneration >= 0 &&
    value.after.sessionGeneration > value.before.sessionGeneration &&
    value.boundaryDigest === sessionBoundaryDigest(value);
}

function validateExecutionLedger(value, options = {}) {
  if (!exactFields(value, LEDGER_FIELDS) || value.schemaVersion !== SCHEMA_VERSION || value.purpose !== PURPOSE ||
      !UUID_V4.test(value.runId || '') || (value.runManifestDigest !== null && !HASH.test(value.runManifestDigest || '')) ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
      (value.priorTransitionDigest !== null && !HASH.test(value.priorTransitionDigest || '')) ||
      !HASH.test(value.transitionDigest || '') || value.transitionDigest !== canonicalLedgerDigest(value) ||
      !Object.values(STAGES).includes(value.stage) || !Array.isArray(value.completedPrefix) ||
      value.completedPrefix.some((slot, index) => slot !== SLOTS[index]) || value.completedPrefix.length > 2 ||
      !Number.isInteger(value.remainingAdmittedBudget) || value.remainingAdmittedBudget < 0 || value.remainingAdmittedBudget > 2 ||
      !exactFields(value.controlPaths, CONTROL_PATH_FIELDS) || !sameJson(value.controlPaths, canonicalControlPaths(value.runId)) ||
      !validBindings(value.bindings) || !validProvenance(value.provenance) || !validAdmission(value.admission) ||
      !sameJson(value.identityBaseline, IDENTITY_BASELINE) || !exactFields(value.dispatches, SLOTS) ||
      !exactFields(value.terminals, SLOTS) || !exactFields(value.reconciliations, SLOTS) ||
      !validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt) ||
      Date.parse(value.updatedAt) < Date.parse(value.createdAt)) fail('group_e_execution_ledger_invalid');

  if (!sameJson(value.completedPrefix, expectedPrefix(value.stage, value)) ||
      value.remainingAdmittedBudget !== expectedBudget(value.stage, value) || value.nextAction !== expectedNextAction(value)) {
    fail('group_e_execution_progress_invalid');
  }
  if (value.sequence === 0 ? value.priorTransitionDigest !== null || value.runManifestDigest !== null :
    !HASH.test(value.priorTransitionDigest || '') || !HASH.test(value.runManifestDigest || '')) {
    fail('group_e_execution_chain_invalid');
  }

  const aDispatched = value.dispatches.A !== null;
  const bDispatched = value.dispatches.B !== null;
  if (aDispatched ? !validSessionContext(value.sessionContext) : value.sessionContext !== null) {
    fail('group_e_session_context_invalid');
  }
  if (aDispatched ? !validDispatch(value.dispatches.A, 'A', value) : value.stage !== STAGES.A_READY) {
    fail('group_e_dispatch_invalid');
  }
  if (bDispatched && !validDispatch(value.dispatches.B, 'B', value)) fail('group_e_dispatch_invalid');
  if (bDispatched && ['generationId', 'jtiHash', 'attemptHash'].some((field) =>
    value.dispatches.A[field] === value.dispatches.B[field])) fail('group_e_dispatch_invalid');
  if ([STAGES.B_DISPATCH_COMMITTED, STAGES.B_TERMINAL_UNRECONCILED, STAGES.AB_RECONCILED_RESTORATION_REQUIRED,
    STAGES.CLOSED_HEALTHY].includes(value.stage) && !bDispatched) fail('group_e_dispatch_invalid');

  if (value.terminals.A !== null && !validTerminal(value.terminals.A, 'A')) fail('group_e_terminal_invalid');
  if (value.terminals.B !== null && !validTerminal(value.terminals.B, 'B')) fail('group_e_terminal_invalid');
  if ([STAGES.A_TERMINAL_UNRECONCILED, STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING,
    STAGES.A_RECONCILED_B_PENDING, STAGES.B_DISPATCH_COMMITTED, STAGES.B_TERMINAL_UNRECONCILED,
    STAGES.AB_RECONCILED_RESTORATION_REQUIRED, STAGES.CLOSED_HEALTHY].includes(value.stage) && !value.terminals.A) {
    fail('group_e_terminal_invalid');
  }
  if ([STAGES.B_TERMINAL_UNRECONCILED, STAGES.AB_RECONCILED_RESTORATION_REQUIRED,
    STAGES.CLOSED_HEALTHY].includes(value.stage) && !value.terminals.B) fail('group_e_terminal_invalid');

  if (value.stage === STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING ?
    !validReconciliationEvidence(value.pendingAReconciliation, 'A') : value.pendingAReconciliation !== null) {
    fail('group_e_pending_reconciliation_invalid');
  }
  const aReconciled = value.completedPrefix.includes('A');
  const bReconciled = value.completedPrefix.includes('B');
  if (aReconciled) validateReconciliationRecord(value.reconciliations.A);
  else if (value.reconciliations.A !== null) fail('group_e_reconciliation_invalid');
  if (bReconciled) validateReconciliationRecord(value.reconciliations.B);
  else if (value.reconciliations.B !== null) fail('group_e_reconciliation_invalid');
  if (aReconciled && (value.reconciliations.A.runId !== value.runId || value.reconciliations.A.slot !== 'A')) {
    fail('group_e_reconciliation_invalid');
  }
  if (bReconciled && (value.reconciliations.B.runId !== value.runId || value.reconciliations.B.slot !== 'B' ||
      value.reconciliations.B.priorAReconciliationDigest !== value.reconciliations.A.reconciliationDigest)) {
    fail('group_e_reconciliation_invalid');
  }
  if (aReconciled ? !validSessionBoundary(value.sessionBoundary, value) ||
    value.sessionBoundaryDigest !== value.sessionBoundary.boundaryDigest ||
    value.reconciliations.A.sessionBoundaryDigest !== null ||
    value.sessionBoundary.aReconciliationDigest !== value.reconciliations.A.reconciliationDigest :
    value.sessionBoundary !== null || value.sessionBoundaryDigest !== null) {
    fail('group_e_session_boundary_invalid');
  }
  if (bDispatched && !sameJson(dispatchSessionGenerationContext(value, value.dispatches.B),
    Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, value.sessionBoundary.after[field]])))) {
    fail('group_e_dispatch_session_mismatch');
  }

  const restored = [STAGES.RESTORED_OBSERVATION_PENDING, STAGES.CLOSED_HEALTHY, STAGES.CLOSED_BLOCKED].includes(value.stage) ||
    value.stage === STAGES.BLOCKED_RESTORATION_REQUIRED && sameJson(value.gates, disabledGatePlan());
  const active = POST_ENABLE_STAGES.includes(value.stage) && value.stage !== STAGES.BLOCKED_RESTORATION_REQUIRED;
  const blockedNeedsRestoration = value.stage === STAGES.BLOCKED_RESTORATION_REQUIRED && !restored;
  if (restored ? !sameJson(value.gates, disabledGatePlan()) : active ? !sameJson(value.gates, groupEActivationGatePlan()) :
    blockedNeedsRestoration ? !sameJson(value.gates, groupEActivationGatePlan()) :
    value.stage === STAGES.A_READY ? !sameJson(value.gates, disabledGatePlan()) : false) fail('group_e_gates_invalid');

  if ([STAGES.BLOCKED_RESTORATION_REQUIRED, STAGES.CLOSED_BLOCKED].includes(value.stage) ||
      value.stage === STAGES.RESTORED_OBSERVATION_PENDING && value.outcome === 'blocked') {
    if (!BLOCK_REASONS.has(value.blockedReason) || value.outcome !== 'blocked') fail('group_e_block_invalid');
  } else if (value.blockedReason !== null || !['pending', 'healthy'].includes(value.outcome)) fail('group_e_block_invalid');
  if (value.stage === STAGES.CLOSED_HEALTHY && value.outcome !== 'healthy') fail('group_e_closeout_invalid');
  if (options.requireStage && value.stage !== options.requireStage) fail('group_e_execution_stage_invalid');
  if (options.requirePristine && (value.sequence !== 0 || value.stage !== STAGES.A_READY ||
      value.runManifestDigest !== null || value.completedPrefix.length || !sameJson(value.gates, disabledGatePlan()))) {
    fail('group_e_execution_not_pristine');
  }
  return Object.freeze({
    ok: true,
    stage: value.stage,
    sequence: value.sequence,
    completedPrefix: Object.freeze([...value.completedPrefix]),
    nextAction: value.nextAction,
    remainingAdmittedBudget: value.remainingAdmittedBudget,
    transitionDigest: value.transitionDigest
  });
}

function seal(value, previous = null) {
  const next = structuredClone(value);
  next.sequence = previous ? previous.sequence + 1 : 0;
  next.priorTransitionDigest = previous?.transitionDigest || null;
  next.nextAction = expectedNextAction(next);
  next.transitionDigest = canonicalLedgerDigest(next);
  validateExecutionLedger(next);
  if (previous) validateMonotonicTransition(previous, next);
  return Object.freeze(next);
}

function validateMonotonicTransition(previous, next) {
  validateExecutionLedger(previous);
  validateExecutionLedger(next);
  if (!ALLOWED_STAGE_TRANSITIONS[previous.stage]?.includes(next.stage) ||
      next.sequence !== previous.sequence + 1 || next.priorTransitionDigest !== previous.transitionDigest ||
      next.runId !== previous.runId || next.createdAt !== previous.createdAt ||
      !sameJson(next.controlPaths, previous.controlPaths) || !sameJson(next.bindings, previous.bindings) ||
      !sameJson(next.provenance, previous.provenance) || !sameJson(next.admission, previous.admission) ||
      !sameJson(next.identityBaseline, previous.identityBaseline) ||
      next.completedPrefix.length < previous.completedPrefix.length ||
      !sameJson(next.completedPrefix.slice(0, previous.completedPrefix.length), previous.completedPrefix) ||
      next.remainingAdmittedBudget > previous.remainingAdmittedBudget ||
      Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) fail('group_e_execution_transition_invalid');
  if (previous.runManifestDigest && next.runManifestDigest !== previous.runManifestDigest) fail('group_e_execution_transition_invalid');
  if (previous.sessionContext && !sameJson(next.sessionContext, previous.sessionContext)) {
    fail('group_e_execution_transition_invalid');
  }
  if (previous.dispatches.A && !sameJson(next.dispatches.A, previous.dispatches.A) ||
      previous.dispatches.B && !sameJson(next.dispatches.B, previous.dispatches.B) ||
      previous.terminals.A && !sameJson(next.terminals.A, previous.terminals.A) ||
      previous.terminals.B && !sameJson(next.terminals.B, previous.terminals.B) ||
      previous.reconciliations.A && !sameJson(next.reconciliations.A, previous.reconciliations.A) ||
      previous.reconciliations.B && !sameJson(next.reconciliations.B, previous.reconciliations.B)) {
    fail('group_e_execution_transition_invalid');
  }
  if (previous.sessionBoundary && !sameJson(next.sessionBoundary, previous.sessionBoundary) ||
      previous.sessionBoundaryDigest && next.sessionBoundaryDigest !== previous.sessionBoundaryDigest ||
      previous.outcome === 'blocked' && next.outcome !== 'blocked' ||
      previous.blockedReason && next.blockedReason !== previous.blockedReason) {
    fail('group_e_execution_transition_invalid');
  }
}

function createInitialExecutionLedger(value) {
  if (!exactFields(value, ['runId', 'bindings', 'provenance', 'admission', 'createdAt']) ||
      !UUID_V4.test(value.runId || '') || !validBindings(value.bindings) || !validProvenance(value.provenance) ||
      !validAdmission(value.admission) || !validTimestamp(value.createdAt)) fail('group_e_execution_initialization_invalid');
  return seal({
    schemaVersion: SCHEMA_VERSION,
    purpose: PURPOSE,
    runId: value.runId,
    runManifestDigest: null,
    sequence: 0,
    priorTransitionDigest: null,
    transitionDigest: null,
    stage: STAGES.A_READY,
    nextAction: null,
    completedPrefix: [],
    remainingAdmittedBudget: 2,
    controlPaths: canonicalControlPaths(value.runId),
    bindings: structuredClone(value.bindings),
    provenance: structuredClone(value.provenance),
    admission: structuredClone(value.admission),
    identityBaseline: IDENTITY_BASELINE,
    sessionContext: null,
    dispatches: { A: null, B: null },
    terminals: { A: null, B: null },
    pendingAReconciliation: null,
    reconciliations: { A: null, B: null },
    sessionBoundary: null,
    sessionBoundaryDigest: null,
    gates: disabledGatePlan(),
    outcome: 'pending',
    blockedReason: null,
    createdAt: value.createdAt,
    updatedAt: value.createdAt
  });
}

function createExecutionRunManifest(initialLedger, value) {
  validateExecutionLedger(initialLedger, { requirePristine: true });
  return createRunManifest({
    ...structuredClone(value),
    runId: initialLedger.runId,
    bindings: initialLedger.bindings,
    provenance: initialLedger.provenance,
    identityBaseline: initialLedger.identityBaseline,
    admissionEvidenceDigest: initialLedger.admission.evidenceDigest,
    preCallReplayLedgerDigest: initialLedger.admission.replayLedgerDigest,
    initialExecutionLedgerDigest: initialLedger.transitionDigest
  });
}

function recordDispatch(ledger, runManifest, value) {
  validateExecutionLedger(ledger);
  const expectedSlot = ledger.stage === STAGES.A_READY ? 'A' : ledger.stage === STAGES.A_RECONCILED_B_PENDING ? 'B' : null;
  if (!expectedSlot || !exactFields(value, ['slot', 'generationId', 'sessionGeneration', 'jti', 'attemptId',
    'browserContextDigest', 'runtimeInstanceDigest', 'sessionGenerationDigest', 'committedAt']) || value.slot !== expectedSlot ||
    !UUID_V4.test(value.generationId || '') || !Number.isSafeInteger(value.sessionGeneration) ||
    value.sessionGeneration < 0 ||
    !UUID_V4.test(value.jti || '') || !UUID_V4.test(value.attemptId || '') || !HASH.test(value.browserContextDigest || '') ||
    !HASH.test(value.runtimeInstanceDigest || '') || !HASH.test(value.sessionGenerationDigest || '') ||
    !validTimestamp(value.committedAt)) fail('group_e_dispatch_invalid');
  const run = validateRunManifest(runManifest, { now: Date.parse(value.committedAt) });
  if (run.initialExecutionLedgerDigest !== (ledger.sequence === 0 ? ledger.transitionDigest : run.initialExecutionLedgerDigest) ||
      !sameJson(run.bindings, ledger.bindings) || !sameJson(run.provenance, ledger.provenance) ||
      (ledger.runManifestDigest && ledger.runManifestDigest !== run.manifestDigest)) fail('group_e_run_ledger_mismatch');
  const sessionContext = {
    environment: run.environment,
    projectId: run.projectId,
    cohortDigest: run.cohortDigest,
    firebaseAppIdHash: run.firebaseAppIdHash
  };
  if (ledger.sessionContext && !sameJson(ledger.sessionContext, sessionContext)) fail('group_e_run_ledger_mismatch');
  const dispatch = {
    slot: value.slot,
    generationId: value.generationId,
    sessionGeneration: value.sessionGeneration,
    jtiHash: jtiHash(value.jti),
    attemptHash: attemptHash(value.attemptId),
    browserContextDigest: value.browserContextDigest,
    runtimeInstanceDigest: value.runtimeInstanceDigest,
    sessionGenerationDigest: value.sessionGenerationDigest,
    committedAt: value.committedAt
  };
  const contextLedger = { ...ledger, sessionContext };
  if (dispatch.sessionGenerationDigest !== sessionGenerationDigest(
    dispatchSessionGenerationContext(contextLedger, dispatch)
  )) fail('group_e_dispatch_session_mismatch');
  if (value.slot === 'B' && !sameJson(dispatchSessionGenerationContext(contextLedger, dispatch),
    Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, ledger.sessionBoundary.after[field]])))) {
    fail('group_e_dispatch_session_mismatch');
  }
  return seal({ ...structuredClone(ledger), runManifestDigest: run.manifestDigest, sessionContext,
    stage: value.slot === 'A' ? STAGES.A_DISPATCH_COMMITTED : STAGES.B_DISPATCH_COMMITTED,
    dispatches: { ...ledger.dispatches, [value.slot]: dispatch }, gates: groupEActivationGatePlan(),
    updatedAt: value.committedAt }, ledger);
}

function createSignedSlotCapability(ledger, runManifest, value, privateKey) {
  validateExecutionLedger(ledger);
  if (!exactFields(value, ['slot', 'jti', 'attemptId', 'expiresAt']) ||
      ![STAGES.A_DISPATCH_COMMITTED, STAGES.B_DISPATCH_COMMITTED].includes(ledger.stage) ||
      value.slot !== (ledger.stage === STAGES.A_DISPATCH_COMMITTED ? 'A' : 'B')) fail('group_e_capability_stage_invalid');
  const run = validateRunManifest(runManifest);
  const dispatch = ledger.dispatches[value.slot];
  if (ledger.runManifestDigest !== run.manifestDigest || jtiHash(value.jti) !== dispatch.jtiHash ||
      attemptHash(value.attemptId) !== dispatch.attemptHash || !validTimestamp(value.expiresAt)) {
    fail('group_e_capability_dispatch_mismatch');
  }
  const binding = run.bindings[value.slot];
  const provenance = run.provenance;
  const capability = {
    schemaVersion: 1,
    recordType: 'group-e-slot-capability',
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: ledger.runId,
    slot: value.slot,
    jti: value.jti,
    uidHash: binding.uidHash,
    trainerHash: binding.trainerHash,
    cohortDigest: run.cohortDigest,
    generationId: dispatch.generationId,
    sessionGeneration: dispatch.sessionGeneration,
    attemptHash: dispatch.attemptHash,
    firebaseAppIdHash: run.firebaseAppIdHash,
    browserContextDigest: dispatch.browserContextDigest,
    runtimeInstanceDigest: dispatch.runtimeInstanceDigest,
    sessionGenerationDigest: dispatch.sessionGenerationDigest,
    toolingSourceSha: provenance.toolingSourceSha,
    pagesReleaseId: provenance.pagesReleaseId,
    pagesSourceSha: provenance.pagesSourceSha,
    pagesArtifactDigest: provenance.pagesArtifactDigest,
    gatewaySourceSha: provenance.gatewaySourceSha,
    gatewaySourceFingerprint: provenance.gatewaySourceFingerprint,
    authorityRevision: provenance.authorityRevision,
    authorityImageDigest: provenance.authorityImageDigest,
    d3CloseoutDigest: run.d3CloseoutDigest,
    identityBaselineDigest: baselineDigest(run.identityBaseline),
    admissionEvidenceDigest: run.admissionEvidenceDigest,
    preCallReplayLedgerDigest: run.preCallReplayLedgerDigest,
    dispatchLedgerDigest: ledger.transitionDigest,
    issuedAt: dispatch.committedAt,
    expiresAt: value.expiresAt,
    remainingAdmittedCallBudget: value.slot === 'A' ? 2 : 1,
    runManifestDigest: run.manifestDigest,
    keyId: run.keyId,
    priorAReconciliationDigest: value.slot === 'A' ? null : ledger.reconciliations.A.reconciliationDigest,
    sessionBoundaryDigest: value.slot === 'A' ? null : ledger.sessionBoundaryDigest
  };
  const acceptedCapability = validateCapabilityShape(capability);
  let signingKey;
  try { signingKey = crypto.createPrivateKey(privateKey); }
  catch { fail('group_e_signing_key_invalid'); }
  if (signingKey.asymmetricKeyType !== 'ed25519') fail('group_e_signing_key_invalid');
  const signature = crypto.sign(null, canonicalCapabilityBytes(acceptedCapability), signingKey).toString('base64url');
  return Object.freeze({
    schemaVersion: 1,
    capability: Object.freeze(capability),
    signature,
    publicKeySpki: run.publicKeySpki,
    capabilityDigest: capabilityDigest(capability)
  });
}

function commitDispatchAndCreateCapability(directory, expectedPriorDigest, runManifest, dispatch, capability, privateKey,
  options = {}) {
  const run = validateRunManifest(runManifest, { now: Date.parse(dispatch?.committedAt) });
  const issued = Date.parse(dispatch?.committedAt);
  const expires = Date.parse(capability?.expiresAt);
  if (!exactFields(capability, ['slot', 'jti', 'attemptId', 'expiresAt']) || capability.slot !== dispatch?.slot ||
      capability.jti !== dispatch?.jti || capability.attemptId !== dispatch?.attemptId || !Number.isFinite(issued) ||
      !Number.isFinite(expires) || issued >= expires || expires - issued > 15 * 60 * 1000) {
    fail('group_e_capability_dispatch_mismatch');
  }
  if (options.mode !== 'plan') {
    let signingKey;
    try { signingKey = crypto.createPrivateKey(privateKey); }
    catch { fail('group_e_signing_key_invalid'); }
    if (signingKey.asymmetricKeyType !== 'ed25519' ||
        crypto.createPublicKey(signingKey).export({ format: 'der', type: 'spki' }).toString('base64url') !== run.publicKeySpki) {
      fail('group_e_signing_key_invalid');
    }
  }
  const result = applyLedgerTransition(directory, expectedPriorDigest,
    (ledger) => recordDispatch(ledger, run, dispatch), options);
  if (!result.written) return Object.freeze({ written: false, ledger: result.ledger, capability: null });
  const envelope = createSignedSlotCapability(result.ledger, run, capability, privateKey);
  return Object.freeze({ written: true, ledger: result.ledger, capability: envelope });
}

function recordTerminalAttempt(ledger, value) {
  validateExecutionLedger(ledger);
  const slot = ledger.stage === STAGES.A_DISPATCH_COMMITTED ? 'A' : ledger.stage === STAGES.B_DISPATCH_COMMITTED ? 'B' : null;
  if (!slot || !validTerminal(value, slot)) fail('group_e_terminal_invalid');
  return seal({ ...structuredClone(ledger), stage: slot === 'A' ? STAGES.A_TERMINAL_UNRECONCILED :
    STAGES.B_TERMINAL_UNRECONCILED, terminals: { ...ledger.terminals, [slot]: structuredClone(value) },
    updatedAt: value.observedAt }, ledger);
}

function recordAReconciliationEvidence(ledger, value) {
  validateExecutionLedger(ledger, { requireStage: STAGES.A_TERMINAL_UNRECONCILED });
  if (!validReconciliationEvidence(value, 'A') || value.admissionReceiptDigest !== ledger.terminals.A.admissionReceiptDigest) {
    fail('group_e_reconciliation_evidence_invalid');
  }
  return seal({ ...structuredClone(ledger), stage: STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING,
    pendingAReconciliation: structuredClone(value), updatedAt: value.createdAt }, ledger);
}

function recordSessionBoundary(ledger, boundary, options = {}) {
  validateExecutionLedger(ledger, { requireStage: STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING });
  const evidence = ledger.pendingAReconciliation;
  const record = aReconciliationRecord(ledger, evidence);
  const accepted = { ...structuredClone(boundary), boundaryDigest: boundary?.boundaryDigest || null };
  if (accepted.boundaryDigest === null) accepted.boundaryDigest = sessionBoundaryDigest(accepted);
  if (!validSessionBoundary(accepted, ledger) || options.controlRecordCreated !== true) {
    fail('group_e_session_boundary_invalid');
  }
  return seal({ ...structuredClone(ledger), stage: STAGES.A_RECONCILED_B_PENDING, completedPrefix: ['A'],
    remainingAdmittedBudget: 1, pendingAReconciliation: null, reconciliations: { A: record, B: null },
    sessionBoundary: accepted, sessionBoundaryDigest: accepted.boundaryDigest, updatedAt: accepted.verifiedAt }, ledger);
}

function recordBReconciliation(ledger, value, options = {}) {
  validateExecutionLedger(ledger, { requireStage: STAGES.B_TERMINAL_UNRECONCILED });
  if (!validReconciliationEvidence(value, 'B') || value.admissionReceiptDigest !== ledger.terminals.B.admissionReceiptDigest ||
      options.controlRecordCreated !== true) fail('group_e_reconciliation_evidence_invalid');
  const record = createReconciliationRecord({
    runId: ledger.runId,
    slot: 'B',
    ...structuredClone(value),
    identityBaselineDigest: baselineDigest(ledger.identityBaseline),
    remainingAdmittedCallBudget: 0,
    priorAReconciliationDigest: ledger.reconciliations.A.reconciliationDigest,
    sessionBoundaryDigest: ledger.sessionBoundaryDigest
  });
  return seal({ ...structuredClone(ledger), stage: STAGES.AB_RECONCILED_RESTORATION_REQUIRED,
    completedPrefix: ['A', 'B'], remainingAdmittedBudget: 0,
    reconciliations: { A: ledger.reconciliations.A, B: record }, updatedAt: value.createdAt }, ledger);
}

function blockLedger(ledger, reason, recordedAt) {
  validateExecutionLedger(ledger);
  if (!POST_ENABLE_STAGES.includes(ledger.stage) || !BLOCK_REASONS.has(reason) || !validTimestamp(recordedAt)) {
    fail('group_e_block_invalid');
  }
  return seal({ ...structuredClone(ledger), stage: STAGES.BLOCKED_RESTORATION_REQUIRED, outcome: 'blocked',
    pendingAReconciliation: null, blockedReason: reason, updatedAt: recordedAt }, ledger);
}

function recordCapabilityDeliveryUncertain(ledger, recordedAt) {
  if (![STAGES.A_DISPATCH_COMMITTED, STAGES.B_DISPATCH_COMMITTED].includes(ledger.stage)) {
    fail('group_e_capability_delivery_state_invalid');
  }
  return blockLedger(ledger, 'CAPABILITY_DELIVERY_UNCERTAIN', recordedAt);
}

function recordRuntimeInstanceLoss(ledger, recordedAt) {
  validateExecutionLedger(ledger);
  if (![STAGES.A_TERMINAL_UNRECONCILED, STAGES.A_RECONCILED_SESSION_BOUNDARY_PENDING,
    STAGES.A_RECONCILED_B_PENDING].includes(ledger.stage)) fail('group_e_runtime_instance_loss_invalid');
  return blockLedger(ledger, 'RUNTIME_INSTANCE_LOST', recordedAt);
}

function recordRestoration(ledger, value) {
  validateExecutionLedger(ledger);
  if (!POST_ENABLE_STAGES.includes(ledger.stage) || !exactFields(value, ['verifiedAt', 'gates', 'identityBaseline',
    'prohibitedWrites', 'securityBoundary', 'blockedReason']) || !validTimestamp(value.verifiedAt) ||
    !sameJson(value.gates, disabledGatePlan()) || !sameJson(value.identityBaseline, IDENTITY_BASELINE) ||
    !sameJson(value.prohibitedWrites, ZERO_WRITES) || !sameJson(value.securityBoundary, SECURITY_BOUNDARY)) {
    fail('group_e_restoration_invalid');
  }
  const successful = ledger.stage === STAGES.AB_RECONCILED_RESTORATION_REQUIRED;
  const blockedReason = successful ? null : ledger.blockedReason || value.blockedReason;
  if (!successful && !BLOCK_REASONS.has(blockedReason)) fail('group_e_restoration_invalid');
  return seal({ ...structuredClone(ledger), stage: STAGES.RESTORED_OBSERVATION_PENDING,
    pendingAReconciliation: null, gates: disabledGatePlan(), outcome: successful ? 'pending' : 'blocked', blockedReason,
    updatedAt: value.verifiedAt }, ledger);
}

function recordObservationCloseout(ledger, value) {
  validateExecutionLedger(ledger, { requireStage: STAGES.RESTORED_OBSERVATION_PENDING });
  if (!exactFields(value, ['acceptedAt', 'observationDigest', 'restorationDigest', 'finalStateDigest',
    'observationStartedAt', 'observationEndedAt', 'unexpectedAdditionalAdmittedCalls', 'prohibitedWrites',
    'controlRecordCreated']) || value.controlRecordCreated !== true ||
    !validTimestamp(value.acceptedAt) || !validTimestamp(value.observationStartedAt) ||
    !validTimestamp(value.observationEndedAt) ||
    !HASH.test(value.observationDigest || '') || !HASH.test(value.restorationDigest || '') ||
    value.finalStateDigest !== IDENTITY_BASELINE.stateDigest || value.unexpectedAdditionalAdmittedCalls !== 0 ||
    !sameJson(value.prohibitedWrites, ZERO_WRITES)) fail('group_e_observation_closeout_invalid');
  const started = Date.parse(value.observationStartedAt);
  const ended = Date.parse(value.observationEndedAt);
  const accepted = Date.parse(value.acceptedAt);
  if (started < Date.parse(ledger.updatedAt) || ended - started < MIN_PASSIVE_OBSERVATION_MS ||
      ended - started > MAX_PASSIVE_OBSERVATION_MS || accepted < ended) {
    fail('group_e_observation_closeout_invalid');
  }
  const outcome = ledger.outcome === 'blocked' ? 'blocked' : 'healthy';
  const closeout = createFinalCloseout({
    runId: ledger.runId,
    outcome,
    bReconciliationDigest: ledger.reconciliations.B?.reconciliationDigest || null,
    blockedReason: outcome === 'blocked' ? ledger.blockedReason : null,
    restorationDigest: value.restorationDigest,
    finalStateDigest: value.finalStateDigest,
    observationDigest: value.observationDigest,
    observationStartedAt: value.observationStartedAt,
    observationEndedAt: value.observationEndedAt,
    observationAccepted: true,
    unexpectedAdditionalAdmittedCalls: 0,
    prohibitedWrites: ZERO_WRITES,
    createdAt: value.acceptedAt
  });
  const closed = seal({ ...structuredClone(ledger), stage: outcome === 'healthy' ? STAGES.CLOSED_HEALTHY : STAGES.CLOSED_BLOCKED,
    outcome, updatedAt: value.acceptedAt }, ledger);
  return Object.freeze({ ledger: closed, closeout: Object.freeze(closeout) });
}

function snapshotFileName(ledger) {
  return `${String(ledger.sequence).padStart(6, '0')}-${ledger.transitionDigest}.json`;
}

function mode(file) {
  try { return fs.statSync(file).mode & 0o777; } catch { return null; }
}

function readJson(file, errorCode) {
  if (mode(file) !== 0o600) fail(errorCode);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(errorCode); }
}

function fsyncPath(target) {
  let descriptor;
  try { descriptor = fs.openSync(target, fs.constants.O_RDONLY); fs.fsyncSync(descriptor); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(error.code)) throw error; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writeFileExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.chmodSync(file, 0o600);
}

function writeHeadAtomic(directory, head) {
  const temporary = path.join(directory, `.HEAD.${process.pid}.${Date.now()}.tmp`);
  writeFileExclusive(temporary, head);
  fs.renameSync(temporary, path.join(directory, 'HEAD.json'));
  fs.chmodSync(path.join(directory, 'HEAD.json'), 0o600);
  fsyncPath(path.join(directory, 'HEAD.json'));
  fsyncPath(directory);
}

function acquireLock(directory) {
  const lock = path.join(directory, 'LOCK');
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('group_e_ledger_lock_contended'); throw error; }
  fs.writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, host: os.hostname() })}\n`, 'utf8');
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  fsyncPath(directory);
  return () => { fs.unlinkSync(lock); fsyncPath(directory); };
}

function validateLedgerDirectory(directory = PRIVATE_EXECUTION_LEDGER_PATH) {
  if (mode(directory) !== 0o700 || mode(path.join(directory, 'snapshots')) !== 0o700) fail('group_e_ledger_directory_invalid');
  const allowed = new Set(['HEAD.json', 'LOCK', 'snapshots']);
  if (fs.readdirSync(directory).some((entry) => !allowed.has(entry))) fail('group_e_ledger_orphan_history');
  const head = readJson(path.join(directory, 'HEAD.json'), 'group_e_ledger_head_invalid');
  if (!exactFields(head, HEAD_FIELDS) || head.schemaVersion !== 1 || !Number.isSafeInteger(head.sequence) ||
      head.sequence < 0 || !HASH.test(head.transitionDigest || '') ||
      head.snapshotFile !== `${String(head.sequence).padStart(6, '0')}-${head.transitionDigest}.json`) {
    fail('group_e_ledger_head_invalid');
  }
  const files = fs.readdirSync(path.join(directory, 'snapshots')).sort();
  if (files.length !== head.sequence + 1) fail('group_e_ledger_orphan_history');
  let prior = null;
  const snapshots = files.map((file, index) => {
    const match = /^(\d{6})-([a-f0-9]{64})\.json$/u.exec(file);
    if (!match || Number(match[1]) !== index) fail('group_e_ledger_fork_or_gap');
    const snapshot = readJson(path.join(directory, 'snapshots', file), 'group_e_ledger_snapshot_invalid');
    validateExecutionLedger(snapshot);
    if (snapshot.sequence !== index || snapshot.transitionDigest !== match[2] ||
        (prior ? snapshot.priorTransitionDigest !== prior.transitionDigest : snapshot.priorTransitionDigest !== null)) {
      fail('group_e_ledger_rewind_or_fork');
    }
    if (prior) validateMonotonicTransition(prior, snapshot);
    prior = snapshot;
    return snapshot;
  });
  const latest = snapshots.at(-1);
  if (!latest || latest.sequence !== head.sequence || latest.transitionDigest !== head.transitionDigest ||
      head.snapshotFile !== files.at(-1)) fail('group_e_ledger_head_invalid');
  return Object.freeze({ head: Object.freeze(head), latest, snapshots: Object.freeze(snapshots) });
}

function initializeLedgerDirectory(directory, ledger, options = {}) {
  validateExecutionLedger(ledger, { requirePristine: true });
  if (options.mode === 'plan') return Object.freeze({ written: false, ledger });
  if (fs.existsSync(directory)) fail('group_e_ledger_exists');
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.mkdirSync(path.join(directory, 'snapshots'), { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  fs.chmodSync(path.join(directory, 'snapshots'), 0o700);
  const release = acquireLock(directory);
  try {
    const file = snapshotFileName(ledger);
    writeFileExclusive(path.join(directory, 'snapshots', file), ledger);
    fsyncPath(path.join(directory, 'snapshots'));
    writeHeadAtomic(directory, { schemaVersion: 1, sequence: ledger.sequence, snapshotFile: file,
      transitionDigest: ledger.transitionDigest });
  } finally { release(); }
  return Object.freeze({ written: true, ledger });
}

function applyLedgerTransition(directory, expectedPriorDigest, advance, options = {}) {
  if (options.mode === 'plan') {
    const current = validateLedgerDirectory(directory).latest;
    if (current.transitionDigest !== expectedPriorDigest) fail('group_e_ledger_stale_writer');
    return Object.freeze({ written: false, ledger: advance(current) });
  }
  const release = acquireLock(directory);
  try {
    const current = validateLedgerDirectory(directory).latest;
    if (current.transitionDigest !== expectedPriorDigest) fail('group_e_ledger_stale_writer');
    const next = advance(current);
    validateMonotonicTransition(current, next);
    const file = snapshotFileName(next);
    writeFileExclusive(path.join(directory, 'snapshots', file), next);
    fsyncPath(path.join(directory, 'snapshots'));
    writeHeadAtomic(directory, { schemaVersion: 1, sequence: next.sequence, snapshotFile: file,
      transitionDigest: next.transitionDigest });
    return Object.freeze({ written: true, ledger: next });
  } finally { release(); }
}

module.exports = Object.freeze({
  BLOCK_REASONS,
  ALLOWED_STAGE_TRANSITIONS,
  D3_CLOSEOUT,
  IDENTITY_BASELINE,
  NEXT_ACTION,
  POST_ENABLE_STAGES,
  PRIVATE_EXECUTION_LEDGER_PATH,
  PURPOSE,
  SCHEMA_VERSION,
  SECURITY_BOUNDARY,
  STAGES,
  ZERO_WRITES,
  applyLedgerTransition,
  blockLedger,
  canonicalLedgerDigest,
  createExecutionRunManifest,
  createInitialExecutionLedger,
  commitDispatchAndCreateCapability,
  dispatchSessionGenerationContext,
  executionDispatchDigest,
  groupEActivationGatePlan,
  initializeLedgerDirectory,
  provenanceDigest,
  recordAReconciliationEvidence,
  recordBReconciliation,
  recordCapabilityDeliveryUncertain,
  recordDispatch,
  recordObservationCloseout,
  recordRestoration,
  recordRuntimeInstanceLoss,
  recordSessionBoundary,
  recordTerminalAttempt,
  sessionBoundaryDigest,
  unconditionalRestorationPlan,
  validateExecutionLedger,
  validateLedgerDirectory,
  validateMonotonicTransition
});
