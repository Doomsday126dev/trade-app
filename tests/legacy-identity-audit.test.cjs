'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audit, CLASSES } = require('../scripts/legacy-identity-audit.cjs');
function fixture() {
  const data = { users: {}, authIndex: {}, loginDirectory: {}, admins: {} }, users = [];
  for (const [name, uid, version] of [['Healthy', 'healthy', 1], ['Stale', 'stale', 3], ['Missing', 'missing', 1], ['Ambiguous', 'ambiguous', 1], ['Provider', 'provider', 1], ['Issue', 'issue', 1]]) {
    const email = `${name.toLowerCase()}${version === 1 ? '' : `_v${version}`}@pogotrades.nyc`;
    data.users[name] = { authUid: uid, authEmail: email, authVersion: version };
    data.loginDirectory[name] = { authReady: true, authVersion: version };
    if (name !== 'Missing') data.authIndex[uid] = { username: name, authEmail: email, authVersion: version };
    users.push({ uid, email, disabled: name === 'Issue', metadata: { creationTime: '2026-01-03T00:00:00Z' }, providerData: [{ providerId: 'password', uid: email }] });
  }
  data.authIndex.conflict = { username: 'Ambiguous' };
  users.push({ uid: 'stale-old', email: 'stale_v2@pogotrades.nyc', disabled: false, metadata: { creationTime: '2026-01-02T00:00:00Z' },
    providerData: [{ providerId: 'password', uid: 'stale_v2@pogotrades.nyc' }] });
  const reads = { readDatabase: async (path, options) => {
    const value = path.split('/').reduce((v, key) => v?.[key], data) ?? null;
    return { value: options?.shallow && value ? Object.fromEntries(Object.keys(value).map(k => [k, true])) : structuredClone(value) };
  }, auth: { listUsers: async () => ({ users: structuredClone(users) }) }, firestore: {
    doc: path => ({ get: async () => ({ exists: path === 'accounts/provider' }) }), collection: () => {
      const query = { where: () => query, limit: count => { assert.equal(count, 1); return query; }, get: async () => ({ empty: true }) }; return query;
    }
  } };
  return { data, users, reads };
}
test('read-only audit produces all six classes without a mutation-capable adapter', async () => {
  const f = fixture(), before = JSON.stringify({ data: f.data, users: f.users }), report = await audit(f.reads);
  assert.equal(report.complete, true); assert.equal(report.mutations, 0); assert.equal(report.summary.establishedAccounts, 6);
  assert.deepEqual(report.summary.counts, Object.fromEntries(CLASSES.map(name => [name, 1])));
  assert.equal(report.summary.orphanIndexes, 1);
  assert.equal(report.accounts.find(a => a.username === 'Stale').fenceWouldHelp, true);
  assert.equal(report.accounts.find(a => a.username === 'Missing').fenceWouldHelp, false);
  assert.equal(JSON.stringify({ data: f.data, users: f.users }), before);
});
test('partial read failure cannot become a healthy account or a complete report', async () => {
  const f = fixture(), read = f.reads.readDatabase;
  f.reads.readDatabase = async (path, options) => { if (path === 'accountSync/healthy') throw Error('Unavailable'); return read(path, options); };
  const report = await audit(f.reads);
  assert.equal(report.complete, false); assert.equal(report.summary.incompleteEvidence, 1);
  assert.equal(report.accounts.find(a => a.username === 'Healthy').classification, 'OTHER CONCRETE ISSUE');
});
test('existing canonical state at an authoritative UID is preserved and does not imply conflicting ownership', async () => {
  const f = fixture(); f.data.accountSync = { healthy: { meta: { ownerUid: 'healthy' }, recoveryCandidates: { fixture: { resolved: true } } } };
  const before = structuredClone(f.data.accountSync), report = await audit(f.reads);
  assert.equal(report.accounts.find(a => a.username === 'Healthy').classification, 'HEALTHY'); assert.deepEqual(f.data.accountSync, before);
});
test('unique stale-UID canonical evidence requires review, never a safe retirement suggestion', async () => {
  const f = fixture(); f.data.accountSync = { 'stale-old': { meta: { ownerUid: 'stale-old' } } };
  const report = await audit(f.reads), stale = report.accounts.find(a => a.username === 'Stale');
  assert.equal(stale.classification, 'PROVIDER / CANONICAL REVIEW'); assert.equal(stale.fenceWouldHelp, false); assert.equal(stale.urgentReview, true);
});
test('canonical owner disagreement is classified for review even at the currently mapped UID', async () => {
  const f = fixture(); f.data.accountSync = { healthy: { meta: { ownerUid: 'someone-else' } } };
  const report = await audit(f.reads); assert.equal(report.accounts.find(a => a.username === 'Healthy').classification, 'PROVIDER / CANONICAL REVIEW');
});
test('a previously qualified retirement counts as healthy while keeping historical Auth evidence', async () => {
  const f = fixture(), old = f.users.find(a => a.uid === 'stale-old'); old.disabled = true;
  const { ROOT, recordFor } = require('../functions/legacy-pin-reset/identity-fence');
  f.data[ROOT] = { 'stale-old': recordFor({ authoritativeUid: 'stale', obsoleteUid: 'stale-old', username: 'Stale', authVersion: 3, obsoleteVersion: 2,
    authoritativeCreatedAt: Date.parse('2026-01-03T00:00:00Z'), obsoleteCreatedAt: Date.parse('2026-01-02T00:00:00Z'), createdAt: 1800000000000 }, 'stale-old', 'retired', 'a'.repeat(64)) };
  const report = await audit(f.reads), stale = report.accounts.find(a => a.username === 'Stale');
  assert.equal(stale.classification, 'HEALTHY'); assert.equal(stale.slots.length, 2); assert.equal(f.users.length, 7);
});
test('paged Auth inventory is incomplete evidence, not a partial fleet success', async () => {
  const f = fixture(); f.reads.auth.listUsers = async () => ({ users: [], pageToken: 'more' });
  await assert.rejects(audit(f.reads), { code: 'audit/incomplete-auth-inventory' });
});
