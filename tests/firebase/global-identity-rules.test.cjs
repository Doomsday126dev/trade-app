const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const PROJECT_ID = 'demo-pogo-global-identity';
const DATABASE_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9100';
const RULES_PATH = path.join(__dirname, 'database.rules.global-identity.json');
const HARDENED_RULES_PATH = path.join(__dirname, 'database.rules.hardened.json');

const IDS = {};
const TOKENS = {};
const USERS = Object.freeze({
  ordinary: 'OrdinaryTrainer',
  other: 'OtherTrainer',
  admin: 'ProtectedAdmin'
});

const NEW_RULE_PATHS = Object.freeze([
  'globalIdentityConfig',
  'accounts',
  'trainerHandles',
  'privateProfiles',
  'publicProfiles',
  'publicLists',
  'unlistedShareOwners',
  'unlistedShares',
  'legacyUsernameIndex'
]);

async function jsonRequest(url, method = 'GET', value, extraHeaders = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(value === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders
    },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, body };
}

async function createAuthUser(key, username) {
  const result = await jsonRequest(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    'POST',
    {
      email: `${username.toLowerCase()}@example.test`,
      password: `global-identity-${key}-password`,
      returnSecureToken: true
    }
  );
  assert.equal(result.status, 200, `Auth emulator should create ${key}: ${JSON.stringify(result.body)}`);
  IDS[key] = result.body.localId;
  TOKENS[key] = result.body.idToken;
}

function databaseUrl(target = '', token) {
  const cleanTarget = String(target).replace(/^\/+|\/+$/g, '');
  const url = new URL(`http://${DATABASE_HOST}/${cleanTarget ? `${cleanTarget}.json` : '.json'}`);
  url.searchParams.set('ns', DATABASE_NAMESPACE);
  if (token) url.searchParams.set('auth', token);
  return url;
}

function databaseRequest(method, target, value, actor) {
  const isOwnerRequest = actor === 'owner';
  return jsonRequest(
    databaseUrl(target, isOwnerRequest ? undefined : actor),
    method,
    value,
    isOwnerRequest ? { authorization: 'Bearer owner' } : undefined
  );
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function verifiedToken(uid) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      auth_time: nowSeconds,
      user_id: uid,
      sub: uid,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      email: `${uid}@example.test`,
      email_verified: true,
      firebase: { identities: {}, sign_in_provider: 'password' }
    }),
    ''
  ].join('.');
}

