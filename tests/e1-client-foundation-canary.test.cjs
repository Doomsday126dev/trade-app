'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createFixture } = require('../functions/test/helpers/groupEFixture.cjs');
const { capabilityDigest, sessionGenerationContext,
  sessionGenerationDigest } = require('../functions/e1-gateway/groupEAdmission');
const { redactFoundationDocument } = require('../functions/e1-authority-service/server');

const source = fs.readFileSync(path.resolve(__dirname, '../js/services/e1ClientFoundationCanary.js'), 'utf8');
const ORIGIN = 'https://doomsday126dev.github.io';
const PATHNAME = '/trade-app/';
const RECEIPT_DIGEST = '8'.repeat(64);
const RUNTIME_VECTOR_JSON = '[1,"group-e-browser-runtime-instance","https://doomsday126dev.github.io",' +
  '"/trade-app/","2222222222222222222222222222222222222222222222222222222222222222",' +
  '"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"]';
const RUNTIME_VECTOR_SHA256 = '09d9e22f6f86eecee04772308d16863de73a3cc38a116f37e6028ce465b2cb37';

function digest(parts) { return crypto.createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex'); }

function load({ nonceBytes = null, origin = ORIGIN, pathname = PATHNAME } = {}) {
  let randomCalls = 0;
  const runtimeCrypto = {
    subtle: crypto.webcrypto.subtle,
    getRandomValues(value) {
      randomCalls++;
      if (nonceBytes) {
        assert.equal(value.byteLength, 32);
        value.set(nonceBytes);
        return value;
      }
      return crypto.webcrypto.getRandomValues(value);
    }
  };
  const window = {
    crypto: runtimeCrypto,
    location: { origin, pathname },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64')
  };
  vm.runInNewContext(source, { window, TextEncoder, Uint8Array, setTimeout, clearTimeout });
  return Object.freeze({ service: window.PogoServices.e1ClientFoundationCanary,
    randomCalls: () => randomCalls });
}

function success(uid, attemptId, code = 'SUCCESS') {
  const envelope = {
    schemaVersion: 1,
    code,
    attemptHash: digest([1, 'group-e-client-attempt', attemptId]).slice(0, 16),
    admissionReceiptDigest: RECEIPT_DIGEST,
    subjectBinding: digest([1, 'group-e-client-response', uid, attemptId, RECEIPT_DIGEST])
  };
  if (code !== 'FOUNDATION_NOT_INITIALIZED') {
    envelope.foundation = {
      schemaVersion: 1,
      canonicalTrainerName: 'Synthetic A',
      normalizedTrainerName: 'synthetica',
      handleKey: 'v1_73796e74686574696361',
      legacyUsername: 'Synthetic A',
      status: code === 'ACCOUNT_FROZEN' ? 'frozen' : 'active',
      revision: 1,
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z'
    };
  }
  return envelope;
}

function setup(overrides = {}, loadOptions = {}) {
  const loaded = load(loadOptions);
  const service = loaded.service;
  const fixture = createFixture();
  const firebaseApp = { options: { appId: fixture.FIREBASE_APP_ID } };
  const appCheckInstance = {};
  let currentAppCheckInstance = appCheckInstance;
  let sessionGeneration = fixture.SESSION_GENERATION.A;
  let imports = 0;
  let calls = 0;
  let appCheckReadyCalls = 0;
  let lastBody;
  const auth = { currentUser: { uid: fixture.UID.A,
    getIdToken: async (force) => { assert.equal(force, true); return 'synthetic-id-token'; } } };
  const sdk = {
    getFunctions(receivedApp, region) {
      assert.equal(receivedApp, firebaseApp);
      assert.equal(region, 'us-central1');
      return {};
    },
    httpsCallable(_functions, name, options) {
      assert.equal(name, 'readE1AccountFoundation');
      assert.equal(JSON.stringify(options), JSON.stringify({ limitedUseAppCheckTokens: true }));
      return async (body) => {
        calls++;
        lastBody = body;
        return { data: success(auth.currentUser.uid, body.attemptId) };
      };
    }
  };
  const dependencies = {
    firebaseApp,
    auth,
    firebaseAppCheckReady: async () => { appCheckReadyCalls++; return { ok: true, instance: currentAppCheckInstance }; },
    getSessionGeneration: () => sessionGeneration,
    getBrowserContextDigest: () => service.browserContextDigest(ORIGIN, PATHNAME, firebaseApp.options.appId, crypto.webcrypto),
    importFunctionsSdk: async () => { imports++; return sdk; },
    cryptoImpl: crypto.webcrypto,
    timeoutMs: 1000,
    now: () => fixture.NOW,
    ...overrides
  };
  function controller() { return service.createClientFoundationCanary(dependencies); }
  async function configuration(slot = 'A', capabilityOverrides = {}) {
    const browserContextDigest = await service.browserContextDigest(ORIGIN, PATHNAME, fixture.FIREBASE_APP_ID,
      crypto.webcrypto);
    const runtimeInstanceDigest = await service.runtimeInstanceDigest(fixture.run.firebaseAppIdHash);
    const signed = fixture.signedRequest(slot, { capability: { browserContextDigest, runtimeInstanceDigest,
      sessionGeneration, ...capabilityOverrides } });
    return { schemaVersion: 1, capability: signed.capability, signature: signed.signature,
      publicKeySpki: fixture.publicKeySpki };
  }
  async function storedEnvelope(slot = 'A', capabilityOverrides = {}) {
    const browserConfiguration = await configuration(slot, capabilityOverrides);
    return { ...browserConfiguration, capabilityDigest: capabilityDigest(browserConfiguration.capability) };
  }
  return {
    service, fixture, firebaseApp, appCheckInstance, auth, dependencies, controller, configuration, storedEnvelope,
    stats: () => ({ imports, calls, appCheckReadyCalls, lastBody }),
    randomCalls: loaded.randomCalls,
    sessionGeneration: () => sessionGeneration,
    switchSession: () => { sessionGeneration++; },
    replaceAppCheckInstance: (instance) => { currentAppCheckInstance = instance; }
  };
}

test('client is disabled by default and a signed capability permits one terminal callable only', async () => {
  const state = setup();
  const controller = state.controller();
  assert.equal(controller.isEnabled(), false);
  assert.equal(controller.currentResult(), null);
  await assert.rejects(controller.read({ attemptId: state.fixture.ATTEMPT.A }), /group-e\/disabled/);
  assert.deepEqual(state.stats(), { imports: 0, calls: 0, appCheckReadyCalls: 0, lastBody: undefined });
  const configuration = await state.configuration();
  assert.equal((await controller.open(configuration)).slot, 'A');
  const result = await controller.read({ attemptId: state.fixture.ATTEMPT.A });
  assert.equal(result.code, 'SUCCESS');
  assert.equal(controller.currentResult(), result);
  assert.equal(state.stats().calls, 1);
  assert.equal(state.stats().imports, 1);
  assert.equal(state.stats().appCheckReadyCalls, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(state.stats().lastBody)), {
    schemaVersion: 1,
    attemptId: state.fixture.ATTEMPT.A,
    capability: configuration.capability,
    signature: configuration.signature
  });
  await assert.rejects(controller.read({ attemptId: state.fixture.ATTEMPT.A }), /group-e\/invocation-terminal/);
  assert.equal(state.stats().calls, 1);
});

