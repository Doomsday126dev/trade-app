'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GATES, createHandler, loadConfiguration } = require('../e1-authority-service/server');
const { createPublicTrainerShareReader } = require('../e1-authority-service/rtdbPublicTrainerShareReader');
const { STAGING } = require('../e1-authority-service/e1TargetContracts');

const OWNER_UID = 'providerOwnerUid123';

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: STAGING.environment,
    FIREBASE_PROJECT_ID: STAGING.projectId,
    EXPECTED_PROJECT_NUMBER: STAGING.projectNumber,
    FIRESTORE_DATABASE_ID: STAGING.databaseId,
    SERVICE_REGION: STAGING.region,
    AUTHORITY_SERVICE_NAME: STAGING.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: STAGING.runtimeServiceAccount,
    RTDB_DATABASE_URL: STAGING.rtdbDatabaseUrl,
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function storedProjection(overrides = {}) {
  return {
    schemaVersion: 1,
    shareVersion: 2,
    trainerName: 'ProviderTrainer',
    profile: { friendCode: '', bio: '', discord: '', avatarPokemon: 'Pikachu', lastUpdated: 100 },
    lists: { wishlist: { Pikachu: { p: 'H', shiny: true } }, dynamax: {}, gmax: {}, costumes: {} },
    publishedListTypes: { wishlist: true, dynamax: true, gmax: true, costumes: true },
    publishedAt: 100,
    updatedAt: 200,
    ...overrides
  };
}

function invoke(handler, body = { schemaVersion: 1, trainerHandle: 'providertrainer' }, method = 'POST') {
  return new Promise((resolve) => {
    const request = { method, url: '/v1/read-provider-public-share', headers: {} };
    const output = new EventEmitter();
    output.writeHead = (status, headers) => { output.status = status; output.headers = headers; };
    output.end = (payload) => resolve({ status: output.status, headers: output.headers, body: JSON.parse(payload) });
    handler(request, output);
  });
}

function handlerFixture({ gate = true, identity = { ownerUid: OWNER_UID, canonicalTrainerName: 'ProviderTrainer' },
  share = { status: 'ready', value: storedProjection() } } = {}) {
  const calls = { identities: [], shares: [], logs: [] };
  let requestBody = { schemaVersion: 1, trainerHandle: 'providertrainer' };
  const handler = createHandler(loadConfiguration(environment({
    READ_PROVIDER_PUBLIC_SHARE_ENABLED: String(gate)
  })), {
    readJsonRequest: async () => requestBody,
    publicShareReader: { read: async () => { throw new Error('unexpected default public reader'); } },
    readPublicShareIdentity: async (input) => { calls.identities.push(input); return identity; },
    readPublicTrainerShare: async (uid) => { calls.shares.push(uid); return share; },
    structuredLog: (_configuration, operation, outcome, _startedAt, extra) => calls.logs.push({ operation, outcome, extra })
  });
  return { handler, calls, setBody(value) { requestBody = value; } };
}

test('provider public authority is dormant by default before any identity or RTDB read', async () => {
  const fixture = handlerFixture({ gate: false });
  const result = await invoke(fixture.handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { code: 'E1_NOT_ENABLED' });
  assert.deepEqual(fixture.calls.identities, []);
  assert.deepEqual(fixture.calls.shares, []);
});

test('exact handle resolution returns only the sanitized public projection without Auth or UID metadata', async () => {
  const fixture = handlerFixture();
  const result = await invoke(fixture.handler);
  assert.equal(result.status, 200);
  assert.deepEqual(fixture.calls.identities, [{
    canonicalTrainerName: 'providertrainer',
    normalizedTrainerName: 'providertrainer',
    handleKey: fixture.calls.identities[0].handleKey
  }]);
  assert.match(fixture.calls.identities[0].handleKey, /^v1_[a-f0-9]{4,128}$/u);
  assert.deepEqual(fixture.calls.shares, [OWNER_UID]);
  assert.equal(result.body.code, 'SUCCESS');
  assert.equal(result.body.share.username, 'ProviderTrainer');
  assert.deepEqual(Object.keys(result.body.share).sort(),
    ['lists', 'profile', 'publishedListTypes', 'updatedAt', 'username', 'version']);
  assert.doesNotMatch(JSON.stringify(result.body), /ownerUid|authUid|email|token|credential|providerData/u);
  assert.equal(JSON.stringify(fixture.calls.logs).includes('ProviderTrainer'), false);
  assert.match(fixture.calls.logs.at(-1).extra.handleHash, /^[a-f0-9]{16}$/u);
});

