'use strict';
const assert = require('node:assert/strict');
const { fingerprint, reconcileLegacySlot } = require('../../scripts/lib/legacy-slot-reconciliation.cjs');
const { createEvidenceReader, manifestFromState, projectAuth } = require('../../scripts/lib/legacy-slot-reconciliation-evidence.cjs');
const { createReconciliationTransport } = require('../../scripts/lib/legacy-slot-reconciliation-transport.cjs');
const { createAdapter } = require('../../functions/legacy-pin-reset/adapter');
const { CONTRACT, ROOT } = require('../../functions/legacy-pin-reset/identity-fence');

module.exports = async function qualifyReconciliation({ auth, evidence, products, canonical }) {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9499');
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9500');
  const projectId = 'demo-legacy-pin-reset', uid = 'uid-owner', obsolete = 'reset-obsolete-v2', username = 'Owner';
  const request = async (method, path, value, token, options = {}) => {
    const url = new URL(`http://127.0.0.1:9500/${path}.json`); url.searchParams.set('ns', `${projectId}-default-rtdb`);
    if (token) url.searchParams.set('auth', token);
    if (options.shallow) url.searchParams.set('shallow', 'true');
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(options.shallow ? {} : { 'X-Firebase-ETag': 'true' }),
      ...(token ? {} : { Authorization: 'Bearer owner' }) }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: response.status, value: await response.json(), etag: response.headers.get('etag')?.replace(/^"(null_etag)"$/, '$1') };
  };
  const readDatabase = async (path, options) => { const result = await request('GET', path, undefined, undefined, options); assert.equal(result.status, 200); return result; };
  const seed = { ...structuredClone(evidence), users: { ...evidence.users, Owner: { ...evidence.users.Owner, isAdmin: false, isOwner: false } },
    wishlist: { Owner: products.lf }, publicShares: { Owner: { username, lists: { wishlist: { Pikachu: 'H' } } } }, accountSync: { [uid]: canonical } };
  delete seed.authIndex[uid];
  assert.equal((await request('PUT', '', seed)).status, 200);
  const persistedCanonical = (await readDatabase(`accountSync/${uid}`)).value;
  const session = await fetch('http://127.0.0.1:9499/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner_v2@pogotrades.nyc', password: '123456', returnSecureToken: true }) });
  assert.equal(session.status, 200); const token = (await session.json()).idToken;
  const alias = { authUid: obsolete, authEmail: 'owner_v2@pogotrades.nyc', authVersion: 2, isAdmin: false, isOwner: false };
  assert.equal((await request('PUT', 'users/ResetSyntheticAlias', alias, token)).status, 200);
  assert.equal((await request('PUT', `authIndex/${obsolete}`, { username: 'ResetSyntheticAlias' }, token)).status, 200);
  assert.equal((await request('DELETE', 'users/ResetSyntheticAlias')).status, 200);
  assert.equal((await request('DELETE', `authIndex/${obsolete}`)).status, 200);
  const firestore = { doc: () => ({ get: async () => ({ exists: false }) }), collection: () => {
    const query = { where: () => query, limit: () => query, get: async () => ({ empty: true }) }; return query;
  } };
  const boundary = { resetEnabled: false, quiesced: true, pendingResetCount: 0, immutableBindingsVerified: true, fingerprint: 'b'.repeat(64),
    securityContract: CONTRACT, rulesFingerprint: fingerprint(require('../firebase/database.rules.legacy-identity-fences.json')) };
  const readState = createEvidenceReader({ username, authoritativeUid: uid, obsoleteUid: obsolete, readDatabase, auth, firestore, readBoundary: async () => boundary });
  const initial = await readState(), manifest = manifestFromState({ projectId, username, state: initial });
  // The production adapter is exercised against live emulator values, not caller-supplied eligibility flags.
  const liveAdapter = createAdapter({ auth, firestore, database: { ref: path => ({ get: async () => {
    const result = await readDatabase(path); return { val: () => result.value };
  } }) } });
  let disabledProof = false;
  const transport = createReconciliationTransport({ manifest, authEmulatorHost: '127.0.0.1:9499', databaseEmulatorHost: '127.0.0.1:9500',
    readObsoleteAuth: async id => projectAuth(await auth.getUser(id)), readFence: id => readDatabase(`${ROOT}/${id}`),
    readIndex: async id => (await readDatabase(`authIndex/${id}`)).value });
  const result = await reconcileLegacySlot(manifest, { ...transport, readState, recordProgress: async progress => {
    if (progress.phase !== 'before-disabled-obsolete-auth') return;
    assert.equal((await auth.getUser(obsolete)).disabled, false);
    assert.ok([401, 403].includes((await request('PUT', 'users/ResetSyntheticAlias', alias, token)).status));
    assert.ok([401, 403].includes((await request('PUT', `authIndex/${obsolete}`, { username }, token)).status));
    disabledProof = true;
  } });
  assert.equal(result.phase, 'reconciled'); assert.equal(result.mutations.length, 6); assert.equal(disabledProof, true);
  assert.equal((await auth.getUser(obsolete)).disabled, true);
  assert.equal((await readState()).protectedFingerprint, initial.protectedFingerprint);
  assert.deepEqual((await readDatabase(`accountSync/${uid}`)).value, persistedCanonical);
  assert.ok([401, 403].includes((await request('PUT', 'users/ResetSyntheticAlias', alias, token)).status));
  const finalEvidence = await liveAdapter.readEvidence();
  assert.equal(finalEvidence.users.Owner.authUid, uid); assert.equal(finalEvidence.authIndex[uid].username, username);
  return { adapter: liveAdapter, evidence: finalEvidence, verifyPreserved: async () => {
    assert.equal((await readState()).protectedFingerprint, initial.protectedFingerprint);
    assert.equal((await auth.getUser(obsolete)).disabled, true);
  } };
};
