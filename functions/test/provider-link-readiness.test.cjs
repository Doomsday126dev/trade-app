'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createInMemoryProviderLinkAdapter } = require('../src/adapters/inMemoryProviderLinkAdapter');
const { createProviderLinkOperations, LINK_ATTEMPT_TTL_MS, sha256 } = require('../src/domain/providerLinkReadiness');

const UID = 'firebase_uid_001';
const OTHER_UID = 'firebase_uid_002';
const NOW = 1_800_000_000_000;
const context = (uid = UID, authTime = NOW) => ({ auth: { uid, token: { auth_time: Math.floor(authTime / 1000) } }, app: { appId: 'synthetic-app' } });
const requestId = (label) => `request-${label.padEnd(12, 'x')}`;
const subjectHasher = (provider, subject) => crypto.createHmac('sha256', 'synthetic-test-key').update(`${provider}\0${subject}`).digest('hex');
const seed = (extra = {}) => ({
  gates: { durable_authentication: true },
  users: { SyntheticTrainer: { authUid: UID }, OtherTrainer: { authUid: OTHER_UID } },
  authIndex: { [UID]: { username: 'SyntheticTrainer' }, [OTHER_UID]: { username: 'OtherTrainer' } },
  admins: { [UID]: true },
  publicShares: { SyntheticTrainer: { username: 'SyntheticTrainer', lists: { wishlist: { one: { p: 'H' } } } } },
  userPreferences: { [UID]: { favoriteTrainers: { [OTHER_UID]: { trainerName: 'OtherTrainer', revision: 1, deleted: false } } } },
  firebaseProviderSubjects: { [UID]: { 'google.com': 'google-subject-001' } },
  discordCodes: { 'authorization-code-001': '123456789012345678' },
  ...extra
});
const harness = (extra = {}) => {
  let currentTime = NOW;
  const adapter = createInMemoryProviderLinkAdapter(seed(extra));
  const operations = createProviderLinkOperations({ adapter, now: () => currentTime, subjectHasher });
  return { adapter, operations, advance: (ms) => { currentTime += ms; } };
};

test('provider readiness code is not exported as a deployed callable', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const exports = [...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]).sort();
  assert.deepEqual(exports, ['claimTrainerTagLabel', 'mutateFavoriteTrainer', 'reserveTrainerHandle', 'setApprovedViewer', 'verifyTrainerHistory']);
  assert.doesNotMatch(source, /beginDiscordLink|completeDiscordLink|confirmFirebaseProviderLink|providerLinkReadiness/);
});

test('the fixed in-memory adapter exposes no arbitrary path, bulk, or token-issuing method', () => {
  const adapter = createInMemoryProviderLinkAdapter();
  for (const method of ['read', 'write', 'set', 'update', 'remove', 'bulk', 'path', 'issueCustomToken']) assert.equal(adapter[method], undefined);
});

test('the disabled server gate is checked before idempotency acquisition', async () => {
  const adapter = createInMemoryProviderLinkAdapter(seed({ gates: { durable_authentication: false } }));
  const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
  await assert.rejects(
    operations.confirmFirebaseProviderLink({ provider: 'google', requestId: requestId('gate'), schemaVersion: 1 }, context()),
    (error) => error?.reason === 'operation/write_gate_disabled'
  );
  assert.deepEqual(adapter.inspect().trustedOperationRequests, {});
});

test('Auth, App Check, and recent authentication are mandatory', async () => {
  const { operations } = harness();
  const input = { provider: 'google', requestId: requestId('auth'), schemaVersion: 1 };
  await assert.rejects(operations.confirmFirebaseProviderLink(input, {}), (error) => error?.code === 'unauthenticated');
  await assert.rejects(operations.confirmFirebaseProviderLink(input, { auth: context().auth }), (error) => error?.code === 'app_check_required');
  await assert.rejects(operations.confirmFirebaseProviderLink(input, context(UID, NOW - 10 * 60 * 1000 - 1)), (error) => error?.reason === 'auth/recent_auth_required');
});

