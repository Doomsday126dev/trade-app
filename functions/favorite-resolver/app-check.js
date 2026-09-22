'use strict';
const { digest } = require('./contract');
const { PREFIX } = require('./quota');
const REPLAY_PREFIX = `${PREFIX}app-check-replay/`;
function createGcsReplayStore(bucket) {
  if (!bucket?.file) throw new TypeError('Favorite App Check replay store is required');
  return Object.freeze({
    async consume(token) {
      const subject = digest(`favorite-app-check-replay-v1\0${token}`);
      try {
        await bucket.file(`${REPLAY_PREFIX}${subject}`).save('1', {
          resumable: false,
          contentType: 'text/plain',
          preconditionOpts: { ifGenerationMatch: 0 }
        });
        return true;
      } catch (error) {
        if (error?.code === 412) return false;
        throw error;
      }
    }
  });
}
function createAppCheckVerifier({ appCheck, appId, replayStore }) {
  if (!appCheck?.verifyToken || typeof appId !== 'string' || !appId || !replayStore?.consume) throw new TypeError('Favorite App Check verifier is incomplete');
  return async token => {
    const result = await appCheck.verifyToken(token, { consume: true });
    const jti = result?.token?.jti;
    if (result?.appId !== appId || result.alreadyConsumed !== false || typeof jti !== 'string' || jti.length < 16 || jti.length > 500) return false;
    return replayStore.consume(token);
  };
}
module.exports = { REPLAY_PREFIX, createGcsReplayStore, createAppCheckVerifier };
