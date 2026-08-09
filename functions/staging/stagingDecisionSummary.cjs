'use strict';

const APPROVAL_STATUS = 'undecided';

const RULE_HASHES = Object.freeze({
  rollback: 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf',
  additive: 'ba0816f465b4830a726881fc6a00c3805283b8d4c77d80ed8daebc026719b45a'
});

const EXECUTION_APPROVAL_KEYS = Object.freeze([
  'staging_resource_creation',
  'additive_staging_rules_deployment',
  'functions_staging_deployment',
  'app_check_registration',
  'synthetic_fixture_creation',
  'share_visibility_write_gate_enablement',
  'trainer_preferences_write_gate_enablement',
  'synthetic_canary_execution',
  'app_check_enforcement',
  'staging_client_wiring',
  'production_action'
]);

const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  'exactTarget',
  'approvedResourcesOrMutations',
  'artifactHashes',
  'operator',
  'approvalWindowDuration',
  'preflight',
  'smoke',
  'stoppingCriteria',
  'rollback'
]);

const PROPOSED_CHOICES = Object.freeze({
  projectNamingPattern: '<APP_SLUG>-staging-<RANDOM_SUFFIX>',
  billingStrategy: 'future_production_billing_account_with_isolated_staging_project_labels_budget_and_alerts',
  rtdbLocation: 'us-central1',
  functionsRegion: 'us-central1',
  existingCallableRegionStatus: 'us-east1_unapproved_technical_debt_requires_separate_parameterization',
  stagingWebAppStrategy: 'dedicated_staging_firebase_web_app',
  initialLocalCanary: 'operator_only_under_strict_staging_isolation',
  appCheckProvider: 'recaptcha-enterprise',
  appCheckRollout: Object.freeze({
    mode: 'metrics_first',
    initialTokenTtl: 'provider_default',
    minimumSyntheticCalls: 100,
    minimumLegitimateAcceptanceRate: 0.99,
    maximumUnexplainedLegitimateRejections: 0,
    enforcementRequiresSeparateApproval: true
  }),
  runtimeIdentityStrategy: 'one_dedicated_staging_runtime_service_account_for_five_callables',
  deploymentIdentityStrategy: 'separate_deployment_service_account_with_short_lived_impersonation',
  rulesReviewStrategy: 'same_named_human_two_separately_recorded_procedural_steps_initially',
  iam: Object.freeze({
    runtime: Object.freeze([
      'roles/firebasedatabase.admin',
      'roles/firebaseappcheck.tokenVerifier',
      'roles/logging.logWriter'
    ]),
    deployment: Object.freeze([
      'roles/cloudfunctions.developer',
      'roles/serviceusage.serviceUsageConsumer'
    ]),
    operatorOnDeployment: Object.freeze(['roles/iam.serviceAccountTokenCreator']),
    operatorOnRuntime: Object.freeze(['roles/iam.serviceAccountUser']),
    rulesOperator: Object.freeze(['roles/firebasedatabase.admin']),
    reviewerMutationRoles: Object.freeze([]),
    rtdbAdminWarning: 'broad_instance_wide_not_path_level_least_privilege',
    temporaryRolesEndAfterRollbackWindow: true
  }),
  budget: Object.freeze({
    monthlyUsd: 10,
    manualInvestigationThresholdUsd: Object.freeze([3, 5]),
    advisoryNotHardCap: true
  }),
  billingAlerts: Object.freeze({
    actualUsd: Object.freeze([1, 2.5, 3, 5, 7.5, 9, 10]),
    forecastPercent: Object.freeze([50, 75, 100]),
    previewSpendCapsIncluded: false
  }),
  syntheticFixtures: Object.freeze({
    functionalRoots: Object.freeze([
      'accounts/{syntheticUid}',
      'shareVisibility/{syntheticUid}',
      'trainerShares/{syntheticUid}',
      'userPreferences/{syntheticUid}'
    ]),
    ownershipLedger: 'stagingFixtureRuns/{fixtureRunId}',
    wildcardTeardownAllowed: false,
    productionDerivedValuesAllowed: false
  }),
  rollbackRulesSha256: RULE_HASHES.rollback,
  additiveRulesSha256: RULE_HASHES.additive,
  resourceCreationBoundary: 'inventory_and_stop'
});

