'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingCreationApproval.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const docs = fs.readFileSync(path.join(repoRoot, 'docs/TRUSTED-FUNCTIONS-STAGING-CREATION-APPROVAL.md'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(repoRoot, 'functions/staging/staging-creation.approval.example.json'), 'utf8'));

test('default package has no operation capability and every choice is undecided', () => {
  const value = contract.createDefaultApproval();
  assert.equal(value.operationCapability, 'none');
  assert.equal(Object.values(value.decisions).every((item) => item.status === 'undecided'), true);
  assert.equal(Object.values(value.approvals).every((item) => item === 'undecided'), true);
  assert.equal(value.safety.bothWriteGatesFalse, true);
  assert.equal(value.safety.syntheticOnly, true);
});

test('approval statuses and decision identifiers are stable domain values', () => {
  assert.deepEqual(contract.APPROVAL_STATUSES, ['undecided', 'approved', 'rejected', 'not_applicable']);
  assert.equal(contract.DECISION_FIELDS.length, 13);
  assert.equal(contract.APPROVAL_ITEMS.length, 22);
  assert.equal(contract.DECISION_FIELDS.every((value) => /^[A-Z][A-Z0-9_]+$/.test(value)), true);
  assert.equal(contract.APPROVAL_ITEMS.every((value) => /^[a-z][a-z0-9_]+$/.test(value)), true);
});

test('tracked example matches the contract and contains placeholders only', () => {
  assert.deepEqual(Object.keys(template.decisions), [...contract.DECISION_FIELDS]);
  assert.deepEqual(Object.keys(template.approvals), [...contract.APPROVAL_ITEMS]);
  assert.equal(Object.values(template.decisions).every(({ status, value }) => status === 'undecided' && /^<[^>]+>$/.test(value)), true);
  assert.equal(Object.values(template.approvals).every((value) => value === 'undecided'), true);
});

test('project target gate rejects production equality invalid ids and placeholders', () => {
  const production = ['trade', 'list', 'a4297'].join('-');
  assert.deepEqual(contract.validateProjectTarget(production, production).errors, ['project_id_not_staging', 'production_target_forbidden']);
  assert.equal(contract.validateProjectTarget('candidate-staging', production).ok, true);
  assert.equal(contract.validateProjectTarget('<STAGING_PROJECT_ID>', production).ok, false);
  assert.equal(contract.validateProjectTarget('candidate-staging', '<PRODUCTION_PROJECT_ID>').ok, false);
});

test('RTDB choices are explicit immutable locations with colocated Functions regions', () => {
  assert.deepEqual(Object.keys(contract.LOCATION_GUIDE), ['us-central1', 'europe-west1', 'asia-southeast1']);
  for (const [location, value] of Object.entries(contract.LOCATION_GUIDE)) {
    assert.equal(value.functionsRegion, location);
    assert.equal(value.recreatesDatabaseToChange, true);
  }
  assert.match(docs, /us-east1.*does not approve/s);
});

test('IAM identities stay separated and runtime cannot deploy', () => {
  assert.equal(contract.IAM_MATRIX.runtimeMayDeploy, false);
  assert.equal(contract.IAM_MATRIX.runtime.some(({ role }) => role === 'roles/firebasedatabase.admin'), true);
  assert.equal(contract.IAM_MATRIX.runtime.some(({ role }) => /cloudfunctions|serviceAccountUser/.test(role)), false);
  assert.equal(contract.IAM_MATRIX.deployment.some(({ role }) => role === 'roles/iam.serviceAccountUser'), true);
  assert.match(contract.IAM_MATRIX.rtdbLimitation, /instance-wide/);
});

