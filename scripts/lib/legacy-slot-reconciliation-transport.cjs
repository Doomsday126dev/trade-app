'use strict';
const { fingerprint, validateManifest, expectedFences } = require('./legacy-slot-reconciliation.cjs');
const { ROOT } = require('../../functions/legacy-pin-reset/identity-fence');
function requireThat(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function createReconciliationTransport({ manifest, credential, readObsoleteAuth, readFence, readIndex, fetchImpl = fetch, authEmulatorHost, databaseEmulatorHost }) {
  const index = validateManifest(manifest), fences = expectedFences(manifest), project = manifest.projectId;
  const emulator = !!authEmulatorHost || !!databaseEmulatorHost;
  requireThat(emulator ? project === 'demo-legacy-pin-reset' && authEmulatorHost === '127.0.0.1:9499' && databaseEmulatorHost === '127.0.0.1:9500'
    : project === 'trade-list-a4297', 'repair/transport-configuration');
  const authOrigin = emulator ? `http://${authEmulatorHost}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const databaseOrigin = emulator ? `http://${databaseEmulatorHost}` : `https://${project}-default-rtdb.firebaseio.com`;
  const accessToken = async () => emulator ? 'owner' : (await credential.getAccessToken()).access_token;
  const exact = (a, b) => fingerprint(a) === fingerprint(b);
  const databaseUrl = path => {
    const url = new URL(`${databaseOrigin}/${path}.json`);
    if (emulator) url.searchParams.set('ns', `${project}-default-rtdb`);
    return url.href;
  };
  const requireFence = async (uid, expected) => {
    const value = await readFence(uid);
    requireThat(exact(value.value, expected), 'repair/fence-precondition-failed');
    return value;
  };
  const requireRetirement = async () => {
    await requireFence(manifest.authoritativeUid, fences.authoritative);
    await requireFence(manifest.obsoleteUid, fences.obsoleteRetired);
  };
  return Object.freeze({
    async compareAndSetFence(uid, expected, next, etag) {
      const allowed = uid === manifest.authoritativeUid
        ? (expected === null && exact(next, fences.authoritative)) || (exact(expected, fences.authoritative) && next === null)
        : uid === manifest.obsoleteUid && ((expected === null && exact(next, fences.obsoleteMaintenance)) ||
          (exact(expected, fences.obsoleteMaintenance) && exact(next, fences.obsoleteRetired)));
      requireThat(allowed && (expected === null ? etag === 'null_etag' : typeof etag === 'string' && etag.length > 0 && etag !== 'null_etag'), 'repair/mutation-scope-invalid');
      const current = await requireFence(uid, expected);
      requireThat(current.etag === etag, 'repair/fence-precondition-failed');
      if (uid === manifest.obsoleteUid) await requireFence(manifest.authoritativeUid, fences.authoritative);
      if (next === null) {
        await requireRetirement();
        requireThat(exact(await readIndex(manifest.authoritativeUid), index), 'repair/index-precondition-failed');
        const obsolete = await readObsoleteAuth(manifest.obsoleteUid);
        requireThat(obsolete.disabled === true && fingerprint({ ...obsolete, disabled: false }) === manifest.obsoleteAuthFingerprint, 'repair/precondition-changed');
      }
      const response = await fetchImpl(databaseUrl(`${ROOT}/${uid}`), { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(next) });
      if (!response.ok) { await response.body?.cancel(); requireThat(false, response.status === 412 ? 'repair/fence-precondition-failed' : 'repair/fence-unconfirmed'); }
      requireThat(exact(await response.json(), next), 'repair/fence-unconfirmed');
    },
    async createIndexOnly(uid, value, etag) {
      requireThat(uid === manifest.authoritativeUid && fingerprint(value) === fingerprint(index) && etag === 'null_etag', 'repair/mutation-scope-invalid');
      await requireRetirement();
      const obsolete = await readObsoleteAuth(manifest.obsoleteUid);
      requireThat(obsolete.disabled === true && fingerprint({ ...obsolete, disabled: false }) === manifest.obsoleteAuthFingerprint, 'repair/precondition-changed');
      const response = await fetchImpl(databaseUrl(`authIndex/${uid}`), { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(index) });
      if (!response.ok) { await response.body?.cancel(); requireThat(false, response.status === 412 ? 'repair/index-precondition-failed' : 'repair/index-unconfirmed'); }
      requireThat(fingerprint(await response.json()) === fingerprint(index), 'repair/index-unconfirmed');
    },
    async disableExistingAuth(uid, expectedFingerprint) {
      requireThat(uid === manifest.obsoleteUid && expectedFingerprint === manifest.obsoleteAuthFingerprint, 'repair/mutation-scope-invalid');
      await requireRetirement();
      requireThat(fingerprint(await readObsoleteAuth(uid)) === expectedFingerprint, 'repair/precondition-changed');
      const response = await fetchImpl(`${authOrigin}/v1/projects/${project}/accounts:update`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid, disableUser: true }) });
      if (!response.ok) { await response.body?.cancel(); requireThat(false, 'repair/disable-unconfirmed'); }
      requireThat((await response.json()).localId === uid, 'repair/disable-unconfirmed');
    }
  });
}
module.exports = { createReconciliationTransport };
