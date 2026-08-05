'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const approval = require('../staging/stagingCreationApproval.cjs');
const recommendations = require('../staging/stagingRecommendations.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const doc = fs.readFileSync(path.join(repoRoot, 'docs/TRUSTED-FUNCTIONS-STAGING-RECOMMENDATIONS.md'), 'utf8');
const templatePath = path.join(repoRoot, 'functions/staging/staging-creation.approval.example.json');
const templateBytes = fs.readFileSync(templatePath);
const template = JSON.parse(templateBytes);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('recommendation package is non-operational and cannot mutate approvals', () => {
  const before = sha256(templateBytes);
  const value = recommendations.createRecommendationPackage();
  assert.equal(value.status, 'recommendation_only');
  assert.equal(value.operationCapability, 'none');
  assert.equal(value.mutatesApprovalTemplate, false);
  assert.equal(sha256(fs.readFileSync(templatePath)), before);
});

test('all thirteen decision fields have complete recommendation tradeoffs', () => {
  assert.deepEqual(Object.keys(recommendations.DECISION_RECOMMENDATIONS), [...approval.DECISION_FIELDS]);
  for (const value of Object.values(recommendations.DECISION_RECOMMENDATIONS)) {
    assert.equal(value.status, 'recommendation_only');
    for (const key of ['recommended', 'alternative', 'why', 'cost', 'security', 'complexity', 'reversibility', 'requiredBeforeApproval']) {
      assert.equal(typeof value[key], 'string');
      assert.ok(value[key].length > 8);
    }
    assert.match(value.confidence, /^(?:low|medium|high)(?: after RTDB selection)?$/);
  }
});

test('tracked approval template remains placeholder-only and undecided', () => {
  assert.equal(Object.values(template.decisions).every(({ status, value }) => status === 'undecided' && /^<[^>]+>$/.test(value)), true);
  assert.equal(Object.values(template.approvals).every((status) => status === 'undecided'), true);
  assert.equal(template.operationCapability, 'none');
});

test('project recommendation is visibly staging-only and random suffix is not authority', () => {
  const item = recommendations.DECISION_RECOMMENDATIONS.STAGING_PROJECT_ID;
  assert.equal(item.recommended, '<APP_SLUG>-staging-<RANDOM_SUFFIX>');
  assert.match(item.why, /collisions/);
  assert.match(item.why, /not an authorization control/);
  const production = ['trade', 'list', 'a4297'].join('-');
  assert.equal(approval.validateProjectTarget(production, production).ok, false);
  assert.deepEqual(
    recommendations.validateRecommendedProjectTarget(`${production}-staging-x7k9`, production).errors,
    ['project_id_visually_similar_to_production']
  );
  assert.equal(recommendations.validateRecommendedProjectTarget('pogo-share-staging-x7k9', production).ok, true);
});

test('billing recommendation separates convenience isolation and advisory budgets', () => {
  assert.match(doc, /future production billing account with a separate\s+staging budget/i);
  assert.match(doc, /separate billing account.*stronger accounting\s+isolation/s);
  assert.match(doc, /advisory and do not stop charges/i);
  assert.match(doc, /time-bounded billing operator/i);
});

test('RTDB recommendation compares all locations without approving one', () => {
  for (const location of ['us-central1', 'europe-west1', 'asia-southeast1']) assert.ok(doc.includes(location));
  assert.match(doc, /us-central1.*undecided default recommendation/s);
  assert.match(doc, /RTDB location is immutable/);
  assert.equal(template.decisions.RTDB_LOCATION.status, 'undecided');
});

test('Functions region stays unresolved and requires source parameterization', () => {
  assert.equal(template.decisions.FUNCTIONS_REGION.value, '<REGION>');
  assert.match(doc, /us-east1.*not approval/s);
  assert.match(doc, /must be parameterized/);
  assert.match(doc, /all four callables in one\s+region/i);
});

test('staging web app recommendation keeps production configuration untracked', () => {
  const item = recommendations.DECISION_RECOMMENDATIONS.STAGING_WEB_APP_NAME;
  assert.match(item.recommended, /staging web/);
  assert.match(item.security, /Never copy production config/);
  assert.match(doc, /No client wiring occurs/);
});

test('App Check remains unconfigured behind a measurable observation gate', () => {
  const criteria = recommendations.APP_CHECK_ENFORCEMENT_CRITERIA;
  assert.equal(criteria.enforcementConfigured, false);
  assert.equal(criteria.minimumAcceptedSyntheticInvocations, 120);
  assert.equal(criteria.minimumAcceptedPerCallablePerEnvironment, 10);
  assert.equal(criteria.acceptedTokenRateMinimum, 0.99);
  assert.equal(criteria.unexplainedRejectionsMaximum, 0);
  assert.deepEqual(criteria.environments, ['chrome_browser', 'safari_browser', 'installed_pwa']);
});

test('runtime deployment rules and human identities remain separated', () => {
  const items = recommendations.DECISION_RECOMMENDATIONS;
  assert.notEqual(items.RUNTIME_SERVICE_ACCOUNT.recommended, items.DEPLOYMENT_SERVICE_ACCOUNT.recommended);
  assert.match(items.RUNTIME_SERVICE_ACCOUNT.security, /cannot deploy/);
  assert.match(items.DEPLOYMENT_SERVICE_ACCOUNT.security, /deployment window/);
  assert.match(items.RULES_OPERATOR_IDENTITY.security, /rules-release role/);
  assert.match(items.HUMAN_OPERATOR.security, /viewer access/i);
});

test('instance-wide RTDB IAM risk keeps required compensating controls', () => {
  assert.match(doc, /RTDB Admin is broad and cannot express path-level\s+least privilege/);
  for (const value of ['isolated staging', 'fixed adapters', 'disabled gates', 'App Check', 'idempotency/rate limits', 'mutation-root']) {
    assert.ok(doc.includes(value));
  }
  assert.match(doc, /four service accounts add operational burden/);
});

test('budget recommendation compares five ten and twenty-five dollars', () => {
  assert.match(doc, /USD 10\/month/);
  assert.match(doc, /USD 5 for one very short/);
  assert.match(doc, /USD 25 only after/);
  assert.match(doc, /USD 3-5/);
  assert.match(doc, /not a hard spending cap/);
});

test('alert recommendation has private placeholder escalation and response actions', () => {
  for (const threshold of ['25/50/75/90/100%', 'USD 1/3/5/10', '<PRIMARY_ALERT_RECIPIENT>', '<BACKUP_ALERT_RECIPIENT>']) assert.ok(doc.includes(threshold));
  assert.match(doc, /daily\s+actual\/forecast alerts/);
  assert.match(doc, /Execute the full kill switch/);
});

test('synthetic fixtures use actual roots without production-derived values', () => {
  assert.match(doc, /actual candidate roots/);
  assert.match(doc, /nesting all data under a new parent would not exercise production-like\s+rules/);
  assert.match(doc, /no\s+production-derived names, UIDs, emails, counts, hashes, timestamps, or list\s+contents/i);
  assert.match(doc, /allowlisted teardown\s+manifest/i);
});

test('low-spend posture keeps passive and scheduled work off', () => {
  const posture = recommendations.INITIAL_COST_POSTURE;
  assert.equal(posture.minInstances, 0);
  assert.equal(posture.maxInstances, 5);
  assert.equal(posture.concurrency, 10);
  assert.equal(posture.timeoutSeconds, 30);
  for (const key of ['passivePageLoadCalls', 'loginTriggeredCalls', 'polling', 'scheduledCleanup']) assert.equal(posture[key], false);
  assert.equal(posture.gatesDefaultFalse, true);
});

test('expected staging spend uses ranges and never promises zero', () => {
  assert.deepEqual(recommendations.EXPECTED_STAGING_SPEND.map(({ activity }) => activity), [
    'project_exists_unused',
    'one_small_deployment',
    'one_synthetic_canary_session',
    'several_test_sessions_monthly'
  ]);
  assert.equal(recommendations.EXPECTED_STAGING_SPEND.every(({ range, caveat }) => /^USD 0-/.test(range) && /No zero-cost promise|Assumes|allowances/.test(caveat)), true);
});

test('cost scenarios retain ranges assumptions and service attribution', () => {
  for (const label of ['Guarded', 'Normal', 'High', 'Bounded abuse', 'Catastrophic safeguards-disabled']) assert.ok(doc.includes(label));
  assert.match(doc, /sensitivity and incident-planning estimates, not expected\s+bills or quotes/i);
  assert.match(doc, /10,550 conservative assessments/);
  assert.match(doc, /about USD 8/);
  assert.match(doc, /USD 0-12 uncertainty buffer/);
  assert.match(doc, /not a vague aggregate Firebase charge/);
});

test('bounded and catastrophic scenarios state their failed safeguard assumptions', () => {
  assert.equal(recommendations.COST_SCENARIO_GUARDS.boundedAbuse.maxInstances, 'effective');
  assert.equal(recommendations.COST_SCENARIO_GUARDS.boundedAbuse.rateLimits, 'saturated_for_every_uid_every_day');
  assert.equal(recommendations.COST_SCENARIO_GUARDS.catastrophic.maxInstances, 'not_assumed_effective_for_full_demand_range');
  assert.equal(recommendations.COST_SCENARIO_GUARDS.catastrophic.meaning, 'attempted_demand_stress_envelope');
  assert.match(doc, /every MAU reaches every daily ceiling for 30 days/);
  assert.match(doc, /10x runaway retry\/automation/);
  assert.match(doc, /absent, failed, or bypassed/);
  assert.match(doc, /does \*\*not\*\* impose a hard monthly bill/);
  assert.match(doc, /roughly 442 million\s+completed calls/);
  assert.match(doc, /1\.359 billion attempted calls cannot all complete/);
  assert.match(doc, /uncapped attempted-demand stress envelope/);
});

test('approval dependency order protects immutable location and resource approval', () => {
  assert.equal(recommendations.APPROVAL_DEPENDENCY_ORDER[0], 'official_pricing_reverification');
  assert.ok(recommendations.APPROVAL_DEPENDENCY_ORDER.indexOf('rtdb_location') < recommendations.APPROVAL_DEPENDENCY_ORDER.indexOf('functions_region'));
  assert.equal(recommendations.APPROVAL_DEPENDENCY_ORDER.at(-1), 'separate_resource_creation_approval');
  assert.match(doc, /RTDB location comes early because it cannot be changed in place/);
});

test('official pricing and monetization boundaries remain explicit', () => {
  assert.match(doc, /must\s+be reverified.*before\s+any resource is created/s);
  assert.match(doc, /Basic\s+privacy and security controls cannot become paid-only/s);
  assert.match(doc, /billing status must\s+never grant private-share access/s);
  assert.match(doc, /tier and price design\s+remains deferred/s);
});

test('safety boundary preserves disabled gates flags and private review aggregates', () => {
  assert.match(doc, /Both client flags and both server write gates remain\s+false or absent/s);
  assert.match(doc, /confirmed_valid_identity: 3/);
  assert.match(doc, /unreviewed: 49/);
  assert.match(doc, /seedEligibleTrueCount: 0/);
  assert.match(doc, /performs no staging or\s+production read or write/s);
});

test('recommendation sources contain no operation or sensitive configuration capability', () => {
  const files = [
    'docs/TRUSTED-FUNCTIONS-STAGING-RECOMMENDATIONS.md',
    'functions/staging/stagingRecommendations.cjs'
  ];
  const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  const production = ['trade', 'list', 'a4297'].join('-');
  assert.equal(text.includes(production), false);
  assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)|BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.|AIza[A-Za-z0-9_-]{20,}/i);
  assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'functions/staging/stagingRecommendations.cjs'), 'utf8'), /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(/);
});
