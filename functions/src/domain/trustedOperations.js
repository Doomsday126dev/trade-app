'use strict';

const { requireAuth } = require('./authorization');
const { fail } = require('./errors');
const { fingerprint } = require('./fingerprints');
const { runIdempotent } = require('./idempotency');
const { normalizeHandle, normalizeTagLabel } = require('./normalization');
const { boundedPayload, exactFields, publicSnapshot, requestId, safeInteger, tagId, trainerLabel, uid } = require('./validation');

const MAX_SMALL_PAYLOAD = 4096;
const MAX_HISTORY_PAYLOAD = 256 * 1024;

function operationResult(operation, status, replay = false) {
  return Object.freeze({ ok: true, operation, status, replay });
}

function createTrustedOperations({ adapter, now = Date.now }) {
  if (!adapter) throw new TypeError('adapter required');

  async function reserveTrainerHandle(data, context) {
    const callerUid = requireAuth(context);
    await adapter.assertOperationEnabled('share_visibility');
    exactFields(data, ['requestedHandle', 'requestId']);
    boundedPayload(data, MAX_SMALL_PAYLOAD);
    const id = requestId(data.requestId);
    const handle = normalizeHandle(data.requestedHandle);
    return runIdempotent({
      adapter, callerUid, operation: 'reserveTrainerHandle', requestId: id,
      requestFingerprint: fingerprint({ requestedHandle: handle.normalized }), now,
      execute: async () => {
        const state = await adapter.reserveHandleForUid({ callerUid, ...handle, now: now() });
        return operationResult('reserveTrainerHandle', state.status);
      }
    });
  }

  async function claimTrainerTagLabel(data, context) {
    const callerUid = requireAuth(context);
    await adapter.assertOperationEnabled('trainer_preferences');
    const action = String(data?.action || '');
    const required = action === 'soft_delete' ? ['action', 'tagId', 'baseRevision', 'requestId'] : ['action', 'tagId', 'label', 'baseRevision', 'requestId'];
    exactFields(data, required);
    boundedPayload(data, MAX_SMALL_PAYLOAD);
    if (!['create', 'rename', 'soft_delete'].includes(action)) fail('invalid_argument', 'tag/action_invalid');
    const id = requestId(data.requestId);
    const stableTagId = tagId(data.tagId);
    const baseRevision = safeInteger(data.baseRevision, 0, Number.MAX_SAFE_INTEGER, 'tag/revision_invalid');
    const label = action === 'soft_delete' ? null : normalizeTagLabel(data.label);
    return runIdempotent({
      adapter, callerUid, operation: 'claimTrainerTagLabel', requestId: id,
      requestFingerprint: fingerprint({ action, tagId: stableTagId, normalizedLabel: label?.normalized || null, baseRevision }), now,
      execute: async () => {
        const state = await adapter.claimTagForViewer({ callerUid, action, tagId: stableTagId, label, baseRevision, operationId: id, now: now() });
        return operationResult('claimTrainerTagLabel', state.status);
      }
    });
  }

  async function mutateFavoriteTrainer(data, context) {
    const callerUid = requireAuth(context);
    await adapter.assertOperationEnabled('trainer_preferences');
    exactFields(data, ['operation', 'trainerUid', 'canonicalTrainerLabel', 'expectedRevision', 'requestId', 'schemaVersion']);
    boundedPayload(data, MAX_SMALL_PAYLOAD);
    const operation = String(data.operation);
    if (!['add', 'remove'].includes(operation)) fail('invalid_argument', 'favorite/operation_invalid');
    if (data.schemaVersion !== 1) fail('invalid_argument', 'favorite/schema_unsupported');
    const id = requestId(data.requestId);
    const trainerUid = uid(data.trainerUid, 'favorite/trainer_uid_invalid');
    const canonicalTrainerLabel = trainerLabel(data.canonicalTrainerLabel);
    const expectedRevision = safeInteger(data.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'favorite/revision_invalid');
    return runIdempotent({
      adapter, callerUid, operation: 'mutateFavoriteTrainer', requestId: id,
      requestFingerprint: fingerprint({ operation, trainerUid, canonicalTrainerLabel, expectedRevision, schemaVersion: 1 }), now,
      execute: async () => {
        const identity = await adapter.getCanonicalTrainerIdentity(trainerUid);
        if (!identity || identity.trainerName !== canonicalTrainerLabel) fail('conflict', 'favorite/identity_mismatch');
        const state = await adapter.mutateFavoriteForViewer({
          callerUid, operation, trainerUid, canonicalTrainerLabel,
          expectedRevision, operationId: id, now: now()
        });
        return operationResult('mutateFavoriteTrainer', state.status);
      }
    });
  }

  async function verifyTrainerHistory(data, context) {
    const callerUid = requireAuth(context);
    await adapter.assertOperationEnabled('trainer_preferences');
    exactFields(data, ['ownerUid', 'shareVersion', 'shareUpdatedAt', 'declaredEntryCount', 'publicSnapshot', 'requestId']);
    boundedPayload(data, MAX_HISTORY_PAYLOAD);
    const id = requestId(data.requestId);
    const ownerUid = uid(data.ownerUid, 'history/owner_uid_invalid');
    const shareVersion = safeInteger(data.shareVersion, 1, Number.MAX_SAFE_INTEGER, 'history/version_invalid');
    const shareUpdatedAt = safeInteger(data.shareUpdatedAt, 0, Number.MAX_SAFE_INTEGER, 'history/timestamp_invalid');
    if (Number.isSafeInteger(data.declaredEntryCount) && data.declaredEntryCount > 1500) fail('payload_too_large', 'history/too_many_entries');
    const declaredEntryCount = safeInteger(data.declaredEntryCount, 0, 1500, 'history/count_invalid');
    const snapshot = publicSnapshot(data.publicSnapshot);
    const actualEntryCount = Object.keys(snapshot).length;
    if (actualEntryCount !== declaredEntryCount) fail('invalid_argument', 'history/count_mismatch');
    const snapshotFingerprint = fingerprint(snapshot);
    return runIdempotent({
      adapter, callerUid, operation: 'verifyTrainerHistory', requestId: id,
      requestFingerprint: fingerprint({ ownerUid, shareVersion, shareUpdatedAt, declaredEntryCount, snapshotFingerprint }), now,
      execute: async () => {
        const source = await adapter.getAuthorizedTrainerShare({ callerUid, ownerUid });
        if (!source || source.availability !== 'available') fail('permission_denied', 'history/source_unavailable');
        if (source.shareVersion !== shareVersion || source.updatedAt !== shareUpdatedAt || fingerprint(source.snapshot) !== snapshotFingerprint) {
          fail('stale_state', 'history/source_mismatch');
        }
        const state = await adapter.advanceHistoryForViewer({
          callerUid, ownerUid, shareVersion, shareUpdatedAt, entryCount: actualEntryCount,
          snapshotFingerprint, snapshot, operationId: id, now: now()
        });
        return operationResult('verifyTrainerHistory', state.status);
      }
    });
  }

  async function setApprovedViewer(data, context) {
    const callerUid = requireAuth(context);
    await adapter.assertOperationEnabled('share_visibility');
    exactFields(data, ['viewerUid', 'action', 'requestId']);
    boundedPayload(data, MAX_SMALL_PAYLOAD);
    const id = requestId(data.requestId);
    const viewerUid = uid(data.viewerUid, 'share_access/viewer_uid_invalid');
    const action = String(data.action);
    if (!['grant', 'revoke'].includes(action)) fail('invalid_argument', 'share_access/action_invalid');
    if (viewerUid === callerUid) fail('invalid_argument', 'share_access/self_grant_denied');
    return runIdempotent({
      adapter, callerUid, operation: 'setApprovedViewer', requestId: id,
      requestFingerprint: fingerprint({ viewerUid, action }), now,
      execute: async () => {
        if (!await adapter.isKnownAccountUid(viewerUid)) fail('invalid_argument', 'share_access/viewer_unknown');
        const state = await adapter.setViewerGrantForOwner({ ownerUid: callerUid, viewerUid, action, now: now() });
        return operationResult('setApprovedViewer', state.status);
      }
    });
  }

  return Object.freeze({ reserveTrainerHandle, claimTrainerTagLabel, mutateFavoriteTrainer, verifyTrainerHistory, setApprovedViewer });
}

module.exports = { createTrustedOperations, MAX_HISTORY_PAYLOAD, MAX_SMALL_PAYLOAD };
