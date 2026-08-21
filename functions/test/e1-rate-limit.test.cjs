'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreE1AuthorityAdapter } = require('../e1-authority-service/firestoreE1AuthorityAdapter');

function firestoreHarness() {
  const state = new Map();
  let transactionTail = Promise.resolve();
  const ref = (documentPath) => ({ path: documentPath, async get() { return snapshot(documentPath); } });
  const snapshot = (documentPath) => ({
    exists: state.has(documentPath),
    data() { return structuredClone(state.get(documentPath)); }
  });
  const firestore = {
    doc: ref,
    async runTransaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      const writes = [];
      try {
        const result = await callback({
          async get(documentRef) { return snapshot(documentRef.path); },
          create(documentRef, value) {
            if (state.has(documentRef.path)) throw new Error('already exists');
            writes.push(['set', documentRef.path, structuredClone(value)]);
          },
          update(documentRef, value) {
            if (!state.has(documentRef.path)) throw new Error('missing');
            writes.push(['set', documentRef.path, structuredClone(value)]);
          }
        });
        for (const [, documentPath, value] of writes) state.set(documentPath, value);
        return result;
      } finally { release(); }
    }
  };
  return { adapter: createFirestoreE1AuthorityAdapter({ firestore }), state };
}

function hash(index) {
  return index.toString(16).padStart(64, '0');
}

function reservation(requestId = 'request-replay-0001', fingerprint = hash(100)) {
  return {
    uid: 'firebase_uid_a',
    requestId,
    canonicalTrainerName: 'ReplayTrainer',
    normalizedTrainerName: 'replaytrainer',
    handleKey: 'v1_7265706c6179747261696e6572',
    legacyUsername: 'ReplayTrainer',
    legacyAuthVersion: 1,
    fingerprint
  };
}

async function admittedReservation(adapter, request, at) {
  const replayOnly = await adapter.operationRequestExists({
    operation: 'reserveTrainerHandle', uid: request.uid, requestId: request.requestId
  });
  if (!replayOnly) {
    await adapter.consumeRateLimit({
      operation: 'reserveTrainerHandle', subjectHash: 'a'.repeat(16),
      attemptHash: hash(request.requestId.endsWith('0001') ? 1 : 2), limit: 5, windowMs: 900_000, at
    });
  }
  return adapter.reserveTrainerHandle(request, { replayOnly });
}

test('durable limiter uses one rolling bounded document and exact replay consumes no additional quota', async () => {
  const { adapter, state } = firestoreHarness();
  const base = { operation: 'reserveTrainerHandle', subjectHash: 'a'.repeat(16), limit: 5, windowMs: 900_000, at: 1_800_000 };
  assert.equal((await adapter.consumeRateLimit({ ...base, attemptHash: hash(1) })).consumed, true);
  assert.equal((await adapter.consumeRateLimit({ ...base, attemptHash: hash(1) })).consumed, false);
  for (let index = 2; index <= 5; index += 1) await adapter.consumeRateLimit({ ...base, attemptHash: hash(index) });
  await assert.rejects(adapter.consumeRateLimit({ ...base, attemptHash: hash(6) }), (error) => error.code === 'e1/rate-limit-exceeded');
  assert.equal(state.size, 1);
  const document = [...state.values()][0];
  assert.equal(document.count, 5);
  assert.equal(document.attemptHashes.length, 5);
  assert.equal(JSON.stringify(document).includes('firebase_uid'), false);
});

test('rolling windows replace old attempts instead of accumulating one document per request', async () => {
  const { adapter, state } = firestoreHarness();
  const input = { operation: 'readAccountFoundation', subjectHash: 'b'.repeat(16), limit: 60, windowMs: 900_000 };
  for (let index = 0; index < 60; index += 1) await adapter.consumeRateLimit({ ...input, at: 1_000, attemptHash: hash(index + 1) });
  await assert.rejects(adapter.consumeRateLimit({ ...input, at: 1_000, attemptHash: hash(61) }), /rate-limit-exceeded/);
  const next = await adapter.consumeRateLimit({ ...input, at: 901_000, attemptHash: hash(61) });
  assert.equal(next.remaining, 59);
  assert.equal(state.size, 1);
  assert.equal([...state.values()][0].attemptHashes.length, 1);
});

