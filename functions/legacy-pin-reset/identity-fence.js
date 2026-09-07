'use strict';
const CONTRACT = 'immutable-bindings-retired-uids-v1';
const ROOT = 'legacyIdentityFences';
const KEYS = ['schemaVersion', 'uid', 'authoritativeUid', 'obsoleteUid', 'username', 'authVersion', 'obsoleteVersion',
  'authoritativeCreatedAt', 'obsoleteCreatedAt', 'createdAt', 'manifestFingerprint', 'reason', 'state'];
function recordFor(manifest, uid, state, manifestFingerprint) {
  return { schemaVersion: 1, uid, authoritativeUid: manifest.authoritativeUid, obsoleteUid: manifest.obsoleteUid,
    username: manifest.username, authVersion: manifest.authVersion, obsoleteVersion: manifest.obsoleteVersion,
    authoritativeCreatedAt: manifest.authoritativeCreatedAt, obsoleteCreatedAt: manifest.obsoleteCreatedAt,
    createdAt: manifest.createdAt, manifestFingerprint, reason: 'obsolete-legacy-credential', state };
}
function isRetiredFence(record, expected) {
  return record !== null && typeof record === 'object' && !Array.isArray(record) && Object.keys(record).length === KEYS.length &&
    KEYS.every(key => Object.hasOwn(record, key)) && record.schemaVersion === 1 && record.state === 'retired' &&
    record.reason === 'obsolete-legacy-credential' && record.uid === expected.obsoleteUid &&
    ['authoritativeUid', 'obsoleteUid', 'username', 'authVersion', 'obsoleteVersion', 'authoritativeCreatedAt', 'obsoleteCreatedAt'].every(key => record[key] === expected[key]) &&
    Number.isSafeInteger(record.createdAt) && record.createdAt > 0 && /^[a-f0-9]{64}$/.test(record.manifestFingerprint || '');
}
module.exports = { CONTRACT, ROOT, recordFor, isRetiredFence };
