'use strict';

const { fail } = require('./errors');
const sharedHandle = require('../../e1-authority-service/handleNormalization');

const INVISIBLE_OR_BIDI = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const TAG_ALLOWED = /^[\p{L}\p{N} _.'+#&()/-]+$/u;

function codePointLength(value) {
  return sharedHandle.codePointLength(value);
}

function fold(value) {
  return sharedHandle.fold(value);
}

function normalizeHandle(value) {
  try {
    const { display, normalized } = sharedHandle.normalizeHandle(value);
    return Object.freeze({ display, normalized });
  } catch (error) {
    if (error instanceof sharedHandle.HandleValidationError) fail('invalid_argument', error.reason);
    throw error;
  }
}

function normalizeTagLabel(value) {
  const display = String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const normalized = fold(display);
  if (!display) fail('invalid_argument', 'tag/empty');
  if (codePointLength(display) > 40) fail('invalid_argument', 'tag/too_long');
  if (INVISIBLE_OR_BIDI.test(display) || !TAG_ALLOWED.test(display)) fail('invalid_argument', 'tag/invalid_characters');
  return Object.freeze({
    display,
    normalized,
    labelKey: Buffer.from(normalized, 'utf8').toString('hex')
  });
}

function sha256(value) {
  return require('node:crypto').createHash('sha256').update(String(value), 'utf8').digest('hex');
}

module.exports = { codePointLength, fold, normalizeHandle, normalizeTagLabel, sha256 };
