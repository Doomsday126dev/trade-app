'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { readProofSubjectHash } = require('../e1-authority-service/readRateLimiters');
const {
  COHORT_SIZE,
  D2_BASELINE,
  EXECUTION_EVIDENCE_PURPOSE,
  SYNTHETIC_COHORT_TYPE,
  sha256
} = require('./e1ProductionThirdMutationContract.cjs');

const SETUP_OPERATION = 'prepare-d3-synthetic-canaries-v1';
const SETUP_OPERATION_ID = /^d3-synthetic-setup-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FIREBASE_UID = /^e1-d3-canary-[a-e]-[a-z0-9]{12,32}$/u;
const TRAINER_NAME = /^E1D3Canary[A-E][A-Za-z0-9]{10,24}$/u;
const EMAIL = /^[a-z0-9_]+(?:_v[1-9][0-9]*)?@pogotrades\.nyc$/u;
const PIN = /^[0-9]{6}$/u;
const SLOTS = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const PRIVATE_SETUP_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'cohortStage', 'cohortType', 'evidencePurpose',
  'setupOperation', 'setupOperationId', 'createdAt', 'canaryCount', 'canaries', 'preState',
  'mutationBudget', 'e1Baseline', 'setupDigest', 'executionAuthorized', 'groupEAuthorized'
]);
const CANARY_FIELDS = Object.freeze([
  'slot', 'firebaseUid', 'trainerUsername', 'authEmail', 'password', 'pin', 'authVersion',
  'isAdmin', 'isOwner'
]);
const PRE_STATE_FIELDS = Object.freeze(['verifiedAt', 'canaries']);
const PRE_STATE_CANARY_FIELDS = Object.freeze([
  'slot', 'authUserAbsent', 'authEmailAbsent', 'trainerUserAbsent', 'loginDirectoryAbsent',
  'authIndexAbsent', 'accountAbsent', 'trainerHandleAbsent', 'rateLimitAbsent',
  'operationRequestAbsent', 'identityMigrationAbsent', 'identityConflictAbsent',
  'priorCohortMemberAbsent'
]);
const SETUP_MUTATION_BUDGET = Object.freeze({
  firebaseAuthUserCreates: COHORT_SIZE,
  rtdbUserRecordCreates: COHORT_SIZE,
  rtdbLoginDirectoryCreates: COHORT_SIZE,
  rtdbAuthIndexCreates: COHORT_SIZE,
  rtdbPathCreatesTotal: COHORT_SIZE * 3,
  e1FirestoreWrites: 0,
  maximumSetupMutations: COHORT_SIZE * 4,
  maximumRollbackDeletes: COHORT_SIZE * 4,
  exactReplayMutations: 0
});
const SETUP_LIFECYCLE = Object.freeze({
  idempotency: 'exact-setup-operation-and-fingerprint-replay-only',
  conflictingExistingState: 'fail-closed-no-overwrite',
  rollbackScope: 'ledger-created-unconsumed-canaries-only',
  rollbackForbiddenAfterD3Reserve: true,
  successfulD3CanaryRetention: 'retain-through-group-e-rollout',
  automaticCleanup: false
});
const LEGACY_RECORD_CONTRACT = Object.freeze({
  userFields: Object.freeze([
    'friendCode', 'joined', 'pin', 'pinHashed', 'authVersion',
    'authEmail', 'authUid', 'isAdmin', 'isOwner'
  ]),
  loginDirectoryFields: Object.freeze(['authVersion', 'authReady', 'approvedAt']),
  authIndexFields: Object.freeze(['username', 'isAdmin', 'isOwner', 'lastSeen']),
  unrelatedRootsCreated: Object.freeze([])
});

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function privateMode(file) {
  try { return (fs.statSync(file).mode & 0o777) === 0o600; } catch { return false; }
}

function authEmailFor(trainerUsername, authVersion) {
  const base = trainerUsername.toLowerCase().replace(/[^a-z0-9]/gu, '_');
  return `${base}${authVersion > 1 ? `_v${authVersion}` : ''}@pogotrades.nyc`;
}

function pinHash(pin) {
  return sha256(`${pin}pogo_salt_nyc`);
}

