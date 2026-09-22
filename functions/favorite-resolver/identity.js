'use strict';
const { key, fail, LIMITS } = require('./contract');
// These are scalar identity reads only. Established reciprocal bindings cannot
// change under the reviewed immutable-binding Rules/IAM boundary. A new binding
// is accepted only after both sides exist. Any fence (hold or retired) rejects it.
// The Favorite create/re-add Rules recheck the exact tuple and both fences at
// commit time; a response is not a write authorization or a private-list grant.
function createIdentityReader(database) {
  const scalar = async path => (await database.ref(path).get()).val();
  return Object.freeze({
    callerHandle: uid => scalar(`authIndex/${uid}/username`),
    targetUid: handle => scalar(`users/${handle}/authUid`),
    reverseHandle: uid => scalar(`authIndex/${uid}/username`),
    // Return existence only; malformed and partial holds must also fail closed.
    isFenced: async uid => (await database.ref(`legacyIdentityFences/${uid}`).get()).exists()
  });
}
function createIdentityResolver(reader) {
  async function bound(uid, handle) {
    if (!key(uid) || !key(handle, 64)) return false;
    return await reader.targetUid(handle) === uid && await reader.reverseHandle(uid) === handle && !await reader.isFenced(uid);
  }
  return async function resolve(uid, handles, current = () => true) {
    const check = () => { if (!current()) fail('favorite/unavailable'); };
    check(); const caller = await reader.callerHandle(uid); check();
    if (!await bound(uid, caller)) fail('favorite/caller-unavailable');
    check(); const results = new Array(handles.length); let next = 0;
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(LIMITS.targetConcurrency, handles.length) }, async () => {
      while (next < handles.length) {
        const index = next++, handle = handles[index]; check();
        const targetUid = await reader.targetUid(handle); check();
        let valid = key(targetUid) && targetUid !== uid;
        if (valid) { valid = await reader.reverseHandle(targetUid) === handle && !await reader.isFenced(targetUid); check(); }
        results[index] = valid ? { handle, status: 'resolved', targetUid, canonicalHandle: handle } : { handle, status: 'unavailable' };
      }
    }));
    const rejected = outcomes.find(outcome => outcome.status === 'rejected'); if (rejected) throw rejected.reason;
    // A maintenance hold which starts during the batch must not admit its caller.
    check(); if (!await bound(uid, caller)) fail('favorite/caller-unavailable'); check();
    return results;
  };
}
module.exports = { createIdentityReader, createIdentityResolver };
