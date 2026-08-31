'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../js/dev/discordOAuthPrototypeClient.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:8878';
const REQUEST_KEY = 'pogo.discord.prototype.request';

function environment(options = {}) {
  const values = new Map();
  const writes = [];
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { writes.push({ type: 'set', key, value: String(value) }); values.set(key, String(value)); },
    removeItem: (key) => { writes.push({ type: 'remove', key }); values.delete(key); }
  };
  let href = options.href || `${ORIGIN}/trade-app/`;
  const assigned = [];
  const location = {
    get href() { return href; },
    set href(value) { href = value; },
    assign(value) { assigned.push(value); }
  };
  const replaced = [];
  const history = { state: null, replaceState: (...args) => replaced.push(args) };
  let byte = 0;
  const cryptoApi = { getRandomValues(array) { for (let i = 0; i < array.length; i += 1) array[i] = (byte++ % 251) + 1; return array; } };
  const calls = [];
  const fetchImpl = options.fetchImpl || (async (url, init) => {
    calls.push({ url, init });
    const payload = JSON.parse(init.body);
    if (url.endsWith('/begin')) {
      const authorize = new URL('https://discord.com/oauth2/authorize');
      authorize.search = new URLSearchParams({
        response_type: 'code', client_id: '157730590492196864', redirect_uri: `${ORIGIN}/trade-app/`,
        scope: 'identify', state: 's'.repeat(43), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256'
      });
      return new Response(JSON.stringify({ authorizeUrl: authorize.href, expiresInMs: 300000 }), { status: 200 });
    }
    const result = options.completeResult || { ok: true, operation: payload.requestId.includes('') ? 'link' : 'link', status: 'linked', replay: false };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const window = { btoa, fetch: fetchImpl, location, history, sessionStorage: storage, crypto: cryptoApi };
  vm.runInNewContext(SOURCE, { window, URL, Uint8Array, JSON, Object, Error, TypeError });
  return { api: window.PogoDev.discordOAuthPrototypeClient, storage, values, writes, location, assigned, replaced, calls, fetchImpl, cryptoApi, history };
}

test('begin stores only browser continuation metadata and redirects to exact identify code flow', async () => {
  const env = environment();
  const authHeaders = [];
  const client = env.api.createDiscordOAuthPrototypeClient({
    fetchImpl: env.fetchImpl,
    location: env.location,
    history: env.history,
    storage: env.storage,
    cryptoApi: env.cryptoApi,
    getAuthorizationHeader: async () => { authHeaders.push(true); return 'Bearer synthetic-firebase-id-token'; }
  });
  const result = await client.begin('link');
  assert.deepEqual({ ...result }, { status: 'redirecting' });
  assert.equal(authHeaders.length, 1);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].init.credentials, 'same-origin');
  assert.equal(env.calls[0].init.headers.authorization, 'Bearer synthetic-firebase-id-token');
  const authorize = new URL(env.assigned[0]);
  assert.equal(authorize.origin, 'https://discord.com');
  assert.equal(authorize.searchParams.get('scope'), 'identify');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.has('client_secret'), false);
  assert.ok(env.values.has(REQUEST_KEY));
  const persisted = JSON.stringify([...env.values]);
  assert.doesNotMatch(persisted, /client.secret|access.token|custom.token/i);
});

