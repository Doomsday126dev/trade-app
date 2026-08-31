'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DISCORD_SCOPE,
  FLOW_TTL_MS,
  MAX_BEGIN_PER_WINDOW,
  createDiscordOAuthPrototype,
  pkceChallenge
} = require('../src/prototype/discordOAuthPrototype');
const { createInMemoryDiscordOAuthStore } = require('../src/prototype/inMemoryDiscordOAuthStore');
const {
  DEFAULT_REVOKE_ENDPOINT,
  DEFAULT_TOKEN_ENDPOINT,
  DEFAULT_USER_ENDPOINT,
  createDiscordHttpAdapter
} = require('../src/prototype/discordHttpAdapter');
const { BINDING_COOKIE, createDiscordOAuthHttpHandler } = require('../src/prototype/discordOAuthHttpHandler');

const NOW = 1_800_000_000_000;
const UID_A = 'firebase_uid_alpha';
const UID_B = 'firebase_uid_beta';
const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const SUBJECT_A = '80351110224678912';
const SUBJECT_B = '80351110224678913';
const CLIENT_ID = '157730590492196864';
const CLIENT_SECRET = 'injected-test-client-secret';
const STATE_PEPPER = 'injected-test-state-pepper';
const SUBJECT_PEPPER = 'injected-test-subject-pepper';
const ORIGIN = 'http://127.0.0.1:8878';
const REDIRECT_URI = `${ORIGIN}/discord-oauth-callback`;
const BINDING_A = Buffer.alloc(32, 1).toString('base64url');
const BINDING_B = Buffer.alloc(32, 2).toString('base64url');

function authority(uid = UID_A) {
  return Object.freeze({
    uid,
    lifecycleId: uid === UID_A ? 'lifecycle-alpha' : 'lifecycle-beta',
    accountFingerprint: uid === UID_A ? FINGERPRINT_A : FINGERPRINT_B,
    recentAuth: true
  });
}

function seed() {
  return {
    accounts: {
      [UID_A]: {
        uid: UID_A,
        status: 'active',
        accountFingerprint: FINGERPRINT_A,
        trainerIdentity: { name: 'AlphaTrainer' },
        journalFingerprint: 'journal-alpha',
        providers: {}
      },
      [UID_B]: {
        uid: UID_B,
        status: 'active',
        accountFingerprint: FINGERPRINT_B,
        trainerIdentity: { name: 'BetaTrainer' },
        journalFingerprint: 'journal-beta',
        providers: {}
      }
    },
    privateLists: { [UID_A]: { wishlist: { one: { priority: 'H' } } } },
    publicShares: { AlphaTrainer: { ownerUid: UID_A, count: 1 } },
    migrations: { [UID_A]: { state: 'complete', reviewedCount: 66 } }
  };
}

function requestId(label) {
  return `discord-${label.padEnd(12, 'x')}`;
}

function harness(options = {}) {
  let timestamp = NOW;
  let current = options.currentAuthority === undefined ? authority() : options.currentAuthority;
  const calls = { exchange: [], identity: [], revoke: [], mint: [], audit: [] };
  const subjectForCode = options.subjectForCode || ((code) => code.includes('subject-b') ? SUBJECT_B : SUBJECT_A);
  const discord = options.discord || {
    async exchangeCode(input) {
      calls.exchange.push(structuredClone(input));
      return {
        accessToken: `access-token-${input.code}`,
        refreshToken: `refresh-token-${input.code}`,
        tokenType: 'Bearer',
        scope: options.scope || DISCORD_SCOPE,
        expiresIn: 600
      };
    },
    async getCurrentUser({ accessToken }) {
      calls.identity.push(accessToken);
      if (options.onIdentity) options.onIdentity({ setAuthority: (value) => { current = value; } });
      return { subject: subjectForCode(accessToken) };
    },
    async revokeToken(input) {
      calls.revoke.push(structuredClone(input));
      if (options.revokeFailure) throw new Error('synthetic revoke failure with token');
    }
  };
  const store = createInMemoryDiscordOAuthStore(options.seed || seed());
  const oauth = createDiscordOAuthPrototype({
    config: {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      statePepper: STATE_PEPPER,
      subjectPepper: SUBJECT_PEPPER
    },
    store,
    discord,
    customTokenMinter: async (uid) => {
      calls.mint.push(uid);
      return `firebase-custom-token-for-${uid}`;
    },
    now: () => timestamp,
    audit: (event) => calls.audit.push(event)
  });
  const currentAuthority = async () => current;
  async function begin(operation, label, binding = BINDING_A) {
    const id = requestId(label);
    const result = await oauth.begin({ operation, requestId: id, browserBinding: binding, clientKey: binding, currentAuthority });
    const url = new URL(result.authorizeUrl);
    return { id, result, url, state: url.searchParams.get('state') };
  }
  async function complete(flow, code, binding = BINDING_A, extra = {}) {
    return oauth.complete({
      state: flow.state,
      code,
      requestId: flow.id,
      browserBinding: binding,
      clientKey: binding,
      observedRedirectUri: REDIRECT_URI,
      currentAuthority,
      ...extra
    });
  }
  return {
    store,
    oauth,
    calls,
    begin,
    complete,
    advance: (ms) => { timestamp += ms; },
    setAuthority: (value) => { current = value; },
    currentAuthority
  };
}

