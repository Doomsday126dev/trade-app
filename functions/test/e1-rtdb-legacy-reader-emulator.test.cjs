'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVerifiedLegacyMappingReader } = require('../e1-authority-service/rtdbVerifiedLegacyMappingReader');

const PROJECT = 'demo-pogo-narrow-read';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9300';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9399';
const NAMESPACE = `${PROJECT}-default-rtdb`;
const identities = {};

async function request(url, method = 'GET', value, headers = {}) {
  const response = await fetch(url, { method, headers: { ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: response.status, body: await response.text() };
}

async function createUser(name) {
  const response = await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, 'POST', {
    email: `${name}@example.test`, password: `${name}-password-123`, returnSecureToken: true
  });
  assert.equal(response.status, 200, response.body);
  identities[name] = JSON.parse(response.body);
}

function dbUrl(path = '', token, query = {}) {
  const clean = path.replace(/^\/+|\/+$/gu, '');
  const url = new URL(`http://${DB_HOST}/${clean ? `${clean}.json` : '.json'}`);
  url.searchParams.set('ns', NAMESPACE);
  if (token) url.searchParams.set('auth', token);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

test.before(async () => {
  await createUser('owner');
  await createUser('other');
  const owner = identities.owner;
  const other = identities.other;
  const seeded = await request(dbUrl(), 'PUT', {
    loginDirectory: {
      TrainerOne: { authReady: true, authVersion: 3 },
      OtherTrainer: { authReady: true, authVersion: 1 },
      UnreadyTrainer: { authReady: false, authVersion: 1 }
    },
    users: {
      TrainerOne: { authUid: owner.localId },
      OtherTrainer: { authUid: other.localId },
      MismatchTrainer: { authUid: other.localId },
      UnreadyTrainer: { authUid: owner.localId }
    },
    authIndex: {
      [owner.localId]: { username: 'TrainerOne' },
      [other.localId]: { username: 'OtherTrainer' }
    }
  }, { authorization: 'Bearer owner' });
  assert.equal(seeded.status, 200, seeded.body);
});

test.after(async () => {
  await request(dbUrl(), 'PUT', null, { authorization: 'Bearer owner' });
  await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, 'DELETE');
});

test('rollback Rules permit the exact reciprocal user-token mapping reads', async () => {
  const observed = [];
  const reader = createVerifiedLegacyMappingReader({
    environment: 'emulator', projectId: PROJECT, databaseUrl: `http://${DB_HOST}?ns=${NAMESPACE}`,
    async fetchImpl(url, options) { observed.push({ method: options.method, path: url.pathname }); return fetch(url, options); }
  });
  assert.deepEqual(await reader.readVerifiedLegacyMapping({ verifiedUid: identities.owner.localId, firebaseIdToken: identities.owner.idToken }), {
    status: 'ready', username: 'TrainerOne', legacyAuthVersion: 3
  });
  assert.equal(observed.length, 3);
  assert.ok(observed.every((entry) => entry.method === 'GET'));
  assert.deepEqual(observed.map((entry) => entry.path), [
    `/authIndex/${identities.owner.localId}/username.json`,
    '/users/TrainerOne/authUid.json',
    '/loginDirectory/TrainerOne.json'
  ]);
});

test('rollback Rules deny foreign ownership and private parent or query enumeration', async () => {
  const token = identities.owner.idToken;
  for (const [path, query] of [
    [`authIndex/${identities.other.localId}/username`, {}],
    ['users/OtherTrainer/authUid', {}],
    ['authIndex', {}],
    ['users', {}],
    ['authIndex', { orderBy: '"$key"', limitToFirst: '1' }],
    ['users', { orderBy: '"$key"', limitToFirst: '1' }]
  ]) {
    const response = await request(dbUrl(path, token, query));
    assert.ok([401, 403].includes(response.status), `${path}: ${response.status}`);
  }
});

test('rollback Rules retain the pre-existing public loginDirectory parent exception', async () => {
  const parent = await request(dbUrl('loginDirectory', identities.owner.idToken));
  const query = await request(dbUrl('loginDirectory', identities.owner.idToken, { orderBy: '"$key"', limitToFirst: '1' }));
  assert.equal(parent.status, 200);
  assert.equal(query.status, 200);
});