test('stored capability envelope projects to the exact browser config without weakening strict open validation', async () => {
  const state = setup();
  const storedEnvelope = await state.storedEnvelope();
  const expectedConfigurationKeys = ['capability', 'publicKeySpki', 'schemaVersion', 'signature'];
  assert.deepEqual(Object.keys(storedEnvelope).sort(), [...expectedConfigurationKeys, 'capabilityDigest'].sort());
  assert.equal(Object.hasOwn(storedEnvelope, 'capabilityDigest'), true);

  const configuration = state.service.browserConfigurationFromStoredEnvelope(storedEnvelope);
  assert.deepEqual(Object.keys(configuration).sort(), expectedConfigurationKeys);
  assert.equal(Object.hasOwn(configuration, 'capabilityDigest'), false);
  assert.equal(configuration.capability, storedEnvelope.capability);
  assert.equal(configuration.signature, storedEnvelope.signature);
  assert.equal(configuration.publicKeySpki, storedEnvelope.publicKeySpki);

  const controller = state.controller();
  await controller.open(configuration);
  assert.deepEqual(state.stats(), { imports: 0, calls: 0, appCheckReadyCalls: 0, lastBody: undefined });
  await controller.read({ attemptId: state.fixture.ATTEMPT.A });
  await assert.rejects(controller.read({ attemptId: state.fixture.ATTEMPT.A }), /group-e\/invocation-terminal/);
  assert.equal(state.stats().imports, 1);
  assert.equal(state.stats().calls, 1);

  assert.throws(() => state.service.browserConfigurationFromStoredEnvelope({ ...storedEnvelope, arbitrary: true }),
    /group-e\/configuration-invalid/);
  for (const field of expectedConfigurationKeys) {
    const missing = { ...storedEnvelope };
    delete missing[field];
    assert.throws(() => state.service.browserConfigurationFromStoredEnvelope(missing),
      /group-e\/configuration-invalid/);
  }

  const direct = setup();
  await assert.rejects(direct.controller().open(await direct.storedEnvelope()), /group-e\/configuration-invalid/);
  assert.deepEqual(direct.stats(), { imports: 0, calls: 0, appCheckReadyCalls: 0, lastBody: undefined });
});

