'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ALLOWED_STAGE_TRANSITIONS,
  IDENTITY_BASELINE,
  POST_ENABLE_STAGES,
  SECURITY_BOUNDARY,
  STAGES,
  ZERO_WRITES,
  applyLedgerTransition,
  blockLedger,
  canonicalLedgerDigest,
  commitDispatchAndCreateCapability,
  createExecutionRunManifest,
  createInitialExecutionLedger,
  createSignedSlotCapability,
  dispatchSessionGenerationContext,
  executionDispatchDigest,
  groupEActivationGatePlan,
  initializeLedgerDirectory,
  recordAReconciliationEvidence,
  recordBReconciliation,
  recordCapabilityDeliveryUncertain,
  recordDispatch,
  recordEnablementStarted,
  recordObservationCloseout,
  recordPreEnableAbort,
  recordRestoration,
  recordRuntimeInstanceLoss,
  recordSessionBoundary,
  recordTerminalAttempt,
  sessionBoundaryDigest,
  unconditionalRestorationPlan,
  validateExecutionLedger,
  validateLedgerDirectory,
  validateMonotonicTransition
} = require('../production/e1ProductionClientFoundationExecution.cjs');
const { disabledGatePlan } = require('../production/e1ProductionFirstMutationGuard.cjs');
const {
  SESSION_GENERATION_FIELDS,
  baselineDigest,
  createReconciliationRecord,
  createPreEnableAbort,
  sessionGenerationDigest
} = require('../e1-gateway/groupEAdmission');
const { jitDigest } = require('../production/e1ProductionClientFoundationGuard.cjs');
const { assertNoSensitiveMaterial, run } = require('../scripts/check-e1-production-client-foundation-execution.cjs');
const { createFixture } = require('./helpers/groupEFixture.cjs');

const TIMES = Object.freeze({
  initial: '2030-01-01T12:00:00.000Z', enable: '2030-01-01T12:04:00.000Z', dispatchA: '2030-01-01T12:05:00.000Z',
  terminalA: '2030-01-01T12:06:00.000Z', reconcileA: '2030-01-01T12:07:00.000Z',
  boundary: '2030-01-01T12:08:00.000Z', dispatchB: '2030-01-01T12:09:00.000Z',
  terminalB: '2030-01-01T12:10:00.000Z', reconcileB: '2030-01-01T12:11:00.000Z',
  restore: '2030-01-01T12:12:00.000Z', observationStart: '2030-01-01T12:13:00.000Z',
  observationEnd: '2030-01-01T12:43:00.000Z', close: '2030-01-01T12:44:00.000Z'
});

function state() {
  const fixture = createFixture();
  const jit = {
    approvedAt: '2030-01-01T12:03:00.000Z', expiresAt: '2030-01-01T12:18:00.000Z',
    cohortDigest: fixture.cohortDigest, evidenceDigest: '2'.repeat(64), replayLedgerDigest: '3'.repeat(64),
    activationWindowStart: '2030-01-01T12:03:00.000Z', activationWindowEnd: '2030-01-01T12:30:00.000Z',
    confirmation: 'ENABLE E1 GROUP E CLIENT FOUNDATION CANARY', humanOperatorPresent: true,
    restorationOwnerPresent: true
  };
  const initialInput = { runId: fixture.RUN_ID, bindings: fixture.bindings, provenance: fixture.PROVENANCE,
    admission: { evidenceDigest: '2'.repeat(64), replayLedgerDigest: '3'.repeat(64), jitDigest: jitDigest(jit) },
    createdAt: TIMES.initial };
  const initial = createInitialExecutionLedger(initialInput);
  const runManifest = createExecutionRunManifest(initial, {
    cohortDigest: fixture.cohortDigest,
    firebaseAppIdHash: fixture.run.firebaseAppIdHash,
    publicKeySpki: fixture.publicKeySpki,
    d3CloseoutDigest: fixture.run.d3CloseoutDigest,
    issuedAt: TIMES.initial,
    expiresAt: '2030-01-01T12:30:00.000Z'
  });
  const started = recordEnablementStarted(initial, runManifest, { startedAt: TIMES.enable, jit });
  const dispatch = (slot, overrides = {}) => {
    const capability = fixture.capability(slot, Object.fromEntries([
      'generationId', 'sessionGeneration', 'browserContextDigest', 'runtimeInstanceDigest', 'sessionGenerationDigest'
    ].filter((field) => field in overrides).map((field) => [field, overrides[field]])));
    return { slot, generationId: capability.generationId, sessionGeneration: capability.sessionGeneration,
      jti: fixture.JTI[slot], attemptId: fixture.ATTEMPT[slot], browserContextDigest: capability.browserContextDigest,
      runtimeInstanceDigest: capability.runtimeInstanceDigest, sessionGenerationDigest: capability.sessionGenerationDigest,
      committedAt: slot === 'A' ? TIMES.dispatchA : TIMES.dispatchB, ...overrides };
  };
  const capability = (slot) => ({ slot, jti: fixture.JTI[slot], attemptId: fixture.ATTEMPT[slot],
    expiresAt: slot === 'A' ? '2030-01-01T12:15:00.000Z' : '2030-01-01T12:19:00.000Z' });
  const terminal = (slot) => ({ slot, clientOutcome: 'SUCCESS', callableBoundaryCrossed: true,
    admissionReceiptDigest: slot === 'A' ? 'b'.repeat(64) : 'c'.repeat(64),
    responseDigest: slot === 'A' ? 'd'.repeat(64) : 'e'.repeat(64),
    observedAt: slot === 'A' ? TIMES.terminalA : TIMES.terminalB });
  const evidence = (slot) => ({
    slot,
    consumptionRecordDigest: slot === 'A' ? 'f'.repeat(64) : '0'.repeat(64),
    admissionReceiptDigest: terminal(slot).admissionReceiptDigest,
    gatewayRecordDigest: slot === 'A' ? '1'.repeat(64) : '2'.repeat(64),
    authorityRecordDigest: slot === 'A' ? '3'.repeat(64) : '4'.repeat(64),
    responseDigest: terminal(slot).responseDigest,
    resultDigest: slot === 'A' ? '5'.repeat(64) : '6'.repeat(64),
    resultCode: 'SUCCESS',
    foundationStatus: 'active',
    familyCounts: { totalDocuments: 32, accounts: 8, trainerHandles: 8, rateLimits: 8,
      operationRequests: 8, identityMigrations: 0, identityConflicts: 0 },
    prohibitedWrites: ZERO_WRITES,
    gates: groupEActivationGatePlan(),
    securityBoundary: SECURITY_BOUNDARY,
    runtimeDigest: slot === 'A' ? '7'.repeat(64) : '8'.repeat(64),
    createdAt: slot === 'A' ? TIMES.reconcileA : TIMES.reconcileB
  });
  const boundary = (ledger, overrides = {}) => {
    const afterDispatch = dispatch('B');
    const before = { ...dispatchSessionGenerationContext(ledger, ledger.dispatches.A),
      sessionGenerationDigest: ledger.dispatches.A.sessionGenerationDigest };
    const after = { ...dispatchSessionGenerationContext(ledger, afterDispatch),
      sessionGenerationDigest: afterDispatch.sessionGenerationDigest };
    const aReconciliation = createReconciliationRecord({
      runId: ledger.runId, slot: 'A', ...evidence('A'), identityBaselineDigest: baselineDigest(ledger.identityBaseline),
      remainingAdmittedCallBudget: 1,
      priorAReconciliationDigest: null, sessionBoundaryDigest: null
    });
    return { schemaVersion: 1, aDispatchDigest: executionDispatchDigest(ledger, ledger.dispatches.A),
      aReconciliationDigest: aReconciliation.reconciliationDigest, aControllerTerminal: true,
      aControllerClosed: true, aInMemoryResultCleared: true, signOutVerified: true, before, after,
      verifiedAt: TIMES.boundary, boundaryDigest: null, ...overrides };
  };
  return { fixture, initialInput, initial, started, jit, runManifest, dispatch, capability, terminal, evidence, boundary };
}

