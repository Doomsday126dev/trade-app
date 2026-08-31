'use strict';

const crypto = require('node:crypto');
const { TrustedOperationError, fail } = require('../domain/errors');
const { fingerprint } = require('../domain/fingerprints');
const { requestId, uid } = require('../domain/validation');

const DISCORD_PROVIDER = 'discord';
const DISCORD_PROVIDER_ID = 'discord.com';
const DISCORD_SCOPE = 'identify';
const FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_BEGIN_PER_WINDOW = 6;
const MAX_COMPLETE_PER_WINDOW = 10;
const RATE_WINDOW_MS = 60 * 1000;
const HASH = /^[a-f0-9]{64}$/;
const BINDING = /^[A-Za-z0-9_-]{43,128}$/;
const LIFECYCLE = /^[A-Za-z0-9._:-]{8,160}$/;
const SNOWFLAKE = /^\d{5,32}$/;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function pkceChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

function hmac(pepper, purpose, value) {
  return crypto.createHmac('sha256', pepper).update(`${purpose}\0${value}`).digest('hex');
}

function exactScope(value) {
  const scopes = String(value || '').trim().split(/\s+/).filter(Boolean);
  return scopes.length === 1 && scopes[0] === DISCORD_SCOPE;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizedRedirect(value) {
  let parsed;
  try { parsed = new URL(value); } catch { fail('invalid_argument', 'discord/redirect_invalid'); }
  if (parsed.username || parsed.password || parsed.hash) fail('invalid_argument', 'discord/redirect_invalid');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    fail('invalid_argument', 'discord/redirect_invalid');
  }
  return parsed.href;
}

function authority(value, { required }) {
  if (!value) {
    if (required) fail('unauthenticated', 'discord/link_auth_required');
    return null;
  }
  if (!required) fail('conflict', 'discord/sign_in_requires_signed_out');
  if (typeof value !== 'object' || Array.isArray(value)) fail('permission_denied', 'discord/authority_invalid');
  const result = {
    uid: uid(value.uid),
    lifecycleId: String(value.lifecycleId || ''),
    accountFingerprint: String(value.accountFingerprint || ''),
    recentAuth: value.recentAuth === true
  };
  if (!LIFECYCLE.test(result.lifecycleId) || !HASH.test(result.accountFingerprint)) {
    fail('permission_denied', 'discord/authority_invalid');
  }
  if (!result.recentAuth) fail('permission_denied', 'auth/recent_auth_required');
  return Object.freeze(result);
}

function sameAuthority(expected, actual) {
  return expected?.uid === actual?.uid && expected?.lifecycleId === actual?.lifecycleId &&
    expected?.accountFingerprint === actual?.accountFingerprint && actual?.recentAuth === true;
}

