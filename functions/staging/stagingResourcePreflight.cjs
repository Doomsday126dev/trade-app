'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRIVATE_INPUT_PATH = path.join(REPO_ROOT, 'functions/.local/staging-resource-inputs.json');
const TEMPLATE_PATH = path.join(__dirname, 'staging-resource-inputs.example.json');
const PRODUCTION_PROJECT_ID = ['trade', 'list', 'a4297'].join('-');
const APPROVAL_STATUS = 'undecided';
const RULE_HASHES = Object.freeze({
  rollback: 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf',
  additive: 'fc781919003a5afcba4fcf1e5235498090352deb1448e746b6c69ec61add6ac3'
});

const FIELD_ORDER = Object.freeze([
  'APP_SLUG', 'RANDOM_SUFFIX', 'STAGING_PROJECT_ID', 'BILLING_ACCOUNT',
  'BILLING_OPERATOR', 'STAGING_WEB_APP_NAME', 'RUNTIME_SERVICE_ACCOUNT',
  'DEPLOYMENT_SERVICE_ACCOUNT', 'RULES_OPERATOR_IDENTITY', 'HUMAN_OPERATOR',
  'BILLING_ALERT_RECIPIENT', 'BILLING_ESCALATION_TARGET', 'RESOURCE_LABELS',
  'RESOURCE_CREATION_WINDOW', 'SMOKE_AND_ROLLBACK_WINDOW', 'TEARDOWN_OWNER',
  'TEARDOWN_OWNER_ACKNOWLEDGED'
]);

const APPROVAL_KEYS = Object.freeze([
  'resourceCreation', 'additiveRulesDeployment', 'functionsDeployment',
  'appCheckRegistration', 'syntheticFixtureCreation',
  'shareVisibilityWriteGate', 'trainerPreferencesWriteGate',
  'syntheticCanary', 'appCheckEnforcement', 'stagingClientWiring',
  'productionAction'
]);

