'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  baselineDigest,
  createAdmissionReceipt,
  createFinalCloseout,
  createReconciliationRecord
} = require('../e1-gateway/groupEAdmission');
const {
  MAX_TRANSACTION_ATTEMPTS,
  controlPaths,
  createGroupEControlStore,
  createProductionGroupEControlStore
} = require('../e1-gateway/groupEControlStore');
const {
  createGroupEOperatorControlStore,
  createProductionGroupEOperatorControlStore
} = require('../production/e1GroupEControlOperator.cjs');
const { createFixture } = require('./helpers/groupEFixture.cjs');

class FakeFirestore {
  constructor(seed = {}, callbackAttempts = 1) {
    this.documents = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
    this.callbackAttempts = callbackAttempts;
    this.transactionOptions = [];
    this.callbackCount = 0;
    this.queue = Promise.resolve();
  }

  doc(path) {
    return Object.freeze({
      path,
      create: async (value) => {
        if (this.documents.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
        this.documents.set(path, structuredClone(value));
      }
    });
  }

  async runTransaction(callback, options) {
    this.transactionOptions.push(options);
    let release;
    const previous = this.queue;
    this.queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      let result;
      for (let attempt = 0; attempt < this.callbackAttempts; attempt++) {
        const writes = [];
        const transaction = {
          get: async (reference) => ({
            exists: this.documents.has(reference.path),
            data: () => structuredClone(this.documents.get(reference.path))
          }),
          create: (reference, value) => { writes.push([reference.path, structuredClone(value)]); }
        };
        this.callbackCount++;
        result = await callback(transaction);
        if (attempt === this.callbackAttempts - 1) {
          for (const [path] of writes) {
            if (this.documents.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
          }
          writes.forEach(([path, value]) => this.documents.set(path, value));
        }
      }
      return result;
    } finally { release(); }
  }
}

function seedFor(fixture, extra = {}) {
  return { [controlPaths(fixture.RUN_ID, 'A').run]: fixture.run, ...extra };
}

function reconciliationB(fixture, marker, reconciliationA) {
  const receipt = createAdmissionReceipt(marker);
  return createReconciliationRecord({
    runId: fixture.RUN_ID,
    slot: 'B',
    consumptionRecordDigest: marker.recordDigest,
    admissionReceiptDigest: receipt.receiptDigest,
    gatewayRecordDigest: '2'.repeat(64),
    authorityRecordDigest: '3'.repeat(64),
    responseDigest: '4'.repeat(64),
    resultDigest: '5'.repeat(64),
    resultCode: 'SUCCESS',
    foundationStatus: 'active',
    identityBaselineDigest: baselineDigest(fixture.BASELINE),
    familyCounts: fixture.COUNTS,
    prohibitedWrites: fixture.ZERO_WRITES,
    gates: fixture.GATES_ENABLED,
    securityBoundary: fixture.SECURITY,
    runtimeDigest: '6'.repeat(64),
    remainingAdmittedCallBudget: 0,
    priorAReconciliationDigest: reconciliationA.reconciliationDigest,
    sessionBoundaryDigest: fixture.dependencies.sessionBoundaryDigest,
    createdAt: '2030-01-01T12:18:00.000Z'
  });
}

test('control paths accept only the exact UUID run and literal A/B slots', () => {
  const fixture = createFixture();
  assert.deepEqual(controlPaths(fixture.RUN_ID, 'A'), {
    run: `runs/${fixture.RUN_ID}`,
    consumption: `runs/${fixture.RUN_ID}/consumptions/A`,
    reconciliation: `runs/${fixture.RUN_ID}/reconciliations/A`,
    closeout: `runs/${fixture.RUN_ID}/closeouts/final`
  });
  for (const [runId, slot] of [
    [`${fixture.RUN_ID}/consumptions/B`, 'A'],
    ['../runs/escape', 'A'],
    [fixture.RUN_ID, 'C'],
    [fixture.RUN_ID, '../B']
  ]) assert.throws(() => controlPaths(runId, slot));
});

test('A transaction validates the run and creates exactly one immutable consumption marker', async () => {
  const fixture = createFixture();
  const firestore = new FakeFirestore(seedFor(fixture));
  const store = createGroupEControlStore(firestore);
  const accepted = await store.consumeAdmission({
    capability: fixture.capability('A'), uid: fixture.UID.A, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:10:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  });
  assert.equal(accepted.consumption.slot, 'A');
  assert.equal(accepted.receipt.consumptionRecordDigest, accepted.consumption.recordDigest);
  assert.equal(firestore.documents.size, 2);
  assert.deepEqual(firestore.transactionOptions, [{ maxAttempts: MAX_TRANSACTION_ATTEMPTS }]);
  assert.deepEqual(Object.keys(store), ['consumeAdmission']);
});

test('wrong UID, App ID, manifest, freshness, and capability provenance are rejected before marker creation', async () => {
  const fixture = createFixture();
  const cases = [
    { uid: fixture.UID.B },
    { appId: 'wrong-app' },
    { expectedRunManifestDigest: 'f'.repeat(64) },
    { consumedAt: '2030-01-01T12:31:00.000Z' },
    { capability: fixture.capability('A', { trainerHash: fixture.bindings.B.trainerHash }) }
  ];
  for (const overrides of cases) {
    const firestore = new FakeFirestore(seedFor(fixture));
    const store = createGroupEControlStore(firestore);
    await assert.rejects(store.consumeAdmission({
      capability: fixture.capability('A'), uid: fixture.UID.A, appId: fixture.FIREBASE_APP_ID,
      consumedAt: '2030-01-01T12:10:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest,
      ...overrides
    }));
    assert.equal(firestore.documents.size, 1);
  }
});

test('B requires the exact canonical A reconciliation after its signed boundary is verified', async () => {
  const fixture = createFixture();
  const markerA = fixture.consumption('A');
  const reconciliationA = fixture.reconciliationA(markerA);
  const bCapability = fixture.capability('B', {
    priorAReconciliationDigest: reconciliationA.reconciliationDigest,
    sessionBoundaryDigest: fixture.dependencies.sessionBoundaryDigest
  });
  const pathsA = controlPaths(fixture.RUN_ID, 'A');
  const missing = new FakeFirestore(seedFor(fixture));
  await assert.rejects(createGroupEControlStore(missing).consumeAdmission({
    capability: bCapability, uid: fixture.UID.B, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:15:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  }), /GROUP_E_A_RECONCILIATION_MISSING/);

  const wrongPriorCapability = fixture.capability('B', {
    priorAReconciliationDigest: 'f'.repeat(64),
    sessionBoundaryDigest: fixture.dependencies.sessionBoundaryDigest
  });
  const wrongPriorStore = new FakeFirestore(seedFor(fixture, { [pathsA.reconciliation]: reconciliationA }));
  await assert.rejects(createGroupEControlStore(wrongPriorStore).consumeAdmission({
    capability: wrongPriorCapability, uid: fixture.UID.B, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:15:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  }), /GROUP_E_B_DEPENDENCY_INVALID/);

  const firestore = new FakeFirestore(seedFor(fixture, { [pathsA.reconciliation]: reconciliationA }));
  const accepted = await createGroupEControlStore(firestore).consumeAdmission({
    capability: bCapability, uid: fixture.UID.B, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:15:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  });
  assert.equal(accepted.consumption.slot, 'B');
  assert.equal(accepted.reconciliationA.reconciliationDigest, reconciliationA.reconciliationDigest);
  assert.equal(accepted.reconciliationA.sessionBoundaryDigest, null);
});

test('duplicate and server-restart replays reject before creating a second marker', async () => {
  const fixture = createFixture();
  const firestore = new FakeFirestore(seedFor(fixture));
  const input = {
    capability: fixture.capability('A'), uid: fixture.UID.A, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:10:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  };
  await createGroupEControlStore(firestore).consumeAdmission(input);
  await assert.rejects(createGroupEControlStore(firestore).consumeAdmission(input), /GROUP_E_ADMISSION_CONSUMED/);
  assert.equal([...firestore.documents.keys()].filter((path) => path.includes('/consumptions/')).length, 1);
});

test('concurrent duplicate A and B transactions admit only one caller per slot', async () => {
  for (const slot of ['A', 'B']) {
    const fixture = createFixture();
    const reconciliationA = fixture.reconciliationA();
    const extra = slot === 'B' ? { [controlPaths(fixture.RUN_ID, 'A').reconciliation]: reconciliationA } : {};
    const firestore = new FakeFirestore(seedFor(fixture, extra));
    const capability = slot === 'A' ? fixture.capability('A') : fixture.capability('B', {
      priorAReconciliationDigest: reconciliationA.reconciliationDigest,
      sessionBoundaryDigest: fixture.dependencies.sessionBoundaryDigest
    });
    const input = { capability, uid: fixture.UID[slot], appId: fixture.FIREBASE_APP_ID,
      consumedAt: '2030-01-01T12:10:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest };
    const results = await Promise.allSettled([
      createGroupEControlStore(firestore).consumeAdmission(input),
      createGroupEControlStore(firestore).consumeAdmission(input)
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  }
});

test('transaction callback retries remain side-effect free and still produce one marker', async () => {
  const fixture = createFixture();
  const firestore = new FakeFirestore(seedFor(fixture), 3);
  const accepted = await createGroupEControlStore(firestore).consumeAdmission({
    capability: fixture.capability('A'), uid: fixture.UID.A, appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:10:00.000Z', expectedRunManifestDigest: fixture.run.manifestDigest
  });
  assert.equal(firestore.callbackCount, 3);
  assert.equal([...firestore.documents.keys()].filter((path) => path.endsWith('/consumptions/A')).length, 1);
  assert.equal(accepted.receipt.slot, 'A');
});

test('production adapter pins project/database and exports no operator write surface', () => {
  const constructed = [];
  class Firestore {
    constructor(options) { constructed.push(options); }
    doc() { return {}; }
    runTransaction() {}
  }
  const store = createProductionGroupEControlStore({ Firestore });
  assert.deepEqual(constructed, [{ projectId: 'trade-list-a4297', databaseId: 'e1-group-e-control' }]);
  assert.deepEqual(Object.keys(store), ['consumeAdmission']);
  assert.equal(store.createRun, undefined);
  assert.equal(store.createReconciliation, undefined);
  assert.equal(store.createCloseout, undefined);
});

test('operator and gateway create exactly the six immutable control records in the reviewed lifecycle', async () => {
  const fixture = createFixture();
  const firestore = new FakeFirestore();
  const operator = createGroupEOperatorControlStore(firestore);
  const gateway = createGroupEControlStore(firestore);

  await operator.createRun(fixture.run);
  await assert.rejects(operator.createRun(fixture.run), /ALREADY_EXISTS/);

  const admittedA = await gateway.consumeAdmission({
    capability: fixture.capability('A'),
    uid: fixture.UID.A,
    appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:10:00.000Z',
    expectedRunManifestDigest: fixture.run.manifestDigest
  });
  const reconciliationA = fixture.reconciliationA(admittedA.consumption);
  await operator.createReconciliation(reconciliationA);

  const capabilityB = fixture.capability('B', {
    priorAReconciliationDigest: reconciliationA.reconciliationDigest,
    sessionBoundaryDigest: fixture.dependencies.sessionBoundaryDigest
  });
  const admittedB = await gateway.consumeAdmission({
    capability: capabilityB,
    uid: fixture.UID.B,
    appId: fixture.FIREBASE_APP_ID,
    consumedAt: '2030-01-01T12:15:00.000Z',
    expectedRunManifestDigest: fixture.run.manifestDigest
  });
  const acceptedB = reconciliationB(fixture, admittedB.consumption, reconciliationA);
  await operator.createReconciliation(acceptedB);

  const closeout = createFinalCloseout({
    runId: fixture.RUN_ID,
    outcome: 'healthy',
    bReconciliationDigest: acceptedB.reconciliationDigest,
    blockedReason: null,
    restorationDigest: '7'.repeat(64),
    finalStateDigest: fixture.BASELINE.stateDigest,
    observationDigest: '8'.repeat(64),
    observationStartedAt: '2030-01-01T12:20:00.000Z',
    observationEndedAt: '2030-01-01T12:50:00.000Z',
    observationAccepted: true,
    unexpectedAdditionalAdmittedCalls: 0,
    prohibitedWrites: fixture.ZERO_WRITES,
    createdAt: '2030-01-01T12:51:00.000Z'
  });
  await operator.createCloseout(closeout);

  assert.deepEqual([...firestore.documents.keys()].sort(), [
    `runs/${fixture.RUN_ID}`,
    `runs/${fixture.RUN_ID}/closeouts/final`,
    `runs/${fixture.RUN_ID}/consumptions/A`,
    `runs/${fixture.RUN_ID}/consumptions/B`,
    `runs/${fixture.RUN_ID}/reconciliations/A`,
    `runs/${fixture.RUN_ID}/reconciliations/B`
  ]);
  assert.equal(firestore.documents.size, 6);
  assert.equal([...firestore.documents.keys()].every((value) => value.startsWith(`runs/${fixture.RUN_ID}`)), true);
  assert.deepEqual(firestore.transactionOptions, Array(5).fill({ maxAttempts: MAX_TRANSACTION_ATTEMPTS }));
  await assert.rejects(operator.createReconciliation(acceptedB), /GROUP_E_RECONCILIATION_EXISTS/);
  await assert.rejects(operator.createCloseout(closeout), /GROUP_E_CLOSEOUT_EXISTS/);
  assert.equal(firestore.documents.size, 6);
});

test('production operator adapter pins the named database and exposes no gateway consumption surface', () => {
  const constructed = [];
  class Firestore {
    constructor(options) { constructed.push(options); }
    doc() { return {}; }
    runTransaction() {}
  }
  const store = createProductionGroupEOperatorControlStore({ Firestore });
  assert.deepEqual(constructed, [{ projectId: 'trade-list-a4297', databaseId: 'e1-group-e-control' }]);
  assert.deepEqual(Object.keys(store), ['createRun', 'createReconciliation', 'createCloseout']);
  assert.equal(store.consumeAdmission, undefined);
});

test('blocked closeout cannot claim an unverified B reconciliation digest', async () => {
  const fixture = createFixture();
  const firestore = new FakeFirestore(seedFor(fixture));
  const closeout = createFinalCloseout({
    runId: fixture.RUN_ID,
    outcome: 'blocked',
    bReconciliationDigest: 'a'.repeat(64),
    blockedReason: 'OPERATOR_CONTAINMENT',
    restorationDigest: 'b'.repeat(64),
    finalStateDigest: fixture.BASELINE.stateDigest,
    observationDigest: 'c'.repeat(64),
    observationStartedAt: '2030-01-01T12:20:00.000Z',
    observationEndedAt: '2030-01-01T12:50:00.000Z',
    observationAccepted: true,
    unexpectedAdditionalAdmittedCalls: 0,
    prohibitedWrites: fixture.ZERO_WRITES,
    createdAt: '2030-01-01T12:51:00.000Z'
  });
  await assert.rejects(createGroupEOperatorControlStore(firestore).createCloseout(closeout),
    /GROUP_E_B_RECONCILIATION_MISSING/);
  assert.equal(firestore.documents.has(controlPaths(fixture.RUN_ID, 'A').closeout), false);
});
