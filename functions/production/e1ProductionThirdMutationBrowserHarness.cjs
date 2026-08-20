'use strict';

const fs = require('node:fs');
const {
  COHORT_SIZE,
  ENTRY_EVIDENCE_MAX_AGE_MS,
  EXECUTION_EVIDENCE_PURPOSE,
  SYNTHETIC_COHORT_TYPE,
  sha256
} = require('./e1ProductionThirdMutationContract.cjs');

const EXPECTED_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const EXPECTED_ORIGIN = 'https://doomsday126dev.github.io';
const EXPECTED_PATHNAMES = Object.freeze(['/trade-app/', '/trade-app/index.html']);
const HARNESS_MODE = 'real-browser-synthetic-canary-v2';
const LOGIN_METHOD = 'legacy-username-pin-firebase-password-v1';
const APP_CHECK_MODE = 'production-limited-use-token';
const APP_CHECK_STAGE_TIMEOUT_MS = 30 * 1000;
const APP_CHECK_PROBE_TIMEOUT_MS = 3 * 60 * 1000;
const SLOTS = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const HASH = /^[a-f0-9]{64}$/u;
const HARNESS_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'appId', 'cohortStage', 'cohortType', 'evidencePurpose',
  'mode', 'bindingDigest', 'verifiedAt', 'subjects', 'debugTokensUsed', 'tokensPersisted',
  'executionAuthorized', 'groupEAuthorized', 'harnessDigest'
]);
const SUBJECT_FIELDS = Object.freeze([
  'slot', 'uidHash', 'trainerHash', 'browserContextHash', 'loginMethod', 'exactUidMatch',
  'previousSessionAbsent', 'operatorAdminSessionAbsent', 'firebaseIdTokenFresh',
  'appCheckProvenance', 'appCheckMode', 'debugTokenUsed', 'tokenPersistence',
  'tokenReuseDetected'
]);
const APP_CHECK_PROVENANCE_FIELDS = Object.freeze([
  'slot', 'origin', 'pathname', 'appId', 'uidHash', 'trainerHash', 'bindingDigest', 'probeStartedAt',
  'samePageRuntimeEstablished', 'pageRuntimeBinding', 'sdkImport', 'readiness', 'appCheckInstance', 'limitedUseToken',
  'failureStage', 'runtimeProofDigest'
]);
const STAGE_FIELDS = Object.freeze(['startedAt', 'settledAt', 'outcome']);
const INSTANCE_STAGE_FIELDS = Object.freeze([...STAGE_FIELDS, 'exactInstance']);
const TOKEN_STAGE_FIELDS = Object.freeze([
  ...STAGE_FIELDS, 'nonEmpty', 'tokenFingerprint', 'debug', 'persisted', 'reused', 'sentToCallable'
]);

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function privateMode(file) {
  try { return (fs.statSync(file).mode & 0o777) === 0o600; } catch { return false; }
}

function harnessDigest(artifact) {
  return sha256(JSON.stringify([
    2,
    'e1-group-d3-synthetic-browser-harness',
    SYNTHETIC_COHORT_TYPE,
    EXECUTION_EVIDENCE_PURPOSE,
    artifact.bindingDigest,
    artifact.verifiedAt,
    artifact.subjects
  ]));
}

function limitedUseTokenFingerprint(token) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('e1/group-d3-app-check-token-empty');
  return sha256(JSON.stringify([1, 'e1-group-d3-limited-use-app-check-token', token]));
}

function appCheckRuntimeProofDigest(provenance) {
  const stages = [
    ['page-runtime-binding', provenance?.pageRuntimeBinding],
    ['sdk-import', provenance?.sdkImport],
    ['readiness', provenance?.readiness],
    ['instance', provenance?.appCheckInstance],
    ['limited-use-token', provenance?.limitedUseToken]
  ].map(([name, stage]) => [
    name,
    stage?.startedAt,
    stage?.settledAt,
    stage?.outcome,
    stage?.exactInstance ?? null
  ]);
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-app-check-runtime-proof',
    provenance?.slot,
    provenance?.bindingDigest,
    provenance?.origin,
    provenance?.pathname,
    provenance?.appId,
    provenance?.uidHash,
    provenance?.trainerHash,
    provenance?.probeStartedAt,
    stages,
    provenance?.limitedUseToken?.tokenFingerprint ?? null
  ]));
}