test('authorization request is code-flow, one-scope, state-bound, and S256 PKCE only', async () => {
  const h = harness();
  const flow = await h.begin('link', 'authorize');
  assert.equal(flow.url.origin, 'https://discord.com');
  assert.equal(flow.url.pathname, '/oauth2/authorize');
  assert.equal(flow.url.searchParams.get('response_type'), 'code');
  assert.equal(flow.url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(flow.url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(flow.url.searchParams.get('scope'), 'identify');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(flow.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(flow.url.searchParams.has('client_secret'), false);
  assert.equal(flow.url.searchParams.has('guilds'), false);
  const stored = Object.values(h.store.inspect().flowStates)[0];
  assert.equal(stored.codeVerifier, '[private]');
  assert.equal(stored.codeChallenge, flow.url.searchParams.get('code_challenge'));
  assert.equal(stored.authority.uid, UID_A);
});

test('server HTTP adapter uses form-encoded authorization-code exchange, basic secret, identity, and revocation', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init: { ...init, headers: { ...init.headers } } });
    if (url === DEFAULT_TOKEN_ENDPOINT) {
      return new Response(JSON.stringify({ access_token: 'discord-access-token', refresh_token: 'discord-refresh-token', token_type: 'Bearer', scope: 'identify', expires_in: 600 }), { status: 200 });
    }
    if (url === DEFAULT_USER_ENDPOINT) return new Response(JSON.stringify({ id: SUBJECT_A, username: 'IgnoredName', email: 'ignored@example.test' }), { status: 200 });
    if (url === DEFAULT_REVOKE_ENDPOINT) return new Response('', { status: 200 });
    throw new Error('unexpected endpoint');
  };
  const adapter = createDiscordHttpAdapter({ fetchImpl });
  const exchanged = await adapter.exchangeCode({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: 'one-time-code', redirectUri: REDIRECT_URI, codeVerifier: 'v'.repeat(43) });
  const identity = await adapter.getCurrentUser({ accessToken: exchanged.accessToken });
  await adapter.revokeToken({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, token: exchanged.accessToken, tokenTypeHint: 'access_token' });
  await adapter.revokeToken({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, token: exchanged.refreshToken, tokenTypeHint: 'refresh_token' });
  assert.deepEqual(identity, { subject: SUBJECT_A });
  assert.equal(requests[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.match(requests[0].init.headers.authorization, /^Basic /);
  assert.doesNotMatch(requests[0].init.body, /client_secret|injected-test-client-secret/);
  assert.equal(new URLSearchParams(requests[0].init.body).get('grant_type'), 'authorization_code');
  assert.equal(new URLSearchParams(requests[0].init.body).get('code_verifier'), 'v'.repeat(43));
  assert.equal(requests[1].init.headers.authorization, 'Bearer discord-access-token');
  assert.equal(new URLSearchParams(requests[2].init.body).get('token'), 'discord-access-token');
  assert.equal(new URLSearchParams(requests[3].init.body).get('token'), 'discord-refresh-token');
});

test('existing-user link atomically preserves UID and all non-provider account state', async () => {
  const h = harness();
  const before = h.store.inspect();
  const flow = await h.begin('link', 'preserves');
  const result = await h.complete(flow, 'code-subject-a');
  const after = h.store.inspect();
  assert.deepEqual(result, { ok: true, operation: 'link', status: 'linked', replay: false });
  assert.deepEqual(after.accounts[UID_A].trainerIdentity, before.accounts[UID_A].trainerIdentity);
  assert.equal(after.accounts[UID_A].journalFingerprint, before.accounts[UID_A].journalFingerprint);
  for (const root of ['privateLists', 'publicShares', 'migrations']) assert.deepEqual(after[root], before[root], root);
  assert.equal(after.accounts[UID_B].providers.discord, undefined);
  assert.match(after.accounts[UID_A].providers.discord.providerSubjectKey, /^v1_discord_[a-f0-9]{64}$/);
  assert.equal(after.providerSubjects[after.accounts[UID_A].providers.discord.providerSubjectKey].uid, UID_A);
  assert.equal(h.calls.mint.length, 0);
  assert.equal(h.calls.revoke.length, 2);
  assert.doesNotMatch(JSON.stringify(after), new RegExp(SUBJECT_A));
});

test('subject collision and a second subject on one account are both no-mutation failures', async () => {
  const h = harness();
  h.setAuthority(authority(UID_B));
  const beta = await h.begin('link', 'beta-claim', BINDING_B);
  await h.complete(beta, 'code-subject-a', BINDING_B);
  h.setAuthority(authority(UID_A));
  const collision = await h.begin('link', 'alpha-collision');
  const beforeCollision = h.store.inspect();
  await assert.rejects(h.complete(collision, 'code-subject-a'), (error) => error?.reason === 'provider/subject_already_linked');
  const afterCollision = h.store.inspect();
  assert.deepEqual(afterCollision.accounts, beforeCollision.accounts);
  assert.deepEqual(afterCollision.providerSubjects, beforeCollision.providerSubjects);
  h.setAuthority(authority(UID_B));
  const second = await h.begin('link', 'beta-second', BINDING_B);
  const beforeSecond = h.store.inspect();
  await assert.rejects(h.complete(second, 'code-subject-b', BINDING_B), (error) => error?.reason === 'provider/account_already_linked');
  const afterSecond = h.store.inspect();
  assert.deepEqual(afterSecond.accounts, beforeSecond.accounts);
  assert.deepEqual(afterSecond.providerSubjects, beforeSecond.providerSubjects);
});

test('link fails closed if auth lifecycle changes while Discord identity is resolving', async () => {
  const h = harness({ onIdentity: ({ setAuthority }) => setAuthority({ ...authority(), lifecycleId: 'lifecycle-replaced' }) });
  const flow = await h.begin('link', 'lifecycle');
  const before = h.store.inspect();
  await assert.rejects(h.complete(flow, 'code-subject-a'), (error) => error?.reason === 'discord/auth_lifecycle_changed');
  const after = h.store.inspect();
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.providerSubjects, before.providerSubjects);
  assert.equal(h.calls.revoke.length, 2);
});