function legacySetupRecords(canary, createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) throw new Error('e1/group-d3-setup-created-at-invalid');
  return Object.freeze({
    user: Object.freeze({
      friendCode: '',
      joined: timestamp,
      pin: pinHash(canary.pin),
      pinHashed: true,
      authVersion: canary.authVersion,
      authEmail: canary.authEmail,
      authUid: canary.firebaseUid,
      isAdmin: false,
      isOwner: false
    }),
    loginDirectory: Object.freeze({ authVersion: canary.authVersion, authReady: true, approvedAt: timestamp }),
    authIndex: Object.freeze({ username: canary.trainerUsername, isAdmin: false, isOwner: false, lastSeen: timestamp })
  });
}

function canaryIdentity(canary) {
  const normalized = normalizeHandle(canary.trainerUsername);
  return Object.freeze({
    slot: canary.slot,
    uidHash: readProofSubjectHash('uid', canary.firebaseUid),
    trainerHash: readProofSubjectHash('trainer', normalized.display),
    handleKey: normalized.handleKey,
    credentialFingerprint: sha256(JSON.stringify([
      1, 'e1-group-d3-private-canary-credential', canary.authEmail, canary.password, canary.pin
    ]))
  });
}

function setupDigest(plan) {
  return sha256(JSON.stringify([
    1,
    'e1-group-d3-synthetic-setup',
    SYNTHETIC_COHORT_TYPE,
    EXECUTION_EVIDENCE_PURPOSE,
    plan.setupOperationId,
    D2_BASELINE.stateDigest,
    plan.canaries.map((canary) => Object.freeze({
      identity: canaryIdentity(canary),
      rtdbRecords: legacySetupRecords(canary, plan.createdAt)
    })),
    SETUP_MUTATION_BUDGET
  ]));
}

function exactRtdbRecordMatches(expected, actual) {
  return isDeepStrictEqual(actual, expected);
}

function validateCanary(canary, slot, errors) {
  if (!exactFields(canary, CANARY_FIELDS) || canary.slot !== slot ||
      !FIREBASE_UID.test(canary.firebaseUid || '') || !TRAINER_NAME.test(canary.trainerUsername || '') ||
      !EMAIL.test(canary.authEmail || '') || canary.authVersion !== 1 ||
      canary.authEmail !== authEmailFor(canary.trainerUsername, canary.authVersion) ||
      typeof canary.password !== 'string' || canary.password.length < 16 || canary.password.length > 128 ||
      !PIN.test(canary.pin || '') || canary.isAdmin !== false || canary.isOwner !== false) {
    errors.push(`group_d3_setup_canary_${slot.toLowerCase()}_invalid`);
  }
}

function validatePreState(preState, canaries, now, errors) {
  const verifiedAt = Date.parse(preState?.verifiedAt);
  if (!exactFields(preState, PRE_STATE_FIELDS) || !Number.isFinite(verifiedAt) || verifiedAt > now ||
      !Array.isArray(preState.canaries) || preState.canaries.length !== COHORT_SIZE) {
    errors.push('group_d3_setup_prestate_invalid');
    return;
  }
  preState.canaries.forEach((entry, index) => {
    if (!exactFields(entry, PRE_STATE_CANARY_FIELDS) || entry.slot !== SLOTS[index] ||
        PRE_STATE_CANARY_FIELDS.slice(1).some((field) => entry[field] !== true) ||
        canaries[index]?.slot !== entry.slot) errors.push(`group_d3_setup_prestate_${SLOTS[index].toLowerCase()}_invalid`);
  });
}