test('runtime identity uses one private 256-bit nonce and matches an independent literal known vector', async () => {
  const nonceBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const loaded = load({ nonceBytes });
  assert.equal(loaded.randomCalls(), 1);
  assert.equal(crypto.createHash('sha256').update(RUNTIME_VECTOR_JSON, 'utf8').digest('hex'), RUNTIME_VECTOR_SHA256);
  assert.equal(await loaded.service.runtimeInstanceDigest('2'.repeat(64)), RUNTIME_VECTOR_SHA256);
  assert.equal(await loaded.service.runtimeInstanceDigest('2'.repeat(64)), RUNTIME_VECTOR_SHA256);
  assert.equal(loaded.randomCalls(), 1);
  assert.equal(loaded.service.runtimeInstanceDigest.length, 1);
  assert.equal(Object.hasOwn(loaded.service, 'runtimeInstanceNonce'), false);
  assert.equal(Object.hasOwn(loaded.service, 'setRuntimeInstanceNonce'), false);
});

test('same page runtime advances A to B while independent loads have distinct runtime identities', async () => {
  const firstNonce = new Uint8Array(32).fill(1);
  const secondNonce = new Uint8Array(32).fill(2);
  const state = setup({}, { nonceBytes: firstNonce });
  const second = setup({}, { nonceBytes: secondNonce });
  const stableContextOne = await state.service.browserContextDigest(ORIGIN, PATHNAME, state.fixture.FIREBASE_APP_ID,
    crypto.webcrypto);
  const stableContextTwo = await second.service.browserContextDigest(ORIGIN, PATHNAME, second.fixture.FIREBASE_APP_ID,
    crypto.webcrypto);
  const runtimeOne = await state.service.runtimeInstanceDigest(state.fixture.run.firebaseAppIdHash);
  const runtimeTwo = await second.service.runtimeInstanceDigest(second.fixture.run.firebaseAppIdHash);
  assert.equal(stableContextOne, stableContextTwo);
  assert.notEqual(runtimeOne, runtimeTwo);
  assert.equal(state.sessionGeneration(), state.fixture.SESSION_GENERATION.A);
  assert.equal(second.sessionGeneration(), second.fixture.SESSION_GENERATION.A);

  const aController = state.controller();
  const aConfiguration = await state.configuration('A');
  assert.equal(aConfiguration.capability.runtimeInstanceDigest, runtimeOne);
  await aController.open(aConfiguration);
  await aController.read({ attemptId: state.fixture.ATTEMPT.A });
  aController.clear();
  aController.close();
  state.auth.currentUser = null;
  state.switchSession();
  state.auth.currentUser = { uid: state.fixture.UID.B,
    getIdToken: async (force) => { assert.equal(force, true); return 'synthetic-id-token'; } };
  const bController = state.controller();
  const bConfiguration = await state.configuration('B');
  assert.equal(bConfiguration.capability.runtimeInstanceDigest, runtimeOne);
  assert.equal(bConfiguration.capability.sessionGeneration, state.fixture.SESSION_GENERATION.B);
  await bController.open(bConfiguration);
  await bController.read({ attemptId: state.fixture.ATTEMPT.B });
  assert.equal(state.stats().calls, 2);
});

