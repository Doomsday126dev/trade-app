'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { guardEnvelope } = require('../envelope');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

test('pinned query parser safely handles constructor-shaped untrusted values', () => {
  const qs = require('qs');
  assert.equal(require('qs/package.json').version, '6.16.0');
  const parsed = qs.parse('x%5Bconstructor%5D%5BisBuffer%5D=y', { plainObjects: true });
  assert.doesNotThrow(() => qs.stringify(parsed));
});

test('installed Admin verifier rejects foreign project, issuer and malformed subjects without network', async () => {
  const app = initializeApp({ projectId: 'trade-list-a4297' }, 'reset-token-audit'), auth = getAuth(app);
  const now = Math.floor(Date.now() / 1000), base = { aud: 'trade-list-a4297', iss: 'https://securetoken.google.com/trade-list-a4297', sub: 'owner', iat: now, exp: now + 3600, auth_time: now };
  try {
    for (const change of [{ aud: 'another-project' }, { iss: 'https://securetoken.google.com/another-project' }, { sub: null }, { sub: '' }]) {
      const token = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic' })).toString('base64url'), Buffer.from(JSON.stringify({ ...base, ...change })).toString('base64url'), 'fake'].join('.');
      await assert.rejects(auth.verifyIdToken(token, true), { code: 'auth/argument-error' });
    }
    await assert.rejects(auth.verifyIdToken('not-a-token', true));
    auth.idTokenVerifier.verifyJWT = async () => ({ ...base, uid: 'owner' });
    auth.getUser = async () => ({ disabled: false, tokensValidAfterTime: new Date((now + 1) * 1000).toISOString() });
    await assert.rejects(auth.verifyIdToken('synthetic', true), { code: 'auth/id-token-revoked' });
  } finally { await deleteApp(app); }
});

function middleware(appToken = 'valid') {
  const logs = [], sdk = {};
  const file = path.resolve(__dirname, '../node_modules/firebase-functions/lib/common/providers/https.js');
  const modules = {
    cors: () => (_req, _res, next) => next(),
    '../../logger': Object.fromEntries(['debug', 'warn', 'error'].map(key => [key, (...args) => logs.push(args)])),
    'firebase-admin/app-check': { getAppCheck: () => ({ verifyToken: async (_token, options) => {
      assert.equal(options.consume, true); if (appToken === 'invalid') throw new Error('Invalid App Check');
      return { appId: 'synthetic-app', alreadyConsumed: false };
    } }) },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => ({ uid: 'owner' }) }) },
    '../app': { getApp: () => ({}) }, '../debug': { isDebugFeatureEnabled: () => false }
  };
  vm.runInNewContext(readFileSync(file, 'utf8'), { exports: sdk, Buffer, AbortController, setTimeout, clearTimeout,
    require: key => { assert.ok(Object.hasOwn(modules, key), key); return modules[key]; } }, { filename: file });
  let calls = 0;
  const callable = sdk.onCallHandler({ cors: {}, enforceAppCheck: true, consumeAppCheckToken: true }, async () => { calls++; return { status: 'completed' }; }, 'gcfv2');
  const run = async (body, guarded = true) => {
    const headers = { 'content-type': 'application/json', authorization: 'Bearer synthetic', ...(appToken === 'missing' ? {} : { 'x-firebase-appcheck': 'synthetic' }) };
    const req = { method: 'POST', body, headers, header: key => headers[key.toLowerCase()] }, res = new EventEmitter();
    res.status = code => { res.code = code; return res; }; res.send = value => { res.value = value; res.emit('finish'); return res; };
    await (guarded ? guardEnvelope(callable) : callable)(req, res); return res;
  };
  return { run, logs, calls: () => calls };
}
test('invalid and missing App Check are rejected by installed callable middleware before dispatch', async () => {
  for (const token of ['invalid', 'missing']) {
    const f = middleware(token), res = await f.run({ data: { action: 'reset', pin: '001234' } });
    assert.equal(res.code, 401); assert.equal(f.calls(), 0); assert.ok(!JSON.stringify(f.logs).includes('001234'));
  }
});
test('malformed envelope credential leakage in SDK is intercepted before any log or dispatch', async () => {
  const baseline = middleware(); await baseline.run({ pin: '001234' }, false);
  assert.ok(JSON.stringify(baseline.logs).includes('001234'), 'Reproduces the installed SDK leak without the guard');
  for (const body of [{ pin: '001234' }, { data: { '@type': 'bad', value: '001234' } }, { data: { pin: { '@type': 'bad', value: '001234' } } }]) {
    const f = middleware(), res = await f.run(body);
    assert.equal(res.code, 400); assert.equal(f.calls(), 0); assert.deepEqual(f.logs, []);
  }
  const f = middleware(), body = { data: { action: 'inspect', username: 'Trainer' } };
  assert.equal((await f.run(body)).code, 200); assert.equal(f.calls(), 1);
});
test('envelope guard preserves callable deployment descriptors', () => {
  const callable = () => {}, endpoint = { platform: 'gcfv2', callableTrigger: {} };
  callable.__endpoint = endpoint; Object.defineProperty(callable, '__trigger', { get: () => ({ platform: 'gcfv2' }) });
  const guarded = guardEnvelope(callable);
  assert.equal(guarded.__endpoint, endpoint);
  assert.equal(Object.getOwnPropertyDescriptor(guarded, '__trigger').get, Object.getOwnPropertyDescriptor(callable, '__trigger').get);
});
