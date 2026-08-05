'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingCreationApproval.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const files = [
  'docs/TRUSTED-FUNCTIONS-STAGING-CREATION-APPROVAL.md',
  'functions/staging/stagingCreationApproval.cjs',
  'functions/staging/staging-creation.approval.example.json'
];
const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
const executableCandidate = fs.readFileSync(path.join(repoRoot, 'functions/staging/stagingCreationApproval.cjs'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(repoRoot, files[2]), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const functionsPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'functions/package.json'), 'utf8'));

const productionId = ['trade', 'list', 'a4297'].join('-');
assert.equal(text.includes(productionId), false);
assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)/i);
assert.doesNotMatch(text, /BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{20,}/i);
assert.doesNotMatch(executableCandidate, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(/);
assert.equal(fs.existsSync(path.join(repoRoot, '.firebaserc')), false);
assert.equal(template.operationCapability, 'none');
assert.deepEqual(Object.keys(template.decisions), [...contract.DECISION_FIELDS]);
assert.deepEqual(Object.keys(template.approvals), [...contract.APPROVAL_ITEMS]);
for (const value of Object.values(template.decisions)) {
  assert.equal(value.status, 'undecided');
  assert.match(value.value, /^<[^>]+>$/);
}
assert.equal(Object.values(template.approvals).every((value) => value === 'undecided'), true);
assert.equal(template.safety.bothWriteGatesFalse, true);
assert.equal(template.safety.syntheticOnly, true);
assert.equal(template.safety.additiveRulesSha, contract.RULE_HASHES.additiveCandidate);
assert.equal(template.safety.rollbackRulesSha, contract.RULE_HASHES.narrowReadBaseline);
assert.equal(contract.OFFICIAL_PRICING.verifiedOn, '2026-08-05');
assert.equal(contract.OFFICIAL_PRICING.sources.length, 10);
for (const source of contract.OFFICIAL_PRICING.sources) assert.ok(text.includes(source));
for (const category of contract.TEARDOWN_CATEGORIES) assert.match(text, new RegExp(category.replaceAll('_', '[ _/]'), 'i'));
assert.match(text, /advisory[^.]*not (?:a )?(?:hard )?cap/i);
assert.match(text, /firebase deploy --only database --project <STAGING_PROJECT_ID>/);
assert.match(text, /firebase deploy --only functions --project <STAGING_PROJECT_ID>/);
assert.equal(Object.keys(rootPackage.scripts).some((name) => /deploy|publish/i.test(name)), false);
assert.equal(Object.keys(functionsPackage.scripts).some((name) => /deploy|publish|postinstall/i.test(name)), false);
for (const mau of [100, 1000, 10000]) for (const activity of ['guarded', 'normal', 'high', 'abusive', 'catastrophic']) {
  const scenario = contract.costScenario(mau, activity);
  assert.equal(scenario.appCheckAssessments, scenario.invocations);
  assert.ok(scenario.rtdbReads > 0 && scenario.rtdbWrites > 0);
}

console.log('Staging creation approval check passed: placeholder-only, all decisions undecided, no cloud operation capability.');
