'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingDecisionSummary.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const docs = fs.readFileSync(path.join(repoRoot, 'docs/TRUSTED-FUNCTIONS-STAGING-DECISION-SUMMARY.md'), 'utf8');

test('selected proposals remain separate from formal approval state', () => {
  const summary = contract.createDecisionSummary();
  for (const value of Object.values(summary.decisions)) {
    assert.deepEqual(value.selectedProposedValue, value.recommendedValue);
    assert.equal(value.approvalStatus, 'undecided');
    assert.equal(value.approvedBy, '');
    assert.equal(value.approvedAt, '');
  }
});

test('all eleven execution approvals remain undecided and empty', () => {
  const summary = contract.createDecisionSummary();
  assert.equal(contract.EXECUTION_APPROVAL_KEYS.length, 11);
  assert.deepEqual(Object.keys(summary.executionApprovals), [...contract.EXECUTION_APPROVAL_KEYS]);
  for (const value of Object.values(summary.executionApprovals)) {
    assert.deepEqual(value, { approvalStatus: 'undecided', approvedBy: '', approvedAt: '' });
  }
});

test('approval model has no operation capability', () => {
  const summary = contract.createDecisionSummary();
  assert.equal(summary.operationCapability, 'none');
  assert.equal(summary.status, 'proposal_only');
  assert.deepEqual(Object.keys(contract).filter((key) => /deploy|createResource|write|apply|publish|execute/i.test(key)), []);
});

test('region pairing is proposed and us-east1 remains unapproved debt', () => {
  assert.equal(contract.PROPOSED_CHOICES.rtdbLocation, 'us-central1');
  assert.equal(contract.PROPOSED_CHOICES.functionsRegion, 'us-central1');
  assert.equal(contract.PROPOSED_CHOICES.existingCallableRegionStatus, 'us-east1_unapproved_technical_debt_requires_separate_parameterization');
});

test('App Check rollout is metrics first and separately enforced', () => {
  const rollout = contract.PROPOSED_CHOICES.appCheckRollout;
  assert.equal(contract.PROPOSED_CHOICES.appCheckProvider, 'recaptcha-enterprise');
  assert.equal(rollout.minimumSyntheticCalls, 100);
  assert.equal(rollout.minimumLegitimateAcceptanceRate, 0.99);
  assert.equal(rollout.maximumUnexplainedLegitimateRejections, 0);
  assert.equal(rollout.enforcementRequiresSeparateApproval, true);
});

test('IAM posture preserves identity separation and broad RTDB warning', () => {
  const iam = contract.PROPOSED_CHOICES.iam;
  assert.deepEqual(iam.runtime, ['roles/firebasedatabase.admin', 'roles/firebaseappcheck.tokenVerifier', 'roles/logging.logWriter']);
  assert.deepEqual(iam.deployment, ['roles/cloudfunctions.developer', 'roles/serviceusage.serviceUsageConsumer']);
  assert.deepEqual(iam.operatorOnDeployment, ['roles/iam.serviceAccountTokenCreator']);
  assert.deepEqual(iam.operatorOnRuntime, ['roles/iam.serviceAccountUser']);
  assert.deepEqual(iam.reviewerMutationRoles, []);
  assert.match(iam.rtdbAdminWarning, /broad_instance_wide_not_path_level/);
});

test('budget and alerts are advisory selected proposals', () => {
  const { budget, billingAlerts } = contract.PROPOSED_CHOICES;
  assert.equal(budget.monthlyUsd, 10);
  assert.deepEqual(budget.manualInvestigationThresholdUsd, [3, 5]);
  assert.equal(budget.advisoryNotHardCap, true);
  assert.deepEqual(billingAlerts.actualUsd, [1, 2.5, 3, 5, 7.5, 9, 10]);
  assert.deepEqual(billingAlerts.forecastPercent, [50, 75, 100]);
  assert.equal(billingAlerts.previewSpendCapsIncluded, false);
});

test('synthetic fixtures use actual roots and exact ledger teardown', () => {
  const fixtures = contract.PROPOSED_CHOICES.syntheticFixtures;
  assert.deepEqual(fixtures.functionalRoots, [
    'accounts/{syntheticUid}',
    'shareVisibility/{syntheticUid}',
    'trainerShares/{syntheticUid}',
    'userPreferences/{syntheticUid}'
  ]);
  assert.equal(fixtures.ownershipLedger, 'stagingFixtureRuns/{fixtureRunId}');
  assert.equal(fixtures.wildcardTeardownAllowed, false);
  assert.equal(fixtures.productionDerivedValuesAllowed, false);
});