async function assertSucceeds(resultPromise, message) {
  const result = await resultPromise;
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${message}; expected success, received ${result.status}: ${JSON.stringify(result.body)}`
  );
  return result;
}

async function assertFails(resultPromise, message) {
  const result = await resultPromise;
  assert.ok(
    result.status === 401 || result.status === 403,
    `${message}; expected permission denial, received ${result.status}: ${JSON.stringify(result.body)}`
  );
  return result;
}

function collectJavaScriptFiles(root) {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name);
    if (statSync(target).isDirectory()) return collectJavaScriptFiles(target);
    return target.endsWith('.js') ? [target] : [];
  });
}

function accountRecord(uid, trainerName, normalizedTrainerName) {
  return {
    trainerName,
    normalizedTrainerName,
    status: 'setup',
    createdAt: 100,
    updatedAt: 100
  };
}

function privateProfile(visibility = 'private') {
  return {
    setupComplete: false,
    visibility,
    bio: 'Private setup note',
    contacts: {
      friendCode: { value: '0000 0000 0000', visibility: 'private' },
      discord: { value: 'ordinary', visibility: 'public' },
      contactEmail: { value: 'private@example.test', visibility: 'private' }
    },
    updatedAt: 100
  };
}

async function seedFixture() {
  await assertSucceeds(
    databaseRequest('PUT', '', {
      admins: { [IDS.admin]: true },
      accounts: {
        [IDS.ordinary]: accountRecord(IDS.ordinary, USERS.ordinary, 'ordinarytrainer')
      },
      trainerHandles: {
        ordinarytrainer: {
          uid: IDS.ordinary,
          trainerName: USERS.ordinary,
          state: 'active',
          claimedAt: 100,
          updatedAt: 100
        }
      },
      privateProfiles: {
        [IDS.ordinary]: privateProfile('private')
      },
      publicProfiles: {
        [IDS.ordinary]: {
          trainerName: USERS.ordinary,
          visibility: 'public',
          bio: 'Published profile',
          publishedAt: 100,
          updatedAt: 100
        }
      },
      publicLists: {
        [IDS.ordinary]: {
          wishlist: { pikachu: { name: 'Pikachu', priority: 'H' } },
          forTrade: { eevee: { name: 'Eevee' } },
          updatedAt: 100
        }
      },
      unlistedShareOwners: {
        'share-valid': IDS.ordinary
      },
      unlistedShares: {
        'share-valid': {
          trainerName: USERS.ordinary,
          active: true,
          profile: { bio: 'Unlisted profile' },
          lists: { wishlist: { pikachu: { name: 'Pikachu', priority: 'H' } } },
          createdAt: 100,
          updatedAt: 100
        }
      },
      legacyUsernameIndex: {
        [USERS.ordinary]: IDS.ordinary
      }
    }, 'owner'),
    'Owner token should seed the isolated candidate fixture'
  );
}

before(async () => {
  const hardened = JSON.parse(readFileSync(HARDENED_RULES_PATH, 'utf8'));
  const candidate = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  for (const key of NEW_RULE_PATHS) delete candidate.rules[key];
  assert.deepEqual(candidate, hardened, 'Candidate must preserve every existing hardened rule exactly');

  const clientFiles = [path.join(__dirname, '..', '..', 'index.html'), ...collectJavaScriptFiles(path.join(__dirname, '..', '..', 'js'))];
  const clientSource = clientFiles.map(file => readFileSync(file, 'utf8')).join('\n');
  for (const key of NEW_RULE_PATHS) {
    const quotedPath = new RegExp(`[\\\"'\\\`]${key}(?:/|[\\\"'\\\`])`);
    assert.equal(quotedPath.test(clientSource), false, `Production client must not reference inactive path ${key}`);
  }

  await createAuthUser('ordinary', USERS.ordinary);
  await createAuthUser('other', USERS.other);
  await createAuthUser('admin', USERS.admin);
});

beforeEach(async () => {
  await assertSucceeds(databaseRequest('PUT', '', null, 'owner'), 'Owner token should clear the emulator database');
  await seedFixture();
});

after(async () => {
  await jsonRequest(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, 'DELETE');
});

test('candidate preserves current rules and production client has no new-path references', () => {
  assert.ok(true);
});

test('anonymous visitors can read exact published records but cannot enumerate or read private identity data', async () => {
  await assertSucceeds(databaseRequest('GET', `publicProfiles/${IDS.ordinary}`), 'Anonymous exact public profile read');
  await assertSucceeds(databaseRequest('GET', `publicLists/${IDS.ordinary}`), 'Anonymous exact public list read');
  await assertSucceeds(databaseRequest('GET', 'unlistedShares/share-valid'), 'Anonymous active unlisted share read');
  for (const target of [
    'publicProfiles',
    'publicLists',
    'unlistedShares',
    `accounts/${IDS.ordinary}`,
    'trainerHandles/ordinarytrainer',
    `privateProfiles/${IDS.ordinary}`,
    'unlistedShareOwners/share-valid',
    `legacyUsernameIndex/${USERS.ordinary}`
  ]) {
    await assertFails(databaseRequest('GET', target), `Anonymous read should fail at ${target}`);
  }
});

test('[transitional exposure] authenticated root read still exposes proposed private paths', async () => {
  for (const target of [
    `accounts/${IDS.ordinary}`,
    'trainerHandles/ordinarytrainer',
    `privateProfiles/${IDS.ordinary}`,
    'unlistedShareOwners/share-valid',
    `legacyUsernameIndex/${USERS.ordinary}`
  ]) {
    await assertSucceeds(
      databaseRequest('GET', target, undefined, TOKENS.other),
      `Authenticated root read currently exposes ${target}`
    );
  }
});

