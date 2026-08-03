const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const INDEX_SOURCE = readFileSync(INDEX_PATH, 'utf8');

function sourceBetween(start, end) {
  const startAt = INDEX_SOURCE.indexOf(start);
  const endAt = INDEX_SOURCE.indexOf(end, startAt);
  assert.notEqual(startAt, -1, `Expected source marker: ${start}`);
  assert.notEqual(endAt, -1, `Expected source marker: ${end}`);
  return INDEX_SOURCE.slice(startAt, endAt);
}

const AUTH_INDEX_HELPERS = sourceBetween(
  'function isRecoverableAuthIndexError(error)',
  'let _loginDirectoryRepairStarted=false;'
);

function snapshot(value) {
  return {
    exists: () => value !== null && value !== undefined,
    val: () => value
  };
}

function createHarness({
  username = 'OrdinaryTrainer',
  uid = 'uid-ordinary',
  sessionUid = uid,
  mapping = { username, isAdmin: false, isOwner: false, lastSeen: 1 },
  boundUid = uid,
  now = 123456,
  getError = null,
  updateError = null,
  setError = null
} = {}) {
  const state = {
    mapping: mapping === null ? null : { ...mapping },
    boundUid
  };
  const calls = { get: [], update: [], set: [], warn: [] };
  const sandbox = {
    auth: { currentUser: sessionUid ? { uid: sessionUid } : null },
    db: {},
    Date: { now: () => now },
    console: { warn: (...args) => calls.warn.push(args) },
    ref: (_db, target) => target,
    get: async target => {
      calls.get.push(target);
      if (getError) throw getError;
      if (target === `authIndex/${uid}`) return snapshot(state.mapping);
      if (target === `users/${username}/authUid`) return snapshot(state.boundUid);
      throw new Error(`Unexpected get target: ${target}`);
    },
    update: async (target, payload) => {
      calls.update.push({ target, payload: { ...payload } });
      if (updateError) throw updateError;
      state.mapping = { ...(state.mapping || {}), ...payload };
    },
    set: async (target, payload) => {
      calls.set.push({ target, payload: { ...payload } });
      if (setError) throw setError;
      state.mapping = { ...payload };
    },
    withTimeout: promise => promise
  };
  vm.createContext(sandbox);
  vm.runInContext(AUTH_INDEX_HELPERS, sandbox);
  return {
    calls,
    state,
    sync: (record = {}) => sandbox.syncOwnAuthIndex(username, { uid }, record)
  };
}

test('existing-user refresh updates only lastSeen and preserves username and extra fields', async () => {
  const harness = createHarness({
    mapping: {
      username: 'OrdinaryTrainer',
      isAdmin: false,
      isOwner: false,
      provider: 'legacy',
      lastSeen: 1
    }
  });

  const result = await harness.sync({ isAdmin: true, isOwner: true });

  assert.equal(result.status, 'refreshed');
  assert.deepEqual(harness.calls.update, [{
    target: 'authIndex/uid-ordinary',
    payload: { lastSeen: 123456 }
  }]);
  assert.deepEqual(harness.calls.set, []);
  assert.deepEqual(harness.state.mapping, {
    username: 'OrdinaryTrainer',
    isAdmin: false,
    isOwner: false,
    provider: 'legacy',
    lastSeen: 123456
  });
});

test('owner login uses the same metadata-only refresh without replacing authority fields', async () => {
  const harness = createHarness({
    username: 'ProtectedOwner',
    uid: 'uid-owner',
    mapping: { username: 'ProtectedOwner', isAdmin: true, isOwner: true, lastSeen: 1 }
  });

  const result = await harness.sync({ isAdmin: false, isOwner: false });

  assert.equal(result.status, 'refreshed');
  assert.deepEqual(harness.calls.update[0].payload, { lastSeen: 123456 });
  assert.equal(harness.state.mapping.username, 'ProtectedOwner');
  assert.equal(harness.state.mapping.isAdmin, true);
  assert.equal(harness.state.mapping.isOwner, true);
});

