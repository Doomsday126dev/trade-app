'use strict';

const { fail } = require('./errors');

const REQUEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

async function runIdempotent({ adapter, callerUid, operation, requestId, requestFingerprint, execute, now = Date.now }) {
  const begin = await adapter.beginOperationRequest({
    callerUid,
    operation,
    requestId,
    fingerprint: requestFingerprint,
    createdAt: now(),
    expiresAt: now() + REQUEST_RETENTION_MS
  });
  if (begin.state === 'mismatch') fail('replay_mismatch', 'idempotency/fingerprint_mismatch');
  if (begin.state === 'pending') fail('unavailable', 'idempotency/request_in_progress');
  if (begin.state === 'terminal') return Object.freeze({ ...begin.result, replay: true });
  if (begin.state !== 'acquired') fail('internal', 'idempotency/state_invalid');

  try {
    const result = await execute();
    await adapter.completeOperationRequest({ callerUid, operation, requestId, fingerprint: requestFingerprint, result });
    return Object.freeze({ ...result, replay: false });
  } catch (error) {
    await adapter.failOperationRequest({ callerUid, operation, requestId, fingerprint: requestFingerprint }).catch(() => {});
    throw error;
  }
}

module.exports = { REQUEST_RETENTION_MS, runIdempotent };