const FIELD_SCHEMA = Object.freeze({
  APP_SLUG: Object.freeze({ format: 'lowercase ASCII slug, 3..15 chars', privacy: 'public_configuration', storage: 'tracked placeholder; real value private local input', loggable: false, committable: false, dependencies: [], useApproval: 'staging_resource_creation' }),
  RANDOM_SUFFIX: Object.freeze({ format: '8 lowercase ASCII letters or digits from a CSPRNG', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['APP_SLUG', 'resource_creation_explicitly_approved'], useApproval: 'staging_resource_creation' }),
  STAGING_PROJECT_ID: Object.freeze({ format: '<APP_SLUG>-staging-<RANDOM_SUFFIX>, 6..30 chars', privacy: 'public_configuration_after_creation', storage: 'private local input before creation', loggable: false, committable: false, dependencies: ['APP_SLUG', 'RANDOM_SUFFIX'], useApproval: 'staging_resource_creation' }),
  BILLING_ACCOUNT: Object.freeze({ format: 'billingAccounts/NNNNNN-NNNNNN-NNNNNN', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['BILLING_OPERATOR'], useApproval: 'billing_attachment' }),
  BILLING_OPERATOR: Object.freeze({ format: 'non-placeholder private operator identity', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: [], useApproval: 'billing_attachment' }),
  STAGING_WEB_APP_NAME: Object.freeze({ format: '4..40 printable chars containing Staging', privacy: 'semi_public_configuration', storage: 'private local input before registration', loggable: false, committable: false, dependencies: ['STAGING_PROJECT_ID'], useApproval: 'web_app_registration' }),
  RUNTIME_SERVICE_ACCOUNT: Object.freeze({ format: '6..30 lowercase letters, digits, hyphens; runtime-stg suffix', privacy: 'public_configuration_after_creation', storage: 'private local input before creation', loggable: false, committable: false, dependencies: ['APP_SLUG', 'STAGING_PROJECT_ID'], useApproval: 'runtime_service_account_creation' }),
  DEPLOYMENT_SERVICE_ACCOUNT: Object.freeze({ format: '6..30 lowercase letters, digits, hyphens; deployer-stg suffix', privacy: 'public_configuration_after_creation', storage: 'private local input before creation', loggable: false, committable: false, dependencies: ['APP_SLUG', 'STAGING_PROJECT_ID'], useApproval: 'deployment_service_account_creation' }),
  RULES_OPERATOR_IDENTITY: Object.freeze({ format: 'non-placeholder private identity', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['RESOURCE_CREATION_WINDOW'], useApproval: 'rules_operator_access' }),
  HUMAN_OPERATOR: Object.freeze({ format: 'non-placeholder private identity', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['RESOURCE_CREATION_WINDOW'], useApproval: 'staging_resource_creation' }),
  BILLING_ALERT_RECIPIENT: Object.freeze({ format: 'non-placeholder private notification destination', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['BILLING_ACCOUNT'], useApproval: 'budget_and_alert_creation' }),
  BILLING_ESCALATION_TARGET: Object.freeze({ format: 'non-placeholder private notification destination', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['BILLING_ACCOUNT'], useApproval: 'budget_and_alert_creation' }),
  RESOURCE_LABELS: Object.freeze({ format: 'Google Cloud label key/value map', privacy: 'public_configuration', storage: 'tracked defaults or private local input', loggable: true, committable: true, dependencies: ['STAGING_PROJECT_ID'], useApproval: 'staging_resource_creation' }),
  RESOURCE_CREATION_WINDOW: Object.freeze({ format: 'bounded ISO-8601 startAt/expiresAt with timezone', privacy: 'approval_metadata', storage: 'private local input only', loggable: false, committable: false, dependencies: ['HUMAN_OPERATOR'], useApproval: 'staging_resource_creation' }),
  SMOKE_AND_ROLLBACK_WINDOW: Object.freeze({ format: 'bounded ISO-8601 startAt/expiresAt with timezone', privacy: 'approval_metadata', storage: 'private local input only', loggable: false, committable: false, dependencies: ['RESOURCE_CREATION_WINDOW'], useApproval: 'deployment_and_smoke' }),
  TEARDOWN_OWNER: Object.freeze({ format: 'non-placeholder private named responsibility', privacy: 'private_identifier', storage: 'private local input only', loggable: false, committable: false, dependencies: ['TEARDOWN_OWNER_ACKNOWLEDGED'], useApproval: 'staging_resource_creation' }),
  TEARDOWN_OWNER_ACKNOWLEDGED: Object.freeze({ format: 'boolean true', privacy: 'approval_metadata', storage: 'private local input only', loggable: true, committable: false, dependencies: ['TEARDOWN_OWNER'], useApproval: 'staging_resource_creation' })
});

