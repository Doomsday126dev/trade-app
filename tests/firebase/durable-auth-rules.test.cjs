'use strict';

const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFunctions = createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getDatabase } = requireFunctions('firebase-admin/database');
const { createE1DatabaseSessionFactory, encodeHandleKey, ROLES } = require('../../functions/src/domain/e1RuntimeAuthorization');
const { createFirebaseDurableAuthAdapter } = require('../../functions/src/adapters/firebaseDurableAuthAdapter');

const PROJECT_ID = 'demo-pogo-durable-auth';
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9800';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9899';
const DATABASE_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const IDS = {};
const TOKENS = {};
const NAMES = { ordinary: 'OrdinaryTrainer', other: 'OtherTrainer', admin: 'ProtectedAdmin' };
const ownerCredential = { async getAccessToken() { return { access_token: 'owner', expires_in: 3600 }; } };
const openSession = createE1DatabaseSessionFactory({
  initializeApp,
  getDatabase,
  deleteApp,
  credential: ownerCredential,
  target: { environment: 'emulator', projectId: PROJECT_ID, databaseURL: `http://${DATABASE_HOST}?ns=${DATABASE_NAMESPACE}` }
});
const adapter = createFirebaseDurableAuthAdapter({ openSession });

async function request(url, method = 'GET', body, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
}

function databaseUrl(target = '', token) {
  const clean = String(target).replace(/^\/+|\/+$/g, '');
  const url = new URL(`http://${DATABASE_HOST}/${clean ? `${clean}.json` : '.json'}`);
  url.searchParams.set('ns', DATABASE_NAMESPACE);
  if (token) url.searchParams.set('auth', token);
  return url;
}

function databaseRequest(method, target, body, actor, headers = {}) {
  const owner = actor === 'owner';
  return request(databaseUrl(target, owner ? undefined : actor), method, body, owner ? { authorization: 'Bearer owner', ...headers } : headers);
}