test('a correctly signed B capability from runtime one fails in runtime two before SDK or callable use', async () => {
  const runtimeOne = setup({}, { nonceBytes: new Uint8Array(32).fill(3) });
  runtimeOne.switchSession();
  const configuration = await runtimeOne.configuration('B');
  const runtimeTwo = setup({}, { nonceBytes: new Uint8Array(32).fill(4) });
  runtimeTwo.switchSession();
  assert.equal(runtimeTwo.sessionGeneration(), configuration.capability.sessionGeneration);
  assert.equal(await runtimeOne.service.browserContextDigest(ORIGIN, PATHNAME, runtimeOne.fixture.FIREBASE_APP_ID,
    crypto.webcrypto), await runtimeTwo.service.browserContextDigest(ORIGIN, PATHNAME,
    runtimeTwo.fixture.FIREBASE_APP_ID, crypto.webcrypto));
  assert.notEqual(await runtimeOne.service.runtimeInstanceDigest(runtimeOne.fixture.run.firebaseAppIdHash),
    await runtimeTwo.service.runtimeInstanceDigest(runtimeTwo.fixture.run.firebaseAppIdHash));
  await assert.rejects(runtimeTwo.controller().open(configuration), /group-e\/runtime-binding-invalid/);
  assert.deepEqual(runtimeTwo.stats(), { imports: 0, calls: 0, appCheckReadyCalls: 0, lastBody: undefined });
});

test('signature tampering and exact page-runtime, app, subject, and attempt mismatches fail before callable creation', async () => {
  const state = setup();
  const signed = await state.configuration();
  const tampered = { ...signed, signature: `${signed.signature.slice(0, -1)}${signed.signature.endsWith('A') ? 'B' : 'A'}` };
  await assert.rejects(state.controller().open(tampered), /group-e\/signature-invalid/);

  const wrongContext = await state.configuration('A', { browserContextDigest: 'f'.repeat(64) });
  await assert.rejects(state.controller().open(wrongContext), /group-e\/runtime-binding-invalid/);
  const wrongApp = await state.configuration('A', { firebaseAppIdHash: 'f'.repeat(64) });
  await assert.rejects(state.controller().open(wrongApp), /group-e\/runtime-binding-invalid/);
  const wrongRuntime = await state.configuration('A', { runtimeInstanceDigest: 'f'.repeat(64) });
  await assert.rejects(state.controller().open(wrongRuntime), /group-e\/runtime-binding-invalid/);

  const wrongSubjectController = state.controller();
  await wrongSubjectController.open(signed);
  state.auth.currentUser = { uid: state.fixture.UID.B, getIdToken: async () => 'synthetic-id-token' };
  await assert.rejects(wrongSubjectController.read({ attemptId: state.fixture.ATTEMPT.A }), /group-e\/subject-denied/);
  assert.equal(state.stats().imports, 0);
  assert.equal(state.stats().calls, 0);

  const wrongAttemptState = setup();
  const wrongAttemptController = wrongAttemptState.controller();
  await wrongAttemptController.open(await wrongAttemptState.configuration());
  await assert.rejects(wrongAttemptController.read({ attemptId: wrongAttemptState.fixture.ATTEMPT.B }),
    /group-e\/attempt-denied/);
  assert.equal(wrongAttemptState.stats().calls, 0);
});

test('browser session derivation matches the server contract and rejects stale or unrelated B sessions before SDK use', async () => {
  const state = setup();
  const configuration = await state.configuration('A');
  const context = sessionGenerationContext(configuration.capability);
  assert.equal(await state.service.sessionGenerationDigest(context, crypto.webcrypto),
    sessionGenerationDigest(context));

  const staleB = setup();
  const bConfiguration = await staleB.configuration('B', {
    sessionGeneration: staleB.fixture.SESSION_GENERATION.B
  });
  await assert.rejects(staleB.controller().open(bConfiguration), /group-e\/runtime-binding-invalid/);
  assert.deepEqual(staleB.stats(), { imports: 0, calls: 0, appCheckReadyCalls: 0, lastBody: undefined });

  const changedAfterOpen = setup();
  const controller = changedAfterOpen.controller();
  await controller.open(await changedAfterOpen.configuration('A'));
  changedAfterOpen.switchSession();
  await assert.rejects(controller.read({ attemptId: changedAfterOpen.fixture.ATTEMPT.A }),
    /group-e\/session-binding-invalid/);
  assert.equal(changedAfterOpen.stats().imports, 0);
  assert.equal(changedAfterOpen.stats().calls, 0);

  const unrelatedDigest = setup();
  const wrongDigest = await unrelatedDigest.configuration('A', { sessionGenerationDigest: 'f'.repeat(64) });
  await assert.rejects(unrelatedDigest.controller().open(wrongDigest), /group-e\/configuration-invalid/);
  assert.equal(unrelatedDigest.stats().imports, 0);
  assert.equal(unrelatedDigest.stats().calls, 0);
});

