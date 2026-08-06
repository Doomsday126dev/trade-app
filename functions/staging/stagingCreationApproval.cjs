'use strict';

const APPROVAL_STATUSES = Object.freeze([
  'undecided',
  'approved',
  'rejected',
  'not_applicable'
]);

const DECISION_FIELDS = Object.freeze([
  'STAGING_PROJECT_ID',
  'BILLING_ACCOUNT',
  'RTDB_LOCATION',
  'FUNCTIONS_REGION',
  'STAGING_WEB_APP_NAME',
  'APP_CHECK_PROVIDER',
  'RUNTIME_SERVICE_ACCOUNT',
  'DEPLOYMENT_SERVICE_ACCOUNT',
  'RULES_OPERATOR_IDENTITY',
  'HUMAN_OPERATOR',
  'BUDGET_AMOUNT',
  'BUDGET_ALERT_THRESHOLDS',
  'SYNTHETIC_FIXTURE_NAMESPACE'
]);

const APPROVAL_ITEMS = Object.freeze([
  'staging_project_creation',
  'billing_attachment',
  'rtdb_location',
  'functions_region',
  'web_app_registration',
  'app_check_provider',
  'runtime_service_account',
  'deployment_service_account',
  'iam_roles',
  'rules_operator',
  'human_operator',
  'budget_amount',
  'alert_thresholds',
  'fixture_namespace',
  'additive_rules_sha',
  'rollback_rules_sha',
  'functions_deployment',
  'synthetic_fixture_creation',
  'share_visibility_gate_enablement',
  'trainer_preferences_gate_enablement',
  'canary_execution',
  'retention_cleanup'
]);

const RULE_HASHES = Object.freeze({
  narrowReadBaseline: 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf',
  additiveCandidate: 'ba7322a59a4c3cf6b503dc52b1394313ac9421106a6c05fc6835200d49e3e72d'
});

const LOCATION_GUIDE = Object.freeze({
  'us-central1': Object.freeze({ functionsRegion: 'us-central1', label: 'iowa', recreatesDatabaseToChange: true }),
  'europe-west1': Object.freeze({ functionsRegion: 'europe-west1', label: 'belgium', recreatesDatabaseToChange: true }),
  'asia-southeast1': Object.freeze({ functionsRegion: 'asia-southeast1', label: 'singapore', recreatesDatabaseToChange: true })
});

const IAM_MATRIX = Object.freeze({
  runtime: Object.freeze([
    Object.freeze({ role: 'roles/firebasedatabase.admin', duration: 'runtime', danger: 'instance_wide_rtdb_read_write_and_administration', customRoleRealistic: false }),
    Object.freeze({ role: 'roles/firebaseappcheck.tokenVerifier', duration: 'runtime', danger: 'consume_app_check_tokens', customRoleRealistic: false }),
    Object.freeze({ role: 'roles/logging.logWriter', duration: 'runtime', danger: 'write_project_logs', customRoleRealistic: false })
  ]),
  deployment: Object.freeze([
    Object.freeze({ role: 'roles/cloudfunctions.developer', duration: 'deployment_only', danger: 'create_update_delete_functions', customRoleRealistic: true }),
    Object.freeze({ role: 'roles/iam.serviceAccountUser', duration: 'deployment_only', danger: 'act_as_runtime_identity', customRoleRealistic: true }),
    Object.freeze({ role: 'roles/serviceusage.serviceUsageConsumer', duration: 'deployment_only', danger: 'consume_enabled_project_services', customRoleRealistic: true })
  ]),
  rulesOperator: Object.freeze([
    Object.freeze({ role: 'custom:firebaserules.reviewedReleasePublisher', duration: 'rules_release_only', danger: 'replace_database_rules', customRoleRealistic: true })
  ]),
  humanReviewer: Object.freeze([
    Object.freeze({ role: 'roles/cloudfunctions.viewer', duration: 'review', danger: 'view_function_metadata', customRoleRealistic: false }),
    Object.freeze({ role: 'roles/logging.viewer', duration: 'review', danger: 'view_project_logs', customRoleRealistic: true }),
    Object.freeze({ role: 'roles/monitoring.viewer', duration: 'review', danger: 'view_monitoring_data', customRoleRealistic: false })
  ]),
  rtdbLimitation: 'roles/firebasedatabase.admin is instance-wide and is not path-granular least privilege',
  runtimeMayDeploy: false
});

