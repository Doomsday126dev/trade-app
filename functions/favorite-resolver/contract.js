'use strict';
const { createHash } = require('node:crypto');
const CONTRACT = 'immutable-bindings-retired-uids-v1';
const LIMITS = Object.freeze({ handles: 50, bodyBytes: 16384, requests: 24, work: 240, windowMs: 900000, callerConcurrency: 2, targetConcurrency: 4, leaseMs: 60000, deadlineMs: 20000 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && value === value.normalize('NFC') && !/[.#$\[\]/\u0000-\u001f\u007f]/u.test(value);
const exact = (value, fields) => plain(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
function fail(code, retryAfter = 0) { throw Object.assign(new Error(code), { code, retryAfter }); }
function requestHandles(body) {
  if (!exact(body, ['handles']) || !Array.isArray(body.handles) || body.handles.length < 1 || body.handles.length > LIMITS.handles ||
      body.handles.some(value => !key(value, 64)) || new Set(body.handles).size !== body.handles.length) fail('favorite/request-invalid');
  return [...body.handles];
}
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
module.exports = { CONTRACT, LIMITS, plain, key, exact, fail, requestHandles, digest };
