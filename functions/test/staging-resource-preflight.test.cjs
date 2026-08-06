'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/stagingResourcePreflight.cjs');
const cli = require('../scripts/staging-resource-preflight.cjs');

function completeInputs(now = '2030-01-01T12:00:00Z') {
  const document = structuredClone(contract.loadTemplate());
  Object.assign(document.inputs, {
    APP_SLUG: 'sampleapp',
    RANDOM_SUFFIX: 'a1b2c3d4',
    STAGING_PROJECT_ID: 'sampleapp-staging-a1b2c3d4',
    BILLING_ACCOUNT: 'billingAccounts/ABC123-DEF456-GHI789',
    BILLING_OPERATOR: 'private-operator-reference',
    STAGING_WEB_APP_NAME: 'Sample App Staging',
    RUNTIME_SERVICE_ACCOUNT: 'sampleapp-runtime-stg',
    DEPLOYMENT_SERVICE_ACCOUNT: 'sampleapp-deployer-stg',
    RULES_OPERATOR_IDENTITY: 'private-rules-operator',
    HUMAN_OPERATOR: 'private-human-operator',
    BILLING_ALERT_RECIPIENT: 'private-alert-destination',
    BILLING_ESCALATION_TARGET: 'private-escalation-destination',
    RESOURCE_CREATION_WINDOW: { startAt: now, expiresAt: '2030-01-01T16:00:00Z' },
    SMOKE_AND_ROLLBACK_WINDOW: { startAt: now, expiresAt: '2030-01-02T12:00:00Z' },
    TEARDOWN_OWNER: 'private-teardown-owner',
    TEARDOWN_OWNER_ACKNOWLEDGED: true
  });
  return document;
}

test('tracked template is placeholder-only and every approval is undecided', () => {
  const value = contract.loadTemplate();
  assert.equal(Object.values(value.approvals).every((approval) => approval.approvalStatus === 'undecided' && approval.approvedBy === '' && approval.approvedAt === ''), true);
  assert.equal(value.inputs.TEARDOWN_OWNER_ACKNOWLEDGED, false);
  assert.match(value.inputs.APP_SLUG, /^<[^>]+>$/);
});

test('template creation writes only the fixed ignored mode-0600 file', () => {
  fs.rmSync(contract.PRIVATE_INPUT_PATH, { force: true });
  try {
    assert.equal(contract.createTemplate(), contract.PRIVATE_INPUT_PATH);
    assert.equal(fs.statSync(contract.PRIVATE_INPUT_PATH).mode & 0o777, 0o600);
    assert.throws(() => contract.createTemplate(), (error) => error.code === 'EEXIST');
    assert.throws(() => contract.createTemplate('/tmp/not-allowed.json'), (error) => error.code === 'preflight/path_forbidden');
  } finally { fs.rmSync(contract.PRIVATE_INPUT_PATH, { force: true }); }
});