test('rules hashes match reviewed artifacts', () => {
  assert.equal(contract.RULE_HASHES.rollback, 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf');
  assert.equal(contract.RULE_HASHES.additive, 'cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c');
  assert.equal(contract.PROPOSED_CHOICES.rollbackRulesSha256, contract.RULE_HASHES.rollback);
  assert.equal(contract.PROPOSED_CHOICES.additiveRulesSha256, contract.RULE_HASHES.additive);
});

test('resource creation is inventory and stop with explicit exclusions', () => {
  const summary = contract.createDecisionSummary();
  assert.equal(contract.PROPOSED_CHOICES.resourceCreationBoundary, 'inventory_and_stop');
  assert.equal(summary.resourceCreation.scope.length, 10);
  for (const item of ['additive_rules_deployment', 'functions_deployment', 'synthetic_fixture_creation', 'write_gate_activation', 'canary_execution', 'production_actions']) {
    assert.ok(summary.resourceCreation.exclusions.includes(item));
  }
});

test('all concrete private values remain unresolved placeholders', () => {
  for (const value of Object.values(contract.UNRESOLVED_VALUES)) assert.match(value, /^<[^>]+>$/);
});

test('production project target remains rejected', () => {
  const production = ['trade', 'list', 'a4297'].join('-');
  const summary = structuredClone(contract.createDecisionSummary());
  summary.unresolvedValues.stagingProjectId = production;
  assert.deepEqual(contract.validateSummary(summary, production).errors, ['production_target_forbidden']);
});

test('approval mutation is rejected by validation', () => {
  const summary = structuredClone(contract.createDecisionSummary());
  summary.executionApprovals.functions_staging_deployment.approvalStatus = 'approved';
  assert.deepEqual(contract.validateSummary(summary).errors, ['execution_approval_changed:functions_staging_deployment']);
});

test('approval metadata is rejected while status is undecided', () => {
  const summary = structuredClone(contract.createDecisionSummary());
  summary.decisions.rtdbLocation.approvedBy = 'someone';
  assert.deepEqual(contract.validateSummary(summary).errors, ['decision_approval_metadata_present:rtdbLocation']);
});

test('flags gates cohort and private review state remain unchanged', () => {
  const safety = contract.SAFETY_STATE;
  assert.equal(safety.shareVisibilityModelEnabled, false);
  assert.equal(safety.syncedTrainerPreferencesEnabled, false);
  assert.equal(safety.shareVisibilityServerWriteGate, false);
  assert.equal(safety.trainerPreferencesServerWriteGate, false);
  assert.equal(safety.cohortSelected, false);
  assert.deepEqual(safety.privateReview, { confirmedValidIdentity: 3, unreviewed: 49, seedEligibleTrueCount: 0 });
});

test('future approvals require target scope evidence and rollback fields', () => {
  assert.deepEqual(contract.REQUIRED_APPROVAL_FIELDS, [
    'exactTarget',
    'approvedResourcesOrMutations',
    'artifactHashes',
    'operator',
    'approvalWindowDuration',
    'preflight',
    'smoke',
    'stoppingCriteria',
    'rollback'
  ]);
});

test('documentation distinguishes proposals from operations', () => {
  assert.match(docs, /proposal-only/i);
  assert.match(docs, /Every\s+`approvalStatus` remains `undecided`/);
  assert.match(docs, /No proposal triggers an operation/);
  assert.match(docs, /advisory and are not hard caps/i);
  assert.match(docs, /RESOURCE_CREATION_APPROVAL=undecided/);
  assert.match(docs, /No cohort is selected/);
});

test('tracked candidate contains no cloud adapter or sensitive value', () => {
  const files = [
    'docs/TRUSTED-FUNCTIONS-STAGING-DECISION-SUMMARY.md',
    'functions/staging/stagingDecisionSummary.cjs'
  ];
  const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  const executable = fs.readFileSync(path.join(repoRoot, files[1]), 'utf8');
  assert.doesNotMatch(executable, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(/);
  assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)|BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.|AIza[A-Za-z0-9_-]{20,}/i);
});
