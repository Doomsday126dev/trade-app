'use strict';
const { createAdapter } = require('../../functions/legacy-pin-reset/adapter');
const { authEmail } = require('../../functions/legacy-pin-reset/reset');
const { CONTRACT, ROOT } = require('../../functions/legacy-pin-reset/identity-fence');
const { fingerprint, validateManifest } = require('./legacy-slot-reconciliation.cjs');
const IDENTITY_FIELDS = ['authUid', 'authEmail', 'authVersion', 'username', 'authReady', 'isAdmin', 'disabled', 'frozen', 'identityFrozen', 'status', 'state'];
const UID_ROOTS = ['accountSync', 'accounts', 'trainerShares', 'userPreferences', 'shareVisibility', 'shareAccess', 'userCommunities'];
const USERNAME_ROOTS = ['users', 'loginDirectory', 'publicShares', 'wishlist', 'dynamax', 'gmax', 'costumes', 'have', 'offers', 'trades', 'requests', 'lookingFor', 'forTrade', 'specialTradeBoard'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = name => name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '_');
const active = value => object(value) && ['disabled', 'frozen', 'identityFrozen'].every(k => value[k] === undefined || value[k] === false) &&
  ['state', 'status'].every(k => value[k] === undefined || value[k] === 'active');
function canonicalOwnedBy(value, uid) {
  if (Array.isArray(value)) return value.every(child => canonicalOwnedBy(child, uid));
  return !object(value) || (!Object.hasOwn(value, 'ownerUid') || value.ownerUid === uid) && Object.values(value).every(child => canonicalOwnedBy(child, uid));
}
function check(condition, code = 'repair/evidence-invalid') { if (!condition) throw Object.assign(new Error(code), { code }); }
function bounded(value) {
  check(value === null || object(value) && Object.keys(value).length <= 1000);
  return value || {};
}
// Explicit projection prevents password hashes, salts, tokens and export-only credentials from entering a manifest.
function projectAuth(user) {
  check(user && typeof user.uid === 'string' && Array.isArray(user.providerData));
  const creationTimestampMillis = user.creationTimestampMillis ?? Date.parse(user.metadata?.creationTime);
  check(Number.isSafeInteger(creationTimestampMillis) && creationTimestampMillis > 0 && Number.isFinite(Date.parse(user.metadata?.creationTime)));
  return { uid: user.uid, email: user.email || null, disabled: user.disabled === true,
    metadata: { creationTime: user.metadata?.creationTime || null },
    creationTimestampMillis,
    providerData: user.providerData.map(p => ({ providerId: p.providerId, uid: p.uid, email: p.email || null,
      displayName: p.displayName || null, photoURL: p.photoURL || null, phoneNumber: p.phoneNumber || null })).sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))),
    tenantId: user.tenantId || null, phoneNumber: user.phoneNumber || null, customClaims: user.customClaims || {},
    enrolledFactors: user.multiFactor?.enrolledFactors || [] };
}
async function readIdentityInventory(readDatabase) {
  const users = Object.create(null);
  for (const username of Object.keys(bounded((await readDatabase('users', { shallow: true })).value))) {
    const fields = await Promise.all(IDENTITY_FIELDS.map(async field => [field, (await readDatabase(`users/${username}/${field}`)).value]));
    users[username] = Object.fromEntries(fields.filter(([, value]) => value !== null));
  }
  const result = { users };
  for (const root of ['authIndex', 'loginDirectory', 'admins']) {
    const records = bounded((await readDatabase(root)).value);
    result[root] = root === 'admins' ? records : Object.fromEntries(Object.entries(records).map(([key, record]) =>
      [key, object(record) ? Object.fromEntries(IDENTITY_FIELDS.filter(field => Object.hasOwn(record, field)).map(field => [field, record[field]])) : record]));
  }
  return result;
}
function authorityConverged(username, uid, obsolete, inventory, identities, authoritativeAuth, obsoleteAuth) {
  const { users, loginDirectory, authIndex, admins } = inventory, user = users[username], directory = loginDirectory[username];
  if (!active(user) || !active(directory) || user.isAdmin === true || admins[uid] === true || admins[obsolete] === true ||
      !Number.isSafeInteger(user.authVersion) || user.authVersion < 2 || user.authUid !== uid || directory.authReady !== true ||
      directory.authVersion !== user.authVersion || user.authEmail !== authEmail(username, user.authVersion)) return false;
  if (directory.authUid !== undefined && directory.authUid !== uid || directory.authEmail !== undefined && directory.authEmail !== user.authEmail) return false;
  const aliases = Object.entries(users).filter(([name, value]) => key(name) === key(username) || [uid, obsolete].includes(value?.authUid) ||
    [authoritativeAuth.email, obsoleteAuth.email].includes(value?.authEmail));
  if (aliases.length !== 1 || aliases[0][0] !== username || Object.keys(loginDirectory).filter(name => key(name) === key(username)).length !== 1) return false;
  if (Object.entries(loginDirectory).some(([name, value]) => name !== username && ([uid, obsolete].includes(value?.authUid) ||
      [authoritativeAuth.email, obsoleteAuth.email].includes(value?.authEmail)))) return false;
  if (Object.entries(authIndex).some(([id, value]) => id !== uid && (id === obsolete || typeof value?.username === 'string' && key(value.username) === key(username)))) return false;
  const pattern = new RegExp(`^${key(username)}(?:_v[1-9][0-9]*)?@pogotrades\\.nyc$`, 'i');
  const matches = identities.filter(a => pattern.test(a.email || ''));
  if (matches.length !== 2 || new Set(matches.map(a => a.uid)).size !== 2 || !matches.every(a => [uid, obsolete].includes(a.uid))) return false;
  return authoritativeAuth.uid === uid && authoritativeAuth.email === user.authEmail && !authoritativeAuth.disabled && !authoritativeAuth.tenantId &&
    authoritativeAuth.providerData.some(p => p.providerId === 'password' && p.uid === authoritativeAuth.email) &&
    obsoleteAuth.uid === obsolete && !obsoleteAuth.tenantId && !obsoleteAuth.phoneNumber && !Object.keys(obsoleteAuth.customClaims).length &&
    !obsoleteAuth.enrolledFactors.length && obsoleteAuth.providerData.length === 1 && obsoleteAuth.providerData[0].providerId === 'password' &&
    obsoleteAuth.providerData[0].uid === obsoleteAuth.email;
}
function createEvidenceReader({ username, authoritativeUid, obsoleteUid, readDatabase, auth, firestore, readBoundary }) {
  check(/^[A-Za-z0-9 _-]{1,64}$/.test(username || '') && username.trim() === username && username !== 'Doomsday126' &&
    [authoritativeUid, obsoleteUid].every(uid => /^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) && authoritativeUid !== obsoleteUid);
  return async function readState() {
    // Each invocation reacquires every precondition; a cache only deduplicates reads within this snapshot.
    const cache = new Map();
    const adapter = createAdapter({ auth, firestore, database: { ref: path => ({ get: async () => {
      check(cache.has(path)); return { val: () => cache.get(path) };
    } }) } });
    const read = async path => { const result = await readDatabase(path); cache.set(path, result.value); return result; };
    const inventory = await readIdentityInventory(readDatabase);
    const page = await auth.listUsers(1000); check(!page.pageToken && page.users.length <= 1000, 'repair/auth-inventory-too-large');
    const identities = page.users.map(({ uid, email, disabled }) => ({ uid, email, disabled }));
    const authoritativeAuth = projectAuth(await auth.getUser(authoritativeUid)), obsoleteAuth = projectAuth(await auth.getUser(obsoleteUid));
    const protectedHashes = {};
    for (const root of USERNAME_ROOTS) { const path = `${root}/${username}`; protectedHashes[path] = fingerprint((await read(path)).value); }
    for (const uid of [authoritativeUid, obsoleteUid]) for (const root of UID_ROOTS) {
      const path = `${root}/${uid}`; protectedHashes[path] = fingerprint((await read(path)).value);
    }
    for (const root of ['communities', 'trades', 'communityRequests', 'pendingDecrements']) protectedHashes[root] = fingerprint((await read(root)).value);
    const sharePath = `shareDirectory/${username.normalize('NFKC').toLowerCase()}`;
    protectedHashes[sharePath] = fingerprint((await read(sharePath)).value);
    let legacy = await adapter.legacyOnly(authoritativeUid, username) && await adapter.legacyOnly(obsoleteUid, username);
    for (const uid of [authoritativeUid, obsoleteUid]) {
      for (const root of ['identityMigrations', 'identityConflicts', 'operationRequests']) {
        if ((await firestore.doc(`${root}/${uid}`).get()).exists) legacy = false;
      }
      for (const path of [`accounts/${uid}/providers`, `identityMigrations/${uid}/operations`, `operationRequests/${uid}/requests`]) {
        if (!(await firestore.collection(path).limit(1).get()).empty) legacy = false;
      }
      for (const root of ['providerSubjects', 'trainerHandles']) {
        if (!(await firestore.collection(root).where('uid', '==', uid).limit(1).get()).empty) legacy = false;
      }
    }
    const unowned = await adapter.retiredSlotIsUnowned(obsoleteUid, authoritativeUid, username);
    const authoritativeIndex = await read(`authIndex/${authoritativeUid}`), obsoleteIndex = await read(`authIndex/${obsoleteUid}`);
    const authoritativeFence = await read(`${ROOT}/${authoritativeUid}`), obsoleteFence = await read(`${ROOT}/${obsoleteUid}`);
    const protectedInventory = structuredClone(inventory); delete protectedInventory.authIndex[authoritativeUid];
    return { user: inventory.users[username], directory: inventory.loginDirectory[username], authoritativeAuth, obsoleteAuth,
      authoritativeIndex: authoritativeIndex.value, indexEtag: authoritativeIndex.etag, obsoleteIndex: obsoleteIndex.value,
      authoritativeFence: authoritativeFence.value, authoritativeFenceEtag: authoritativeFence.etag,
      obsoleteFence: obsoleteFence.value, obsoleteFenceEtag: obsoleteFence.etag,
      protectedFingerprint: fingerprint({ protectedHashes, inventory: protectedInventory, legacy, unowned }),
      authorityConverged: legacy && cache.get(`accounts/${authoritativeUid}`) === null && canonicalOwnedBy(cache.get(`accountSync/${authoritativeUid}`), authoritativeUid) &&
        (cache.get(`publicShares/${username}`)?.ownerUid === undefined || cache.get(`publicShares/${username}`).ownerUid === authoritativeUid) &&
        (cache.get(`publicShares/${username}`)?.username === undefined || cache.get(`publicShares/${username}`).username === username) &&
        authorityConverged(username, authoritativeUid, obsoleteUid, inventory, identities, authoritativeAuth, obsoleteAuth),
      obsoleteHasUniqueState: !unowned, boundary: await readBoundary() };
  };
}
function manifestFromState({ projectId, username, state, now = Date.now() }) {
  const authoritativeUid = state.authoritativeAuth.uid, obsoleteUid = state.obsoleteAuth.uid, authVersion = state.user.authVersion;
  const obsoleteVersion = state.obsoleteAuth.email === authEmail(username, 1) ? 1 : Number(/_v([1-9][0-9]*)@pogotrades\.nyc$/.exec(state.obsoleteAuth.email)?.[1]);
  const index = { username, authEmail: authEmail(username, authVersion), authVersion };
  const manifest = { schemaVersion: 1, operation: 'reconcile-inactive-legacy-slot', projectId, username, authoritativeUid, obsoleteUid, authVersion, obsoleteVersion,
    protectedFingerprint: state.protectedFingerprint, authoritativeAuthFingerprint: fingerprint(state.authoritativeAuth), obsoleteAuthFingerprint: fingerprint(state.obsoleteAuth),
    authoritativeCreatedAt: Date.parse(state.authoritativeAuth.metadata.creationTime), obsoleteCreatedAt: Date.parse(state.obsoleteAuth.metadata.creationTime), createdAt: now,
    securityContract: CONTRACT, rulesFingerprint: state.boundary.rulesFingerprint, boundaryFingerprint: state.boundary.fingerprint,
    permittedMutations: [{ path: `${ROOT}/${authoritativeUid}`, method: 'create-maintenance' }, { path: `${ROOT}/${obsoleteUid}`, method: 'create-maintenance' },
      { path: `${ROOT}/${obsoleteUid}`, method: 'retire-exact-maintenance' }, { uid: obsoleteUid, method: 'disable-existing-auth', disabled: true },
      { path: `authIndex/${authoritativeUid}`, method: 'create-only', value: index }, { path: `${ROOT}/${authoritativeUid}`, method: 'release-exact-maintenance' }] };
  validateManifest(manifest);
  check(require('./legacy-slot-reconciliation.cjs').classifyState(manifest, state) === 'before', 'repair/initial-state-required');
  return manifest;
}
module.exports = { IDENTITY_FIELDS, UID_ROOTS, USERNAME_ROOTS, canonicalOwnedBy, projectAuth, readIdentityInventory, authorityConverged, createEvidenceReader, manifestFromState };
