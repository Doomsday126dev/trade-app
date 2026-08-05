'use strict';

const ERROR_CODES = Object.freeze([
  'unauthenticated',
  'app_check_required',
  'invalid_argument',
  'permission_denied',
  'conflict',
  'stale_state',
  'replay_mismatch',
  'payload_too_large',
  'unavailable',
  'internal'
]);

class TrustedOperationError extends Error {
  constructor(code, reason) {
    super(reason || code);
    this.name = 'TrustedOperationError';
    this.code = ERROR_CODES.includes(code) ? code : 'internal';
    this.reason = String(reason || 'trusted/internal');
  }
}

function fail(code, reason) {
  throw new TrustedOperationError(code, reason);
}

function stableError(error) {
  if (error instanceof TrustedOperationError) {
    return Object.freeze({ code: error.code, reason: error.reason });
  }
  return Object.freeze({ code: 'internal', reason: 'trusted/internal' });
}

module.exports = { ERROR_CODES, TrustedOperationError, fail, stableError };
