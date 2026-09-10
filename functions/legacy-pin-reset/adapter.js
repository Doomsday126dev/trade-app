'use strict';
const { fail } = require('./reset');
const { createHash } = require('node:crypto');
const canonical = value => value && typeof value === 'object' ?
  Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const { ROOT } = require('./identity-fence');
const FIELDS = ['authUid', 'authEmail', 'authVersion', 'username', 'authReady', 'isAdmin', 'disabled', 'frozen', 'identityFrozen', 'status', 'state'];
const pick = value => Object.fromEntries(FIELDS.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
function createAdapter({ database, auth, firestore, updatePassword }) {
  return Object.freeze({
    async readEvidence() {
      const result = {};
      for (const path of ['users', 'loginDirectory', 'authIndex', 'admins']) {
        const value = (await database.ref(path).get()).val();
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1000) fail('reset/evidence-unavailable');
        result[path] = path === 'admins' ? value : Object.fromEntries(Object.entries(value).map(([key, record]) => [key, pick(record)]));
      }
      return result;
    },
    getAuthUser: uid => auth.getUser(uid),
    readIdentityFence: async uid => (await database.ref(`${ROOT}/${uid}`).get()).val(),
    async listAuthIdentities() {
      const page = await auth.listUsers(1000);
      if (page.pageToken) fail('reset/identity-inventory-too-large');
      return page.users.map(({ uid, email, disabled }) => ({ uid, email, disabled }));
    },
    async legacyOnly(uid, username) {
      const handleKey = `v1_${Buffer.from(username.normalize('NFKC').toLowerCase(), 'utf8').toString('hex')}`;
      const account = await firestore.doc(`accounts/${uid}`).get();
      const handle = await firestore.doc(`trainerHandles/${handleKey}`).get();
      const conflicts = await firestore.collection(`identityConflicts/${uid}/events`).limit(1).get();
      return !account.exists && !handle.exists && conflicts.empty;
    },
    async legacyResetEvidence(uid, username, version) {
      const normalized = username.normalize('NFKC').trim().toLowerCase();
      const handleKey = `v1_${Buffer.from(normalized, 'utf8').toString('hex')}`;
      const account = await firestore.doc(`accounts/${uid}`).get();
      const handle = await firestore.doc(`trainerHandles/${handleKey}`).get();
      const conflicts = await firestore.collection(`identityConflicts/${uid}/events`).limit(1).get();
      if (!conflicts.empty) return null;
      if (!account.exists && !handle.exists) return fingerprint({ kind: 'legacy', uid, username, version });
      if (!account.exists || !handle.exists) return null;
      const a = account.data(), h = handle.data();
      const healthy = value => value && typeof value === 'object' && !Array.isArray(value) &&
        ['disabled', 'frozen', 'identityFrozen'].every(key => value[key] === undefined || value[key] === false);
      const positive = value => Number.isSafeInteger(value) && value > 0;
      if (!healthy(a) || !healthy(h) || a.schemaVersion !== 1 || h.schemaVersion !== 1 ||
          a.uid !== uid || h.uid !== uid || a.canonicalTrainerName !== username || h.canonicalTrainerName !== username ||
          a.normalizedTrainerName !== normalized || h.normalizedTrainerName !== normalized || a.handleKey !== handleKey ||
          (a.identityKind !== undefined && a.identityKind !== 'legacy_migrated') ||
          (a.legacyAccessConfigured !== undefined && a.legacyAccessConfigured !== true) ||
          a.legacyUsername !== username || a.legacyAuthVersion !== version || a.status !== 'active' || h.state !== 'active' ||
          !positive(a.revision) || !positive(h.revision) || !positive(a.createdAt) || !positive(h.claimedAt) ||
          !positive(a.updatedAt) || a.updatedAt < a.createdAt || !positive(h.updatedAt) || h.updatedAt < h.claimedAt) return null;
      // Bind the exact read evidence to inspection, reservation and postcondition.
      // This is reset eligibility only; obsolete-slot/reconciliation legacyOnly stays strict.
      return fingerprint({ account: a, handle: h });
    },
    async retiredSlotIsUnowned(uid, currentUid, username) {
      for (const root of ['accountSync', 'accounts', 'trainerShares', 'userPreferences', 'shareVisibility', 'shareAccess']) {
        if ((await database.ref(`${root}/${uid}`).get()).val() !== null) return false;
      }
      const oldMemberships = (await database.ref(`userCommunities/${uid}`).get()).val();
      const currentMemberships = (await database.ref(`userCommunities/${currentUid}`).get()).val();
      const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      if (oldMemberships !== null && (!object(oldMemberships) || Object.keys(oldMemberships).length > 1000)) return false;
      for (const [id, record] of Object.entries(oldMemberships || {})) {
        const current = currentMemberships?.[id];
        if (!object(record) || Object.keys(record).sort().join(',') !== 'joinedAt,role,username' ||
            record.username !== username || record.role !== 'member' || !Number.isSafeInteger(record.joinedAt) || record.joinedAt < 0 ||
            !object(current) || Object.keys(current).sort().join(',') !== 'joinedAt,role,username' ||
            current.username !== record.username || current.role !== record.role || current.joinedAt !== record.joinedAt) return false;
      }
      // Historical member-only duplicates may remain, but no distinct membership or authority.
      const communities = (await database.ref('communities').get()).val();
      if (communities !== null && (!object(communities) || Object.keys(communities).length > 1000)) return false;
      for (const [id, community] of Object.entries(communities || {})) {
        if (!object(community) || community.ownerId === uid || (community.admins?.[uid] !== undefined && community.admins[uid] !== false)) return false;
        const member = community.members?.[uid];
        if (member !== undefined && member !== false && member !== true) return false;
        if (member === true && (!oldMemberships?.[id] || community.members?.[currentUid] !== true || community.memberUsernames?.[username] !== true)) return false;
      }
      for (const id of Object.keys(oldMemberships || {})) if (communities?.[id]?.members?.[uid] !== true) return false;
      for (const path of [`accounts/${uid}/providers`, `identityMigrations/${uid}/operations`, `operationRequests/${uid}/requests`]) {
        if (!(await firestore.collection(path).limit(1).get()).empty) return false;
      }
      for (const root of ['accounts', 'identityMigrations', 'identityConflicts', 'operationRequests']) {
        if ((await firestore.doc(`${root}/${uid}`).get()).exists) return false;
      }
      for (const root of ['providerSubjects', 'trainerHandles']) {
        if (!(await firestore.collection(root).where('uid', '==', uid).limit(1).get()).empty) return false;
      }
      return true;
    },
    // Do not accept a generic updates object, create a user, or touch app data.
    updatePassword
  });
}
module.exports = { createAdapter };