function healthyChain() {
  const value = state();
  const aDispatch = recordDispatch(value.started, value.runManifest, value.dispatch('A'));
  const aTerminal = recordTerminalAttempt(aDispatch, value.terminal('A'));
  const aEvidence = recordAReconciliationEvidence(aTerminal, value.evidence('A'));
  const aComplete = recordSessionBoundary(aEvidence, value.boundary(aEvidence), { controlRecordCreated: true });
  const bDispatch = recordDispatch(aComplete, value.runManifest, value.dispatch('B'));
  const bTerminal = recordTerminalAttempt(bDispatch, value.terminal('B'));
  const abComplete = recordBReconciliation(bTerminal, value.evidence('B'), { controlRecordCreated: true });
  return { ...value, aDispatch, aTerminal, aEvidence, aComplete, bDispatch, bTerminal, abComplete };
}

function pendingBoundaryState() {
  const value = state();
  const aDispatch = recordDispatch(value.started, value.runManifest, value.dispatch('A'));
  const aTerminal = recordTerminalAttempt(aDispatch, value.terminal('A'));
  const aEvidence = recordAReconciliationEvidence(aTerminal, value.evidence('A'));
  const boundary = value.boundary(aEvidence);
  return { ...value, aDispatch, aTerminal, aEvidence, boundary };
}

function restorationInput(blockedReason = null, verifiedAt = TIMES.restore) {
  return { verifiedAt, gates: disabledGatePlan(), identityBaseline: IDENTITY_BASELINE,
    prohibitedWrites: ZERO_WRITES, securityBoundary: SECURITY_BOUNDARY, blockedReason };
}

function tempLedger(initial) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-e-ledger-'));
  const directory = path.join(root, 'ledger');
  initializeLedgerDirectory(directory, initial, { mode: 'apply' });
  return directory;
}

function removeTempLedger(directory) {
  fs.rmSync(path.dirname(directory), { recursive: true, force: true });
}

function persistEnablementStart(directory, value) {
  return applyLedgerTransition(directory, value.initial.transitionDigest,
    (ledger) => recordEnablementStarted(ledger, value.runManifest, { startedAt: TIMES.enable, jit: value.jit }),
    { mode: 'apply' }).ledger;
}

function writePrivateJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function resealBoundary(value) {
  const boundary = structuredClone(value);
  boundary.boundaryDigest = sessionBoundaryDigest(boundary);
  return boundary;
}

function mutateBoundarySession(value, side, changes, options = {}) {
  const boundary = structuredClone(value);
  boundary[side] = { ...boundary[side], ...changes };
  if (options.recomputeSessionDigest !== false) {
    const context = Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, boundary[side][field]]));
    boundary[side].sessionGenerationDigest = sessionGenerationDigest(context);
  }
  return resealBoundary(boundary);
}

test('ledger follows exact A/B sequence, budget, dependencies, restoration, and passive observation', () => {
  const chain = healthyChain();
  assert.deepEqual(validateExecutionLedger(chain.initial, { requirePristine: true }).completedPrefix, []);
  assert.equal(chain.aDispatch.stage, STAGES.A_DISPATCH_COMMITTED);
  assert.equal(chain.aComplete.stage, STAGES.A_RECONCILED_B_PENDING);
  assert.deepEqual(chain.aComplete.completedPrefix, ['A']);
  assert.equal(chain.aComplete.remainingAdmittedBudget, 1);
  assert.equal(chain.bDispatch.dispatches.B.generationId, chain.fixture.GENERATION.B);
  assert.equal(chain.abComplete.reconciliations.B.priorAReconciliationDigest,
    chain.aComplete.reconciliations.A.reconciliationDigest);
  assert.deepEqual(chain.abComplete.completedPrefix, ['A', 'B']);
  assert.equal(chain.abComplete.remainingAdmittedBudget, 0);
  const restored = recordRestoration(chain.abComplete, restorationInput());
  assert.equal(restored.stage, STAGES.RESTORED_OBSERVATION_PENDING);
  assert.deepEqual(restored.gates, disabledGatePlan());
  const closed = recordObservationCloseout(restored, { acceptedAt: TIMES.close, observationDigest: '9'.repeat(64),
    restorationDigest: 'a'.repeat(64), finalStateDigest: IDENTITY_BASELINE.stateDigest,
    observationStartedAt: TIMES.observationStart, observationEndedAt: TIMES.observationEnd,
    unexpectedAdditionalAdmittedCalls: 0, prohibitedWrites: ZERO_WRITES, controlRecordCreated: true });
  assert.equal(closed.ledger.stage, STAGES.CLOSED_HEALTHY);
  assert.equal(closed.closeout.observationAccepted, true);
  assert.equal(closed.closeout.bReconciliationDigest, chain.abComplete.reconciliations.B.reconciliationDigest);
});