test('Google confirmation derives the subject from Firebase Auth and preserves UID ownership', async () => {
  const { adapter, operations } = harness();
  const before = adapter.inspect();
  const input = { provider: 'google', requestId: requestId('google-link'), schemaVersion: 1 };
  const linked = await operations.confirmFirebaseProviderLink(input, context());
  const replay = await operations.confirmFirebaseProviderLink(input, context());
  const after = adapter.inspect();
  assert.equal(linked.status, 'linked');
  assert.equal(replay.status, 'linked');
  assert.equal(replay.replay, true);
  assert.equal(after.authProviderSubjects.google[subjectHasher('google.com', 'google-subject-001')].uid, UID);
  assert.equal(after.authProviders[UID].google.state, 'linked');
  assert.deepEqual(after.users, before.users);
  assert.deepEqual(after.authIndex, before.authIndex);
  assert.deepEqual(after.admins, before.admins);
  assert.deepEqual(after.publicShares, before.publicShares);
  assert.deepEqual(after.userPreferences, before.userPreferences);
  assert.equal(after.authProviders[OTHER_UID], undefined);
  await assert.rejects(
    operations.confirmFirebaseProviderLink({ ...input, requestId: requestId('forged'), subject: 'attacker-input' }, context()),
    (error) => error?.reason === 'request/schema_invalid'
  );
});

test('a provider subject already reserved to another UID is rejected', async () => {
  const hash = subjectHasher('google.com', 'google-subject-001');
  const { operations } = harness({ authProviderSubjects: { google: { [hash]: { uid: OTHER_UID, linkedAt: 1, revision: 1 } } } });
  await assert.rejects(
    operations.confirmFirebaseProviderLink({ provider: 'google', requestId: requestId('collision'), schemaVersion: 1 }, context()),
    (error) => error?.reason === 'provider/subject_already_linked'
  );
});

test('Discord flow binds cryptographic state, PKCE, expiry, caller, and one-time code use', async () => {
  const { adapter, operations } = harness();
  const state = 'state-secret-value-1234567890';
  const verifier = 'v'.repeat(48);
  const begin = await operations.beginDiscordLink({
    stateHash: sha256(state),
    codeChallenge: sha256(verifier),
    requestId: requestId('discord-begin'),
    schemaVersion: 1
  }, context());
  const storedAttempt = adapter.inspect().authLinkAttempts[begin.attemptId];
  assert.equal(storedAttempt.callerUid, UID);
  assert.equal(storedAttempt.stateHash, sha256(state));
  assert.equal(storedAttempt.codeChallenge, sha256(verifier));
  assert.equal(storedAttempt.expiresAt - storedAttempt.createdAt, LINK_ATTEMPT_TTL_MS);
  assert.doesNotMatch(JSON.stringify(storedAttempt), new RegExp(state));
  assert.doesNotMatch(JSON.stringify(storedAttempt), new RegExp(verifier));

  await assert.rejects(
    operations.completeDiscordLink({ attemptId: begin.attemptId, state, code: 'authorization-code-001', codeVerifier: verifier, requestId: requestId('discord-switch'), schemaVersion: 1 }, context(OTHER_UID)),
    (error) => error?.reason === 'discord/attempt_unavailable'
  );

  const completed = await operations.completeDiscordLink({
    attemptId: begin.attemptId,
    state,
    code: 'authorization-code-001',
    codeVerifier: verifier,
    requestId: requestId('discord-complete'),
    schemaVersion: 1
  }, context());
  assert.equal(completed.status, 'linked');
  const subjectHash = subjectHasher('discord.com', '123456789012345678');
  assert.equal(adapter.inspect().authProviderSubjects.discord[subjectHash].uid, UID);
  assert.equal(adapter.inspect().discordCodes['authorization-code-001'], undefined);
});

