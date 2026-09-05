'use strict';
const { fail } = require('./reset');
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
    async listAuthIdentities() {
      const page = await auth.listUsers(1000);
      if (page.pageToken) fail('reset/identity-inventory-too-large');
      return page.users.map(({ uid, email }) => ({ uid, email }));
    },
    async legacyOnly(uid, username) {
      const handleKey = `v1_${Buffer.from(username.normalize('NFKC').toLowerCase(), 'utf8').toString('hex')}`;
      const account = await firestore.doc(`accounts/${uid}`).get();
      const handle = await firestore.doc(`trainerHandles/${handleKey}`).get();
      const conflicts = await firestore.collection(`identityConflicts/${uid}/events`).limit(1).get();
      return !account.exists && !handle.exists && conflicts.empty;
    },
    // Do not accept a generic updates object, create a user, or touch app data.
    updatePassword
  });
}
module.exports = { createAdapter };
