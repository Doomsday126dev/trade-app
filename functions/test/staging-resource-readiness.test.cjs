'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const preflight = require('../staging/stagingResourcePreflight.cjs');
const readiness = require('../staging/stagingResourceReadiness.cjs');
const cli = require('../scripts/staging-resource-readiness.cjs');

async function withPrivateFile(callback) {
  fs.rmSync(preflight.PRIVATE_INPUT_PATH, { force: true });
  preflight.createTemplate();
  try { return await callback(); } finally { fs.rmSync(preflight.PRIVATE_INPUT_PATH, { force: true }); }
}

test('secure suffix generator emits exactly eight lowercase alphanumeric characters', () => {
  assert.match(readiness.generateRandomSuffix(() => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 252, 253, 254, 255, 8, 9, 10, 11])), /^[a-z0-9]{8}$/);
});

test('suffix command stores but never outputs the suffix', () => withPrivateFile(async () => {
  const output = [];
  await cli.run(['generate-suffix'], { output: (line) => output.push(line) });
  const stored = preflight.readPrivateInputs().inputs.RANDOM_SUFFIX;
  assert.match(stored, /^[a-z0-9]{8}$/);
  assert.doesNotMatch(output.join('\n'), new RegExp(stored));
  assert.match(output.join('\n'), /"randomSuffixConfigured": true/);
}));

test('project candidate is composed privately and output remains redacted', () => withPrivateFile(async () => {
  readiness.applyPublicInputs();
  readiness.updateDocument((document) => { document.inputs.RANDOM_SUFFIX = 'a1b2c3d4'; });
  const output = [];
  await cli.run(['compose-project-id'], { output: (line) => output.push(line) });
  const stored = preflight.readPrivateInputs().inputs.STAGING_PROJECT_ID;
  assert.equal(stored.length, 28);
  assert.equal(stored, 'trainer-hub-staging-a1b2c3d4');
  assert.doesNotMatch(output.join('\n'), /trainer-hub-staging|a1b2c3d4/);
  assert.match(output.join('\n'), /"projectIdFormatValid": true/);
}));

test('production and normalization-similar candidates remain rejected', () => {
  const inputs = { APP_SLUG: 'trainer-hub', RANDOM_SUFFIX: 'a1b2c3d4' };
  assert.ok(preflight.validateProjectId(['trade', 'list', 'a4297'].join('-'), inputs).includes('production_similarity_rejected'));
  assert.ok(preflight.validateProjectId(['trade', 'list', 'a4298'].join('-'), inputs).includes('production_similarity_rejected'));
});

test('availability check is explicitly noncreating and unresolved', () => withPrivateFile(() => {
  readiness.applyPublicInputs();
  readiness.updateDocument((document) => { document.inputs.RANDOM_SUFFIX = 'a1b2c3d4'; document.inputs.STAGING_PROJECT_ID = 'trainer-hub-staging-a1b2c3d4'; });
  const result = readiness.availabilityStatus();
  assert.equal(result.mode, 'check-only');
  assert.equal(result.status, 'unresolved_until_approved_creation_attempt');
  assert.equal(result.cloudOperations, 0);
}));

test('private field updates report status without echoing values', () => withPrivateFile(async () => {
  const output = [];
  await cli.run(['set-private', 'HUMAN_OPERATOR'], { promptHidden: async () => 'private-human-value', output: (line) => output.push(line) });
  assert.equal(preflight.readPrivateInputs().inputs.HUMAN_OPERATOR, 'private-human-value');
  assert.doesNotMatch(output.join('\n'), /private-human-value/);
  assert.match(output.join('\n'), /"configured": true/);
}));

