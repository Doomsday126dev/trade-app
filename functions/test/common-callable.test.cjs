'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCallableHandler } = require('../src/callable/common');
const { createRedactedLogger } = require('../src/domain/redactedLogging');
const { emulatorBypassAllowed, firebaseAdminOptions } = require('../src/domain/runtimePolicy');
const { favoriteRequest, harness, requestId } = require('./helpers.cjs');

function wrapped(env = {}, sink = { values: [], info(value) { this.values.push(value); } }) {
  const { operations } = harness();
  return { sink, handler: createCallableHandler({ operation: 'reserveTrainerHandle', invoke: operations.reserveTrainerHandle, logger: createRedactedLogger(sink), env, makePublicError: (value) => value }) };
}

test('missing authentication is denied with a stable public error', async () => {
  const { handler } = wrapped();
  await assert.rejects(handler({ data: { requestedHandle: 'AlphaOne', requestId: requestId('auth') }, app: {} }), (error) => error.code === 'unauthenticated');
});

test('missing App Check is denied by default', async () => {
  const { handler } = wrapped();
  await assert.rejects(handler({ data: { requestedHandle: 'AlphaOne', requestId: requestId('app') }, auth: { uid: 'viewer_001' } }), (error) => error.code === 'app_check_required');
});

test('explicit App Check bypass works only for a demo emulator project', async () => {
  const allowed = { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-pogo-functions', TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS: 'true' };
  const unsafe = { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'production-project', TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS: 'true' };
  assert.equal(emulatorBypassAllowed(allowed), true);
  assert.equal(emulatorBypassAllowed(unsafe), false);
  const { handler } = wrapped(allowed);
  assert.equal((await handler({ data: { requestedHandle: 'AlphaOne', requestId: requestId('bypass') }, auth: { uid: 'newuid_bypass' } })).ok, true);
});

test('Firebase Admin uses an explicit default namespace only in a demo emulator', () => {
  assert.deepEqual(firebaseAdminOptions({ GCLOUD_PROJECT: 'production-project' }), {});
  assert.deepEqual(firebaseAdminOptions({
    FUNCTIONS_EMULATOR: 'true',
    GCLOUD_PROJECT: 'demo-pogo-functions',
    FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9400'
  }), {
    projectId: 'demo-pogo-functions',
    databaseURL: 'http://127.0.0.1:9400?ns=demo-pogo-functions-default-rtdb'
  });
  assert.throws(() => firebaseAdminOptions({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'production-project', FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9400' }));
  assert.throws(() => firebaseAdminOptions({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-pogo-functions', FIREBASE_DATABASE_EMULATOR_HOST: 'remote.example:9400' }));
});

test('logs contain only redacted allowlisted metadata', async () => {
  const { handler, sink } = wrapped();
  await handler({ data: { requestedHandle: 'SecretHandle', requestId: requestId('logs') }, auth: { uid: 'newuid_logs' }, app: { appId: 'secret-app' }, token: 'secret-token' });
  const logged = sink.values.join('\n');
  assert.doesNotMatch(logged, /SecretHandle|newuid_logs|secret-app|secret-token|requestedHandle/);
  assert.match(logged, /reserveTrainerHandle/);
});

test('Favorite logs and public errors expose no labels UIDs or payloads', async () => {
  const sink = { values: [], info(value) { this.values.push(value); } };
  const { operations } = harness();
  const handler = createCallableHandler({ operation: 'mutateFavoriteTrainer', invoke: operations.mutateFavoriteTrainer, logger: createRedactedLogger(sink), env: {}, makePublicError: (value) => value });
  await handler({ data: favoriteRequest(), auth: { uid: 'viewer_001' }, app: { appId: 'private-app' } });
  const logged = sink.values.join('\n');
  assert.match(logged, /mutateFavoriteTrainer/);
  assert.doesNotMatch(logged, /OwnerOne|owner_001|viewer_001|private-app|canonicalTrainerLabel|trainerUid|favoriteTrainers/);
  await assert.rejects(handler({ data: favoriteRequest({ canonicalTrainerLabel: 'Private Alias', requestId: requestId('private-error') }), auth: { uid: 'viewer_001' }, app: { appId: 'private-app' } }), (error) => {
    assert.equal(error.code, 'conflict');
    assert.equal(error.reason, 'favorite/identity_mismatch');
    assert.doesNotMatch(JSON.stringify(error), /Private Alias|owner_001|viewer_001/);
    return true;
  });
});

test('raw internal errors are mapped to stable internal errors', async () => {
  const sink = { info() {} };
  const handler = createCallableHandler({ operation: 'test', invoke: async () => { throw new Error('database URL and secret'); }, logger: createRedactedLogger(sink), env: {}, makePublicError: (value) => value });
  await assert.rejects(handler({ data: {}, auth: { uid: 'viewer_001' }, app: {} }), (error) => error.code === 'internal' && error.reason === 'trusted/internal');
});

test('malformed, oversized, unknown-field, and invalid request ID inputs are rejected', async () => {
  const { operations } = harness();
  const ctx = { auth: { uid: 'newuid_validation' }, app: {} };
  for (const input of [
    null,
    { requestedHandle: 'ValidOne', requestId: 'short' },
    { requestedHandle: 'a'.repeat(5000), requestId: requestId('oversized') },
    { requestedHandle: 'ValidOne', requestId: requestId('unknown'), arbitraryPath: 'admins/example' }
  ]) {
    await assert.rejects(operations.reserveTrainerHandle(input, ctx), (error) => ['invalid_argument', 'payload_too_large'].includes(error.code));
  }
});