test('signed-out linked completion passes custom token directly to Firebase and never persists it', async () => {
  const customToken = 'firebase-custom-token-ephemeral';
  const env = environment({
    href: `${ORIGIN}/trade-app/?code=discord-code&state=${'s'.repeat(43)}`,
    completeResult: { ok: true, operation: 'sign-in', status: 'existing-account', customToken }
  });
  env.values.set(REQUEST_KEY, JSON.stringify({ operation: 'sign-in', requestId: 'discord-request-client' }));
  const signedIn = [];
  const client = env.api.createDiscordOAuthPrototypeClient({
    fetchImpl: env.fetchImpl,
    location: env.location,
    history: env.history,
    storage: env.storage,
    cryptoApi: env.cryptoApi,
    signInWithCustomToken: async (token) => signedIn.push(token)
  });
  const result = await client.completeFromLocation();
  assert.deepEqual({ ...result }, { status: 'existing-account' });
  assert.deepEqual(signedIn, [customToken]);
  assert.equal(env.values.has(REQUEST_KEY), false);
  assert.equal(JSON.stringify(env.writes).includes(customToken), false);
  assert.equal(env.calls[0].init.body.includes('discord-code'), true);
  assert.equal(env.replaced.length, 1);
  assert.doesNotMatch(env.replaced[0][2], /code=|state=/);
});

test('unlinked identity is explicit onboarding and link completion never invokes Firebase sign-in', async () => {
  for (const [operation, completeResult, expected] of [
    ['sign-in', { ok: true, operation: 'sign-in', status: 'onboarding-required' }, 'onboarding-required'],
    ['link', { ok: true, operation: 'link', status: 'already-linked', replay: true }, 'already-linked']
  ]) {
    const env = environment({ href: `${ORIGIN}/trade-app/?code=discord-code&state=${'s'.repeat(43)}`, completeResult });
    env.values.set(REQUEST_KEY, JSON.stringify({ operation, requestId: `discord-request-${operation}` }));
    const signedIn = [];
    const client = env.api.createDiscordOAuthPrototypeClient({
      fetchImpl: env.fetchImpl,
      location: env.location,
      history: env.history,
      storage: env.storage,
      cryptoApi: env.cryptoApi,
      getAuthorizationHeader: async () => 'Bearer current-user',
      signInWithCustomToken: async (token) => signedIn.push(token)
    });
    const result = await client.completeFromLocation();
    assert.equal(result.status, expected);
    assert.deepEqual(signedIn, []);
  }
});

test('unsafe authorization URLs and incomplete or missing continuations fail before account mutation', async () => {
  const unsafe = environment({
    fetchImpl: async () => new Response(JSON.stringify({
      authorizeUrl: `https://evil.example/oauth?response_type=token&scope=identify%20guilds&client_secret=oops`,
      expiresInMs: 300000
    }), { status: 200 })
  });
  const unsafeClient = unsafe.api.createDiscordOAuthPrototypeClient({
    fetchImpl: unsafe.fetchImpl,
    location: unsafe.location,
    history: unsafe.history,
    storage: unsafe.storage,
    cryptoApi: unsafe.cryptoApi
  });
  await assert.rejects(unsafeClient.begin('sign-in'), /Unsafe Discord authorization URL/);
  assert.deepEqual(unsafe.assigned, []);

  const missing = environment({ href: `${ORIGIN}/trade-app/?code=one&state=${'s'.repeat(43)}` });
  const missingClient = missing.api.createDiscordOAuthPrototypeClient({
    fetchImpl: missing.fetchImpl,
    location: missing.location,
    history: missing.history,
    storage: missing.storage,
    cryptoApi: missing.cryptoApi
  });
  await assert.rejects(missingClient.completeFromLocation(), /continuation missing/);
  assert.equal(missing.calls.length, 0);
});

test('client source contains no Discord secret, provider token storage, email merge, or production loader hook', () => {
  assert.doesNotMatch(SOURCE, /DISCORD_CLIENT_SECRET|refresh_token|guilds|connections|email/i);
  assert.equal((SOURCE.match(/client_secret/g) || []).length, 1, 'the only client_secret reference is the unsafe-URL rejection guard');
  assert.doesNotMatch(SOURCE, /localStorage|indexedDB|accountSync|journal/i);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inventory = fs.readFileSync(path.join(__dirname, '../scripts/pages/frontend-files.json'), 'utf8');
  assert.doesNotMatch(html, /discordOAuthPrototypeClient/);
  assert.doesNotMatch(inventory, /discordOAuthPrototypeClient/);
});
