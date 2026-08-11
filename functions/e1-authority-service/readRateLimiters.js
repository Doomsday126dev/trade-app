'use strict';

const crypto = require('node:crypto');

const DURABLE_MODE = 'firestore-rolling-v1';
const GROUP_C_PROOF_MODE = 'group-c-process-local-v1';
const PROOF_REQUEST_LIMIT = 5;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function readProofSubjectHash(kind, value) {
  if (!['uid', 'trainer'].includes(kind) || typeof value !== 'string' || !value) fail('E1_READ_PROOF_CONFIGURATION_INVALID');
  return crypto.createHash('sha256').update(JSON.stringify([1, 'group-c-read-proof', kind, value]), 'utf8').digest('hex');
}

function createDurableReadLimiter({ consumeRateLimit, rateLimit, now, randomId, rateAttemptHash }) {
  if (typeof consumeRateLimit !== 'function' || typeof now !== 'function' || typeof randomId !== 'function' ||
      typeof rateAttemptHash !== 'function') throw new TypeError('Durable read limiter dependencies required');
  return Object.freeze({
    mode: DURABLE_MODE,
    assertUid() {},
    async consume({ subjectHash }) {
      return consumeRateLimit({
        operation: 'readAccountFoundation',
        subjectHash,
        attemptHash: rateAttemptHash('readAccountFoundation', subjectHash, [randomId()]),
        ...rateLimit,
        at: now()
      });
    }
  });
}

function createProofReadLimiter({ proof, now }) {
  if (!proof || typeof now !== 'function' || !/^[a-f0-9]{64}$/u.test(proof.uidHash || '') ||
      !/^[a-f0-9]{64}$/u.test(proof.trainerHash || '') || !Number.isSafeInteger(proof.start) ||
      !Number.isSafeInteger(proof.end) || proof.start >= proof.end) fail('E1_READ_PROOF_CONFIGURATION_INVALID');
  let count = 0;
  function assertWindow() {
    const at = now();
    if (!Number.isSafeInteger(at) || at < proof.start || at >= proof.end) fail('E1_READ_PROOF_EXPIRED');
  }
  return Object.freeze({
    mode: GROUP_C_PROOF_MODE,
    assertUid(uid) {
      assertWindow();
      if (readProofSubjectHash('uid', uid) !== proof.uidHash) fail('E1_READ_PROOF_SUBJECT_DENIED');
    },
    async consume({ uid, trainerUsername }) {
      assertWindow();
      if (readProofSubjectHash('uid', uid) !== proof.uidHash ||
          readProofSubjectHash('trainer', trainerUsername) !== proof.trainerHash) fail('E1_READ_PROOF_SUBJECT_DENIED');
      if (count >= PROOF_REQUEST_LIMIT) fail('e1/rate-limit-exceeded');
      count += 1;
      return Object.freeze({ allowed: true, consumed: true, remaining: PROOF_REQUEST_LIMIT - count, persistent: false });
    }
  });
}

function createReadLimiter({ mode, ...dependencies }) {
  if (mode === DURABLE_MODE) return createDurableReadLimiter(dependencies);
  if (mode === GROUP_C_PROOF_MODE) return createProofReadLimiter(dependencies);
  fail('E1_READ_LIMITER_MODE_INVALID');
}

module.exports = Object.freeze({
  DURABLE_MODE,
  GROUP_C_PROOF_MODE,
  PROOF_REQUEST_LIMIT,
  createDurableReadLimiter,
  createProofReadLimiter,
  createReadLimiter,
  readProofSubjectHash
});
