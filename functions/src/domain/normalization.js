'use strict';

const crypto = require('node:crypto');
const { fail } = require('./errors');

const FIREBASE_KEY_FORBIDDEN = /[.#$\[\]/\u0000-\u001f\u007f]/u;
const INVISIBLE_OR_BIDI = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const HANDLE_ALLOWED = /^[\p{L}\p{N} _.'-]+$/u;
const TAG_ALLOWED = /^[\p{L}\p{N} _.'+#&()/-]+$/u;
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'firebase', 'pogo trades', 'pogotrades', 'support', 'system']);

function codePointLength(value) {
  return Array.from(value).length;
}

function fold(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase();
}

function scriptsIn(value) {
  return [
    ['latin', /\p{Script=Latin}/u],
    ['cyrillic', /\p{Script=Cyrillic}/u],
    ['greek', /\p{Script=Greek}/u]
  ].filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

function normalizeHandle(value) {
  const display = String(value ?? '').normalize('NFKC').trim();
  const normalized = fold(display);
  if (!display) fail('invalid_argument', 'handle/empty');
  if (codePointLength(display) > 64) fail('invalid_argument', 'handle/too_long');
  if (FIREBASE_KEY_FORBIDDEN.test(normalized) || INVISIBLE_OR_BIDI.test(display) || !HANDLE_ALLOWED.test(display)) {
    fail('invalid_argument', 'handle/invalid_characters');
  }
  if (RESERVED_HANDLES.has(normalized)) fail('invalid_argument', 'handle/reserved');
  if (scriptsIn(display).length > 1) fail('invalid_argument', 'handle/confusable_mixed_script');
  return Object.freeze({ display, normalized });
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
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { codePointLength, fold, normalizeHandle, normalizeTagLabel, sha256 };