test('fresh JIT commits one durable enablement start while the 45-minute run controls continuation', () => {
  const value = state();
  assert.equal(value.started.stage, STAGES.ENABLEMENT_STARTED);
  assert.equal(value.started.priorTransitionDigest, value.initial.transitionDigest);
  assert.equal(value.started.runManifestDigest, value.runManifest.manifestDigest);
  assert.deepEqual(value.started.gates, disabledGatePlan());
  assert.throws(() => recordDispatch(value.initial, value.runManifest, value.dispatch('A')),
    /group_e_dispatch_invalid/);
  assert.throws(() => recordEnablementStarted(value.initial, value.runManifest,
    { startedAt: value.jit.expiresAt, jit: value.jit }), /group_e_enablement_start_invalid/);
  assert.throws(() => recordEnablementStarted(value.started, value.runManifest,
    { startedAt: TIMES.enable, jit: value.jit }), /group_e_execution_not_pristine/);

  const lateDispatch = value.dispatch('A', { committedAt: '2030-01-01T12:20:00.000Z' });
  const late = recordDispatch(value.started, value.runManifest, lateDispatch);
  assert.equal(late.stage, STAGES.A_DISPATCH_COMMITTED);
  const envelope = createSignedSlotCapability(late, value.runManifest, {
    slot: 'A', jti: value.fixture.JTI.A, attemptId: value.fixture.ATTEMPT.A,
    expiresAt: '2030-01-01T12:30:00.000Z'
  }, value.fixture.privateKeyPem);
  assert.equal(Date.parse(envelope.capability.expiresAt) - Date.parse(envelope.capability.issuedAt), 10 * 60 * 1000);
  assert.throws(() => recordDispatch(value.started, value.runManifest,
    value.dispatch('A', { committedAt: '2030-01-01T12:30:00.000Z' })), /GROUP_E_RUN_EXPIRED/);
  const restored = recordRestoration(value.started,
    restorationInput('OPERATOR_CONTAINMENT', '2030-01-01T12:20:00.000Z'));
  assert.equal(restored.stage, STAGES.RESTORED_OBSERVATION_PENDING);
  assert.deepEqual(restored.gates, disabledGatePlan());
});

test('pristine pre-enable abort is terminal, zero-budget, and cannot dispatch either slot', () => {
  const value = state();
  const record = createPreEnableAbort({
    runId: value.initial.runId,
    runManifestDigest: value.runManifest.manifestDigest,
    executionLedgerDigest: value.initial.transitionDigest,
    reason: 'TIMING_EXPIRED_BEFORE_ENABLEMENT',
    gates: disabledGatePlan(),
    prohibitedWrites: ZERO_WRITES,
    aDispatchAbsent: true,
    consumptionsAbsent: true,
    reconciliationsAbsent: true,
    createdAt: '2030-01-01T12:19:00.000Z'
  });
  const aborted = recordPreEnableAbort(value.initial, value.runManifest, record, { controlRecordCreated: true });
  assert.equal(aborted.stage, STAGES.PRE_ENABLE_ABORTED);
  assert.equal(aborted.outcome, 'blocked');
  assert.equal(aborted.blockedReason, 'TIMING_EXPIRED_BEFORE_ENABLEMENT');
  assert.equal(aborted.remainingAdmittedBudget, 0);
  assert.deepEqual(aborted.gates, disabledGatePlan());
  assert.throws(() => recordDispatch(aborted, value.runManifest, value.dispatch('A')), /group_e_dispatch_invalid/);
  assert.throws(() => recordDispatch(aborted, value.runManifest, value.dispatch('B')), /group_e_dispatch_invalid/);
  assert.throws(() => recordPreEnableAbort(aborted, value.runManifest, record,
    { controlRecordCreated: true }), /group_e_execution_not_pristine/);
  assert.throws(() => recordPreEnableAbort(value.started, value.runManifest, record,
    { controlRecordCreated: true }), /group_e_execution_not_pristine/);
  assert.throws(() => recordPreEnableAbort(value.initial, value.runManifest, record,
    { controlRecordCreated: false }), /group_e_pre_enable_abort_invalid/);
});

