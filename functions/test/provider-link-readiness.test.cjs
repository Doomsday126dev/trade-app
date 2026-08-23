'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createInMemoryProviderLinkAdapter } = require('../src/adapters/inMemoryProviderLinkAdapter');
const {
  ADMITTED_PROVIDERS,
  PROVIDERS,
  RECENT_AUTH_MAX_AGE_MS,
  VERIFIED_EVIDENCE_MAX_AGE_MS,
  createProviderLinkOperations,
  providerSubjectKey
} = require('../src/domain/providerLinkReadiness');

const UID = 'firebase_uid_001';
const OTHER_UID = 'firebase_uid_002';
const NOW = 1_800_000_000_000;
const HANDLE_A = `v1_${'a'.repeat(64)}`;
const HANDLE_B = `v1_${'b'.repeat(64)}`;
const context = (uid = UID, authTime = NOW) => ({
  auth: { uid, token: { auth_time: Math.floor(authTime / 1000) } },
  app: { appId: 'production-app' }
});
const requestId = (label) => `request-${label.padEnd(12, 'x')}`;
const subjectHasher = (providerId, subject) => crypto.createHmac('sha256', 'synthetic-test-key')
  .update(`e2-provider-subject\0${providerId}\0${subject}`)
  .digest('hex');
const evidence = (uid, providerId, subject, verifiedAt = NOW) => ({ uid, providerId, subject, verifiedAt });

function baseSeed(extra = {}) {
  return {
    gates: { e2_provider_link: true },
    accounts: {
      [UID]: { document: {
        schemaVersion: 1, uid: UID, canonicalTrainerName: 'SyntheticTrainer', normalizedTrainerName: 'synthetictrainer',
        handleKey: HANDLE_A, legacyUsername: 'SyntheticTrainer', legacyAuthVersion: 1, status: 'active', revision: 3
      } },
      [OTHER_UID]: { document: {
        schemaVersion: 1, uid: OTHER_UID, canonicalTrainerName: 'OtherTrainer', normalizedTrainerName: 'othertrainer',
        handleKey: HANDLE_B, legacyUsername: 'OtherTrainer', legacyAuthVersion: 1, status: 'active', revision: 2
      } }
    },
    trainerHandles: {
      [HANDLE_A]: { uid: UID, canonicalTrainerName: 'SyntheticTrainer', normalizedTrainerName: 'synthetictrainer' },
      [HANDLE_B]: { uid: OTHER_UID, canonicalTrainerName: 'OtherTrainer', normalizedTrainerName: 'othertrainer' }
    },
    authIndex: { [UID]: { username: 'SyntheticTrainer' }, [OTHER_UID]: { username: 'OtherTrainer' } },
    users: { SyntheticTrainer: { authUid: UID }, OtherTrainer: { authUid: OTHER_UID } },
    loginDirectory: {
      synthetictrainer: { username: 'SyntheticTrainer', authUid: UID },
      othertrainer: { username: 'OtherTrainer', authUid: OTHER_UID }
    },
    verifiedProviderEvidence: {
      [UID]: { [PROVIDERS.google]: evidence(UID, PROVIDERS.google, 'google-subject-001') },
      [OTHER_UID]: { [PROVIDERS.google]: evidence(OTHER_UID, PROVIDERS.google, 'google-subject-002') }
    },
    admins: { [UID]: true },
    privateLists: { [UID]: { wishlist: { one: { p: 'H' } } } },
    publicShares: { SyntheticTrainer: { username: 'SyntheticTrainer', lists: { wishlist: { one: { p: 'H' } } } } },
    userPreferences: { [UID]: { favoriteTrainers: { [OTHER_UID]: { trainerName: 'OtherTrainer' } } } },
    ...extra
  };
}

function harness(extra = {}, options = {}) {
  let currentTime = NOW;
  const adapter = createInMemoryProviderLinkAdapter(baseSeed(extra), options);
  const operations = createProviderLinkOperations({ adapter, now: () => currentTime, subjectHasher });
  return { adapter, operations, advance: (ms) => { currentTime += ms; } };
}

const input = (provider = 'google', label = provider) => ({ provider, requestId: requestId(label), schemaVersion: 1 });
const durableFoundation = (state) => Object.fromEntries(
  Object.entries(state.accounts).map(([uid, accountNode]) => [uid, structuredClone(accountNode.document)])
);

