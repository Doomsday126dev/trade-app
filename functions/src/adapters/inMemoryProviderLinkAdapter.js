'use strict';

const { fail } = require('../domain/errors');

function clone(value) {
  return structuredClone(value);
}

function createInMemoryProviderLinkAdapter(seed = {}) {
  const state = clone({
    gates: { durable_authentication: false },
    users: {},
    authIndex: {},
    admins: {},
    firebaseProviderSubjects: {},
    discordCodes: {},
    authProviders: {},
    authProviderSubjects: {},
    authLinkAttempts: {},
    trustedOperationRequests: {},
    rateLimits: {},
    ...seed
  });
  let chain = Promise.resolve();
  const serialized = (work) => {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  };
  const requestKey = ({ callerUid, operation, requestId }) => `${callerUid}/${operation}/${requestId}`;

  async function assertOperationEnabled(kind) {
    if (kind !== 'durable_authentication' || state.gates[kind] !== true) fail('unavailable', 'operation/write_gate_disabled');
  }

  async function assertRateLimit({ callerUid, operation }) {
    const key = `${callerUid}/${operation}`;
    state.rateLimits[key] = Number(state.rateLimits[key] || 0) + 1;
    if (state.rateLimits[key] > 20) fail('unavailable', 'provider/rate_limited');
  }

  async function assertTrainerBinding({ callerUid }) {
    const username = state.authIndex[callerUid]?.username;
    if (!username || state.users[username]?.authUid !== callerUid) fail('permission_denied', 'identity/binding_invalid');
    return { username };
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

  async function getVerifiedFirebaseProviderSubject({ callerUid, providerId }) {
    const subject = state.firebaseProviderSubjects[callerUid]?.[providerId];
    return subject ? { subject } : null;
  }

  async function createDiscordLinkAttempt(input) {
    return serialized(() => {
      if (state.authLinkAttempts[input.attemptId]) fail('conflict', 'discord/attempt_collision');
      state.authLinkAttempts[input.attemptId] = {
        callerUid: input.callerUid,
        stateHash: input.stateHash,
        codeChallenge: input.codeChallenge,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        consumedAt: null
      };
    });
  }

  async function consumeDiscordLinkAttempt(input) {
    return serialized(() => {
      const attempt = state.authLinkAttempts[input.attemptId];
      if (!attempt || attempt.callerUid !== input.callerUid) fail('permission_denied', 'discord/attempt_unavailable');
      if (attempt.consumedAt != null) fail('replay_mismatch', 'discord/attempt_consumed');
      if (attempt.expiresAt < input.now) fail('permission_denied', 'discord/attempt_expired');
      if (attempt.stateHash !== input.stateHash) fail('permission_denied', 'discord/state_mismatch');
      if (attempt.codeChallenge !== input.codeChallenge) fail('permission_denied', 'discord/pkce_mismatch');
      attempt.consumedAt = input.now;
    });
  }

  async function exchangeDiscordAuthorizationCode({ code }) {
    const subject = state.discordCodes[code];
    if (!subject) fail('permission_denied', 'discord/code_exchange_failed');
    delete state.discordCodes[code];
    return { subject };
  }

  async function linkProviderSubject({ callerUid, provider, subjectHash, now }) {
    return serialized(() => {
      const claim = state.authProviderSubjects[provider]?.[subjectHash];
      if (claim && claim.uid !== callerUid) fail('conflict', 'provider/subject_already_linked');
      const existing = state.authProviders[callerUid]?.[provider];
      if (existing && existing.subjectHash !== subjectHash) fail('conflict', 'provider/account_already_linked');
      if (existing && claim?.uid === callerUid) return { status: 'already_linked' };
      const revision = Number(existing?.revision || 0) + 1;
      state.authProviders[callerUid] ||= {};
      state.authProviderSubjects[provider] ||= {};
      state.authProviders[callerUid][provider] = {
        provider,
        subjectHash,
        linkedAt: existing?.linkedAt || now,
        updatedAt: now,
        revision,
        state: 'linked'
      };
      state.authProviderSubjects[provider][subjectHash] = { uid: callerUid, linkedAt: existing?.linkedAt || now, revision };
      return { status: existing ? 'reconciled' : 'linked' };
    });
  }

  return Object.freeze({
    assertOperationEnabled,
    assertRateLimit,
    assertTrainerBinding,
    beginOperationRequest,
    completeOperationRequest,
    failOperationRequest,
    getVerifiedFirebaseProviderSubject,
    createDiscordLinkAttempt,
    consumeDiscordLinkAttempt,
    exchangeDiscordAuthorizationCode,
    linkProviderSubject,
    inspect: () => clone(state)
  });
}

module.exports = { createInMemoryProviderLinkAdapter };
