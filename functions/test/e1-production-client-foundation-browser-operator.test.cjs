'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  appIdHash,
  sessionGenerationContext,
  sessionGenerationDigest,
  subjectHash
} = require('../e1-gateway/groupEAdmission');
const {
  LEGACY_OPERATOR_STATE_KEY,
  OPERATOR_LEASE_KEY,
  PRE_DISPATCH_MAX_AGE_MS,
  buildBrowserActionScript,
  buildPreDispatchReadinessScript,
  readinessDigest,
  validatePreDispatchReadiness
} = require('../production/e1ProductionClientFoundationBrowserOperator.cjs');

const ORIGIN = 'https://doomsday126dev.github.io';
const PATHNAME = '/trade-app/';
const RELEASE_ID = '2026-08-25.60';
const SOURCE_SHA = '8b181e75a9b31fca4da9928fc111fabee19108f8';
const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const GENERATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const FIREBASE_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const RAW_UID = 'synthetic-group-e-operator-uid';
const RAW_TRAINER = 'SyntheticGroupEOperator';
const COHORT_DIGEST = 'c'.repeat(64);
const browserSource = fs.readFileSync(
  path.resolve(__dirname, '../../js/services/e1ClientFoundationCanary.js'), 'utf8');

class Button {
  constructor(document) {
    this.document = document;
    this.dataset = {};
    this.style = {};
    this.disabled = false;
    this.textContent = '';
    this.listeners = new Map();
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  async click() { return this.listeners.get('click')?.(); }
  remove() { this.document.buttons = this.document.buttons.filter((entry) => entry !== this); }
}

function createDocument() {
  const document = {
    buttons: [],
    createElement(name) {
      if (name !== 'button') throw new Error('unexpected_element');
      return new Button(document);
    },
    querySelectorAll(name) { return name === 'button' ? [...document.buttons] : []; }
  };
  document.body = { appendChild(button) { document.buttons.push(button); } };
  return document;
}

async function runtimeFixture() {
  const document = createDocument();
  const clipboard = { value: '' };
  const counters = { factoryCalls: 0, sdkImports: 0, callableConstructions: 0, callableInvocations: 0 };
  const runtimeCrypto = {
    subtle: crypto.webcrypto.subtle,
    randomUUID: crypto.randomUUID,
    getRandomValues(value) {
      assert.equal(value.byteLength, 32);
      value.set(Uint8Array.from({ length: 32 }, (_, index) => index));
      return value;
    }
  };
  const window = {
    crypto: runtimeCrypto,
    location: { origin: ORIGIN, pathname: PATHNAME },
    __POGO_RELEASE_ID: RELEASE_ID,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64')
  };
  const context = vm.createContext({
    window,
    location: window.location,
    document,
    navigator: { clipboard: { writeText: async (value) => { clipboard.value = value; } } },
    auth: { currentUser: { uid: RAW_UID } },
    fbApp: { options: { appId: FIREBASE_APP_ID } },
    cur: RAW_TRAINER,
    _sessionTransientGeneration: 10,
    e1ClientFoundationCanary: null,
    crypto: runtimeCrypto,
    TextEncoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { log() {}, error() {} }
  });
  vm.runInContext(browserSource, context);
  const service = window.PogoServices.e1ClientFoundationCanary;
  const expected = {
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    origin: ORIGIN,
    pathname: PATHNAME,
    runId: RUN_ID,
    cohortDigest: COHORT_DIGEST,
    slot: 'A',
    uidHash: subjectHash('uid', RAW_UID),
    trainerHash: subjectHash('trainer', RAW_TRAINER),
    generationId: GENERATION_ID,
    sessionGeneration: 10,
    firebaseAppIdHash: appIdHash(FIREBASE_APP_ID),
    browserContextDigest: await service.browserContextDigest(ORIGIN, PATHNAME, FIREBASE_APP_ID, runtimeCrypto),
    runtimeInstanceDigest: await service.runtimeInstanceDigest(appIdHash(FIREBASE_APP_ID)),
    sessionGenerationDigest: ''
  };
  expected.sessionGenerationDigest = sessionGenerationDigest(sessionGenerationContext({
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    ...expected
  }));
  window.__groupELiveRuntimeRecord = Object.freeze({
    schemaVersion: 1,
    recordType: 'group-e-browser-session-context',
    releaseId: expected.releaseId,
    sourceSha: expected.sourceSha,
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: expected.runId,
    cohortDigest: expected.cohortDigest,
    slot: expected.slot,
    uidHash: expected.uidHash,
    trainerHash: expected.trainerHash,
    generationId: expected.generationId,
    sessionGeneration: expected.sessionGeneration,
    firebaseAppIdHash: expected.firebaseAppIdHash,
    browserContextDigest: expected.browserContextDigest,
    runtimeInstanceDigest: expected.runtimeInstanceDigest,
    sessionGenerationDigest: expected.sessionGenerationDigest,
    capturedAt: new Date().toISOString()
  });
  window.__pogoCreateGroupEClientFoundationCanary = async () => {
    counters.factoryCalls += 1;
    return Object.freeze({
      read: async () => {
        counters.callableConstructions += 1;
        counters.callableInvocations += 1;
      }
    });
  };
  return { clipboard, context, counters, document, expected, window };
}

function sleep(milliseconds = 225) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function armAndClick(context, document, script) {
  await vm.runInContext(script, context);
  await sleep();
  const button = document.buttons.at(-1);
  assert.equal(button.disabled, false);
  await button.click();
  return button;
}

function legacyBrowserButtonScript(label, body) {
  return `(async()=>{const fail=c=>{const e=new Error(c);e.code=c;throw e};` +
    `if(window.${LEGACY_OPERATOR_STATE_KEY})fail('GROUP_E_OPERATOR_ALREADY_ACTIVE');` +
    `window.${LEGACY_OPERATOR_STATE_KEY}=${JSON.stringify(label)};` +
    `const button=document.createElement('button');document.body.appendChild(button);` +
    `button.addEventListener('click',async()=>{${body}}, {once:true});})()`;
}

test('legacy context capture reproduces stale operator failure before factory or callable work', async () => {
  const fixture = await runtimeFixture();
  await vm.runInContext(legacyBrowserButtonScript('GROUP E A RUNTIME CAPTURE',
    `window.__groupELiveRuntimeRecord=Object.freeze({ok:true});`), fixture.context);
  await fixture.document.buttons.at(-1).click();
  assert.equal(fixture.window[LEGACY_OPERATOR_STATE_KEY], 'GROUP E A RUNTIME CAPTURE');
  await assert.rejects(vm.runInContext(legacyBrowserButtonScript('GROUP E A EXECUTE ONCE',
    `await window.__pogoCreateGroupEClientFoundationCanary({});`), fixture.context),
  (error) => error.code === 'GROUP_E_OPERATOR_ALREADY_ACTIVE');
  assert.deepEqual(fixture.counters, {
    factoryCalls: 0,
    sdkImports: 0,
    callableConstructions: 0,
    callableInvocations: 0
  });
});

test('new evidence action releases its lease and allows clean envelope delivery/open without read', async () => {
  const fixture = await runtimeFixture();
  delete fixture.window.__groupELiveRuntimeRecord;
  const capture = buildBrowserActionScript({
    label: 'GROUP E A RUNTIME CAPTURE',
    body: `window.__groupELiveRuntimeRecord=Object.freeze({ok:true});` +
      `await navigator.clipboard.writeText(JSON.stringify(window.__groupELiveRuntimeRecord));`,
    origin: ORIGIN,
    pathname: PATHNAME,
    releaseId: RELEASE_ID,
    requiresSignedIn: true
  });
  const captureButton = await armAndClick(fixture.context, fixture.document, capture);
  assert.equal(captureButton.dataset.groupELiveOperatorState, 'completed');
  assert.equal(Object.hasOwn(fixture.window, OPERATOR_LEASE_KEY), false);
  const delivery = buildBrowserActionScript({
    label: 'GROUP E A DELIVERY OPEN',
    body: `await window.__pogoCreateGroupEClientFoundationCanary({});`,
    origin: ORIGIN,
    pathname: PATHNAME,
    releaseId: RELEASE_ID,
    requireCleanExecutionState: true
  });
  await armAndClick(fixture.context, fixture.document, delivery);
  assert.equal(fixture.counters.factoryCalls, 1);
  assert.equal(fixture.counters.callableConstructions, 0);
  assert.equal(fixture.counters.callableInvocations, 0);
  assert.equal(Object.hasOwn(fixture.window, OPERATOR_LEASE_KEY), false);
});

test('pre-dispatch readiness binds the exact live runtime and clears its own exclusive lease', async () => {
  const fixture = await runtimeFixture();
  const script = buildPreDispatchReadinessScript(fixture.expected);
  const button = await armAndClick(fixture.context, fixture.document, script);
  const record = JSON.parse(fixture.clipboard.value);
  const accepted = validatePreDispatchReadiness(record, fixture.expected);
  assert.equal(accepted.runtimeInstanceDigest, fixture.expected.runtimeInstanceDigest);
  assert.equal(accepted.sessionGenerationDigest, fixture.expected.sessionGenerationDigest);
  assert.equal(accepted.operatorLeaseExclusive, true);
  assert.equal(accepted.callableConstructed, false);
  assert.equal(accepted.callableInvoked, false);
  assert.equal(accepted.readinessDigest, readinessDigest(accepted));
  assert.equal(button.dataset.groupELiveOperatorState, 'completed');
  assert.equal(Object.hasOwn(fixture.window, OPERATOR_LEASE_KEY), false);
  assert.deepEqual(fixture.counters, {
    factoryCalls: 0,
    sdkImports: 0,
    callableConstructions: 0,
    callableInvocations: 0
  });
});

test('B pre-dispatch accepts only the advanced subject session in the unchanged page runtime', async () => {
  const fixture = await runtimeFixture();
  const uid = 'synthetic-group-e-operator-uid-b';
  const trainer = 'SyntheticGroupEOperatorB';
  const expected = {
    ...fixture.expected,
    slot: 'B',
    uidHash: subjectHash('uid', uid),
    trainerHash: subjectHash('trainer', trainer),
    generationId: '323e4567-e89b-42d3-a456-426614174000',
    sessionGeneration: fixture.expected.sessionGeneration + 1,
    sessionGenerationDigest: ''
  };
  expected.sessionGenerationDigest = sessionGenerationDigest(sessionGenerationContext({
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    ...expected
  }));
  fixture.context.auth.currentUser = { uid };
  fixture.context.cur = trainer;
  fixture.context._sessionTransientGeneration = expected.sessionGeneration;
  fixture.window.__groupELiveRuntimeRecord = Object.freeze({
    schemaVersion: 1,
    recordType: 'group-e-browser-session-context',
    releaseId: expected.releaseId,
    sourceSha: expected.sourceSha,
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: expected.runId,
    cohortDigest: expected.cohortDigest,
    slot: expected.slot,
    uidHash: expected.uidHash,
    trainerHash: expected.trainerHash,
    generationId: expected.generationId,
    sessionGeneration: expected.sessionGeneration,
    firebaseAppIdHash: expected.firebaseAppIdHash,
    browserContextDigest: expected.browserContextDigest,
    runtimeInstanceDigest: expected.runtimeInstanceDigest,
    sessionGenerationDigest: expected.sessionGenerationDigest,
    capturedAt: new Date().toISOString()
  });
  await armAndClick(fixture.context, fixture.document, buildPreDispatchReadinessScript(expected));
  const accepted = validatePreDispatchReadiness(JSON.parse(fixture.clipboard.value), expected);
  assert.equal(accepted.slot, 'B');
  assert.equal(accepted.sessionGeneration, fixture.expected.sessionGeneration + 1);
  assert.equal(accepted.runtimeInstanceDigest, fixture.expected.runtimeInstanceDigest);

  const otherRuntime = { ...expected, runtimeInstanceDigest: 'f'.repeat(64), sessionGenerationDigest: '' };
  otherRuntime.sessionGenerationDigest = sessionGenerationDigest(sessionGenerationContext({
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    ...otherRuntime
  }));
  await vm.runInContext(buildPreDispatchReadinessScript(otherRuntime), fixture.context);
  await sleep();
  await assert.rejects(fixture.document.buttons.at(-1).click(),
    (error) => error.code === 'GROUP_E_RUNTIME_RECORD_MISMATCH' ||
      error.code === 'GROUP_E_PRE_DISPATCH_RUNTIME_MISMATCH');
});

test('stale legacy operator and stale controller fail before a dispatch can be committed', async () => {
  for (const stale of ['legacy', 'controller']) {
    const fixture = await runtimeFixture();
    if (stale === 'legacy') fixture.window[LEGACY_OPERATOR_STATE_KEY] = 'GROUP E A RUNTIME CAPTURE';
    else fixture.context.e1ClientFoundationCanary = Object.freeze({ isTerminal: () => false });
    let dispatchCommits = 0;
    await assert.rejects(vm.runInContext(buildPreDispatchReadinessScript(fixture.expected), fixture.context),
      (error) => ['GROUP_E_STALE_OPERATOR_STATE', 'GROUP_E_STALE_EXECUTION_STATE'].includes(error.code));
    if (fixture.clipboard.value) {
      validatePreDispatchReadiness(JSON.parse(fixture.clipboard.value), fixture.expected);
      dispatchCommits += 1;
    }
    assert.equal(dispatchCommits, 0);
    assert.equal(fixture.counters.factoryCalls, 0);
  }
});

test('a true duplicate arm remains rejected while completed actions do not block the next action', async () => {
  const fixture = await runtimeFixture();
  const action = buildBrowserActionScript({
    label: 'GROUP E A ACTION',
    body: `await navigator.clipboard.writeText('complete');`,
    origin: ORIGIN,
    pathname: PATHNAME,
    releaseId: RELEASE_ID
  });
  await vm.runInContext(action, fixture.context);
  await assert.rejects(vm.runInContext(action, fixture.context),
    (error) => error.code === 'GROUP_E_OPERATOR_ALREADY_ACTIVE');
  assert.equal(fixture.document.buttons.length, 1);
  await fixture.document.buttons[0].click();
  assert.equal(Object.hasOwn(fixture.window, OPERATOR_LEASE_KEY), false);
  await vm.runInContext(action, fixture.context);
  assert.equal(fixture.document.buttons.length, 1);
  await fixture.document.buttons[0].click();
});

test('operator lease is released on click failure, arm failure, and bounded arm expiry', async () => {
  const failedClick = await runtimeFixture();
  const throwingAction = buildBrowserActionScript({
    label: 'GROUP E A FAILING ACTION',
    body: `fail('GROUP_E_SYNTHETIC_ACTION_FAILURE');`,
    origin: ORIGIN,
    pathname: PATHNAME,
    releaseId: RELEASE_ID
  });
  await vm.runInContext(throwingAction, failedClick.context);
  await assert.rejects(failedClick.document.buttons[0].click(),
    (error) => error.code === 'GROUP_E_SYNTHETIC_ACTION_FAILURE');
  assert.equal(Object.hasOwn(failedClick.window, OPERATOR_LEASE_KEY), false);
  assert.equal(failedClick.document.buttons[0].dataset.groupELiveOperatorState, 'failed');

  const failedArm = await runtimeFixture();
  failedArm.document.createElement = () => { throw new Error('synthetic_dom_failure'); };
  await assert.rejects(vm.runInContext(throwingAction, failedArm.context), /synthetic_dom_failure/);
  assert.equal(Object.hasOwn(failedArm.window, OPERATOR_LEASE_KEY), false);
  assert.equal(failedArm.document.buttons.length, 0);

  const expired = await runtimeFixture();
  expired.context.setTimeout = (callback) => setTimeout(callback, 0);
  expired.context.clearTimeout = clearTimeout;
  await vm.runInContext(throwingAction, expired.context);
  await sleep(20);
  assert.equal(Object.hasOwn(expired.window, OPERATOR_LEASE_KEY), false);
  assert.equal(expired.document.buttons[0].dataset.groupELiveOperatorState, 'expired');
});

test('pre-dispatch validator fails closed on stale, substituted, asserted, or extra-field evidence', async () => {
  const fixture = await runtimeFixture();
  await armAndClick(fixture.context, fixture.document, buildPreDispatchReadinessScript(fixture.expected));
  const valid = JSON.parse(fixture.clipboard.value);
  const cases = [
    (value) => { value.priorOperatorStateClean = false; },
    (value) => { value.runtimeInstanceDigest = 'f'.repeat(64); },
    (value) => { value.sessionGeneration += 1; },
    (value) => { value.callableConstructed = true; },
    (value) => { value.extra = true; },
    (value) => { value.capturedAt = new Date(Date.now() - PRE_DISPATCH_MAX_AGE_MS - 1).toISOString(); },
    (value) => { value.readinessDigest = '0'.repeat(64); }
  ];
  for (const mutate of cases) {
    const value = structuredClone(valid);
    mutate(value);
    if (value.readinessDigest === valid.readinessDigest && !Object.hasOwn(value, 'extra')) {
      value.readinessDigest = readinessDigest(value);
    }
    assert.throws(() => validatePreDispatchReadiness(value, fixture.expected),
      /GROUP_E_PRE_DISPATCH_READINESS_INVALID/);
  }
});

test('operator scripts contain no persistence path or runtime-secret state field', async () => {
  const fixture = await runtimeFixture();
  const script = buildPreDispatchReadinessScript(fixture.expected);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'caches.open', 'document.cookie',
    'rawNonce', 'idToken', 'appCheckToken', 'capability', 'signature']) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  await armAndClick(fixture.context, fixture.document, script);
  assert.equal(Object.hasOwn(fixture.window, OPERATOR_LEASE_KEY), false);
});
