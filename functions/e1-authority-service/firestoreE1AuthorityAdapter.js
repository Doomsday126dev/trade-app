'use strict';

const RATE_LIMIT_OPERATIONS = new Set([
  'readAccountFoundation',
  'createProviderAccountFoundation',
  'reserveTrainerHandle',
  'repairAccountFoundation',
  'applyMigrationManifest',
  'freezeIdentityConflict'
]);
const MUTATION_OPERATIONS = new Set([
  'createProviderAccountFoundation',
  'reserveTrainerHandle',
  'repairAccountFoundation',
  'applyMigrationManifest',
  'freezeIdentityConflict'
]);
const HASH = /^[a-f0-9]{16,64}$/;
const HASH_64 = /^[a-f0-9]{64}$/;
const LEGACY_PROVISIONING_FREEZE_FIELDS = Object.freeze([
  'schemaVersion','state','provisioningModel','freezeId','provisioningContractDigest','activatedAt','releasedAt'
]);
const PROVIDER_CREATION_CERTIFICATION_FIELDS = Object.freeze([
  'schemaVersion','state','provisioningModel','freezeId','provisioningContractDigest','normalizationVersion',
  'legacyNamespaceCoverageCertified','activeLegacyHandleCount','certifiedHandleCount','coverageDigest',
  'inventoryCapturedAt','certifiedAt','expiresAt'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function createFirestoreE1AuthorityAdapter({ firestore, now = () => Date.now() } = {}) {
  if (!firestore || typeof firestore.runTransaction !== 'function' || typeof firestore.doc !== 'function') {
    throw new TypeError('Firestore authority database required');
  }

  const accountRef = (uid) => firestore.doc(`accounts/${uid}`);
  const handleRef = (handleKey) => firestore.doc(`trainerHandles/${handleKey}`);
  const providerRef = (uid, provider) => firestore.doc(`accounts/${uid}/providers/${provider}`);
  const providerSubjectRef = (providerSubjectKey) => firestore.doc(`providerSubjects/${providerSubjectKey}`);
  const providerCreationCertificationRef = () => firestore.doc('authorityConfig/providerAccountCreation');
  const legacyProvisioningFreezeRef = () => firestore.doc('authorityConfig/legacyProvisioningFreeze');
  const operationRef = (uid, requestId) => firestore.doc(`operationRequests/${uid}/requests/${requestId}`);
  const migrationRef = (uid, requestId) => firestore.doc(`identityMigrations/${uid}/operations/${requestId}`);
  const conflictRef = (uid, requestId) => firestore.doc(`identityConflicts/${uid}/events/${requestId}`);
  const rateLimitRef = (operation, subjectHash) => firestore.doc(`rateLimits/${operation}_${subjectHash}`);

  function validOperationRequest(data, operation) {
    return data?.schemaVersion === 1 && data.operation === operation && HASH.test(data.fingerprint || '') &&
      data.result && typeof data.result === 'object' && !Array.isArray(data.result);
  }

  async function operationRequestExists({ operation, uid, requestId }) {
    if (!MUTATION_OPERATIONS.has(operation) || typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/') ||
        typeof requestId !== 'string' || !requestId || requestId.length > 128 || requestId.includes('/')) {
      fail('e1/replay-input-invalid');
    }
    const snapshot = await operationRef(uid, requestId).get();
    if (!snapshot.exists) return false;
    if (!validOperationRequest(snapshot.data(), operation)) fail('e1/replay-state-invalid');
    return true;
  }

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

  function replay(snapshot, fingerprint, operation, replayOnly = false) {
    if (!snapshot.exists) {
      if (replayOnly) fail('e1/replay-not-found');
      return null;
    }
    const data = snapshot.data();
    if (!validOperationRequest(data, operation)) fail('e1/replay-state-invalid');
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
      identityKind: 'legacy_migrated',
      legacyAccessConfigured: true,
      legacyUsername: input.legacyUsername,
      legacyAuthVersion: input.legacyAuthVersion,
      status,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function providerAccountDocument(input, timestamp) {
    return {
      schemaVersion: 1,
      uid: input.uid,
      canonicalTrainerName: input.canonicalTrainerName,
      normalizedTrainerName: input.normalizedTrainerName,
      handleKey: input.handleKey,
      identityKind: 'provider_only',
      legacyAccessConfigured: false,
      legacyUsername: null,
      legacyAuthVersion: null,
      status: 'active',
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

  function accountProviderDocument(input, timestamp) {
    return {
      schemaVersion: 1,
      provider: input.providerKey,
      providerId: input.providerId,
      providerSubjectKey: input.providerSubjectKey,
      providerSubjectKeyVersion: input.providerSubjectKeyVersion,
      state: 'linked',
      linkedAt: timestamp,
      updatedAt: timestamp,
      revision: 1
    };
  }

  function providerSubjectDocument(input, timestamp) {
    return {
      schemaVersion: 1,
      uid: input.uid,
      provider: input.providerKey,
      providerId: input.providerId,
      providerSubjectKey: input.providerSubjectKey,
      providerSubjectKeyVersion: input.providerSubjectKeyVersion,
      linkedAt: timestamp,
      revision: 1
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
      (data.identityKind === undefined || data.identityKind === 'legacy_migrated') &&
      (data.legacyAccessConfigured === undefined || data.legacyAccessConfigured === true) &&
      data.legacyUsername === input.legacyUsername && data.legacyAuthVersion === input.legacyAuthVersion &&
      data.status === 'active' && data.revision === 1;
  }

  function exactHandle(data, input) {
    return data?.schemaVersion === 1 && data.uid === input.uid && data.canonicalTrainerName === input.canonicalTrainerName &&
      data.normalizedTrainerName === input.normalizedTrainerName && data.state === 'active' && data.revision === 1 &&
      Number.isSafeInteger(data.claimedAt) && Number.isSafeInteger(data.updatedAt) && data.updatedAt >= data.claimedAt;
  }

  function exactProviderAccount(data, input) {
    return data?.schemaVersion === 1 && data.uid === input.uid && data.handleKey === input.handleKey &&
      data.canonicalTrainerName === input.canonicalTrainerName && data.normalizedTrainerName === input.normalizedTrainerName &&
      data.identityKind === 'provider_only' && data.legacyAccessConfigured === false && data.legacyUsername === null &&
      data.legacyAuthVersion === null && data.status === 'active' && data.revision === 1 &&
      Number.isSafeInteger(data.createdAt) && Number.isSafeInteger(data.updatedAt) && data.updatedAt >= data.createdAt;
  }

  function exactAccountProvider(data, input) {
    return data?.schemaVersion === 1 && data.provider === input.providerKey && data.providerId === input.providerId &&
      data.providerSubjectKey === input.providerSubjectKey && data.state === 'linked' && data.revision === 1 &&
      data.providerSubjectKeyVersion === input.providerSubjectKeyVersion &&
      Number.isSafeInteger(data.linkedAt) && Number.isSafeInteger(data.updatedAt) && data.updatedAt >= data.linkedAt;
  }

  function exactProviderSubject(data, input) {
    return data?.schemaVersion === 1 && data.uid === input.uid && data.provider === input.providerKey &&
      data.providerId === input.providerId && data.providerSubjectKey === input.providerSubjectKey && data.revision === 1 &&
      data.providerSubjectKeyVersion === input.providerSubjectKeyVersion &&
      Number.isSafeInteger(data.linkedAt);
  }

  function validLegacyProvisioningFreeze(data, timestamp) {
    return exactFields(data, LEGACY_PROVISIONING_FREEZE_FIELDS) && data.schemaVersion === 1 && data.state === 'active' &&
      data.provisioningModel === 'bounded-legacy-provisioning-freeze' &&
      typeof data.freezeId === 'string' && /^legacy-freeze-[A-Za-z0-9._:-]{8,96}$/.test(data.freezeId) &&
      HASH_64.test(data.provisioningContractDigest || '') && Number.isSafeInteger(data.activatedAt) &&
      data.activatedAt <= timestamp && data.releasedAt === null;
  }

  function validProviderCreationCertification(data, freeze, timestamp) {
    return exactFields(data, PROVIDER_CREATION_CERTIFICATION_FIELDS) && data.schemaVersion === 2 &&
      data.state === 'certified' && data.normalizationVersion === 1 &&
      data.provisioningModel === 'bounded-legacy-provisioning-freeze' && data.freezeId === freeze?.freezeId &&
      data.provisioningContractDigest === freeze?.provisioningContractDigest &&
      data.legacyNamespaceCoverageCertified === true && Number.isSafeInteger(data.activeLegacyHandleCount) &&
      data.activeLegacyHandleCount >= 0 && data.certifiedHandleCount === data.activeLegacyHandleCount &&
      HASH_64.test(data.coverageDigest || '') && Number.isSafeInteger(data.inventoryCapturedAt) &&
      data.inventoryCapturedAt >= freeze.activatedAt && Number.isSafeInteger(data.certifiedAt) &&
      data.certifiedAt >= data.inventoryCapturedAt && data.certifiedAt <= timestamp &&
      Number.isSafeInteger(data.expiresAt) && data.expiresAt > timestamp;
  }

  async function readAccountFoundation(uid) {
    const snapshot = await accountRef(uid).get();
    return snapshot.exists ? Object.freeze(snapshot.data()) : null;
  }

  async function readProviderAccountFoundation(input) {
    const refs = [accountRef(input.uid), handleRef(input.handleKey), providerRef(input.uid, input.providerKey),
      providerSubjectRef(input.providerSubjectKey)];
    const [account, handle, provider, subject] = await Promise.all(refs.map((ref) => ref.get()));
    if (![account, handle, provider, subject].every((snapshot) => snapshot.exists)) return null;
    if (!exactProviderAccount(account.data(), input) || !exactHandle(handle.data(), input) ||
        !exactAccountProvider(provider.data(), input) || !exactProviderSubject(subject.data(), input) ||
        provider.data().linkedAt !== subject.data().linkedAt) fail('e1/provider-foundation-conflict');
    const data = account.data();
    return Object.freeze({
      schemaVersion: 1,
      canonicalTrainerName: data.canonicalTrainerName,
      normalizedTrainerName: data.normalizedTrainerName,
      handleKey: data.handleKey,
      identityKind: 'provider_only',
      legacyAccessConfigured: false,
      legacyUsername: null,
      status: 'active',
      revision: data.revision
    });
  }

  async function createProviderAccountFoundation(input, { replayOnly = false } = {}) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [
        legacyProvisioningFreezeRef(),
        providerCreationCertificationRef(),
        accountRef(input.uid),
        handleRef(input.handleKey),
        providerRef(input.uid, input.providerKey),
        providerSubjectRef(input.providerSubjectKey),
        operationRef(input.uid, input.requestId)
      ];
      const [freeze, certification, account, handle, provider, subject, request] =
        await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint, 'createProviderAccountFoundation', replayOnly);
      if (prior) {
        if (!account.exists || !handle.exists || !provider.exists || !subject.exists ||
            !exactProviderAccount(account.data(), input) || !exactHandle(handle.data(), input) ||
            !exactAccountProvider(provider.data(), input) || !exactProviderSubject(subject.data(), input) ||
            provider.data().linkedAt !== subject.data().linkedAt) fail('e1/provider-foundation-conflict');
        return prior;
      }
      const timestamp = now();
      if (!freeze.exists || !validLegacyProvisioningFreeze(freeze.data(), timestamp) || !certification.exists ||
          !validProviderCreationCertification(certification.data(), freeze.data(), timestamp)) {
        fail('e1/legacy-namespace-not-certified');
      }
      if (account.exists) fail('e1/account-conflict');
      if (handle.exists) fail('e1/handle-conflict');
      if (provider.exists) fail('e1/provider-foundation-conflict');
      if (subject.exists) fail(subject.data()?.uid === input.uid ? 'e1/provider-foundation-conflict' : 'e1/provider-subject-conflict');

      const result = {
        status: 'created',
        canonicalTrainerName: input.canonicalTrainerName,
        normalizedTrainerName: input.normalizedTrainerName,
        handleKey: input.handleKey,
        identityKind: 'provider_only',
        revision: 1
      };
      transaction.create(refs[2], providerAccountDocument(input, timestamp));
      transaction.create(refs[3], handleDocument(input, timestamp));
      transaction.create(refs[4], accountProviderDocument(input, timestamp));
      transaction.create(refs[5], providerSubjectDocument(input, timestamp));
      transaction.create(refs[6], operationDocument('createProviderAccountFoundation', input, result, timestamp));
      return Object.freeze(result);
    });
  }

  async function reserveTrainerHandle(input, { replayOnly = false } = {}) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId)];
      const [account, handle, request] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint, 'reserveTrainerHandle', replayOnly);
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

  async function repairAccountFoundation(input, { replayOnly = false } = {}) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId), migrationRef(input.uid, input.requestId)];
      const [account, handle, request, migration] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint, 'repairAccountFoundation', replayOnly);
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

  async function applyMigrationManifest(input, { replayOnly = false } = {}) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [accountRef(input.uid), handleRef(input.handleKey), operationRef(input.uid, input.requestId), migrationRef(input.uid, input.requestId)];
      const [account, handle, request, migration] = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const prior = replay(request, input.fingerprint, 'applyMigrationManifest', replayOnly);
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

  async function freezeIdentityConflict(input, { replayOnly = false } = {}) {
    return firestore.runTransaction(async (transaction) => {
      const refs = [operationRef(input.uid, input.requestId), conflictRef(input.uid, input.requestId)];
      const checkedRefs = input.reasonCode === 'handle-owner-conflict'
        ? [...refs, accountRef(input.uid), handleRef(input.handleKey)] : refs;
      const snapshots = await Promise.all(checkedRefs.map((ref) => transaction.get(ref)));
      const [request, conflict, account, handle] = snapshots;
      const prior = replay(request, input.fingerprint, 'freezeIdentityConflict', replayOnly);
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
    createProviderAccountFoundation,
    freezeIdentityConflict,
    operationRequestExists,
    readAccountFoundation,
    readProviderAccountFoundation,
    repairAccountFoundation,
    reserveTrainerHandle
  });
}

module.exports = { MUTATION_OPERATIONS, RATE_LIMIT_OPERATIONS, createFirestoreE1AuthorityAdapter };
