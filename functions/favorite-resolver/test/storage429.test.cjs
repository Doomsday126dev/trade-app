'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQuota, MAX_CAS_ATTEMPTS, MAX_STORAGE_429_RETRIES, STORAGE_429_DELAY_MS } = require('../quota');
const { createHandler } = require('../handler');
const { LIMITS } = require('../contract');
function fixture() {
  let time = 1000, state = null, generation = 0;
  const reads = [], writes = [], delays = [];
  const store = {
    async read(subject) { reads.push(subject); return { generation, value: structuredClone(state) }; },
    async compareAndSwap(subject, expected, value) {
      writes.push({ subject, generation: expected, value: structuredClone(value), time });
      if (expected !== generation) throw Object.assign(new Error('conflict'), { code: 412 });
      state = structuredClone(value); generation++;
    }
  };
  const sleep = async ms => { delays.push(ms); time += ms; };
  return { store, reads, writes, delays, sleep, now: () => time,
    advance(ms) { time += ms; }, get state() { return state; },
    quota() { return createQuota(store, () => time, { sleep }); }
  };
}
function reject(code) { return Object.assign(new Error('private upstream details'), { code }); }
test('transient explicit storage429 retries identical CAS and charges one admission', async () => {
  for (const code of [429, '429']) {
    const f = fixture(), original = f.store.compareAndSwap;
    let calls = 0;
    f.store.compareAndSwap = async (...args) => { if (++calls === 1) { f.writes.push({ generation: args[1], value: structuredClone(args[2]) }); throw reject(code); } return original(...args); };
    const lease = await f.quota().acquire('caller', 3);
    assert.equal(calls, 2); assert.equal(f.reads.length, 1);
    assert.deepEqual(f.delays, [1100]);
    assert.deepEqual(f.writes[0].value, f.writes[1].value);
    assert.equal(f.writes[0].generation, f.writes[1].generation);
    assert.equal(f.state.requests, 1); assert.equal(f.state.work, 3);
    assert.deepEqual(Object.keys(f.state.leases), [lease.id]);
  }
});
test('exhausted storage429 retries fail closed with original error and no reset', async () => {
  const f = fixture(), error = reject(429); let calls = 0;
  f.store.compareAndSwap = async () => { calls++; throw error; };
  await assert.rejects(f.quota().acquire('caller', 1), value => value === error);
  assert.equal(calls, 1 + MAX_STORAGE_429_RETRIES);
  assert.deepEqual(f.delays, [1100, 1100]); assert.equal(f.state, null);
});
test('transport errors, application429 codes and read failures are never retried', async () => {
  for (const code of [500, 503, 'ECONNRESET', 'favorite/rate-limited', 'favorite/busy']) {
    const f = fixture(); let calls = 0;
    f.store.compareAndSwap = async () => { calls++; throw reject(code); };
    await assert.rejects(f.quota().acquire('caller', 1), { code });
    assert.equal(calls, 1); assert.deepEqual(f.delays, []);
  }
  const f = fixture(); f.store.read = async () => { throw reject(429); };
  await assert.rejects(f.quota().acquire('caller', 1), { code: 429 });
  assert.equal(f.writes.length, 0); assert.deepEqual(f.delays, []);
});
test('429 then generation contention re-reads and preserves both admissions', async () => {
  const f = fixture(), original = f.store.compareAndSwap; let calls = 0;
  const other = '00000000-0000-0000-0000-000000000000';
  f.store.compareAndSwap = async (subject, generation, value) => {
    calls++;
    if (calls === 1) {
      await original(subject, generation, { ...value, leases: { [other]: f.now() + LIMITS.leaseMs } });
      throw reject(429);
    }
    return original(subject, generation, value);
  };
  const lease = await f.quota().acquire('caller', 2);
  assert.equal(calls, 3); assert.equal(f.reads.length, 2);
  assert.equal(f.state.requests, 2); assert.equal(f.state.work, 4);
  assert.deepEqual(Object.keys(f.state.leases).sort(), [other, lease.id].sort());
  assert.deepEqual(f.writes.map(value => value.generation), [0, 0, 1]);
});
test('a same-lease receipt discovered after contention is not charged or written twice', async () => {
  const f = fixture(), original = f.store.compareAndSwap; let calls = 0;
  f.store.compareAndSwap = async (...args) => {
    calls++;
    if (calls === 1) { await original(...args); throw reject(429); }
    return original(...args);
  };
  const lease = await f.quota().acquire('caller', 4);
  assert.equal(calls, 2); assert.equal(f.reads.length, 2);
  assert.equal(f.state.requests, 1); assert.equal(f.state.work, 4);
  assert.deepEqual(Object.keys(f.state.leases), [lease.id]);
});
test('429 and412 share the existing six-CAS ceiling with at most two delays', async () => {
  const f = fixture(); let calls = 0;
  f.store.compareAndSwap = async () => { calls++; throw reject(calls === 1 || calls === 3 ? 429 : 412); };
  await assert.rejects(f.quota().acquire('caller', 1), { code: 'favorite/quota-unavailable' });
  assert.equal(calls, MAX_CAS_ATTEMPTS); assert.equal(f.delays.length, MAX_STORAGE_429_RETRIES);
  assert.ok(f.delays.reduce((a, b) => a + b, 0) <= 2200);
});
test('insufficient deadline budget does not sleep or start another CAS', async () => {
  const f = fixture(); let calls = 0;
  f.store.compareAndSwap = async () => { calls++; throw reject(429); };
  await assert.rejects(f.quota().acquire('caller', 1, { deadlineAt: f.now() + STORAGE_429_DELAY_MS }), { code: 429 });
  assert.equal(calls, 1); assert.deepEqual(f.delays, []);
});
test('overslept deadline and cancelled request cannot start a late retry', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(); let calls = 0, active = true;
    f.store.compareAndSwap = async () => { calls++; throw reject(429); };
    const quota = createQuota(f.store, f.now, { sleep: async () => { if (cancel) active = false; else f.advance(LIMITS.deadlineMs); } });
    await assert.rejects(quota.acquire('caller', 1, { deadlineAt: f.now() + LIMITS.deadlineMs, current: () => active }), { code: 'favorite/unavailable' });
    assert.equal(calls, 1); assert.equal(f.state, null);
  }
});
test('a slow read crossing deadline cannot admit a new write', async () => {
  const f = fixture(), original = f.store.read;
  f.store.read = async (...args) => { const value = await original(...args); f.advance(LIMITS.deadlineMs); return value; };
  await assert.rejects(f.quota().acquire('caller', 1), { code: 'favorite/unavailable' });
  assert.equal(f.writes.length, 0);
});
test('release retry removes only the lease, never refunds requests or work', async () => {
  const f = fixture(), quota = f.quota(), lease = await quota.acquire('caller', 3), original = f.store.compareAndSwap;
  let calls = 0;
  f.store.compareAndSwap = async (...args) => { if (++calls === 1) throw reject(429); return original(...args); };
  await quota.release(lease);
  assert.equal(calls, 2); assert.deepEqual(f.state.leases, {});
  assert.equal(f.state.requests, 1); assert.equal(f.state.work, 3);
});
function response() { return { set() { return this; }, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } }; }
test('handler propagates its original deadline and preserves HTTP200 on recovery', async () => {
  const f = fixture(), original = f.store.compareAndSwap; let calls = 0;
  f.store.compareAndSwap = async (...args) => { if (++calls === 1) throw reject(429); return original(...args); };
  const quota = f.quota(), seen = [];
  const handler = createHandler({ enabled: () => true, origins: ['https://allowed.example'], now: f.now,
    verifyAuth: async () => ({ uid: 'caller' }), verifyAppCheck: async () => true,
    quota: {
      acquire(uid, count, options) { seen.push(options.deadlineAt); return quota.acquire(uid, count, options); },
      release(lease, options) { seen.push(options.deadlineAt); return quota.release(lease, options); }
    }, resolve: async () => ({ ok: true })
  });
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://allowed.example', 'content-type': 'application/json', authorization: 'Bearer test', 'x-firebase-appcheck': 'test' }, body: { handles: ['Target'] } }, res);
  assert.equal(res.code, 200); assert.deepEqual(res.value, { version: 1, results: { ok: true } });
  assert.deepEqual(seen, [21000, 21000]);
  assert.equal(f.state.requests, 1); assert.equal(f.state.work, 1); assert.deepEqual(f.state.leases, {});
});
