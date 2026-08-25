'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  BASELINE_FIELDS,
  CAPABILITY_FIELDS,
  CLOSEOUT_FIELDS,
  PRE_ENABLE_ABORT_FIELDS,
  SESSION_GENERATION_FIELDS,
  canonicalCapabilityArray,
  createAdmissionReceipt,
  createFinalCloseout,
  createPreEnableAbort,
  createReconciliationRecord,
  finalCloseoutDigest,
  preEnableAbortDigest,
  keyIdFromSpki,
  sessionGenerationContext,
  sessionGenerationDigest,
  validateAdmissionReceipt,
  validateCapabilityAgainstRun,
  validateCapabilityShape,
  validateConsumptionRecord,
  validateFinalCloseout,
  validatePreEnableAbort,
  validateReconciliationRecord,
  validateRunManifest,
  validateSignedRequest,
  verifyCapabilitySignature
} = require('../e1-gateway/groupEAdmission');
const { createFixture } = require('./helpers/groupEFixture.cjs');

function clone(value) { return structuredClone(value); }
function errorCode(error) { return error?.code || error?.message; }

const SESSION_VECTOR_JSON = '[1,"group-e-session-generation",1,"production","trade-list-a4297",' +
  '"123e4567-e89b-42d3-a456-426614174000","cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",' +
  '"A","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",' +
  '"1111111111111111111111111111111111111111111111111111111111111111",' +
  '"223e4567-e89b-42d3-a456-426614174000",10,' +
  '"2222222222222222222222222222222222222222222222222222222222222222",' +
  '"3333333333333333333333333333333333333333333333333333333333333333",' +
  '"4444444444444444444444444444444444444444444444444444444444444444"]';
const SESSION_VECTOR_SHA256 = 'a3f9c8ccf83318c529dcd7f247b1f8891836ebe96585a55db89207e8acae9e0d';

test('Ed25519 capability signature binds the exact ordered-array contract and key identifier', () => {
  const fixture = createFixture();
  const request = fixture.signedRequest('A');
  assert.deepEqual(verifyCapabilitySignature(request.capability, request.signature, fixture.publicKeySpki), request.capability);
  assert.equal(keyIdFromSpki(fixture.publicKeySpki), fixture.run.keyId);
  assert.equal(canonicalCapabilityArray(request.capability).length, 39);
  assert.deepEqual(canonicalCapabilityArray(request.capability).slice(0, 4), [
    1, 'group-e-admission-capability-ed25519', 1, 'group-e-slot-capability'
  ]);

  const other = crypto.generateKeyPairSync('ed25519');
  const otherSpki = other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  assert.throws(() => verifyCapabilitySignature(request.capability, request.signature, otherSpki), /GROUP_E_SIGNATURE_INVALID/);
});

test('canonical session generation matches an independently calculated literal known vector', () => {
  const context = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: '123e4567-e89b-42d3-a456-426614174000',
    cohortDigest: 'c'.repeat(64),
    slot: 'A',
    uidHash: 'a'.repeat(64),
    trainerHash: '1'.repeat(64),
    generationId: '223e4567-e89b-42d3-a456-426614174000',
    sessionGeneration: 10,
    firebaseAppIdHash: '2'.repeat(64),
    browserContextDigest: '3'.repeat(64),
    runtimeInstanceDigest: '4'.repeat(64)
  };
  assert.deepEqual(Object.keys(context), [...SESSION_GENERATION_FIELDS]);
  assert.equal(JSON.stringify([1, 'group-e-session-generation', ...Object.values(context)]), SESSION_VECTOR_JSON);
  assert.equal(crypto.createHash('sha256').update(SESSION_VECTOR_JSON, 'utf8').digest('hex'), SESSION_VECTOR_SHA256);
  assert.equal(sessionGenerationDigest(context), SESSION_VECTOR_SHA256);
  const missingRuntime = { ...context };
  delete missingRuntime.runtimeInstanceDigest;
  assert.throws(() => sessionGenerationDigest(missingRuntime), /GROUP_E_SESSION_GENERATION_INVALID/);
  assert.throws(() => sessionGenerationDigest({ ...context, assertedRuntime: true }),
    /GROUP_E_SESSION_GENERATION_INVALID/);
});