test('B cannot dispatch before exact A reconciliation and session-boundary control evidence', () => {
  const value = state();
  const aDispatch = recordDispatch(value.started, value.runManifest, value.dispatch('A'));
  assert.throws(() => recordDispatch(aDispatch, value.runManifest, value.dispatch('B')), /group_e_dispatch_invalid/);
  const aTerminal = recordTerminalAttempt(aDispatch, value.terminal('A'));
  const aEvidence = recordAReconciliationEvidence(aTerminal, value.evidence('A'));
  const boundary = value.boundary(aEvidence);
  assert.throws(() => recordSessionBoundary(aEvidence, boundary), /group_e_session_boundary_invalid/);
  const wrongBoundary = { ...boundary, signOutVerified: false };
  assert.throws(() => recordSessionBoundary(aEvidence, wrongBoundary, { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  const aComplete = recordSessionBoundary(aEvidence, boundary, { controlRecordCreated: true });
  assert.throws(() => recordDispatch(aComplete, value.runManifest,
    value.dispatch('B', { generationId: value.fixture.GENERATION.A })), /group_e_dispatch_session_mismatch/);
  assert.throws(() => recordDispatch(aComplete, value.runManifest,
    { ...value.dispatch('B'), jti: value.fixture.JTI.A }), /group_e_dispatch_invalid/);
  assert.throws(() => recordDispatch(aComplete, value.runManifest,
    { ...value.dispatch('B'), attemptId: value.fixture.ATTEMPT.A }), /group_e_dispatch_invalid/);
});

test('A dispatch, boundary-before, canonical digests, and exact A reconciliation are non-substitutable', () => {
  const value = pendingBoundaryState();
  const accepted = recordSessionBoundary(value.aEvidence, value.boundary, { controlRecordCreated: true });
  assert.equal(accepted.sessionBoundary.before.sessionGeneration, value.aDispatch.dispatches.A.sessionGeneration);
  assert.equal(accepted.sessionBoundary.before.sessionGenerationDigest,
    value.aDispatch.dispatches.A.sessionGenerationDigest);
  assert.equal(accepted.sessionBoundary.before.runtimeInstanceDigest, value.fixture.RUNTIME_INSTANCE_DIGEST);
  assert.equal(accepted.sessionBoundary.aDispatchDigest,
    executionDispatchDigest(value.aEvidence, value.aEvidence.dispatches.A));
  assert.equal(accepted.sessionBoundary.aReconciliationDigest,
    accepted.reconciliations.A.reconciliationDigest);
  assert.equal(accepted.reconciliations.A.sessionBoundaryDigest, null);

  const wrongBeforeDigest = structuredClone(value.boundary);
  wrongBeforeDigest.before.sessionGenerationDigest = 'f'.repeat(64);
  assert.throws(() => recordSessionBoundary(value.aEvidence, resealBoundary(wrongBeforeDigest),
    { controlRecordCreated: true }), /group_e_session_boundary_invalid/);
  for (const boundary of [
    mutateBoundarySession(value.boundary, 'before', { sessionGeneration: 9 }),
    mutateBoundarySession(value.boundary, 'before', { generationId: value.fixture.GENERATION.B }),
    mutateBoundarySession(value.boundary, 'before', { uidHash: value.fixture.bindings.B.uidHash }),
    mutateBoundarySession(value.boundary, 'before', { trainerHash: value.fixture.bindings.B.trainerHash }),
    mutateBoundarySession(value.boundary, 'before', { runId: value.fixture.JTI.A }),
    mutateBoundarySession(value.boundary, 'before', { slot: 'B' })
  ]) {
    assert.throws(() => recordSessionBoundary(value.aEvidence, boundary, { controlRecordCreated: true }),
      /group_e_session_boundary_invalid/);
  }
  for (const field of ['aDispatchDigest', 'aReconciliationDigest']) {
    assert.throws(() => recordSessionBoundary(value.aEvidence,
      resealBoundary({ ...value.boundary, [field]: 'f'.repeat(64) }), { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  }
});

test('boundary-after requires one canonical later B session and rejects the former arbitrary digest fixture', () => {
  const value = pendingBoundaryState();
  for (const generation of [10, 9]) {
    assert.throws(() => recordSessionBoundary(value.aEvidence,
      mutateBoundarySession(value.boundary, 'after', { sessionGeneration: generation }),
      { controlRecordCreated: true }), /group_e_session_boundary_invalid/);
  }
  for (const generation of ['11', 11.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => recordSessionBoundary(value.aEvidence,
      mutateBoundarySession(value.boundary, 'after', { sessionGeneration: generation },
        { recomputeSessionDigest: false }), { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  }
  const unrelatedAfterDigest = structuredClone(value.boundary);
  unrelatedAfterDigest.after.sessionGenerationDigest = 'a'.repeat(64);
  assert.throws(() => recordSessionBoundary(value.aEvidence, resealBoundary(unrelatedAfterDigest),
    { controlRecordCreated: true }), /group_e_session_boundary_invalid/);
  for (const changes of [
    { uidHash: value.fixture.bindings.A.uidHash },
    { trainerHash: value.fixture.bindings.A.trainerHash },
    { runId: value.fixture.JTI.B },
    { slot: 'A' },
    { generationId: value.fixture.GENERATION.A },
    { browserContextDigest: 'f'.repeat(64) },
    { runtimeInstanceDigest: 'f'.repeat(64) }
  ]) {
    assert.throws(() => recordSessionBoundary(value.aEvidence,
      mutateBoundarySession(value.boundary, 'after', changes), { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  }
  for (const field of ['aControllerTerminal', 'aControllerClosed', 'aInMemoryResultCleared', 'signOutVerified']) {
    assert.throws(() => recordSessionBoundary(value.aEvidence,
      resealBoundary({ ...value.boundary, [field]: false }), { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  }
  const formerFixture = structuredClone(value.boundary);
  formerFixture.before.sessionGenerationDigest = '9'.repeat(64);
  formerFixture.after.sessionGenerationDigest = 'a'.repeat(64);
  assert.equal(formerFixture.before.sessionGeneration, 10);
  assert.equal(formerFixture.after.sessionGeneration, 11);
  assert.throws(() => recordSessionBoundary(value.aEvidence, resealBoundary(formerFixture),
    { controlRecordCreated: true }), /group_e_session_boundary_invalid/,
  'unrelated 9…/a… digests must not satisfy the canonical 10 → 11 boundary');
});

test('B dispatch is reconstructed only from the persisted boundary-after context', () => {
  const value = pendingBoundaryState();
  const aComplete = recordSessionBoundary(value.aEvidence, value.boundary, { controlRecordCreated: true });
  assert.deepEqual(dispatchSessionGenerationContext(aComplete, value.dispatch('B')),
    Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, aComplete.sessionBoundary.after[field]])));
  for (const dispatch of [
    value.dispatch('B', { sessionGeneration: 12 }),
    value.dispatch('B', { generationId: value.fixture.GENERATION.A }),
    value.dispatch('B', { browserContextDigest: 'f'.repeat(64) }),
    value.dispatch('B', { runtimeInstanceDigest: 'f'.repeat(64) }),
    value.dispatch('B', { sessionGenerationDigest: 'f'.repeat(64) })
  ]) {
    assert.throws(() => recordDispatch(aComplete, value.runManifest, dispatch),
      /group_e_dispatch_session_mismatch/);
  }
  const accepted = recordDispatch(aComplete, value.runManifest, value.dispatch('B'));
  assert.equal(accepted.dispatches.B.sessionGeneration, aComplete.sessionBoundary.after.sessionGeneration);
  assert.equal(accepted.dispatches.B.sessionGenerationDigest,
    aComplete.sessionBoundary.after.sessionGenerationDigest);
  assert.equal(accepted.dispatches.B.runtimeInstanceDigest,
    aComplete.sessionBoundary.after.runtimeInstanceDigest);
});

test('session-boundary failure preserves restoration and restart accepts only the exact B suffix', () => {
  const value = pendingBoundaryState();
  const invalid = mutateBoundarySession(value.boundary, 'after', { sessionGeneration: 10 });
  assert.throws(() => recordSessionBoundary(value.aEvidence, invalid, { controlRecordCreated: true }),
    /group_e_session_boundary_invalid/);
  const blocked = blockLedger(value.aEvidence, 'OPERATOR_CONTAINMENT', TIMES.boundary);
  assert.deepEqual(recordRestoration(blocked, restorationInput('OPERATOR_CONTAINMENT')).gates, disabledGatePlan());

  const directory = tempLedger(value.initial);
  try {
    let current = persistEnablementStart(directory, value);
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordDispatch(ledger, value.runManifest, value.dispatch('A')), { mode: 'apply' }).ledger;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordTerminalAttempt(ledger, value.terminal('A')), { mode: 'apply' }).ledger;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordAReconciliationEvidence(ledger, value.evidence('A')), { mode: 'apply' }).ledger;
    const persistedBoundary = value.boundary;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordSessionBoundary(ledger, persistedBoundary, { controlRecordCreated: true }),
      { mode: 'apply' }).ledger;
    const restarted = validateLedgerDirectory(directory).latest;
    assert.deepEqual(restarted.sessionBoundary.after, current.sessionBoundary.after);
    assert.throws(() => recordDispatch(restarted, value.runManifest,
      value.dispatch('B', { sessionGeneration: 12 })), /group_e_dispatch_session_mismatch/);
    const committed = commitDispatchAndCreateCapability(directory, restarted.transitionDigest, value.runManifest,
      value.dispatch('B'), value.capability('B'), value.fixture.privateKeyPem, { mode: 'apply' });
    assert.equal(committed.ledger.stage, STAGES.B_DISPATCH_COMMITTED);
    assert.equal(committed.capability.capability.sessionGeneration, restarted.sessionBoundary.after.sessionGeneration);
    assert.equal(committed.capability.capability.sessionGenerationDigest,
      restarted.sessionBoundary.after.sessionGenerationDigest);
    assert.equal(committed.capability.capability.sessionBoundaryDigest, restarted.sessionBoundary.boundaryDigest);
    assert.equal(committed.capability.capability.priorAReconciliationDigest,
      restarted.reconciliations.A.reconciliationDigest);
  } finally { removeTempLedger(directory); }
});

test('page-runtime loss after A permanently blocks B and permits restoration only', () => {
  const value = pendingBoundaryState();
  const aComplete = recordSessionBoundary(value.aEvidence, value.boundary, { controlRecordCreated: true });
  const blocked = recordRuntimeInstanceLoss(aComplete, '2030-01-01T12:08:30.000Z');
  assert.equal(blocked.stage, STAGES.BLOCKED_RESTORATION_REQUIRED);
  assert.equal(blocked.blockedReason, 'RUNTIME_INSTANCE_LOST');
  assert.deepEqual(blocked.completedPrefix, ['A']);
  assert.equal(blocked.remainingAdmittedBudget, 1);
  assert.throws(() => recordDispatch(blocked, value.runManifest, value.dispatch('B')), /group_e_dispatch_invalid/);
  assert.throws(() => recordRuntimeInstanceLoss(blocked, '2030-01-01T12:08:31.000Z'),
    /group_e_runtime_instance_loss_invalid/);
  const restored = recordRestoration(blocked, restorationInput('RUNTIME_INSTANCE_LOST'));
  assert.equal(restored.stage, STAGES.RESTORED_OBSERVATION_PENDING);
  assert.equal(restored.outcome, 'blocked');
  assert.deepEqual(restored.gates, disabledGatePlan());
});

test('durable dispatch is committed before signing and cannot be regenerated after restart', () => {
  const value = state();
  const directory = tempLedger(value.initial);
  try {
    const started = persistEnablementStart(directory, value);
    const plan = commitDispatchAndCreateCapability(directory, started.transitionDigest, value.runManifest,
      value.dispatch('A'), value.capability('A'), null, { mode: 'plan' });
    assert.equal(plan.written, false);
    assert.equal(plan.capability, null);
    assert.equal(validateLedgerDirectory(directory).latest.stage, STAGES.ENABLEMENT_STARTED);
    const applied = commitDispatchAndCreateCapability(directory, started.transitionDigest, value.runManifest,
      value.dispatch('A'), value.capability('A'), value.fixture.privateKeyPem, { mode: 'apply' });
    assert.equal(applied.written, true);
    assert.equal(applied.ledger.stage, STAGES.A_DISPATCH_COMMITTED);
    assert.equal(applied.capability.capability.dispatchLedgerDigest, applied.ledger.transitionDigest);
    assert.equal(validateLedgerDirectory(directory).latest.transitionDigest, applied.ledger.transitionDigest);
    const snapshotsBefore = fs.readdirSync(path.join(directory, 'snapshots')).length;
    assert.throws(() => commitDispatchAndCreateCapability(directory, applied.ledger.transitionDigest, value.runManifest,
      value.dispatch('A'), value.capability('A'), value.fixture.privateKeyPem, { mode: 'apply' }),
    /group_e_dispatch_invalid/);
    assert.equal(fs.readdirSync(path.join(directory, 'snapshots')).length, snapshotsBefore);
  } finally { removeTempLedger(directory); }
});

test('invalid expiry or wrong Ed25519 key fails before the durable dispatch CAS', () => {
  const value = state();
  for (const [capability, key, error] of [
    [{ ...value.capability('A'), expiresAt: TIMES.dispatchA }, value.fixture.privateKeyPem,
      /group_e_capability_dispatch_mismatch/],
    [value.capability('A'), crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }),
      /group_e_signing_key_invalid/]
  ]) {
    const directory = tempLedger(value.initial);
    try {
      const started = persistEnablementStart(directory, value);
      assert.throws(() => commitDispatchAndCreateCapability(directory, started.transitionDigest, value.runManifest,
        value.dispatch('A'), capability, key, { mode: 'apply' }), error);
      const current = validateLedgerDirectory(directory);
      assert.equal(current.latest.stage, STAGES.ENABLEMENT_STARTED);
      assert.equal(current.snapshots.length, 2);
    } finally { removeTempLedger(directory); }
  }
});

test('operator constructor refuses integrity-resealed cross-runtime evidence before signing or output', () => {
  const value = pendingBoundaryState();
  const directory = tempLedger(value.initial);
  const root = path.dirname(directory);
  const inputPath = path.join(root, 'input.json');
  const manifestPath = path.join(root, 'run.json');
  const keyPath = path.join(root, 'signing.pem');
  const outputPath = path.join(root, 'capability.json');
  let signCalls = 0;
  const originalSign = crypto.sign;
  try {
    let current = persistEnablementStart(directory, value);
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordDispatch(ledger, value.runManifest, value.dispatch('A')), { mode: 'apply' }).ledger;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordTerminalAttempt(ledger, value.terminal('A')), { mode: 'apply' }).ledger;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordAReconciliationEvidence(ledger, value.evidence('A')), { mode: 'apply' }).ledger;
    current = applyLedgerTransition(directory, current.transitionDigest,
      (ledger) => recordSessionBoundary(ledger, value.boundary, { controlRecordCreated: true }),
      { mode: 'apply' }).ledger;

    const snapshotsDirectory = path.join(directory, 'snapshots');
    const sequencePrefix = String(current.sequence).padStart(6, '0');
    const oldSnapshot = path.join(snapshotsDirectory,
      fs.readdirSync(snapshotsDirectory).find((file) => file.startsWith(`${sequencePrefix}-`)));
    const tampered = structuredClone(current);
    tampered.sessionBoundary.after.runtimeInstanceDigest = '9'.repeat(64);
    tampered.sessionBoundary.after.sessionGenerationDigest = sessionGenerationDigest(
      Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) =>
        [field, tampered.sessionBoundary.after[field]]))
    );
    tampered.sessionBoundary.boundaryDigest = sessionBoundaryDigest(tampered.sessionBoundary);
    tampered.sessionBoundaryDigest = tampered.sessionBoundary.boundaryDigest;
    tampered.transitionDigest = canonicalLedgerDigest(tampered);
    assert.equal(tampered.sessionBoundary.after.sessionGenerationDigest,
      sessionGenerationDigest(Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) =>
        [field, tampered.sessionBoundary.after[field]]))));
    assert.equal(tampered.transitionDigest, canonicalLedgerDigest(tampered));

    const newSnapshotName = `${sequencePrefix}-${tampered.transitionDigest}.json`;
    writePrivateJson(path.join(snapshotsDirectory, newSnapshotName), tampered);
    fs.unlinkSync(oldSnapshot);
    writePrivateJson(path.join(directory, 'HEAD.json'), { schemaVersion: 1, sequence: current.sequence,
      snapshotFile: newSnapshotName, transitionDigest: tampered.transitionDigest });
    const headBefore = fs.readFileSync(path.join(directory, 'HEAD.json'), 'utf8');
    const snapshotsBefore = fs.readdirSync(snapshotsDirectory).sort();

    writePrivateJson(manifestPath, value.runManifest);
    fs.writeFileSync(keyPath, value.fixture.privateKeyPem, { mode: 0o600 });
    fs.chmodSync(keyPath, 0o600);
    writePrivateJson(inputPath, { schemaVersion: 1, action: 'dispatch',
      expectedPriorDigest: tampered.transitionDigest,
      payload: { ...value.dispatch('B'), expiresAt: value.capability('B').expiresAt,
        runManifestPath: manifestPath, signingKeyPath: keyPath, capabilityOutputPath: outputPath } });

    crypto.sign = (...args) => { signCalls++; return originalSign(...args); };
    assert.throws(() => run([`--input=${inputPath}`, `--ledger=${directory}`, '--mode=apply'],
      { allowExternalPaths: true, stdout: { write() {} } }), /group_e_session_boundary_invalid/);
    assert.equal(signCalls, 0);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.readFileSync(path.join(directory, 'HEAD.json'), 'utf8'), headBefore);
    assert.deepEqual(fs.readdirSync(snapshotsDirectory).sort(), snapshotsBefore);
    assert.equal(fs.readdirSync(snapshotsDirectory).some((file) =>
      file.startsWith(`${String(current.sequence + 1).padStart(6, '0')}-`)), false);
  } finally {
    crypto.sign = originalSign;
    removeTempLedger(directory);
  }
});

