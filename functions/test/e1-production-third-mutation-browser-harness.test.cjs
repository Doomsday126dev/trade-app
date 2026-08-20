'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXECUTION_EVIDENCE_PURPOSE,
  SYNTHETIC_COHORT_TYPE
} = require('../production/e1ProductionThirdMutationContract.cjs');
const {
  APP_CHECK_DEBUG_TOKEN_GLOBAL,
  APP_CHECK_MODE,
  EXPECTED_APP_ID,
  EXPECTED_ORIGIN,
  EXPECTED_PATHNAMES,
  HARNESS_MODE,
  LOGIN_METHOD,
  appCheckRuntimeProofDigest,
  createBrowserExecutionHarness,
  harnessDigest,
  runSameRuntimeAppCheckProbe,
  validateBrowserHarnessArtifact
} = require('../production/e1ProductionThirdMutationBrowserHarness.cjs');

const NOW = Date.parse('2026-08-16T12:00:00.000Z');

function artifact() {
  const value = {
    schemaVersion: 2,
    environment: 'production',
    projectId: 'trade-list-a4297',
    appId: EXPECTED_APP_ID,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    mode: HARNESS_MODE,
    bindingDigest: 'a'.repeat(64),
    verifiedAt: '2026-08-16T11:55:00.000Z',
    subjects: ['A', 'B', 'C', 'D', 'E'].map((slot, index) => {
      const uidHash = String(index + 1).repeat(64);
      const trainerHash = ['6', '7', '8', '9', 'a'][index].repeat(64);
      const at = (offset) => new Date(Date.parse('2026-08-16T11:54:00.000Z') + offset).toISOString();
      const subject = {
        slot,
        uidHash,
        trainerHash,
        browserContextHash: String.fromCharCode(97 + index).repeat(64),
        loginMethod: LOGIN_METHOD,
        exactUidMatch: true,
        previousSessionAbsent: true,
        operatorAdminSessionAbsent: true,
        firebaseIdTokenFresh: true,
        appCheckProvenance: {
          slot,
          origin: EXPECTED_ORIGIN,
          pathname: EXPECTED_PATHNAMES[0],
          appId: EXPECTED_APP_ID,
          uidHash,
          trainerHash,
          bindingDigest: 'a'.repeat(64),
          probeStartedAt: at(0),
          samePageRuntimeEstablished: true,
          debugTokenGlobalAbsent: true,
          pageRuntimeBinding: { startedAt: at(0), settledAt: at(50), outcome: 'verified' },
          sdkImport: { startedAt: at(50), settledAt: at(100), outcome: 'resolved' },
          readiness: { startedAt: at(100), settledAt: at(150), outcome: 'resolved' },
          appCheckInstance: { startedAt: at(150), settledAt: at(160), outcome: 'verified', exactInstance: true },
          limitedUseToken: {
            startedAt: at(160), settledAt: at(250), outcome: 'resolved', nonEmpty: true,
            tokenFingerprint: ['b', 'c', 'd', 'e', 'f'][index].repeat(64),
            persisted: false, reused: false, sentToCallable: false
          },
          failureStage: null,
          runtimeProofDigest: ''
        },
        appCheckMode: APP_CHECK_MODE,
        debugTokenUsed: false,
        tokenPersistence: 'none',
        tokenReuseDetected: false
      };
      subject.appCheckProvenance.runtimeProofDigest = appCheckRuntimeProofDigest(subject.appCheckProvenance);
      return subject;
    }),
    debugTokensUsed: false,
    tokensPersisted: false,
    executionAuthorized: false,
    groupEAuthorized: false,
    harnessDigest: ''
  };
  value.harnessDigest = harnessDigest(value);
  return value;
}