test('Discord rejects CSRF state mismatch, PKCE mismatch, expiration, and consumed-attempt replay', async () => {
  for (const variant of ['state', 'pkce', 'expired']) {
    const { operations, advance } = harness();
    const state = `state-${variant}-secret-value`;
    const verifier = 'w'.repeat(48);
    const begin = await operations.beginDiscordLink({ stateHash: sha256(state), codeChallenge: sha256(verifier), requestId: requestId(`begin-${variant}`), schemaVersion: 1 }, context());
    if (variant === 'expired') advance(LINK_ATTEMPT_TTL_MS + 1);
    const input = {
      attemptId: begin.attemptId,
      state: variant === 'state' ? `${state}-wrong` : state,
      code: 'authorization-code-001',
      codeVerifier: variant === 'pkce' ? 'z'.repeat(48) : verifier,
      requestId: requestId(`complete-${variant}`),
      schemaVersion: 1
    };
    const completionContext=variant==='expired'?context(UID,NOW+LINK_ATTEMPT_TTL_MS+1):context();
    await assert.rejects(operations.completeDiscordLink(input, completionContext), (error) => [
      'discord/state_mismatch', 'discord/pkce_mismatch', 'discord/attempt_expired'
    ].includes(error?.reason));
  }

  const { operations } = harness();
  const state = 'state-replay-secret-value';
  const verifier = 'r'.repeat(48);
  const begin = await operations.beginDiscordLink({ stateHash: sha256(state), codeChallenge: sha256(verifier), requestId: requestId('begin-replay'), schemaVersion: 1 }, context());
  const input = { attemptId: begin.attemptId, state, code: 'authorization-code-001', codeVerifier: verifier, requestId: requestId('complete-replay'), schemaVersion: 1 };
  await operations.completeDiscordLink(input, context());
  const replay = await operations.completeDiscordLink(input, context());
  assert.equal(replay.replay, true);
  await assert.rejects(
    operations.completeDiscordLink({ ...input, code: 'authorization-code-002' }, context()),
    (error) => error?.code === 'replay_mismatch'
  );
});

test('an abandoned Discord attempt expires without creating a provider claim', async () => {
  const { adapter, operations, advance } = harness();
  const state = 'state-abandoned-secret-value';
  const verifier = 'a'.repeat(48);
  const begin = await operations.beginDiscordLink({ stateHash: sha256(state), codeChallenge: sha256(verifier), requestId: requestId('begin-abandon'), schemaVersion: 1 }, context());
  advance(LINK_ATTEMPT_TTL_MS + 1);
  const after = adapter.inspect();
  assert.equal(after.authLinkAttempts[begin.attemptId].consumedAt, null);
  assert.deepEqual(after.authProviders, {});
  assert.deepEqual(after.authProviderSubjects, {});
});

test('fixed per-UID operation limits fail closed and readiness code emits no raw logs', async () => {
  const { operations } = harness();
  for (let index = 0; index < 20; index++) {
    await operations.confirmFirebaseProviderLink({ provider: 'google', requestId: requestId(`rate-${index}`), schemaVersion: 1 }, context());
  }
  await assert.rejects(
    operations.confirmFirebaseProviderLink({ provider: 'google', requestId: requestId('rate-blocked'), schemaVersion: 1 }, context()),
    (error) => error?.reason === 'provider/rate_limited'
  );
  const source = fs.readFileSync(path.join(__dirname, '../src/domain/providerLinkReadiness.js'), 'utf8');
  assert.doesNotMatch(source, /console\.|logger\.|accessToken|refreshToken|clientSecret/);
});

test('OAuth success alone never initializes a trainer profile or private preferences', async () => {
  const { adapter, operations } = harness();
  await operations.confirmFirebaseProviderLink({ provider: 'google', requestId: requestId('no-profile'), schemaVersion: 1 }, context());
  const after = adapter.inspect();
  assert.deepEqual(Object.keys(after.users), ['SyntheticTrainer', 'OtherTrainer']);
  assert.equal(after.accounts, undefined);
  assert.deepEqual(Object.keys(after.userPreferences), [UID]);
  assert.deepEqual(Object.keys(after.publicShares), ['SyntheticTrainer']);
});
