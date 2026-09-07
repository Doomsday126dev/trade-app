'use strict';
const { createProductionReads, PROJECT } = require('./lib/legacy-slot-reconciliation-production.cjs');
const { readIdentityInventory, UID_ROOTS, projectAuth } = require('./lib/legacy-slot-reconciliation-evidence.cjs');
const { fingerprint } = require('./lib/legacy-slot-reconciliation.cjs');
const { privateFile } = require('./legacy-slot-reconciliation.cjs');
const { authEmail } = require('../functions/legacy-pin-reset/reset');
const { createAdapter } = require('../functions/legacy-pin-reset/adapter');
const { ROOT, isRetiredFence } = require('../functions/legacy-pin-reset/identity-fence');
const CLASSES = ['HEALTHY', 'SAFE STALE CREDENTIAL', 'MISSING RECIPROCAL INDEX', 'AMBIGUOUS AUTHORITY', 'PROVIDER / CANONICAL REVIEW', 'OTHER CONCRETE ISSUE'];
const normalized = name => name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '_');
const validUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const active = value => object(value) && ['disabled', 'frozen', 'identityFrozen'].every(k => value[k] === undefined || value[k] === false) &&
  ['state', 'status'].every(k => value[k] === undefined || value[k] === 'active');
function chooseClass({ ambiguous, providerReview, issues, missingIndex, unsafeStale, actionableStale }) {
  if (ambiguous) return 'AMBIGUOUS AUTHORITY';
  if (providerReview || unsafeStale) return 'PROVIDER / CANONICAL REVIEW';
  if (issues) return 'OTHER CONCRETE ISSUE';
  if (missingIndex) return 'MISSING RECIPROCAL INDEX';
  return actionableStale ? 'SAFE STALE CREDENTIAL' : 'HEALTHY';
}
async function audit(reads = createProductionReads()) {
  const startedAt = new Date().toISOString(), inventory = await readIdentityInventory(reads.readDatabase), page = await reads.auth.listUsers(1000);
  if (page.pageToken || page.users.length > 1000) throw Object.assign(new Error('audit/incomplete-auth-inventory'), { code: 'audit/incomplete-auth-inventory' });
  const authByUid = new Map(page.users.map(account => [account.uid, account]));
  const adapter = createAdapter({ auth: reads.auth, firestore: reads.firestore, database: { ref: path => ({ get: async () => {
    const result = await reads.readDatabase(path); return { val: () => result.value };
  } }) } });
  const accounts = [], claimedAuth = new Set();
  for (const [username, user] of Object.entries(inventory.users)) {
    const directory = inventory.loginDirectory[username];
    if (!user.authUid && !user.authEmail && user.authVersion === undefined && directory?.authReady !== true) continue;
    const reasons = [], uid = user.authUid, version = user.authVersion;
    let ambiguous = false, providerReview = false, issues = false, unsafeStale = false, actionableStale = false, missingIndex = false;
    const record = { username, authoritativeUid: uid || null, authVersion: version ?? null, slots: [], reasons, evidenceComplete: true };
    try {
      const index = inventory.authIndex[uid], current = authByUid.get(uid), base = normalized(username);
      const pattern = new RegExp(`^${base}(?:_v[1-9][0-9]*)?@pogotrades\\.nyc$`, 'i');
      const slots = page.users.filter(account => pattern.test(account.email || ''));
      slots.forEach(account => claimedAuth.add(account.uid));
      const aliases = Object.entries(inventory.users).filter(([name, value]) => normalized(name) === base || validUid(uid) && value?.authUid === uid);
      const indexes = Object.entries(inventory.authIndex).filter(([id, value]) => typeof value?.username === 'string' && normalized(value.username) === base);
      if (aliases.length !== 1 || Object.keys(inventory.loginDirectory).filter(name => normalized(name) === base).length > 1 ||
          indexes.some(([id, value]) => id !== uid || value.username !== username)) { ambiguous = true; reasons.push('conflicting-handle-or-uid-claim'); }
      if (index !== undefined && index?.username !== username) { ambiguous = true; reasons.push('reciprocal-name-disagreement'); }
      missingIndex = index === undefined;
      if (missingIndex) reasons.push('missing-reciprocal-index');
      if (!validUid(uid) || !Number.isSafeInteger(version) || version < 1 || !/^[A-Za-z0-9 _-]{1,64}$/.test(username)) { issues = true; reasons.push('invalid-legacy-identity-shape'); }
      if (!active(user) || !active(directory) || index !== undefined && !active(index) || current?.disabled === true) { issues = true; reasons.push('disabled-frozen-or-inactive-authority'); }
      if (!current || current.email !== user.authEmail || user.authEmail !== authEmail(username, version)) { issues = true; reasons.push('auth-credential-or-version-disagreement'); }
      if (current && !Number.isFinite(Date.parse(current.metadata?.creationTime))) { issues = true; reasons.push('auth-creation-evidence-missing'); }
      if (directory?.authReady !== true || directory?.authVersion !== version || directory.authUid !== undefined && directory.authUid !== uid ||
          directory.authEmail !== undefined && directory.authEmail !== user.authEmail || index?.authVersion !== undefined && index.authVersion !== version ||
          index?.authEmail !== undefined && index.authEmail !== user.authEmail) { ambiguous = true; reasons.push('directory-or-index-slot-disagreement'); }
      if (validUid(uid)) {
        if (!await adapter.legacyOnly(uid, username)) { providerReview = true; reasons.push('current-firestore-authority'); }
        for (const root of ['identityMigrations', 'identityConflicts', 'operationRequests']) {
          if ((await reads.firestore.doc(`${root}/${uid}`).get()).exists) { providerReview = true; reasons.push(`current-${root}-authority`); }
        }
        for (const root of ['providerSubjects', 'trainerHandles']) {
          if (!(await reads.firestore.collection(root).where('uid', '==', uid).limit(1).get()).empty) { providerReview = true; reasons.push(`current-${root}-authority`); }
        }
        for (const path of [`accounts/${uid}/providers`, `identityMigrations/${uid}/operations`, `operationRequests/${uid}/requests`]) {
          if (!(await reads.firestore.collection(path).limit(1).get()).empty) { providerReview = true; reasons.push('current-provider-or-migration-subcollection'); }
        }
        const roots = {};
        for (const root of UID_ROOTS) {
          const value = (await reads.readDatabase(`${root}/${uid}`)).value;
          roots[root] = { exists: value !== null, fingerprint: fingerprint(value) };
          if (root === 'accounts' && value !== null) { providerReview = true; reasons.push('current-rtdb-provider-authority'); }
        }
        record.currentOwnership = roots;
        const hold = (await reads.readDatabase(`${ROOT}/${uid}`)).value;
        if (hold !== null) { issues = true; reasons.push('current-uid-fenced'); }
      }
      if (current && !current.providerData?.some(p => p.providerId === 'password' && p.uid === current.email)) { providerReview = true; reasons.push('current-provider-only-credential'); }
      for (const slot of slots) {
        const slotVersion = slot.email === authEmail(username, 1) ? 1 : Number(/_v([1-9][0-9]*)@pogotrades\.nyc$/.exec(slot.email)?.[1]);
        const detail = { uid: slot.uid, version: Number.isSafeInteger(slotVersion) ? slotVersion : null, disabled: slot.disabled,
          providerIds: slot.providerData.map(p => p.providerId).sort(), authFingerprint: fingerprint(projectAuth(slot)), current: slot.uid === uid };
        record.slots.push(detail);
        if (slot.uid === uid) continue;
        if (!Number.isSafeInteger(slotVersion) || slotVersion >= version || !current || !Number.isFinite(Date.parse(slot.metadata.creationTime)) ||
            !Number.isFinite(Date.parse(current.metadata.creationTime)) || Date.parse(slot.metadata.creationTime) > Date.parse(current.metadata.creationTime)) {
          ambiguous = true; reasons.push('nonhistorical-competing-credential'); continue;
        }
        const mapped = Object.values(inventory.users).some(value => value?.authUid === slot.uid || value?.authEmail === slot.email) ||
          Object.values(inventory.loginDirectory).some(value => value?.authUid === slot.uid || value?.authEmail === slot.email) ||
          Object.hasOwn(inventory.authIndex, slot.uid) || inventory.admins[slot.uid] === true;
        if (mapped) { ambiguous = true; reasons.push('obsolete-slot-retains-authority'); continue; }
        const passwordOnly = slot.providerData.length === 1 && slot.providerData[0].providerId === 'password' && slot.providerData[0].uid === slot.email &&
          !slot.tenantId && !slot.phoneNumber && !Object.keys(slot.customClaims || {}).length && !(slot.multiFactor?.enrolledFactors || []).length;
        if (!passwordOnly || !await adapter.legacyOnly(slot.uid, username)) { providerReview = true; reasons.push('obsolete-provider-authority'); continue; }
        detail.unowned = validUid(uid) && await adapter.retiredSlotIsUnowned(slot.uid, uid, username);
        if (!detail.unowned) { unsafeStale = true; reasons.push('obsolete-unique-state-or-authority'); continue; }
        const fence = (await reads.readDatabase(`${ROOT}/${slot.uid}`)).value;
        detail.qualifiedRetirement = slot.disabled === true && isRetiredFence(fence, { authoritativeUid: uid, obsoleteUid: slot.uid, username,
          authVersion: version, obsoleteVersion: slotVersion, authoritativeCreatedAt: Date.parse(current.metadata.creationTime), obsoleteCreatedAt: Date.parse(slot.metadata.creationTime) });
        if (!detail.qualifiedRetirement) { actionableStale = true; reasons.push(slot.disabled ? 'unfenced-disabled-credential' : 'unfenced-enabled-credential'); }
        if (fence !== null && !detail.qualifiedRetirement) { issues = true; reasons.push('unfinished-or-mismatched-retirement'); }
      }
      record.identityFingerprint = fingerprint({ user, directory: directory || null, index: index || null, slots: record.slots });
    } catch (error) {
      issues = true; record.evidenceComplete = false; reasons.push(error.code?.startsWith('repair/') ? error.code : 'read-evidence-unavailable');
    }
    record.classification = chooseClass({ ambiguous, providerReview, issues, missingIndex, unsafeStale, actionableStale });
    record.fenceWouldHelp = actionableStale && !ambiguous && !providerReview && !unsafeStale;
    record.repairRequiresNewExplicitApproval = true;
    record.urgentReview = (ambiguous || unsafeStale) && record.slots.filter(slot => !slot.disabled).length > 1;
    accounts.push(record);
  }
  const orphanIndexes = Object.entries(inventory.authIndex).filter(([uid, index]) => !object(index) ||
    typeof index.username !== 'string' || inventory.users[index.username]?.authUid !== uid).map(([uid, index]) => ({ uid, username: index?.username || null, classification: 'AMBIGUOUS AUTHORITY' }));
  const unclaimedLegacyAuth = page.users.filter(account => /@pogotrades\.nyc$/i.test(account.email || '') && !claimedAuth.has(account.uid))
    .map(account => ({ uid: account.uid, email: account.email, disabled: account.disabled, providerIds: account.providerData.map(p => p.providerId) }));
  const counts = Object.fromEntries(CLASSES.map(name => [name, accounts.filter(account => account.classification === name).length]));
  return { schemaVersion: 1, projectId: PROJECT, startedAt, completedAt: new Date().toISOString(), readOnly: true, mutations: 0,
    crossServiceAtomicSnapshot: false, complete: accounts.every(account => account.evidenceComplete),
    summary: { establishedAccounts: accounts.length, authAccounts: page.users.length, counts, orphanIndexes: orphanIndexes.length,
      unclaimedLegacyAuth: unclaimedLegacyAuth.length, urgentReview: accounts.filter(account => account.urgentReview).length,
      incompleteEvidence: accounts.filter(account => !account.evidenceComplete).length }, accounts, orphanIndexes, unclaimedLegacyAuth };
}
if (require.main === module) {
  const output = process.argv[2];
  if (process.argv.length !== 3 || !require('node:path').isAbsolute(output || '') || !output.endsWith('.private.json')) {
    console.error('audit/absolute-private-output-required'); process.exitCode = 1;
  } else audit().then(result => { privateFile(output, result); console.log(JSON.stringify({ complete: result.complete, ...result.summary })); })
    .catch(error => { console.error(error.code || 'audit/read-failed'); process.exitCode = 1; });
}
module.exports = { CLASSES, chooseClass, audit };