function validStage(stage, fields, outcome) {
  if (!exactFields(stage, fields) || stage.outcome !== outcome) return false;
  const startedAt = Date.parse(stage.startedAt);
  const settledAt = Date.parse(stage.settledAt);
  return Number.isFinite(startedAt) && Number.isFinite(settledAt) && settledAt >= startedAt &&
    settledAt - startedAt <= APP_CHECK_STAGE_TIMEOUT_MS;
}

function validAppCheckProvenance(provenance, artifact, subject) {
  if (!exactFields(provenance, APP_CHECK_PROVENANCE_FIELDS) || provenance.slot !== subject.slot ||
      provenance.origin !== EXPECTED_ORIGIN || !EXPECTED_PATHNAMES.includes(provenance.pathname) ||
      provenance.appId !== EXPECTED_APP_ID || provenance.uidHash !== subject.uidHash ||
      provenance.trainerHash !== subject.trainerHash || provenance.bindingDigest !== artifact.bindingDigest ||
      provenance.samePageRuntimeEstablished !== true || provenance.failureStage !== null ||
      !validStage(provenance.pageRuntimeBinding, STAGE_FIELDS, 'verified') ||
      !validStage(provenance.sdkImport, STAGE_FIELDS, 'resolved') ||
      !validStage(provenance.readiness, STAGE_FIELDS, 'resolved') ||
      !validStage(provenance.appCheckInstance, INSTANCE_STAGE_FIELDS, 'verified') ||
      provenance.appCheckInstance.exactInstance !== true ||
      !validStage(provenance.limitedUseToken, TOKEN_STAGE_FIELDS, 'resolved') ||
      provenance.limitedUseToken.nonEmpty !== true || !HASH.test(provenance.limitedUseToken.tokenFingerprint || '') ||
      provenance.limitedUseToken.debug !== false || provenance.limitedUseToken.persisted !== false ||
      provenance.limitedUseToken.reused !== false || provenance.limitedUseToken.sentToCallable !== false ||
      !HASH.test(provenance.runtimeProofDigest || '') ||
      provenance.runtimeProofDigest !== appCheckRuntimeProofDigest(provenance)) return false;
  const stages = [provenance.pageRuntimeBinding, provenance.sdkImport, provenance.readiness, provenance.appCheckInstance,
    provenance.limitedUseToken];
  const starts = stages.map((stage) => Date.parse(stage.startedAt));
  const ends = stages.map((stage) => Date.parse(stage.settledAt));
  const probeStartedAt = Date.parse(provenance.probeStartedAt);
  const verifiedAt = Date.parse(artifact.verifiedAt);
  return Number.isFinite(probeStartedAt) && probeStartedAt === starts[0] &&
    starts.every((startedAt, index) => index === 0 || startedAt >= ends[index - 1]) &&
    Number.isFinite(verifiedAt) && ends.at(-1) <= verifiedAt &&
    verifiedAt - starts[0] <= APP_CHECK_PROBE_TIMEOUT_MS;
}

