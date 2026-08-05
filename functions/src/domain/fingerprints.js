'use strict';

const { sha256 } = require('./normalization');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return sha256(stable(value));
}

function correlationHash(requestId) {
  return sha256(`correlation:${requestId}`).slice(0, 16);
}

module.exports = { correlationHash, fingerprint, stable };
