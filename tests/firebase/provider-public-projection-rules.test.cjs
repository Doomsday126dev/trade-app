'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ID = process.env.POGO_RULES_PROJECT_ID || 'demo-pogo-provider-public';
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9210';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9309';
const DATABASE_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const IDS = {};
const TOKENS = {};

async function request(url, method = 'GET', value, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  return { status: response.status, body: await response.text() };
}

async function createUser(name) {
  const response = await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    'POST', { email: `${name}@example.test`, password: `${name}-password-123`, returnSecureToken: true });
  assert.equal(response.status, 200, response.body);
  const body = JSON.parse(response.body);
  IDS[name] = body.localId;
  TOKENS[name] = body.idToken;
}

function dbUrl(target = '', token) {
  const clean = String(target).replace(/^\/+|\/+$/gu, '');
  const url = new URL(`http://${DATABASE_HOST}/${clean ? `${clean}.json` : '.json'}`);
  url.searchParams.set('ns', DATABASE_NAMESPACE);
  if (token) url.searchParams.set('auth', token);
  return url;
}

function db(method, target, value, actor) {
  const owner = actor === 'emulator-owner';
  return request(dbUrl(target, owner ? undefined : actor), method, value,
    owner ? { authorization: 'Bearer owner' } : {});
}

async function succeeds(promise, label) {
  const response = await promise;
  assert.ok(response.status >= 200 && response.status < 300, `${label}: ${response.status} ${response.body}`);
  return response;
}

async function fails(promise, label) {
  const response = await promise;
  assert.ok(response.status === 401 || response.status === 403,
    `${label}: expected denial, got ${response.status} ${response.body}`);
}

function projection(overrides = {}) {
  return {
    schemaVersion: 1,
    shareVersion: 1,
    trainerName: 'ProviderTrainer',
    profile: { friendCode: '', bio: '', discord: '', avatarPokemon: 'Pikachu', lastUpdated: 100 },
    lists: { wishlist: { Pikachu: { p: 'H', shiny: true } }, dynamax: {}, gmax: {}, costumes: {} },
    publishedListTypes: { wishlist: true, dynamax: true, gmax: true, costumes: true },
    publishedAt: 100,
    updatedAt: 100,
    ...overrides
  };
}

async function clear() {
  await succeeds(db('PUT', '', null, 'emulator-owner'), 'clear fixture');
}

before(async () => {
  for (const name of ['owner', 'other']) await createUser(name);
});
beforeEach(clear);
after(async () => {
  await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, 'DELETE');
});

test('anonymous reads only one exact UID projection while root and parent enumeration stay denied', async () => {
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, projection(), 'emulator-owner'), 'seed public projection');
  const exact = await succeeds(db('GET', `trainerShares/${IDS.owner}`, undefined), 'anonymous exact projection');
  assert.equal(JSON.parse(exact.body).trainerName, 'ProviderTrainer');
  await fails(db('GET', 'trainerShares', undefined), 'anonymous parent enumeration');
  await fails(db('GET', '', undefined), 'anonymous root enumeration');
  const query = dbUrl('trainerShares');
  query.searchParams.set('orderBy', '"$key"');
  query.searchParams.set('limitToFirst', '1');
  await fails(request(query), 'anonymous queried parent enumeration');
});

test('authenticated owner writes only its exact UID projection and another UID cannot overwrite it', async () => {
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, projection(), TOKENS.owner), 'owner creates projection');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection(), TOKENS.other), 'other overwrites owner projection');
  await fails(db('PUT', `trainerShares/${IDS.other}`, projection(), TOKENS.owner), 'owner writes another UID projection');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection(), undefined), 'anonymous projection write');
});

test('provider-only owner cannot fabricate legacy identity mappings or canonical Firestore identity in RTDB', async () => {
  await fails(db('PUT', `authIndex/${IDS.owner}`, { username: 'ProviderTrainer' }, TOKENS.owner), 'provider authIndex write');
  await fails(db('PUT', 'loginDirectory/ProviderTrainer', { authReady: true, authVersion: 1 }, TOKENS.owner),
    'provider loginDirectory write');
  await fails(db('PUT', 'users/ProviderTrainer', { authUid: IDS.owner, isOwner: false, isAdmin: false }, TOKENS.owner),
    'provider users write');
  await fails(db('PUT', `accounts/${IDS.owner}`, { trainerName: 'ProviderTrainer' }, TOKENS.owner),
    'RTDB canonical identity shadow write');
});