function validBinding(value, reason) {
  const binding = String(value || '');
  if (!BINDING.test(binding)) fail('invalid_argument', reason);
  return binding;
}

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} required`);
  return value;
}

function validateConfig(config) {
  const clientId = String(config?.clientId || '');
  const clientSecret = String(config?.clientSecret || '');
  const statePepper = String(config?.statePepper || '');
  const subjectPepper = String(config?.subjectPepper || '');
  if (!SNOWFLAKE.test(clientId)) throw new TypeError('Discord clientId required');
  if (clientSecret.length < 16 || statePepper.length < 16 || subjectPepper.length < 16) {
    throw new TypeError('Injected prototype secrets must be at least 16 characters');
  }
  return Object.freeze({
    clientId,
    clientSecret,
    redirectUri: normalizedRedirect(config.redirectUri),
    authorizeEndpoint: 'https://discord.com/oauth2/authorize',
    statePepper,
    subjectPepper,
    flowTtlMs: config.flowTtlMs || FLOW_TTL_MS
  });
}

function createDiscordOAuthPrototype({
  config,
  store,
  discord,
  customTokenMinter,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  audit = () => {}
} = {}) {
  const settings = validateConfig(config);
  if (!store || !discord) throw new TypeError('Discord prototype adapters required');
  for (const method of ['consumeRateLimit', 'createFlow', 'consumeFlow', 'finishFlow', 'linkSubjectAtomic', 'resolveSubject']) {
    requiredFunction(store[method], `store.${method}`);
  }
  for (const method of ['exchangeCode', 'getCurrentUser', 'revokeToken']) {
    requiredFunction(discord[method], `discord.${method}`);
  }
  requiredFunction(customTokenMinter, 'customTokenMinter');

  const stateHash = (value) => hmac(settings.statePepper, 'discord-oauth-state', value);
  const bindingHash = (value) => hmac(settings.statePepper, 'discord-browser-binding', value);
  const clientHash = (value) => hmac(settings.statePepper, 'discord-rate-client', value);
  const subjectKey = (value) => `v1_discord_${hmac(settings.subjectPepper, 'discord-provider-subject', value)}`;
  const token = () => base64url(randomBytes(32));
  const emit = (event, request) => audit(Object.freeze({ event, correlation: hmac(settings.statePepper, 'discord-audit', request).slice(0, 16) }));

  async function rateLimit(action, clientKey, timestamp) {
    const key = validBinding(clientKey, 'discord/client_key_invalid');
    await store.consumeRateLimit({
      keyHash: clientHash(key),
      action,
      timestamp,
      windowMs: RATE_WINDOW_MS,
      limit: action === 'begin' ? MAX_BEGIN_PER_WINDOW : MAX_COMPLETE_PER_WINDOW
    });
  }

  async function begin({ operation, requestId: rawRequestId, browserBinding, clientKey, currentAuthority } = {}) {
    const timestamp = now();
    const id = requestId(rawRequestId);
    const binding = validBinding(browserBinding, 'discord/browser_binding_invalid');
    await rateLimit('begin', clientKey, timestamp);
    if (!['link', 'sign-in'].includes(operation)) fail('invalid_argument', 'discord/operation_invalid');
    const capturedAuthority = authority(await currentAuthority(), { required: operation === 'link' });
    const state = token();
    const verifier = token();
    const challenge = pkceChallenge(verifier);
    const record = Object.freeze({
      schemaVersion: 1,
      stateHash: stateHash(state),
      requestId: id,
      operation,
      browserBindingHash: bindingHash(binding),
      redirectUri: settings.redirectUri,
      codeVerifier: verifier,
      codeChallenge: challenge,
      authority: capturedAuthority,
      createdAt: timestamp,
      expiresAt: timestamp + settings.flowTtlMs
    });
    await store.createFlow(record);
    const url = new URL(settings.authorizeEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', settings.redirectUri);
    url.searchParams.set('scope', DISCORD_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    emit('discord_oauth_begin', id);
    return Object.freeze({ authorizeUrl: url.href, expiresInMs: settings.flowTtlMs });
  }

  async function complete({
    state,
    code,
    requestId: rawRequestId,
    browserBinding,
    clientKey,
    observedRedirectUri,
    currentAuthority
  } = {}) {
    const timestamp = now();
    const id = requestId(rawRequestId);
    const binding = validBinding(browserBinding, 'discord/browser_binding_invalid');
    await rateLimit('complete', clientKey, timestamp);
    if (!BINDING.test(String(state || ''))) fail('invalid_argument', 'discord/state_invalid');
    if (typeof code !== 'string' || code.length < 8 || code.length > 2048 || /[\u0000-\u001f\u007f]/.test(code)) {
      fail('invalid_argument', 'discord/code_invalid');
    }
    const redirectUri = normalizedRedirect(observedRedirectUri);
    if (redirectUri !== settings.redirectUri) fail('permission_denied', 'discord/redirect_mismatch');
    const flow = await store.consumeFlow({
      stateHash: stateHash(state),
      browserBindingHash: bindingHash(binding),
      requestId: id,
      redirectUri,
      timestamp
    });
    const failFlow = async (error) => {
      const safe = error instanceof TrustedOperationError ? error : new TrustedOperationError('unavailable', 'discord/provider_unavailable');
      await store.finishFlow({ stateHash: flow.stateHash, status: 'failed', reason: safe.reason, timestamp: now() });
      emit('discord_oauth_failed', id);
      throw safe;
    };

    try {
      const linking = flow.operation === 'link';
      const before = authority(await currentAuthority(), { required: linking });
      if (linking && !sameAuthority(flow.authority, before)) fail('stale_state', 'discord/auth_lifecycle_changed');
      if (!secureEqual(pkceChallenge(flow.codeVerifier), flow.codeChallenge)) {
        fail('permission_denied', 'discord/pkce_state_invalid');
      }
      let accessToken = '';
      let refreshToken = '';
      let identity;
      let providerError = null;
      try {
        const exchanged = await discord.exchangeCode({
          clientId: settings.clientId,
          clientSecret: settings.clientSecret,
          code,
          redirectUri: settings.redirectUri,
          codeVerifier: flow.codeVerifier
        });
        if (typeof exchanged?.accessToken === 'string' && exchanged.accessToken.length <= 4096) accessToken = exchanged.accessToken;
        if (typeof exchanged?.refreshToken === 'string' && exchanged.refreshToken.length <= 4096) refreshToken = exchanged.refreshToken;
        if (!exchanged || accessToken.length < 8 ||
            exchanged.accessToken.length > 4096 || exchanged.tokenType !== 'Bearer' || !exactScope(exchanged.scope)) {
          fail('permission_denied', 'discord/token_response_invalid');
        }
        identity = await discord.getCurrentUser({ accessToken });
        if (!identity || !SNOWFLAKE.test(String(identity.subject || ''))) {
          fail('permission_denied', 'discord/identity_invalid');
        }
      } catch (error) {
        providerError = error;
      }
      if (accessToken) {
        try {
          await discord.revokeToken({
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            token: accessToken,
            tokenTypeHint: 'access_token'
          });
        } catch (error) {
          providerError ||= error;
        }
        accessToken = '';
      }
      if (refreshToken) {
        try {
          await discord.revokeToken({
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            token: refreshToken,
            tokenTypeHint: 'refresh_token'
          });
        } catch (error) {
          providerError ||= error;
        }
        refreshToken = '';
      }
      if (providerError) throw providerError;

      const providerSubjectKey = subjectKey(String(identity.subject));
      if (linking) {
        const after = authority(await currentAuthority(), { required: true });
        if (!sameAuthority(flow.authority, after)) fail('stale_state', 'discord/auth_lifecycle_changed');
        const requestFingerprint = fingerprint({
          operation: 'linkDiscordSubject',
          provider: DISCORD_PROVIDER,
          providerId: DISCORD_PROVIDER_ID,
          providerSubjectKey,
          accountFingerprint: flow.authority.accountFingerprint
        });
        const linked = await store.linkSubjectAtomic({
          uid: flow.authority.uid,
          accountFingerprint: flow.authority.accountFingerprint,
          providerSubjectKey,
          requestId: id,
          requestFingerprint,
          timestamp: now()
        });
        await store.finishFlow({ stateHash: flow.stateHash, status: 'complete', reason: linked.status, timestamp: now() });
        emit('discord_oauth_link_complete', id);
        return Object.freeze({ ok: true, operation: 'link', status: linked.status, replay: linked.replay === true });
      }

      const resolved = await store.resolveSubject({ providerSubjectKey });
      if (!resolved) {
        await store.finishFlow({ stateHash: flow.stateHash, status: 'complete', reason: 'onboarding_required', timestamp: now() });
        emit('discord_oauth_onboarding_required', id);
        return Object.freeze({ ok: true, operation: 'sign-in', status: 'onboarding-required' });
      }
      const customToken = await customTokenMinter(resolved.uid);
      if (typeof customToken !== 'string' || customToken.length < 8 || customToken.length > 8192) {
        fail('internal', 'discord/custom_token_invalid');
      }
      await store.finishFlow({ stateHash: flow.stateHash, status: 'complete', reason: 'existing_account', timestamp: now() });
      emit('discord_oauth_sign_in_complete', id);
      return Object.freeze({ ok: true, operation: 'sign-in', status: 'existing-account', customToken });
    } catch (error) {
      return failFlow(error);
    }
  }

  return Object.freeze({ begin, complete, redirectUri: settings.redirectUri });
}

module.exports = {
  DISCORD_PROVIDER,
  DISCORD_PROVIDER_ID,
  DISCORD_SCOPE,
  FLOW_TTL_MS,
  MAX_BEGIN_PER_WINDOW,
  MAX_COMPLETE_PER_WINDOW,
  RATE_WINDOW_MS,
  createDiscordOAuthPrototype,
  pkceChallenge
};