test('session or App Check instance changes suppress stale results without a second callable', async () => {
  let releaseImport;
  let markImportStarted;
  const importWait = new Promise((resolve) => { releaseImport = resolve; });
  const importStarted = new Promise((resolve) => { markImportStarted = resolve; });
  const state = setup({ importFunctionsSdk: async () => {
    markImportStarted();
    await importWait;
    return { getFunctions: () => ({}), httpsCallable: () => async () => {
      throw new Error('call must not be created after session change');
    } };
  } });
  const controller = state.controller();
  await controller.open(await state.configuration());
  const pending = controller.read({ attemptId: state.fixture.ATTEMPT.A });
  await importStarted;
  state.switchSession();
  releaseImport();
  await assert.rejects(pending, /group-e\/stale-session/);
  assert.equal(controller.isTerminal(), false);

  let resolveCall;
  let markCallStarted;
  const callWait = new Promise((resolve) => { resolveCall = resolve; });
  const callStarted = new Promise((resolve) => { markCallStarted = resolve; });
  const second = setup({ importFunctionsSdk: async () => ({ getFunctions: () => ({}),
    httpsCallable: () => async () => { markCallStarted(); return callWait; } }) });
  const secondController = second.controller();
  await secondController.open(await second.configuration());
  const secondPending = secondController.read({ attemptId: second.fixture.ATTEMPT.A });
  await callStarted;
  second.replaceAppCheckInstance({});
  resolveCall({ data: success(second.fixture.UID.A, second.fixture.ATTEMPT.A) });
  await assert.rejects(secondPending, /group-e\/stale-session/);
  assert.equal(secondController.currentResult(), null);
  assert.equal(secondController.isTerminal(), true);
});

test('callable failure, server-side App Check replay rejection, and timeout are terminal with no resend', async () => {
  for (const implementation of [
    async () => { throw Object.assign(new Error('APP_CHECK_REPLAYED'), { code: 'functions/failed-precondition' }); },
    async () => { throw new Error('offline'); },
    () => new Promise(() => {})
  ]) {
    let calls = 0;
    const state = setup({ importFunctionsSdk: async () => ({ getFunctions: () => ({}),
      httpsCallable: () => async () => { calls++; return implementation(); } }) });
    const controller = state.controller();
    await controller.open(await state.configuration());
    await assert.rejects(controller.read({ attemptId: state.fixture.ATTEMPT.A }));
    assert.equal(controller.isTerminal(), true);
    await assert.rejects(controller.read({ attemptId: state.fixture.ATTEMPT.A }), /group-e\/invocation-terminal/);
    assert.equal(calls, 1);
  }
});

test('a fresh controller retains runtime identity but the simulated durable gateway marker rejects replay', async () => {
  let serverCalls = 0;
  const state = setup({ importFunctionsSdk: async () => ({ getFunctions: () => ({}),
    httpsCallable: () => async (body) => {
      serverCalls++;
      if (serverCalls > 1) throw Object.assign(new Error('GROUP_E_SLOT_ALREADY_CONSUMED'),
        { code: 'functions/already-exists' });
      return { data: success(state.fixture.UID.A, body.attemptId) };
    } }) });
  const configuration = await state.configuration();
  const first = state.controller();
  await first.open(configuration);
  await first.read({ attemptId: state.fixture.ATTEMPT.A });
  const restarted = state.controller();
  await restarted.open(configuration);
  await assert.rejects(restarted.read({ attemptId: state.fixture.ATTEMPT.A }), /GROUP_E_SLOT_ALREADY_CONSUMED/);
  assert.equal(serverCalls, 2);
  assert.equal(first.isTerminal(), true);
  assert.equal(restarted.isTerminal(), true);
});

