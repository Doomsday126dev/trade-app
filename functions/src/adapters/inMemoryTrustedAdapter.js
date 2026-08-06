'use strict';

const MAX_ACTIVE_TAGS = 24;

const { fail } = require('../domain/errors');
const { snapshotFromTrainerShare } = require('./firebaseTrustedAdapter');

function clone(value) { return structuredClone(value); }

function createInMemoryTrustedAdapter(seed = {}) {
  const state = clone({
    gates: { share_visibility: false, trainer_preferences: false },
    accounts: {}, shareDirectory: {}, userPreferences: {}, trainerShares: {},
    shareVisibility: {}, shareAccess: {}, admins: {}, trustedOperationRequests: {},
    ...seed
  });
  let chain = Promise.resolve();
  const mutationCounts = {};
  const failures = new Set();
  const serialized = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const requestKey = ({ callerUid, operation, requestId }) => `${callerUid}/${operation}/${requestId}`;
  const count = (name) => { mutationCounts[name] = (mutationCounts[name] || 0) + 1; };
  const maybeFail = (name) => { if (failures.delete(name)) fail('unavailable', `${name}/injected_failure`); };

  async function assertOperationEnabled(kind) {
    if (state.gates[kind] !== true) fail('unavailable', 'operation/write_gate_disabled');
  }
  async function beginOperationRequest(input) {
    return serialized(() => {
      const key = requestKey(input), current = state.trustedOperationRequests[key];
      if (!current) {
        state.trustedOperationRequests[key] = { fingerprint: input.fingerprint, status: 'pending', createdAt: input.createdAt, expiresAt: input.expiresAt };
        return { state: 'acquired' };
      }
      if (current.fingerprint !== input.fingerprint) return { state: 'mismatch' };
      if (current.status === 'complete') return { state: 'terminal', result: clone(current.result) };
      return { state: 'pending' };
    });
  }
  async function completeOperationRequest(input) {
    return serialized(() => {
      maybeFail('completeOperationRequest');
      const key = requestKey(input), current = state.trustedOperationRequests[key];
      if (!current || current.fingerprint !== input.fingerprint || current.status !== 'pending') fail('unavailable', 'idempotency/completion_failed');
      state.trustedOperationRequests[key] = { ...current, status: 'complete', result: clone(input.result) };
    });
  }
  async function failOperationRequest(input) {
    return serialized(() => {
      const key = requestKey(input), current = state.trustedOperationRequests[key];
      if (current?.fingerprint === input.fingerprint && current.status === 'pending') current.status = 'failed';
    });
  }
  async function reserveHandleForUid({ callerUid, display, normalized }) {
    return serialized(() => {
      maybeFail('reserveHandleForUid');
      const before = clone(state);
      try {
        const account = state.accounts[callerUid], claim = state.shareDirectory[normalized];
        if (account && account.normalizedTrainerName !== normalized) fail('conflict', 'handle/established_handle_conflict');
        if (claim && claim.ownerUid !== callerUid) fail('conflict', 'handle/collision');
        if (!!account !== !!claim || (account && claim && account.trainerName !== claim.trainerName)) fail('conflict', 'handle/inconsistent_state');
        if (account && claim) return { status: 'idempotent' };
        state.accounts[callerUid] = { trainerName: display, normalizedTrainerName: normalized };
        state.shareDirectory[normalized] = { ownerUid: callerUid, trainerName: display, state: 'unpublished' };
        count('reserveHandleForUid');
        return { status: 'reserved' };
      } catch (error) { Object.assign(state, before); throw error; }
    });
  }
  async function claimTagForViewer({ callerUid, action, tagId, label, baseRevision, operationId, now }) {
    return serialized(() => {
      maybeFail('claimTagForViewer');
      const before = clone(state);
      try {
        const prefs = state.userPreferences[callerUid] ||= {};
        const tags = prefs.trainerTags ||= {}, claims = prefs.trainerTagLabels ||= {};
        const existing = tags[tagId];
        if (action === 'create' && existing) {
          if (existing.active === true && existing.deleted !== true && existing.labelKey === label.labelKey) return { status: 'idempotent' };
          fail('conflict', 'tag/tag_exists');
        }
        if (action === 'create' && Object.values(tags).filter(tag => tag?.active === true && tag?.deleted !== true).length >= MAX_ACTIVE_TAGS) fail('payload_too_large', 'tag/limit');
        if ((action === 'rename' || action === 'soft_delete') && !existing) fail('invalid_argument', 'tag/not_found');
        if (action === 'soft_delete' && existing.deleted === true) return { status: 'idempotent' };
        if (Number(existing?.revision || 0) !== baseRevision) fail('stale_state', 'tag/revision_conflict');
        if (action === 'soft_delete') {
          if (claims[existing.labelKey] === tagId) delete claims[existing.labelKey];
          tags[tagId] = { ...existing, active: false, deleted: true, deletedAt: now, updatedAt: now, revision: Number(existing.revision || 0) + 1, operationId };
          count('claimTagForViewer');
          return { status: 'soft_deleted' };
        }
        if (claims[label.labelKey] && claims[label.labelKey] !== tagId) fail('conflict', 'tag/label_collision');
        if (existing?.labelKey === label.labelKey && existing.active === true) return { status: 'idempotent' };
        if (existing?.labelKey && claims[existing.labelKey] === tagId) delete claims[existing.labelKey];
        claims[label.labelKey] = tagId;
        tags[tagId] = {
          label: label.display, normalizedLabel: label.normalized, labelKey: label.labelKey,
          active: true, deleted: false, createdAt: existing?.createdAt || now, updatedAt: now,
          revision: Number(existing?.revision || 0) + 1, operationId
        };
        count('claimTagForViewer');
        return { status: action === 'rename' ? 'renamed' : 'created' };
      } catch (error) { Object.assign(state, before); throw error; }
    });
  }
  async function getAuthorizedTrainerShare({ callerUid, ownerUid }) {
    const mode = state.shareVisibility[ownerUid]?.mode;
    const allowed = mode === 'public' || callerUid === ownerUid || state.admins[callerUid] === true || (mode === 'approved_viewers' && state.shareAccess[ownerUid]?.[callerUid] === true);
    const share = state.trainerShares[ownerUid];
    if (!allowed || !share) return { availability: 'unavailable' };
    return { availability: 'available', shareVersion: share.shareVersion, updatedAt: share.updatedAt, snapshot: snapshotFromTrainerShare(share) };
  }
  async function advanceHistoryForViewer(input) {
    return serialized(() => {
      maybeFail('advanceHistoryForViewer');
      const prefs = state.userPreferences[input.callerUid] ||= {}, history = prefs.trainerHistory ||= {};
      const current = history[input.ownerUid];
      if (current) {
        if (input.shareVersion < current.lastSeenShareVersion || input.shareUpdatedAt < current.lastSeenUpdatedAt) fail('stale_state', 'history/stale');
        if (input.shareVersion === current.lastSeenShareVersion && input.snapshotFingerprint !== current.lastSeenFingerprint) fail('stale_state', 'history/version_conflict');
        if (input.shareVersion === current.lastSeenShareVersion) return { status: 'idempotent' };
      }
      history[input.ownerUid] = {
        lastSeenShareVersion: input.shareVersion, lastSeenUpdatedAt: input.shareUpdatedAt,
        lastSeenFingerprint: input.snapshotFingerprint, entryCount: input.entryCount,
        lastSeenSnapshot: clone(input.snapshot), revision: Number(current?.revision || 0) + 1,
        operationId: input.operationId
      };
      count('advanceHistoryForViewer');
      return { status: 'recorded' };
    });
  }
  async function isKnownAccountUid(viewerUid) {
    const account = state.accounts[viewerUid];
    return !!account?.normalizedTrainerName && state.shareDirectory[account.normalizedTrainerName]?.ownerUid === viewerUid;
  }
  async function setViewerGrantForOwner({ ownerUid, viewerUid, action }) {
    return serialized(() => {
      maybeFail('setViewerGrantForOwner');
      const grants = state.shareAccess[ownerUid] ||= {};
      if (action === 'grant') {
        if (grants[viewerUid] === true) return { status: 'idempotent' };
        grants[viewerUid] = true;
        count('setViewerGrantForOwner');
        return { status: 'granted' };
      }
      if (grants[viewerUid] == null) return { status: 'idempotent' };
      delete grants[viewerUid];
      count('setViewerGrantForOwner');
      return { status: 'revoked' };
    });
  }

  return Object.freeze({
    assertOperationEnabled, beginOperationRequest, completeOperationRequest, failOperationRequest,
    reserveHandleForUid, claimTagForViewer, getAuthorizedTrainerShare,
    advanceHistoryForViewer, isKnownAccountUid, setViewerGrantForOwner,
    inspect: () => clone(state),
    mutationCounts: () => clone(mutationCounts),
    injectFailure: (name) => failures.add(name)
  });
}

module.exports = { createInMemoryTrustedAdapter };