test('all inactive global identity data writes are denied while writesEnabled is missing or false', async () => {
  const attempts = [
    ['accounts/new', { trainerName: 'New', normalizedTrainerName: 'new', status: 'setup', createdAt: 1, updatedAt: 1 }],
    ['trainerHandles/new', { uid: IDS.admin, trainerName: 'New', state: 'active', claimedAt: 1, updatedAt: 1 }],
    [`privateProfiles/${IDS.admin}`, { setupComplete: false, visibility: 'private', updatedAt: 1 }],
    [`publicProfiles/${IDS.admin}`, { trainerName: 'New', visibility: 'public', publishedAt: 1, updatedAt: 1 }],
    [`publicLists/${IDS.admin}`, { updatedAt: 1 }],
    ['unlistedShareOwners/new-share', IDS.admin],
    ['unlistedShares/new-share', { trainerName: 'New', active: true, createdAt: 1, updatedAt: 1 }],
    ['legacyUsernameIndex/New', IDS.admin]
  ];
  for (const [target, value] of attempts) {
    await assertFails(databaseRequest('PUT', target, value, TOKENS.admin), `Missing flag must deny ${target}`);
  }

  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', false, TOKENS.admin), 'Admin may explicitly keep writes disabled');
  await assertFails(
    databaseRequest('PATCH', `accounts/${IDS.ordinary}`, { updatedAt: 101 }, TOKENS.admin),
    'Explicit false flag must deny candidate data writes'
  );
});

test('verified users can reserve one unique handle but cannot overwrite, reassign, or delete it', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Admin enables candidate in emulator only');
  await assertFails(
    databaseRequest('PUT', 'trainerHandles/othertrainer', {
      uid: IDS.other, trainerName: USERS.other, state: 'active', claimedAt: 200, updatedAt: 200
    }, TOKENS.other),
    'Unverified user handle claim'
  );
  await assertSucceeds(
    databaseRequest('PUT', 'trainerHandles/othertrainer', {
      uid: IDS.other, trainerName: USERS.other, state: 'active', claimedAt: 200, updatedAt: 200
    }, verifiedToken(IDS.other)),
    'Verified user handle claim'
  );
  await assertFails(
    databaseRequest('PUT', 'trainerHandles/othertrainer', {
      uid: IDS.ordinary, trainerName: USERS.ordinary, state: 'active', claimedAt: 200, updatedAt: 201
    }, verifiedToken(IDS.ordinary)),
    'Established handle reassignment'
  );
  await assertFails(databaseRequest('DELETE', 'trainerHandles/othertrainer', undefined, verifiedToken(IDS.other)), 'Owner handle deletion');
});

test('accounts and private profiles are UID-owned with immutable handle identity and admin-managed status', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Enable candidate');
  await assertSucceeds(
    databaseRequest('PUT', 'trainerHandles/othertrainer', {
      uid: IDS.other, trainerName: USERS.other, state: 'active', claimedAt: 200, updatedAt: 200
    }, verifiedToken(IDS.other)),
    'Reserve other handle'
  );
  await assertSucceeds(
    databaseRequest('PUT', `accounts/${IDS.other}`, accountRecord(IDS.other, USERS.other, 'othertrainer'), TOKENS.other),
    'UID owner account setup'
  );
  await assertFails(
    databaseRequest('PATCH', `accounts/${IDS.other}`, { normalizedTrainerName: 'stolen', updatedAt: 201 }, TOKENS.other),
    'Self-service normalized handle change'
  );
  await assertFails(
    databaseRequest('PATCH', `accounts/${IDS.other}`, { status: 'active', updatedAt: 201 }, TOKENS.other),
    'Self-service status elevation'
  );
  await assertSucceeds(
    databaseRequest('PUT', `privateProfiles/${IDS.other}`, privateProfile('private'), TOKENS.other),
    'UID owner private profile setup'
  );
  await assertFails(
    databaseRequest('PATCH', `privateProfiles/${IDS.other}`, { bio: 'foreign edit' }, TOKENS.ordinary),
    'Foreign private profile write'
  );
});