test('private path requires mode 0700 directory and mode 0600 file', () => withPrivateFile(() => {
  assert.equal(fs.statSync(path.dirname(preflight.PRIVATE_INPUT_PATH)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(preflight.PRIVATE_INPUT_PATH).mode & 0o777, 0o600);
  assert.equal(readiness.securePrivatePath(), preflight.PRIVATE_INPUT_PATH);
}));

test('alternate and symlinked private paths remain rejected', () => {
  assert.throws(() => preflight.resolvePrivateInputPath('/tmp/staging-private.json'), (error) => error.code === 'preflight/path_forbidden');
  withPrivateFile(() => {
    const real = `${preflight.PRIVATE_INPUT_PATH}.real`;
    fs.renameSync(preflight.PRIVATE_INPUT_PATH, real);
    fs.symlinkSync(real, preflight.PRIVATE_INPUT_PATH);
    try { assert.throws(() => readiness.securePrivatePath(), (error) => error.code === 'readiness/insecure_file'); }
    finally { fs.rmSync(preflight.PRIVATE_INPUT_PATH, { force: true }); fs.renameSync(real, preflight.PRIVATE_INPUT_PATH); }
  });
});

test('window helper creates exactly two future timezone-qualified hours', () => withPrivateFile(() => {
  const now = Date.parse('2030-01-01T10:00:00Z');
  const result = readiness.configureWindow('RESOURCE_CREATION_WINDOW', '2030-01-01T12:00:00-05:00', now);
  const value = preflight.readPrivateInputs().inputs.RESOURCE_CREATION_WINDOW;
  assert.equal(Date.parse(value.expiresAt) - Date.parse(value.startAt), 2 * 60 * 60 * 1000);
  assert.equal(result.durationHours, 2);
}));

test('expired and nonfuture windows fail closed', () => withPrivateFile(() => {
  const now = Date.parse('2030-01-01T10:00:00Z');
  assert.throws(() => readiness.configureWindow('RESOURCE_CREATION_WINDOW', '2030-01-01T09:00:00Z', now), (error) => error.code === 'readiness/window_start_invalid');
}));

test('reviewed rules hashes recompute from canonical fixtures', () => {
  assert.deepEqual(readiness.verifyRuleHashes(), { rollbackValid: true, additiveValid: true, ...readiness.ZERO_OPERATIONS });
});

test('pricing verification records official source names and current posture', () => {
  assert.equal(readiness.PRICING_VERIFICATION.verifiedAt, '2026-08-05');
  assert.equal(readiness.PRICING_VERIFICATION.officialSources.length, 9);
  assert.equal(readiness.PRICING_VERIFICATION.materialAssumptionChanged, false);
  assert.equal(readiness.PRICING_VERIFICATION.budgetStillReasonable, true);
});

test('redacted readiness summary contains no concrete private values or paths', () => withPrivateFile(() => {
  readiness.applyPublicInputs();
  readiness.updateDocument((document) => { document.inputs.HUMAN_OPERATOR = 'private-human-value'; });
  const summary = readiness.readinessSummary(Date.parse('2030-01-01T10:00:00Z'));
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /private-human-value|functions\/.local|trainer-hub-staging-/);
  assert.equal(Object.values(summary.approvalStates).every((value) => value === 'undecided'), true);
}));

test('existing preflight summary exposes the requested redacted aggregate fields', () => withPrivateFile(() => {
  const validation = preflight.validatePreflight(preflight.readPrivateInputs());
  const summary = preflight.redactedSummary(validation);
  assert.equal(typeof summary.configuredFieldCount, 'number');
  assert.equal(typeof summary.missingFieldCount, 'number');
  assert.equal(summary.resourceCreationReady, false);
  assert.doesNotMatch(JSON.stringify(summary), /functions\/.local|trainer-hub-staging-/);
}));

test('passing local validation cannot alter any approval state', () => withPrivateFile(() => {
  const before = preflight.readPrivateInputs().approvals;
  readiness.readinessSummary();
  const after = preflight.readPrivateInputs().approvals;
  assert.deepEqual(after, before);
  assert.equal(Object.values(after).every((entry) => entry.approvalStatus === 'undecided' && entry.approvedBy === '' && entry.approvedAt === ''), true);
}));

test('inventory-only plan excludes every later operation', () => {
  const excluded = readiness.INVENTORY_ONLY_PLAN.excluded;
  for (const item of ['rules_deployment', 'functions_deployment', 'app_check_registration', 'fixture_creation', 'write_gate_activation', 'canary_execution', 'client_wiring', 'production_actions']) assert.ok(excluded.includes(item));
  assert.equal(readiness.INVENTORY_ONLY_PLAN.allowed.at(-1), 'verify_inventory_and_stop');
});

test('readiness source has no cloud creation mutation or shell capability', () => {
  const source = fs.readFileSync(path.join(__dirname, '../staging/stagingResourceReadiness.cjs'), 'utf8') + fs.readFileSync(path.join(__dirname, '../scripts/staging-resource-readiness.cjs'), 'utf8');
  assert.doesNotMatch(source, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(|gcloud|projects\.create|firebase\s+deploy/);
  assert.doesNotMatch(source, /GOOGLE_APPLICATION_CREDENTIALS|access[_-]?token|private[_-]?key/i);
});

test('all readiness outputs retain zero-operation counters', () => {
  assert.deepEqual(readiness.ZERO_OPERATIONS, { cloudOperations: 0, stagingReads: 0, stagingWrites: 0, productionReads: 0, productionWrites: 0 });
});
