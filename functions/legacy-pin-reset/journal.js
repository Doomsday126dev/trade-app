'use strict';
const { fail } = require('./reset');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value > 0;
function validRecord(record) {
  if (!object(record)) return false;
  const keys = ['requestId', 'username', 'targetUid', 'callerUid', 'identityFingerprint', 'credentialFingerprint', 'status', 'startedAt'];
  if (record.status !== 'pending') keys.push('finishedAt');
  return Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)) &&
    typeof record.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.requestId) &&
    typeof record.username === 'string' && /^[A-Za-z0-9 _-]{1,64}$/.test(record.username) && record.username.trim() === record.username &&
    uid(record.targetUid) && uid(record.callerUid) && record.targetUid !== record.callerUid &&
    hash(record.identityFingerprint) && hash(record.credentialFingerprint) &&
    ['pending', 'completed', 'ambiguous', 'aborted'].includes(record.status) && time(record.startedAt) &&
    (record.status === 'pending' || (time(record.finishedAt) && record.finishedAt >= record.startedAt));
}
function validateLedger(ledger) {
  if (!object(ledger) || Object.keys(ledger).length !== 2 || ledger.schemaVersion !== 1 ||
      !Array.isArray(ledger.records) || ledger.records.length > 1000 || ledger.records.some(r => !validRecord(r)) ||
      new Set(ledger.records.map(r => r.requestId)).size !== ledger.records.length) fail('reset/journal-invalid');
  const locks = ledger.records.filter(r => ['pending', 'ambiguous'].includes(r.status)).map(r => r.targetUid);
  if (new Set(locks).size !== locks.length) fail('reset/journal-invalid');
}

// One bounded ledger serializes requests AND target locks. No lease expires or
// takes over a possibly executed password update. The bucket is not product data.
function createJournal(store) {
  async function read() {
    const current = await store.read();
    validateLedger(current.value);
    return current;
  }
  async function change(fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await read(), result = fn(current.value);
      if (!result.write) return result.value;
      validateLedger(current.value);
      try { await store.compareAndSwap(current.generation, current.value); return result.value; }
      catch (error) { if (error.code !== 412) fail('reset/journal-unavailable'); }
    }
    fail('reset/journal-busy');
  }
  return Object.freeze({
    async get(requestId) { return (await read()).value.records.find(r => r.requestId === requestId) || null; },
    reserve(record) {
      if (!validRecord(record) || record.status !== 'pending') fail('reset/journal-invalid');
      return change(ledger => {
        const existing = ledger.records.find(r => r.requestId === record.requestId);
        if (existing) return { value: { acquired: false, record: existing } };
        if (ledger.records.some(r => r.targetUid === record.targetUid && ['pending', 'ambiguous'].includes(r.status))) fail('reset/target-locked');
        if (ledger.records.length >= 1000) fail('reset/journal-full');
        ledger.records.push(record);
        return { write: true, value: { acquired: true, record } };
      });
    },
    finish(requestId, status, finishedAt) {
      return change(ledger => {
        const record = ledger.records.find(r => r.requestId === requestId);
        if (!record) fail('reset/journal-invalid');
        if (record.status === 'completed') return { value: undefined };
        if (record.status !== 'pending' || !['completed', 'ambiguous', 'aborted'].includes(status)) fail('reset/journal-invalid');
        record.status = status; record.finishedAt = finishedAt;
        return { write: true, value: undefined };
      });
    }
  });
}

function createGcsStore(bucket) {
  const name = 'legacy-pin-reset/v1/ledger.json';
  return {
    async read() {
      // The ledger MUST be provisioned once. Missing/deleted journal never means
      // empty: otherwise loss of storage could replay a completed mutation.
      const [metadata] = await bucket.file(name).getMetadata();
      if (typeof metadata.generation !== 'string' || !/^[1-9][0-9]*$/.test(metadata.generation) ||
          !Number.isSafeInteger(Number(metadata.size)) || Number(metadata.size) < 0 || Number(metadata.size) > 1024 * 1024) fail('reset/journal-invalid');
      const [bytes] = await bucket.file(name, { generation: metadata.generation }).download();
      if (bytes.length > 1024 * 1024) fail('reset/journal-invalid');
      return { generation: metadata.generation, value: JSON.parse(bytes.toString('utf8')) };
    },
    async compareAndSwap(generation, value) {
      await bucket.file(name).save(JSON.stringify(value), { resumable: false, contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: generation } });
    }
  };
}
module.exports = { createJournal, createGcsStore };
