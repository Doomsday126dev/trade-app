'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFailureDiagnostics, dependencyStatus, OPERATIONS } = require('../diagnostics');
const { createGcsQuotaStore } = require('../quota');
const { createIdentityReader } = require('../identity');
const { createGcsReplayStore } = require('../app-check');
const { createHandler } = require('../handler');
function collector() {
  const events = [];
  return { events, diagnostics: createFailureDiagnostics(event => events.push(event)) };
}
function privateError(code) {
  return Object.assign(new Error('SECRET token uid handle object/path body'), {
    code, headers: { authorization: 'SECRET' }, body: { uid: 'SECRET' },
    request: { url: 'https://secret.example/path?token=SECRET' }, statusCode: 403
  });
}
test('persistent payload contains only finite operation and status values', () => {
  const { events, diagnostics } = collector();
  for (const operation of OPERATIONS) diagnostics.report(operation, privateError(429));
  assert.equal(events.length, OPERATIONS.length);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['dependencyStatus', 'operation']);
    assert.equal(event.dependencyStatus, 429);
    assert.ok(Object.isFrozen(event));
  }
  assert.doesNotMatch(JSON.stringify(events), /SECRET|token|uid|handle|path|body|authorization|url/);
});
test('untrusted operation and error codes are never serialized or coerced', () => {
  const { events, diagnostics } = collector();
  diagnostics.report('SECRET/private/path', privateError(503));
  diagnostics.report('request', privateError('SECRET/private/path'));
  const hostile = { get code() { throw new Error('SECRET'); }, toJSON() { throw new Error('SECRET'); } };
  diagnostics.report('request', hostile);
  diagnostics.report('request', { code: { toString() { throw new Error('SECRET'); } } });
  assert.deepEqual(events, Array.from({ length: 3 }, () => ({ operation: 'request', dependencyStatus: 0 })));
  assert.equal(dependencyStatus({ code: '503' }), 503);
  assert.equal(dependencyStatus({ code: 418 }), 0);
});
test('emitter failure preserves the exact thrown dependency error and success value', async () => {
  const diagnostics = createFailureDiagnostics(() => { throw new Error('log unavailable'); });
  const error = privateError(503);
  await assert.rejects(diagnostics.observe('auth-verification', async () => { throw error; }), value => value === error);
  const value = {};
  assert.equal(await diagnostics.observe('auth-verification', async () => value), value);
});
test('one error escaping nested boundaries produces one precise event', async () => {
  const { events, diagnostics } = collector(), error = privateError(404);
  await assert.rejects(diagnostics.observe('request', () => diagnostics.observe('quota-generation-read', async () => { throw error; })), value => value === error);
  assert.deepEqual(events, [{ operation: 'quota-generation-read', dependencyStatus: 404 }]);
});
test('quota adapter distinguishes metadata, obsolete generation and write throttling without retrying', async () => {
  for (const [operation, code] of [['quota-metadata-read', 503], ['quota-generation-read', 404], ['quota-compare-and-swap', 429]]) {
    const { events, diagnostics } = collector(), error = privateError(code);
    let calls = 0;
    const bucket = { file() { return {
      async getMetadata() { if (operation === 'quota-metadata-read') { calls++; throw error; } return [{ generation: '7', size: '2' }]; },
      async download() { calls++; throw error; }, async save() { calls++; throw error; }
    }; } };
    const store = createGcsQuotaStore(bucket, diagnostics);
    await assert.rejects(operation === 'quota-compare-and-swap' ? store.compareAndSwap('SECRET', 7, {}) : store.read('SECRET'), value => value === error);
    assert.equal(calls, 1);
    assert.deepEqual(events, [{ operation, dependencyStatus: code }]);
  }
});
test('expected absent metadata, CAS conflicts and replay rejection remain silent', async () => {
  const { events, diagnostics } = collector();
  const bucket = { file() { return {
    async getMetadata() { throw privateError(404); }, async save() { throw privateError(412); }
  }; } };
  const store = createGcsQuotaStore(bucket, diagnostics);
  assert.deepEqual(await store.read('SECRET'), { generation: 0, value: null });
  await assert.rejects(store.compareAndSwap('SECRET', 0, {}), { code: 412 });
  assert.equal(await createGcsReplayStore(bucket, diagnostics).consume('SECRET'), false);
  assert.deepEqual(events, []);
});
test('replay storage and scalar/fence read failures report no input context', async () => {
  const { events, diagnostics } = collector(), error = privateError(503);
  await assert.rejects(createGcsReplayStore({ file() { return { async save() { throw error; } }; } }, diagnostics).consume('SECRET'), value => value === error);
  for (const [method, operation] of [['callerHandle', 'identity-scalar-read'], ['isFenced', 'identity-fence-read']]) {
    const failure = privateError(503);
    await assert.rejects(createIdentityReader({ ref() { return { async get() { throw failure; } }; } }, diagnostics)[method]('SECRET'), value => value === failure);
    assert.equal(events.at(-1).operation, operation);
  }
  assert.equal(events.length, 3);
  assert.doesNotMatch(JSON.stringify(events), /SECRET/);
});
function response() { return { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } }; }
test('handler keeps HTTP response and quota lifecycle unchanged on caught failure', async () => {
  const { events, diagnostics } = collector(), error = privateError(429);
  let acquisitions = 0, releases = 0;
  const handler = createHandler({ enabled: () => true, origins: ['https://allowed.example'],
    verifyAuth: async () => ({ uid: 'caller' }), verifyAppCheck: async () => true,
    quota: { async acquire() { acquisitions++; return {}; }, async release() { releases++; } },
    resolve: () => diagnostics.observe('identity-scalar-read', async () => { throw error; }), diagnostics
  });
  const res = response();
  await handler({ method: 'POST', headers: { origin: 'https://allowed.example', 'content-type': 'application/json', authorization: 'Bearer SECRET', 'x-firebase-appcheck': 'SECRET' }, body: { handles: ['SECRET'] } }, res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.value, { code: 'favorite/unavailable' });
  assert.equal(acquisitions, 1); assert.equal(releases, 1);
  assert.deepEqual(events, [{ operation: 'identity-scalar-read', dependencyStatus: 429 }]);
});
