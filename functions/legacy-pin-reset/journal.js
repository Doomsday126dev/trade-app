'use strict';
const { fail } = require('./reset');

// One bounded ledger serializes requests AND target locks. No lease expires or
// takes over a possibly executed password update. The bucket is not product data.
function createJournal(store) {
  async function read() {
    const current = await store.read();
    const ledger = current.value;
    if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.records) || ledger.records.length > 1000 ||
        new Set(ledger.records.map(r => r.requestId)).size !== ledger.records.length || ledger.records.some(r =>
          !r.requestId || !r.targetUid || !['pending', 'completed', 'ambiguous', 'aborted'].includes(r.status))) fail('reset/journal-invalid');
    return current;
  }
  async function change(fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await read(), result = fn(current.value);
      if (!result.write) return result.value;
      try { await store.compareAndSwap(current.generation, current.value); return result.value; }
      catch (error) { if (error.code !== 412) fail('reset/journal-unavailable'); }
    }
    fail('reset/journal-busy');
  }
  return Object.freeze({
    async get(requestId) { return (await read()).value.records.find(r => r.requestId === requestId) || null; },
    reserve(record) {
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
      if (Number(metadata.size) > 1024 * 1024) fail('reset/journal-invalid');
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
