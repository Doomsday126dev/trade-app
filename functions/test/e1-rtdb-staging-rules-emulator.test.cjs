'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT = 'demo-e1-rtdb-staging';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9400';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9499';
const NAMESPACE = `${PROJECT}-default-rtdb`;
const identities = {};

async function request(url, method = 'GET', value, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
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

function denied(response, label) {
  assert.ok([401, 403].includes(response.status), `${label}: ${response.status} ${response.body}`);
}

test.before(async () => {
  await createUser('owner');
  await createUser('other');
  const owner = identities.owner;
  const other = identities.other;
  const seeded = await request(dbUrl(), 'PUT', {
    authIndex: {
      [owner.localId]: { username: 'TrainerOne' },
      [other.localId]: { username: 'OtherTrainer' }
    },
    users: {
      TrainerOne: { authUid: owner.localId, privateField: 'not-readable-through-approved-paths' },
      OtherTrainer: { authUid: other.localId }
    },
    loginDirectory: {
      TrainerOne: { authReady: true, authVersion: 1 },
      OtherTrainer: { authReady: true, authVersion: 1 }
    }
  }, { authorization: 'Bearer owner' });
  assert.equal(seeded.status, 200, seeded.body);
});

test.after(async () => {
  await request(dbUrl(), 'PUT', null, { authorization: 'Bearer owner' });
  await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, 'DELETE');
});

test('owner token reads only the three approved exact paths', async () => {
  const owner = identities.owner;
  for (const [path, expected] of [
    [`authIndex/${owner.localId}/username`, 'TrainerOne'],
    ['users/TrainerOne/authUid', owner.localId],
    ['loginDirectory/TrainerOne', { authReady: true, authVersion: 1 }]
  ]) {
    const response = await request(dbUrl(path, owner.idToken));
    assert.equal(response.status, 200, `${path}: ${response.body}`);
    assert.deepEqual(JSON.parse(response.body), expected);
  }
});

test('foreign exact reads and every parent or query enumeration are denied', async () => {
  const owner = identities.owner;
  const other = identities.other;
  for (const [path, query] of [
    [`authIndex/${other.localId}/username`, {}],
    ['users/OtherTrainer/authUid', {}],
    ['loginDirectory/OtherTrainer', {}],
    ['authIndex', {}],
    ['users', {}],
    ['loginDirectory', {}],
    ['authIndex', { orderBy: '"$key"', limitToFirst: '1' }],
    ['users', { orderBy: '"$key"', limitToFirst: '1' }],
    ['loginDirectory', { orderBy: '"$key"', limitToFirst: '1' }]
  ]) denied(await request(dbUrl(path, owner.idToken, query)), path);
});

test('anonymous exact reads and every authenticated write shape are denied', async () => {
  const owner = identities.owner;
  for (const path of [
    `authIndex/${owner.localId}/username`,
    'users/TrainerOne/authUid',
    'loginDirectory/TrainerOne'
  ]) denied(await request(dbUrl(path)), `anonymous ${path}`);

  for (const [method, path, value] of [
    ['PUT', `authIndex/${owner.localId}/username`, 'ChangedTrainer'],
    ['PATCH', 'users/TrainerOne', { authUid: owner.localId }],
    ['POST', 'loginDirectory', { authReady: true }],
    ['DELETE', 'loginDirectory/TrainerOne', undefined]
  ]) denied(await request(dbUrl(path, owner.idToken), method, value), `${method} ${path}`);
});
