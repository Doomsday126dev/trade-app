'use strict';
// Bounded owner-operated deployment support. Never accepts an arbitrary user/UID.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const plan = require('../functions/legacy-pin-reset/deployment-plan.json');
const PROJECT = 'trade-list-a4297', DB = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const ROOT = path.resolve(__dirname, '../.local/legacy-pin-reset');
const SYNTHETIC = 'PINResetSynthetic20260905';
const SDK = plan.identityBoundary.legacySdkAccount, RUNTIME = plan.runtimeServiceAccount;
const gc = (...args) => execFileSync('/opt/homebrew/bin/gcloud', [...args, '--quiet'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const save = (name, value) => { fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(ROOT, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); };
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
let operator;
async function api(url, method = 'GET', body, token = operator, allow = [], extraHeaders = {}) {
  const r = await fetch(url, { method, redirect: 'error', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(token && token === operator ? { 'X-Goog-User-Project': PROJECT } : {}), 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const value = await r.json().catch(() => null);
  if (!r.ok && !allow.includes(r.status)) throw new Error(`${method} ${new URL(url).hostname} returned ${r.status}`);
  return { status: r.status, value };
}
async function role(id, permissions) {
  const url = `https://iam.googleapis.com/v1/projects/${PROJECT}/roles/${id}`;
  const old = await api(url, 'GET', undefined, operator, [404]);
  if (old.status === 404) await api(`https://iam.googleapis.com/v1/projects/${PROJECT}/roles`, 'POST', { roleId: id, role: { title: id, stage: 'GA', includedPermissions: permissions } });
  else assert.deepEqual([...old.value.includedPermissions].sort(), [...permissions].sort());
  return `projects/${PROJECT}/roles/${id}`;
}
function bind(policy, roleName, email, condition) {
  policy.bindings ||= [];
  let b = policy.bindings.find(x => x.role === roleName && JSON.stringify(x.condition || null) === JSON.stringify(condition || null));
  if (!b) { b = { role: roleName, members: [], ...(condition ? { condition } : {}) }; policy.bindings.push(b); }
  if (!b.members.includes(`serviceAccount:${email}`)) b.members.push(`serviceAccount:${email}`);
}
async function provision() {
  const base = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}`;
  const current = (await api(`${base}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } })).value;
  save('iam-before.json', current);
  const roles = {
    runtime: await role('legacyPinResetRuntime', plan.runtimePermissions.project),
    reader: await role('legacyIdentityReadOnly', plan.identityBoundary.legacySdkReplacementPermissions),
    identity: await role('legacyPinResetIdentityReader', plan.runtimePermissions.identityDatabaseReadOnly.permissions),
    journal: await role('legacyPinResetJournal', plan.runtimePermissions.journal.permissions)
  };
  const service = await api(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${RUNTIME}`, 'GET', undefined, operator, [404]);
  if (service.status === 404) await api(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`, 'POST', { accountId: 'legacy-pin-reset-runtime', serviceAccount: { displayName: 'Owner-only same-UID PIN reset runtime' } });
  for (const b of current.bindings || []) if (plan.identityBoundary.legacySdkRemoveProjectRoles.includes(b.role)) b.members = b.members.filter(x => x !== `serviceAccount:${SDK}`);
  current.bindings = current.bindings.filter(x => x.members.length);
  bind(current, roles.reader, SDK); bind(current, roles.runtime, RUNTIME);
  bind(current, roles.identity, RUNTIME, { title: 'reset-exact-identity-database', expression: `resource.name == 'projects/${PROJECT}/databases/phase-e-identity' && resource.type == 'firestore.googleapis.com/Database'` });
  bind(current, 'roles/firebaseappcheck.tokenVerifier', RUNTIME);
  current.version = 3;
  await api(`${base}:setIamPolicy`, 'POST', { policy: current });
  const bucket = plan.runtimePermissions.journal.bucket;
  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}`;
  const existing = await api(bucketUrl, 'GET', undefined, operator, [404]);
  if (existing.status === 404) await api(`https://storage.googleapis.com/storage/v1/b?project=${PROJECT}`, 'POST', { name: bucket, location: 'US-CENTRAL1', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' }, versioning: { enabled: true } });
  else { assert.equal(existing.value.versioning?.enabled, true); assert.equal(existing.value.iamConfiguration?.publicAccessPrevention, 'enforced'); assert.equal(existing.value.iamConfiguration?.uniformBucketLevelAccess?.enabled, true); }
  const bucketPolicy = (await api(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`)).value;
  bind(bucketPolicy, roles.journal, RUNTIME, { title: 'reset-exact-ledger-object', expression: `resource.name == 'projects/_/buckets/${bucket}/objects/${plan.runtimePermissions.journal.object}'` });
  bucketPolicy.version = 3; await api(`${bucketUrl}/iam`, 'PUT', bucketPolicy);
  const name = encodeURIComponent(plan.runtimePermissions.journal.object);
  await api(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${name}&ifGenerationMatch=0`, 'POST', { schemaVersion: 1, records: [] }, operator, [412]);
  const secret = `projects/${PROJECT}/secrets/legacy-pin-reset-hmac`, secretUrl = `https://secretmanager.googleapis.com/v1/${secret}`;
  const found = await api(secretUrl, 'GET', undefined, operator, [404]);
  if (found.status === 404) {
    await api(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?secretId=legacy-pin-reset-hmac`, 'POST', { replication: { automatic: {} } });
    await api(`${secretUrl}:addVersion`, 'POST', { payload: { data: Buffer.from(crypto.randomBytes(48).toString('base64')).toString('base64') } });
  }
  const secretPolicy = (await api(`${secretUrl}:getIamPolicy`)).value;
  bind(secretPolicy, 'roles/secretmanager.secretAccessor', RUNTIME);
  await api(`${secretUrl}:setIamPolicy`, 'POST', { policy: secretPolicy });
  const owner = (await api(`${DB}/users/Doomsday126/authUid.json`)).value;
  assert.match(owner, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal((await api(`${DB}/admins/${owner}.json`)).value, true);
  assert.equal((await api(`${DB}/authIndex/${owner}/username.json`)).value, 'Doomsday126');
  save('runtime-config.json', { LEGACY_PIN_RESET_ENABLED: 'false', LEGACY_IDENTITY_BOUNDARY: 'immutable-bindings-v1', LEGACY_PIN_RESET_OWNER_UID: owner });
  save('provisioned.json', { at: new Date().toISOString(), project: PROJECT, roles, runtime: RUNTIME, secret, bucket });
  console.log('Provisioned dedicated reset resources; retired SDK principal is read-only. Backend remains disabled.');
}
async function synthetic() {
  assert.equal((await api(`${DB}/users/${SYNTHETIC}.json`)).value, null, 'Synthetic username must be unused');
  assert.equal((await api(`${DB}/loginDirectory/${SYNTHETIC}.json`)).value, null, 'Synthetic directory must be unused');
  const existing = fs.existsSync(path.join(ROOT, 'synthetic-private.json')) ? read('synthetic-private.json') : null;
  const uid = existing?.uid || `synthetic-pin-reset-${crypto.randomUUID()}`;
  const oldPin = String(crypto.randomInt(1000000)).padStart(6, '0');
  let newPin; do { newPin = String(crypto.randomInt(1000000)).padStart(6, '0'); } while (newPin === oldPin);
  const target = existing || { username: SYNTHETIC, uid, email: `${SYNTHETIC.toLowerCase()}@pogotrades.nyc`, oldPin, newPin };
  assert.equal(target.username, SYNTHETIC);
  assert.match(uid, /^synthetic-pin-reset-[a-f0-9-]{36}$/);
  save('synthetic-private.json', target);
  const prior = await api(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, 'POST', { localId: [uid] });
  assert.equal(prior.value.users?.length || 0, 0, 'Existing synthetic Auth state requires explicit reconciliation, never recreation');
  await api(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, 'POST', { localId: uid, email: target.email, password: target.oldPin, displayName: 'SYNTHETIC PIN RESET TEST ONLY' });
  const now = Date.now();
  const records = {
    [`users/${SYNTHETIC}`]: { authUid: uid, authEmail: target.email, authVersion: 1, joined: now, lastSeen: now, isAdmin: false, isOwner: false, bio: 'SYNTHETIC AUTH/RECOVERY TEST. Not a real trainer.' },
    [`authIndex/${uid}`]: { username: SYNTHETIC, authVersion: 1 },
    [`loginDirectory/${SYNTHETIC}`]: { authReady: true, authVersion: 1, joined: now }
  };
  for(const [key, value] of Object.entries(records))await api(`${DB}/${key}.json`, 'PUT', value, operator, [], { 'if-match': 'null_etag' });
  save('synthetic-baseline.json', await snapshot(target));
  console.log(`Created isolated ${SYNTHETIC}; no ordinary-user records changed. Credentials are private.`);
}
async function snapshot(t) {
  const data = {};
  for (const p of [`users/${t.username}`, `authIndex/${t.uid}`, `loginDirectory/${t.username}`, `accountSync/${t.uid}`, `wishlist/${t.username}`, `have/${t.username}`, `publicShares/${t.username}`]) data[p] = (await api(`${DB}/${p}.json`)).value;
  const r = await api(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, 'POST', { localId: [t.uid] });
  const u = r.value.users?.[0]; assert.equal(u?.localId, t.uid);
  return { data, auth: { uid: u.localId, email: u.email, createdAt: u.createdAt, providerUserInfo: u.providerUserInfo } };
}
function validateCredentialProbe(results, uid) {
  assert.equal(results.length, 2);
  const [oldPin, newPin] = results;
  assert.equal(oldPin.name, 'old'); assert.equal(newPin.name, 'new');
  assert.equal(oldPin.status, 400, 'Old PIN must reach credential verification, not an API/network denial');
  assert.ok(['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD'].includes(oldPin.error), 'Expected a credential rejection');
  assert.equal(newPin.status, 200, 'New PIN must authenticate');
  assert.equal(newPin.uid, uid, 'New PIN must reach the original UID');
}
async function credentials() {
  const t = read('synthetic-private.json'); assert.equal(t.username, SYNTHETIC); assert.match(t.uid, /^synthetic-pin-reset-/);
  // Exercise the referrer-restricted Web API from its real origin. Never forge
  // a Referer header, relax the API key, or persist an authenticated profile.
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto('https://doomsday126dev.github.io/trade-app/', { waitUntil: 'domcontentloaded' });
    assert.equal(new URL(page.url()).origin, 'https://doomsday126dev.github.io');
    assert.equal(new URL(page.url()).pathname, '/trade-app/');
    const results = await page.evaluate(async target => {
      const config = window.__POGO_FIREBASE_CONFIG;
      if (config?.projectId !== 'trade-list-a4297') throw new Error('Unexpected Firebase project');
      const results = [];
      for (const [name, password] of [['old', target.oldPin], ['new', target.newPin]]) {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: target.email, password, returnSecureToken: true }),
          signal: AbortSignal.timeout(30000)
        });
        const value = await response.json();
        results.push({ name, status: response.status, uid: value.localId || null, error: value.error?.message || null });
      }
      return results;
    }, t);
    validateCredentialProbe(results, t.uid);
  } finally { await browser.close(); }
  assert.deepEqual(await snapshot(t), read('synthetic-baseline.json'));
  save('credential-proof.json', { at: new Date().toISOString(), username: SYNTHETIC, oldPinRejected: true, newPinAccepted: true, sameUid: true, canonicalAndOwnershipUnchanged: true });
  console.log('Synthetic proof passed: old PIN rejected, new PIN accepted, UID/incarnation/ownership/canonical data unchanged.');
}
async function main() {
  assert.ok(['provision', 'synthetic', 'credentials'].includes(process.argv[2]), 'Use only provision, synthetic or credentials');
  operator = gc('auth', 'print-access-token').trim();
  await ({ provision, synthetic, credentials })[process.argv[2]]();
}
if (require.main === module) main().catch(error => { console.error(`Bounded reset operation stopped: ${error.message}`); process.exitCode = 1; });
module.exports = { validateCredentialProbe };
