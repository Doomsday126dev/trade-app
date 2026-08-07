'use strict';

const crypto = require('node:crypto');
const { requireAppCheck, requireAuth } = require('./authorization');
const { fail } = require('./errors');
const { fingerprint } = require('./fingerprints');
const { runIdempotent } = require('./idempotency');
const { boundedPayload, exactFields, requestId } = require('./validation');

const PROVIDER_LINK_GATE = 'durable_authentication';
const LINK_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_LINK_PAYLOAD = 4096;
const PROVIDERS = Object.freeze({ google: 'google.com', discord: 'discord.com', email: 'emailLink' });

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function randomSecret(randomBytes, size = 32) {
  return base64url(randomBytes(size));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('base64url');
}

function safeToken(value, reason, min = 16, max = 512) {
  const token = String(value ?? '');
  if (token.length < min || token.length > max || !/^[A-Za-z0-9._~-]+$/.test(token)) fail('invalid_argument', reason);
  return token;
}

function discordCode(value) {
  const code = String(value ?? '');
  if (code.length < 8 || code.length > 2048 || /[\u0000-\u001f\u007f]/u.test(code)) fail('invalid_argument', 'discord/code_invalid');
  return code;
}

function requireRecentAuth(context, now) {
  const authTimeSeconds = Number(context?.auth?.token?.auth_time);
  const authTime = Number.isFinite(authTimeSeconds) ? authTimeSeconds * 1000 : 0;
  if (!authTime || authTime > now || now - authTime > RECENT_AUTH_MAX_AGE_MS) {
    fail('permission_denied', 'auth/recent_auth_required');
  }
}

function result(operation, status) {
  return Object.freeze({ ok: true, operation, status });
}

function createProviderLinkOperations({ adapter, now = Date.now, randomBytes = crypto.randomBytes, subjectHasher }) {
  if (!adapter) throw new TypeError('adapter required');
  if (typeof subjectHasher !== 'function') throw new TypeError('keyed subjectHasher required');

  async function preflight(context, operation) {
    const callerUid = requireAuth(context);
    requireAppCheck(context, true);
    await adapter.assertOperationEnabled(PROVIDER_LINK_GATE);
    requireRecentAuth(context, now());
    await adapter.assertRateLimit({ callerUid, operation, now: now() });
    await adapter.assertTrainerBinding({ callerUid });
    return callerUid;
  }

  async function confirmFirebaseProviderLink(data, context) {
    const callerUid = await preflight(context, 'confirmFirebaseProviderLink');
    exactFields(data, ['provider', 'requestId', 'schemaVersion']);
    boundedPayload(data, MAX_LINK_PAYLOAD);
    if (data.schemaVersion !== 1 || data.provider !== 'google') fail('invalid_argument', 'provider/unsupported');
    const id = requestId(data.requestId);
    return runIdempotent({
      adapter,
      callerUid,
      operation: 'confirmFirebaseProviderLink',
      requestId: id,
      requestFingerprint: fingerprint({ provider: PROVIDERS.google, schemaVersion: 1 }),
      now,
      execute: async () => {
        const verified = await adapter.getVerifiedFirebaseProviderSubject({ callerUid, providerId: PROVIDERS.google });
        if (!verified?.subject) fail('permission_denied', 'provider/firebase_link_not_verified');
        const subjectHash = subjectHasher(PROVIDERS.google, verified.subject);
        const linked = await adapter.linkProviderSubject({ callerUid, provider: 'google', subjectHash, now: now() });
        await adapter.assertTrainerBinding({ callerUid });
        return result('confirmFirebaseProviderLink', linked.status);
      }
    });
  }

  async function beginDiscordLink(data, context) {
    const callerUid = await preflight(context, 'beginDiscordLink');
    exactFields(data, ['stateHash', 'codeChallenge', 'requestId', 'schemaVersion']);
    boundedPayload(data, MAX_LINK_PAYLOAD);
    if (data.schemaVersion !== 1) fail('invalid_argument', 'provider/schema_unsupported');
    const stateHash = safeToken(data.stateHash, 'discord/state_invalid', 43, 43);
    const codeChallenge = safeToken(data.codeChallenge, 'discord/challenge_invalid', 43, 43);
    const id = requestId(data.requestId);
    return runIdempotent({
      adapter,
      callerUid,
      operation: 'beginDiscordLink',
      requestId: id,
      requestFingerprint: fingerprint({ provider: PROVIDERS.discord, stateHash, codeChallenge, schemaVersion: 1 }),
      now,
      execute: async () => {
        const attemptId = randomSecret(randomBytes, 24);
        const createdAt = now();
        const expiresAt = createdAt + LINK_ATTEMPT_TTL_MS;
        await adapter.createDiscordLinkAttempt({
          attemptId,
          callerUid,
          stateHash,
          codeChallenge,
          createdAt,
          expiresAt
        });
        return Object.freeze({
          ok: true,
          operation: 'beginDiscordLink',
          status: 'link_attempt_created',
          attemptId,
          expiresAt
        });
      }
    });
  }

  async function completeDiscordLink(data, context) {
    const callerUid = await preflight(context, 'completeDiscordLink');
    exactFields(data, ['attemptId', 'state', 'code', 'codeVerifier', 'requestId', 'schemaVersion']);
    boundedPayload(data, MAX_LINK_PAYLOAD);
    if (data.schemaVersion !== 1) fail('invalid_argument', 'provider/schema_unsupported');
    const attemptId = safeToken(data.attemptId, 'discord/attempt_invalid');
    const state = safeToken(data.state, 'discord/state_invalid');
    const codeVerifier = safeToken(data.codeVerifier, 'discord/verifier_invalid', 43, 128);
    const code = discordCode(data.code);
    const id = requestId(data.requestId);
    return runIdempotent({
      adapter,
      callerUid,
      operation: 'completeDiscordLink',
      requestId: id,
      requestFingerprint: fingerprint({ attemptId, stateHash: sha256(state), codeHash: sha256(code), verifierHash: sha256(codeVerifier), schemaVersion: 1 }),
      now,
      execute: async () => {
        await adapter.consumeDiscordLinkAttempt({
          attemptId,
          callerUid,
          stateHash: sha256(state),
          codeChallenge: sha256(codeVerifier),
          now: now()
        });
        const verified = await adapter.exchangeDiscordAuthorizationCode({ code, codeVerifier });
        const subject = String(verified?.subject ?? '');
        if (!/^\d{17,20}$/.test(subject)) fail('permission_denied', 'discord/subject_unverified');
        const subjectHash = subjectHasher(PROVIDERS.discord, subject);
        const linked = await adapter.linkProviderSubject({ callerUid, provider: 'discord', subjectHash, now: now() });
        await adapter.assertTrainerBinding({ callerUid });
        return result('completeDiscordLink', linked.status);
      }
    });
  }

  return Object.freeze({ confirmFirebaseProviderLink, beginDiscordLink, completeDiscordLink });
}

module.exports = {
  LINK_ATTEMPT_TTL_MS,
  MAX_LINK_PAYLOAD,
  PROVIDERS,
  PROVIDER_LINK_GATE,
  RECENT_AUTH_MAX_AGE_MS,
  createProviderLinkOperations,
  sha256
};
