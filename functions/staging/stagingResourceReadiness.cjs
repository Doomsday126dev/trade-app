'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const preflight = require('./stagingResourcePreflight.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RULE_ARTIFACTS = Object.freeze({
  rollback: Object.freeze({
    path: 'tests/firebase/database.rules.narrow-read.json',
    sha256: preflight.RULE_HASHES.rollback
  }),
  additive: Object.freeze({
    path: 'tests/firebase/database.rules.share-visibility.json',
    sha256: preflight.RULE_HASHES.additive
  })
});
const PRIVATE_FIELDS = Object.freeze([
  'BILLING_ACCOUNT', 'BILLING_OPERATOR', 'BILLING_ALERT_RECIPIENT',
  'BILLING_ESCALATION_TARGET', 'RULES_OPERATOR_IDENTITY', 'HUMAN_OPERATOR',
  'TEARDOWN_OWNER'
]);
const WINDOW_FIELDS = Object.freeze(['RESOURCE_CREATION_WINDOW', 'SMOKE_AND_ROLLBACK_WINDOW']);
const PUBLIC_INPUTS = Object.freeze({
  APP_SLUG: 'trainer-hub',
  STAGING_WEB_APP_NAME: 'Trainer Hub Staging',
  RUNTIME_SERVICE_ACCOUNT: 'trainer-hub-runtime-stg',
  DEPLOYMENT_SERVICE_ACCOUNT: 'trainer-hub-deployer-stg',
  RESOURCE_LABELS: preflight.PROPOSED_STATE.resourceLabels
});
const PRICING_VERIFICATION = Object.freeze({
  verifiedAt: '2026-08-05',
  officialSources: Object.freeze([
    'Cloud Run pricing',
    'Cloud Run functions pricing',
    'Firebase Realtime Database billing',
    'reCAPTCHA billing information',
    'Cloud Build pricing',
    'Artifact Registry pricing',
    'Google Cloud Observability pricing',
    'Virtual Private Cloud pricing',
    'Cloud Billing budgets and alerts'
  ]),
  materialAssumptionChanged: false,
  budgetStillReasonable: true,
  manualThresholdStillReasonable: true,
  notes: Object.freeze([
    'low-volume callable usage remains within applicable usage allowances under the guarded model',
    'reCAPTCHA Premium remains free through 10000 monthly assessments then charges an 8 USD flat tier through 100000',
    'build and retained artifact costs remain the likeliest first small staging charges',
    'budgets and alerts remain advisory rather than hard caps'
  ])
});
const AVAILABILITY = Object.freeze({
  mode: 'check-only',
  status: 'unresolved_until_approved_creation_attempt',
  reason: 'no_reliable_noncreating_global_project_id_availability_api',
  cloudOperations: 0
});
const INVENTORY_ONLY_PLAN = Object.freeze({
  windowDuration: '2 hours',
  allowed: Object.freeze([
    'create_one_isolated_staging_project',
    'attach_approved_private_billing_account',
    'apply_approved_staging_labels',
    'create_rtdb_in_us-central1',
    'register_one_staging_web_app',
    'create_runtime_and_deployment_service_accounts',
    'assign_only_separately_approved_iam_roles',
    'create_usd_10_budget_and_approved_alerts',
    'prepare_ignored_local_staging_config',
    'verify_inventory_and_stop'
  ]),
  excluded: Object.freeze([
    'rules_deployment', 'functions_deployment', 'app_check_registration',
    'fixture_creation', 'write_gate_activation', 'canary_execution',
    'client_wiring', 'cohort_selection', 'preference_migration',
    'approved_viewer_grants', 'production_actions'
  ]),
  stopConditions: Object.freeze([
    'target_or_identity_mismatch', 'billing_scope_mismatch',
    'unexpected_resource_or_permission', 'hash_or_preflight_failure',
    'window_not_started_or_expired', 'partial_inventory_not_explainable'
  ]),
  partialCreationResponse: 'stop_record_inventory_remove_only_verified_partial_resources_or_delete_isolated_staging_project_after_separate_confirmation',
  operatorAcknowledgmentRequired: true
});
const ZERO_OPERATIONS = Object.freeze({
  cloudOperations: 0,
  stagingReads: 0,
  stagingWrites: 0,
  productionReads: 0,
  productionWrites: 0
});

function generateRandomSuffix(randomBytes = crypto.randomBytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  while (value.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte >= 252) continue;
      value += alphabet[byte % alphabet.length];
      if (value.length === 8) break;
    }
  }
  return value;
}

function composeProjectId(suffix) {
  if (!/^[a-z0-9]{8}$/.test(suffix || '')) throw Object.assign(new Error('Invalid suffix'), { code: 'readiness/suffix_invalid' });
  return `trainer-hub-staging-${suffix}`;
}

function securePrivatePath() {
  const input = preflight.resolvePrivateInputPath();
  const parent = path.dirname(input);
  const parentStat = fs.lstatSync(parent);
  const fileStat = fs.lstatSync(input);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0) throw Object.assign(new Error('Private directory must be mode 0700'), { code: 'readiness/insecure_directory' });
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o077) !== 0) throw Object.assign(new Error('Private file must be mode 0600'), { code: 'readiness/insecure_file' });
  return input;
}