test('delivery uncertainty permanently blocks redispatch while preserving unconditional restoration', () => {
  const chain = healthyChain();
  const blocked = recordCapabilityDeliveryUncertain(chain.aDispatch, TIMES.terminalA);
  assert.equal(blocked.stage, STAGES.BLOCKED_RESTORATION_REQUIRED);
  assert.equal(blocked.blockedReason, 'CAPABILITY_DELIVERY_UNCERTAIN');
  assert.throws(() => recordDispatch(blocked, chain.runManifest, chain.dispatch('A')), /group_e_dispatch_invalid/);
  const restored = recordRestoration(blocked, restorationInput('CAPABILITY_DELIVERY_UNCERTAIN'));
  assert.equal(restored.stage, STAGES.RESTORED_OBSERVATION_PENDING);
  assert.equal(restored.outcome, 'blocked');
  assert.deepEqual(unconditionalRestorationPlan(), { confirmation: 'RESTORE E1 GROUP E CLIENT FOUNDATION GATES',
    gates: disabledGatePlan(), requiresFreshEvidence: false, requiresJit: false, requiresReadableLedger: false,
    requiresControlStore: false, invokesCanary: false, changesIam: false });
});

test('blocked execution records accept only exact active or restored gate plans', () => {
  const chain = healthyChain();
  const blocked = blockLedger(chain.aTerminal, 'OPERATOR_CONTAINMENT', TIMES.reconcileA);
  const invalid = structuredClone(blocked);
  invalid.gates.READ_PROOF_MODE = true;
  invalid.transitionDigest = canonicalLedgerDigest(invalid);
  assert.throws(() => validateExecutionLedger(invalid), /group_e_gates_invalid/);
  assert.deepEqual(recordRestoration(blocked, restorationInput('OPERATOR_CONTAINMENT')).gates, disabledGatePlan());
});

