'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingResourcePreflight.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const tracked = [
  'docs/TRUSTED-FUNCTIONS-STAGING-RESOURCE-PREFLIGHT.md',
  'functions/staging/stagingResourcePreflight.cjs',
  'functions/staging/staging-resource-inputs.example.json',
  'functions/scripts/staging-resource-preflight.cjs',
  'functions/test/staging-resource-preflight.test.cjs'
];
const text = tracked.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
const executable = fs.readFileSync(path.join(repoRoot, 'functions/staging/stagingResourcePreflight.cjs'), 'utf8') + fs.readFileSync(path.join(repoRoot, 'functions/scripts/staging-resource-preflight.cjs'), 'utf8');
const template = contract.loadTemplate();
const result = contract.validatePreflight(template, { now: Date.parse('2026-08-05T12:00:00-04:00') });

assert.equal(result.operationCapability, 'local_placeholder_file_only');
assert.equal(result.cloudOperations, 0);
assert.equal(result.stagingReads, 0);
assert.equal(result.stagingWrites, 0);
assert.equal(result.productionReads, 0);
assert.equal(result.productionWrites, 0);
assert.equal(Object.values(result.approvalStates).every((status) => status === 'undecided'), true);
assert.equal(result.seedEligibleTrueCount, undefined);
assert.deepEqual(result.privateReview, { confirmedValidIdentity: 3, unreviewed: 49, seedEligibleTrueCount: 0 });
assert.doesNotMatch(executable, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(|gcloud|firebase\s+deploy/);
assert.doesNotMatch(text, /BEGIN (?:RSA )?PRIVATE KEY|"client_email"\s*:|"private_key"\s*:|ya29\.|AIza[A-Za-z0-9_-]{20,}/i);
assert.doesNotMatch(text, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
assert.equal(fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8').includes('functions/.local/'), true);
assert.equal(contract.RULE_HASHES.rollback, 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf');
assert.equal(contract.RULE_HASHES.additive, 'fc781919003a5afcba4fcf1e5235498090352deb1448e746b6c69ec61add6ac3');

console.log('Staging resource preflight check passed: private placeholders only, approvals undecided, no cloud capability.');