test('E.2 provider-link contract is not exported by any deployed callable or authority route', () => {
  const functionsSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const authoritySource = fs.readFileSync(path.join(__dirname, '../e1-authority-service/server.js'), 'utf8');
  const exports = [...functionsSource.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]).sort();
  assert.deepEqual(exports, ['claimTrainerTagLabel', 'mutateFavoriteTrainer', 'reserveTrainerHandle', 'setApprovedViewer', 'verifyTrainerHistory']);
  assert.doesNotMatch(functionsSource, /linkVerifiedProvider|providerLinkReadiness|e2_provider_link/);
  assert.doesNotMatch(authoritySource, /linkVerifiedProvider|providerSubjects|e2_provider_link/);
});

test('adapter exposes only fixed E.2 contract methods, not arbitrary storage or token surfaces', () => {
  const adapter = createInMemoryProviderLinkAdapter();
  assert.deepEqual(Object.keys(adapter).sort(), [
    'assertOperationEnabled', 'getVerifiedProviderEvidence', 'inspect', 'linkVerifiedProviderAtomic'
  ]);
  for (const method of ['read', 'write', 'set', 'update', 'remove', 'bulk', 'path', 'issueCustomToken', 'exchangeCode']) {
    assert.equal(adapter[method], undefined);
  }
});

test('disabled gate, missing auth, App Check, and stale authentication fail before durable writes', async () => {
  const adapter = createInMemoryProviderLinkAdapter(baseSeed({ gates: { e2_provider_link: false } }));
  const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
  const before = adapter.inspect();
  await assert.rejects(operations.linkVerifiedProvider(input(), {}), (error) => error?.code === 'unauthenticated');
  await assert.rejects(operations.linkVerifiedProvider(input(), { auth: context().auth }), (error) => error?.code === 'app_check_required');
  await assert.rejects(
    operations.linkVerifiedProvider(input(), context(UID, NOW - RECENT_AUTH_MAX_AGE_MS - 1)),
    (error) => error?.reason === 'auth/recent_auth_required'
  );
  await assert.rejects(operations.linkVerifiedProvider(input(), context()), (error) => error?.reason === 'operation/write_gate_disabled');
  assert.deepEqual(adapter.inspect(), before);
});