test('pricing sources are official current-review inputs and require revalidation', () => {
  assert.equal(contract.OFFICIAL_PRICING.verifiedOn, '2026-08-05');
  assert.equal(contract.OFFICIAL_PRICING.mustReverifyBeforeCreation, true);
  assert.equal(contract.OFFICIAL_PRICING.sources.length, 10);
  assert.equal(contract.OFFICIAL_PRICING.sources.every((url) => /^https:\/\/(?:cloud|docs\.cloud|firebase)\.google\.com\//.test(url)), true);
});

test('cost model is deterministic for all requested MAU and activity scenarios', () => {
  for (const mau of [100, 1000, 10000]) for (const activity of ['guarded', 'normal', 'high', 'abusive', 'catastrophic']) {
    assert.deepEqual(contract.costScenario(mau, activity), contract.costScenario(mau, activity));
  }
  assert.equal(contract.costScenario(100, 'normal').invocations, 1055);
  assert.equal(contract.costScenario(1000, 'high').invocations, 73100);
  assert.equal(contract.costScenario(10000, 'abusive').invocations, 135900000);
  assert.equal(contract.costScenario(100, 'guarded').invocations, 328);
  assert.equal(contract.costScenario(100, 'catastrophic').invocations, 13590000);
});

test('abusive activity exceeds high activity and retains bounded infrastructure assumptions', () => {
  for (const mau of [100, 1000, 10000]) {
    const high = contract.costScenario(mau, 'high');
    const abusive = contract.costScenario(mau, 'abusive');
    assert.ok(abusive.invocations > high.invocations);
    assert.ok(abusive.rtdbWrites > high.rtdbWrites);
  }
  assert.equal(contract.COST_ASSUMPTIONS.optionalCleanupJobs.abusive, 0);
  assert.equal(contract.COST_ASSUMPTIONS.rateLimiting.abusive, 'active_at_daily_ceiling');
  assert.equal(contract.COST_ASSUMPTIONS.rateLimiting.catastrophic, 'absent_or_bypassed');
  assert.equal(contract.COST_ASSUMPTIONS.maxInstances, 5);
  assert.equal(contract.COST_ASSUMPTIONS.concurrency, 10);
});

test('history verification is the dominant modeled normal and high operation', () => {
  for (const activity of ['normal', 'high']) {
    const values = contract.costScenario(1000, activity).byOperation;
    assert.equal(Math.max(...Object.values(values)), values.verifyTrainerHistory);
  }
});

test('budget design is advisory and includes percentage and absolute candidates', () => {
  assert.match(docs, /USD 10\/month/);
  assert.match(docs, /25\/50\/75\/90\/100/);
  assert.match(docs, /USD 1\/3\/5\/10/);
  assert.match(docs, /advisory[^.]*do not cap spend/i);
});

test('cost guide covers normal high and abusive ranges without promising zero cost', () => {
  assert.match(docs, /100 \| normal/);
  assert.match(docs, /10,000 \| bounded abuse/);
  assert.match(docs, /USD 136,000-150,000/);
  assert.match(docs, /USD 1\.36-1\.50 million/);
  assert.match(docs, /modeled sensitivity ranges, not expected bills/i);
  assert.match(docs, /10x runaway retry/);
  assert.match(docs, /planning\s*ranges, not quotes/i);
  assert.match(docs, /first meaningful charge/);
});

test('teardown covers every resource and persistent-cost category', () => {
  assert.equal(contract.TEARDOWN_CATEGORIES.length, 14);
  for (const category of contract.TEARDOWN_CATEGORIES) {
    assert.match(docs, new RegExp(category.replaceAll('_', '[ _/]'), 'i'));
  }
  assert.match(docs, /Artifact Registry images.*Storage charges can continue/s);
});

test('rules prerequisites retain exact reviewed hashes and disabled gates', () => {
  assert.equal(contract.RULE_HASHES.narrowReadBaseline, 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf');
  assert.equal(contract.RULE_HASHES.additiveCandidate, 'cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c');
  assert.equal(template.safety.bothWriteGatesFalse, true);
  assert.match(docs, /44 passed, 0 failed/);
});

test('synthetic namespace excludes production-derived fixtures', () => {
  assert.equal(template.decisions.SYNTHETIC_FIXTURE_NAMESPACE.value, '<SYNTHETIC_FIXTURE_NAMESPACE>');
  assert.match(docs, /No production export,\s*count, timestamp, name, UID, hash, report, or share content is permitted/s);
});

test('App Check approval covers browser PWA debug observation enforcement and rollback', () => {
  for (const expected of ['Chrome', 'Safari', 'installed-PWA', 'metrics-only', 'false rejections']) {
    assert.ok(docs.includes(expected));
  }
  assert.match(docs, /disable\s+staging enforcement/);
  assert.match(docs, /Debug tokens remain ignored, staging-only/);
});

test('manual billing kill switch covers gates clients functions schedules and retained costs', () => {
  assert.match(docs, /Set both server write gates false/);
  assert.match(docs, /Disable every staging client invocation path/);
  assert.match(docs, /Disable or delete the four staging Functions/);
  assert.match(docs, /Artifact Registry storage/);
  assert.match(docs, /No automated billing-triggered shutdown/);
});

test('approval package requires explicit decisions in safe operator order', () => {
  for (const item of contract.APPROVAL_ITEMS) assert.ok(template.approvals[item]);
  assert.match(docs, /Reverify official pricing/);
  assert.match(docs, /choose the immutable RTDB location/i);
  assert.match(docs, /both write gates\s*false/i);
  assert.match(docs, /Enable one gate for one bounded canary group/);
});

test('command examples are placeholders with explicit staging target', () => {
  assert.match(docs, /firebase deploy --only database --project <STAGING_PROJECT_ID>/);
  assert.match(docs, /firebase deploy --only functions --project <STAGING_PROJECT_ID>/);
  assert.match(docs, /never rely on a CLI default project/i);
});

test('tracked package contains no production target credential or cloud adapter', () => {
  const files = [
    'docs/TRUSTED-FUNCTIONS-STAGING-CREATION-APPROVAL.md',
    'functions/staging/stagingCreationApproval.cjs',
    'functions/staging/staging-creation.approval.example.json'
  ];
  const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  const production = ['trade', 'list', 'a4297'].join('-');
  assert.equal(text.includes(production), false);
  assert.doesNotMatch(text, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|child_process|GOOGLE_APPLICATION_CREDENTIALS|BEGIN (?:RSA )?PRIVATE KEY|client_email/i);
});

test('ignored local approval paths are protected from tracking', () => {
  const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(ignore, /^functions\/staging\/staging-creation\.approval\.local\.json$/m);
  assert.match(ignore, /^\.local\/staging-creation-approvals\/$/m);
});

test('production activation cohort and client wiring remain explicitly out of scope', () => {
  assert.match(docs, /No step authorizes production use/);
  assert.match(docs, /client wiring/);
  assert.match(docs, /cohort selection/);
  assert.match(docs, /simultaneous gate activation/);
});
