'use strict';

const { requireAppCheck, requireAuth } = require('../domain/authorization');
const { correlationHash } = require('../domain/fingerprints');
const { stableError } = require('../domain/errors');
const { appCheckRequired, emulatorBypassAllowed } = require('../domain/runtimePolicy');

function createCallableHandler({ operation, invoke, logger, env = process.env, makePublicError = (error) => error }) {
  return async function callableHandler(request) {
    const started = Date.now();
    const mode = emulatorBypassAllowed(env) ? 'emulator' : 'production';
    const requestId = typeof request?.data?.requestId === 'string' ? request.data.requestId : '';
    try {
      requireAuth(request);
      requireAppCheck(request, appCheckRequired(env));
      const result = await invoke(request.data, request);
      logger.write({ operation, status: 'success', mode, correlationHash: correlationHash(requestId), durationMs: Date.now() - started, appCheckPresent: !!request?.app, replay: result.replay === true });
      return result;
    } catch (error) {
      const stable = stableError(error);
      logger.write({ operation, status: 'error', errorClass: stable.code, mode, correlationHash: correlationHash(requestId), durationMs: Date.now() - started, appCheckPresent: !!request?.app, replay: false });
      throw makePublicError(stable);
    }
  };
}

module.exports = { createCallableHandler };