const UNRESOLVED_VALUES = Object.freeze({
  appSlug: '<APP_SLUG>',
  randomSuffix: '<RANDOM_SUFFIX>',
  stagingProjectId: '<STAGING_PROJECT_ID>',
  billingAccount: '<BILLING_ACCOUNT>',
  billingOperator: '<BILLING_OPERATOR>',
  stagingWebAppName: '<STAGING_WEB_APP_NAME>',
  runtimeServiceAccount: '<RUNTIME_SERVICE_ACCOUNT>',
  deploymentServiceAccount: '<DEPLOYMENT_SERVICE_ACCOUNT>',
  rulesOperatorIdentity: '<RULES_OPERATOR_IDENTITY>',
  humanOperator: '<HUMAN_OPERATOR>',
  billingAlertRecipient: '<PRIVATE_BILLING_CONTACT>',
  billingEscalationTarget: '<PRIVATE_ESCALATION_TARGET>',
  syntheticFixtureNamespace: '<SYNTHETIC_FIXTURE_NAMESPACE>',
  syntheticUidFormat: '<SYNTHETIC_UID_FORMAT>',
  syntheticNameFormat: '<SYNTHETIC_NAME_FORMAT>',
  syntheticEmailFormat: '<SYNTHETIC_EMAIL_FORMAT>',
  fixtureRunIdFormat: '<FIXTURE_RUN_ID_FORMAT>',
  fixtureCap: '<FIXTURE_CAP>',
  fixtureRetentionPeriod: '<FIXTURE_RETENTION_PERIOD>',
  firstCanaryRootAllowlist: '<FIRST_CANARY_ROOT_ALLOWLIST>',
  approvalWindowDuration: '<APPROVAL_WINDOW_DURATION>',
  rollbackWindowDuration: '<ROLLBACK_WINDOW_DURATION>'
});

const RESOURCE_CREATION_SCOPE = Object.freeze([
  'create_isolated_staging_firebase_gcp_project',
  'attach_privately_selected_billing_account',
  'apply_approved_staging_labels',
  'create_rtdb_in_us_central1',
  'register_one_staging_web_app',
  'create_runtime_and_deployment_service_accounts',
  'assign_separately_approved_iam_roles',
  'create_usd_10_budget_and_selected_alerts',
  'prepare_ignored_local_staging_configuration',
  'verify_resource_inventory_and_stop'
]);

const RESOURCE_CREATION_EXCLUSIONS = Object.freeze([
  'additive_rules_deployment',
  'functions_deployment',
  'app_check_registration_or_enforcement',
  'synthetic_fixture_creation',
  'write_gate_activation',
  'canary_execution',
  'staging_client_wiring',
  'cohort_selection',
  'preference_migration',
  'approved_viewer_grants',
  'production_actions'
]);

const PREFLIGHT_RESOLUTION_CHECKLIST = Object.freeze([
  'resolve_and_validate_staging_project_id',
  'verify_project_id_is_not_production_or_visually_similar',
  'privately_select_billing_account_and_operator',
  'resolve_web_app_and_service_account_names',
  'resolve_private_operator_and_alert_destinations',
  'reverify_current_official_pricing',
  'verify_rtdb_and_functions_region_pairing',
  'verify_gen2_permissions_without_broad_preemptive_grants',
  'recompute_additive_and_rollback_rules_hashes',
  'confirm_both_server_write_gates_false',
  'confirm_both_client_feature_flags_false',
  'resolve_fixture_formats_caps_retention_and_allowlist',
  'define_approval_and_rollback_windows',
  'record_operator_preflight_smoke_stop_and_rollback_plan'
]);

