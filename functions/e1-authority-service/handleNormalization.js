'use strict';

const FIREBASE_KEY_FORBIDDEN = /[.#$\[\]/\u0000-\u001f\u007f]/u;
const INVISIBLE_OR_BIDI = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const HANDLE_ALLOWED = /^[\p{L}\p{N} _.'-]+$/u;
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'firebase', 'pogo trades', 'pogotrades', 'support', 'system']);

class HandleValidationError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'HandleValidationError';
    this.reason = reason;
  }
}

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
  if (!display) throw new HandleValidationError('handle/empty');
  if (codePointLength(display) > 64) throw new HandleValidationError('handle/too_long');
  if (FIREBASE_KEY_FORBIDDEN.test(normalized) || INVISIBLE_OR_BIDI.test(display) || !HANDLE_ALLOWED.test(display)) {
    throw new HandleValidationError('handle/invalid_characters');
  }
  if (RESERVED_HANDLES.has(normalized)) throw new HandleValidationError('handle/reserved');
  if (scriptsIn(display).length > 1) throw new HandleValidationError('handle/confusable_mixed_script');
  return Object.freeze({
    display,
    normalized,
    handleKey: `v1_${Buffer.from(normalized, 'utf8').toString('hex')}`
  });
}

module.exports = { HandleValidationError, codePointLength, fold, normalizeHandle };