function validateSyntheticCanarySetup(plan, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  if (!privateMode(options.setupPath || '')) errors.push('group_d3_setup_permissions_invalid');
  if (!exactFields(plan, PRIVATE_SETUP_FIELDS) || plan.schemaVersion !== 1 || plan.environment !== 'production' ||
      plan.projectId !== 'trade-list-a4297' || plan.cohortStage !== 'D3' ||
      plan.cohortType !== SYNTHETIC_COHORT_TYPE || plan.evidencePurpose !== EXECUTION_EVIDENCE_PURPOSE ||
      plan.setupOperation !== SETUP_OPERATION || !SETUP_OPERATION_ID.test(plan.setupOperationId || '') ||
      !Number.isFinite(Date.parse(plan.createdAt)) || Date.parse(plan.createdAt) > now ||
      plan.canaryCount !== COHORT_SIZE || !Array.isArray(plan.canaries) || plan.canaries.length !== COHORT_SIZE ||
      JSON.stringify(plan.mutationBudget) !== JSON.stringify(SETUP_MUTATION_BUDGET) ||
      JSON.stringify(plan.e1Baseline) !== JSON.stringify(D2_BASELINE) ||
      !/^[a-f0-9]{64}$/u.test(plan.setupDigest || '') || plan.executionAuthorized !== false ||
      plan.groupEAuthorized !== false) errors.push('group_d3_setup_schema_invalid');
  if (Array.isArray(plan?.canaries)) plan.canaries.forEach((canary, index) => {
    if (SLOTS[index]) validateCanary(canary, SLOTS[index], errors);
    else errors.push('group_d3_setup_schema_invalid');
  });
  if (Array.isArray(plan?.canaries) && plan.canaries.length === COHORT_SIZE) {
    const identities = plan.canaries.flatMap((canary) => [canary.firebaseUid, canary.trainerUsername, canary.authEmail]);
    if (new Set(identities).size !== identities.length) errors.push('group_d3_setup_identity_collision');
    try {
      const handles = plan.canaries.map((canary) => normalizeHandle(canary.trainerUsername).handleKey);
      if (new Set(handles).size !== handles.length) errors.push('group_d3_setup_handle_collision');
    } catch { errors.push('group_d3_setup_handle_collision'); }
  }
  validatePreState(plan?.preState, plan?.canaries || [], now, errors);
  if (plan?.setupDigest !== setupDigest(plan)) errors.push('group_d3_setup_digest_mismatch');
  if (errors.length) {
    const error = new Error('e1/production-third-mutation-canary-setup-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    canaryCount: COHORT_SIZE,
    setupDigest: plan.setupDigest,
    exactSetupMutationBudget: SETUP_MUTATION_BUDGET.maximumSetupMutations,
    e1FirestoreWrites: 0,
    d2BaselinePreserved: true,
    executionAuthorized: false,
    groupEAuthorized: false,
    cloudOperations: 0
  });
}

function setupMutationLedger(plan) {
  return Object.freeze(plan.canaries.flatMap((canary) => [
    Object.freeze({ slot: canary.slot, family: 'firebase-auth', operation: 'create', pathHash: readProofSubjectHash('uid', canary.firebaseUid) }),
    Object.freeze({ slot: canary.slot, family: 'rtdb-users', operation: 'create', pathHash: readProofSubjectHash('trainer', canary.trainerUsername) }),
    Object.freeze({ slot: canary.slot, family: 'rtdb-login-directory', operation: 'create', pathHash: readProofSubjectHash('trainer', canary.trainerUsername) }),
    Object.freeze({ slot: canary.slot, family: 'rtdb-auth-index', operation: 'create', pathHash: readProofSubjectHash('uid', canary.firebaseUid) })
  ]));
}

function rollbackPlan(plan, ledger, consumedSlots = []) {
  if (consumedSlots.length) throw new Error('e1/group-d3-setup-rollback-after-reserve-forbidden');
  const expected = setupMutationLedger(plan);
  if (!Array.isArray(ledger) || ledger.length > expected.length ||
      JSON.stringify(ledger) !== JSON.stringify(expected.slice(0, ledger.length))) {
    throw new Error('e1/group-d3-setup-rollback-ledger-invalid');
  }
  return Object.freeze([...ledger].reverse().map((entry) => Object.freeze({ ...entry, operation: 'delete' })));
}

module.exports = Object.freeze({
  CANARY_FIELDS,
  FIREBASE_UID,
  LEGACY_RECORD_CONTRACT,
  PRIVATE_SETUP_FIELDS,
  SETUP_LIFECYCLE,
  SETUP_MUTATION_BUDGET,
  SETUP_OPERATION,
  SETUP_OPERATION_ID,
  SLOTS,
  TRAINER_NAME,
  authEmailFor,
  canaryIdentity,
  exactRtdbRecordMatches,
  legacySetupRecords,
  pinHash,
  rollbackPlan,
  setupDigest,
  setupMutationLedger,
  validateSyntheticCanarySetup
});