function validate(value = artifact(), mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-d3-browser-'));
  try {
    const harnessPath = path.join(directory, 'harness.json');
    fs.writeFileSync(harnessPath, JSON.stringify(value), { mode });
    fs.chmodSync(harnessPath, mode);
    return validateBrowserHarnessArtifact(value, { now: () => NOW, harnessPath });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('private browser evidence requires complete reviewed same-runtime App Check provenance', () => {
  const result = validate();
  assert.equal(result.subjectsReady, 5);
  assert.equal(result.authenticFirebaseLoginRequired, true);
  assert.equal(result.limitedUseAppCheckRequired, true);
  assert.equal(result.debugTokensUsed, false);
  assert.equal(result.tokensPersisted, false);
});

for (const [name, mutate, reason] of [
  ['wrong UID', (value) => { value.subjects[0].exactUidMatch = false; }, 'group_d3_browser_harness_subject_a_invalid'],
  ['shared browser context', (value) => { value.subjects[1].browserContextHash = value.subjects[0].browserContextHash; }, 'group_d3_browser_harness_subjects_not_isolated'],
  ['operator session present', (value) => { value.subjects[2].operatorAdminSessionAbsent = false; }, 'group_d3_browser_harness_subject_c_invalid'],
  ['debug App Check', (value) => { value.subjects[3].debugTokenUsed = true; }, 'group_d3_browser_harness_subject_d_invalid'],
  ['token persistence', (value) => { value.subjects[4].tokenPersistence = 'localStorage'; }, 'group_d3_browser_harness_subject_e_invalid'],
  ['boolean-only App Check', (value) => {
    delete value.subjects[0].appCheckProvenance;
    value.subjects[0].limitedUseAppCheckAvailable = true;
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['self-declared token without fingerprint', (value) => {
    value.subjects[0].appCheckProvenance.limitedUseToken.tokenFingerprint = '';
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['wrong production origin', (value) => {
    value.subjects[0].appCheckProvenance.origin = 'https://example.com';
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['wrong production path', (value) => {
    value.subjects[0].appCheckProvenance.pathname = '/another-site/';
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['wrong cohort binding', (value) => {
    value.subjects[0].appCheckProvenance.bindingDigest = 'b'.repeat(64);
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['missing debug-mode evidence', (value) => {
    delete value.subjects[0].appCheckProvenance.debugTokenGlobalAbsent;
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['debug mode present', (value) => {
    value.subjects[0].appCheckProvenance.debugTokenGlobalAbsent = false;
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['callable transmission during evidence', (value) => {
    value.subjects[0].appCheckProvenance.limitedUseToken.sentToCallable = true;
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['fabricated runtime proof digest', (value) => {
    value.subjects[0].appCheckProvenance.runtimeProofDigest = 'f'.repeat(64);
  }, 'group_d3_browser_harness_subject_a_invalid'],
  ['stale stage evidence with a fresh artifact timestamp', (value) => {
    for (const stage of ['pageRuntimeBinding', 'sdkImport', 'readiness', 'appCheckInstance', 'limitedUseToken']) {
      value.subjects[0].appCheckProvenance[stage].startedAt = '2026-08-16T10:00:00.000Z';
      value.subjects[0].appCheckProvenance[stage].settledAt = '2026-08-16T10:00:00.010Z';
    }
  }, 'group_d3_browser_harness_subject_a_invalid']
]) {
  test(`browser evidence fails closed for ${name}`, () => {
    const value = artifact();
    mutate(value);
    value.harnessDigest = harnessDigest(value);
    assert.throws(() => validate(value), (error) => error.reasons.includes(reason));
  });
}

function probeFixture(overrides = {}) {
  const instance = {};
  const calls = { tokenCalls: 0, tokenInstance: null };
  const sdk = {
    getLimitedUseToken: async (value) => {
      calls.tokenCalls += 1;
      calls.tokenInstance = value;
      return { token: 'ephemeral-limited-use-token' };
    }
  };
  const adapter = {
    importSdk: async () => sdk,
    constructProvider: () => assert.fail('collector must not construct another provider'),
    initializeAppCheck: () => assert.fail('collector must not initialize App Check again'),
    verifyPageRuntime: async () => true,
    inspectDebugTokenGlobal: async () => ({ mechanism: APP_CHECK_DEBUG_TOKEN_GLOBAL, present: false }),
    firebaseAppCheckReady: async () => ({ ok: true, instance }),
    isExpectedInstance: (value) => value === instance,
    ...overrides
  };
  let clock = Date.parse('2026-08-16T11:54:00.000Z');
  return {
    adapter,
    slot: 'A',
    origin: EXPECTED_ORIGIN,
    pathname: EXPECTED_PATHNAMES[0],
    appId: EXPECTED_APP_ID,
    uidHash: '1'.repeat(64),
    trainerHash: '6'.repeat(64),
    bindingDigest: 'a'.repeat(64),
    now: () => new Date(clock += 10).toISOString(),
    stageTimeoutMs: 10,
    calls,
    instance
  };
}

test('same-runtime probe binds debug absence and token acquisition to the imported SDK and readiness instance', async () => {
  const fixture = probeFixture({
    getLimitedUseToken: () => assert.fail('a separate adapter token method must never be used')
  });
  const result = await runSameRuntimeAppCheckProbe(fixture);
  assert.equal(result.origin, EXPECTED_ORIGIN);
  assert.equal(result.pathname, EXPECTED_PATHNAMES[0]);
  assert.equal(result.samePageRuntimeEstablished, true);
  assert.equal(result.debugTokenGlobalAbsent, true);
  assert.equal(result.appCheckInstance.exactInstance, true);
  assert.equal(result.limitedUseToken.nonEmpty, true);
  assert.equal(result.limitedUseToken.sentToCallable, false);
  assert.match(result.limitedUseToken.tokenFingerprint, /^[a-f0-9]{64}$/u);
  assert.match(result.runtimeProofDigest, /^[a-f0-9]{64}$/u);
  assert.equal(result.runtimeProofDigest, appCheckRuntimeProofDigest(result));
  assert.doesNotMatch(JSON.stringify(result), /ephemeral-limited-use-token/u);
  assert.equal(fixture.calls.tokenCalls, 1);
  assert.equal(fixture.calls.tokenInstance, fixture.instance);
});

for (const [name, stage, override, code] of [
  ['import timeout', 'import', { importSdk: () => new Promise(() => {}) }, 'group_d3_app_check_import_timeout'],
  ['page runtime mismatch', 'page-runtime-binding', { verifyPageRuntime: async () => false }, undefined],
  ['missing debug-mode evidence', 'page-runtime-binding', { inspectDebugTokenGlobal: async () => undefined }, 'group_d3_app_check_debug_provenance_invalid'],
  ['debug mode explicitly present', 'page-runtime-binding', {
    inspectDebugTokenGlobal: async () => ({ mechanism: APP_CHECK_DEBUG_TOKEN_GLOBAL, present: true })
  }, 'group_d3_app_check_debug_provenance_invalid'],
  ['import rejection', 'import', { importSdk: async () => { throw new Error('blocked'); } }, undefined],
  ['imported SDK without getLimitedUseToken', 'import', {
    importSdk: async () => ({})
  }, 'group_d3_app_check_sdk_invalid'],
  ['separate adapter token method cannot substitute for the imported SDK function', 'import', {
    importSdk: async () => ({}), getLimitedUseToken: async () => ({ token: 'must-not-be-used' })
  }, 'group_d3_app_check_sdk_invalid'],
  ['readiness timeout', 'readiness', { firebaseAppCheckReady: () => new Promise(() => {}) }, 'group_d3_app_check_readiness_timeout'],
  ['instance mismatch', 'instance', { isExpectedInstance: () => false }, undefined],
  ['token timeout', 'token', {
    importSdk: async () => ({ getLimitedUseToken: () => new Promise(() => {}) })
  }, 'group_d3_app_check_token_timeout'],
  ['token rejection', 'token', {
    importSdk: async () => ({ getLimitedUseToken: async () => { throw new Error('blocked'); } })
  }, undefined]
]) {
  test(`same-runtime probe fails closed for ${name}`, async () => {
    await assert.rejects(() => runSameRuntimeAppCheckProbe(probeFixture(override)), (error) => {
      assert.equal(error.stage, stage);
      if (code) assert.equal(error.code, code);
      return true;
    });
  });
}

test('probe source has no fallback token path outside the imported SDK export', () => {
  const source = fs.readFileSync(path.join(__dirname, '../production/e1ProductionThirdMutationBrowserHarness.cjs'), 'utf8');
  assert.match(source, /sdk\.value\.getLimitedUseToken\(expectedInstance\)/u);
  assert.doesNotMatch(source, /adapter\.getLimitedUseToken\(/u);
});

function executionFixture({ uidMismatch = false, debug = false, reuse = false } = {}) {
  const subjects = ['A', 'B', 'C', 'D', 'E'].map((slot, index) => ({
    slot,
    firebaseUid: `canary-${slot}`,
    isAdmin: false,
    isOwner: false,
    requestBody: { schemaVersion: 1, requestId: `request-${slot}`, trainerHandle: `trainer-${slot}` }
  }));
  let current = null;
  let counter = 0;
  const authAdapter = {
    signOut: async () => { current = null; },
    currentUser: () => current,
    signInWithLegacyCredential: async ({ slot }) => {
      current = { uid: uidMismatch ? 'wrong-user' : `canary-${slot}` };
      return current;
    },
    getFreshIdToken: async () => ({ token: reuse ? 'same-id-token' : `id-${++counter}`, fresh: true })
  };
  const appCheckAdapter = {
    getLimitedUseToken: async () => ({ token: reuse ? 'same-app-check' : `app-${++counter}`, limitedUse: true, debug })
  };
  const calls = [];
  const gatewayAdapter = {
    reserveTrainerHandle: async (request) => { calls.push(request); return { resultCode: 'SUCCESS' }; }
  };
  return { subjects, authAdapter, appCheckAdapter, gatewayAdapter, calls };
}

test('execution harness signs in as the exact UID and acquires fresh request-scoped tokens in canonical order', async () => {
  const fixture = executionFixture();
  const harness = createBrowserExecutionHarness(fixture);
  await harness.execute({ slot: 'A', operation: 'reserve', credential: { slot: 'A' } });
  await harness.execute({ slot: 'A', operation: 'exact-replay', credential: { slot: 'A' } });
  assert.equal(fixture.calls.length, 2);
  assert.notEqual(fixture.calls[0].firebaseIdToken, fixture.calls[1].firebaseIdToken);
  assert.notEqual(fixture.calls[0].limitedUseAppCheckToken, fixture.calls[1].limitedUseAppCheckToken);
  assert.deepEqual(harness.next(), { slot: 'B', operation: 'reserve' });
});

test('execution harness rejects wrong order, wrong UID, debug App Check, and token reuse', async () => {
  const order = executionFixture();
  await assert.rejects(() => createBrowserExecutionHarness(order).execute({ slot: 'B', operation: 'reserve', credential: { slot: 'B' } }), /sequence-invalid/u);
  const uid = executionFixture({ uidMismatch: true });
  await assert.rejects(() => createBrowserExecutionHarness(uid).execute({ slot: 'A', operation: 'reserve', credential: { slot: 'A' } }), /uid-mismatch/u);
  const debug = executionFixture({ debug: true });
  await assert.rejects(() => createBrowserExecutionHarness(debug).execute({ slot: 'A', operation: 'reserve', credential: { slot: 'A' } }), /token-invalid/u);
  const reuse = executionFixture({ reuse: true });
  const harness = createBrowserExecutionHarness(reuse);
  await harness.execute({ slot: 'A', operation: 'reserve', credential: { slot: 'A' } });
  await assert.rejects(() => harness.execute({ slot: 'A', operation: 'exact-replay', credential: { slot: 'A' } }), /token-reuse/u);
});

test('browser harness source contains no persistence, debug bypass, custom token minting, or impersonation capability', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../production/e1ProductionThirdMutationBrowserHarness.cjs'), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|signInWithCustomToken|createCustomToken|serviceAccount/u);
  assert.match(source, /getFreshIdToken/u);
  assert.match(source, /getLimitedUseToken/u);
});
