'use strict';

// The callable SDK logs malformed envelopes and tagged decode values before
// invoking our handler. This endpoint needs only a flat, string-valued request.
function guardEnvelope(callable) {
  const guarded = async (req, res) => {
    if (req.method === 'OPTIONS') return callable(req, res);
    const body = req.body, data = body?.data, contentType = req.headers?.['content-type'];
    const fields = ['action', 'username', 'requestId', 'targetUid', 'fingerprint', 'pin'];
    if (req.method !== 'POST' || typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json' ||
        !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !data || typeof data !== 'object' || Array.isArray(data) ||
        Object.entries(data).some(([key, value]) => !fields.includes(key) || typeof value !== 'string')) {
      return res.status(400).send({ error: { status: 'INVALID_ARGUMENT', message: 'reset/invalid-request' } });
    }
    try { return await callable(req, res); }
    finally { delete data.pin; }
  };
  // Preserve Firebase discovery metadata, including the non-enumerable getter.
  for (const key of ['__endpoint', '__trigger', 'run', 'stream']) {
    const descriptor = Object.getOwnPropertyDescriptor(callable, key);
    if (descriptor) Object.defineProperty(guarded, key, descriptor);
  }
  return guarded;
}
module.exports = { guardEnvelope };
