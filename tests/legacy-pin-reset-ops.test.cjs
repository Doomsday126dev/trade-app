'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCredentialProbe } = require('../scripts/legacy-pin-reset-ops.cjs');
const uid = 'synthetic-pin-reset-test';
const rejected = { name: 'old', status: 400, error: 'INVALID_LOGIN_CREDENTIALS', uid: null };
const accepted = { name: 'new', status: 200, error: null, uid };

test('synthetic credential proof requires an actual old-PIN denial and same-UID new login', () => {
  assert.doesNotThrow(() => validateCredentialProbe([rejected, accepted], uid));
  assert.doesNotThrow(() => validateCredentialProbe([{ ...rejected, error: 'INVALID_PASSWORD' }, accepted], uid));
});
test('API restrictions and unrelated auth errors are not mistaken for old-PIN rejection', () => {
  for (const failure of [{ status: 403, error: 'API_KEY_HTTP_REFERRER_BLOCKED' }, { status: 400, error: 'OPERATION_NOT_ALLOWED' }, { status: 429, error: 'TOO_MANY_ATTEMPTS_TRY_LATER' }]) {
    assert.throws(() => validateCredentialProbe([{ ...rejected, ...failure }, accepted], uid));
  }
});
test('new-PIN failure, UID substitution, and malformed probe results fail closed', () => {
  assert.throws(() => validateCredentialProbe([rejected, { ...accepted, status: 400 }], uid));
  assert.throws(() => validateCredentialProbe([rejected, { ...accepted, uid: 'different-account' }], uid));
  assert.throws(() => validateCredentialProbe([accepted, rejected], uid));
  assert.throws(() => validateCredentialProbe([rejected], uid));
});
