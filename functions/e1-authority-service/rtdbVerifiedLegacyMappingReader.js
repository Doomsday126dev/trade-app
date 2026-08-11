'use strict';

const { HandleValidationError, normalizeHandle } = require('./handleNormalization');

const EXPECTED_STAGING_URL = 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com';
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validatedTarget({ environment, projectId, databaseUrl }) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { fail('E1_RTDB_CONFIGURATION_INVALID'); }
  if (environment === 'staging') {
    if (projectId !== 'trainer-hub-staging-37ib4wct' || parsed.origin !== EXPECTED_STAGING_URL ||
        parsed.pathname !== '/' || parsed.search || parsed.hash || !parsed.hostname.includes('-staging-')) {
      fail('E1_RTDB_CONFIGURATION_INVALID');
    }
  } else if (environment === 'emulator') {
    if (!String(projectId || '').startsWith('demo-') || parsed.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.hash) {
      fail('E1_RTDB_CONFIGURATION_INVALID');
    }
  } else {
    fail('E1_RTDB_CONFIGURATION_INVALID');
  }
  return parsed;
}

function result(status, reason, extra = {}) {
  return Object.freeze({ status, ...(reason ? { reason } : {}), ...extra });
}

function createVerifiedLegacyMappingReader({ environment, projectId, databaseUrl, fetchImpl = fetch, onEvent = () => {}, timeoutMs = 4000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof onEvent !== 'function') throw new TypeError('RTDB reader dependencies required');
  const target = validatedTarget({ environment, projectId, databaseUrl });

  async function exactRead(pathClass, segments, firebaseIdToken) {
    const startedAt = Date.now();
    const url = new URL(target);
    const prefix = target.pathname === '/' ? '' : target.pathname.replace(/\/$/u, '');
    url.pathname = `${prefix}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}.json`;
    url.searchParams.set('auth', firebaseIdToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal
      });
    } catch {
      onEvent({ operationClass: 'legacy-mapping-read', pathClass, httpStatus: 0, latencyMs: Date.now() - startedAt });
      return result('unavailable', 'network');
    } finally {
      clearTimeout(timeout);
    }
    onEvent({ operationClass: 'legacy-mapping-read', pathClass, httpStatus: response.status, latencyMs: Date.now() - startedAt });
    if (response.status === 401 || response.status === 403) return result('permission-denied', pathClass);
    if (!response.ok) return result('unavailable', 'http');
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return result('unavailable', 'response-too-large');
    let raw;
    try { raw = await response.text(); } catch { return result('unavailable', 'response'); }
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) return result('unavailable', 'response-too-large');
    try { return result('ok', null, { value: JSON.parse(raw) }); } catch { return result('unavailable', 'response'); }
  }

  async function readVerifiedLegacyMapping({ verifiedUid, firebaseIdToken } = {}) {
    if (!UID.test(verifiedUid || '') || typeof firebaseIdToken !== 'string' || !firebaseIdToken || Buffer.byteLength(firebaseIdToken) > 8192) {
      return result('unavailable', 'invalid-input');
    }
    const index = await exactRead('auth-index-username', ['authIndex', verifiedUid, 'username'], firebaseIdToken);
    if (index.status !== 'ok') return index;
    if (typeof index.value !== 'string' || !index.value) return result('mapping-incomplete', 'auth-index-missing');
    let username;
    try { username = normalizeHandle(index.value).display; } catch (error) {
      if (error instanceof HandleValidationError) return result('mapping-conflict', 'username-invalid');
      return result('unavailable', 'normalization');
    }
    if (username !== index.value) return result('mapping-conflict', 'username-noncanonical');

    const [user, directory] = await Promise.all([
      exactRead('user-auth-uid', ['users', username, 'authUid'], firebaseIdToken),
      exactRead('login-directory-entry', ['loginDirectory', username], firebaseIdToken)
    ]);
    if (user.status !== 'ok') return user;
    if (directory.status !== 'ok') return directory;
    if (typeof user.value !== 'string' || !user.value) return result('mapping-incomplete', 'user-auth-uid-missing');
    if (user.value !== verifiedUid) return result('mapping-conflict', 'uid-mismatch');
    if (!directory.value || typeof directory.value !== 'object' || Array.isArray(directory.value) ||
        directory.value.authReady !== true || !Number.isSafeInteger(directory.value.authVersion) || directory.value.authVersion < 1) {
      return result('mapping-incomplete', 'login-directory-unready');
    }
    return result('ready', null, { username, legacyAuthVersion: directory.value.authVersion });
  }

  return Object.freeze({ readVerifiedLegacyMapping });
}

module.exports = { EXPECTED_STAGING_URL, createVerifiedLegacyMappingReader, validatedTarget };