test('projection schema rejects private fields incomplete markers malformed entries and oversized keys', async () => {
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({ ownerUid: IDS.owner }), TOKENS.owner), 'private owner UID');
  const incomplete = projection();
  delete incomplete.publishedListTypes;
  await fails(db('PUT', `trainerShares/${IDS.owner}`, incomplete, TOKENS.owner), 'missing completeness marker');
  const privateProfile = projection();
  privateProfile.profile.email = 'private@example.test';
  await fails(db('PUT', `trainerShares/${IDS.owner}`, privateProfile, TOKENS.owner), 'private profile field');
  const invalidEntry = projection();
  invalidEntry.lists.wishlist.Pikachu = { p: 'X' };
  await fails(db('PUT', `trainerShares/${IDS.owner}`, invalidEntry, TOKENS.owner), 'invalid entry priority');
  const oversizedKey = projection({ lists: { wishlist: { ['x'.repeat(201)]: { p: 'H' } }, dynamax: {}, gmax: {}, costumes: {} } });
  await fails(db('PUT', `trainerShares/${IDS.owner}`, oversizedKey, TOKENS.owner), 'oversized Pokemon key');
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const dangerous = projection({
      lists: JSON.parse(`{"wishlist":{"${key}":{"p":"H"}},"dynamax":{},"gmax":{},"costumes":{}}`)
    });
    await fails(db('PUT', `trainerShares/${IDS.owner}`, dangerous, TOKENS.owner), `dangerous Pokemon key ${key}`);
  }
  const invalidBackground = projection({
    lists: { wishlist: { Pikachu: { p: 'H', backgroundId: 'Chicago 2026' } }, dynamax: {}, gmax: {}, costumes: {} }
  });
  await fails(db('PUT', `trainerShares/${IDS.owner}`, invalidBackground, TOKENS.owner), 'invalid background ID');
});

test('profile fields enforce the exact canonical text limits without truncation', async () => {
  const profile = { friendCode: '1'.repeat(14), bio: '', discord: '', avatarPokemon: 'a'.repeat(120), lastUpdated: 100 };
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, projection({ profile }), TOKENS.owner),
    'canonical profile boundary');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({
    shareVersion: 2, updatedAt: 101, profile: { ...profile, friendCode: '1'.repeat(15) }
  }), TOKENS.owner), 'overlong canonical friend code');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({
    shareVersion: 2, updatedAt: 101, profile: { ...profile, avatarPokemon: 'a'.repeat(121) }
  }), TOKENS.owner), 'overlong canonical avatar');
});

test('updates are monotonic and cannot change canonical trainer name or initial publication time', async () => {
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, projection(), TOKENS.owner), 'initial projection');
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, projection({ shareVersion: 2, updatedAt: 101 }), TOKENS.owner),
    'next projection');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({ shareVersion: 4, updatedAt: 102 }), TOKENS.owner),
    'skipped version');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({ shareVersion: 3, updatedAt: 102, trainerName: 'OtherTrainer' }),
    TOKENS.owner), 'changed trainer name');
  await fails(db('PUT', `trainerShares/${IDS.owner}`, projection({ shareVersion: 3, updatedAt: 102, publishedAt: 99 }),
    TOKENS.owner), 'changed publication time');
});

test('complete empty provider account projection is accepted after RTDB strips empty list objects', async () => {
  const empty = projection({ lists: { wishlist: {}, dynamax: {}, gmax: {}, costumes: {} } });
  await succeeds(db('PUT', `trainerShares/${IDS.owner}`, empty, TOKENS.owner), 'empty projection');
  const result = await succeeds(db('GET', `trainerShares/${IDS.owner}`, undefined), 'anonymous empty projection');
  const stored = JSON.parse(result.body);
  assert.equal(Object.hasOwn(stored, 'lists'), false);
  assert.deepEqual(stored.publishedListTypes, { wishlist: true, dynamax: true, gmax: true, costumes: true });
});

test('legacy exact public share remains readable while its parent remains non-enumerable', async () => {
  await succeeds(db('PUT', 'publicShares/LegacyTrainer', { username: 'LegacyTrainer' }, 'emulator-owner'),
    'seed legacy share');
  await succeeds(db('GET', 'publicShares/LegacyTrainer', undefined), 'legacy exact URL');
  await fails(db('GET', 'publicShares', undefined), 'legacy share parent');
});