async function succeeds(promise, label) {
  const response = await promise;
  assert.ok(response.status >= 200 && response.status < 300, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

async function fails(promise, label) {
  const response = await promise;
  assert.ok(response.status === 401 || response.status === 403, `${label}: expected denial, got ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

async function adminSucceeds(promise, label) {
  try { return await promise; } catch (error) { assert.fail(`${label}: ${error.message}`); }
}

async function adminFails(promise, label) {
  await assert.rejects(promise, /permission[ _]denied/i, label);
}

async function createUser(key) {
  const result = await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, 'POST', {
    email: `${key}@example.test`, password: `${key}-durable-auth-password`, returnSecureToken: true,
    e1Role: 'handle-reservation', e1v: 1
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  IDS[key] = result.body.localId;
  TOKENS[key] = result.body.idToken;
  const payload = JSON.parse(Buffer.from(result.body.idToken.split('.')[1], 'base64url'));
  assert.equal(payload.e1Role, undefined, 'Auth sign-up must not accept caller-supplied trusted claims');
  assert.equal(payload.e1v, undefined, 'Auth sign-up must not accept caller-supplied contract versions');
}

function foundationInput(subjectUid, trainerName, normalizedTrainerName, handleKey, createdAt = 100, updatedAt = 100) {
  return { subjectUid, trainerName, normalizedTrainerName, handleKey, createdAt, updatedAt };
}

async function seed() {
  await succeeds(databaseRequest('PUT', '', {
    admins: { [IDS.admin]: true },
    authIndex: {
      [IDS.ordinary]: { username: NAMES.ordinary, lastSeen: 100 },
      [IDS.other]: { username: NAMES.other, lastSeen: 100 },
      [IDS.admin]: { username: NAMES.admin, lastSeen: 100 }
    },
    users: {
      [NAMES.ordinary]: { authUid: IDS.ordinary, authEmail: 'ordinary@example.test', authVersion: 1, isOwner: false, isAdmin: false },
      [NAMES.other]: { authUid: IDS.other, authEmail: 'other@example.test', authVersion: 1, isOwner: false, isAdmin: false },
      [NAMES.admin]: { authUid: IDS.admin, authEmail: 'admin@example.test', authVersion: 1, isOwner: true, isAdmin: true }
    },
    loginDirectory: {
      [NAMES.ordinary]: { authReady: true, authVersion: 1 },
      [NAMES.other]: { authReady: true, authVersion: 1 },
      [NAMES.admin]: { authReady: true, authVersion: 1 }
    },
    durableAuthConfig: {
      schemaVersion: 1,
      environment: 'emulator',
      clientFoundationEnabled: true,
      handleReservationEnabled: true,
      foundationRepairEnabled: true,
      updatedAt: 100
    },
    wishlist: { [NAMES.ordinary]: { Pikachu: 'H' } },
    publicShares: { [NAMES.ordinary]: { version: 1, username: NAMES.ordinary, profile: {}, lists: { wishlist: { Pikachu: 'H' } }, publishedListTypes: ['wishlist'], updatedAt: 100 } },
    userPreferences: { [IDS.ordinary]: { favoriteTrainers: {} } }
  }, 'owner'), 'seed isolated fixture');
}

before(async () => {
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = DATABASE_HOST;
  for (const key of ['ordinary', 'other', 'admin']) await createUser(key);
});

beforeEach(async () => { await seed(); });

after(async () => {
  await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, 'DELETE');
});

test('ordinary owner reads exact enabled foundation while non-owner and enumeration fail', async () => {
  const key = encodeHandleKey('ordinarytrainer');
  await adapter.reserveTrainerHandle(foundationInput(IDS.ordinary, NAMES.ordinary, 'ordinarytrainer', key));
  await succeeds(databaseRequest('GET', `accounts/${IDS.ordinary}`, undefined, TOKENS.ordinary), 'owner exact account read');
  await fails(databaseRequest('GET', `accounts/${IDS.ordinary}`, undefined, TOKENS.other), 'non-owner account read');
  await fails(databaseRequest('GET', 'accounts', undefined, TOKENS.ordinary), 'account enumeration');
  await succeeds(databaseRequest('PUT', 'durableAuthConfig/clientFoundationEnabled', false, 'owner'), 'disable client foundation read');
  await fails(databaseRequest('GET', `accounts/${IDS.ordinary}`, undefined, TOKENS.ordinary), 'disabled owner account read');
  await succeeds(databaseRequest('PUT', 'durableAuthConfig/clientFoundationEnabled', true, 'owner'), 'restore client foundation read');
});

test('ordinary clients cannot directly write account handle or migration paths', async () => {
  const key = encodeHandleKey('ordinarytrainer');
  for (const [target, body] of [
    [`accounts/${IDS.ordinary}`, foundationInput(IDS.ordinary, NAMES.ordinary, 'ordinarytrainer', key)],
    [`trainerHandles/${key}`, { uid: IDS.ordinary }],
    [`identityMigrations/${IDS.ordinary}/operations/browser-operation-0001`, { status: 'complete' }]
  ]) await fails(databaseRequest('PUT', target, body, TOKENS.ordinary), `ordinary write ${target}`);
});

test('protected Admin receives intended exact reads but no parent enumeration or migration writes', async () => {
  await succeeds(databaseRequest('GET', `accounts/${IDS.ordinary}`, undefined, TOKENS.admin), 'Admin exact account read');
  await fails(databaseRequest('GET', 'accounts', undefined, TOKENS.admin), 'Admin account enumeration');
  await fails(databaseRequest('GET', 'identityMigrations', undefined, TOKENS.admin), 'Admin migration enumeration');
  await fails(databaseRequest('PUT', `identityMigrations/${IDS.ordinary}/operations/admin-operation-0001`, { status: 'complete' }, TOKENS.admin), 'Admin migration write');
});

test('Admin SDK auth override is enforced by Rules for exact reservation paths', async () => {
  const otherKey = encodeHandleKey('othertrainer');
  assert.deepEqual(await adapter.reserveTrainerHandle(foundationInput(IDS.other, NAMES.other, 'othertrainer', otherKey)), { status: 'reserved' });
  const account = (await succeeds(databaseRequest('GET', `accounts/${IDS.other}`, undefined, TOKENS.other), 'reserved account')).body;
  assert.equal(account.handleKey, otherKey);
  const session = await openSession({ role: ROLES.HANDLE_RESERVATION, subjectUid: IDS.other, handleKey: otherKey });
  try {
    await adminFails(session.database.ref(`accounts/${IDS.ordinary}`).set(account), 'bound runtime cannot write another UID');
    await adminFails(session.database.ref(`trainerHandles/${encodeHandleKey('differenttrainer')}`).set({ uid: IDS.other }), 'bound runtime cannot write another handle');
    await adminFails(session.database.ref('accounts').get(), 'runtime cannot enumerate accounts');
    await adminFails(session.database.ref('trainerHandles').get(), 'runtime cannot enumerate handles');
    await adminFails(session.database.ref(`wishlist/${NAMES.other}`).set({ Eevee: 'H' }), 'runtime cannot write username lists');
    await adminFails(session.database.ref(`publicShares/${NAMES.other}`).set({ version: 1 }), 'runtime cannot write public shares');
    await adminFails(session.database.ref(`userPreferences/${IDS.other}`).set({ favoriteTrainers: {} }), 'runtime cannot write preferences');
  } finally { await session.close(); }
});

test('repair persona is operation-bound and cannot be substituted by reservation persona', async () => {
  const handleKey = encodeHandleKey('othertrainer');
  const operationId = 'repair-operation-000001';
  await adapter.repairAccountFoundation({ ...foundationInput(IDS.other, NAMES.other, 'othertrainer', handleKey, 100, 200), operationId });
  const migration = await succeeds(databaseRequest('GET', `identityMigrations/${IDS.other}/operations/${operationId}`, undefined, TOKENS.admin), 'Admin exact migration read');
  assert.equal(migration.body.status, 'complete');
  const reservation = await openSession({ role: ROLES.HANDLE_RESERVATION, subjectUid: IDS.other, handleKey });
  try {
    await adminFails(reservation.database.ref(`identityMigrations/${IDS.other}/operations/${operationId}`).set(migration.body), 'reservation persona cannot repair');
  } finally { await reservation.close(); }
  const repair = await openSession({ role: ROLES.FOUNDATION_REPAIR, subjectUid: IDS.other, handleKey, operationId });
  try {
    await adminFails(repair.database.ref(`identityMigrations/${IDS.other}/operations/repair-operation-OTHER`).set(migration.body), 'repair persona cannot write another operation');
    await adminFails(repair.database.ref(`accounts/${IDS.ordinary}`).set({
      schemaVersion: 1, trainerName: NAMES.other, normalizedTrainerName: 'othertrainer', handleKey,
      status: 'active', createdAt: 100, updatedAt: 200
    }), 'repair persona cannot write another UID');
    await adminFails(repair.database.ref(`trainerHandles/${encodeHandleKey('wrongrepairhandle')}`).set({
      schemaVersion: 1, uid: IDS.other, trainerName: NAMES.other, normalizedTrainerName: 'othertrainer',
      status: 'active', claimedAt: 100, updatedAt: 200
    }), 'repair persona cannot write another handle');
    await adminFails(repair.database.ref(`publicShares/${NAMES.other}`).set({ version: 1 }), 'repair persona cannot write unrelated roots');
  } finally { await repair.close(); }
});

test('atomic multi-location collision denial leaves neither side partially written', async () => {
  const collisionKey = encodeHandleKey('collisiontrainer');
  await adapter.reserveTrainerHandle(foundationInput(IDS.ordinary, NAMES.ordinary, 'collisiontrainer', collisionKey));
  await assert.rejects(adapter.reserveTrainerHandle(foundationInput(IDS.other, NAMES.other, 'collisiontrainer', collisionKey)), /foundation-conflict|PERMISSION_DENIED/i);
  const otherAccount = await succeeds(databaseRequest('GET', `accounts/${IDS.other}`, undefined, TOKENS.other), 'other exact account after collision');
  assert.notEqual(otherAccount.body?.handleKey, collisionKey);
  const handle = await succeeds(databaseRequest('GET', `trainerHandles/${collisionKey}`, undefined, TOKENS.admin), 'collision handle');
  assert.equal(handle.body.uid, IDS.ordinary);
});

test('configuration reader is read-only and cannot enumerate or access identity roots', async () => {
  const session = await openSession({ role: ROLES.CONFIG_READ });
  try {
    const config = await adminSucceeds(session.database.ref('durableAuthConfig').get(), 'config reader exact read');
    assert.equal(config.val().environment, 'emulator');
    await adminFails(session.database.ref('durableAuthConfig/clientFoundationEnabled').set(false), 'config reader write');
    await adminFails(session.database.ref('accounts').get(), 'config reader account enumeration');
    await adminFails(session.database.ref(`accounts/${IDS.ordinary}`).get(), 'config reader account read');
  } finally { await session.close(); }
});

test('ordinary browser token and forged override header cannot synthesize runtime authority', async () => {
  const key = encodeHandleKey('forgedtrainer');
  const forged = Buffer.from(JSON.stringify({ uid: 'e1-runtime-handle-reservation', token: { e1v: 1, e1Role: 'handle-reservation', e1Environment: 'emulator', e1SubjectUid: IDS.ordinary, e1HandleKey: key } })).toString('base64');
  await fails(databaseRequest('PUT', `accounts/${IDS.ordinary}`, {
    schemaVersion: 1, trainerName: 'ForgedTrainer', normalizedTrainerName: 'forgedtrainer', handleKey: key,
    status: 'active', createdAt: 100, updatedAt: 100
  }, TOKENS.ordinary, { 'x-firebase-auth-variable-override': forged }), 'forged browser override');
});
