'use strict';

const MAX_ACTIVE_TAGS = 24;

const { fail } = require('../domain/errors');
const { fingerprint } = require('../domain/fingerprints');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function snapshotFromTrainerShare(share) {
  const snapshot = {};
  for (const category of ['wishlist', 'dynamax', 'gmax', 'costumes']) {
    for (const [entryId, entry] of Object.entries(share?.lists?.[category] || {})) {
      const publicValue = typeof entry === 'string' ? entry : {
        p: entry?.p || null,
        mod: entry?.mod || null,
        lucky: entry?.lucky === true,
        shiny: entry?.shiny === true,
        xxl: entry?.xxl === true,
        xxs: entry?.xxs === true
      };
      snapshot[entryId] = { category, fingerprint: fingerprint(publicValue) };
    }
  }
  return snapshot;
}

function createFirebaseTrustedAdapter({ database }) {
  if (!database || typeof database.ref !== 'function') throw new TypeError('Firebase database required');
  const requestRef = ({ callerUid, operation, requestId }) =>
    database.ref(`trustedOperationRequests/${callerUid}/${operation}/${requestId}`);

  async function hydratedTransaction(ref, update) {
    await ref.get();
    return ref.transaction(update, undefined, false);
  }

  async function assertOperationEnabled(kind) {
    const path = kind === 'share_visibility' ? 'shareVisibilityConfig/writesEnabled' : 'trainerPreferencesConfig/writesEnabled';
    if ((await database.ref(path).get()).val() !== true) fail('unavailable', 'operation/write_gate_disabled');
  }

  async function beginOperationRequest(input) {
    let state = 'pending';
    let priorResult = null;
    const ref = requestRef(input);
    const result = await hydratedTransaction(ref, (current) => {
      if (!current) {
        state = 'acquired';
        return { fingerprint: input.fingerprint, status: 'pending', createdAt: input.createdAt, expiresAt: input.expiresAt };
      }
      if (current.fingerprint !== input.fingerprint) { state = 'mismatch'; return; }
      if (current.status === 'complete') { state = 'terminal'; priorResult = current.result; return; }
      state = 'pending';
      return;
    });
    if (!result.committed && state === 'acquired') state = 'pending';
    return { state, result: deepClone(priorResult) };
  }

  async function completeOperationRequest(input) {
    const ref = requestRef(input);
    const current = (await ref.get()).val();
    if (!current || current.fingerprint !== input.fingerprint || current.status !== 'pending') {
      fail('unavailable', 'idempotency/completion_failed');
    }
    const completed = { ...current, status: 'complete', result: deepClone(input.result), completedAt: Date.now() };
    await ref.set(completed);
    const verified = (await ref.get()).val();
    if (verified?.fingerprint !== input.fingerprint || verified?.status !== 'complete') {
      fail('unavailable', 'idempotency/completion_failed');
    }
  }

  async function failOperationRequest(input) {
    const ref = requestRef(input);
    const current = (await ref.get()).val();
    if (!current || current.fingerprint !== input.fingerprint || current.status !== 'pending') return;
    await ref.set({ ...current, status: 'failed', failedAt: Date.now() });
  }

  async function reserveHandleForUid({ callerUid, display, normalized }) {
    let status = 'reserved';
    const result = await hydratedTransaction(database.ref(), (root) => {
      root ||= {};
      root.accounts ||= {};
      root.shareDirectory ||= {};
      const account = root.accounts[callerUid];
      const claim = root.shareDirectory[normalized];
      if (account && account.normalizedTrainerName !== normalized) { status = 'established_handle_conflict'; return; }
      if (claim && claim.ownerUid !== callerUid) { status = 'collision'; return; }
      if (!!account !== !!claim || (account && claim && account.trainerName !== claim.trainerName)) { status = 'inconsistent_state'; return; }
      if (account && claim) { status = 'idempotent'; return root; }
      status = 'reserved';
      root.accounts[callerUid] = { trainerName: display, normalizedTrainerName: normalized };
      root.shareDirectory[normalized] = { ownerUid: callerUid, trainerName: display, state: 'unpublished' };
      return root;
    });
    if (!result.committed) {
      if (status === 'collision' || status === 'established_handle_conflict' || status === 'inconsistent_state') fail('conflict', `handle/${status}`);
      fail('unavailable', 'handle/transaction_failed');
    }
    return { status };
  }

  async function claimTagForViewer({ callerUid, action, tagId, label, baseRevision, operationId, now }) {
    let status = action === 'soft_delete' ? 'soft_deleted' : action === 'rename' ? 'renamed' : 'created';
    const result = await hydratedTransaction(database.ref(`userPreferences/${callerUid}`), (preferences) => {
      preferences ||= {};
      preferences.trainerTags ||= {};
      preferences.trainerTagLabels ||= {};
      const existing = preferences.trainerTags[tagId];
      if (action === 'create' && existing) {
        if (existing.active === true && existing.deleted !== true && existing.labelKey === label.labelKey) { status = 'idempotent'; return preferences; }
        status = 'tag_exists'; return;
      }
      if (action === 'create' && Object.values(preferences.trainerTags).filter(tag => tag?.active === true && tag?.deleted !== true).length >= MAX_ACTIVE_TAGS) {
        status = 'tag_limit'; return;
      }
      if ((action === 'rename' || action === 'soft_delete') && !existing) { status = 'tag_missing'; return; }
      if (action === 'soft_delete' && existing.deleted === true) { status = 'idempotent'; return preferences; }
      if (Number(existing?.revision || 0) !== baseRevision) { status = 'stale_revision'; return; }
      if (action === 'soft_delete') {
        if (preferences.trainerTagLabels[existing.labelKey] === tagId) delete preferences.trainerTagLabels[existing.labelKey];
        preferences.trainerTags[tagId] = {
          ...existing, active: false, deleted: true, deletedAt: now, updatedAt: now,
          revision: Number(existing.revision || 0) + 1, operationId
        };
        return preferences;
      }
      const claimant = preferences.trainerTagLabels[label.labelKey];
      if (claimant && claimant !== tagId) { status = 'label_collision'; return; }
      if (existing?.labelKey === label.labelKey && existing.active === true) { status = 'idempotent'; return preferences; }
      if (existing?.labelKey && preferences.trainerTagLabels[existing.labelKey] === tagId) delete preferences.trainerTagLabels[existing.labelKey];
      status = action === 'rename' ? 'renamed' : 'created';
      preferences.trainerTagLabels[label.labelKey] = tagId;
      preferences.trainerTags[tagId] = {
        label: label.display,
        normalizedLabel: label.normalized,
        labelKey: label.labelKey,
        active: true,
        deleted: false,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        revision: Number(existing?.revision || 0) + 1,
        operationId
      };
      return preferences;
    });
    if (!result.committed) {
      if (status === 'label_collision' || status === 'tag_exists') fail('conflict', `tag/${status}`);
      if (status === 'tag_missing') fail('invalid_argument', 'tag/not_found');
      if (status === 'stale_revision') fail('stale_state', 'tag/revision_conflict');
      if (status === 'tag_limit') fail('payload_too_large', 'tag/limit');
      fail('unavailable', 'tag/transaction_failed');
    }
    return { status };
  }

  async function getAuthorizedTrainerShare({ callerUid, ownerUid }) {
    const [shareSnap, visibilitySnap, accessSnap, adminSnap] = await Promise.all([
      database.ref(`trainerShares/${ownerUid}`).get(),
      database.ref(`shareVisibility/${ownerUid}/mode`).get(),
      database.ref(`shareAccess/${ownerUid}/${callerUid}`).get(),
      database.ref(`admins/${callerUid}`).get()
    ]);
    const mode = visibilitySnap.val();
    const authorized = mode === 'public' || callerUid === ownerUid || adminSnap.val() === true || (mode === 'approved_viewers' && accessSnap.val() === true);
    const share = shareSnap.val();
    if (!authorized || !share) return { availability: 'unavailable' };
    return { availability: 'available', shareVersion: share.shareVersion, updatedAt: share.updatedAt, snapshot: snapshotFromTrainerShare(share) };
  }

  async function advanceHistoryForViewer({ callerUid, ownerUid, shareVersion, shareUpdatedAt, entryCount, snapshotFingerprint, snapshot, operationId }) {
    let status = 'recorded';
    const result = await hydratedTransaction(database.ref(`userPreferences/${callerUid}/trainerHistory/${ownerUid}`), (current) => {
      if (current) {
        if (shareVersion < current.lastSeenShareVersion || shareUpdatedAt < current.lastSeenUpdatedAt) { status = 'stale'; return; }
        if (shareVersion === current.lastSeenShareVersion && snapshotFingerprint !== current.lastSeenFingerprint) { status = 'version_conflict'; return; }
        if (shareVersion === current.lastSeenShareVersion && snapshotFingerprint === current.lastSeenFingerprint) { status = 'idempotent'; return current; }
      }
      status = 'recorded';
      return {
        lastSeenShareVersion: shareVersion, lastSeenUpdatedAt: shareUpdatedAt,
        lastSeenFingerprint: snapshotFingerprint, entryCount, lastSeenSnapshot: snapshot,
        revision: Number(current?.revision || 0) + 1, operationId
      };
    });
    if (!result.committed) {
      if (status === 'stale' || status === 'version_conflict') fail('stale_state', `history/${status}`);
      fail('unavailable', 'history/transaction_failed');
    }
    return { status };
  }

  async function isKnownAccountUid(viewerUid) {
    const account = (await database.ref(`accounts/${viewerUid}`).get()).val();
    if (!account?.normalizedTrainerName) return false;
    const claim = (await database.ref(`shareDirectory/${account.normalizedTrainerName}`).get()).val();
    return claim?.ownerUid === viewerUid;
  }

  async function setViewerGrantForOwner({ ownerUid, viewerUid, action }) {
    let status = action === 'grant' ? 'granted' : 'revoked';
    const result = await hydratedTransaction(database.ref(`shareAccess/${ownerUid}/${viewerUid}`), (current) => {
      if (action === 'grant') {
        status = current === true ? 'idempotent' : 'granted';
        return true;
      }
      status = current == null ? 'idempotent' : 'revoked';
      return null;
    });
    if (!result.committed) fail('unavailable', 'share_access/transaction_failed');
    return { status };
  }

  return Object.freeze({
    assertOperationEnabled,
    beginOperationRequest,
    completeOperationRequest,
    failOperationRequest,
    reserveHandleForUid,
    claimTagForViewer,
    getAuthorizedTrainerShare,
    advanceHistoryForViewer,
    isKnownAccountUid,
    setViewerGrantForOwner
  });
}

module.exports = { createFirebaseTrustedAdapter, snapshotFromTrainerShare };
