'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
function fixture(env = {}) {
  let options, handler, calls = 0, verified = 0, rejectToken = false, dispatchFailure;
  const logs = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const auth = { verifyIdToken: async (token, revoked) => { verified++; assert.equal(token, 'synthetic-token'); assert.equal(revoked, true);
    if (rejectToken) throw new Error('Sensitive SDK detail'); return { uid: 'owner-uid', auth_time: 123 }; } };
  const modules = {
    'firebase-admin/app': { initializeApp: () => ({}), applicationDefault: () => ({}), getApp: () => ({}) },
    'firebase-admin/auth': { getAuth: () => auth }, 'firebase-admin/database': { getDatabase: () => ({}) },
    'firebase-admin/firestore': { getFirestore: () => ({}) },
    '@google-cloud/storage': { Storage: class { constructor(options) { assert.equal(options.retryOptions.autoRetry, false); } bucket() { return {}; } } },
    'firebase-functions/v2/https': { HttpsError, onCall: (o, h) => { options = o; handler = h; return h; } },
    'firebase-functions/params': { defineSecret: name => { assert.equal(name, 'legacy-pin-reset-hmac'); return { value: () => 'k'.repeat(64) }; } },
    './reset': { createResetService: () => ({ run: async context => { calls++; assert.equal(context.appVerified, true); if (dispatchFailure) throw dispatchFailure; return { status: 'completed' }; } }) },
    './adapter': { createAdapter: () => ({}) }, './journal': { createJournal: () => ({}), createGcsStore: () => ({}) },
    './password': { createPasswordUpdater: () => () => {} }, './envelope': require('../envelope')
  };
  const context = vm.createContext({ exports: {}, process: { env: { GCLOUD_PROJECT: 'trade-list-a4297', LEGACY_PIN_RESET_ENABLED: 'true', LEGACY_IDENTITY_BOUNDARY: 'immutable-bindings-v1', LEGACY_PIN_RESET_OWNER_UID: 'owner-uid', ...env } },
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, (...args) => logs.push(args)])),
    require: name => { assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name]; } });
  vm.runInContext(source, context);
  const request = { auth: { uid: 'owner-uid' }, app: { alreadyConsumed: false }, rawRequest: { headers: { authorization: 'Bearer synthetic-token' } }, data: {} };
  return { options, handler, request, logs, fail: error => { dispatchFailure = error; }, calls: () => calls, verified: () => verified, revoke: () => { rejectToken = true; } };
}
test('callable is dedicated, App Check enforced/consumed, owner ID token verified for revocation before dispatch', async () => {
  const f = fixture(); assert.equal(f.options.serviceAccount, 'legacy-pin-reset-runtime@trade-list-a4297.iam.gserviceaccount.com');
  assert.equal(f.options.enforceAppCheck, true); assert.equal(f.options.consumeAppCheckToken, true); assert.equal(f.options.maxInstances, 1);
  assert.equal((await f.handler(f.request)).status, 'completed'); assert.equal(f.calls(), 1); assert.equal(f.verified(), 1);
});
test('backend failure does not expose PIN in logs/errors and releases the decoded credential', async () => {
  const f = fixture(), pin = '001234'; f.request.data = { pin };
  f.fail(Object.assign(new Error(`SDK failure contains ${pin}`), { code: 503 }));
  await assert.rejects(f.handler(f.request), { message: 'reset/unavailable' });
  assert.deepEqual(f.logs, []); assert.equal(Object.hasOwn(f.request.data, 'pin'), false);
});
test('missing auth, App Check, consumed tokens, mismatched identity and revoked tokens never dispatch', async () => {
  for (const change of [{ auth: null }, { app: null }, { app: { alreadyConsumed: true } }, { auth: { uid: 'attacker' } }, { rawRequest: { headers: {} } }]) {
    const f = fixture(); await assert.rejects(f.handler({ ...f.request, ...change })); assert.equal(f.calls(), 0);
  }
  const f = fixture(); f.revoke(); await assert.rejects(f.handler(f.request), { message: 'reset/unavailable' }); assert.equal(f.calls(), 0);
});
test('production gate, exact project and emulator-variable exclusion are fail-closed', async () => {
  for (const env of [{ LEGACY_PIN_RESET_ENABLED: 'false' }, { LEGACY_IDENTITY_BOUNDARY: '' }, { GCLOUD_PROJECT: 'other' }, { LEGACY_PIN_RESET_OWNER_UID: '' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9499' }, { FIREBASE_DATABASE_EMULATOR_HOST: 'localhost:9400' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }]) {
    const f = fixture(env); await assert.rejects(f.handler(f.request), { message: 'reset/not-enabled' }); assert.equal(f.calls(), 0);
  }
});