test('normal CLI output redacts all private values and paths', () => {
  fs.mkdirSync(path.dirname(contract.PRIVATE_INPUT_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(contract.PRIVATE_INPUT_PATH, `${JSON.stringify(completeInputs())}\n`, { mode: 0o600 });
  const lines = [];
  try {
    cli.run(['validate'], { now: Date.parse('2030-01-01T11:00:00Z'), output: (line) => lines.push(line) });
    const output = lines.join('\n');
    for (const privateValue of ['private-operator-reference', 'private-human-operator', 'private-alert-destination', 'ABC123-DEF456-GHI789', 'sampleapp-staging-a1b2c3d4']) assert.doesNotMatch(output, new RegExp(privateValue));
    assert.doesNotMatch(output, /functions\/.local/);
  } finally { fs.rmSync(contract.PRIVATE_INPUT_PATH, { force: true }); }
});

test('production and visually similar project identifiers are rejected', () => {
  const inputs = completeInputs().inputs;
  assert.ok(contract.validateProjectId(['trade', 'list', 'a4297'].join('-'), inputs).includes('production_similarity_rejected'));
  assert.ok(contract.validateProjectId(['trade', 'list', 'a4298'].join('-'), inputs).includes('production_similarity_rejected'));
  assert.ok(contract.validateProjectId(['trade', 'list', 'a4297', 'staging'].join('-'), inputs).includes('production_similarity_rejected'));
});

test('staging marker project composition and length are enforced', () => {
  const inputs = { APP_SLUG: 'sampleapp', RANDOM_SUFFIX: 'a1b2c3d4' };
  assert.deepEqual(contract.validateProjectId('sampleapp-staging-a1b2c3d4', inputs), []);
  assert.ok(contract.validateProjectId('sampleapp-test-a1b2c3d4', inputs).includes('staging_marker_required'));
  assert.ok(contract.validateProjectId('sampleapp-staging-wrong123', inputs).includes('composition_mismatch'));
  assert.ok(contract.validateProjectId(`sampleapp-staging-${'a'.repeat(20)}`, inputs).includes('format_invalid'));
});

test('app slug rules reject uppercase consecutive hyphens and production markers', () => {
  assert.deepEqual(contract.validateAppSlug('sample-app'), []);
  for (const value of ['Sample-app', 'sample--app', 'sample-', 'prod-app', 'a']) assert.ok(contract.validateAppSlug(value).length > 0);
});

test('random suffix requires eight lowercase letters or digits', () => {
  assert.deepEqual(contract.validateRandomSuffix('a1b2c3d4'), []);
  for (const value of ['short1', 'UPPER123', 'abcd-123', 'abcdefgh9']) assert.ok(contract.validateRandomSuffix(value).length > 0);
});

test('service account IDs follow current 6..30 character staging role patterns', () => {
  assert.deepEqual(contract.validateServiceAccount('sampleapp-runtime-stg', 'runtime'), []);
  assert.deepEqual(contract.validateServiceAccount('sampleapp-deployer-stg', 'deployer'), []);
  assert.ok(contract.validateServiceAccount('sampleapp-runtime-stg', 'deployer').includes('deployer_marker_required'));
  assert.ok(contract.validateServiceAccount('prod-runtime-stg', 'runtime').includes('production_ambiguity'));
  assert.ok(contract.validateServiceAccount(`${'a'.repeat(25)}-runtime-stg`, 'runtime').includes('format_invalid'));
});

test('resource labels require safe mandatory synthetic staging labels', () => {
  const labels = contract.loadTemplate().inputs.RESOURCE_LABELS;
  assert.deepEqual(contract.validateLabels(labels), []);
  assert.ok(contract.validateLabels({ ...labels, data_classification: 'private' }).includes('mandatory_label_invalid:data_classification'));
  assert.ok(contract.validateLabels({ ...labels, 'Bad Key': 'x' }).some((error) => error.startsWith('label_key_invalid')));
});

test('Group A recommendations are valid while the suffix stays unresolved', () => {
  const proposed = contract.PROPOSED_STATE;
  assert.equal(proposed.appSlug, 'trainer-hub');
  assert.equal(proposed.randomSuffix, '<unresolved>');
  assert.equal(proposed.stagingProjectId, 'trainer-hub-staging-<RANDOM_SUFFIX>');
  assert.equal('trainer-hub-staging-'.length + 8, 28);
  assert.deepEqual(contract.validateAppSlug(proposed.appSlug), []);
  assert.deepEqual(contract.validateServiceAccount(proposed.runtimeServiceAccount, 'runtime'), []);
  assert.deepEqual(contract.validateServiceAccount(proposed.deploymentServiceAccount, 'deployer'), []);
  assert.deepEqual(contract.validateLabels(proposed.resourceLabels), []);
  assert.equal(proposed.stagingWebAppName, 'Trainer Hub Staging');
});

test('Groups B and C retain relationships durations and unresolved private values only', () => {
  const proposed = contract.PROPOSED_STATE;
  assert.equal(proposed.privateRoleRelationship.relationship, 'same_private_person_initially_holds_all_six_responsibilities');
  assert.equal(proposed.privateRoleRelationship.roles.length, 6);
  assert.equal(proposed.privateRoleRelationship.independentTwoPersonReview, false);
  assert.equal(proposed.privateRoleRelationship.concreteIdentitiesResolved, false);
  assert.equal(proposed.billingAccount, '<PRIVATE_BILLING_ACCOUNT>');
  assert.equal(proposed.resourceCreationWindowDuration, '2 hours');
  assert.equal(proposed.smokeAndRollbackWindowDuration, '2 hours');
  assert.equal(proposed.resourceCreationWindow, '<UNRESOLVED>');
  assert.equal(proposed.smokeAndRollbackWindow, '<UNRESOLVED>');
  assert.equal(proposed.dependencyOrder.length, 12);
  assert.doesNotMatch(JSON.stringify(proposed), /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|billingAccounts\/[0-9A-Z]{6}-/);
});

test('approval windows require timezone bounds and reject expiration', () => {
  const now = Date.parse('2030-01-01T11:00:00Z');
  assert.deepEqual(contract.validateWindow({ startAt: '2030-01-01T12:00:00Z', expiresAt: '2030-01-01T16:00:00Z' }, now, 4), []);
  assert.ok(contract.validateWindow({ startAt: '2030-01-01T12:00:00', expiresAt: '2030-01-01T13:00:00' }, now, 4).includes('format_invalid'));
  assert.ok(contract.validateWindow({ startAt: '2029-01-01T12:00:00Z', expiresAt: '2029-01-01T13:00:00Z' }, now, 4).includes('expired'));
  assert.ok(contract.validateWindow({ startAt: '2030-01-01T12:00:00Z', expiresAt: '2030-01-01T18:00:00Z' }, now, 4).includes('duration_exceeds_limit'));
});

test('dependency failures are aggregate-only and fail closed', () => {
  const value = contract.loadTemplate();
  value.inputs.STAGING_PROJECT_ID = 'sampleapp-staging-a1b2c3d4';
  const result = contract.validatePreflight(value);
  assert.ok(result.missingDependencies.includes('STAGING_PROJECT_ID:APP_SLUG'));
  assert.ok(result.missingDependencies.includes('STAGING_PROJECT_ID:RANDOM_SUFFIX'));
  assert.equal(result.status, 'preflight-incomplete');
});

test('completion never changes approvals and still requires operational approval', () => {
  const value = completeInputs();
  const result = contract.validatePreflight(value, { now: Date.parse('2030-01-01T11:00:00Z') });
  assert.equal(result.status, 'inputs-valid-approval-required');
  assert.equal(Object.values(result.approvalStates).every((status) => status === 'undecided'), true);
  assert.equal(Object.values(value.approvals).every((approval) => approval.approvalStatus === 'undecided'), true);
});

test('missing changed and unknown approval records fail closed', () => {
  const missing = completeInputs();
  delete missing.approvals.functionsDeployment;
  assert.ok(contract.validatePreflight(missing, { now: Date.parse('2030-01-01T11:00:00Z') }).approvalErrors.includes('approval_changed:functionsDeployment'));
  const changed = completeInputs();
  changed.approvals.resourceCreation.approvalStatus = 'approved';
  assert.ok(contract.validatePreflight(changed, { now: Date.parse('2030-01-01T11:00:00Z') }).approvalErrors.includes('approval_changed:resourceCreation'));
  const unknown = completeInputs();
  unknown.approvals.extraApproval = { approvalStatus: 'undecided', approvedBy: '', approvedAt: '' };
  assert.ok(contract.validatePreflight(unknown, { now: Date.parse('2030-01-01T11:00:00Z') }).approvalErrors.includes('approval_unknown:extraApproval'));
});

test('notification destinations expose configured booleans only', () => {
  const result = contract.redactedSummary(contract.validatePreflight(completeInputs(), { now: Date.parse('2030-01-01T11:00:00Z') }));
  assert.equal(result.configured.BILLING_ALERT_RECIPIENT, true);
  assert.equal(result.configured.BILLING_ESCALATION_TARGET, true);
  assert.doesNotMatch(JSON.stringify(result), /private-alert|private-escalation/);
});

test('teardown owner and acknowledgment are both required', () => {
  const value = completeInputs();
  value.inputs.TEARDOWN_OWNER_ACKNOWLEDGED = false;
  const result = contract.validatePreflight(value, { now: Date.parse('2030-01-01T11:00:00Z') });
  assert.ok(result.fields.TEARDOWN_OWNER_ACKNOWLEDGED.errors.includes('acknowledgment_required'));
  assert.equal(result.fields.TEARDOWN_OWNER_ACKNOWLEDGED.configured, false);
  assert.ok(result.missingDependencies.includes('TEARDOWN_OWNER:TEARDOWN_OWNER_ACKNOWLEDGED'));
  assert.equal(result.status, 'preflight-incomplete');
});

test('summary always reports zero operations reads and writes', () => {
  const summary = contract.redactedSummary(contract.validatePreflight(contract.loadTemplate()));
  assert.deepEqual([summary.cloudOperations, summary.stagingReads, summary.stagingWrites, summary.productionReads, summary.productionWrites], [0, 0, 0, 0, 0]);
});

test('flags gates hashes and private review state remain unchanged', () => {
  assert.equal(contract.SAFETY_STATE.shareVisibilityModelEnabled, false);
  assert.equal(contract.SAFETY_STATE.syncedTrainerPreferencesEnabled, false);
  assert.equal(contract.SAFETY_STATE.shareVisibilityServerWriteGate, false);
  assert.equal(contract.SAFETY_STATE.trainerPreferencesServerWriteGate, false);
  assert.deepEqual(contract.SAFETY_STATE.privateReview, { confirmedValidIdentity: 3, unreviewed: 49, seedEligibleTrueCount: 0 });
  assert.equal(contract.RULE_HASHES.rollback, 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf');
  assert.equal(contract.RULE_HASHES.additive, 'cbcea2a672e1f9b1d6a4582410bb89bca765ca307c0495c7cc80ea35f805071c');
});

test('candidate source has no network cloud Firebase shell or credential capability', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const source = ['functions/staging/stagingResourcePreflight.cjs', 'functions/scripts/staging-resource-preflight.cjs'].map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /firebase-admin|initializeApp|getDatabase|fetch\s*\(|https\.request|child_process|execFile|spawn\s*\(|gcloud|firebase\s+deploy/);
  assert.doesNotMatch(source, /GOOGLE_APPLICATION_CREDENTIALS|access[_-]?token|private[_-]?key/i);
});

test('tracked fixtures contain no real identifiers', () => {
  const text = fs.readFileSync(contract.TEMPLATE_PATH, 'utf8');
  assert.doesNotMatch(text, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(text, /billingAccounts\/[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}/);
  assert.doesNotMatch(text, /https?:\/\//);
});
