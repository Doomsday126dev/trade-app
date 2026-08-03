const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PROJECT_ID = 'demo-pogo-rules';
const DATABASE_NAMESPACE = `${PROJECT_ID}-default-rtdb`;
const DEPLOYED_RULES_SHA256 = '5c238b9fc9ad10422e3470863aca6fee26a3ef8ce7c7bbdf4051cdc2da9c7268';
const DEPLOYED_RULES_PATH = path.join(__dirname, 'database.rules.current.json');
const DEPLOYED_RULES = readFileSync(DEPLOYED_RULES_PATH, 'utf8');
const HARDENED_RULES_PATH = path.join(__dirname, 'database.rules.hardened.json');
const HARDENED_RULES = readFileSync(HARDENED_RULES_PATH, 'utf8');
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

const IDS = {};
const TOKENS = {};
const USERS = Object.freeze({
  ordinary: 'OrdinaryTrainer',
  communityAdmin: 'CommunityAdmin',
  protectedOwner: 'ProtectedOwner',
  initializing: 'InitializingTrainer'
});

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
      password: `rules-test-${key}-password`,
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

function databaseRequest(method, target, value, token) {
  const isOwnerRequest = token === 'owner';
  return jsonRequest(
    databaseUrl(target, isOwnerRequest ? undefined : token),
    method,
    value,
    isOwnerRequest ? { authorization: 'Bearer owner' } : undefined
  );
}

