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
  APP_CHECK_MODE,
  EXPECTED_APP_ID,
  HARNESS_MODE,
  LOGIN_METHOD,
  createBrowserExecutionHarness,
  harnessDigest,
  validateBrowserHarnessArtifact
} = require('../production/e1ProductionThirdMutationBrowserHarness.cjs');

const NOW = Date.parse('2026-08-16T12:00:00.000Z');

function artifact() {
  const value = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    appId: EXPECTED_APP_ID,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    mode: HARNESS_MODE,
    bindingDigest: 'a'.repeat(64),
    verifiedAt: '2026-08-16T11:55:00.000Z',
    subjects: ['A', 'B', 'C', 'D', 'E'].map((slot, index) => ({
      slot,
      uidHash: String(index + 1).repeat(64),
      trainerHash: ['6', '7', '8', '9', 'a'][index].repeat(64),
      browserContextHash: String.fromCharCode(97 + index).repeat(64),
      loginMethod: LOGIN_METHOD,
      exactUidMatch: true,
      previousSessionAbsent: true,
      operatorAdminSessionAbsent: true,
      firebaseIdTokenFresh: true,
      limitedUseAppCheckAvailable: true,
      appCheckMode: APP_CHECK_MODE,
      debugTokenUsed: false,
      tokenPersistence: 'none',
      tokenReuseDetected: false
    })),
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

test('private browser evidence binds five isolated exact synthetic subjects with real limited-use App Check', () => {
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
  ['token persistence', (value) => { value.subjects[4].tokenPersistence = 'localStorage'; }, 'group_d3_browser_harness_subject_e_invalid']
]) {
  test(`browser evidence fails closed for ${name}`, () => {
    const value = artifact();
    mutate(value);
    value.harnessDigest = harnessDigest(value);
    assert.throws(() => validate(value), (error) => error.reasons.includes(reason));
  });
}

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