test('every post-enable stage has an exact fail-closed path to disabled gates', () => {
  const chain = healthyChain();
  const blocked = blockLedger(chain.aTerminal, 'OPERATOR_CONTAINMENT', TIMES.reconcileA);
  const ledgers = [chain.started, chain.aDispatch, chain.aTerminal, chain.aEvidence, chain.aComplete, chain.bDispatch,
    chain.bTerminal, chain.abComplete, blocked];
  assert.deepEqual(new Set(ledgers.map((ledger) => ledger.stage)), new Set(POST_ENABLE_STAGES));
  ledgers.forEach((ledger, index) => {
    const successful = ledger.stage === STAGES.AB_RECONCILED_RESTORATION_REQUIRED;
    const restored = recordRestoration(ledger, restorationInput(successful ? null :
      ledger.blockedReason || 'OPERATOR_CONTAINMENT', `2030-01-01T12:${String(20 + index).padStart(2, '0')}:00.000Z`));
    assert.equal(restored.stage, STAGES.RESTORED_OBSERVATION_PENDING);
    assert.deepEqual(restored.gates, disabledGatePlan());
  });
});

test('stage skipping, stale CAS writers, rewind, fork, corruption, and lock contention fail closed', () => {
  const chain = healthyChain();
  assert.throws(() => validateMonotonicTransition(chain.started, chain.aTerminal), /group_e_execution_transition_invalid/);
  for (const targets of Object.values(ALLOWED_STAGE_TRANSITIONS)) {
    assert.equal(Array.isArray(targets), true);
  }
  const directory = tempLedger(chain.initial);
  try {
    const started = persistEnablementStart(directory, chain);
    applyLedgerTransition(directory, started.transitionDigest,
      (ledger) => recordDispatch(ledger, chain.runManifest, chain.dispatch('A')), { mode: 'apply' });
    assert.throws(() => applyLedgerTransition(directory, started.transitionDigest,
      (ledger) => recordDispatch(ledger, chain.runManifest, chain.dispatch('A')), { mode: 'apply' }),
    /group_e_ledger_stale_writer/);
    fs.writeFileSync(path.join(directory, 'snapshots', '000002-' + 'f'.repeat(64) + '.json'), '{}', { mode: 0o600 });
    assert.throws(() => validateLedgerDirectory(directory), /group_e_ledger_orphan_history/);
    fs.unlinkSync(path.join(directory, 'snapshots', '000002-' + 'f'.repeat(64) + '.json'));
    fs.writeFileSync(path.join(directory, 'LOCK'), '{}', { mode: 0o600 });
    assert.throws(() => applyLedgerTransition(directory, validateLedgerDirectory(directory).latest.transitionDigest,
      (ledger) => recordTerminalAttempt(ledger, chain.terminal('A')), { mode: 'apply' }), /group_e_ledger_lock_contended/);
    fs.unlinkSync(path.join(directory, 'LOCK'));
    const recovered = applyLedgerTransition(directory, validateLedgerDirectory(directory).latest.transitionDigest,
      (ledger) => recordTerminalAttempt(ledger, chain.terminal('A')), { mode: 'apply' });
    assert.equal(recovered.ledger.stage, STAGES.A_TERMINAL_UNRECONCILED);
    const headPath = path.join(directory, 'HEAD.json');
    const head = JSON.parse(fs.readFileSync(headPath, 'utf8'));
    writePrivateJson(headPath, { ...head, transitionDigest: 'f'.repeat(64) });
    assert.throws(() => validateLedgerDirectory(directory), /group_e_ledger_head_invalid/);
  } finally { removeTempLedger(directory); }
});