const TEARDOWN_CATEGORIES = Object.freeze([
  'functions',
  'rtdb_synthetic_data',
  'auth_synthetic_users',
  'app_check_registration_and_debug_tokens',
  'service_accounts',
  'iam_bindings',
  'artifact_registry_images',
  'cloud_build_artifacts',
  'logs_and_log_sinks',
  'monitoring_dashboards_and_alerts',
  'budgets',
  'staging_web_app',
  'firebase_project',
  'linked_billing_account'
]);

const OFFICIAL_PRICING = Object.freeze({
  verifiedOn: '2026-08-05',
  sources: Object.freeze([
    'https://cloud.google.com/run/pricing',
    'https://firebase.google.com/pricing',
    'https://firebase.google.com/docs/database/usage/billing',
    'https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider',
    'https://docs.cloud.google.com/recaptcha/docs/billing-information',
    'https://cloud.google.com/build/pricing',
    'https://cloud.google.com/artifact-registry/pricing',
    'https://cloud.google.com/products/observability/pricing',
    'https://cloud.google.com/scheduler/pricing',
    'https://docs.cloud.google.com/billing/docs/how-to/budgets'
  ]),
  mustReverifyBeforeCreation: true
});

const COST_ASSUMPTIONS = Object.freeze({
  operationsPerMau: Object.freeze({
    guarded: Object.freeze({ reserveTrainerHandle: 0.03, claimTrainerTagLabel: 1, mutateFavoriteTrainer: 1, verifyTrainerHistory: 2, setApprovedViewer: 0.25 }),
    normal: Object.freeze({ reserveTrainerHandle: 0.05, claimTrainerTagLabel: 2, mutateFavoriteTrainer: 2, verifyTrainerHistory: 8, setApprovedViewer: 0.5 }),
    high: Object.freeze({ reserveTrainerHandle: 0.1, claimTrainerTagLabel: 10, mutateFavoriteTrainer: 15, verifyTrainerHistory: 60, setApprovedViewer: 3 }),
    abusive: Object.freeze({ reserveTrainerHandle: 90, claimTrainerTagLabel: 3000, mutateFavoriteTrainer: 6000, verifyTrainerHistory: 9000, setApprovedViewer: 1500 }),
    catastrophic: Object.freeze({ reserveTrainerHandle: 90, claimTrainerTagLabel: 3000, mutateFavoriteTrainer: 6000, verifyTrainerHistory: 9000, setApprovedViewer: 1500 })
  }),
  durationMs: Object.freeze({ reserveTrainerHandle: 250, claimTrainerTagLabel: 180, mutateFavoriteTrainer: 200, verifyTrainerHistory: 350, setApprovedViewer: 180 }),
  rtdbOperations: Object.freeze({
    reserveTrainerHandle: Object.freeze({ reads: 6, writes: 4 }),
    claimTrainerTagLabel: Object.freeze({ reads: 4, writes: 4 }),
    mutateFavoriteTrainer: Object.freeze({ reads: 6, writes: 3 }),
    verifyTrainerHistory: Object.freeze({ reads: 8, writes: 4 }),
    setApprovedViewer: Object.freeze({ reads: 7, writes: 3 })
  }),
  vCpu: 1,
  memoryGiB: 0.25,
  appCheckAssessmentsPerInvocation: 1,
  rtdbDownloadBytesPerRead: 2048,
  structuredLogBytesPerInvocation: 1600,
  egressBytesPerInvocation: 8192,
  retryAmplification: Object.freeze({ guarded: 1, normal: 1, high: 1, abusive: 1, catastrophic: 10 }),
  rateLimiting: Object.freeze({ guarded: 'active', normal: 'active', high: 'active', abusive: 'active_at_daily_ceiling', catastrophic: 'absent_or_bypassed' }),
  maxInstances: 5,
  concurrency: 10,
  pricingRegionAssumption: 'us-central1_tier_1_reference_only_region_unresolved',
  freeAllowancesAppliedToDollarRanges: true,
  deploymentsPerMonth: Object.freeze({ guarded: 1, normal: 2, high: 8, abusive: 30, catastrophic: 30 }),
  artifactStorageGiB: Object.freeze({ guarded: 0.5, normal: 0.5, high: 1, abusive: 5, catastrophic: 5 }),
  optionalCleanupJobs: Object.freeze({ guarded: 0, normal: 0, high: 0, abusive: 0, catastrophic: 0 })
});

