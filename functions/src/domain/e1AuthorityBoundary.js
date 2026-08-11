'use strict';

const crypto = require('node:crypto');
const { HandleValidationError, normalizeHandle } = require('../../e1-authority-service/handleNormalization');
const {
  conflictManifestFingerprint,
  migrationManifestFingerprint,
  observedLegacyFingerprint,
  repairReviewFingerprint,
  sourceMappingFingerprint
} = require('../../e1-authority-service/server');

const USER_REQUEST_FIELDS = Object.freeze({
  reserveTrainerHandle: Object.freeze(['schemaVersion', 'requestedHandle', 'requestId']),
  repairAccountFoundation: Object.freeze(['schemaVersion', 'operationId', 'reviewReference', 'expectedSourceFingerprint'])
});
const OPERATOR_REQUEST_FIELDS = Object.freeze({
  applyMigrationManifest: Object.freeze([
    'schemaVersion', 'uid', 'legacyUsername', 'normalizedTrainerName', 'handleKey', 'legacyAuthVersion',
    'sourceMappingFingerprint', 'manifestId', 'manifestFingerprint', 'reviewerDecision', 'reviewedAt', 'operationId'
  ]),
  freezeIdentityConflict: Object.freeze([
    'schemaVersion', 'uid', 'operationId', 'reasonCode', 'sourceMappingFingerprint', 'manifestId',
    'manifestFingerprint', 'reviewerDecision', 'reviewedAt'
  ])
});
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MANIFEST_FINGERPRINT = /^[a-f0-9]{64}$/;
const MIGRATION_DECISIONS = new Set(['eligible', 'exact-already-migrated']);
const CONFLICT_REASONS = new Set(['legacy-binding-conflict', 'handle-owner-conflict', 'migration-manifest-conflict']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('e1/request-object-required');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail('e1/request-schema-invalid');
}

function assertSchemaVersion(value) {
  if (value !== 1) fail('e1/schema-version-unsupported');
}

function assertUid(value) {
  if (!UID.test(value || '')) fail('e1/uid-invalid');
  return value;
}

function assertRequestId(value) {
  if (!REQUEST_ID.test(value || '')) fail('e1/request-id-invalid');
  return value;
}

function canonicalHandle(value) {
  try {
    const handle = normalizeHandle(value);
    return Object.freeze({
      trainerName: handle.display,
      canonicalTrainerName: handle.display,
      normalizedTrainerName: handle.normalized,
      handleKey: handle.handleKey
    });
  } catch (error) {
    if (error instanceof HandleValidationError) fail('e1/handle-invalid');
    throw error;
  }
}

function fingerprint(value) {
  const stable = JSON.stringify(value, Object.keys(value).sort());
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function verifiedFoundation(uid, legacy) {
  if (legacy?.status !== 'ready' || typeof legacy.username !== 'string' ||
      !Number.isSafeInteger(legacy.legacyAuthVersion) || legacy.legacyAuthVersion < 1) fail('e1/legacy-binding-missing');
  return Object.freeze({ uid, ...canonicalHandle(legacy.username), legacyUsername: legacy.username, legacyAuthVersion: legacy.legacyAuthVersion });
}

function reviewedAt(value) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail('e1/review-invalid');
  return value;
}