test('signature, payload, missing-field, and extra-field modification all fail closed', () => {
  const fixture = createFixture();
  const request = fixture.signedRequest('A');
  const modifiedSignature = `${request.signature.slice(0, -1)}${request.signature.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => verifyCapabilitySignature(request.capability, modifiedSignature, fixture.publicKeySpki),
    /GROUP_E_SIGNATURE_INVALID/);

  const modifiedPayload = { ...request.capability, pagesArtifactDigest: 'f'.repeat(64) };
  assert.throws(() => verifyCapabilitySignature(modifiedPayload, request.signature, fixture.publicKeySpki),
    /GROUP_E_SIGNATURE_INVALID/);
  const missing = clone(request.capability);
  delete missing.trainerHash;
  assert.throws(() => validateCapabilityShape(missing), /GROUP_E_CAPABILITY_INVALID/);
  const missingRuntime = clone(request.capability);
  delete missingRuntime.runtimeInstanceDigest;
  assert.throws(() => validateCapabilityShape(missingRuntime), /GROUP_E_CAPABILITY_INVALID/);
  assert.throws(() => validateCapabilityShape({ ...request.capability, assertedAuthorization: true }),
    /GROUP_E_CAPABILITY_INVALID/);
  assert.throws(() => validateSignedRequest({ ...request, browserTerminal: true }), /REQUEST_INVALID/);
  assert.deepEqual(Object.keys(request.capability).sort(), [...CAPABILITY_FIELDS].sort());
});

test('run and capability reject wrong project, environment, run, key, subject, cohort, slot, and provenance', () => {
  const fixture = createFixture();
  validateRunManifest(fixture.run, { now: fixture.NOW });
  const mutations = [
    (value) => { value.environment = 'staging'; },
    (value) => { value.projectId = 'other-project'; },
    (value) => { value.runId = '223e4567-e89b-42d3-a456-426614174000'; },
    (value) => { value.keyId = 'f'.repeat(64); },
    (value) => { value.uidHash = fixture.bindings.B.uidHash; },
    (value) => { value.trainerHash = fixture.bindings.B.trainerHash; },
    (value) => { value.cohortDigest = 'f'.repeat(64); },
    (value) => { value.sessionGeneration = value.sessionGeneration + 1; },
    (value) => { value.runtimeInstanceDigest = 'f'.repeat(64); },
    (value) => { value.sessionGenerationDigest = 'f'.repeat(64); },
    (value) => { value.slot = 'C'; },
    (value) => { value.pagesSourceSha = 'f'.repeat(40); },
    (value) => { value.gatewaySourceFingerprint = 'f'.repeat(64); },
    (value) => { value.authorityImageDigest = `sha256:${'0'.repeat(64)}`; }
  ];
  for (const mutate of mutations) {
    const capability = fixture.capability('A');
    mutate(capability);
    assert.throws(() => validateCapabilityAgainstRun(capability, fixture.run, { now: fixture.NOW }));
  }
});

test('capability freshness, exact budget, attempt hash, and A/B dependency shapes are enforced', () => {
  const fixture = createFixture();
  assert.throws(() => validateCapabilityShape(fixture.capability('A'), { now: Date.parse('2030-01-01T12:20:00.000Z') }),
    /GROUP_E_CAPABILITY_EXPIRED/);
  assert.throws(() => validateCapabilityShape(fixture.capability('A'), { now: Date.parse('2030-01-01T12:04:59.999Z') }),
    /GROUP_E_CAPABILITY_EXPIRED/);
  assert.throws(() => validateCapabilityShape(fixture.capability('A', { remainingAdmittedCallBudget: 1 })),
    /GROUP_E_CAPABILITY_INVALID/);
  assert.throws(() => validateCapabilityShape(fixture.capability('B', { remainingAdmittedCallBudget: 2 })),
    /GROUP_E_CAPABILITY_INVALID/);
  assert.throws(() => validateCapabilityShape(fixture.capability('A', { priorAReconciliationDigest: 'a'.repeat(64) })),
    /GROUP_E_CAPABILITY_INVALID/);
  assert.throws(() => validateCapabilityShape(fixture.capability('B', { priorAReconciliationDigest: null })),
    /GROUP_E_CAPABILITY_INVALID/);
  const wrongAttempt = { ...fixture.signedRequest('A'), attemptId: fixture.ATTEMPT.B };
  assert.throws(() => validateSignedRequest(wrongAttempt), /REQUEST_INVALID/);
  const signedB = fixture.signedRequest('B');
  const publiclyRecomputedB = {
    ...signedB.capability,
    priorAReconciliationDigest: 'f'.repeat(64),
    sessionBoundaryDigest: 'e'.repeat(64)
  };
  assert.throws(() => verifyCapabilitySignature(publiclyRecomputedB, signedB.signature, fixture.publicKeySpki),
    /GROUP_E_SIGNATURE_INVALID/);
  assert.throws(() => verifyCapabilitySignature({ ...signedB.capability, sessionBoundaryDigest: 'd'.repeat(64) },
    signedB.signature, fixture.publicKeySpki), /GROUP_E_SIGNATURE_INVALID/);
  const wrongSignedSession = { ...signedB.capability, sessionGeneration: signedB.capability.sessionGeneration + 1 };
  wrongSignedSession.sessionGenerationDigest = sessionGenerationDigest(sessionGenerationContext(wrongSignedSession));
  assert.throws(() => verifyCapabilitySignature(wrongSignedSession, signedB.signature, fixture.publicKeySpki),
    /GROUP_E_SIGNATURE_INVALID/);
});

test('consumption, receipt, and reconciliation records are exact, immutable-digest schemas', () => {
  const fixture = createFixture();
  const marker = fixture.consumption('A');
  const receipt = createAdmissionReceipt(marker);
  const reconciliation = fixture.reconciliationA(marker);
  assert.deepEqual(validateConsumptionRecord(marker), marker);
  assert.deepEqual(validateAdmissionReceipt(receipt, {
    runId: fixture.RUN_ID,
    slot: 'A',
    uidHash: fixture.bindings.A.uidHash,
    attemptHash: fixture.capability('A').attemptHash
  }), receipt);
  assert.deepEqual(validateReconciliationRecord(reconciliation), reconciliation);
  for (const [value, validator] of [
    [{ ...marker, signature: 'not-stored' }, validateConsumptionRecord],
    [{ ...receipt, rawAttemptId: fixture.ATTEMPT.A }, validateAdmissionReceipt],
    [{ ...reconciliation, phaseEIdentityWrite: 0 }, validateReconciliationRecord]
  ]) assert.throws(() => validator(value));

  const changed = clone(reconciliation);
  changed.prohibitedWrites.phaseEIdentityWrites = 1;
  assert.throws(() => validateReconciliationRecord(changed), /GROUP_E_RECONCILIATION_INVALID/);

  const reorderedGates = createReconciliationRecord({
    ...reconciliation,
    gates: Object.fromEntries(Object.entries(reconciliation.gates).reverse())
  });
  assert.deepEqual(validateReconciliationRecord(reorderedGates).gates, reorderedGates.gates);
});

test('final closeout is canonical, observation-bounded, and cannot precede passive observation', () => {
  const fixture = createFixture();
  const base = {
    runId: fixture.RUN_ID,
    outcome: 'healthy',
    bReconciliationDigest: 'a'.repeat(64),
    blockedReason: null,
    restorationDigest: 'b'.repeat(64),
    finalStateDigest: fixture.BASELINE.stateDigest,
    observationDigest: 'c'.repeat(64),
    observationStartedAt: '2030-01-01T13:00:00.000Z',
    observationEndedAt: '2030-01-01T13:30:00.000Z',
    observationAccepted: true,
    unexpectedAdditionalAdmittedCalls: 0,
    prohibitedWrites: fixture.ZERO_WRITES,
    createdAt: '2030-01-01T13:30:01.000Z'
  };
  const closeout = createFinalCloseout(base);
  assert.deepEqual(validateFinalCloseout(closeout), closeout);
  assert.deepEqual(Object.keys(closeout).sort(), [...CLOSEOUT_FIELDS].sort());
  assert.equal(closeout.closeoutDigest, finalCloseoutDigest(closeout));

  const reordered = { ...closeout, prohibitedWrites: {
    unexpectedControlWrites: 0, ordinaryUserWrites: 0, rtdbWrites: 0, phaseEIdentityWrites: 0
  } };
  reordered.closeoutDigest = finalCloseoutDigest(reordered);
  assert.deepEqual(validateFinalCloseout(reordered).prohibitedWrites, reordered.prohibitedWrites);

  for (const mutate of [
    (value) => { value.observationEndedAt = '2030-01-01T13:29:59.999Z'; },
    (value) => { value.createdAt = '2030-01-01T13:29:59.000Z'; },
    (value) => { value.observationAccepted = false; },
    (value) => { value.unexpectedAdditionalAdmittedCalls = 1; },
    (value) => { value.prohibitedWrites.ordinaryUserWrites = 1; }
  ]) {
    const value = clone(closeout);
    mutate(value);
    value.closeoutDigest = finalCloseoutDigest(value);
    assert.throws(() => validateFinalCloseout(value), /GROUP_E_CLOSEOUT_INVALID/, errorCode);
  }
  assert.equal(BASELINE_FIELDS.length, 8);
});

test('pre-enable abort is a distinct exact terminal record with disabled gates and zero writes', () => {
  const fixture = createFixture();
  const base = {
    runId: fixture.RUN_ID,
    runManifestDigest: fixture.run.manifestDigest,
    executionLedgerDigest: fixture.run.initialExecutionLedgerDigest,
    reason: 'TIMING_EXPIRED_BEFORE_ENABLEMENT',
    gates: Object.fromEntries(Object.keys(fixture.GATES_ENABLED).map((gate) => [gate, false])),
    prohibitedWrites: fixture.ZERO_WRITES,
    aDispatchAbsent: true,
    consumptionsAbsent: true,
    reconciliationsAbsent: true,
    createdAt: '2030-01-01T12:31:00.000Z'
  };
  const record = createPreEnableAbort(base);
  assert.deepEqual(validatePreEnableAbort(record), record);
  assert.deepEqual(Object.keys(record).sort(), [...PRE_ENABLE_ABORT_FIELDS].sort());
  assert.equal(record.abortDigest, preEnableAbortDigest(record));
  for (const mutate of [
    (value) => { value.reason = 'UNBOUNDED_REASON'; },
    (value) => { value.gates.GATEWAY_INVOCATION_ENABLED = true; },
    (value) => { value.prohibitedWrites.ordinaryUserWrites = 1; },
    (value) => { value.aDispatchAbsent = false; }
  ]) {
    const changed = clone(record);
    mutate(changed);
    changed.abortDigest = preEnableAbortDigest(changed);
    assert.throws(() => validatePreEnableAbort(changed), /GROUP_E_PRE_ENABLE_ABORT_INVALID/);
  }
});
