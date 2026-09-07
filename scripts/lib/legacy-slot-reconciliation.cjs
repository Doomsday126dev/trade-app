'use strict';
const { createHash } = require('node:crypto');
const { authEmail } = require('../../functions/legacy-pin-reset/reset');
const { CONTRACT, ROOT, recordFor } = require('../../functions/legacy-pin-reset/identity-fence');
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function requireThat(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function validateManifest(manifest) {
  requireThat(object(manifest) && manifest.schemaVersion === 1 && manifest.operation === 'reconcile-inactive-legacy-slot' &&
    ['trade-list-a4297', 'demo-legacy-pin-reset'].includes(manifest.projectId) && manifest.username !== 'Doomsday126' &&
    /^[A-Za-z0-9 _-]{1,64}$/.test(manifest.username || '') && manifest.username.trim() === manifest.username &&
    UID.test(manifest.authoritativeUid || '') && UID.test(manifest.obsoleteUid || '') && manifest.authoritativeUid !== manifest.obsoleteUid &&
    Number.isSafeInteger(manifest.authVersion) && Number.isSafeInteger(manifest.obsoleteVersion) && manifest.obsoleteVersion >= 1 && manifest.obsoleteVersion < manifest.authVersion &&
    HASH.test(manifest.protectedFingerprint || '') && HASH.test(manifest.authoritativeAuthFingerprint || '') && HASH.test(manifest.obsoleteAuthFingerprint || '') &&
    HASH.test(manifest.boundaryFingerprint || '') && HASH.test(manifest.rulesFingerprint || '') && manifest.securityContract === CONTRACT &&
    Number.isSafeInteger(manifest.createdAt) && manifest.createdAt > 0 &&
    Number.isSafeInteger(manifest.authoritativeCreatedAt) && manifest.authoritativeCreatedAt > 0 &&
    Number.isSafeInteger(manifest.obsoleteCreatedAt) && manifest.obsoleteCreatedAt > 0 &&
    manifest.obsoleteCreatedAt <= manifest.authoritativeCreatedAt && manifest.authoritativeCreatedAt <= manifest.createdAt,
  'repair/manifest-invalid');
  const expectedIndex = { username: manifest.username, authEmail: authEmail(manifest.username, manifest.authVersion), authVersion: manifest.authVersion };
  const permittedMutations = [
    { path: `${ROOT}/${manifest.authoritativeUid}`, method: 'create-maintenance' },
    { path: `${ROOT}/${manifest.obsoleteUid}`, method: 'create-maintenance' },
    { path: `${ROOT}/${manifest.obsoleteUid}`, method: 'retire-exact-maintenance' },
    { uid: manifest.obsoleteUid, method: 'disable-existing-auth', disabled: true },
    { path: `authIndex/${manifest.authoritativeUid}`, method: 'create-only', value: expectedIndex },
    { path: `${ROOT}/${manifest.authoritativeUid}`, method: 'release-exact-maintenance' }
  ];
  requireThat(fingerprint(manifest.permittedMutations) === fingerprint(permittedMutations), 'repair/mutation-scope-invalid');
  return expectedIndex;
}
function expectedFences(manifest) {
  validateManifest(manifest);
  const hash = fingerprint(manifest);
  return { authoritative: recordFor(manifest, manifest.authoritativeUid, 'maintenance', hash),
    obsoleteMaintenance: recordFor(manifest, manifest.obsoleteUid, 'maintenance', hash),
    obsoleteRetired: recordFor(manifest, manifest.obsoleteUid, 'retired', hash) };
}
function classifyState(manifest, state) {
  const index = validateManifest(manifest), fences = expectedFences(manifest);
  requireThat(object(state) && state.boundary?.resetEnabled === false && state.boundary?.quiesced === true &&
    state.boundary?.pendingResetCount === 0 && state.boundary?.immutableBindingsVerified === true &&
    state.boundary?.fingerprint === manifest.boundaryFingerprint && state.boundary?.securityContract === CONTRACT &&
    state.boundary?.rulesFingerprint === manifest.rulesFingerprint, 'repair/ownership-not-quiesced');
  requireThat(state.protectedFingerprint === manifest.protectedFingerprint &&
    fingerprint(state.authoritativeAuth) === manifest.authoritativeAuthFingerprint &&
    fingerprint({ ...state.obsoleteAuth, disabled: false }) === manifest.obsoleteAuthFingerprint, 'repair/precondition-changed');
  requireThat(state.user?.authUid === manifest.authoritativeUid && state.user.authVersion === manifest.authVersion && state.user.authEmail === index.authEmail &&
    state.directory?.authReady === true && state.directory.authVersion === manifest.authVersion &&
    (state.directory.authUid === undefined || state.directory.authUid === manifest.authoritativeUid) &&
    (state.directory.authEmail === undefined || state.directory.authEmail === index.authEmail) &&
    state.authoritativeAuth.uid === manifest.authoritativeUid && state.authoritativeAuth.email === index.authEmail && state.authoritativeAuth.disabled === false &&
    Date.parse(state.authoritativeAuth.metadata?.creationTime) === manifest.authoritativeCreatedAt &&
    state.obsoleteAuth.uid === manifest.obsoleteUid && state.obsoleteAuth.email === authEmail(manifest.username, manifest.obsoleteVersion) &&
    Date.parse(state.obsoleteAuth.metadata?.creationTime) === manifest.obsoleteCreatedAt &&
    [true, false].includes(state.obsoleteAuth.disabled) && state.obsoleteIndex === null && state.authorityConverged === true && state.obsoleteHasUniqueState === false,
  'repair/identity-ambiguous');
  for (const [value, etag] of [[state.authoritativeIndex, state.indexEtag], [state.authoritativeFence, state.authoritativeFenceEtag], [state.obsoleteFence, state.obsoleteFenceEtag]]) {
    requireThat(value === null ? etag === 'null_etag' : typeof etag === 'string' && etag.length > 0 && etag !== 'null_etag', 'repair/etag-precondition-missing');
  }
  const same = (a, b) => fingerprint(a) === fingerprint(b);
  const held = same(state.authoritativeFence, fences.authoritative), retired = same(state.obsoleteFence, fences.obsoleteRetired);
  if (state.authoritativeIndex === null && state.obsoleteAuth.disabled === false) {
    if (state.authoritativeFence === null && state.obsoleteFence === null) return 'before';
    if (held && state.obsoleteFence === null) return 'authoritative-held';
    if (held && same(state.obsoleteFence, fences.obsoleteMaintenance)) return 'both-held';
    if (held && retired) return 'retired';
  }
  if (state.obsoleteAuth.disabled === true && retired) {
    if (held && state.authoritativeIndex === null) return 'disabled';
    if (same(state.authoritativeIndex, index)) {
      if (held) return 'indexed';
      if (state.authoritativeFence === null) return 'reconciled';
    }
  }
  requireThat(false, 'repair/unrecognized-partial-state');
}

// No browser API, UID creation, deletion, password setter, data writer or compensation path.
async function reconcileLegacySlot(manifest, adapter, { resume = false, verifyOnly = false } = {}) {
  const expectedIndex = validateManifest(manifest), fences = expectedFences(manifest);
  let state = await adapter.readState(), phase = classifyState(manifest, state);
  if (verifyOnly) return { phase, manifestFingerprint: fingerprint(manifest), mutations: [] };
  requireThat(resume || phase === 'before', 'repair/resume-required');
  const mutations = [];
  const steps = [
    ['before', 'authoritative-held', 'held-authoritative-uid', () => adapter.compareAndSetFence(manifest.authoritativeUid, null, fences.authoritative, state.authoritativeFenceEtag)],
    ['authoritative-held', 'both-held', 'held-obsolete-uid', () => adapter.compareAndSetFence(manifest.obsoleteUid, null, fences.obsoleteMaintenance, state.obsoleteFenceEtag)],
    ['both-held', 'retired', 'retired-obsolete-uid', () => adapter.compareAndSetFence(manifest.obsoleteUid, fences.obsoleteMaintenance, fences.obsoleteRetired, state.obsoleteFenceEtag)],
    ['retired', 'disabled', 'disabled-obsolete-auth', () => adapter.disableExistingAuth(manifest.obsoleteUid, manifest.obsoleteAuthFingerprint)],
    ['disabled', 'indexed', 'created-authoritative-index', () => adapter.createIndexOnly(manifest.authoritativeUid, expectedIndex, state.indexEtag)],
    ['indexed', 'reconciled', 'released-authoritative-maintenance', () => adapter.compareAndSetFence(manifest.authoritativeUid, fences.authoritative, null, state.authoritativeFenceEtag)]
  ];
  try {
    for (const [before, after, mutation, apply] of steps) {
      if (phase !== before) continue;
      await adapter.recordProgress({ phase: `before-${mutation}`, manifestFingerprint: fingerprint(manifest) });
      state = await adapter.readState();
      requireThat(classifyState(manifest, state) === before, 'repair/precondition-changed');
      await apply();
      mutations.push(mutation);
      state = await adapter.readState();
      requireThat(classifyState(manifest, state) === after, 'repair/mutation-unconfirmed');
      phase = after;
    }
    state = await adapter.readState();
    requireThat(classifyState(manifest, state) === 'reconciled', 'repair/final-verification-failed');
    await adapter.recordProgress({ phase: 'reconciled', manifestFingerprint: fingerprint(manifest) });
    return { phase: 'reconciled', manifestFingerprint: fingerprint(manifest), mutations };
  } catch (error) {
    try { await adapter.recordProgress({ phase: 'verification-required', manifestFingerprint: fingerprint(manifest) }); } catch {}
    throw error;
  }
}
module.exports = { fingerprint, validateManifest, expectedFences, classifyState, reconcileLegacySlot };