async function assertSucceeds(resultPromise, message) {
  const result = await resultPromise;
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${message}; expected success, received ${result.status}: ${JSON.stringify(result.body)}`
  );
}

async function assertFails(resultPromise, message) {
  const result = await resultPromise;
  assert.ok(
    result.status === 401 || result.status === 403,
    `${message}; expected permission denial, received ${result.status}: ${JSON.stringify(result.body)}`
  );
}

async function seedCurrentRuleFixture() {
  await assertSucceeds(
    databaseRequest('PUT', '', {
      admins: {
        [IDS.communityAdmin]: true,
        [IDS.protectedOwner]: true
      },
      authIndex: {
        [IDS.ordinary]: { username: USERS.ordinary },
        [IDS.communityAdmin]: { username: USERS.communityAdmin },
        [IDS.protectedOwner]: { username: USERS.protectedOwner }
      },
      users: {
        [USERS.ordinary]: {
          authUid: IDS.ordinary,
          authEmail: 'ordinarytrainer@example.test',
          isAdmin: false,
          isOwner: false
        },
        [USERS.communityAdmin]: {
          authUid: IDS.communityAdmin,
          authEmail: 'communityadmin@example.test',
          isAdmin: false,
          isOwner: false
        },
        [USERS.protectedOwner]: {
          authUid: IDS.protectedOwner,
          authEmail: 'protectedowner@example.test',
          isAdmin: true,
          isOwner: true
        }
      },
      communities: {
        nyc: {
          name: 'NYC',
          memberUsernames: {
            [USERS.ordinary]: true,
            [USERS.communityAdmin]: true,
            [USERS.protectedOwner]: true
          }
        }
      },
      userCommunities: {
        [IDS.ordinary]: { nyc: true },
        [IDS.communityAdmin]: { nyc: true },
        [IDS.protectedOwner]: { nyc: true }
      },
      communityRequests: {
        nyc: {
          existing: { username: USERS.ordinary }
        }
      }
    }, 'owner'),
    'Owner token should seed the isolated emulator fixture'
  );
}

before(async () => {
  assert.equal(
    createHash('sha256').update(DEPLOYED_RULES).digest('hex'),
    DEPLOYED_RULES_SHA256,
    'Committed rules fixture must remain byte-identical to the captured deployed baseline'
  );
  assert.ok(
    !HARDENED_RULES.includes('OWNER_USERNAME_PLACEHOLDER'),
    'Hardened rules must not depend on the deployed owner username placeholder'
  );
  await createAuthUser('ordinary', USERS.ordinary);
  await createAuthUser('communityAdmin', USERS.communityAdmin);
  await createAuthUser('protectedOwner', USERS.protectedOwner);
  await createAuthUser('initializing', USERS.initializing);
});

beforeEach(async () => {
  await assertSucceeds(
    databaseRequest('PUT', '', null, 'owner'),
    'Owner token should clear the isolated emulator database'
  );
  await seedCurrentRuleFixture();
});

after(async () => {
  await jsonRequest(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, 'DELETE');
});

test('unauthenticated visitors cannot read protected community or account paths', async () => {
  for (const target of [
    'communities/nyc',
    `userCommunities/${IDS.ordinary}`,
    'communityRequests/nyc',
    `admins/${IDS.communityAdmin}`,
    `users/${USERS.ordinary}/isOwner`,
    `authIndex/${IDS.ordinary}`
  ]) {
    await assertFails(databaseRequest('GET', target), `Unauthenticated read should fail at ${target}`);
  }
});

test('unauthenticated visitors cannot write community or authority paths', async () => {
  for (const target of [
    'communities/nj',
    `userCommunities/${IDS.ordinary}/nj`,
    'communityRequests/nj/request-1',
    `admins/${IDS.ordinary}`,
    `users/${USERS.ordinary}/isOwner`,
    `authIndex/${IDS.ordinary}`
  ]) {
    await assertFails(databaseRequest('PUT', target, true), `Unauthenticated write should fail at ${target}`);
  }
});

test('[expected current behavior] authenticated users inherit broad root read access', async () => {
  for (const target of [
    'communities/nyc',
    `userCommunities/${IDS.protectedOwner}`,
    'communityRequests/nyc',
    `admins/${IDS.protectedOwner}`,
    `users/${USERS.protectedOwner}/isOwner`,
    `authIndex/${IDS.protectedOwner}`
  ]) {
    await assertSucceeds(
      databaseRequest('GET', target, undefined, TOKENS.ordinary),
      `Authenticated root read should currently succeed at ${target}`
    );
  }
});

test('ordinary users cannot write protected community paths', async () => {
  await assertFails(databaseRequest('PUT', 'communities/nj', { name: 'New Jersey' }, TOKENS.ordinary), 'Ordinary community write');
  await assertFails(databaseRequest('PUT', `userCommunities/${IDS.ordinary}/nj`, true, TOKENS.ordinary), 'Ordinary reverse-index write');
  await assertFails(databaseRequest('PUT', 'communityRequests/nj/request-1', { username: USERS.ordinary }, TOKENS.ordinary), 'Ordinary community request write');
  await assertFails(databaseRequest('PUT', `admins/${IDS.ordinary}`, true, TOKENS.ordinary), 'Ordinary admins write');
});

test('legitimate account initialization may create and refresh only its UID-bound authIndex mapping', async () => {
  await assertFails(
    databaseRequest('PUT', `users/${USERS.initializing}`, {
      authUid: IDS.initializing,
      authEmail: 'initializingtrainer@example.test',
      isAdmin: true,
      isOwner: false
    }, TOKENS.initializing),
    'Initial user creation with a privileged flag'
  );
  await assertSucceeds(
    databaseRequest('PUT', `users/${USERS.initializing}`, {
      authUid: IDS.initializing,
      authEmail: 'initializingtrainer@example.test',
      bio: 'Private setup'
    }, TOKENS.initializing),
    'UID and auth-email-bound user initialization'
  );
  await assertSucceeds(
    databaseRequest('PATCH', `users/${USERS.initializing}`, { isAdmin: false, isOwner: false }, TOKENS.initializing),
    'Missing privileged flags may initialize to false during migration'
  );
  await assertFails(
    databaseRequest('PUT', `authIndex/${IDS.initializing}`, { username: USERS.ordinary }, TOKENS.initializing),
    'Initial authIndex mapping to a username bound to another UID'
  );
  await assertSucceeds(
    databaseRequest('PUT', `authIndex/${IDS.initializing}`, {
      username: USERS.initializing,
      isAdmin: false,
      isOwner: false,
      lastSeen: 1
    }, TOKENS.initializing),
    'UID-bound authIndex initialization'
  );
  await assertSucceeds(
    databaseRequest('PATCH', `authIndex/${IDS.initializing}`, { username: USERS.initializing, lastSeen: 2 }, TOKENS.initializing),
    'Same-username authIndex metadata refresh'
  );
  await assertFails(
    databaseRequest('PATCH', `authIndex/${IDS.initializing}`, { username: USERS.ordinary }, TOKENS.initializing),
    'Established authIndex username reassignment'
  );
  await assertFails(
    databaseRequest('DELETE', `authIndex/${IDS.initializing}`, undefined, TOKENS.initializing),
    'Established authIndex deletion'
  );
  await assertFails(
    databaseRequest('PUT', `authIndex/${IDS.protectedOwner}`, { username: USERS.initializing }, TOKENS.initializing),
    'Foreign authIndex write'
  );
});

test('ordinary users cannot change privileged fields or gain authority from legacy privileged profile values', async () => {
  await assertSucceeds(databaseRequest('PATCH', `users/${USERS.ordinary}`, { bio: 'Safe profile update' }, TOKENS.ordinary), 'Ordinary profile update');
  await assertFails(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isOwner: true }, TOKENS.ordinary), 'Self isOwner escalation');
  await assertFails(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isAdmin: true }, TOKENS.ordinary), 'Self isAdmin escalation');
  await assertFails(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isOwner: null }, TOKENS.ordinary), 'Self isOwner deletion');
  await assertFails(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isAdmin: null }, TOKENS.ordinary), 'Self isAdmin deletion');
  await assertSucceeds(
    databaseRequest('PATCH', `users/${USERS.ordinary}`, { isOwner: true, isAdmin: true }, TOKENS.protectedOwner),
    'Protected admin may preserve legacy privileged profile metadata'
  );
  await assertFails(databaseRequest('PUT', 'communities/nj', { name: 'New Jersey' }, TOKENS.ordinary), 'Legacy profile flags do not grant community authority');
  await assertFails(databaseRequest('PUT', `userCommunities/${IDS.ordinary}/nj`, true, TOKENS.ordinary), 'Legacy profile flags do not grant reverse-index authority');
  await assertFails(databaseRequest('PUT', 'communityRequests/nj/request-1', { username: USERS.ordinary }, TOKENS.ordinary), 'Legacy profile flags do not grant community-request authority');
});

test('ordinary users cannot spoof an established authIndex username to gain community writes', async () => {
  await assertFails(databaseRequest('PATCH', `authIndex/${IDS.ordinary}`, { username: 'OWNER_USERNAME_PLACEHOLDER' }, TOKENS.ordinary), 'Self authIndex spoof');
  await assertFails(databaseRequest('PUT', 'communities/nj', { name: 'New Jersey' }, TOKENS.ordinary), 'Community write after denied authIndex spoof');
  await assertFails(databaseRequest('PUT', `userCommunities/${IDS.ordinary}/nj`, true, TOKENS.ordinary), 'Reverse-index write after denied authIndex spoof');
  await assertFails(databaseRequest('PUT', 'communityRequests/nj/request-1', { username: USERS.ordinary }, TOKENS.ordinary), 'Community request write after denied authIndex spoof');
});

test('an admins UID receives community authority without username or user-role checks', async () => {
  await assertSucceeds(databaseRequest('PUT', `admins/${IDS.ordinary}`, true, TOKENS.communityAdmin), 'Admin authority write');
  await assertSucceeds(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isAdmin: true }, TOKENS.communityAdmin), 'Admin user metadata write');
  await assertSucceeds(databaseRequest('PUT', 'communities/nj', { name: 'New Jersey' }, TOKENS.communityAdmin), 'Admins UID community write');
  await assertSucceeds(databaseRequest('PUT', `userCommunities/${IDS.communityAdmin}/nj`, true, TOKENS.communityAdmin), 'Admins UID reverse-index write');
  await assertSucceeds(databaseRequest('PUT', 'communityRequests/nj/request-1', { username: USERS.communityAdmin }, TOKENS.communityAdmin), 'Admins UID community request write');
});

test('the protected owner/admin fixture can write all current authority and community paths', async () => {
  await assertSucceeds(databaseRequest('PUT', 'communities/nj', { name: 'New Jersey' }, TOKENS.protectedOwner), 'Protected owner community write');
  await assertSucceeds(databaseRequest('PUT', `userCommunities/${IDS.ordinary}/nj`, true, TOKENS.protectedOwner), 'Protected owner reverse-index write');
  await assertSucceeds(databaseRequest('PUT', 'communityRequests/nj/request-1', { username: USERS.ordinary }, TOKENS.protectedOwner), 'Protected owner community request write');
  await assertSucceeds(databaseRequest('PUT', `admins/${IDS.ordinary}`, true, TOKENS.protectedOwner), 'Protected owner admins write');
  await assertSucceeds(databaseRequest('PATCH', `users/${USERS.ordinary}`, { isOwner: false }, TOKENS.protectedOwner), 'Protected owner user metadata write');
});
