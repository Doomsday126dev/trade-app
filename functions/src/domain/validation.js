'use strict';

const { fail } = require('./errors');

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const TAG_ID = /^tag_[a-z0-9_-]{1,80}$/;
const PUBLIC_CATEGORIES = new Set(['wishlist', 'dynamax', 'gmax', 'costumes']);

function plainObject(value, reason = 'request/object_required') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('invalid_argument', reason);
  }
  return value;
}

function exactFields(value, required, optional = [], reason = 'request/schema_invalid') {
  plainObject(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    fail('invalid_argument', reason);
  }
}

function boundedPayload(value, maxBytes) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { fail('invalid_argument', 'request/not_serializable'); }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) fail('payload_too_large', 'request/payload_too_large');
}

function requestId(value) {
  const id = String(value ?? '');
  if (!REQUEST_ID.test(id)) fail('invalid_argument', 'request/id_invalid');
  return id;
}

function uid(value, reason = 'identity/uid_invalid') {
  const id = String(value ?? '');
  if (!UID.test(id)) fail('invalid_argument', reason);
  return id;
}

function tagId(value) {
  const id = String(value ?? '');
  if (!TAG_ID.test(id)) fail('invalid_argument', 'tag/id_invalid');
  return id;
}

function trainerLabel(value) {
  if (typeof value !== 'string') fail('invalid_argument', 'favorite/label_invalid');
  const label = String(value ?? '').normalize('NFKC').trim();
  if (!label || Array.from(label).length > 64 || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(label)) {
    fail('invalid_argument', 'favorite/label_invalid');
  }
  return label;
}

function safeInteger(value, min, max, reason) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_argument', reason);
  return value;
}

function publicSnapshot(value) {
  plainObject(value, 'history/snapshot_invalid');
  const keys = Object.keys(value);
  if (keys.length > 1500) fail('payload_too_large', 'history/too_many_entries');
  const snapshot = {};
  for (const key of keys.sort()) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) fail('invalid_argument', 'history/entry_id_invalid');
    const entry = value[key];
    exactFields(entry, ['category', 'fingerprint'], [], 'history/entry_invalid');
    if (!PUBLIC_CATEGORIES.has(entry.category) || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) {
      fail('invalid_argument', 'history/entry_invalid');
    }
    snapshot[key] = { category: entry.category, fingerprint: entry.fingerprint };
  }
  return snapshot;
}

module.exports = { boundedPayload, exactFields, plainObject, publicSnapshot, requestId, safeInteger, tagId, trainerLabel, uid };
