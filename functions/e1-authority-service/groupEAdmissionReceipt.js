'use strict';

const crypto = require('node:crypto');

const HASH = /^[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SLOTS = Object.freeze(['A', 'B']);
const RECEIPT_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'slot', 'capabilityDigest', 'consumptionRecordDigest', 'attemptHash',
  'uidHash', 'cohortDigest', 'keyId', 'receiptDigest'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function digestArray(domain, values) {
  return crypto.createHash('sha256').update(JSON.stringify([1, domain, ...values]), 'utf8').digest('hex');
}

function attemptHash(attemptId) {
  if (!UUID_V4.test(attemptId || '')) fail('E1_GROUP_E_RECEIPT_INVALID');
  return digestArray('group-e-client-attempt', [attemptId]);
}

function subjectHash(kind, value) {
  if (!['uid', 'trainer'].includes(kind) || typeof value !== 'string' || !value) {
    fail('E1_GROUP_E_RECEIPT_INVALID');
  }
  return digestArray('group-e-client-foundation', [kind, value]);
}

function admissionReceiptDigest(value) {
  return digestArray('group-e-admission-receipt', [
    value.schemaVersion, value.recordType, value.runId, value.slot, value.capabilityDigest,
    value.consumptionRecordDigest, value.attemptHash, value.uidHash, value.cohortDigest, value.keyId
  ]);
}

function validateAdmissionReceipt(value, context = {}) {
  if (!exactFields(value, RECEIPT_FIELDS) || value.schemaVersion !== 1 ||
      value.recordType !== 'group-e-admission-receipt' || !UUID_V4.test(value.runId || '') ||
      !SLOTS.includes(value.slot) || !HASH.test(value.capabilityDigest || '') ||
      !HASH.test(value.consumptionRecordDigest || '') || !HASH.test(value.attemptHash || '') ||
      !HASH.test(value.uidHash || '') || !HASH.test(value.cohortDigest || '') || !HASH.test(value.keyId || '') ||
      !HASH.test(value.receiptDigest || '') || value.receiptDigest !== admissionReceiptDigest(value)) {
    fail('E1_GROUP_E_RECEIPT_INVALID');
  }
  for (const [field, expected] of Object.entries(context)) {
    if (expected !== undefined && value[field] !== expected) fail('E1_GROUP_E_RECEIPT_MISMATCH');
  }
  return Object.freeze(structuredClone(value));
}

function responseBinding(uid, attemptId, receiptDigest) {
  if (typeof uid !== 'string' || !uid || !HASH.test(receiptDigest || '')) fail('E1_GROUP_E_RECEIPT_INVALID');
  return digestArray('group-e-client-response', [uid, attemptId, receiptDigest]);
}

module.exports = Object.freeze({
  HASH,
  RECEIPT_FIELDS,
  SLOTS,
  UUID_V4,
  admissionReceiptDigest,
  attemptHash,
  responseBinding,
  subjectHash,
  validateAdmissionReceipt
});