test('linked signed-out login mints a custom token for the exact mapped UID only', async () => {
  const h = harness();
  const link = await h.begin('link', 'login-link');
  await h.complete(link, 'code-subject-a');
  h.setAuthority(null);
  const login = await h.begin('sign-in', 'login-existing');
  const result = await h.complete(login, 'code-subject-a');
  assert.deepEqual(result, {
    ok: true,
    operation: 'sign-in',
    status: 'existing-account',
    customToken: `firebase-custom-token-for-${UID_A}`
  });
  assert.deepEqual(h.calls.mint, [UID_A]);
  assert.doesNotMatch(JSON.stringify(h.store.inspect()), /firebase-custom-token|access-token/);
});

test('unlinked Discord identity enters explicit onboarding without email matching or account mutation', async () => {
  const h = harness({ currentAuthority: null });
  const before = h.store.inspect();
  const flow = await h.begin('sign-in', 'onboarding');
  const result = await h.complete(flow, 'code-subject-b');
  const after = h.store.inspect();
  assert.deepEqual(result, { ok: true, operation: 'sign-in', status: 'onboarding-required' });
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.providerSubjects, before.providerSubjects);
  assert.equal(h.calls.mint.length, 0);
  assert.equal(JSON.stringify(after).includes('@'), false);
});

