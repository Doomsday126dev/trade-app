'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProductionReads, AUTH_FIELDS, decodeAuth } = require('../scripts/lib/legacy-slot-reconciliation-production.cjs');
const { SERVICE_ACCOUNTS, EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS, verifyBoundarySources } = require('../scripts/lib/legacy-slot-reconciliation-boundary.cjs');
const { CONTRACT } = require('../functions/legacy-pin-reset/identity-fence');
function boundaryFixture() {
  const now = 1800000000000, ownerUid = 'synthetic-owner';
  const resetEnv = { LEGACY_IDENTITY_BOUNDARY: CONTRACT, LEGACY_PIN_RESET_ENABLED: 'false', LEGACY_PIN_RESET_OWNER_UID: ownerUid };
  const services = Object.entries(SERVICE_ACCOUNTS).map(([name, serviceAccountName]) => {
    const env = name === 'ownerresetlegacypin' ? resetEnv : { GROUP_E_CLIENT_MODE: 'disabled', READ_PROOF_MODE: 'false', GATEWAY_INVOCATION_ENABLED: 'false',
      READ_ACCOUNT_FOUNDATION_ENABLED: 'false', RESERVE_HANDLE_ENABLED: 'false', REPAIR_FOUNDATION_ENABLED: 'false', APPLY_MIGRATION_ENABLED: 'false',
      FREEZE_CONFLICT_ENABLED: 'false', CLIENT_FOUNDATION_USE_ENABLED: 'false' };
    return { metadata: { name }, spec: { template: { spec: { serviceAccountName, containers: [{ env: Object.entries(env).map(([name, value]) => ({ name, value })) }] } } },
      status: { latestReadyRevisionName: `${name}-revision`, latestCreatedRevisionName: `${name}-revision`, traffic: [{ percent: 100, revisionName: `${name}-revision` }] } };
  });
  const bindings = Object.entries(EXPECTED_ROLES).flatMap(([email, roles]) => roles.map(role => ({ role, members: [`serviceAccount:${email}`],
    ...(EXPECTED_CONDITIONS[role] ? { condition: { expression: EXPECTED_CONDITIONS[role] } } : {}) })));
  return { now, sources: { config: { state: 'ACTIVE', updateTime: new Date(now - 180000).toISOString(), serviceConfig: {
    serviceAccountEmail: SERVICE_ACCOUNTS.ownerresetlegacypin, environmentVariables: { ...resetEnv }, timeoutSeconds: 120, revision: 'ownerresetlegacypin-revision' } },
    services, policy: { bindings }, roles: Object.fromEntries(Object.entries(EXPECTED_PERMISSIONS).map(([role, includedPermissions]) => [role, { includedPermissions: [...includedPermissions], stage: 'GA' }])),
    serviceAccountPolicies: Object.fromEntries(Object.keys(EXPECTED_ROLES).map(email => [email, {}])), ownerUid, ownerAdmin: true,
    rules: structuredClone(require('./firebase/database.rules.legacy-identity-fences.json')), journal: { generation: '1', pendingResetCount: 0 } } };
}
test('boundary requires exact enforced Rules, permissions, disabled runtimes and settled traffic', () => {
  const { sources, now } = boundaryFixture(), result = verifyBoundarySources(sources, now);
  assert.equal(result.securityContract, CONTRACT); assert.equal(result.quiesced, true); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
for (const [name, drift] of [
  ['previous Rules', s => delete s.rules.rules.legacyIdentityFences],
  ['reset active', s => s.config.serviceConfig.environmentVariables.LEGACY_PIN_RESET_ENABLED = 'true'],
  ['old contract', s => s.config.serviceConfig.environmentVariables.LEGACY_IDENTITY_BOUNDARY = 'immutable-bindings-v1'],
  ['insufficient quiescence', (s, now) => s.config.updateTime = new Date(now - 1000).toISOString()],
  ['long running reset', s => s.config.serviceConfig.timeoutSeconds = 300],
  ['unsettled deployment', s => s.config.state = 'DEPLOYING'],
  ['pending request', s => s.journal.pendingResetCount = 1],
  ['wrong owner', s => s.ownerUid = 'other'],
  ['revoked owner', s => s.ownerAdmin = false],
  ['unknown service', s => s.services.push({ metadata: { name: 'unexpected' } })],
  ['wrong runtime', s => s.services[0].spec.template.spec.serviceAccountName = 'other'],
  ['old tagged revision', s => s.services[0].status.traffic.push({ percent: 0, revisionName: 'old', tag: 'old' })],
  ['revision not ready', s => s.services[0].status.latestCreatedRevisionName = 'new'],
  ['provider migration enabled', s => s.services.find(x => x.metadata.name === 'e1-identity-authority').spec.template.spec.containers[0].env.find(e => e.name === 'APPLY_MIGRATION_ENABLED').value = 'true'],
  ['expanded role', s => Object.values(s.roles)[0].includedPermissions.push('resourcemanager.projects.setIamPolicy')],
  ['extra role binding', s => s.policy.bindings.push({ members: s.policy.bindings[0].members, role: 'roles/editor' })],
  ['removed database condition', s => delete s.policy.bindings.find(b => b.condition).condition],
  ['application impersonation grant', s => Object.values(s.serviceAccountPolicies)[0].bindings = [{ role: 'roles/iam.serviceAccountTokenCreator', members: [`serviceAccount:${SERVICE_ACCOUNTS.ownerresetlegacypin}`] }]]
]) test(`boundary fails closed on ${name}`, () => {
  const { sources, now } = boundaryFixture(); drift(sources, now); assert.throws(() => verifyBoundarySources(sources, now), error => error.code?.startsWith('repair/'));
});
test('Auth read transport uses server projection without credential material and never permits pagination as complete evidence', async () => {
  const calls = [], reads = createProductionReads({ credential: { getAccessToken: async () => ({ access_token: 'synthetic' }) }, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ users: [{ localId: 'current', email: 'trainer_v3@pogotrades.nyc', createdAt: '1700000000000', providerUserInfo: [] }], nextPageToken: 'more' }), { status: 200 });
  } });
  assert.equal((await reads.auth.listUsers()).pageToken, 'more'); await reads.auth.getUser('current');
  for (const call of calls) {
    assert.ok(new URL(call.url).searchParams.get('fields').startsWith('users('));
    assert.ok(!/password|salt|hash|token/i.test(AUTH_FIELDS.replace('nextPageToken', '')));
  }
  assert.equal(calls[0].options.method, 'GET'); assert.deepEqual(JSON.parse(calls[1].options.body), { localId: ['current'] });
  assert.equal(new URL(calls[1].url).searchParams.get('fields').includes('nextPageToken'), false);
  assert.deepEqual(Object.keys(reads.auth).sort(), ['getUser', 'listUsers']);
});
test('database reads encode names, preserve CAS ETags and omit ETag headers on shallow requests', async () => {
  const calls = [], reads = createProductionReads({ credential: { getAccessToken: async () => ({ access_token: 'synthetic' }) }, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response('null', { status: 200, headers: { etag: '"null_etag"' } });
  } });
  assert.equal((await reads.readDatabase('authIndex/current')).etag, 'null_etag'); await reads.readDatabase('users', { shallow: true });
  await reads.readDatabase('users/Trainer Name/authUid');
  assert.equal(calls[0].options.headers['X-Firebase-ETag'], 'true'); assert.equal(calls[1].options.headers['X-Firebase-ETag'], undefined);
  assert.ok(calls[2].url.includes('Trainer%20Name'));
  assert.throws(() => reads.readDatabase('../other')); assert.throws(() => reads.firestore.doc('unrelated/current'));
});
test('Firestore queries are exact named-database bounded existence reads', async () => {
  const calls = [], reads = createProductionReads({ credential: { getAccessToken: async () => ({ access_token: 'synthetic' }) }, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response('[{}]', { status: 200 });
  } });
  assert.equal((await reads.firestore.collection('providerSubjects').where('uid', '==', 'old').limit(1).get()).empty, true);
  assert.equal((await reads.firestore.collection('accounts/old/providers').limit(1).get()).empty, true);
  assert.ok(calls.every(c => c.url.includes('/databases/phase-e-identity/documents')));
  assert.deepEqual(JSON.parse(calls[0].options.body).structuredQuery.where.fieldFilter.value, { stringValue: 'old' });
  assert.ok(calls.every(c => JSON.parse(c.options.body).structuredQuery.limit === 1));
  assert.throws(() => reads.firestore.collection('providerSubjects').limit(1000));
});
test('Auth conversion strips unexpected credential exports from returned identity', () => {
  const value = decodeAuth({ localId: 'old', createdAt: '1700000000000', passwordHash: 'secret', salt: 'secret', customAttributes: '{}', providerUserInfo: [] });
  assert.equal(JSON.stringify(value).includes('secret'), false);
});
test('production Auth incarnation preserves raw milliseconds while fence times match Admin SDK precision', () => {
  const { projectAuth } = require('../scripts/lib/legacy-slot-reconciliation-evidence.cjs');
  const value = decodeAuth({ localId: 'old', createdAt: '1700000000123', providerUserInfo: [] });
  assert.equal(Date.parse(value.metadata.creationTime), 1700000000000);
  assert.equal(projectAuth(value).creationTimestampMillis, 1700000000123);
  assert.notEqual(require('../scripts/lib/legacy-slot-reconciliation.cjs').fingerprint(projectAuth(value)),
    require('../scripts/lib/legacy-slot-reconciliation.cjs').fingerprint(projectAuth({ ...value, creationTimestampMillis: 1700000000124 })));
});
test('one-account CLI requires an explicit target and exact approval; no wildcard or mass mode exists', () => {
  const { parseArgs } = require('../scripts/legacy-slot-reconciliation.cjs');
  const args = ['--username', 'Trainer', '--manifest', '/private/tmp/synthetic.private.json'];
  assert.equal(parseArgs(['plan', ...args]).mode, 'plan'); assert.equal(parseArgs(['verify', ...args]).mode, 'verify');
  assert.equal(parseArgs(['apply', ...args, '--approve-manifest', 'a'.repeat(64), '--resume']).resume, true);
  for (const invalid of [['apply', ...args], ['all', ...args], ['plan', ...args, '--resume'], ['verify', ...args, '--approve-manifest', 'a'.repeat(64)],
    ['plan', ...args, '--username', 'Other'], ['plan', '--username', '*', '--manifest', '/private/tmp/synthetic.private.json'],
    ['plan', '--username', 'Doomsday126', '--manifest', '/private/tmp/synthetic.private.json'], ['plan', '--username', 'Trainer', '--manifest', 'public.json']]) {
    assert.throws(() => parseArgs(invalid), { code: 'repair/cli-invalid' });
  }
});
test('private manifests use exclusive creation and reject permissive files or symlinks', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { privateFile, readManifest } = require('../scripts/legacy-slot-reconciliation.cjs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'legacy-manifest-test-')), file = path.join(dir, 'synthetic.private.json');
  try {
    privateFile(file, { synthetic: true }); assert.deepEqual(readManifest(file), { synthetic: true });
    assert.throws(() => privateFile(file, { overwrite: true }), { code: 'EEXIST' });
    fs.chmodSync(file, 0o644); assert.throws(() => readManifest(file), { code: 'repair/private-manifest-required' });
    fs.symlinkSync(file, path.join(dir, 'link.private.json')); assert.throws(() => readManifest(path.join(dir, 'link.private.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
