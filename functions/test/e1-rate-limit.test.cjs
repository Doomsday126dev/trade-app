'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreE1AuthorityAdapter } = require('../e1-authority-service/firestoreE1AuthorityAdapter');

function firestoreHarness() {
  const state = new Map();
  const ref = (documentPath) => ({ path: documentPath, async get() { return snapshot(documentPath); } });
  const snapshot = (documentPath) => ({
    exists: state.has(documentPath),
    data() { return structuredClone(state.get(documentPath)); }
  });
  const firestore = {
    doc: ref,
    async runTransaction(callback) {
      const writes = [];
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
    }
  };
  return { adapter: createFirestoreE1AuthorityAdapter({ firestore }), state };
}

function hash(index) {
  return index.toString(16).padStart(64, '0');
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
