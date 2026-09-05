'use strict';

const { createHash, createHmac } = require('node:crypto');
const OWNER = 'Doomsday126';
const USERNAME = /^[A-Za-z0-9 _-]{1,64}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseEmail = username => username.toLowerCase().replace(/[^a-z0-9]/g, '_');
const collisionKey = username => baseEmail(username.normalize('NFKC'));
const authEmail = (username, version) => `${baseEmail(username)}${version === 1 ? '' : `_v${version}`}@pogotrades.nyc`;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function requireThat(condition, code = 'reset/identity-conflict') { if (!condition) fail(code); }
function exactKeys(value, keys) {
  requireThat(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'reset/invalid-request');
}
function blocked(value) {
  return !object(value) || ['disabled', 'frozen', 'identityFrozen'].some(key => value[key] !== undefined && value[key] !== false) ||
    (value.status !== undefined && value.status !== 'active') || (value.state !== undefined && value.state !== 'active');
}
function providers(user) {
  requireThat(Array.isArray(user.providerData));
  return user.providerData.map(p => [p.providerId, p.uid, p.email || null, p.displayName || null, p.photoURL || null, p.phoneNumber || null])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

// Dependencies expose reads, a durable CAS journal and ONE credential mutation.
function createResetService({ adapter, journal, ownerUid, hmacKey, now = Date.now }) {
  requireThat(UID.test(ownerUid || '') && Buffer.byteLength(hmacKey || '') >= 32, 'reset/configuration');
  async function authorize(context) {
    requireThat(context?.uid && context.appVerified === true, 'reset/unauthenticated');
    requireThat(context.uid === ownerUid && Number.isSafeInteger(context.authTime) &&
      context.authTime * 1000 <= now() + 30000 && now() - context.authTime * 1000 <= 15 * 60 * 1000, 'reset/owner-required');
    const evidence = await adapter.readEvidence();
    requireThat(evidence.admins?.[ownerUid] === true && evidence.users?.[OWNER]?.authUid === ownerUid &&
      evidence.users[OWNER].isAdmin === true && evidence.authIndex?.[ownerUid]?.username === OWNER &&
      !blocked(evidence.users[OWNER]), 'reset/owner-required');
    requireThat(Object.values(evidence.users).filter(user => user?.authUid === ownerUid).length === 1 &&
      Object.values(evidence.authIndex).filter(index => index?.username === OWNER).length === 1, 'reset/owner-required');
    const owner = await adapter.getAuthUser(ownerUid);
    requireThat(owner?.uid === ownerUid && owner.disabled === false && !owner.tenantId, 'reset/owner-required');
    return evidence;
  }
  async function identity(username, evidence) {
    const { users, loginDirectory, authIndex } = evidence;
    requireThat(object(users) && object(loginDirectory) && object(authIndex));
    const user = users[username], directory = loginDirectory[username], uid = user?.authUid;
    requireThat(UID.test(uid || '') && uid !== ownerUid && username !== OWNER);
    const index = authIndex[uid], version = user.authVersion;
    requireThat(!blocked(user) && !blocked(directory) && !blocked(index) && index.username === username &&
      directory.authReady === true && Number.isSafeInteger(version) && version >= 1 &&
      directory.authVersion === version && user.authEmail === authEmail(username, version));
    if (index.authEmail !== undefined) requireThat(index.authEmail === user.authEmail);
    if (index.authVersion !== undefined) requireThat(index.authVersion === version);
    if (directory.authUid !== undefined) requireThat(directory.authUid === uid);
    if (directory.authEmail !== undefined) requireThat(directory.authEmail === user.authEmail);
    const aliases = Object.entries(users).filter(([name, value]) => name === username || value?.authUid === uid ||
      collisionKey(name) === collisionKey(username) || value?.authEmail === user.authEmail);
    requireThat(aliases.length === 1 && aliases[0][0] === username);
    requireThat(Object.entries(authIndex).filter(([, value]) => value?.username === username ||
      (typeof value?.username === 'string' && collisionKey(value.username) === collisionKey(username))).length === 1);
    requireThat(Object.keys(loginDirectory).filter(name => collisionKey(name) === collisionKey(username)).length === 1);
    // Any provider-authority ownership or freeze evidence is out of scope, not repairable here.
    requireThat(await adapter.legacyOnly(uid, username), 'reset/identity-not-legacy');
    const account = await adapter.getAuthUser(uid);
    requireThat(account?.uid === uid && account.email === user.authEmail && account.disabled === false &&
      !account.tenantId && typeof account.metadata?.creationTime === 'string' && Number.isFinite(Date.parse(account.metadata.creationTime)));
    const linked = providers(account);
    requireThat(linked.some(p => p[0] === 'password' && p[1] === user.authEmail), 'reset/legacy-credential-required');
    const emailPattern = new RegExp(`^${baseEmail(username)}(?:_v[1-9][0-9]*)?@pogotrades\\.nyc$`);
    const matches = (await adapter.listAuthIdentities()).filter(a => emailPattern.test(a.email || ''));
    requireThat(matches.length === 1 && matches[0].uid === uid);
    const stable = { username, uid, email: account.email, version, created: account.metadata.creationTime, providers: linked };
    return { username, targetUid: uid, fingerprint: digest(stable), created: stable.created };
  }
  function validate(input) {
    requireThat(['inspect', 'reset', 'status'].includes(input?.action), 'reset/invalid-request');
    const keys = ['action', 'username'];
    if (input.action !== 'inspect') keys.push('requestId', 'targetUid', 'fingerprint');
    if (input.action === 'reset') keys.push('pin');
    exactKeys(input, keys);
    requireThat(typeof input.username === 'string' && USERNAME.test(input.username) && input.username.trim() === input.username, 'reset/invalid-request');
    if (input.action !== 'inspect') requireThat(REQUEST_ID.test(input.requestId) && UID.test(input.targetUid) && HASH.test(input.fingerprint), 'reset/invalid-request');
    if (input.action === 'reset') requireThat(typeof input.pin === 'string' && /^[0-9]{6}$/.test(input.pin), 'reset/invalid-pin');
  }
  const receipt = record => ({ status: record.status, requestId: record.requestId, username: record.username });
  function sameRequest(record, input, fingerprint) {
    requireThat(record.callerUid === ownerUid && record.username === input.username && record.targetUid === input.targetUid &&
      record.identityFingerprint === input.fingerprint && (!fingerprint || record.credentialFingerprint === fingerprint), 'reset/replay-mismatch');
  }
  async function run(context, input) {
    validate(input);
    const evidence = await authorize(context);
    if (input.action === 'inspect') return identity(input.username, evidence);
    const fingerprint = input.action === 'reset' ? createHmac('sha256', hmacKey)
      .update(JSON.stringify([ownerUid, input.requestId, input.username, input.targetUid, input.fingerprint, input.pin])).digest('hex') : null;
    const existing = await journal.get(input.requestId);
    if (existing) { sameRequest(existing, input, fingerprint); return receipt(existing); }
    if (input.action === 'status') return { status: 'not-recorded', requestId: input.requestId, username: input.username };
    const target = await identity(input.username, evidence);
    requireThat(target.targetUid === input.targetUid && target.fingerprint === input.fingerprint, 'reset/stale-identity');
    const record = { requestId: input.requestId, username: input.username, targetUid: target.targetUid,
      callerUid: ownerUid, identityFingerprint: target.fingerprint, credentialFingerprint: fingerprint, status: 'pending', startedAt: now() };
    const reserved = await journal.reserve(record);
    if (!reserved.acquired) { sameRequest(reserved.record, input, fingerprint); return receipt(reserved.record); }
    let mutationStarted = false;
    try {
      const fresh = await identity(input.username, await authorize(context));
      requireThat(fresh.fingerprint === target.fingerprint, 'reset/stale-identity');
      mutationStarted = true;
      await adapter.updatePassword(target.targetUid, input.pin);
      const after = await identity(input.username, await adapter.readEvidence());
      requireThat(after.fingerprint === target.fingerprint, 'reset/postcondition-failed');
      await journal.finish(record.requestId, 'completed', now());
      return receipt({ ...record, status: 'completed' });
    } catch {
      const status = mutationStarted ? 'ambiguous' : 'aborted';
      try { await journal.finish(record.requestId, status, now()); } catch { /* Pending remains locked. */ }
      return receipt({ ...record, status });
    }
  }
  return Object.freeze({ run });
}
module.exports = { createResetService, authEmail, fail };
