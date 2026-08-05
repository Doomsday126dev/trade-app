'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingDecisionSummary.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const files = [
  'docs/TRUSTED-FUNCTIONS-STAGING-DECISION-SUMMARY.md',
  'functions/staging/stagingDecisionSummary.cjs',
  'functions/test/staging-decision-summary.test.cjs'
];
const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
const executable = fs.readFileSync(path.join(repoRoot, files[1]), 'utf8');
const summary = contract.createDecisionSummary();

assert.equal(contract.validateSummary(summary).ok, true);
assert.equal(summary.operationCapability, 'none');
assert.equal(Object.values(summary.decisions).every((value) => value.approvalStatus === 'undecided' && value.approvedBy === '' && value.approvedAt === ''), true);
assert.equal(Object.values(summary.executionApprovals).every((value) => value.approvalStatus === 'undecided' && value.approvedBy === '' && value.approvedAt === ''), true);
assert.equal(Object.keys(summary.executionApprovals).length, 11);
assert.equal(summary.resourceCreation.approvalStatus, 'undecided');
assert.equal(summary.safety.shareVisibilityModelEnabled, false);
assert.equal(summary.safety.syncedTrainerPreferencesEnabled, false);
assert.equal(summary.safety.shareVisibilityServerWriteGate, false);
assert.equal(summary.safety.trainerPreferencesServerWriteGate, false);
assert.equal(summary.safety.privateReview.seedEligibleTrueCount, 0);
assert.doesNotMatch(executable, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(/);
assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)|BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.|AIza[A-Za-z0-9_-]{20,}/i);
assert.doesNotMatch(text, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);

const production = ['trade', 'list', 'a4297'].join('-');
const invalid = structuredClone(summary);
invalid.unresolvedValues.stagingProjectId = production;
assert.deepEqual(contract.validateSummary(invalid, production).errors, ['production_target_forbidden']);

console.log('Staging decision summary check passed: proposals recorded, 11 approvals undecided, no operation capability.');