const PROPOSED_STATE = Object.freeze({
  appSlug: 'trainer-hub',
  randomSuffix: '<unresolved>',
  stagingProjectId: 'trainer-hub-staging-<RANDOM_SUFFIX>',
  stagingWebAppName: 'Trainer Hub Staging',
  runtimeServiceAccount: 'trainer-hub-runtime-stg',
  deploymentServiceAccount: 'trainer-hub-deployer-stg',
  resourceLabels: Object.freeze({
    environment: 'staging',
    data_classification: 'synthetic',
    managed_by: 'manual-reviewed',
    lifecycle: 'temporary',
    application: 'trainer-hub'
  }),
  rtdbLocation: 'us-central1',
  functionsRegion: 'us-central1',
  appCheckProvider: 'recaptcha-enterprise',
  budgetAmount: 'USD 10/month',
  manualInvestigationThreshold: 'USD 3-5/month',
  actualAlertUsd: Object.freeze([1, 2.5, 3, 5, 7.5, 9, 10]),
  forecastAlertPercent: Object.freeze([50, 75, 100]),
  privateRoleRelationship: Object.freeze({
    relationship: 'same_private_person_initially_holds_all_six_responsibilities',
    roles: Object.freeze([
      'BILLING_OPERATOR', 'RULES_OPERATOR_IDENTITY', 'HUMAN_OPERATOR',
      'BILLING_ALERT_RECIPIENT', 'BILLING_ESCALATION_TARGET', 'TEARDOWN_OWNER'
    ]),
    independentTwoPersonReview: false,
    concreteIdentitiesResolved: false
  }),
  billingAccount: '<PRIVATE_BILLING_ACCOUNT>',
  resourceCreationWindowDuration: '2 hours',
  smokeAndRollbackWindowDuration: '2 hours',
  resourceCreationWindow: '<UNRESOLVED>',
  smokeAndRollbackWindow: '<UNRESOLVED>',
  dependencyOrder: Object.freeze([
    'complete_and_locally_validate_private_preflight_fields',
    'reverify_current_official_pricing',
    'record_explicit_resource_creation_approval_and_two_hour_window',
    'attach_private_billing_account_and_establish_budget_alerts',
    'create_only_approved_empty_staging_resources',
    'verify_complete_resource_inventory_and_stop',
    'close_resource_creation_window_and_remove_temporary_access',
    'obtain_separate_additive_rules_approval',
    'obtain_separate_functions_deployment_approval',
    'obtain_separate_app_check_fixture_gate_canary_and_client_wiring_approvals',
    'open_distinct_two_hour_smoke_and_rollback_window_per_deployment',
    'revoke_temporary_operator_permissions_when_window_closes'
  ]),
  fixtureLedger: 'stagingFixtureRuns/{fixtureRunId}',
  fixtureStrategy: 'actual_candidate_roots_with_synthetic_only_identities',
  rulesHashes: RULE_HASHES
});

const SAFETY_STATE = Object.freeze({
  operationCapability: 'local_placeholder_file_only',
  cloudOperations: 0,
  stagingReads: 0,
  stagingWrites: 0,
  productionReads: 0,
  productionWrites: 0,
  shareVisibilityModelEnabled: false,
  syncedTrainerPreferencesEnabled: false,
  shareVisibilityServerWriteGate: false,
  trainerPreferencesServerWriteGate: false,
  privateReview: Object.freeze({ confirmedValidIdentity: 3, unreviewed: 49, seedEligibleTrueCount: 0 })
});

function isPlaceholder(value) {
  return typeof value === 'string' && /^<[^>]+>$/.test(value);
}

function normalizeProjectId(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function productionSimilarityRejected(projectId) {
  const candidate = normalizeProjectId(projectId);
  const production = normalizeProjectId(PRODUCTION_PROJECT_ID);
  return candidate === production || candidate.includes(production) || levenshtein(candidate, production) <= 2;
}

function validateAppSlug(value) {
  const errors = [];
  if (!/^[a-z](?:[a-z0-9]|-(?!-)){1,13}[a-z0-9]$/.test(value || '')) errors.push('format_invalid');
  if (/(?:^|-)(?:prod|production|live)(?:-|$)/.test(value || '')) errors.push('production_ambiguity');
  return errors;
}

function validateRandomSuffix(value) {
  return /^[a-z0-9]{8}$/.test(value || '') ? [] : ['format_invalid'];
}

function validateProjectId(value, inputs) {
  const errors = [];
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value || '')) errors.push('format_invalid');
  if (!String(value || '').includes('-staging-')) errors.push('staging_marker_required');
  if (/(?:^|-)(?:prod|production|live)(?:-|$)/.test(value || '')) errors.push('production_marker_forbidden');
  if (productionSimilarityRejected(value)) errors.push('production_similarity_rejected');
  if (!isPlaceholder(inputs.APP_SLUG) && !isPlaceholder(inputs.RANDOM_SUFFIX) && value !== `${inputs.APP_SLUG}-staging-${inputs.RANDOM_SUFFIX}`) errors.push('composition_mismatch');
  return errors;
}

function validateServiceAccount(value, role) {
  const errors = [];
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value || '')) errors.push('format_invalid');
  if (role === 'runtime' && !String(value || '').endsWith('-runtime-stg')) errors.push('runtime_marker_required');
  if (role === 'deployer' && !String(value || '').endsWith('-deployer-stg')) errors.push('deployer_marker_required');
  if (/(?:^|-)(?:prod|production|live)(?:-|$)/.test(value || '')) errors.push('production_ambiguity');
  return errors;
}

