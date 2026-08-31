'use strict';

const { fail } = require('../domain/errors');

const HASH = /^[a-f0-9]{64}$/;

function clone(value) {
  return structuredClone(value);
}

function exact(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...fields].sort().join(',');
}

function createInMemoryDiscordOAuthStore(seed = {}) {
  let state = clone({
    accounts: {},
    providerSubjects: {},
    operationRequests: {},
    flowStates: {},
    rateLimits: {},
    ...seed
  });
  let chain = Promise.resolve();
  const serialized = (work) => {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  };

  async function consumeRateLimit({ keyHash, action, timestamp, windowMs, limit }) {
    return serialized(() => {
      if (!HASH.test(keyHash) || !['begin', 'complete'].includes(action)) fail('invalid_argument', 'discord/rate_key_invalid');
      const draft = clone(state);
      const key = `${action}:${keyHash}`;
      const current = draft.rateLimits[key];
      const bucket = !current || timestamp - current.startedAt >= windowMs
        ? { startedAt: timestamp, count: 0 }
        : current;
      if (bucket.count >= limit) fail('unavailable', 'discord/rate_limited');
      bucket.count += 1;
      draft.rateLimits[key] = bucket;
      state = draft;
    });
  }

  async function createFlow(record) {
    return serialized(() => {
      if (!record || !HASH.test(record.stateHash) || state.flowStates[record.stateHash]) {
        fail('replay_mismatch', 'discord/state_collision');
      }
      const draft = clone(state);
      draft.flowStates[record.stateHash] = { ...clone(record), status: 'pending', consumedAt: null, terminalReason: '' };
      state = draft;
    });
  }

  async function consumeFlow({ stateHash, browserBindingHash, requestId, redirectUri, timestamp }) {
    return serialized(() => {
      const record = state.flowStates[stateHash];
      if (!record) fail('permission_denied', 'discord/state_unknown');
      if (record.status !== 'pending' || record.consumedAt !== null) fail('replay_mismatch', 'discord/state_replayed');
      if (timestamp > record.expiresAt) fail('stale_state', 'discord/state_expired');
      if (record.browserBindingHash !== browserBindingHash) fail('permission_denied', 'discord/browser_binding_mismatch');
      if (record.requestId !== requestId) fail('replay_mismatch', 'idempotency/request_reused');
      if (record.redirectUri !== redirectUri) fail('permission_denied', 'discord/redirect_mismatch');
      const draft = clone(state);
      draft.flowStates[stateHash].status = 'processing';
      draft.flowStates[stateHash].consumedAt = timestamp;
      state = draft;
      return clone(draft.flowStates[stateHash]);
    });
  }

  async function finishFlow({ stateHash, status, reason, timestamp }) {
    return serialized(() => {
      const record = state.flowStates[stateHash];
      if (!record || record.status !== 'processing' || !['complete', 'failed'].includes(status)) {
        fail('conflict', 'discord/flow_state_invalid');
      }
      const draft = clone(state);
      const terminal = draft.flowStates[stateHash];
      terminal.status = status;
      terminal.completedAt = timestamp;
      terminal.terminalReason = String(reason || '').slice(0, 80);
      delete terminal.codeVerifier;
      state = draft;
    });
  }

  function coherentPair(draft, uid, providerSubjectKey) {
    const reverse = draft.providerSubjects[providerSubjectKey] || null;
    const provider = draft.accounts[uid]?.providers?.discord || null;
    if (!reverse && !provider) return false;
    if (!reverse || !provider || reverse.uid !== uid || reverse.providerSubjectKey !== providerSubjectKey ||
        provider.providerSubjectKey !== providerSubjectKey || reverse.provider !== 'discord' || provider.provider !== 'discord') {
      fail('conflict', 'provider/link_state_invalid');
    }
    return true;
  }

  async function linkSubjectAtomic(input) {
    return serialized(() => {
      const draft = clone(state);
      const account = draft.accounts[input.uid];
      if (!account || account.uid !== input.uid || account.status !== 'active' ||
          account.accountFingerprint !== input.accountFingerprint || !HASH.test(input.requestFingerprint) ||
          !/^v1_discord_[a-f0-9]{64}$/.test(input.providerSubjectKey)) {
        fail('permission_denied', 'identity/account_foundation_invalid');
      }
      const existingRequest = draft.operationRequests[input.uid]?.[input.requestId];
      if (existingRequest) {
        if (!exact(existingRequest, ['operation', 'fingerprint', 'status', 'result']) ||
            existingRequest.operation !== 'linkDiscordSubject' || existingRequest.status !== 'complete' ||
            existingRequest.fingerprint !== input.requestFingerprint ||
            !['linked', 'already-linked'].includes(existingRequest.result?.status)) {
          fail('replay_mismatch', 'idempotency/request_reused');
        }
        if (!coherentPair(draft, input.uid, input.providerSubjectKey)) fail('conflict', 'provider/link_state_missing');
        return { status: existingRequest.result.status, replay: true };
      }
      const claimed = draft.providerSubjects[input.providerSubjectKey];
      if (claimed && claimed.uid !== input.uid) fail('conflict', 'provider/subject_already_linked');
      const currentProvider = account.providers?.discord;
      if (currentProvider && currentProvider.providerSubjectKey !== input.providerSubjectKey) {
        fail('conflict', 'provider/account_already_linked');
      }
      const alreadyLinked = coherentPair(draft, input.uid, input.providerSubjectKey);
      const status = alreadyLinked ? 'already-linked' : 'linked';
      if (!alreadyLinked) {
        account.providers ||= {};
        account.providers.discord = {
          schemaVersion: 1,
          provider: 'discord',
          providerId: 'discord.com',
          providerSubjectKey: input.providerSubjectKey,
          linkedAt: input.timestamp
        };
        draft.providerSubjects[input.providerSubjectKey] = {
          schemaVersion: 1,
          provider: 'discord',
          providerId: 'discord.com',
          providerSubjectKey: input.providerSubjectKey,
          uid: input.uid,
          linkedAt: input.timestamp
        };
      }
      draft.operationRequests[input.uid] ||= {};
      draft.operationRequests[input.uid][input.requestId] = {
        operation: 'linkDiscordSubject',
        fingerprint: input.requestFingerprint,
        status: 'complete',
        result: { status }
      };
      state = draft;
      return { status, replay: false };
    });
  }

  async function resolveSubject({ providerSubjectKey }) {
    const reverse = state.providerSubjects[providerSubjectKey];
    if (!reverse) return null;
    if (!coherentPair(state, reverse.uid, providerSubjectKey)) fail('conflict', 'provider/link_state_invalid');
    const account = state.accounts[reverse.uid];
    if (!account || account.status !== 'active') fail('permission_denied', 'identity/account_foundation_invalid');
    return Object.freeze({ uid: reverse.uid });
  }

  function inspect() {
    const snapshot = clone(state);
    for (const flow of Object.values(snapshot.flowStates)) {
      if (flow.codeVerifier) flow.codeVerifier = '[private]';
    }
    return snapshot;
  }

  return Object.freeze({ consumeRateLimit, createFlow, consumeFlow, finishFlow, linkSubjectAtomic, resolveSubject, inspect });
}

module.exports = { createInMemoryDiscordOAuthStore };
