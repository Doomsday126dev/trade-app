'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  D2_BASELINE,
  EXECUTION_EVIDENCE_PURPOSE,
  SYNTHETIC_COHORT_TYPE
} = require('../production/e1ProductionThirdMutationContract.cjs');
const {
  LEGACY_RECORD_CONTRACT,
  SETUP_MUTATION_BUDGET,
  SETUP_OPERATION,
  authEmailFor,
  exactRtdbRecordMatches,
  legacySetupRecords,
  rollbackPlan,
  setupDigest,
  setupMutationLedger,
  validateSyntheticCanarySetup
} = require('../production/e1ProductionThirdMutationCanarySetup.cjs');

const NOW = Date.parse('2026-08-16T12:00:00.000Z');

function fixture() {
  const canaries = ['A', 'B', 'C', 'D', 'E'].map((slot, index) => {
    const trainerUsername = `E1D3Canary${slot}00112233${index}${index}`;
    return {
      slot,
      firebaseUid: `e1-d3-canary-${slot.toLowerCase()}-00112233445${index}`,
      trainerUsername,
      authEmail: authEmailFor(trainerUsername, 1),
      password: `Private-Password-${index}-D3!`,
      pin: `90000${index}`,
      authVersion: 1,
      isAdmin: false,
      isOwner: false
    };
  });
  const plan = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    cohortStage: 'D3',
    cohortType: SYNTHETIC_COHORT_TYPE,
    evidencePurpose: EXECUTION_EVIDENCE_PURPOSE,
    setupOperation: SETUP_OPERATION,
    setupOperationId: 'd3-synthetic-setup-00112233-4455-4677-8899-aabbccddeeff',
    createdAt: '2026-08-16T11:50:00.000Z',
    canaryCount: 5,
    canaries,
    preState: {
      verifiedAt: '2026-08-16T11:55:00.000Z',
      canaries: canaries.map(({ slot }) => ({
        slot,
        authUserAbsent: true,
        authEmailAbsent: true,
        trainerUserAbsent: true,
        loginDirectoryAbsent: true,
        authIndexAbsent: true,
        accountAbsent: true,
        trainerHandleAbsent: true,
        rateLimitAbsent: true,
        operationRequestAbsent: true,
        identityMigrationAbsent: true,
        identityConflictAbsent: true,
        priorCohortMemberAbsent: true
      }))
    },
    mutationBudget: SETUP_MUTATION_BUDGET,
    e1Baseline: D2_BASELINE,
    setupDigest: '',
    executionAuthorized: false,
    groupEAuthorized: false
  };
  plan.setupDigest = setupDigest(plan);
  return plan;
}