test('retained ledger history rejects rewind, fork, truncated, and missing snapshots', () => {
  const chain = healthyChain();

  for (const corrupt of [
    (directory) => {
      const snapshot = fs.readdirSync(path.join(directory, 'snapshots'))[0];
      fs.writeFileSync(path.join(directory, 'snapshots', snapshot), '{', { mode: 0o600 });
    },
    (directory) => {
      const snapshot = fs.readdirSync(path.join(directory, 'snapshots'))[0];
      fs.unlinkSync(path.join(directory, 'snapshots', snapshot));
    }
  ]) {
    const directory = tempLedger(chain.initial);
    try {
      corrupt(directory);
      assert.throws(() => validateLedgerDirectory(directory),
        /group_e_ledger_snapshot_invalid|group_e_ledger_orphan_history/);
    } finally { removeTempLedger(directory); }
  }

  const directory = tempLedger(chain.initial);
  try {
    const started = persistEnablementStart(directory, chain);
    applyLedgerTransition(directory, started.transitionDigest,
      (ledger) => recordDispatch(ledger, chain.runManifest, chain.dispatch('A')), { mode: 'apply' });
    const headPath = path.join(directory, 'HEAD.json');
    const currentHead = JSON.parse(fs.readFileSync(headPath, 'utf8'));
    const initialFile = fs.readdirSync(path.join(directory, 'snapshots')).find((file) => file.startsWith('000000-'));
    writePrivateJson(headPath, { schemaVersion: 1, sequence: 0, snapshotFile: initialFile,
      transitionDigest: chain.initial.transitionDigest });
    assert.throws(() => validateLedgerDirectory(directory), /group_e_ledger_orphan_history/);

    writePrivateJson(headPath, currentHead);
    const currentFile = currentHead.snapshotFile;
    const forkDigest = 'f'.repeat(64);
    const forkFile = `000002-${forkDigest}.json`;
    fs.renameSync(path.join(directory, 'snapshots', currentFile), path.join(directory, 'snapshots', forkFile));
    writePrivateJson(headPath, { ...currentHead, snapshotFile: forkFile, transitionDigest: forkDigest });
    assert.throws(() => validateLedgerDirectory(directory), /group_e_ledger_rewind_or_fork/);
  } finally { removeTempLedger(directory); }
});

