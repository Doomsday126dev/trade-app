'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/readinessContract.cjs');
const { generateSyntheticFixtures } = require('../staging/syntheticFixtures.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const files = [
  'docs/TRUSTED-FUNCTIONS-STAGING-READINESS.md',
  'functions/.env.staging.example',
  'functions/staging/readinessContract.cjs',
  'functions/staging/syntheticFixtures.cjs'
];
const trackedCandidate = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const functionsPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'functions/package.json'), 'utf8'));

assert.doesNotMatch(trackedCandidate, /trade-list-[a-z0-9-]+/i);
assert.doesNotMatch(trackedCandidate, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)/i);
assert.doesNotMatch(trackedCandidate, /BEGIN (?:RSA )?PRIVATE KEY|client_email|GOOGLE_APPLICATION_CREDENTIALS/);
assert.match(trackedCandidate, /<STAGING_PROJECT_ID>/);
assert.match(trackedCandidate, /<REGION>/);
assert.match(trackedCandidate, /<RUNTIME_SERVICE_ACCOUNT>/);
for (const command of Object.values(contract.COMMAND_TEMPLATES)) {
  if (command.includes('firebase deploy')) assert.match(command, /--project <STAGING_PROJECT_ID>/);
}
assert.equal(Object.keys(rootPackage.scripts).some((name) => /deploy|publish/i.test(name)), false);
assert.equal(Object.keys(functionsPackage.scripts).some((name) => /deploy|publish|postinstall/i.test(name)), false);
assert.deepEqual(Object.keys(contract.PATH_MATRIX).sort(), [...contract.CALLABLES].sort());
assert.equal(contract.GATE_SEQUENCE[0], 'deploy_additive_rules_gates_false');
assert.equal(contract.GATE_SEQUENCE.at(-1), 'review_evidence_before_simultaneous_enablement');
assert.equal(contract.RATE_LIMITS.implementationStatus, 'design_only');
assert.equal(contract.RETENTION.schedulerImplemented, false);
assert.equal(contract.RUNTIME.projectId, '<STAGING_PROJECT_ID>');
assert.equal(contract.RUNTIME.runtimeServiceAccount, '<RUNTIME_SERVICE_ACCOUNT>');
assert.equal(contract.RUNTIME.deploymentRegion, '<REGION>');
assert.equal(contract.APPROVALS.length, 14);
for (const mau of [100, 1000, 10000]) for (const activity of ['normal', 'high']) {
  const workload = contract.workloadFor(mau, activity);
  assert.ok(workload.invocations > 0);
  assert.equal(workload.appCheckAssessments, workload.invocations);
}
const fixtures = generateSyntheticFixtures();
assert.equal(fixtures.rtdb.shareVisibilityConfig.writesEnabled, false);
assert.equal(fixtures.rtdb.trainerPreferencesConfig.writesEnabled, false);
assert.equal(fixtures.authUsers.every((user) => user.uid.startsWith('syn_') && user.email.endsWith('@example.invalid')), true);

console.log('Trusted Functions staging-readiness check passed: placeholder-only, synthetic-only, no deploy or live capability.');
