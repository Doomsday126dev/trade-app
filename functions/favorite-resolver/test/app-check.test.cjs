'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REPLAY_PREFIX, createGcsReplayStore, createAppCheckVerifier } = require('../app-check');
const { createHandler } = require('../handler');
function memoryBucket() {
  const objects = new Set(), saves = [];
  return { objects, saves, file(name) { return { async save(bytes, options) {
    saves.push({ name, bytes, options });
    if (objects.has(name)) throw Object.assign(new Error('exists'), { code: 412 });
    objects.add(name);
  } }; } };
}
const APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const JTI = 'limited-use-jti-1234567890';
test('production adapter consumes with Firebase and atomically rejects the same token when Firebase omits the replay signal twice', async () => {
  const calls = [], bucket = memoryBucket();
  const verify = createAppCheckVerifier({
    appCheck: { async verifyToken(token, options) { calls.push({ token, options }); return { appId: APP_ID, alreadyConsumed: false, token: { jti: JTI } }; } },
    appId: APP_ID,
    replayStore: createGcsReplayStore(bucket)
  });
  assert.equal(await verify('exact-token-bytes'), true);
  assert.equal(await verify('exact-token-bytes'), false);
  assert.deepEqual(calls, [
    { token: 'exact-token-bytes', options: { consume: true } },
    { token: 'exact-token-bytes', options: { consume: true } }
  ]);
  assert.equal(bucket.objects.size, 1);
  assert.ok(bucket.saves[0].name.startsWith(REPLAY_PREFIX));
  assert.deepEqual(bucket.saves[0].options.preconditionOpts, { ifGenerationMatch: 0 });
  assert.doesNotMatch(bucket.saves[0].name, /exact-token-bytes/);
});
test('consumed, reusable, wrong-app and invalid tokens never reach the replay store', async () => {
  for (const result of [
    { appId: APP_ID, alreadyConsumed: true, token: { jti: JTI } },
    { appId: APP_ID, alreadyConsumed: false, token: {} },
    { appId: 'wrong-app', alreadyConsumed: false, token: { jti: JTI } }
  ]) {
    let consumed = 0;
    const verify = createAppCheckVerifier({ appCheck: { async verifyToken() { return result; } }, appId: APP_ID, replayStore: { async consume() { consumed++; return true; } } });
    assert.equal(await verify('token'), false);
    assert.equal(consumed, 0);
  }
  const invalid = createAppCheckVerifier({ appCheck: { async verifyToken() { throw new Error('invalid'); } }, appId: APP_ID, replayStore: { async consume() { throw new Error('unreachable'); } } });
  await assert.rejects(invalid('invalid-token'));
});
test('the real handler stops an exact replay before quota and resolver business effects', async () => {
  const bucket = memoryBucket(), effects = { quota: 0, resolve: 0 };
  const verifyAppCheck = createAppCheckVerifier({
    appCheck: { async verifyToken() { return { appId: APP_ID, alreadyConsumed: false, token: { jti: JTI } }; } },
    appId: APP_ID,
    replayStore: createGcsReplayStore(bucket)
  });
  const handler = createHandler({
    enabled: () => true,
    origins: ['https://doomsday126dev.github.io'],
    verifyAuth: async () => ({ uid: 'favorite-canary-a-f75ebb32475104803954' }),
    verifyAppCheck,
    quota: { async acquire() { effects.quota++; return {}; }, async release() {} },
    resolve: async () => { effects.resolve++; return [{ handle: 'FavoriteCanaryB7d59abb70f0133ab', status: 'unavailable' }]; }
  });
  const call = async () => {
    const response = { set() { return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, send() { return this; } };
    await handler({ method: 'POST', headers: { origin: 'https://doomsday126dev.github.io', 'content-type': 'application/json', authorization: 'Bearer auth', 'x-firebase-appcheck': 'exact-token-bytes' }, body: { handles: ['FavoriteCanaryB7d59abb70f0133ab'] } }, response);
    return response;
  };
  assert.equal((await call()).statusCode, 200);
  assert.equal((await call()).statusCode, 401);
  assert.deepEqual(effects, { quota: 1, resolve: 1 });
});