test('ledger directory and immutable history enforce 0700 directories and 0600 snapshots/HEAD', () => {
  const value = state();
  const directory = tempLedger(value.initial);
  try {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(directory, 'snapshots')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(directory, 'HEAD.json')).mode & 0o777, 0o600);
    const snapshot = fs.readdirSync(path.join(directory, 'snapshots'))[0];
    assert.equal(fs.statSync(path.join(directory, 'snapshots', snapshot)).mode & 0o777, 0o600);
    fs.chmodSync(path.join(directory, 'HEAD.json'), 0o644);
    assert.throws(() => validateLedgerDirectory(directory), /group_e_ledger_head_invalid/);
  } finally { removeTempLedger(directory); }
});

test('observation closeout requires a 30-75 minute passive window after restoration', () => {
  const restored = recordRestoration(healthyChain().abComplete, restorationInput());
  const base = { acceptedAt: TIMES.close, observationDigest: '9'.repeat(64), restorationDigest: 'a'.repeat(64),
    finalStateDigest: IDENTITY_BASELINE.stateDigest, observationStartedAt: TIMES.observationStart,
    observationEndedAt: TIMES.observationEnd, unexpectedAdditionalAdmittedCalls: 0, prohibitedWrites: ZERO_WRITES,
    controlRecordCreated: true };
  assert.throws(() => recordObservationCloseout(restored, { ...base, controlRecordCreated: false }),
    /group_e_observation_closeout_invalid/);
  assert.throws(() => recordObservationCloseout(restored,
    { ...base, observationEndedAt: '2030-01-01T12:42:59.999Z' }), /group_e_observation_closeout_invalid/);
  assert.throws(() => recordObservationCloseout(restored,
    { ...base, observationStartedAt: '2030-01-01T12:11:59.999Z' }), /group_e_observation_closeout_invalid/);
  assert.throws(() => recordObservationCloseout(restored, { ...base,
    observationEndedAt: '2030-01-01T13:29:00.001Z', acceptedAt: '2030-01-01T13:30:00.000Z' }),
  /group_e_observation_closeout_invalid/);
});

test('CLI plan signs and writes nothing; apply emits one private capability after durable dispatch', () => {
  const value = state();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-e-cli-'));
  const ledger = path.join(root, 'ledger');
  const inputPath = path.join(root, 'input.json');
  const manifestPath = path.join(root, 'run.json');
  const keyPath = path.join(root, 'signing.pem');
  const outputPath = path.join(root, 'capability.json');
  const stdout = { value: '', write(chunk) { this.value += chunk; } };
  try {
    writePrivateJson(inputPath, { schemaVersion: 1, action: 'initialize', expectedPriorDigest: null,
      payload: value.initialInput });
    const plan = run([`--input=${inputPath}`, `--ledger=${ledger}`], { allowExternalPaths: true, stdout });
    assert.equal(plan.verdict.written, false);
    assert.equal(fs.existsSync(ledger), false);
    run([`--input=${inputPath}`, `--ledger=${ledger}`, '--mode=apply'], { allowExternalPaths: true, stdout });
    writePrivateJson(manifestPath, value.runManifest);
    writePrivateJson(inputPath, { schemaVersion: 1, action: 'enablement-start',
      expectedPriorDigest: value.initial.transitionDigest,
      payload: { startedAt: TIMES.enable, jit: value.jit, runManifestPath: manifestPath } });
    const start = run([`--input=${inputPath}`, `--ledger=${ledger}`, '--mode=apply'],
      { allowExternalPaths: true, stdout });
    assert.equal(start.ledger.stage, STAGES.ENABLEMENT_STARTED);
    fs.writeFileSync(keyPath, value.fixture.privateKeyPem, { mode: 0o600 });
    fs.chmodSync(keyPath, 0o600);
    writePrivateJson(inputPath, { schemaVersion: 1, action: 'dispatch',
      expectedPriorDigest: start.ledger.transitionDigest,
      payload: { ...value.dispatch('A'), expiresAt: value.capability('A').expiresAt,
        runManifestPath: manifestPath, signingKeyPath: keyPath, capabilityOutputPath: outputPath } });
    const dispatchPlan = run([`--input=${inputPath}`, `--ledger=${ledger}`], { allowExternalPaths: true, stdout });
    assert.equal(dispatchPlan.verdict.written, false);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(validateLedgerDirectory(ledger).latest.stage, STAGES.ENABLEMENT_STARTED);
    const applied = run([`--input=${inputPath}`, `--ledger=${ledger}`, '--mode=apply'],
      { allowExternalPaths: true, stdout });
    assert.equal(applied.verdict.written, true);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).capability.dispatchLedgerDigest,
      applied.ledger.transitionDigest);
    assert.doesNotMatch(stdout.value, /uidHash|trainerHash|signature|publicKeySpki|authorityImageDigest/u);
    assert.throws(() => run([`--input=${inputPath}`, `--ledger=${ledger}`, '--mode=apply'],
      { allowExternalPaths: true, stdout }), /group_e_execution_capability_output_exists|group_e_ledger_stale_writer/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI rejects secrets and imports no cloud SDK or production transport', () => {
  assert.throws(() => assertNoSensitiveMaterial({ idToken: 'private' }),
    /group_e_execution_sensitive_material_rejected/);
  assert.throws(() => assertNoSensitiveMaterial({ nested: { pin: '000000' } }),
    /group_e_execution_sensitive_material_rejected/);
  const sourceText = fs.readFileSync(path.resolve(__dirname,
    '../scripts/check-e1-production-client-foundation-execution.cjs'), 'utf8');
  assert.doesNotMatch(sourceText, /firebase-admin|google-auth-library|gcloud|httpsCallable|fetch\(/u);
});
