'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { snapshotFromTrainerShare } = require('../src/adapters/firebaseTrustedAdapter');

const projectId = process.env.GCLOUD_PROJECT;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const functionsHost = '127.0.0.1:9501';
const databaseNamespace = `${projectId}-default-rtdb`;
let app, database, token;

async function authToken(email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'synthetic-password-123', returnSecureToken: true })
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { token: body.idToken, uid: body.localId };
}

async function call(name, data, bearer = token) {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`http://${functionsHost}/${projectId}/us-east1/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return { status: response.status, body: await response.json() };
}

function callableResult(response, operation) {
  assert.equal(response.status, 200, `${operation}: ${JSON.stringify(response.body)}`);
  assert.ok(response.body?.result, `${operation}: missing callable result`);
  return response.body.result;
}

test.before(async () => {
  assert.equal(projectId, 'demo-pogo-trusted-functions');
  assert.match(databaseHost || '', /^127\.0\.0\.1:/);
  assert.match(authHost || '', /^127\.0\.0\.1:/);
  assert.equal(process.env.TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS, 'true');
  app = initializeApp({ projectId, databaseURL: `http://${databaseHost}?ns=${databaseNamespace}` }, 'trusted-emulator-tests');
  database = getDatabase(app);
  const identity = await authToken('caller@example.invalid');
  token = identity.token;
  const viewer = await authToken('viewer@example.invalid');
  const owner = await authToken('owner@example.invalid');
  const share = { shareVersion: 1, updatedAt: 100, lists: { wishlist: { entry_one: { p: 'H' } }, dynamax: {}, gmax: {}, costumes: {} } };
  await database.ref().set({
    shareVisibilityConfig: { writesEnabled: true },
    trainerPreferencesConfig: { writesEnabled: true },
    accounts: {
      [viewer.uid]: { trainerName: 'ViewerDemo', normalizedTrainerName: 'viewerdemo' },
      [owner.uid]: { trainerName: 'OwnerDemo', normalizedTrainerName: 'ownerdemo' }
    },
    shareDirectory: {
      viewerdemo: { ownerUid: viewer.uid, trainerName: 'ViewerDemo', state: 'published' },
      ownerdemo: { ownerUid: owner.uid, trainerName: 'OwnerDemo', state: 'published' }
    },
    shareVisibility: { [owner.uid]: { mode: 'public' } },
    trainerShares: { [owner.uid]: share },
    _test: { callerUid: identity.uid, viewerUid: viewer.uid, ownerUid: owner.uid }
  });
});

test.after(async () => { if (app) await deleteApp(app); });

test('unauthenticated callable request is denied', async () => {
  const response = await call('reserveTrainerHandle', { requestedHandle: 'DemoHandle', requestId: 'request-emulator-auth' }, null);
  assert.equal(response.status, 401);
});

test('reserveTrainerHandle runs once and replays safely', async () => {
  const input = { requestedHandle: 'DemoHandle', requestId: 'request-emulator-handle' };
  assert.equal(callableResult(await call('reserveTrainerHandle', input), 'reserveTrainerHandle').status, 'reserved');
  assert.equal(callableResult(await call('reserveTrainerHandle', input), 'reserveTrainerHandle replay').replay, true);
});

test('claimTrainerTagLabel creates a normalized private tag claim', async () => {
  const response = await call('claimTrainerTagLabel', { action: 'create', tagId: 'tag_demo', label: 'Demo Group', baseRevision: 0, requestId: 'request-emulator-tag' });
  assert.equal(callableResult(response, 'claimTrainerTagLabel').status, 'created');
  const concurrent = await Promise.all([
    call('claimTrainerTagLabel', { action: 'create', tagId: 'tag_concurrent_a', label: 'Ｃｏｎｃｕｒｒｅｎｔ Group', baseRevision: 0, requestId: 'request-emulator-tag-concurrent-a' }),
    call('claimTrainerTagLabel', { action: 'create', tagId: 'tag_concurrent_b', label: 'concurrent group', baseRevision: 0, requestId: 'request-emulator-tag-concurrent-b' })
  ]);
  assert.equal(concurrent.filter(result => result.status === 200 && result.body?.result).length, 1);
  assert.equal(concurrent.filter(result => result.status >= 400 && result.body?.error).length, 1);
  const ids = (await database.ref('_test').get()).val();
  const prefs = (await database.ref(`userPreferences/${ids.callerUid}`).get()).val();
  assert.equal(Object.values(prefs.trainerTags).filter(tag => tag.active === true).length, 2);
  assert.equal(Object.keys(prefs.trainerTagLabels).length, 2);
});

test('verifyTrainerHistory verifies exact public source and records one entry', async () => {
  const ids = (await database.ref('_test').get()).val();
  const share = (await database.ref(`trainerShares/${ids.ownerUid}`).get()).val();
  const publicSnapshot = snapshotFromTrainerShare(share);
  const response = await call('verifyTrainerHistory', { ownerUid: ids.ownerUid, shareVersion: 1, shareUpdatedAt: 100, declaredEntryCount: 1, publicSnapshot, requestId: 'request-emulator-history' });
  assert.equal(callableResult(response, 'verifyTrainerHistory').status, 'recorded');
});

test('setApprovedViewer grants and revokes only the caller-owned row', async () => {
  const ids = (await database.ref('_test').get()).val();
  const grant = await call('setApprovedViewer', { viewerUid: ids.viewerUid, action: 'grant', requestId: 'request-emulator-grant' });
  assert.equal(callableResult(grant, 'setApprovedViewer grant').status, 'granted');
  assert.equal((await database.ref(`shareAccess/${ids.callerUid}/${ids.viewerUid}`).get()).val(), true);
  const revoke = await call('setApprovedViewer', { viewerUid: ids.viewerUid, action: 'revoke', requestId: 'request-emulator-revoke' });
  assert.equal(callableResult(revoke, 'setApprovedViewer revoke').status, 'revoked');
  assert.equal((await database.ref(`shareAccess/${ids.callerUid}/${ids.viewerUid}`).get()).val(), null);
});

test('emulator mutations remain confined to reviewed roots', async () => {
  const root = (await database.ref().get()).val();
  const allowed = new Set(['shareVisibilityConfig', 'trainerPreferencesConfig', 'accounts', 'shareDirectory', 'shareVisibility', 'trainerShares', 'userPreferences', 'shareAccess', 'trustedOperationRequests', '_test']);
  assert.equal(Object.keys(root).every((key) => allowed.has(key)), true);
  assert.equal(root.authIndex, undefined);
  assert.equal(root.users, undefined);
});