function stageTimeout(promise, timeoutMs, stage) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`e1/group-d3-app-check-${stage}-timeout`),
        { code: `group_d3_app_check_${stage}_timeout`, stage })), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function runSameRuntimeAppCheckProbe(options = {}) {
  const { adapter, slot, origin, pathname, appId, uidHash, trainerHash, bindingDigest } = options;
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const timeoutMs = options.stageTimeoutMs || APP_CHECK_STAGE_TIMEOUT_MS;
  if (!adapter || !SLOTS.includes(slot) || origin !== EXPECTED_ORIGIN || !EXPECTED_PATHNAMES.includes(pathname) ||
      appId !== EXPECTED_APP_ID || !HASH.test(uidHash || '') ||
      !HASH.test(trainerHash || '') || !HASH.test(bindingDigest || '') ||
      typeof adapter.importSdk !== 'function' || typeof adapter.firebaseAppCheckReady !== 'function' ||
      typeof adapter.verifyPageRuntime !== 'function' || typeof adapter.isExpectedInstance !== 'function' ||
      typeof adapter.getLimitedUseToken !== 'function' ||
      (options.stageTimeoutMs !== undefined &&
        (!Number.isFinite(options.stageTimeoutMs) || options.stageTimeoutMs <= 0 ||
          options.stageTimeoutMs > APP_CHECK_STAGE_TIMEOUT_MS))) {
    throw new Error('e1/group-d3-app-check-probe-config-invalid');
  }
  const evidence = {
    slot, origin, pathname, appId, uidHash, trainerHash, bindingDigest,
    probeStartedAt: null, samePageRuntimeEstablished: false
  };
  let expectedInstance;
  let token;
  async function timed(stage, operation, outcome = 'resolved') {
    const startedAt = now();
    try {
      const value = await stageTimeout(operation(), timeoutMs, stage);
      return { value, record: { startedAt, settledAt: now(), outcome } };
    } catch (error) {
      error.stage = error.stage || stage;
      throw error;
    }
  }
  try {
    const runtimeBinding = await timed('page-runtime-binding', async () => {
      const verified = await adapter.verifyPageRuntime({ slot, origin, pathname, appId, uidHash, trainerHash, bindingDigest });
      if (verified !== true) throw Object.assign(new Error('e1/group-d3-app-check-page-runtime-mismatch'), { stage: 'page-runtime-binding' });
      return true;
    }, 'verified');
    evidence.pageRuntimeBinding = runtimeBinding.record;
    evidence.probeStartedAt = evidence.pageRuntimeBinding.startedAt;
    evidence.samePageRuntimeEstablished = true;
    const sdk = await timed('import', () => adapter.importSdk());
    evidence.sdkImport = sdk.record;
    const ready = await timed('readiness', () => adapter.firebaseAppCheckReady(), 'resolved');
    evidence.readiness = ready.record;
    expectedInstance = ready.value?.instance || ready.value;
    const instance = await timed('instance', () =>
      Boolean(expectedInstance) && adapter.isExpectedInstance(expectedInstance) === true, 'verified');
    const exactInstance = instance.value === true;
    evidence.appCheckInstance = { ...instance.record, exactInstance };
    if (!exactInstance) throw Object.assign(new Error('e1/group-d3-app-check-instance-mismatch'), { stage: 'instance' });
    const acquired = await timed('token', () => adapter.getLimitedUseToken(expectedInstance), 'resolved');
    token = acquired.value?.token;
    evidence.limitedUseToken = {
      ...acquired.record,
      nonEmpty: typeof token === 'string' && token.length > 0,
      tokenFingerprint: limitedUseTokenFingerprint(token),
      debug: acquired.value?.debug === true,
      persisted: false,
      reused: false,
      sentToCallable: false
    };
    evidence.failureStage = null;
    evidence.runtimeProofDigest = appCheckRuntimeProofDigest(evidence);
    return Object.freeze(evidence);
  } finally {
    token = null;
    expectedInstance = null;
  }
}

