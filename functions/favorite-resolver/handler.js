'use strict';
const { LIMITS, key, fail, requestHandles } = require('./contract');
const STATUSES = Object.freeze({
  'favorite/not-enabled': 503, 'favorite/unavailable': 503, 'favorite/quota-unavailable': 503,
  'favorite/request-invalid': 400, 'favorite/request-too-large': 413, 'favorite/method-not-allowed': 405,
  'favorite/auth-required': 401, 'favorite/app-check-required': 401, 'favorite/caller-unavailable': 403,
  'favorite/origin-denied': 403, 'favorite/rate-limited': 429, 'favorite/busy': 429
});
function createHandler({ enabled, origins, verifyAuth, verifyAppCheck, quota, resolve, now = Date.now }) {
  if (typeof enabled !== 'function' || !Array.isArray(origins) || !origins.length || [verifyAuth, verifyAppCheck, resolve].some(fn => typeof fn !== 'function') || !quota?.acquire || !quota?.release) throw new TypeError('Favorite resolver dependencies are required');
  return async function handler(req, res) {
    const origin = req.headers?.origin;
    res.set('Cache-Control', 'no-store'); res.set('Vary', 'Origin');
    if (typeof origin !== 'string' || !origins.includes(origin)) return res.status(403).json({ code: 'favorite/origin-denied' });
    res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Expose-Headers', 'Retry-After');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
      res.set('Access-Control-Max-Age', '600'); return res.status(204).send('');
    }
    let lease, settled = false, timer, open = true;
    const started = now(), current = () => open && now() - started < LIMITS.deadlineMs;
    try {
      if (req.method !== 'POST') fail('favorite/method-not-allowed');
      if (!enabled()) fail('favorite/not-enabled');
      if (typeof req.headers['content-type'] !== 'string' || req.headers['content-type'].split(';')[0].trim().toLowerCase() !== 'application/json') fail('favorite/request-invalid');
      const bytes = req.rawBody?.length ?? Buffer.byteLength(JSON.stringify(req.body ?? null));
      if (bytes > LIMITS.bodyBytes) fail('favorite/request-too-large');
      const handles = requestHandles(req.body);
      const authorization = req.headers.authorization, appToken = req.headers['x-firebase-appcheck'];
      if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) fail('favorite/auth-required');
      if (typeof appToken !== 'string' || appToken.length < 1 || appToken.length > 8192) fail('favorite/app-check-required');
      const work = (async () => {
        let caller;
        try { caller = await verifyAuth(authorization.slice(7)); } catch { fail('favorite/auth-required'); }
        if (!key(caller?.uid) || !current()) fail('favorite/auth-required');
        try { if (await verifyAppCheck(appToken) !== true) fail('favorite/app-check-required'); } catch { fail('favorite/app-check-required'); }
        if (!current()) fail('favorite/unavailable');
        lease = await quota.acquire(caller.uid, handles.length);
        if (!current()) fail('favorite/unavailable');
        return { version: 1, results: await resolve(caller.uid, handles, current) };
      })();
      work.then(() => { settled = true; }, () => { settled = true; });
      const value = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('favorite/unavailable'), { code: 'favorite/unavailable' })), LIMITS.deadlineMs); })]);
      return res.status(200).json(value);
    } catch (error) {
      const code = Object.hasOwn(STATUSES, error?.code) ? error.code : 'favorite/unavailable';
      if (STATUSES[code] === 429) res.set('Retry-After', String(Math.max(1, Math.min(900, Number(error.retryAfter) || 2))));
      // No SDK messages, raw errors, identities, handles, tokens or bodies in logs.
      return res.status(STATUSES[code]).json({ code });
    } finally {
      open = false; clearTimeout(timer);
      // An unfinished timeout keeps its lease through the platform's 30s hard
      // timeout (lease is 60s); no new work can use this request after deadline.
      if (lease && settled) try { await quota.release(lease); } catch { /* The bounded lease expires; quota is never refunded. */ }
    }
  };
}
module.exports = { createHandler, STATUSES };