function writePrivateDocument(document) {
  const input = securePrivatePath();
  const temp = `${input}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, input);
  fs.chmodSync(input, 0o600);
}

function updateDocument(mutator) {
  const document = preflight.readPrivateInputs(securePrivatePath());
  const next = structuredClone(document);
  mutator(next);
  writePrivateDocument(next);
  return next;
}

function applyPublicInputs() {
  updateDocument((document) => Object.assign(document.inputs, PUBLIC_INPUTS));
  return Object.freeze({ publicInputsConfigured: true, ...ZERO_OPERATIONS });
}

function configureGeneratedSuffix(randomBytes) {
  const suffix = generateRandomSuffix(randomBytes);
  updateDocument((document) => { document.inputs.RANDOM_SUFFIX = suffix; });
  return Object.freeze({ randomSuffixConfigured: true, ...ZERO_OPERATIONS });
}

function configureProjectId() {
  updateDocument((document) => {
    const candidate = composeProjectId(document.inputs.RANDOM_SUFFIX);
    const errors = preflight.validateProjectId(candidate, document.inputs);
    if (errors.length) throw Object.assign(new Error('Project ID rejected'), { code: 'readiness/project_id_rejected' });
    document.inputs.STAGING_PROJECT_ID = candidate;
  });
  return Object.freeze({ projectIdConfigured: true, projectIdFormatValid: true, productionSimilarityRejected: false, ...ZERO_OPERATIONS });
}

function configurePrivateField(field, value) {
  if (!PRIVATE_FIELDS.includes(field)) throw Object.assign(new Error('Field is not interactively configurable'), { code: 'readiness/field_forbidden' });
  if (typeof value !== 'string' || !value.trim() || preflight.isPlaceholder(value)) throw Object.assign(new Error('Value is invalid'), { code: 'readiness/value_invalid' });
  updateDocument((document) => {
    document.inputs[field] = value.trim();
    const validation = preflight.validatePreflight(document);
    if (validation.fields[field].errors.length) throw Object.assign(new Error('Value is invalid'), { code: 'readiness/value_invalid' });
  });
  return Object.freeze({ field, configured: true, ...ZERO_OPERATIONS });
}

function configureWindow(field, startAt, now = Date.now()) {
  if (!WINDOW_FIELDS.includes(field)) throw Object.assign(new Error('Window field is invalid'), { code: 'readiness/window_field_invalid' });
  const start = Date.parse(startAt);
  if (!Number.isFinite(start) || start <= now) throw Object.assign(new Error('Window must start in the future'), { code: 'readiness/window_start_invalid' });
  const value = { startAt: new Date(start).toISOString(), expiresAt: new Date(start + 2 * 60 * 60 * 1000).toISOString() };
  if (preflight.validateWindow(value, now, 2).length) throw Object.assign(new Error('Window rejected'), { code: 'readiness/window_invalid' });
  updateDocument((document) => { document.inputs[field] = value; });
  return Object.freeze({ field, configured: true, durationHours: 2, ...ZERO_OPERATIONS });
}

function sha256File(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, relativePath))).digest('hex');
}

function verifyRuleHashes() {
  const rollbackValid = sha256File(RULE_ARTIFACTS.rollback.path) === RULE_ARTIFACTS.rollback.sha256;
  const additiveValid = sha256File(RULE_ARTIFACTS.additive.path) === RULE_ARTIFACTS.additive.sha256;
  if (!rollbackValid || !additiveValid) throw Object.assign(new Error('Reviewed rules hash mismatch'), { code: 'readiness/rules_hash_mismatch' });
  return Object.freeze({ rollbackValid, additiveValid, ...ZERO_OPERATIONS });
}

function availabilityStatus() {
  const document = preflight.readPrivateInputs(securePrivatePath());
  const candidate = document.inputs.STAGING_PROJECT_ID;
  if (!candidate || preflight.validateProjectId(candidate, document.inputs).length) throw Object.assign(new Error('Project candidate is invalid'), { code: 'readiness/project_id_rejected' });
  return Object.freeze({ ...AVAILABILITY, candidateConfigured: true, productionSimilarityRejected: false, ...ZERO_OPERATIONS });
}

function readinessSummary(now = Date.now()) {
  const document = preflight.readPrivateInputs(securePrivatePath());
  const validation = preflight.validatePreflight(document, { now });
  verifyRuleHashes();
  const configuredFieldCount = validation.completedFieldCount;
  const missingFieldCount = validation.fieldCount - configuredFieldCount;
  const resourceCreationReady = validation.status === 'inputs-valid-approval-required';
  return Object.freeze({
    configuredFieldCount,
    missingFieldCount,
    invalidFieldCount: validation.invalidFieldCount,
    unresolvedPlaceholderCount: validation.unresolvedPlaceholderCount,
    missingDependencyCount: validation.missingDependencies.length,
    approvalStates: validation.approvalStates,
    resourceCreationReady,
    availabilityStatus: AVAILABILITY.status,
    pricingVerifiedAt: PRICING_VERIFICATION.verifiedAt,
    rulesHashesValid: true,
    status: resourceCreationReady ? 'readiness-inputs-complete-approval-required' : 'readiness-incomplete',
    ...ZERO_OPERATIONS
  });
}

module.exports = Object.freeze({
  RULE_ARTIFACTS, PRIVATE_FIELDS, WINDOW_FIELDS, PUBLIC_INPUTS,
  PRICING_VERIFICATION, AVAILABILITY, INVENTORY_ONLY_PLAN, ZERO_OPERATIONS,
  generateRandomSuffix, composeProjectId, securePrivatePath, writePrivateDocument,
  updateDocument, applyPublicInputs, configureGeneratedSuffix, configureProjectId,
  configurePrivateField, configureWindow, sha256File, verifyRuleHashes,
  availabilityStatus, readinessSummary
});
