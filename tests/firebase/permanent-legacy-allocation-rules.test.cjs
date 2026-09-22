'use strict';
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const project = 'demo-pogo-permanent-legacy-allocation';
const namespace = `${project}-default-rtdb`;
const tokens = {}, ids = {};
async function call(method, path, value, token) {
  const url = new URL(`http://127.0.0.1:9701/${path ? `${path}.json` : '.json'}`);
  url.searchParams.set('ns', namespace);
  if (token && token !== 'emulator-owner') url.searchParams.set('auth', token);
  const response = await fetch(url, { method, headers: { ...(value === undefined ? {} : { 'content-type': 'application/json' }),
    ...(token === 'emulator-owner' ? { authorization: 'Bearer owner' } : {}) },
    body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: response.status, body: await response.text() };
}
async function allowed(promise) { const result = await promise; assert.ok(result.status >= 200 && result.status < 300, result.body); }
async function denied(promise) { const result = await promise; assert.ok([400, 401, 403].includes(result.status), `${result.status} ${result.body}`); }
before(async () => {
  for (const name of ['admin', 'owner', 'old']) {
    const response = await fetch('http://127.0.0.1:9798/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${name}@example.test`, password: 'synthetic-password-123', returnSecureToken: true }) });
    assert.equal(response.status, 200);
    const result = await response.json(); tokens[name] = result.idToken; ids[name] = result.localId;
  }
});
beforeEach(async () => {
  await allowed(call('PUT', '', null, 'emulator-owner'));
  const seed = { admins: { [ids.admin]: true }, users: { Existing: { authUid: ids.owner, authEmail: 'owner@example.test',
    authVersion: 1, friendCode: '', isAdmin: false, isOwner: false } },
  loginDirectory: { Existing: { authReady: true, authVersion: 1 } },
  authIndex: { [ids.owner]: { username: 'Existing', authVersion: 1 } },
  requests: { req_1700000000000_seed: { username: 'NewTrainer', note: '', requestedAt: 1700000000000, status: 'pending' } } };
  await allowed(call('PUT', '', seed, 'emulator-owner'));
});
test('old browser/admin allocation and request approval remain closed without the temporary fence', async () => {
  await denied(call('PUT', 'users/NewTrainer', { authUid: ids.old, authEmail: 'old@example.test' }, tokens.old));
  await denied(call('PUT', 'users/NewTrainer', { authUid: ids.old, authEmail: 'old@example.test' }, tokens.admin));
  await denied(call('PUT', 'loginDirectory/NewTrainer', { authReady: true }, tokens.admin));
  await denied(call('PUT', `authIndex/${ids.old}`, { username: 'NewTrainer' }, tokens.admin));
  await denied(call('PATCH', 'requests/req_1700000000000_seed', { status: 'approved' }, tokens.admin));
});
test('same UID sign-in reads, profile updates and reviewed PIN version update remain available', async () => {
  await allowed(call('GET', 'loginDirectory/Existing'));
  await allowed(call('GET', 'users/Existing', undefined, tokens.owner));
  await allowed(call('PATCH', 'users/Existing', { friendCode: '1111 2222' }, tokens.owner));
  await allowed(call('PATCH', 'users/Existing', { authVersion: 2, authEmail: 'owner-v2@example.test' }, tokens.admin));
  await allowed(call('PATCH', 'loginDirectory/Existing', { authVersion: 2 }, tokens.admin));
  await allowed(call('PATCH', `authIndex/${ids.owner}`, { authVersion: 2 }, tokens.admin));
  await denied(call('PATCH', 'users/Existing', { authUid: ids.old }, tokens.admin));
  await denied(call('PATCH', `authIndex/${ids.owner}`, { username: 'Renamed' }, tokens.admin));
  await denied(call('DELETE', 'users/Existing', undefined, tokens.admin));
});
