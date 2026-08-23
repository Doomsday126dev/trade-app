'use strict';

const { fail } = require('../domain/errors');

const HASH = /^[a-f0-9]{64}$/;
const TERMINAL_LINK_STATUSES = new Set(['linked', 'already_linked']);

function clone(value) {
  return structuredClone(value);
}

function providerDocument(accountNode, provider) {
  return accountNode?.providers?.[provider] || null;
}

function operationDocument(state, uid, requestId) {
  return state.operationRequests[uid]?.requests?.[requestId] || null;
}

function hasExactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertFoundation(state, uid) {
  const accountNode = state.accounts[uid];
  const account = accountNode?.document;
  if (!account || account.schemaVersion !== 1 || account.uid !== uid || account.status !== 'active') {
    fail('permission_denied', 'identity/account_foundation_invalid');
  }
  const handle = state.trainerHandles[account.handleKey];
  if (!handle || handle.uid !== uid || handle.canonicalTrainerName !== account.canonicalTrainerName ||
      handle.normalizedTrainerName !== account.normalizedTrainerName) {
    fail('permission_denied', 'identity/handle_ownership_invalid');
  }
  const legacyName = account.legacyUsername;
  const directory = state.loginDirectory[account.normalizedTrainerName];
  if (!legacyName || state.authIndex[uid]?.username !== legacyName || state.users[legacyName]?.authUid !== uid ||
      directory?.username !== legacyName || directory?.authUid !== uid) {
    fail('permission_denied', 'identity/legacy_binding_invalid');
  }
  return accountNode;
}

function assertLinkedPair({ providerDoc, reverseDoc, callerUid, provider, providerId, providerSubjectKey }) {
  if (!providerDoc && !reverseDoc) return false;
  if (reverseDoc && reverseDoc.uid !== callerUid) fail('conflict', 'provider/subject_already_linked');
  if (!providerDoc || !reverseDoc) fail('conflict', 'provider/state_inconsistent');
  const providerValid = hasExactFields(providerDoc, [
    'schemaVersion', 'provider', 'providerId', 'providerSubjectKey', 'state',
    'linkedAt', 'updatedAt', 'revision'
  ]) && providerDoc.schemaVersion === 1 && providerDoc.provider === provider && providerDoc.providerId === providerId &&
    providerDoc.providerSubjectKey === providerSubjectKey && providerDoc.state === 'linked' &&
    validTimestamp(providerDoc.linkedAt) && validTimestamp(providerDoc.updatedAt) &&
    providerDoc.updatedAt >= providerDoc.linkedAt && Number.isSafeInteger(providerDoc.revision) && providerDoc.revision >= 1;
  const reverseValid = hasExactFields(reverseDoc, [
    'schemaVersion', 'uid', 'provider', 'providerId', 'providerSubjectKey', 'linkedAt', 'revision'
  ]) && reverseDoc.schemaVersion === 1 && reverseDoc.uid === callerUid && reverseDoc.provider === provider &&
    reverseDoc.providerId === providerId && reverseDoc.providerSubjectKey === providerSubjectKey &&
    validTimestamp(reverseDoc.linkedAt) && Number.isSafeInteger(reverseDoc.revision) && reverseDoc.revision >= 1;
  if (!providerValid || !reverseValid || providerDoc.linkedAt !== reverseDoc.linkedAt || providerDoc.revision !== reverseDoc.revision) {
    fail('conflict', 'provider/link_state_invalid');
  }
  return true;
}

function replayResult(operation, input) {
  if (!hasExactFields(operation, [
    'schemaVersion', 'operation', 'fingerprint', 'status', 'createdAt', 'completedAt', 'result'
  ]) || operation.schemaVersion !== 1 || operation.operation !== 'linkVerifiedProvider' ||
      !HASH.test(operation.fingerprint || '') || operation.status !== 'complete' ||
      !validTimestamp(operation.createdAt) || !validTimestamp(operation.completedAt) ||
      operation.completedAt < operation.createdAt ||
      !hasExactFields(operation.result, ['ok', 'operation', 'provider', 'status']) ||
      operation.result.ok !== true || operation.result.operation !== 'linkVerifiedProvider' ||
      operation.result.provider !== input.provider || !TERMINAL_LINK_STATUSES.has(operation.result.status)) {
    fail('unavailable', 'idempotency/state_invalid');
  }
  if (operation.fingerprint !== input.requestFingerprint) fail('replay_mismatch', 'idempotency/request_reused');
  return operation.result;
}

