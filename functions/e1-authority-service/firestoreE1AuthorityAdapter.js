'use strict';

const RATE_LIMIT_OPERATIONS = new Set([
  'readAccountFoundation',
  'reserveTrainerHandle',
  'repairAccountFoundation',
  'applyMigrationManifest',
  'freezeIdentityConflict'
]);
const HASH = /^[a-f0-9]{16,64}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function createFirestoreE1AuthorityAdapter({ firestore, now = () => Date.now() } = {}) {
  if (!firestore || typeof firestore.runTransaction !== 'function' || typeof firestore.doc !== 'function') {
    throw new TypeError('Firestore authority database required');
  }

  const accountRef = (uid) => firestore.doc(`accounts/${uid}`);
  const handleRef = (handleKey) => firestore.doc(`trainerHandles/${handleKey}`);
  const operationRef = (uid, requestId) => firestore.doc(`operationRequests/${uid}/requests/${requestId}`);
  const migrationRef = (uid, requestId) => firestore.doc(`identityMigrations/${uid}/operations/${requestId}`);
  const conflictRef = (uid, requestId) => firestore.doc(`identityConflicts/${uid}/events/${requestId}`);
  const rateLimitRef = (operation, subjectHash) => firestore.doc(`rateLimits/${operation}_${subjectHash}`);

  async function consumeRateLimit({ operation, subjectHash, attemptHash, limit, windowMs, at = now() }) {
    if (!RATE_LIMIT_OPERATIONS.has(operation) || !HASH.test(subjectHash || '') || !HASH.test(attemptHash || '') ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(windowMs) || windowMs < 60_000 ||
        !Number.isSafeInteger(at) || at < 0) fail('e1/rate-limit-input-invalid');
    return firestore.runTransaction(async (transaction) => {
      const ref = rateLimitRef(operation, subjectHash);
      const snapshot = await transaction.get(ref);
      const windowStart = Math.floor(at / windowMs) * windowMs;
      const current = snapshot.exists ? snapshot.data() : null;
      const validState = current?.schemaVersion === 1 && current.operation === operation && current.subjectHash === subjectHash &&
        Number.isSafeInteger(current.windowStart) && Number.isSafeInteger(current.windowEnd) && current.windowStart < current.windowEnd &&
        Array.isArray(current.attemptHashes) && current.attemptHashes.every((hash) => HASH.test(hash)) &&
        Number.isSafeInteger(current.count) && current.count === current.attemptHashes.length && current.count <= limit;
      if (snapshot.exists && !validState) fail('e1/rate-limit-state-invalid');
      const sameWindow = validState && current.windowStart === windowStart && current.windowEnd === windowStart + windowMs;
      const attemptHashes = sameWindow ? current.attemptHashes : [];
      if (attemptHashes.includes(attemptHash)) {
        return Object.freeze({ allowed: true, consumed: false, remaining: Math.max(0, limit - attemptHashes.length), windowEnd: windowStart + windowMs });
      }
      if (attemptHashes.length >= limit) fail('e1/rate-limit-exceeded');
      const nextAttempts = [...attemptHashes, attemptHash];
      const document = {
        schemaVersion: 1,
        operation,
        subjectHash,
        windowStart,
        windowEnd: windowStart + windowMs,
        expiresAt: windowStart + (windowMs * 2),
        count: nextAttempts.length,
        attemptHashes: nextAttempts,
        updatedAt: at
      };
      if (snapshot.exists) transaction.update(ref, document);
      else transaction.create(ref, document);
      return Object.freeze({ allowed: true, consumed: true, remaining: limit - nextAttempts.length, windowEnd: document.windowEnd });
    });
  }

  function replay(snapshot, fingerprint) {
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    if (data.fingerprint !== fingerprint) fail('e1/replay-mismatch');
    return Object.freeze({ ...data.result, replay: true });
  }

  function accountDocument(input, timestamp, status = 'active') {
    return {
      schemaVersion: 1,
      uid: input.uid,
      canonicalTrainerName: input.canonicalTrainerName,
      normalizedTrainerName: input.normalizedTrainerName,
      handleKey: input.handleKey,
      legacyUsername: input.legacyUsername,
      legacyAuthVersion: input.legacyAuthVersion,
      status,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function handleDocument(input, timestamp) {
    return {
      schemaVersion: 1,
      uid: input.uid,
      canonicalTrainerName: input.canonicalTrainerName,
      normalizedTrainerName: input.normalizedTrainerName,
      state: 'active',
      revision: 1,
      claimedAt: timestamp,
      updatedAt: timestamp
    };
  }

  function operationDocument(operation, input, result, timestamp) {
    return { schemaVersion: 1, operation, fingerprint: input.fingerprint, result, createdAt: timestamp };
  }

  function migrationDocument(operation, input, timestamp) {
    return {
      schemaVersion: 1,
      uid: input.uid,
      handleKey: input.handleKey,
      operation,
      fingerprint: input.fingerprint,
      sourceMappingFingerprint: input.sourceMappingFingerprint,
      manifestId: input.manifestId,
      manifestFingerprint: input.manifestFingerprint,
      reviewerDecision: input.reviewerDecision,
      reviewedAt: input.reviewedAt,
      status: 'complete',
      createdAt: timestamp
    };
  }

  function exactAccount(data, input) {
    return data?.schemaVersion === 1 && data.uid === input.uid && data.handleKey === input.handleKey &&
      data.canonicalTrainerName === input.canonicalTrainerName && data.normalizedTrainerName === input.normalizedTrainerName &&
      data.legacyUsername === input.legacyUsername && data.legacyAuthVersion === input.legacyAuthVersion &&
      data.status === 'active' && data.revision === 1;
  }

  function exactHandle(data, input) {
    return data?.schemaVersion === 1 && data.uid === input.uid && data.canonicalTrainerName === input.canonicalTrainerName &&
      data.normalizedTrainerName === input.normalizedTrainerName && data.state === 'active' && data.revision === 1;
  }

  async function readAccountFoundation(uid) {
    const snapshot = await accountRef(uid).get();
    return snapshot.exists ? Object.freeze(snapshot.data()) : null;
  }

  async function reserveTrainerHandle(input) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId)];
      const [account, handle, request] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint);
      if (prior) return prior;

      if (account.exists && !handle.exists) fail('e1/foundation-conflict');
      if (!account.exists && handle.exists) {
        if (handle.data()?.uid !== input.uid) fail('e1/handle-conflict');
        fail('e1/foundation-conflict');
      }
      if (account.exists && handle.exists) {
        if (handle.data()?.uid !== input.uid) fail('e1/handle-conflict');
        if (!exactAccount(account.data(), input) || !exactHandle(handle.data(), input)) fail('e1/foundation-conflict');
        const result = { status: 'idempotent', handleKey: input.handleKey, revision: account.data().revision || 1 };
        transaction.create(refs[2], operationDocument('reserveTrainerHandle', input, result, now()));
        return Object.freeze(result);
      }

      const timestamp = now();
      const result = { status: 'reserved', handleKey: input.handleKey, revision: 1 };
      transaction.create(refs[0], accountDocument(input, timestamp));
      transaction.create(refs[1], handleDocument(input, timestamp));
      transaction.create(refs[2], operationDocument('reserveTrainerHandle', input, result, timestamp));
      return Object.freeze(result);
    });
  }

  async function repairAccountFoundation(input) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId), migrationRef(input.uid, input.requestId)];
      const [account, handle, request, migration] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint);
      if (prior) return prior;
      if (migration.exists) fail('e1/repair-review-required');
      if (account.exists && !exactAccount(account.data(), input)) fail('e1/foundation-conflict');
      if (handle.exists && handle.data()?.uid !== input.uid) fail('e1/handle-conflict');
      if (handle.exists && !exactHandle(handle.data(), input)) fail('e1/foundation-conflict');
      if (!account.exists && !handle.exists) fail('e1/repair-review-required');
      const timestamp = now();
      const repairClass = !account.exists ? 'account-restored' : !handle.exists ? 'handle-restored' : 'evidence-restored';
      const result = { status: 'repaired', handleKey: input.handleKey, revision: 1, repairClass };
      if (!account.exists) transaction.create(refs[0], accountDocument(input, timestamp));
      if (!handle.exists) transaction.create(refs[1], handleDocument(input, timestamp));
      transaction.create(refs[2], operationDocument('repairAccountFoundation', input, result, timestamp));
      transaction.create(refs[3], migrationDocument('repairAccountFoundation', input, timestamp));
      return Object.freeze(result);
    });
  }

  async function applyMigrationManifest(input) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId), migrationRef(input.uid, input.requestId)];
      const [account, handle, request, migration] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint);
      if (prior) return prior;
      if (migration.exists) fail('e1/migration-conflict');
      if (account.exists && !exactAccount(account.data(), input)) fail('e1/foundation-conflict');
      if (handle.exists && handle.data()?.uid !== input.uid) fail('e1/handle-conflict');
      if (handle.exists && !exactHandle(handle.data(), input)) fail('e1/foundation-conflict');
      if (account.exists !== handle.exists) fail('e1/migration-conflict');
      if (input.reviewerDecision === 'eligible' && account.exists) fail('e1/migration-review-required');
      if (input.reviewerDecision === 'exact-already-migrated' && !account.exists) fail('e1/migration-review-required');
      const timestamp = now();
      const result = {
        status: account.exists ? 'already-migrated' : 'migrated',
        handleKey: input.handleKey,
        revision: 1
      };
      if (!account.exists) {
        transaction.create(refs[0], accountDocument(input, timestamp));
        transaction.create(refs[1], handleDocument(input, timestamp));
      }
      transaction.create(refs[2], operationDocument('applyMigrationManifest', input, result, timestamp));
      transaction.create(refs[3], migrationDocument('applyMigrationManifest', input, timestamp));
      return Object.freeze(result);
    });
  }

  async function freezeIdentityConflict(input) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [operationRef(input.uid, input.requestId), conflictRef(input.uid, input.requestId)];
      const checkedRefs = input.reasonCode === 'handle-owner-conflict'
        ? [...refs, accountRef(input.uid), handleRef(input.handleKey)] : refs;
      const snapshots = await Promise.all(checkedRefs.map((ref) => transaction.get(ref)));
      const [request, conflict, account, handle] = snapshots;
      const prior = replay(request, input.fingerprint);
      if (prior) return prior;
      if (conflict.exists && conflict.data().fingerprint !== input.fingerprint) fail('e1/conflict-record-mismatch');
      if (input.reasonCode === 'handle-owner-conflict') {
        if (!handle?.exists || handle.data()?.uid === input.uid || account?.data()?.handleKey === input.handleKey) {
          fail('e1/conflict-not-observed');
        }
      }
      const timestamp = now();
      const result = { status: 'frozen', reasonCode: input.reasonCode };
      transaction.create(refs[0], operationDocument('freezeIdentityConflict', input, result, timestamp));
      transaction.create(refs[1], {
        schemaVersion: 1,
        uid: input.uid,
        reasonCode: input.reasonCode,
        fingerprint: input.fingerprint,
        sourceMappingFingerprint: input.sourceMappingFingerprint,
        manifestId: input.manifestId,
        manifestFingerprint: input.manifestFingerprint,
        reviewerDecision: input.reviewerDecision,
        reviewedAt: input.reviewedAt,
        status: 'frozen',
        createdAt: timestamp
      });
      return Object.freeze(result);
    });
  }

  return Object.freeze({
    applyMigrationManifest,
    consumeRateLimit,
    freezeIdentityConflict,
    readAccountFoundation,
    repairAccountFoundation,
    reserveTrainerHandle
  });
}

module.exports = { RATE_LIMIT_OPERATIONS, createFirestoreE1AuthorityAdapter };