function createE1AuthorityBoundary({ verifyFirebaseIdToken, verifyOperatorIdentity, readLegacyBinding, store } = {}) {
  if (typeof verifyFirebaseIdToken !== 'function' || typeof verifyOperatorIdentity !== 'function' || typeof readLegacyBinding !== 'function') {
    throw new TypeError('E.1 identity verifiers and legacy reader required');
  }
  const methods = ['readAccountFoundation', 'reserveTrainerHandle', 'repairAccountFoundation', 'applyMigrationManifest', 'freezeIdentityConflict'];
  if (!store || methods.some((method) => typeof store[method] !== 'function')) throw new TypeError('E.1 fixed authority store required');

  async function callerUid(firebaseIdToken) {
    if (typeof firebaseIdToken !== 'string' || !firebaseIdToken) fail('e1/firebase-id-token-required');
    const decoded = await verifyFirebaseIdToken(firebaseIdToken);
    return assertUid(decoded?.uid);
  }

  async function operator(operation, identity) {
    const result = await verifyOperatorIdentity(identity, operation);
    if (result?.authorized !== true || result.operation !== operation) fail('e1/operator-unauthorized');
  }

  async function readAccountFoundation({ firebaseIdToken } = {}) {
    return store.readAccountFoundation(await callerUid(firebaseIdToken));
  }

  async function reserveTrainerHandle({ firebaseIdToken, body } = {}) {
    exactFields(body, USER_REQUEST_FIELDS.reserveTrainerHandle);
    assertSchemaVersion(body.schemaVersion);
    const uid = await callerUid(firebaseIdToken);
    const handle = canonicalHandle(body.requestedHandle);
    const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
    if (legacy?.status === 'ready' && canonicalHandle(legacy.username).normalizedTrainerName !== handle.normalizedTrainerName) {
      fail('e1/legacy-binding-conflict');
    }
    const requestId = assertRequestId(body.requestId);
    return store.reserveTrainerHandle({
      uid,
      ...handle,
      requestId,
      fingerprint: fingerprint({ operation: 'reserveTrainerHandle', uid, normalizedTrainerName: handle.normalizedTrainerName })
    });
  }

  async function repairAccountFoundation({ firebaseIdToken, body } = {}) {
    exactFields(body, USER_REQUEST_FIELDS.repairAccountFoundation);
    assertSchemaVersion(body.schemaVersion);
    const uid = await callerUid(firebaseIdToken);
    const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
    const foundation = verifiedFoundation(uid, legacy);
    exactFields(body.reviewReference, ['manifestId', 'manifestFingerprint', 'reviewerDecision', 'reviewedAt', 'sourceMappingFingerprint']);
    const source = sourceMappingFingerprint(foundation);
    const reference = body.reviewReference;
    if (body.expectedSourceFingerprint !== source || reference.sourceMappingFingerprint !== source ||
        reference.reviewerDecision !== 'repair-approved' || !MANIFEST_FINGERPRINT.test(reference.manifestFingerprint || '') ||
        reference.manifestFingerprint !== repairReviewFingerprint({ uid, ...reference })) fail('e1/review-invalid');
    const requestId = assertRequestId(body.operationId);
    return store.repairAccountFoundation({
      ...foundation,
      requestId,
      manifestId: assertRequestId(reference.manifestId),
      manifestFingerprint: reference.manifestFingerprint,
      reviewerDecision: reference.reviewerDecision,
      reviewedAt: reviewedAt(reference.reviewedAt),
      sourceMappingFingerprint: source,
      fingerprint: fingerprint({ operation: 'repairAccountFoundation', uid, requestId, manifestFingerprint: reference.manifestFingerprint })
    });
  }

  async function applyMigrationManifest({ operatorIdentity, firebaseIdToken, body } = {}) {
    exactFields(body, OPERATOR_REQUEST_FIELDS.applyMigrationManifest);
    assertSchemaVersion(body.schemaVersion);
    await operator('applyMigrationManifest', operatorIdentity);
    const uid = await callerUid(firebaseIdToken);
    if (uid !== assertUid(body.uid)) fail('e1/uid-mismatch');
    const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
    const foundation = verifiedFoundation(uid, legacy);
    if (body.legacyUsername !== foundation.legacyUsername || body.normalizedTrainerName !== foundation.normalizedTrainerName ||
        body.handleKey !== foundation.handleKey || body.legacyAuthVersion !== foundation.legacyAuthVersion ||
        body.sourceMappingFingerprint !== sourceMappingFingerprint(foundation) || !MIGRATION_DECISIONS.has(body.reviewerDecision) ||
        !MANIFEST_FINGERPRINT.test(body.manifestFingerprint || '') || body.manifestFingerprint !== migrationManifestFingerprint(body)) {
      fail('e1/manifest-invalid');
    }
    const requestId = assertRequestId(body.operationId);
    return store.applyMigrationManifest({
      ...foundation,
      ...body,
      requestId,
      manifestId: assertRequestId(body.manifestId),
      reviewedAt: reviewedAt(body.reviewedAt),
      fingerprint: fingerprint({ operation: 'applyMigrationManifest', uid, requestId, manifestFingerprint: body.manifestFingerprint })
    });
  }

  async function freezeIdentityConflict({ operatorIdentity, firebaseIdToken, body } = {}) {
    exactFields(body, OPERATOR_REQUEST_FIELDS.freezeIdentityConflict);
    assertSchemaVersion(body.schemaVersion);
    await operator('freezeIdentityConflict', operatorIdentity);
    const uid = await callerUid(firebaseIdToken);
    if (uid !== assertUid(body.uid)) fail('e1/uid-mismatch');
    const requestId = assertRequestId(body.operationId);
    const legacy = await readLegacyBinding({ verifiedUid: uid, firebaseIdToken });
    const foundation = legacy?.status === 'ready' ? verifiedFoundation(uid, legacy) : undefined;
    if (!CONFLICT_REASONS.has(body.reasonCode) || body.reviewerDecision !== 'conflict-confirmed' ||
        body.sourceMappingFingerprint !== observedLegacyFingerprint(uid, legacy, foundation) ||
        !MANIFEST_FINGERPRINT.test(body.manifestFingerprint || '') || body.manifestFingerprint !== conflictManifestFingerprint(body)) {
      fail('e1/conflict-review-invalid');
    }
    return store.freezeIdentityConflict({
      uid,
      ...(foundation || {}),
      ...body,
      requestId,
      manifestId: assertRequestId(body.manifestId),
      reviewedAt: reviewedAt(body.reviewedAt),
      fingerprint: fingerprint({ operation: 'freezeIdentityConflict', uid, requestId, manifestFingerprint: body.manifestFingerprint })
    });
  }

  return Object.freeze({ readAccountFoundation, reserveTrainerHandle, repairAccountFoundation, applyMigrationManifest, freezeIdentityConflict });
}

module.exports = { canonicalHandle, createE1AuthorityBoundary };
