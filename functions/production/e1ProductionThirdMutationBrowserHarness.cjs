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
const HARNESS_MODE = 'real-browser-synthetic-canary-v1';
const LOGIN_METHOD = 'legacy-username-pin-firebase-password-v1';
const APP_CHECK_MODE = 'production-limited-use-token';
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
  'limitedUseAppCheckAvailable', 'appCheckMode', 'debugTokenUsed', 'tokenPersistence',
  'tokenReuseDetected'
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
    1,
    'e1-group-d3-synthetic-browser-harness',
    SYNTHETIC_COHORT_TYPE,
    EXECUTION_EVIDENCE_PURPOSE,
    artifact.bindingDigest,
    artifact.verifiedAt,
    artifact.subjects
  ]));
}

function validateBrowserHarnessArtifact(artifact, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  if (!privateMode(options.harnessPath || '')) errors.push('group_d3_browser_harness_permissions_invalid');
  const verifiedAt = Date.parse(artifact?.verifiedAt);
  if (!exactFields(artifact, HARNESS_FIELDS) || artifact.schemaVersion !== 1 || artifact.environment !== 'production' ||
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
        subject.firebaseIdTokenFresh !== true || subject.limitedUseAppCheckAvailable !== true ||
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
  APP_CHECK_MODE,
  EXPECTED_APP_ID,
  HARNESS_FIELDS,
  HARNESS_MODE,
  LOGIN_METHOD,
  SUBJECT_FIELDS,
  createBrowserExecutionHarness,
  harnessDigest,
  validateBrowserHarnessArtifact
});