test('response allowlists accept expected terminal codes and reject extra, malformed, and wrong-binding data', async () => {
  const state = setup();
  const context = { attemptId: state.fixture.ATTEMPT.A, uid: state.fixture.UID.A, cryptoImpl: crypto.webcrypto };
  assert.equal((await state.service.validateResponse(success(state.fixture.UID.A, state.fixture.ATTEMPT.A), context)).code,
    'SUCCESS');
  assert.equal((await state.service.validateResponse(success(state.fixture.UID.A, state.fixture.ATTEMPT.A,
    'FOUNDATION_NOT_INITIALIZED'), context)).code, 'FOUNDATION_NOT_INITIALIZED');
  assert.equal((await state.service.validateResponse(success(state.fixture.UID.A, state.fixture.ATTEMPT.A,
    'ACCOUNT_FROZEN'), context)).code, 'ACCOUNT_FROZEN');
  await assert.rejects(state.service.validateResponse({ ...success(state.fixture.UID.A, state.fixture.ATTEMPT.A),
    providerLinks: [] }, context), /group-e\/response-invalid/);
  await assert.rejects(state.service.validateResponse({ ...success(state.fixture.UID.A, state.fixture.ATTEMPT.A),
    subjectBinding: 'f'.repeat(64) }, context), /group-e\/response-invalid/);
  await assert.rejects(state.service.validateResponse({ code: 'SUCCESS' }, context), /group-e\/response-invalid/);
});

test('production authority epoch-millisecond foundation timestamps pass the browser response contract', async () => {
  const state = setup();
  const context = { attemptId: state.fixture.ATTEMPT.A, uid: state.fixture.UID.A, cryptoImpl: crypto.webcrypto };
  const foundation = redactFoundationDocument({
    fields: {
      schemaVersion: { integerValue: '1' },
      canonicalTrainerName: { stringValue: 'Synthetic A' },
      normalizedTrainerName: { stringValue: 'synthetica' },
      handleKey: { stringValue: 'v1_73796e74686574696361' },
      legacyUsername: { stringValue: 'Synthetic A' },
      status: { stringValue: 'active' },
      revision: { integerValue: '1' },
      createdAt: { integerValue: '1787686365000' },
      updatedAt: { integerValue: '1787686365000' }
    }
  });
  const response = { ...success(state.fixture.UID.A, state.fixture.ATTEMPT.A), foundation };

  assert.equal(typeof response.foundation.createdAt, 'number');
  assert.equal(typeof response.foundation.updatedAt, 'number');
  assert.equal((await state.service.validateResponse(response, context)).code, 'SUCCESS');

  for (const timestamp of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, {}, 'not-a-timestamp']) {
    await assert.rejects(state.service.validateResponse({
      ...response,
      foundation: { ...foundation, createdAt: timestamp }
    }, context), /group-e\/response-invalid/);
  }
});

test('close clears in-memory result and source has no persistent storage or direct Firebase write path', async () => {
  const state = setup();
  const controller = state.controller();
  await controller.open(await state.configuration());
  await controller.read({ attemptId: state.fixture.ATTEMPT.A });
  assert.notEqual(controller.currentResult(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.close())), { ok: true, closed: true });
  assert.equal(controller.currentResult(), null);
  assert.equal(controller.isEnabled(), false);
  await assert.rejects(controller.open(await state.configuration()), /group-e\/controller-closed/);
  assert.doesNotMatch(source,
    /localStorage|sessionStorage|indexedDB|\bcaches\b|document\.cookie|location\.(?:search|hash)|firebase\/database|set\s*\(\s*ref|update\s*\(\s*ref/u);
  assert.doesNotMatch(source, /console\.|setAttribute\([^\n]*runtimeInstance|runtimeInstanceNonce\s*:/u);
});

test('page integration exposes only an explicit operator constructor and closes it at every session boundary', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert.match(html, /__pogoCreateGroupEClientFoundationCanary=async\(storedEnvelope\)=>/);
  assert.match(html,
    /const configuration=e1ClientFoundationCanaryService\.browserConfigurationFromStoredEnvelope\(storedEnvelope\);/);
  assert.match(html, /await e1ClientFoundationCanary\.open\(configuration\)/);
  assert.match(html, /getBrowserContextDigest:\(\)=>e1ClientFoundationCanaryService\.browserContextDigest\(/);
  assert.doesNotMatch(html, /getRuntimeInstanceDigest|runtimeInstanceNonce/);
  assert.match(html, /import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-functions\.js'\)/);
  assert.match(html, /function resetSessionTransientUi[\s\S]*e1ClientFoundationCanary\.close\(\)/);
  assert.equal((html.match(/__pogoCreateGroupEClientFoundationCanary\(/g) || []).length, 0);
  assert.doesNotMatch(html, /providerLink|linkWithPopup|unlink\(/);
});
