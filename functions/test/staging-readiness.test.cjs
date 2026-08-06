'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../staging/readinessContract.cjs');
const { FIXTURE_EPOCH, SYNTHETIC_UIDS, generateSyntheticFixtures } = require('../staging/syntheticFixtures.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const docs = fs.readFileSync(path.join(repoRoot, 'docs/TRUSTED-FUNCTIONS-STAGING-READINESS.md'), 'utf8');

test('runtime is Gen 2 Node 22 with conservative bounded resources and no warm instances', () => {
  assert.equal(contract.RUNTIME.generation, 2);
  assert.equal(contract.RUNTIME.runtime, 'nodejs22');
  assert.equal(contract.RUNTIME.memoryMiB, 256);
  assert.equal(contract.RUNTIME.timeoutSeconds, 30);
  assert.equal(contract.RUNTIME.minInstances, 0);
  assert.equal(contract.RUNTIME.maxInstances, 5);
  assert.equal(contract.RUNTIME.concurrency, 10);
});

test('region stays placeholder-gated and recommends US RTDB colocation', () => {
  assert.equal(contract.RUNTIME.candidateRegion, 'us-east1');
  assert.equal(contract.RUNTIME.recommendedRegion, 'us-central1');
  assert.equal(contract.RUNTIME.deploymentRegion, '<REGION>');
  assert.match(contract.RUNTIME.regionDecision, /blocked/);
  assert.match(docs, /Realtime Database.*before choosing a Functions region/s);
});

test('runtime deployment rules and human identities remain separate', () => {
  assert.equal(contract.IAM.runtimeMayDeploy, false);
  assert.equal(contract.IAM.runtime.includes('roles/firebasedatabase.admin'), true);
  assert.equal(contract.IAM.runtime.includes('roles/firebaseappcheck.tokenVerifier'), true);
  assert.equal(contract.IAM.deployment.includes('roles/iam.serviceAccountUser'), true);
  assert.equal(contract.IAM.deployment.some((role) => /owner|editor$/i.test(role)), false);
  assert.match(contract.IAM.limitation, /not data-path-granular/);
});

test('every callable maps to fixed read and write roots', () => {
  assert.deepEqual(Object.keys(contract.PATH_MATRIX).sort(), [...contract.CALLABLES].sort());
  for (const mapping of Object.values(contract.PATH_MATRIX)) {
    assert.ok(mapping.reads.length > 0);
    assert.ok(mapping.writes.length > 0);
    assert.equal([...mapping.reads, ...mapping.writes].some((value) => /\*\*|\{path\}|arbitrary/i.test(value)), false);
  }
});

test('rules and gate order keeps both capabilities disabled between canary groups', () => {
  assert.deepEqual(contract.GATE_SEQUENCE, [
    'deploy_additive_rules_gates_false', 'deploy_functions_gates_false',
    'verify_all_disabled_before_idempotency', 'enable_share_visibility_staging_only',
    'canary_handle_and_approved_viewer', 'disable_share_visibility',
    'enable_trainer_preferences_staging_only', 'canary_tags_and_history',
    'disable_trainer_preferences', 'review_evidence_before_simultaneous_enablement'
  ]);
  assert.match(docs, /No\s+callable can change its gate/);
});

test('App Check plan uses staging reCAPTCHA Enterprise and bounded debug tokens', () => {
  assert.match(docs, /reCAPTCHA Enterprise/);
  assert.match(docs, /Debug tokens are limited/);
  assert.match(docs, /valid, missing, invalid, and consumed tokens/);
  assert.match(docs, /App Check supplements Auth/);
});

test('synthetic fixtures are deterministic, fake, gated off, and independently destructible', () => {
  const first = generateSyntheticFixtures();
  const second = generateSyntheticFixtures();
  assert.deepEqual(first, second);
  assert.equal(FIXTURE_EPOCH, 1700000000000);
  assert.equal(Object.values(SYNTHETIC_UIDS).every((uid) => uid.startsWith('syn_')), true);
  assert.equal(first.authUsers.every((user) => user.email.endsWith('@example.invalid')), true);
  assert.equal(first.rtdb.shareVisibilityConfig.writesEnabled, false);
  assert.equal(first.rtdb.trainerPreferencesConfig.writesEnabled, false);
  assert.equal(new Set(first.resetRoots).size, first.resetRoots.length);
});

test('fixture covers ordinary admin unregistered visibility collision history and replay states', () => {
  const fixture = generateSyntheticFixtures();
  assert.equal(fixture.authUsers.length, 4);
  assert.equal(Object.keys(fixture.rtdb.accounts).length, 3);
  assert.equal(Object.keys(fixture.rtdb.admins).length, 1);
  assert.deepEqual(Object.values(fixture.rtdb.shareVisibility).map((item) => item.mode).sort(), ['approved_viewers', 'private', 'public']);
  assert.ok(fixture.rtdb.shareDirectory.collisioncandidate);
  assert.ok(fixture.rtdb.userPreferences[SYNTHETIC_UIDS.viewer].trainerTagLabels.synthetic_group);
  assert.equal(fixture.rtdb.userPreferences[SYNTHETIC_UIDS.viewer].trainerTags.tag_existing.revision, 1);
  assert.equal(fixture.rtdb.userPreferences[SYNTHETIC_UIDS.viewer].trainerTags.tag_existing.deleted, false);
  assert.equal(Object.keys(fixture.rtdb.userPreferences[SYNTHETIC_UIDS.viewer].trainerHistory).length, 2);
  assert.equal(fixture.rtdb.userPreferences[SYNTHETIC_UIDS.viewer].trainerHistory[SYNTHETIC_UIDS.owner].revision, 1);
  assert.equal(fixture.rtdb.trustedOperationRequests[SYNTHETIC_UIDS.owner].reserveTrainerHandle.synthetic_replay_0001.status, 'complete');
});

test('all callable canary groups include disabled replay denial and mutation evidence', () => {
  for (const callable of contract.CALLABLES) {
    assert.ok(contract.CANARIES[callable].includes('gate_disabled'));
    assert.ok(contract.CANARIES[callable].some((value) => /replay/.test(value)));
  }
  assert.deepEqual(contract.CANARIES.evidence, ['expected_result', 'changed_roots', 'unchanged_roots', 'redacted_log', 'idempotency_status', 'teardown_status']);
});

test('per-UID operation limits have short and daily bounds without IP storage', () => {
  for (const operation of contract.CALLABLES) {
    const limit = contract.RATE_LIMITS[operation];
    assert.ok(limit.shortWindowSeconds <= 3600);
    assert.ok(limit.shortLimit > 0 && limit.dailyLimit >= limit.shortLimit);
  }
  assert.match(contract.RATE_LIMITS.keyShape, /\{callerUid\}.*\{operation\}/);
  assert.equal(contract.RATE_LIMITS.storesIpAddress, false);
  assert.equal(contract.RATE_LIMITS.implementationStatus, 'design_only');
});

test('retention recommendation never deletes pending records or scans unbounded collections', () => {
  assert.equal(contract.RETENTION.terminalDays, 7);
  assert.equal(contract.RETENTION.pendingDeletionAllowed, false);
  assert.equal(contract.RETENTION.maxBatch, 100);
  assert.equal(contract.RETENTION.fullCollectionScanAllowed, false);
  assert.equal(contract.RETENTION.schedulerImplemented, false);
});

test('cost model is deterministic and bounded for every requested MAU scenario', () => {
  for (const mau of [100, 1000, 10000]) {
    const normal = contract.workloadFor(mau, 'normal');
    const high = contract.workloadFor(mau, 'high');
    assert.ok(normal.invocations < high.invocations);
    assert.ok(normal.vCpuSeconds < high.vCpuSeconds);
    assert.equal(normal.appCheckAssessments, normal.invocations);
    assert.equal(high.structuredLogEvents, high.invocations * 2);
  }
  assert.deepEqual(contract.workloadFor(100, 'normal').byOperation, { reserveTrainerHandle: 5, claimTrainerTagLabel: 200, verifyTrainerHistory: 800, setApprovedViewer: 50 });
});

test('monitoring plan has identity-free tiny-traffic thresholds and kill switches', () => {
  assert.match(docs, /counts rather than percentages/);
  assert.match(docs, /unexpected root/);
  assert.match(docs, /p50\/p95/);
  assert.match(docs, /identifiers never enter labels/);
  assert.ok(contract.ROLLBACK.includes('set_both_server_gates_false'));
});

test('rollback covers gates client App Check Functions rules fixtures and diagnostics', () => {
  for (const required of ['set_both_server_gates_false', 'disable_future_client_invocation_paths', 'disable_staging_app_check_enforcement_if_false_rejections', 'stop_or_delete_staging_functions', 'restore_staging_narrow_read_rules_baseline_if_required', 'clear_only_synthetic_fixture_roots', 'retain_redacted_diagnostic_logs']) {
    assert.ok(contract.ROLLBACK.includes(required));
  }
});

test('approval list separates every staging mutation and leaves production out of scope', () => {
  for (const required of ['create_isolated_staging_project', 'assign_reviewed_iam_roles', 'deploy_additive_staging_rules', 'deploy_functions_to_staging', 'create_synthetic_fixtures', 'configure_retention_cleanup', 'create_billing_alerts']) {
    assert.ok(contract.APPROVALS.includes(required));
  }
  assert.equal(contract.APPROVALS.some((item) => /production/.test(item)), false);
});

test('deployment templates are placeholder-only and always project-qualified', () => {
  for (const command of Object.values(contract.COMMAND_TEMPLATES)) {
    assert.match(command, /<STAGING_PROJECT_ID>/);
    if (command.includes('firebase deploy')) assert.match(command, /--project <STAGING_PROJECT_ID>/);
  }
  assert.match(contract.COMMAND_TEMPLATES.deployFunctions, /<REGION>/);
  assert.match(contract.COMMAND_TEMPLATES.deployFunctions, /<RUNTIME_SERVICE_ACCOUNT>/);
});

test('candidate has no production identifier URL credential auto-deploy or live adapter', () => {
  const files = ['docs/TRUSTED-FUNCTIONS-STAGING-READINESS.md', 'functions/.env.staging.example', 'functions/staging/readinessContract.cjs', 'functions/staging/syntheticFixtures.cjs'];
  const text = files.map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')).join('\n');
  assert.doesNotMatch(text, /trade-list-[a-z0-9-]+/i);
  assert.doesNotMatch(text, /https:\/\/[^\s`]*(?:firebaseio|firebasedatabase)|BEGIN (?:RSA )?PRIVATE KEY|client_email|GOOGLE_APPLICATION_CREDENTIALS/i);
  assert.doesNotMatch(text, /firebase-admin|initializeApp|getDatabase|fetch\s*\(/);
  assert.equal(Object.keys(require(path.join(repoRoot, 'package.json')).scripts).some((name) => /deploy|publish/i.test(name)), false);
});

test('tracked staging environment example contains placeholders and disabled gates only', () => {
  const env = fs.readFileSync(path.join(repoRoot, 'functions/.env.staging.example'), 'utf8');
  assert.match(env, /^STAGING_PROJECT_ID=<STAGING_PROJECT_ID>$/m);
  assert.match(env, /^TRUSTED_FUNCTIONS_REGION=<REGION>$/m);
  assert.match(env, /^TRUSTED_FUNCTIONS_RUNTIME_SERVICE_ACCOUNT=<RUNTIME_SERVICE_ACCOUNT>$/m);
  assert.match(env, /^SHARE_VISIBILITY_WRITES_ENABLED=false$/m);
  assert.match(env, /^TRAINER_PREFERENCES_WRITES_ENABLED=false$/m);
});