test('missing identity and missing projection are indistinguishable public not-found results', async () => {
  const noIdentity = handlerFixture({ identity: null });
  assert.deepEqual((await invoke(noIdentity.handler)).body, { code: 'SHARE_NOT_FOUND' });
  assert.deepEqual(noIdentity.calls.shares, []);
  const noShare = handlerFixture({ share: { status: 'not-found' } });
  assert.deepEqual((await invoke(noShare.handler)).body, { code: 'SHARE_NOT_FOUND' });
});

test('invalid requests conflicting identity and malformed projections fail closed', async () => {
  const invalid = handlerFixture();
  invalid.setBody({ schemaVersion: 1, trainerHandle: 'bad/name' });
  assert.deepEqual(await invoke(invalid.handler), {
    status: 400,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 26 },
    body: { code: 'REQUEST_INVALID' }
  });
  assert.deepEqual(invalid.calls.identities, []);

  const conflict = handlerFixture();
  conflict.calls.identities.length = 0;
  const conflictHandler = createHandler(loadConfiguration(environment({ READ_PROVIDER_PUBLIC_SHARE_ENABLED: 'true' })), {
    readJsonRequest: async () => ({ schemaVersion: 1, trainerHandle: 'ProviderTrainer' }),
    publicShareReader: { read: async () => { throw new Error('not reached'); } },
    readPublicShareIdentity: async () => { throw Object.assign(new Error('conflict'), { code: 'e1/public-identity-conflict' }); },
    structuredLog: () => {}
  });
  assert.deepEqual((await invoke(conflictHandler)).body, { code: 'PUBLIC_IDENTITY_CONFLICT' });

  const malformed = handlerFixture({ share: { status: 'ready', value: storedProjection({ ownerUid: OWNER_UID }) } });
  const malformedResult = await invoke(malformed.handler);
  assert.equal(malformedResult.status, 409);
  assert.deepEqual(malformedResult.body, { code: 'PUBLIC_SHARE_INVALID' });
});

test('exact RTDB projection reader performs one bounded anonymous GET with no credential or parent query', async () => {
  const calls = [];
  const reader = createPublicTrainerShareReader({
    environment: STAGING.environment,
    projectId: STAGING.projectId,
    databaseUrl: STAGING.rtdbDatabaseUrl,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(storedProjection())
      };
    }
  });
  const result = await reader.read(OWNER_UID);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${STAGING.rtdbDatabaseUrl}/trainerShares/${OWNER_UID}.json`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(new URL(calls[0].url).search, '');
  assert.doesNotMatch(JSON.stringify(calls), /authorization|access_token|idToken|credential/iu);
});

test('RTDB projection reader rejects invalid UIDs oversized bodies and permission failures', async () => {
  let calls = 0;
  const create = (response) => createPublicTrainerShareReader({
    environment: STAGING.environment,
    projectId: STAGING.projectId,
    databaseUrl: STAGING.rtdbDatabaseUrl,
    fetchImpl: async () => { calls += 1; return response; }
  });
  assert.equal((await create({}).read('bad/uid')).status, 'invalid-input');
  assert.equal(calls, 0);
  const oversized = await create({ ok: true, status: 200, headers: { get: () => String(600 * 1024) }, text: async () => '{}' })
    .read(OWNER_UID);
  assert.equal(oversized.status, 'oversized');
  const denied = await create({ ok: false, status: 403, headers: { get: () => null }, text: async () => '' }).read(OWNER_UID);
  assert.equal(denied.status, 'permission-denied');
});