function createInMemoryProviderLinkAdapter(seed = {}, options = {}) {
  const trustedEvidence = clone(seed.verifiedProviderEvidence || {});
  let state = clone({
    gates: { e2_provider_link: false },
    accounts: {},
    trainerHandles: {},
    authIndex: {},
    users: {},
    loginDirectory: {},
    providerSubjects: {},
    operationRequests: {},
    admins: {},
    privateLists: {},
    publicShares: {},
    userPreferences: {},
    ...seed
  });
  delete state.verifiedProviderEvidence;
  let chain = Promise.resolve();
  const serialized = (work) => {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  };

  async function assertOperationEnabled(kind) {
    if (kind !== 'e2_provider_link' || state.gates[kind] !== true) {
      fail('unavailable', 'operation/write_gate_disabled');
    }
  }

  async function getVerifiedProviderEvidence({ callerUid, providerId }) {
    const evidence = typeof options.evidenceReader === 'function'
      ? await options.evidenceReader({ callerUid, providerId })
      : trustedEvidence[callerUid]?.[providerId];
    return evidence ? clone(evidence) : null;
  }

  async function linkVerifiedProviderAtomic(input) {
    return serialized(async () => {
      const draft = clone(state);
      const accountNode = assertFoundation(draft, input.callerUid);
      const existingOperation = operationDocument(draft, input.callerUid, input.requestId);
      if (existingOperation) {
        const recordedResult = replayResult(existingOperation, input);
        const providerDoc = providerDocument(accountNode, input.provider);
        const reverseDoc = draft.providerSubjects[input.providerSubjectKey] || null;
        if (!assertLinkedPair({
          providerDoc,
          reverseDoc,
          callerUid: input.callerUid,
          provider: input.provider,
          providerId: input.providerId,
          providerSubjectKey: input.providerSubjectKey
        })) fail('conflict', 'provider/link_state_missing');
        return { status: recordedResult.status, replay: true };
      }

      const providerDoc = providerDocument(accountNode, input.provider);
      const reverseDoc = draft.providerSubjects[input.providerSubjectKey] || null;
      const alreadyLinked = assertLinkedPair({
        providerDoc,
        reverseDoc,
        callerUid: input.callerUid,
        provider: input.provider,
        providerId: input.providerId,
        providerSubjectKey: input.providerSubjectKey
      });
      const result = Object.freeze({
        ok: true,
        operation: 'linkVerifiedProvider',
        provider: input.provider,
        status: alreadyLinked ? 'already_linked' : 'linked'
      });

      if (!alreadyLinked) {
        accountNode.providers ||= {};
        accountNode.providers[input.provider] = {
          schemaVersion: 1,
          provider: input.provider,
          providerId: input.providerId,
          providerSubjectKey: input.providerSubjectKey,
          state: 'linked',
          linkedAt: input.timestamp,
          updatedAt: input.timestamp,
          revision: 1
        };
        draft.providerSubjects[input.providerSubjectKey] = {
          schemaVersion: 1,
          uid: input.callerUid,
          provider: input.provider,
          providerId: input.providerId,
          providerSubjectKey: input.providerSubjectKey,
          linkedAt: input.timestamp,
          revision: 1
        };
      }

      draft.operationRequests[input.callerUid] ||= { requests: {} };
      draft.operationRequests[input.callerUid].requests[input.requestId] = {
        schemaVersion: 1,
        operation: 'linkVerifiedProvider',
        fingerprint: input.requestFingerprint,
        status: 'complete',
        createdAt: input.timestamp,
        completedAt: input.timestamp,
        result
      };
      if (typeof options.beforeCommit === 'function') await options.beforeCommit();
      state = draft;
      return { status: result.status, replay: false };
    });
  }

  return Object.freeze({
    assertOperationEnabled,
    getVerifiedProviderEvidence,
    linkVerifiedProviderAtomic,
    inspect: () => clone(state)
  });
}

module.exports = { createInMemoryProviderLinkAdapter };