test('missing UID-bound mapping preserves first-login initialization behavior', async () => {
  const harness = createHarness({ mapping: null });

  const result = await harness.sync({ isAdmin: false, isOwner: false });

  assert.equal(result.status, 'initialized');
  assert.deepEqual(harness.calls.update, []);
  assert.deepEqual(harness.calls.set, [{
    target: 'authIndex/uid-ordinary',
    payload: {
      username: 'OrdinaryTrainer',
      isAdmin: false,
      isOwner: false,
      lastSeen: 123456
    }
  }]);
});

test('missing mapping hard-stops when the trainer record is not UID-bound', async () => {
  const harness = createHarness({ mapping: null, boundUid: 'uid-someone-else' });

  await assert.rejects(harness.sync(), error => error.code === 'auth/index-binding-mismatch');
  assert.deepEqual(harness.calls.set, []);
  assert.deepEqual(harness.calls.update, []);
});

test('existing mismatched username hard-stops without overwrite or repair', async () => {
  const harness = createHarness({ mapping: { username: 'AnotherTrainer', lastSeen: 1 } });

  await assert.rejects(harness.sync(), error => error.code === 'auth/index-mismatch');
  assert.deepEqual(harness.calls.set, []);
  assert.deepEqual(harness.calls.update, []);
});

test('authenticated-session UID mismatch hard-stops before database access', async () => {
  const harness = createHarness({ sessionUid: 'uid-someone-else' });

  await assert.rejects(harness.sync(), error => error.code === 'auth/index-session-mismatch');
  assert.deepEqual(harness.calls.get, []);
  assert.deepEqual(harness.calls.set, []);
  assert.deepEqual(harness.calls.update, []);
});

test('recoverable metadata update failure permits login after mapping consistency is established', async () => {
  const failure = Object.assign(new Error('temporarily unavailable'), { code: 'database/unavailable' });
  const harness = createHarness({ updateError: failure });

  const result = await harness.sync();

  assert.equal(result.status, 'deferred');
  assert.equal(harness.calls.warn.length, 1);
  assert.equal(harness.state.mapping.username, 'OrdinaryTrainer');
  assert.equal(harness.state.mapping.lastSeen, 1);
});

test('recoverable read failure still hard-stops when mapping consistency is unknown', async () => {
  const failure = Object.assign(new Error('temporarily unavailable'), { code: 'database/unavailable' });
  const harness = createHarness({ getError: failure });

  await assert.rejects(harness.sync(), error => error === failure);
  assert.deepEqual(harness.calls.set, []);
  assert.deepEqual(harness.calls.update, []);
});

test('permission denial is a hard stop after reading an established mapping', async () => {
  const failure = Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED' });
  const harness = createHarness({ updateError: failure });

  await assert.rejects(harness.sync(), error => error === failure);
  assert.equal(harness.calls.warn.length, 0);
  assert.equal(harness.state.mapping.username, 'OrdinaryTrainer');
});

test('both login branches converge on syncOwnAuthIndex and ensureFirebaseIdentity no longer writes the index', () => {
  const ensureSource = sourceBetween(
    'async function ensureFirebaseIdentity(username,pin,ud)',
    'async function connectFirebase()'
  );
  const loginSource = sourceBetween('async function doLogin()', 'function logout()');
  const identityAt = loginSource.indexOf('ident=ident||(auth?await ensureFirebaseIdentity(u,p,ud):null);');
  const syncAt = loginSource.indexOf('if(ident&&db)await syncOwnAuthIndex(u,ident,ud);');
  const sessionAt = loginSource.indexOf('cur=u;stampSession(u);');

  assert.ok(identityAt >= 0 && identityAt < syncAt && syncAt < sessionAt);
  assert.equal((loginSource.match(/syncOwnAuthIndex\(/g) || []).length, 1);
  assert.ok(!ensureSource.includes('authIndex/'));
  assert.ok(ensureSource.includes('createUserWithEmailAndPassword'));
  assert.ok(ensureSource.includes('bindAuthUserNow(username,authUpdate)'));
});