function validateBrowserHarnessArtifact(artifact, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  if (!privateMode(options.harnessPath || '')) errors.push('group_d3_browser_harness_permissions_invalid');
  const verifiedAt = Date.parse(artifact?.verifiedAt);
  if (!exactFields(artifact, HARNESS_FIELDS) || artifact.schemaVersion !== 2 || artifact.environment !== 'production' ||
      artifact.projectId !== 'trade-list-a4297' || artifact.appId !== EXPECTED_APP_ID || artifact.cohortStage !== 'D3' ||
      artifact.cohortType !== SYNTHETIC_COHORT_TYPE || artifact.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
      artifact.mode !== HARNESS_MODE || !HASH.test(artifact.bindingDigest || '') ||
      !Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > ENTRY_EVIDENCE_MAX_AGE_MS ||
      !Array.isArray(artifact.subjects) || artifact.subjects.length !== COHORT_SIZE ||
      artifact.debugTokensUsed !== false || artifact.tokensPersisted !== false ||
      artifact.executionAuthorized !== false || artifact.groupEAuthorized !== false ||
      !HASH.test(artifact.harnessDigest || '')) errors.push('group_d3_browser_harness_schema_invalid');
  if (Array.isArray(artifact?.subjects)) artifact.subjects.forEach((subject, index) => {
    if (!exactFields(subject, SUBJECT_FIELDS) || subject.slot !== SLOTS[index] || !HASH.test(subject.uidHash || '') ||
        !HASH.test(subject.trainerHash || '') || !HASH.test(subject.browserContextHash || '') ||
        subject.loginMethod !== LOGIN_METHOD || subject.exactUidMatch !== true ||
        subject.previousSessionAbsent !== true || subject.operatorAdminSessionAbsent !== true ||
        subject.firebaseIdTokenFresh !== true || !validAppCheckProvenance(subject.appCheckProvenance, artifact, subject) ||
        subject.appCheckMode !== APP_CHECK_MODE || subject.debugTokenUsed !== false ||
        subject.tokenPersistence !== 'none' || subject.tokenReuseDetected !== false) {
      errors.push(`group_d3_browser_harness_subject_${SLOTS[index].toLowerCase()}_invalid`);
    }
  });
  if (Array.isArray(artifact?.subjects)) {
    for (const field of ['uidHash', 'trainerHash', 'browserContextHash']) {
      const values = artifact.subjects.map((subject) => subject[field]);
      if (new Set(values).size !== values.length) errors.push('group_d3_browser_harness_subjects_not_isolated');
    }
    const tokenFingerprints = artifact.subjects.map((subject) => subject.appCheckProvenance?.limitedUseToken?.tokenFingerprint);
    if (new Set(tokenFingerprints).size !== tokenFingerprints.length) errors.push('group_d3_browser_harness_token_reuse');
  }
  if (artifact?.harnessDigest !== harnessDigest(artifact)) errors.push('group_d3_browser_harness_digest_mismatch');
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-browser-harness-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    bindingDigest: artifact.bindingDigest,
    harnessDigest: artifact.harnessDigest,
    subjectsReady: COHORT_SIZE,
    authenticFirebaseLoginRequired: true,
    limitedUseAppCheckRequired: true,
    debugTokensUsed: false,
    tokensPersisted: false,
    executionAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

function createBrowserExecutionHarness({ subjects, authAdapter, appCheckAdapter, gatewayAdapter }) {
  if (!Array.isArray(subjects) || subjects.length !== COHORT_SIZE ||
      !authAdapter || !appCheckAdapter || !gatewayAdapter) throw new Error('e1/group-d3-browser-harness-config-invalid');
  let nextStep = 0;
  const usedTokenFingerprints = new Set();
  const sequence = SLOTS.flatMap((slot) => [{ slot, operation: 'reserve' }, { slot, operation: 'exact-replay' }]);

  async function execute({ slot, operation, credential }) {
    const expected = sequence[nextStep];
    if (!expected || slot !== expected.slot || operation !== expected.operation) {
      throw new Error('e1/group-d3-browser-harness-sequence-invalid');
    }
    const subject = subjects[nextStep >> 1];
    if (subject.slot !== slot || subject.isAdmin === true || subject.isOwner === true) {
      throw new Error('e1/group-d3-browser-harness-subject-invalid');
    }
    let firebaseIdToken = null;
    let appCheckToken = null;
    try {
      await authAdapter.signOut();
      if (authAdapter.currentUser()) throw new Error('e1/group-d3-browser-harness-session-not-isolated');
      const signedIn = await authAdapter.signInWithLegacyCredential(credential);
      if (!signedIn || signedIn.uid !== subject.firebaseUid || authAdapter.currentUser()?.uid !== subject.firebaseUid) {
        throw new Error('e1/group-d3-browser-harness-uid-mismatch');
      }
      firebaseIdToken = await authAdapter.getFreshIdToken();
      appCheckToken = await appCheckAdapter.getLimitedUseToken();
      if (!firebaseIdToken?.token || firebaseIdToken.fresh !== true || !appCheckToken?.token ||
          appCheckToken.limitedUse !== true || appCheckToken.debug === true) {
        throw new Error('e1/group-d3-browser-harness-token-invalid');
      }
      for (const token of [firebaseIdToken.token, appCheckToken.token]) {
        const fingerprint = sha256(JSON.stringify([1, 'e1-group-d3-ephemeral-token', token]));
        if (usedTokenFingerprints.has(fingerprint)) throw new Error('e1/group-d3-browser-harness-token-reuse');
        usedTokenFingerprints.add(fingerprint);
      }
      const result = await gatewayAdapter.reserveTrainerHandle({
        body: subject.requestBody,
        firebaseIdToken: firebaseIdToken.token,
        limitedUseAppCheckToken: appCheckToken.token
      });
      nextStep += 1;
      return Object.freeze({ slot, operation, resultCode: result.resultCode });
    } finally {
      firebaseIdToken = null;
      appCheckToken = null;
      await authAdapter.signOut();
    }
  }

  return Object.freeze({ execute, next: () => sequence[nextStep] || null });
}

module.exports = Object.freeze({
  APP_CHECK_PROBE_TIMEOUT_MS,
  APP_CHECK_PROVENANCE_FIELDS,
  APP_CHECK_STAGE_TIMEOUT_MS,
  APP_CHECK_MODE,
  EXPECTED_PATHNAMES,
  EXPECTED_APP_ID,
  EXPECTED_ORIGIN,
  HARNESS_FIELDS,
  HARNESS_MODE,
  LOGIN_METHOD,
  SUBJECT_FIELDS,
  appCheckRuntimeProofDigest,
  createBrowserExecutionHarness,
  harnessDigest,
  limitedUseTokenFingerprint,
  runSameRuntimeAppCheckProbe,
  validAppCheckProvenance,
  validateBrowserHarnessArtifact
});