test('same-window and cross-window exact operation replays preserve the limiter and original result', async () => {
  const { adapter, state } = firestoreHarness();
  const request = reservation();
  const first = await admittedReservation(adapter, request, 1_000);
  const ratePath = 'rateLimits/reserveTrainerHandle_aaaaaaaaaaaaaaaa';
  const initialRateLimit = structuredClone(state.get(ratePath));
  const initialAuthority = [...state.entries()].filter(([key]) => !key.startsWith('rateLimits/'));

  const sameWindow = await admittedReservation(adapter, request, 2_000);
  const crossWindow = await admittedReservation(adapter, request, 901_000);
  assert.equal(first.status, 'reserved');
  assert.deepEqual(sameWindow, { ...first, replay: true });
  assert.deepEqual(crossWindow, { ...first, replay: true });
  assert.deepEqual(state.get(ratePath), initialRateLimit);
  assert.deepEqual([...state.entries()].filter(([key]) => !key.startsWith('rateLimits/')), initialAuthority);

  await assert.rejects(admittedReservation(adapter, { ...request, fingerprint: hash(101) }, 1_801_000),
    (error) => error.code === 'e1/replay-mismatch');
  assert.deepEqual(state.get(ratePath), initialRateLimit);

  const nextRequest = reservation('request-replay-0002', hash(102));
  const next = await admittedReservation(adapter, nextRequest, 1_801_000);
  assert.equal(next.status, 'idempotent');
  assert.equal(next.replay, undefined);
  assert.equal(state.get(ratePath).windowStart, 1_800_000);
  assert.deepEqual(state.get(ratePath).attemptHashes, [hash(2)]);
});

test('replay-only execution fails closed if the operation request disappears before its transaction', async () => {
  const { adapter, state } = firestoreHarness();
  const request = reservation();
  await assert.rejects(adapter.reserveTrainerHandle(request, { replayOnly: true }),
    (error) => error.code === 'e1/replay-not-found');
  assert.equal(state.size, 0);
});

test('concurrent duplicate first attempts remain bounded by one limiter consumption and one authority result', async () => {
  const { adapter, state } = firestoreHarness();
  const request = reservation();
  const results = await Promise.all([
    admittedReservation(adapter, request, 1_000),
    admittedReservation(adapter, request, 1_000)
  ]);
  assert.deepEqual(results.map((result) => result.replay === true ? 'replay' : result.status).sort(), ['replay', 'reserved']);
  const rate = state.get('rateLimits/reserveTrainerHandle_aaaaaaaaaaaaaaaa');
  assert.equal(rate.count, 1);
  assert.deepEqual(rate.attemptHashes, [hash(1)]);
  assert.equal([...state.keys()].filter((key) => key.startsWith('accounts/')).length, 1);
  assert.equal([...state.keys()].filter((key) => key.startsWith('trainerHandles/')).length, 1);
  assert.equal([...state.keys()].filter((key) => key.startsWith('operationRequests/')).length, 1);
});

test('repair daily and operator mutation minute limits match the reviewed policy', async () => {
  const { adapter } = firestoreHarness();
  for (const [operation, limit, windowMs, subject] of [
    ['repairAccountFoundation', 3, 86_400_000, 'c'.repeat(16)],
    ['applyMigrationManifest', 10, 60_000, 'd'.repeat(16)],
    ['freezeIdentityConflict', 10, 60_000, 'e'.repeat(16)]
  ]) {
    for (let index = 1; index <= limit; index += 1) {
      await adapter.consumeRateLimit({ operation, subjectHash: subject, attemptHash: hash(index), limit, windowMs, at: 1_000 });
    }
    await assert.rejects(adapter.consumeRateLimit({ operation, subjectHash: subject, attemptHash: hash(limit + 1), limit, windowMs, at: 1_000 }),
      /rate-limit-exceeded/);
  }
});