test('state, browser, request, redirect, expiry, and replay validation all fail closed', async (t) => {
  await t.test('unknown state', async () => {
    const h = harness();
    const flow = await h.begin('link', 'unknown-state');
    await assert.rejects(h.complete({ ...flow, state: BINDING_B }, 'code-subject-a'), (error) => error?.reason === 'discord/state_unknown');
  });
  await t.test('copied browser state', async () => {
    const h = harness();
    const flow = await h.begin('link', 'wrong-browser');
    await assert.rejects(h.complete(flow, 'code-subject-a', BINDING_B), (error) => error?.reason === 'discord/browser_binding_mismatch');
  });
  await t.test('request mismatch', async () => {
    const h = harness();
    const flow = await h.begin('link', 'wrong-request');
    await assert.rejects(h.complete({ ...flow, id: requestId('different') }, 'code-subject-a'), (error) => error?.reason === 'idempotency/request_reused');
  });
  await t.test('redirect mismatch', async () => {
    const h = harness();
    const flow = await h.begin('link', 'wrong-redirect');
    await assert.rejects(h.complete(flow, 'code-subject-a', BINDING_A, { observedRedirectUri: `${ORIGIN}/other` }), (error) => error?.reason === 'discord/redirect_mismatch');
  });
  await t.test('expired state', async () => {
    const h = harness();
    const flow = await h.begin('link', 'expired');
    h.advance(FLOW_TTL_MS + 1);
    await assert.rejects(h.complete(flow, 'code-subject-a'), (error) => error?.reason === 'discord/state_expired');
  });
  await t.test('replay', async () => {
    const h = harness();
    const flow = await h.begin('link', 'replay');
    await h.complete(flow, 'code-subject-a');
    const before = h.store.inspect();
    await assert.rejects(h.complete(flow, 'code-subject-a'), (error) => error?.reason === 'discord/state_replayed');
    assert.deepEqual(h.store.inspect().accounts, before.accounts);
    assert.equal(h.calls.exchange.length, 1);
  });
});

test('PKCE verifier reaches only the token endpoint and invalid scope or identity revokes before failing', async () => {
  const invalidScope = harness({ scope: 'identify guilds' });
  const scopeFlow = await invalidScope.begin('link', 'bad-scope');
  await assert.rejects(invalidScope.complete(scopeFlow, 'code-subject-a'), (error) => error?.reason === 'discord/token_response_invalid');
  const challenge = scopeFlow.url.searchParams.get('code_challenge');
  assert.equal(pkceChallenge(invalidScope.calls.exchange[0].codeVerifier), challenge);
  assert.equal(invalidScope.calls.identity.length, 0);
  assert.equal(invalidScope.calls.revoke.length, 2);

  const badIdentityDiscord = {
    async exchangeCode() { return { accessToken: 'valid-access-token', tokenType: 'Bearer', scope: 'identify' }; },
    async getCurrentUser() { return { subject: 'not-a-snowflake' }; },
    async revokeToken() { badIdentityDiscord.revoked = true; }
  };
  const badIdentity = harness({ discord: badIdentityDiscord });
  const identityFlow = await badIdentity.begin('link', 'bad-identity');
  await assert.rejects(badIdentity.complete(identityFlow, 'code-subject-a'), (error) => error?.reason === 'discord/identity_invalid');
  assert.equal(badIdentityDiscord.revoked, true);
  assert.deepEqual(badIdentity.store.inspect().providerSubjects, {});
});

test('link operation is idempotent while a reused request for another subject fails without mutation', async () => {
  const h = harness();
  const first = await h.begin('link', 'idempotent');
  await h.complete(first, 'code-subject-a');
  const second = await h.begin('link', 'idempotent');
  const replay = await h.complete(second, 'code-subject-a');
  assert.deepEqual(replay, { ok: true, operation: 'link', status: 'linked', replay: true });
  const third = await h.begin('link', 'idempotent');
  const before = h.store.inspect();
  await assert.rejects(h.complete(third, 'code-subject-b'), (error) => error?.reason === 'idempotency/request_reused');
  const after = h.store.inspect();
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.providerSubjects, before.providerSubjects);
});

