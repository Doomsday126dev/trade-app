'use strict';
const { randomUUID } = require('node:crypto');
const { LIMITS, digest, exact, plain, fail } = require('./contract');
const PREFIX = 'favorite-resolver/v1/';
const MAX_BYTES = 4096;
const MAX_CAS_ATTEMPTS = 6, MAX_STORAGE_429_RETRIES = 2, STORAGE_429_DELAY_MS = 1100;
function createGcsQuotaStore(bucket, diagnostics) {
  return Object.freeze({
    async read(subject) {
      const name = `${PREFIX}${subject}.json`;
      let meta;
      try { [meta] = await bucket.file(name).getMetadata(); }
      catch (error) { if (error.code === 404) return { generation: 0, value: null }; diagnostics?.report('quota-metadata-read', error); throw error; }
      {
        if (!/^[1-9][0-9]*$/.test(meta.generation || '') || !Number.isSafeInteger(Number(meta.size)) || Number(meta.size) < 0 || Number(meta.size) > MAX_BYTES) fail('favorite/quota-unavailable');
        let bytes;
        try { [bytes] = await bucket.file(name, { generation: meta.generation }).download(); }
        catch (error) { diagnostics?.report('quota-generation-read', error); throw error; }
        if (bytes.length > MAX_BYTES) fail('favorite/quota-unavailable');
        return { generation: meta.generation, value: JSON.parse(bytes.toString('utf8')) };
      }
    },
    async compareAndSwap(subject, generation, value) {
      const bytes = JSON.stringify(value); if (Buffer.byteLength(bytes) > MAX_BYTES) fail('favorite/quota-unavailable');
      try { await bucket.file(`${PREFIX}${subject}.json`).save(bytes, { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: generation } }); }
      catch (error) { if (error?.code !== 412) diagnostics?.report('quota-compare-and-swap', error); throw error; }
    }
  });
}
function valid(value) {
  return exact(value, ['version', 'windowStart', 'requests', 'work', 'leases']) && value.version === 1 &&
    [value.windowStart, value.requests, value.work].every(n => Number.isSafeInteger(n) && n >= 0) &&
    value.requests <= LIMITS.requests && value.work <= LIMITS.work && plain(value.leases) &&
    Object.entries(value.leases).length <= LIMITS.callerConcurrency && Object.entries(value.leases).every(([id, expires]) => /^[a-f0-9-]{36}$/.test(id) && Number.isSafeInteger(expires) && expires > 0);
}
function createQuota(store, now = Date.now, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  async function update(subject, change, { deadlineAt = now() + LIMITS.deadlineMs, current = () => true, alreadyApplied } = {}) {
    const check = () => { if (!current() || now() >= deadlineAt) fail('favorite/unavailable'); };
    let snapshot, value, result, throttledRetries = 0;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      check();
      if (!snapshot) {
        snapshot = await store.read(subject); check();
        const time = now();
        if (snapshot.value !== null && !valid(snapshot.value)) fail('favorite/quota-unavailable');
        const prior = snapshot.value || { version: 1, windowStart: time, requests: 0, work: 0, leases: {} };
        if (prior.windowStart > time) fail('favorite/quota-unavailable');
        const leases = Object.fromEntries(Object.entries(prior.leases).filter(([, expiry]) => expiry > time));
        value = time - prior.windowStart >= LIMITS.windowMs ? { version: 1, windowStart: time, requests: 0, work: 0, leases } : { ...prior, leases };
        const applied = alreadyApplied?.(value);
        if (applied) return applied;
        result = change(value, time);
      }
      check();
      try { await store.compareAndSwap(subject, snapshot.generation, value); return result; }
      catch (error) {
        if (error.code === 412) { snapshot = null; continue; }
        // Retry only explicit storage throttling, never ambiguous transport errors.
        // Keep the exact bytes/lease/generation; 412 re-reads authoritative state.
        if (![429, '429'].includes(error.code) || throttledRetries >= MAX_STORAGE_429_RETRIES || attempt + 1 >= MAX_CAS_ATTEMPTS) throw error;
        check();
        if (now() + STORAGE_429_DELAY_MS >= deadlineAt) throw error;
        throttledRetries++;
        await sleep(STORAGE_429_DELAY_MS);
        check();
      }
    }
    fail('favorite/quota-unavailable');
  }
  return Object.freeze({
    async acquire(uid, work, options = {}) {
      if (!Number.isInteger(work) || work < 1 || work > LIMITS.handles) fail('favorite/request-invalid');
      const subject = digest(`favorite-quota-v1\0${uid}`), id = randomUUID();
      return update(subject, (value, time) => {
        if (value.requests >= LIMITS.requests || value.work + work > LIMITS.work) fail('favorite/rate-limited', Math.max(1, Math.ceil((value.windowStart + LIMITS.windowMs - time) / 1000)));
        if (Object.keys(value.leases).length >= LIMITS.callerConcurrency) fail('favorite/busy', 2);
        value.requests++; value.work += work; value.leases[id] = time + LIMITS.leaseMs;
        return Object.freeze({ subject, id, expiresAt: time + LIMITS.leaseMs });
      }, { ...options, alreadyApplied: value => value.leases[id] ? Object.freeze({ subject, id, expiresAt: value.leases[id] }) : null });
    },
    async release(lease, options = {}) { await update(lease.subject, value => { delete value.leases[lease.id]; }, options); }
  });
}
module.exports = { PREFIX, MAX_BYTES, MAX_CAS_ATTEMPTS, MAX_STORAGE_429_RETRIES, STORAGE_429_DELAY_MS, createGcsQuotaStore, createQuota, valid };