test('public projections require verified publishing and reject private contact or forbidden account fields', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Enable candidate');
  await assertSucceeds(
    databaseRequest('PATCH', `privateProfiles/${IDS.ordinary}`, { visibility: 'public', setupComplete: true, updatedAt: 200 }, TOKENS.ordinary),
    'Owner makes private profile publishable'
  );
  const allowed = {
    trainerName: USERS.ordinary,
    visibility: 'public',
    bio: 'Published profile',
    contacts: { discord: 'ordinary' },
    publishedAt: 100,
    updatedAt: 200
  };
  await assertFails(databaseRequest('PUT', `publicProfiles/${IDS.ordinary}`, allowed, TOKENS.ordinary), 'Unverified public profile write');
  await assertSucceeds(databaseRequest('PUT', `publicProfiles/${IDS.ordinary}`, allowed, verifiedToken(IDS.ordinary)), 'Verified public profile projection');
  await assertFails(
    databaseRequest('PATCH', `publicProfiles/${IDS.ordinary}`, { contacts: { contactEmail: 'private@example.test' }, updatedAt: 201 }, verifiedToken(IDS.ordinary)),
    'Private contact projection'
  );
  await assertFails(
    databaseRequest('PATCH', `publicProfiles/${IDS.ordinary}`, { authEmail: 'secret@example.test', updatedAt: 201 }, verifiedToken(IDS.ordinary)),
    'Authentication email projection'
  );
});

test('public list projections allow published variants and notes but reject quantities and raw private records', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Enable candidate');
  await assertSucceeds(
    databaseRequest('PATCH', `privateProfiles/${IDS.ordinary}`, { visibility: 'public', setupComplete: true, updatedAt: 200 }, TOKENS.ordinary),
    'Owner makes list publishable'
  );
  await assertSucceeds(
    databaseRequest('PUT', `publicLists/${IDS.ordinary}`, {
      wishlist: { pikachu: { name: 'Pikachu', priority: 'H', shiny: true, note: 'Costume preferred' } },
      forTrade: { eevee: { name: 'Eevee', xxl: true, note: 'Any form' } },
      updatedAt: 200
    }, verifiedToken(IDS.ordinary)),
    'Allowlisted public list projection'
  );
  await assertFails(
    databaseRequest('PATCH', `publicLists/${IDS.ordinary}/forTrade/eevee`, { qty: 12 }, verifiedToken(IDS.ordinary)),
    'Public quantity projection'
  );
  await assertFails(
    databaseRequest('PATCH', `publicLists/${IDS.ordinary}`, { inventory: { eevee: { qty: 12 } }, updatedAt: 201 }, verifiedToken(IDS.ordinary)),
    'Raw inventory projection'
  );
});

test('unlisted shares use an exact opaque link and a separate private owner index', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Enable candidate');
  await assertSucceeds(databaseRequest('PUT', 'unlistedShareOwners/share-new', IDS.ordinary, TOKENS.ordinary), 'Owner creates private share index');
  await assertSucceeds(
    databaseRequest('PUT', 'unlistedShares/share-new', {
      trainerName: USERS.ordinary,
      active: true,
      profile: { bio: 'Shared privately' },
      lists: { forTrade: { eevee: { name: 'Eevee', note: 'Trade note' } } },
      createdAt: 200,
      updatedAt: 200
    }, verifiedToken(IDS.ordinary)),
    'Verified owner creates unlisted projection'
  );
  await assertSucceeds(databaseRequest('GET', 'unlistedShares/share-new'), 'Anonymous exact unlisted read');
  await assertFails(databaseRequest('GET', 'unlistedShareOwners/share-new'), 'Anonymous share-owner read');
  await assertFails(
    databaseRequest('PATCH', 'unlistedShares/share-new', { uid: IDS.ordinary, updatedAt: 201 }, verifiedToken(IDS.ordinary)),
    'UID in public unlisted projection'
  );
});

test('legacy username index is admin-managed and does not grant ordinary write authority', async () => {
  await assertSucceeds(databaseRequest('PUT', 'globalIdentityConfig/writesEnabled', true, TOKENS.admin), 'Enable candidate');
  await assertFails(
    databaseRequest('PUT', `legacyUsernameIndex/${USERS.other}`, IDS.other, TOKENS.other),
    'Ordinary legacy-index write'
  );
  await assertSucceeds(
    databaseRequest('PUT', `legacyUsernameIndex/${USERS.other}`, IDS.other, TOKENS.admin),
    'Admin legacy-index write'
  );
});
