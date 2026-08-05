'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const approval = require('../staging/stagingCreationApproval.cjs');
const recommendations = require('../staging/stagingRecommendations.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const files = [
  'docs/TRUSTED-FUNCTIONS-STAGING-RECOMMENDATIONS.md',
  'functions/staging/stagingRecommendations.cjs',
  'functions/test/staging-recommendations.test.cjs'
];
const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
const executable = fs.readFileSync(path.join(repoRoot, 'functions/staging/stagingRecommendations.cjs'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(repoRoot, 'functions/staging/staging-creation.approval.example.json'), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

assert.deepEqual(Object.keys(recommendations.DECISION_RECOMMENDATIONS), [...approval.DECISION_FIELDS]);
assert.equal(Object.values(recommendations.DECISION_RECOMMENDATIONS).every(({ status }) => status === 'recommendation_only'), true);
assert.equal(recommendations.createRecommendationPackage().operationCapability, 'none');
assert.equal(recommendations.createRecommendationPackage().mutatesApprovalTemplate, false);
assert.equal(Object.values(template.decisions).every(({ status, value }) => status === 'undecided' && /^<[^>]+>$/.test(value)), true);
assert.equal(Object.values(template.approvals).every((status) => status === 'undecided'), true);
assert.equal(template.safety.bothWriteGatesFalse, true);
assert.equal(template.safety.syntheticOnly, true);
assert.equal(recommendations.APP_CHECK_ENFORCEMENT_CRITERIA.enforcementConfigured, false);
assert.equal(recommendations.INITIAL_COST_POSTURE.gatesDefaultFalse, true);
assert.equal(recommendations.INITIAL_COST_POSTURE.passivePageLoadCalls, false);
assert.equal(recommendations.INITIAL_COST_POSTURE.loginTriggeredCalls, false);
assert.equal(recommendations.INITIAL_COST_POSTURE.polling, false);
assert.equal(recommendations.INITIAL_COST_POSTURE.scheduledCleanup, false);
assert.match(text, /sensitivity and incident-planning estimates, not expected/);
assert.match(text, /absent, failed, or bypassed/);
assert.match(text, /must\s+be reverified.*before\s+any resource is created/s);
assert.match(text, /confirmed_valid_identity: 3/);
assert.match(text, /unreviewed: 49/);
assert.match(text, /seedEligibleTrueCount: 0/);

const production = ['trade', 'list', 'a4297'].join('-');
assert.equal(text.includes(production), false);
assert.equal(approval.validateProjectTarget(production, production).ok, false);
assert.equal(recommendations.validateRecommendedProjectTarget(`${production}-staging-r4nd`, production).ok, false);
assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)|BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{20,}/i);
assert.doesNotMatch(executable, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(/);
assert.equal(Object.keys(rootPackage.scripts).some((name) => /deploy|publish|create:staging|apply:staging/i.test(name)), false);
assert.equal(fs.existsSync(path.join(repoRoot, '.firebaserc')), false);

console.log('Staging recommendations check passed: 13 recommendation-only fields, all approvals undecided, no operation capability.');