test('Google link atomically creates the UID provider, reverse claim, and operation evidence', async () => {
  const { adapter, operations } = harness();
  const result = await operations.linkVerifiedProvider(input('google', 'google-link'), context());
  const after = adapter.inspect();
  const key = providerSubjectKey('google', subjectHasher(PROVIDERS.google, 'google-subject-001'));
  assert.deepEqual(result, {
    ok: true, operation: 'linkVerifiedProvider', provider: 'google', status: 'linked', replay: false
  });
  assert.equal(after.accounts[UID].providers.google.providerSubjectKey, key);
  assert.equal(after.providerSubjects[key].uid, UID);
  assert.equal(after.operationRequests[UID].requests[requestId('google-link')].status, 'complete');
  assert.deepEqual(Object.keys(after.operationRequests[UID].requests[requestId('google-link')].result), [
    'ok', 'operation', 'provider', 'status'
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 256);
  assert.deepEqual(Object.keys(after.accounts[UID].providers), ['google']);
});

test('a failure at the transaction commit boundary leaves all three durable writes absent', async () => {
  const adapter = createInMemoryProviderLinkAdapter(baseSeed(), {
    beforeCommit: async () => { throw new Error('synthetic commit failure'); }
  });
  const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
  const before = adapter.inspect();
  await assert.rejects(
    operations.linkVerifiedProvider(input('google', 'commit-failure'), context()),
    (error) => error?.reason === 'provider/transaction_failed' && !error.message.includes('synthetic')
  );
  assert.deepEqual(adapter.inspect(), before);
});

test('linking preserves account foundation, handle, legacy ownership, lists, shares, and preferences', async () => {
  const { adapter, operations } = harness();
  const before = adapter.inspect();
  await operations.linkVerifiedProvider(input('google', 'preserve'), context());
  const after = adapter.inspect();
  assert.deepEqual(durableFoundation(after), durableFoundation(before));
  for (const root of ['trainerHandles', 'authIndex', 'users', 'loginDirectory', 'admins', 'privateLists', 'publicShares', 'userPreferences']) {
    assert.deepEqual(after[root], before[root], root);
  }
  assert.equal(after.accounts[OTHER_UID].providers, undefined);
});

test('ordinary request data cannot choose UID, subject, email, token, code, or handle', async () => {
  const { adapter, operations } = harness();
  const before = adapter.inspect();
  for (const [field, value] of Object.entries({
    uid: OTHER_UID,
    subject: 'attacker-subject',
    email: 'attacker@example.test',
    token: 'raw-token',
    code: 'oauth-code',
    trainerHandle: 'OtherTrainer'
  })) {
    await assert.rejects(
      operations.linkVerifiedProvider({ ...input('google', field), [field]: value }, context()),
      (error) => error?.reason === 'request/schema_invalid'
    );
  }
  assert.deepEqual(adapter.inspect(), before);
});

test('unsupported, unknown, and email-link provider states fail closed', async () => {
  const { adapter, operations } = harness();
  const before = adapter.inspect();
  for (const provider of ['email', 'emailLink', 'password', 'github', '', null]) {
    await assert.rejects(
      operations.linkVerifiedProvider(input(provider, `unsupported-${String(provider)}`), context()),
      (error) => error?.reason === 'provider/unsupported'
    );
  }
  assert.deepEqual(adapter.inspect(), before);
});

test('missing, stale, future, cross-UID, and wrong-provider evidence all fail closed', async () => {
  const variants = [
    null,
    {},
    evidence(UID, PROVIDERS.google, 'subject', NOW - VERIFIED_EVIDENCE_MAX_AGE_MS - 1),
    evidence(UID, PROVIDERS.google, 'subject', NOW + 1),
    evidence(OTHER_UID, PROVIDERS.google, 'subject'),
    evidence(UID, PROVIDERS.discord, 'subject')
  ];
  for (const variant of variants) {
    const adapter = createInMemoryProviderLinkAdapter(baseSeed(), { evidenceReader: async () => variant });
    const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
    const before = adapter.inspect();
    await assert.rejects(operations.linkVerifiedProvider(input(), context()));
    assert.deepEqual(adapter.inspect(), before);
  }
});

test('absent or disabled account and handle or legacy ownership mismatch fail without partial state', async () => {
  const mutations = [
    (seed) => { delete seed.accounts[UID]; },
    (seed) => { seed.accounts[UID].document.status = 'disabled'; },
    (seed) => { seed.trainerHandles[HANDLE_A].uid = OTHER_UID; },
    (seed) => { seed.authIndex[UID].username = 'OtherTrainer'; },
    (seed) => { seed.users.SyntheticTrainer.authUid = OTHER_UID; },
    (seed) => { seed.loginDirectory.synthetictrainer.authUid = OTHER_UID; }
  ];
  for (const mutate of mutations) {
    const seed = baseSeed();
    mutate(seed);
    const adapter = createInMemoryProviderLinkAdapter(seed);
    const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
    const before = adapter.inspect();
    await assert.rejects(operations.linkVerifiedProvider(input(), context()));
    assert.deepEqual(adapter.inspect(), before);
  }
});

test('provider subject collision and contradictory same-account provider both fail closed', async () => {
  const requestedKey = providerSubjectKey('google', subjectHasher(PROVIDERS.google, 'google-subject-001'));
  const otherKey = providerSubjectKey('google', subjectHasher(PROVIDERS.google, 'different-subject'));
  const variants = [
    { providerSubjects: { [requestedKey]: { uid: OTHER_UID, provider: 'google', providerId: PROVIDERS.google, providerSubjectKey: requestedKey } } },
    {
      accounts: {
        ...baseSeed().accounts,
        [UID]: { ...baseSeed().accounts[UID], providers: { google: {
          schemaVersion: 1, provider: 'google', providerId: PROVIDERS.google, providerSubjectKey: otherKey, state: 'linked'
        } } }
      },
      providerSubjects: { [otherKey]: { uid: UID, provider: 'google', providerId: PROVIDERS.google, providerSubjectKey: otherKey } }
    }
  ];
  for (const variant of variants) {
    const { adapter, operations } = harness(variant);
    const before = adapter.inspect();
    await assert.rejects(operations.linkVerifiedProvider(input(), context()), (error) => error?.code === 'conflict');
    assert.deepEqual(adapter.inspect(), before);
  }
});

test('partial provider or reverse-claim state is rejected and left untouched', async () => {
  const key = providerSubjectKey('google', subjectHasher(PROVIDERS.google, 'google-subject-001'));
  const variants = [
    { providerSubjects: { [key]: { uid: UID, provider: 'google', providerId: PROVIDERS.google, providerSubjectKey: key } } },
    {
      accounts: {
        ...baseSeed().accounts,
        [UID]: { ...baseSeed().accounts[UID], providers: { google: {
          schemaVersion: 1, provider: 'google', providerId: PROVIDERS.google, providerSubjectKey: key, state: 'linked'
        } } }
      }
    }
  ];
  for (const variant of variants) {
    const { adapter, operations } = harness(variant);
    const before = adapter.inspect();
    await assert.rejects(operations.linkVerifiedProvider(input(), context()), (error) => error?.reason === 'provider/state_inconsistent');
    assert.deepEqual(adapter.inspect(), before);
  }
});

test('exact replay is write-free and changed evidence under the same request ID is rejected', async () => {
  let currentEvidence = evidence(UID, PROVIDERS.google, 'google-subject-001');
  const { adapter, operations } = harness({}, { evidenceReader: async () => currentEvidence });
  const request = input('google', 'replay');
  const first = await operations.linkVerifiedProvider(request, context());
  const afterFirst = adapter.inspect();
  const replay = await operations.linkVerifiedProvider(request, context());
  assert.equal(first.status, 'linked');
  assert.equal(replay.status, 'linked');
  assert.equal(replay.replay, true);
  assert.deepEqual(adapter.inspect(), afterFirst);
  currentEvidence = evidence(UID, PROVIDERS.google, 'changed-subject');
  await assert.rejects(operations.linkVerifiedProvider(request, context()), (error) => error?.code === 'replay_mismatch');
  assert.deepEqual(adapter.inspect(), afterFirst);
});

test('exact replay rejects every malformed durable three-record relationship without writes or repair', async () => {
  const subject = 'google-subject-001';
  const request = input('google', 'durable-replay');
  const initial = harness();
  await initial.operations.linkVerifiedProvider(request, context());
  const coherent = initial.adapter.inspect();
  const key = providerSubjectKey('google', subjectHasher(PROVIDERS.google, subject));
  const operation = (state) => state.operationRequests[UID].requests[request.requestId];
  const provider = (state) => state.accounts[UID].providers.google;
  const reverse = (state) => state.providerSubjects[key];
  const changedKey = providerSubjectKey('google', subjectHasher(PROVIDERS.google, 'different-subject'));
  const mutations = [
    ['account-provider deleted', (state) => { delete state.accounts[UID].providers.google; }],
    ['reverse claim deleted', (state) => { delete state.providerSubjects[key]; }],
    ['account-provider subject key changed', (state) => { provider(state).providerSubjectKey = changedKey; }],
    ['reverse claim UID changed', (state) => { reverse(state).uid = OTHER_UID; }],
    ['provider changed', (state) => { provider(state).provider = 'discord'; }],
    ['provider ID changed', (state) => { reverse(state).providerId = PROVIDERS.discord; }],
    ['link state changed', (state) => { provider(state).state = 'pending'; }],
    ['schema version changed', (state) => { provider(state).schemaVersion = 2; }],
    ['provider revision changed', (state) => { provider(state).revision = 2; }],
    ['reverse linkedAt changed', (state) => { reverse(state).linkedAt += 1; }],
    ['operation status missing', (state) => { delete operation(state).status; }],
    ['operation status malformed', (state) => { operation(state).status = 'pending'; }],
    ['operation name changed', (state) => { operation(state).operation = 'reserveTrainerHandle'; }],
    ['operation result missing', (state) => { delete operation(state).result; }],
    ['operation result malformed', (state) => { operation(state).result = { status: 'linked' }; }],
    ['operation result terminal status unsupported', (state) => { operation(state).result.status = 'reconciled'; }],
    ['operation fingerprint changed', (state) => { operation(state).fingerprint = 'f'.repeat(64); }]
  ];

  for (const [label, mutate] of mutations) {
    const state = structuredClone(coherent);
    mutate(state);
    const adapter = createInMemoryProviderLinkAdapter({
      ...state,
      verifiedProviderEvidence: {
        [UID]: { [PROVIDERS.google]: evidence(UID, PROVIDERS.google, subject) }
      }
    });
    const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
    const before = adapter.inspect();
    let caught;
    try {
      await operations.linkVerifiedProvider(request, context());
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, label);
    assert.ok(['conflict', 'unavailable', 'replay_mismatch'].includes(caught.code), label);
    assert.doesNotMatch(JSON.stringify({ code: caught.code, reason: caught.reason, message: caught.message }), new RegExp(subject), label);
    assert.deepEqual(adapter.inspect(), before, label);
  }
});

test('same UID and subject with a new request is already linked without rewriting the claim', async () => {
  const { adapter, operations } = harness();
  await operations.linkVerifiedProvider(input('google', 'same-first'), context());
  const afterFirst = adapter.inspect();
  const second = await operations.linkVerifiedProvider(input('google', 'same-second'), context());
  const afterSecond = adapter.inspect();
  assert.equal(second.status, 'already_linked');
  assert.equal(second.replay, false);
  assert.deepEqual(afterSecond.accounts, afterFirst.accounts);
  assert.deepEqual(afterSecond.providerSubjects, afterFirst.providerSubjects);
  assert.equal(Object.keys(afterSecond.operationRequests[UID].requests).length, 2);
});

test('concurrent claims for one provider subject have exactly one winner', async () => {
  const sharedSubject = 'shared-google-subject';
  const seed = baseSeed({
    verifiedProviderEvidence: {
      [UID]: { [PROVIDERS.google]: evidence(UID, PROVIDERS.google, sharedSubject) },
      [OTHER_UID]: { [PROVIDERS.google]: evidence(OTHER_UID, PROVIDERS.google, sharedSubject) }
    }
  });
  const adapter = createInMemoryProviderLinkAdapter(seed);
  const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
  const settled = await Promise.allSettled([
    operations.linkVerifiedProvider(input('google', 'race-a'), context(UID)),
    operations.linkVerifiedProvider(input('google', 'race-b'), context(OTHER_UID))
  ]);
  assert.equal(settled.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((entry) => entry.status === 'rejected').length, 1);
  const state = adapter.inspect();
  const key = providerSubjectKey('google', subjectHasher(PROVIDERS.google, sharedSubject));
  const winner = state.providerSubjects[key].uid;
  const loser = winner === UID ? OTHER_UID : UID;
  assert.ok(state.accounts[winner].providers.google);
  assert.equal(state.accounts[loser].providers, undefined);
  assert.equal(state.operationRequests[loser], undefined);
});

test('Google is the only admitted provider while Discord fits the key shape without activation', async () => {
  const discordSubject = '123456789012345678';
  const { adapter, operations } = harness({
    verifiedProviderEvidence: {
      [UID]: { [PROVIDERS.discord]: evidence(UID, PROVIDERS.discord, discordSubject) }
    }
  });
  const before = adapter.inspect();
  const key = providerSubjectKey('discord', subjectHasher(PROVIDERS.discord, discordSubject));
  assert.deepEqual(ADMITTED_PROVIDERS, ['google']);
  assert.match(key, /^v1_discord_[a-f0-9]{64}$/);
  await assert.rejects(
    operations.linkVerifiedProvider(input('discord', 'discord'), context()),
    (error) => error?.reason === 'provider/not_admitted'
  );
  assert.deepEqual(adapter.inspect(), before);
  const source = fs.readFileSync(path.join(__dirname, '../src/domain/providerLinkReadiness.js'), 'utf8');
  assert.doesNotMatch(source, /OAuth|authorizationCode|accessToken|refreshToken|exchangeDiscord|customToken/);
});

test('provider-subject hashing is domain-separated and durable state contains no raw provider secret', async () => {
  const sameSubject = 'same-provider-subject';
  const googleHash = subjectHasher(PROVIDERS.google, sameSubject);
  const discordHash = subjectHasher(PROVIDERS.discord, sameSubject);
  assert.notEqual(googleHash, discordHash);
  assert.notEqual(providerSubjectKey('google', googleHash), providerSubjectKey('discord', discordHash));

  const { adapter, operations } = harness({
    verifiedProviderEvidence: { [UID]: { [PROVIDERS.google]: evidence(UID, PROVIDERS.google, sameSubject) } }
  });
  const result = await operations.linkVerifiedProvider(input('google', 'redacted'), context());
  const serialized = JSON.stringify({ result, state: adapter.inspect() });
  assert.doesNotMatch(serialized, new RegExp(sameSubject));
  assert.doesNotMatch(serialized, /access[_-]?token|refresh[_-]?token|authorization[_-]?code|client[_-]?secret/i);
  assert.deepEqual(Object.keys(result), ['ok', 'operation', 'provider', 'status', 'replay']);
});

test('successful provider evidence cannot create a missing account or initialize unrelated product state', async () => {
  const seed = baseSeed();
  delete seed.accounts[UID];
  const adapter = createInMemoryProviderLinkAdapter(seed);
  const operations = createProviderLinkOperations({ adapter, now: () => NOW, subjectHasher });
  const before = adapter.inspect();
  await assert.rejects(operations.linkVerifiedProvider(input(), context()), (error) => error?.reason === 'identity/account_foundation_invalid');
  assert.deepEqual(adapter.inspect(), before);
});
