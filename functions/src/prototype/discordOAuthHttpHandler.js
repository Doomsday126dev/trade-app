'use strict';

const crypto = require('node:crypto');
const { stableError, fail } = require('../domain/errors');

const ROOT = '/__local/discord/oauth';
const MAX_BODY_BYTES = 4096;
const BINDING = /^[A-Za-z0-9_-]{43,128}$/;
const BINDING_COOKIE = 'pogo_discord_oauth_dev';

function loopbackOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('allowedOrigin must be a loopback URL'); }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/') {
    throw new TypeError('allowedOrigin must be an exact HTTP loopback origin');
  }
  return parsed.origin;
}

function response(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'cache-control': 'no-store, max-age=0',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'content-type': 'application/json; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

function statusFor(code) {
  if (['invalid_argument', 'payload_too_large'].includes(code)) return 400;
  if (['unauthenticated', 'app_check_required'].includes(code)) return 401;
  if (['permission_denied'].includes(code)) return 403;
  if (['conflict', 'stale_state', 'replay_mismatch'].includes(code)) return 409;
  if (code === 'unavailable') return 429;
  return 500;
}

async function body(request) {
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    fail('invalid_argument', 'request/content_type_invalid');
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) fail('payload_too_large', 'request/payload_too_large');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    fail('invalid_argument', 'request/json_invalid');
  }
}

function exact(value, fields) {
  if (Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    fail('invalid_argument', 'request/schema_invalid');
  }
}

function cookieValue(request) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  for (const item of cookies) {
    const [name, ...parts] = item.trim().split('=');
    if (name === BINDING_COOKIE) return parts.join('=');
  }
  return '';
}

function createDiscordOAuthHttpHandler({
  environment,
  allowedOrigin,
  oauth,
  resolveAuthority,
  randomBytes = crypto.randomBytes
} = {}) {
  if (environment !== 'development') throw new TypeError('Discord OAuth prototype is development-only');
  const origin = loopbackOrigin(allowedOrigin);
  if (!oauth?.begin || !oauth?.complete || typeof resolveAuthority !== 'function') {
    throw new TypeError('Discord OAuth HTTP dependencies are incomplete');
  }

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || request.headers.get('origin') !== origin) fail('permission_denied', 'request/origin_invalid');
      if (request.method !== 'POST') fail('invalid_argument', 'request/method_invalid');
      const input = await body(request);
      if (url.pathname === `${ROOT}/begin`) {
        exact(input, ['operation', 'requestId']);
        const existingBinding = cookieValue(request);
        const browserBinding = BINDING.test(existingBinding) ? existingBinding : Buffer.from(randomBytes(32)).toString('base64url');
        const result = await oauth.begin({
          ...input,
          browserBinding,
          clientKey: browserBinding,
          currentAuthority: () => resolveAuthority(request)
        });
        return response(result, 200, {
          'set-cookie': `${BINDING_COOKIE}=${browserBinding}; HttpOnly; SameSite=Lax; Path=${ROOT}; Max-Age=600`
        });
      }
      if (url.pathname === `${ROOT}/complete`) {
        exact(input, ['code', 'requestId', 'state']);
        const browserBinding = cookieValue(request);
        if (!BINDING.test(browserBinding)) fail('permission_denied', 'discord/browser_binding_missing');
        const result = await oauth.complete({
          ...input,
          browserBinding,
          clientKey: browserBinding,
          observedRedirectUri: oauth.redirectUri,
          currentAuthority: () => resolveAuthority(request)
        });
        return response(result);
      }
      fail('invalid_argument', 'request/route_invalid');
    } catch (error) {
      const safe = stableError(error);
      return response({ ok: false, error: safe }, statusFor(safe.code));
    }
  };
}

module.exports = { BINDING_COOKIE, MAX_BODY_BYTES, ROOT, createDiscordOAuthHttpHandler };