function validate(plan = fixture(), mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-d3-setup-'));
  try {
    const setupPath = path.join(directory, 'setup.json');
    fs.writeFileSync(setupPath, `${JSON.stringify(plan)}\n`, { mode });
    fs.chmodSync(setupPath, mode);
    return validateSyntheticCanarySetup(plan, { now: () => NOW, setupPath });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('exact five absent synthetic canaries validate with a 20-mutation setup ceiling and zero E.1 writes', () => {
  const result = validate();
  assert.equal(result.ok, true);
  assert.equal(result.canaryCount, 5);
  assert.equal(result.exactSetupMutationBudget, 20);
  assert.equal(result.e1FirestoreWrites, 0);
  assert.equal(result.d2BaselinePreserved, true);
  assert.equal(result.executionAuthorized, false);
});

test('minimal legacy setup records contain only supported login and reciprocal ownership fields', () => {
  const plan = fixture();
  const records = legacySetupRecords(plan.canaries[0], plan.createdAt);
  assert.deepEqual(Object.keys(records.user).sort(), [
    'authEmail', 'authUid', 'authVersion', 'friendCode', 'isAdmin', 'isOwner', 'joined', 'pin',
    'pinHashed'
  ]);
  assert.deepEqual(Object.keys(records.user).sort(), [...LEGACY_RECORD_CONTRACT.userFields].sort());
  assert.equal(Object.values(records).flatMap(Object.values).includes(null), false);
  assert.deepEqual(records.loginDirectory, { authVersion: 1, authReady: true, approvedAt: Date.parse(plan.createdAt) });
  assert.deepEqual(records.authIndex, {
    username: plan.canaries[0].trainerUsername,
    isAdmin: false,
    isOwner: false,
    lastSeen: Date.parse(plan.createdAt)
  });
  assert.notEqual(records.user.pin, plan.canaries[0].pin);
});

test('persisted RTDB comparison remains exact after omitting unset timestamp children', () => {
  const plan = fixture();
  const expected = legacySetupRecords(plan.canaries[0], plan.createdAt).user;
  assert.equal(exactRtdbRecordMatches(expected, structuredClone(expected)), true);

  const missingRequired = structuredClone(expected);
  delete missingRequired.authUid;
  assert.equal(exactRtdbRecordMatches(expected, missingRequired), false);

  const unexpectedExtra = { ...structuredClone(expected), unexplained: true };
  assert.equal(exactRtdbRecordMatches(expected, unexpectedExtra), false);
});

for (const [name, mutate, reason] of [
  ['four canaries', (value) => { value.canaries.pop(); value.canaryCount = 4; }, 'group_d3_setup_schema_invalid'],
  ['six canaries', (value) => { value.canaries.push(structuredClone(value.canaries[0])); value.canaryCount = 6; }, 'group_d3_setup_schema_invalid'],
  ['partial existing Auth user', (value) => { value.preState.canaries[0].authUserAbsent = false; }, 'group_d3_setup_prestate_a_invalid'],
  ['partial login-directory entry', (value) => { value.preState.canaries[1].loginDirectoryAbsent = false; }, 'group_d3_setup_prestate_b_invalid'],
  ['partial ownership mapping', (value) => { value.preState.canaries[2].authIndexAbsent = false; }, 'group_d3_setup_prestate_c_invalid'],
  ['trainer collision', (value) => { value.canaries[1].trainerUsername = value.canaries[0].trainerUsername; value.canaries[1].authEmail = value.canaries[0].authEmail; }, 'group_d3_setup_identity_collision'],
  ['UID collision', (value) => { value.canaries[1].firebaseUid = value.canaries[0].firebaseUid; }, 'group_d3_setup_identity_collision'],
  ['admin canary', (value) => { value.canaries[2].isAdmin = true; }, 'group_d3_setup_canary_c_invalid'],
  ['E.1 setup write budget', (value) => { value.mutationBudget = { ...value.mutationBudget, e1FirestoreWrites: 1 }; }, 'group_d3_setup_schema_invalid']
]) {
  test(`synthetic setup fails closed for ${name}`, () => {
    const value = fixture();
    mutate(value);
    value.setupDigest = setupDigest(value);
    assert.throws(() => validate(value), (error) => error.reasons.includes(reason));
  });
}

test('setup exact replay uses the same deterministic digest and mutation ledger', () => {
  const first = fixture();
  const replay = structuredClone(first);
  assert.equal(setupDigest(first), setupDigest(replay));
  assert.deepEqual(setupMutationLedger(first), setupMutationLedger(replay));
  assert.equal(SETUP_MUTATION_BUDGET.exactReplayMutations, 0);
});

test('setup digest binds the exact persisted RTDB record shape', () => {
  const first = fixture();
  const changedRecordTimestamp = structuredClone(first);
  changedRecordTimestamp.createdAt = '2026-08-16T11:50:01.000Z';
  assert.notEqual(setupDigest(first), setupDigest(changedRecordTimestamp));
});

test('partial setup rollback deletes only the exact canonical creation prefix in reverse order', () => {
  const plan = fixture();
  const fullLedger = setupMutationLedger(plan);
  const partialLedger = fullLedger.slice(0, 7);
  const rollback = rollbackPlan(plan, partialLedger);
  assert.equal(fullLedger.length, 20);
  assert.equal(rollback.length, 7);
  assert.ok(rollback.every((entry) => entry.operation === 'delete'));
  assert.deepEqual(rollback.map(({ operation, ...entry }) => entry),
    [...partialLedger].reverse().map(({ operation, ...entry }) => entry));
  assert.deepEqual(rollbackPlan(plan, []), []);
  assert.throws(() => rollbackPlan(plan, fullLedger.slice(1)), /rollback-ledger-invalid/u);
  assert.throws(() => rollbackPlan(plan, [fullLedger[1]]), /rollback-ledger-invalid/u);
});

test('setup rollback is forbidden after any synthetic canary is consumed by D3', () => {
  const plan = fixture();
  assert.throws(() => rollbackPlan(plan, setupMutationLedger(plan), ['A']), /rollback-after-reserve-forbidden/u);
});

test('credential-bearing setup material requires private mode and safe output contains no credentials', () => {
  const plan = fixture();
  assert.throws(() => validate(plan, 0o644), (error) => error.reasons.includes('group_d3_setup_permissions_invalid'));
  const report = JSON.stringify(validate(plan));
  for (const canary of plan.canaries) {
    assert.doesNotMatch(report, new RegExp(canary.password.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.doesNotMatch(report, new RegExp(canary.pin, 'u'));
    assert.doesNotMatch(report, new RegExp(canary.authEmail, 'u'));
  }
});