function costScenario(mau, activity) {
  if (![100, 1000, 10000].includes(mau)) throw new RangeError('unsupported_mau');
  if (!Object.hasOwn(COST_ASSUMPTIONS.operationsPerMau, activity)) throw new RangeError('unsupported_activity');
  const perMau = COST_ASSUMPTIONS.operationsPerMau[activity];
  const retryAmplification = COST_ASSUMPTIONS.retryAmplification[activity];
  const byOperation = Object.fromEntries(Object.entries(perMau).map(([operation, count]) => [operation, Math.ceil(count * mau * retryAmplification)]));
  let computeSeconds = 0;
  let rtdbReads = 0;
  let rtdbWrites = 0;
  for (const [operation, count] of Object.entries(byOperation)) {
    computeSeconds += count * COST_ASSUMPTIONS.durationMs[operation] / 1000;
    rtdbReads += count * COST_ASSUMPTIONS.rtdbOperations[operation].reads;
    rtdbWrites += count * COST_ASSUMPTIONS.rtdbOperations[operation].writes;
  }
  const invocations = Object.values(byOperation).reduce((sum, count) => sum + count, 0);
  return Object.freeze({
    mau,
    activity,
    byOperation: Object.freeze(byOperation),
    invocations,
    vCpuSeconds: Math.ceil(computeSeconds * COST_ASSUMPTIONS.vCpu),
    gibSeconds: Math.ceil(computeSeconds * COST_ASSUMPTIONS.memoryGiB),
    rtdbReads,
    rtdbWrites,
    rtdbDownloadMiB: Math.ceil(rtdbReads * COST_ASSUMPTIONS.rtdbDownloadBytesPerRead / 1024 / 1024),
    appCheckAssessments: invocations,
    structuredLogMiB: Math.ceil(invocations * COST_ASSUMPTIONS.structuredLogBytesPerInvocation / 1024 / 1024),
    egressMiB: Math.ceil(invocations * COST_ASSUMPTIONS.egressBytesPerInvocation / 1024 / 1024),
    deployments: COST_ASSUMPTIONS.deploymentsPerMonth[activity],
    artifactStorageGiB: COST_ASSUMPTIONS.artifactStorageGiB[activity],
    cleanupJobs: COST_ASSUMPTIONS.optionalCleanupJobs[activity],
    retryAmplification,
    rateLimiting: COST_ASSUMPTIONS.rateLimiting[activity],
    maxInstances: COST_ASSUMPTIONS.maxInstances,
    concurrency: COST_ASSUMPTIONS.concurrency
  });
}

function createDefaultApproval() {
  return Object.freeze({
    schemaVersion: 1,
    operationCapability: 'none',
    decisions: Object.freeze(Object.fromEntries(
      DECISION_FIELDS.map((field) => [field, Object.freeze({ status: 'undecided', value: `<${field}>` })])
    )),
    approvals: Object.freeze(Object.fromEntries(
      APPROVAL_ITEMS.map((item) => [item, 'undecided'])
    )),
    safety: Object.freeze({
      expectedCommit: '<EXPECTED_COMMIT_SHA>',
      productionProjectId: '<PRODUCTION_PROJECT_ID>',
      additiveRulesSha: RULE_HASHES.additiveCandidate,
      rollbackRulesSha: RULE_HASHES.narrowReadBaseline,
      bothWriteGatesFalse: true,
      syntheticOnly: true
    })
  });
}

function validateProjectTarget(projectId, productionProjectId) {
  const errors = [];
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) errors.push('project_id_invalid');
  if (typeof projectId === 'string' && !/-staging(?:-|$)/.test(projectId)) errors.push('project_id_not_staging');
  if (typeof productionProjectId !== 'string' || /^<.*>$/.test(productionProjectId)) errors.push('production_target_unverified');
  if (projectId === productionProjectId) errors.push('production_target_forbidden');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

module.exports = Object.freeze({
  APPROVAL_STATUSES,
  DECISION_FIELDS,
  APPROVAL_ITEMS,
  RULE_HASHES,
  LOCATION_GUIDE,
  IAM_MATRIX,
  TEARDOWN_CATEGORIES,
  OFFICIAL_PRICING,
  COST_ASSUMPTIONS,
  costScenario,
  createDefaultApproval,
  validateProjectTarget
});
