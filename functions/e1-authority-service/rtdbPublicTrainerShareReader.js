'use strict';

const { validateRtdbTarget } = require('./e1TargetContracts');
const { MAX_PROJECTION_BYTES } = require('./providerPublicProjection');

const UID = /^[A-Za-z0-9_-]{6,128}$/u;

function result(status, extra = {}) {
  return Object.freeze({ status, ...extra });
}

function createPublicTrainerShareReader({ environment, projectId, databaseUrl, fetchImpl = fetch,
  onEvent = () => {}, timeoutMs = 4000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof onEvent !== 'function') {
    throw new TypeError('Public trainer-share reader dependencies required');
  }
  let target;
  try { target = validateRtdbTarget({ environment, projectId, databaseUrl }); }
  catch { throw Object.assign(new Error('E1_RTDB_CONFIGURATION_INVALID'), { code: 'E1_RTDB_CONFIGURATION_INVALID' }); }

  async function read(ownerUid) {
    if (!UID.test(ownerUid || '')) return result('invalid-input');
    const startedAt = Date.now();
    const url = new URL(target);
    const prefix = target.pathname === '/' ? '' : target.pathname.replace(/\/$/u, '');
    url.pathname = `${prefix}/trainerShares/${encodeURIComponent(ownerUid)}.json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal
      });
    } catch {
      onEvent({ operationClass: 'public-trainer-share-read', pathClass: 'trainer-share-owner', httpStatus: 0,
        latencyMs: Date.now() - startedAt });
      return result('unavailable');
    } finally { clearTimeout(timeout); }
    onEvent({ operationClass: 'public-trainer-share-read', pathClass: 'trainer-share-owner',
      httpStatus: response.status, latencyMs: Date.now() - startedAt });
    if (response.status === 401 || response.status === 403) return result('permission-denied');
    if (!response.ok) return result('unavailable');
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declared) && declared > MAX_PROJECTION_BYTES) return result('oversized');
    let raw;
    try { raw = await response.text(); } catch { return result('unavailable'); }
    if (Buffer.byteLength(raw) > MAX_PROJECTION_BYTES) return result('oversized');
    let value;
    try { value = JSON.parse(raw); } catch { return result('invalid-response'); }
    return value === null ? result('not-found') : result('ready', { value });
  }

  return Object.freeze({ read });
}

module.exports = Object.freeze({ createPublicTrainerShareReader });