const SAFETY_STATE = Object.freeze({
  operationCapability: 'none',
  resourceCreationApproval: 'undecided',
  shareVisibilityModelEnabled: false,
  syncedTrainerPreferencesEnabled: false,
  shareVisibilityServerWriteGate: false,
  trainerPreferencesServerWriteGate: false,
  cohortSelected: false,
  privateReview: Object.freeze({
    confirmedValidIdentity: 3,
    unreviewed: 49,
    seedEligibleTrueCount: 0
  })
});

function approvalRecord() {
  return Object.freeze({
    approvalStatus: APPROVAL_STATUS,
    approvedBy: '',
    approvedAt: ''
  });
}

function decisionRecord(recommendedValue, selectedProposedValue) {
  return Object.freeze({
    recommendedValue,
    selectedProposedValue,
    approvalStatus: APPROVAL_STATUS,
    approvedBy: '',
    approvedAt: ''
  });
}

function createDecisionSummary() {
  const decisions = Object.fromEntries(Object.entries(PROPOSED_CHOICES).map(
    ([key, value]) => [key, decisionRecord(value, value)]
  ));
  const approvals = Object.fromEntries(EXECUTION_APPROVAL_KEYS.map((key) => [key, approvalRecord()]));
  return Object.freeze({
    schemaVersion: 1,
    status: 'proposal_only',
    operationCapability: 'none',
    decisions: Object.freeze(decisions),
    unresolvedValues: UNRESOLVED_VALUES,
    resourceCreation: Object.freeze({
      approvalStatus: APPROVAL_STATUS,
      approvedBy: '',
      approvedAt: '',
      scope: RESOURCE_CREATION_SCOPE,
      exclusions: RESOURCE_CREATION_EXCLUSIONS
    }),
    executionApprovals: Object.freeze(approvals),
    futureApprovalRequiredFields: REQUIRED_APPROVAL_FIELDS,
    preflightResolutionChecklist: PREFLIGHT_RESOLUTION_CHECKLIST,
    safety: SAFETY_STATE
  });
}

function validateSummary(summary, productionProjectId = '<PRODUCTION_PROJECT_ID>') {
  const errors = [];
  if (!summary || summary.operationCapability !== 'none') errors.push('operation_capability_forbidden');
  if (summary?.status !== 'proposal_only') errors.push('summary_status_invalid');
  for (const [key, value] of Object.entries(summary?.decisions || {})) {
    if (value.approvalStatus !== APPROVAL_STATUS) errors.push(`decision_approved:${key}`);
    if (value.approvedBy !== '' || value.approvedAt !== '') errors.push(`decision_approval_metadata_present:${key}`);
  }
  for (const [key, value] of Object.entries(summary?.executionApprovals || {})) {
    if (value.approvalStatus !== APPROVAL_STATUS) errors.push(`execution_approval_changed:${key}`);
    if (value.approvedBy !== '' || value.approvedAt !== '') errors.push(`execution_approval_metadata_present:${key}`);
  }
  if (summary?.resourceCreation?.approvalStatus !== APPROVAL_STATUS) errors.push('resource_creation_approved');
  if (summary?.resourceCreation?.approvedBy !== '' || summary?.resourceCreation?.approvedAt !== '') errors.push('resource_creation_approval_metadata_present');
  if (summary?.unresolvedValues?.stagingProjectId === productionProjectId) errors.push('production_target_forbidden');
  if (summary?.safety?.cohortSelected !== false) errors.push('cohort_selected');
  if (summary?.safety?.privateReview?.seedEligibleTrueCount !== 0) errors.push('seed_eligible_state_changed');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

module.exports = Object.freeze({
  APPROVAL_STATUS,
  RULE_HASHES,
  EXECUTION_APPROVAL_KEYS,
  REQUIRED_APPROVAL_FIELDS,
  PROPOSED_CHOICES,
  UNRESOLVED_VALUES,
  RESOURCE_CREATION_SCOPE,
  RESOURCE_CREATION_EXCLUSIONS,
  PREFLIGHT_RESOLUTION_CHECKLIST,
  SAFETY_STATE,
  createDecisionSummary,
  validateSummary
});