test('per-browser begin rate limit is bounded and does not invoke Discord', async () => {
  const h = harness();
  for (let index = 0; index < MAX_BEGIN_PER_WINDOW; index += 1) await h.begin('link', `rate-${index}`);
  await assert.rejects(h.begin('link', 'rate-over'), (error) => error?.reason === 'discord/rate_limited');
  assert.equal(h.calls.exchange.length, 0);
});

test('local HTTP boundary rejects production, non-loopback, cross-origin, bad schema, and leaks no internals', async () => {
  const h = harness();
  assert.throws(() => createDiscordOAuthHttpHandler({ environment: 'production', allowedOrigin: ORIGIN, oauth: h.oauth, resolveAuthority: h.currentAuthority }), /development-only/);
  assert.throws(() => createDiscordOAuthHttpHandler({ environment: 'development', allowedOrigin: 'https://example.com', oauth: h.oauth, resolveAuthority: h.currentAuthority }), /loopback/);
  const handler = createDiscordOAuthHttpHandler({ environment: 'development', allowedOrigin: ORIGIN, oauth: h.oauth, resolveAuthority: h.currentAuthority });
  const make = (route, payload, origin = ORIGIN, cookie = '') => new Request(`${ORIGIN}/__local/discord/oauth/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload)
  });
  const denied = await handler(make('begin', { operation: 'link', requestId: requestId('http-origin') }, 'http://localhost:8878'));
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, error: { code: 'permission_denied', reason: 'request/origin_invalid' } });
  const schema = await handler(make('begin', { operation: 'link', requestId: requestId('http-schema'), secret: CLIENT_SECRET }));
  assert.equal(schema.status, 400);
  assert.doesNotMatch(await schema.text(), /injected-test|client-secret/);
  const accepted = await handler(make('begin', { operation: 'link', requestId: requestId('http-good') }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'no-store, max-age=0');
  assert.match(accepted.headers.get('set-cookie'), new RegExp(`^${BINDING_COOKIE}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax;`));
  const acceptedPayload = await accepted.json();
  const acceptedUrl = new URL(acceptedPayload.authorizeUrl);
  assert.equal(acceptedUrl.searchParams.get('scope'), 'identify');
  const completionPayload = {
    code: 'http-code-value',
    requestId: requestId('http-good'),
    state: acceptedUrl.searchParams.get('state')
  };
  const missingCookie = await handler(make('complete', completionPayload));
  assert.equal(missingCookie.status, 403);
  assert.equal((await missingCookie.json()).error.reason, 'discord/browser_binding_missing');
  const cookie = accepted.headers.get('set-cookie').split(';')[0];
  const completed = await handler(make('complete', completionPayload, ORIGIN, cookie));
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).status, 'linked');
});

test('audit and private state contain no code, provider token, custom token, raw subject, or client secret', async () => {
  const h = harness();
  const link = await h.begin('link', 'redaction');
  await h.complete(link, 'sensitive-code-value');
  h.setAuthority(null);
  const login = await h.begin('sign-in', 'redaction-login');
  await h.complete(login, 'sensitive-code-value');
  const serialized = JSON.stringify({ store: h.store.inspect(), audit: h.calls.audit });
  for (const forbidden of [CLIENT_SECRET, SUBJECT_A, 'sensitive-code-value', 'access-token', 'firebase-custom-token']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.ok(h.calls.audit.every((entry) => Object.keys(entry).sort().join(',') === 'correlation,event'));
});

test('prototype remains absent from deployed Functions and production frontend inventories', () => {
  const root = path.join(__dirname, '../..');
  const deployedFunctions = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const frontendInventory = fs.readFileSync(path.join(root, 'scripts/pages/frontend-files.json'), 'utf8');
  for (const source of [deployedFunctions, html, serviceWorker, frontendInventory]) {
    assert.doesNotMatch(source, /discordOAuthPrototype|discord-oauth-prototype|discordOAuthHttpHandler/);
  }
  assert.doesNotMatch(deployedFunctions, /DISCORD_CLIENT_SECRET|createCustomToken/);
});