function validateLabels(value) {
  const errors = [];
  const mandatory = { environment: 'staging', data_classification: 'synthetic', managed_by: 'manual-reviewed', lifecycle: 'temporary', application: 'trainer-hub' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['format_invalid'];
  for (const [key, expected] of Object.entries(mandatory)) if (value[key] !== expected) errors.push(`mandatory_label_invalid:${key}`);
  for (const [key, label] of Object.entries(value)) {
    if (!/^[a-z](?:[-_a-z0-9]{0,61}[a-z0-9])?$/.test(key)) errors.push(`label_key_invalid:${key}`);
    if (!/^(?:[a-z](?:[-_a-z0-9]{0,61}[a-z0-9])?)?$/.test(label)) errors.push(`label_value_invalid:${key}`);
  }
  return errors;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function validateWindow(value, now = Date.now(), maximumHours = 24) {
  if (!value || typeof value !== 'object') return ['format_invalid'];
  const start = parseTimestamp(value.startAt);
  const end = parseTimestamp(value.expiresAt);
  const errors = [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ['format_invalid'];
  if (end <= start) errors.push('order_invalid');
  if (end - start > maximumHours * 60 * 60 * 1000) errors.push('duration_exceeds_limit');
  if (end <= now) errors.push('expired');
  return errors;
}

function present(value) {
  if (isPlaceholder(value) || value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).every((item) => present(item));
  return true;
}

function validateField(name, value, inputs, now) {
  if (name === 'TEARDOWN_OWNER_ACKNOWLEDGED') return value === true ? [] : ['acknowledgment_required'];
  if (!present(value)) return [];
  switch (name) {
    case 'APP_SLUG': return validateAppSlug(value);
    case 'RANDOM_SUFFIX': return validateRandomSuffix(value);
    case 'STAGING_PROJECT_ID': return validateProjectId(value, inputs);
    case 'BILLING_ACCOUNT': return /^billingAccounts\/[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/.test(value) ? [] : ['format_invalid'];
    case 'STAGING_WEB_APP_NAME': return typeof value === 'string' && value.length >= 4 && value.length <= 40 && /staging/i.test(value) && !/https?:\/\//i.test(value) ? [] : ['format_invalid'];
    case 'RUNTIME_SERVICE_ACCOUNT': return validateServiceAccount(value, 'runtime');
    case 'DEPLOYMENT_SERVICE_ACCOUNT': return validateServiceAccount(value, 'deployer');
    case 'RESOURCE_LABELS': return validateLabels(value);
    case 'RESOURCE_CREATION_WINDOW': return validateWindow(value, now, 4);
    case 'SMOKE_AND_ROLLBACK_WINDOW': return validateWindow(value, now, 24);
    default: return typeof value === 'string' && value.trim().length > 0 ? [] : ['format_invalid'];
  }
}

function approvalErrors(approvals) {
  const errors = [];
  for (const name of APPROVAL_KEYS) {
    const approval = approvals?.[name];
    if (approval?.approvalStatus !== APPROVAL_STATUS) errors.push(`approval_changed:${name}`);
    if (approval?.approvedBy !== '' || approval?.approvedAt !== '') errors.push(`approval_metadata_present:${name}`);
  }
  for (const name of Object.keys(approvals || {})) if (!APPROVAL_KEYS.includes(name)) errors.push(`approval_unknown:${name}`);
  return errors;
}

function validatePreflight(document, options = {}) {
  const now = options.now ?? Date.now();
  const inputs = document?.inputs || {};
  const fields = {};
  const missingDependencies = [];
  for (const name of FIELD_ORDER) {
    const complete = name === 'TEARDOWN_OWNER_ACKNOWLEDGED' ? inputs[name] === true : present(inputs[name]);
    const errors = validateField(name, inputs[name], inputs, now);
    fields[name] = Object.freeze({ configured: complete, valid: complete && errors.length === 0, errors: Object.freeze(errors) });
    if (complete) for (const dependency of FIELD_SCHEMA[name].dependencies) {
      if (dependency === 'resource_creation_explicitly_approved') continue;
      if (!present(inputs[dependency])) missingDependencies.push(`${name}:${dependency}`);
    }
  }
  const approvals = approvalErrors(document?.approvals);
  const completedFieldCount = Object.values(fields).filter((field) => field.configured).length;
  const invalidFieldCount = Object.values(fields).filter((field) => field.configured && !field.valid).length;
  const unresolvedPlaceholderCount = FIELD_ORDER.length - completedFieldCount;
  const ready = invalidFieldCount === 0 && unresolvedPlaceholderCount === 0 && missingDependencies.length === 0 && approvals.length === 0;
  return Object.freeze({
    fields: Object.freeze(fields),
    completedFieldCount,
    fieldCount: FIELD_ORDER.length,
    invalidFieldCount,
    unresolvedPlaceholderCount,
    missingDependencies: Object.freeze([...new Set(missingDependencies)].sort()),
    approvalErrors: Object.freeze(approvals),
    approvalStates: Object.freeze(Object.fromEntries(APPROVAL_KEYS.map((key) => [key, document?.approvals?.[key]?.approvalStatus || 'missing']))),
    status: ready ? 'inputs-valid-approval-required' : 'preflight-incomplete',
    ...SAFETY_STATE
  });
}

function redactedSummary(validation) {
  return Object.freeze({
    fieldCompletion: `${validation.completedFieldCount}/${validation.fieldCount}`,
    configuredFieldCount: validation.completedFieldCount,
    missingFieldCount: validation.fieldCount - validation.completedFieldCount,
    invalidFieldCount: validation.invalidFieldCount,
    missingDependencyCount: validation.missingDependencies.length,
    unresolvedPlaceholderCount: validation.unresolvedPlaceholderCount,
    configured: Object.freeze(Object.fromEntries(Object.entries(validation.fields).map(([key, value]) => [key, value.configured]))),
    approvalStates: validation.approvalStates,
    resourceCreationReady: validation.status === 'inputs-valid-approval-required',
    status: validation.status,
    cloudOperations: 0,
    stagingReads: 0,
    stagingWrites: 0,
    productionReads: 0,
    productionWrites: 0
  });
}

function loadTemplate() {
  return JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
}

function resolvePrivateInputPath(candidate = PRIVATE_INPUT_PATH) {
  const resolved = path.resolve(candidate);
  if (resolved !== PRIVATE_INPUT_PATH) throw Object.assign(new Error('Private staging inputs must use the fixed ignored path'), { code: 'preflight/path_forbidden' });
  return resolved;
}

function createTemplate(candidate = PRIVATE_INPUT_PATH) {
  const output = resolvePrivateInputPath(candidate);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(output), 0o700);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(output, flags, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(loadTemplate(), null, 2)}\n`); } finally { fs.closeSync(fd); }
  fs.chmodSync(output, 0o600);
  return output;
}

function readPrivateInputs(candidate = PRIVATE_INPUT_PATH) {
  const input = resolvePrivateInputPath(candidate);
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Object.assign(new Error('Private staging inputs must be a regular mode-0600 file'), { code: 'preflight/insecure_input' });
  return JSON.parse(fs.readFileSync(input, 'utf8'));
}

module.exports = Object.freeze({
  PRIVATE_INPUT_PATH, TEMPLATE_PATH, APPROVAL_STATUS, RULE_HASHES, FIELD_ORDER, APPROVAL_KEYS,
  FIELD_SCHEMA, PROPOSED_STATE, SAFETY_STATE, isPlaceholder, normalizeProjectId,
  productionSimilarityRejected, validateAppSlug, validateRandomSuffix,
  validateProjectId, validateServiceAccount, validateLabels, validateWindow,
  validatePreflight, redactedSummary, loadTemplate, resolvePrivateInputPath,
  createTemplate, readPrivateInputs
});
