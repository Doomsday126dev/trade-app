'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const requireFunctions = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getAuth } = requireFunctions('firebase-admin/auth');

const projectId = 'demo-google-orphan-recovery';
const host = '127.0.0.1:9767';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, host);
const app = initializeApp({ projectId }, 'google-orphan-recovery-test');
const adminAuth = getAuth(app);
const endpoint = operation => `http://${host}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=emulator`;
async function authRequest(operation, body) {
  const response = await fetch(endpoint(operation), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}
const googlePostBody = subject => new URLSearchParams({ providerId: 'google.com',
  id_token: JSON.stringify({ sub: subject, email: 'synthetic-google@example.test', email_verified: true }) }).toString();
const googleRequest = (subject, idToken) => ({ postBody: googlePostBody(subject), requestUri: 'http://localhost',
  ...(idToken ? { idToken } : {}), returnIdpCredential: true, returnSecureToken: true });
function actualGoogleAdapter(auth, linkWithPopup) {
  const window = {}; window.window = window;
  const context = vm.createContext({ window, console });
  vm.runInContext(readFileSync(path.resolve(__dirname, '../../js/services/googleAuthAdapter.js'), 'utf8'),
    context, { filename: 'js/services/googleAuthAdapter.js' });
  return window.PogoServices.googleAuthAdapter.createGoogleAuthAdapter({
    getAuth: () => auth, GoogleAuthProvider: function GoogleAuthProvider() {}, linkWithPopup,
    signInWithPopup: async () => { throw new Error('unused'); },
    reauthenticateWithPopup: async () => { throw new Error('unused'); },
    unlink: async () => { throw new Error('unused'); }
  });
}

before(async () => { await adminAuth.createUser({ uid: 'original-pin-uid', email: 'synthetic-pin@example.test',
  password: 'synthetic-pin-password-123' }); });
after(async () => { await deleteApp(app); });

test('Auth emulator allocates an orphan Google UID, rejects original linking, then preserves original UID after exact Admin unlink', async () => {
  const subject = 'synthetic-google-subject-1';
  const first = await authRequest('signInWithIdp', googleRequest(subject));
  assert.equal(first.status, 200);
  const orphanUid = first.value.localId;
  assert.notEqual(orphanUid, 'original-pin-uid');
  const pin = await authRequest('signInWithPassword', { email: 'synthetic-pin@example.test',
    password: 'synthetic-pin-password-123', returnSecureToken: true });
  assert.equal(pin.status, 200);
  assert.equal(pin.value.localId, 'original-pin-uid');
  const session = { currentUser: { uid: 'original-pin-uid', providerData: [{ providerId: 'password' }] } };
  const adapter = actualGoogleAdapter(session, async user => {
    const response = await authRequest('signInWithIdp', googleRequest(subject, pin.value.idToken));
    if (response.value.errorMessage) {
      const error = new Error(response.value.errorMessage);
      error.code = response.value.errorMessage === 'FEDERATED_USER_ID_ALREADY_LINKED'
        ? 'auth/credential-already-in-use' : 'auth/account-exists-with-different-credential';
      throw error;
    }
    assert.equal(response.value.localId, user.uid);
    user.providerData.push({ providerId: 'google.com', uid: subject });
    return { user };
  });
  await assert.rejects(adapter.linkCurrentUser({ providerKey: 'google' }), error => {
    assert.equal(error.code, 'auth/credential-already-in-use');
    return true;
  });
  assert.equal(session.currentUser.uid, 'original-pin-uid');
  const collided = await authRequest('signInWithIdp', googleRequest(subject, pin.value.idToken));
  assert.equal(collided.value.errorMessage ?? collided.value.error?.message,
    'FEDERATED_USER_ID_ALREADY_LINKED');
  assert.equal(collided.value.localId, undefined);
  const before = await adminAuth.getUser(orphanUid);
  assert.equal(before.providerData.find(item => item.providerId === 'google.com')?.uid, subject);
  await adminAuth.updateUser(orphanUid, { providersToUnlink: ['google.com'],
    email: `released-${orphanUid}@example.test` });
  const afterRelease = await adminAuth.getUser(orphanUid);
  assert.equal(afterRelease.providerData.some(item => item.providerId === 'google.com'), false);
  assert.equal(afterRelease.email, `released-${orphanUid}@example.test`.toLowerCase());
  const linked = await adapter.linkCurrentUser({ providerKey: 'google' });
  assert.equal(linked.uid, 'original-pin-uid');
  assert.equal(linked.status, 'linked');
  const googleReturn = await authRequest('signInWithIdp', googleRequest(subject));
  assert.equal(googleReturn.status, 200);
  assert.equal(googleReturn.value.localId, 'original-pin-uid');
  const pinReturn = await authRequest('signInWithPassword', { email: 'synthetic-pin@example.test',
    password: 'synthetic-pin-password-123', returnSecureToken: true });
  assert.equal(pinReturn.status, 200);
  assert.equal(pinReturn.value.localId, 'original-pin-uid');
});
