'use strict';

const CALLABLES = Object.freeze([
  'reserveTrainerHandle',
  'claimTrainerTagLabel',
  'verifyTrainerHistory',
  'setApprovedViewer'
]);

const RUNTIME = Object.freeze({
  generation: 2,
  candidateRegion: 'us-east1',
  recommendedRegion: 'us-central1',
  deploymentRegion: '<REGION>',
  regionDecision: 'blocked_until_staging_rtdb_location_is_verified',
  runtime: 'nodejs22',
  memoryMiB: 256,
  timeoutSeconds: 30,
  maxInstances: 5,
  minInstances: 0,
  concurrency: 10,
  projectId: '<STAGING_PROJECT_ID>',
  runtimeServiceAccount: '<RUNTIME_SERVICE_ACCOUNT>'
});

const IAM = Object.freeze({
  runtime: Object.freeze([
    'roles/firebasedatabase.admin',
    'roles/firebaseappcheck.tokenVerifier',
    'roles/logging.logWriter'
  ]),
  deployment: Object.freeze([
    'roles/cloudfunctions.developer',
    'roles/iam.serviceAccountUser',
    'roles/serviceusage.serviceUsageConsumer'
  ]),
  rulesOperator: Object.freeze(['custom:firebaserules.reviewedReleasePublisher']),
  humanReviewer: Object.freeze([
    'roles/cloudfunctions.viewer',
    'roles/logging.viewer',
    'roles/monitoring.viewer'
  ]),
  limitation: 'Realtime Database IAM is instance-level, not data-path-granular. Runtime safety therefore also requires an isolated project, fixed adapters, disabled gates, reviewed rules, tests, and mutation-root monitoring.',
  runtimeMayDeploy: false,
  deploymentMayRunAsRuntimeWithoutServiceAccountUser: false
});

const PATH_MATRIX = Object.freeze({
  reserveTrainerHandle: Object.freeze({
    reads: Object.freeze(['shareVisibilityConfig/writesEnabled', 'accounts/{callerUid}', 'shareDirectory/{normalizedHandle}', 'trustedOperationRequests/{callerUid}/reserveTrainerHandle/{requestId}']),
    writes: Object.freeze(['accounts/{callerUid}', 'shareDirectory/{normalizedHandle}', 'trustedOperationRequests/{callerUid}/reserveTrainerHandle/{requestId}'])
  }),
  claimTrainerTagLabel: Object.freeze({
    reads: Object.freeze(['trainerPreferencesConfig/writesEnabled', 'userPreferences/{callerUid}/trainerTags/{tagId}', 'userPreferences/{callerUid}/trainerTagLabels/{normalizedLabelKey}', 'trustedOperationRequests/{callerUid}/claimTrainerTagLabel/{requestId}']),
    writes: Object.freeze(['userPreferences/{callerUid}/trainerTags/{tagId}', 'userPreferences/{callerUid}/trainerTagLabels/{normalizedLabelKey}', 'trustedOperationRequests/{callerUid}/claimTrainerTagLabel/{requestId}'])
  }),
  verifyTrainerHistory: Object.freeze({
    reads: Object.freeze(['trainerPreferencesConfig/writesEnabled', 'trainerShares/{ownerUid}', 'shareVisibility/{ownerUid}/mode', 'shareAccess/{ownerUid}/{callerUid}', 'admins/{callerUid}', 'userPreferences/{callerUid}/trainerHistory/{ownerUid}', 'trustedOperationRequests/{callerUid}/verifyTrainerHistory/{requestId}']),
    writes: Object.freeze(['userPreferences/{callerUid}/trainerHistory/{ownerUid}', 'trustedOperationRequests/{callerUid}/verifyTrainerHistory/{requestId}'])
  }),
  setApprovedViewer: Object.freeze({
    reads: Object.freeze(['shareVisibilityConfig/writesEnabled', 'accounts/{viewerUid}', 'shareDirectory/{normalizedHandle}', 'shareAccess/{callerUid}/{viewerUid}', 'trustedOperationRequests/{callerUid}/setApprovedViewer/{requestId}']),
    writes: Object.freeze(['shareAccess/{callerUid}/{viewerUid}', 'trustedOperationRequests/{callerUid}/setApprovedViewer/{requestId}'])
  })
});

const GATE_SEQUENCE = Object.freeze([
  'deploy_additive_rules_gates_false',
  'deploy_functions_gates_false',
  'verify_all_disabled_before_idempotency',
  'enable_share_visibility_staging_only',
  'canary_handle_and_approved_viewer',
  'disable_share_visibility',
  'enable_trainer_preferences_staging_only',
  'canary_tags_and_history',
  'disable_trainer_preferences',
  'review_evidence_before_simultaneous_enablement'
]);

const RATE_LIMITS = Object.freeze({
  reserveTrainerHandle: Object.freeze({ shortWindowSeconds: 3600, shortLimit: 2, dailyLimit: 3 }),
  claimTrainerTagLabel: Object.freeze({ shortWindowSeconds: 600, shortLimit: 20, dailyLimit: 100 }),
  verifyTrainerHistory: Object.freeze({ shortWindowSeconds: 600, shortLimit: 30, dailyLimit: 300 }),
  setApprovedViewer: Object.freeze({ shortWindowSeconds: 600, shortLimit: 10, dailyLimit: 50 }),
  keyShape: 'trustedRateLimits/{callerUid}/{operation}/{windowKey}',
  replayPolicy: 'verified_terminal_replays_use_a_separate_cheap_replay_limit',
  storesIpAddress: false,
  implementationStatus: 'design_only'
});

const CANARIES = Object.freeze({
  reserveTrainerHandle: Object.freeze(['valid_reservation', 'same_owner_replay', 'collision', 'malformed_or_confusable', 'replay_mismatch', 'gate_disabled']),
  claimTrainerTagLabel: Object.freeze(['create', 'exact_replay', 'duplicate_normalized_label', 'rename', 'rename_collision', 'soft_delete', 'cross_viewer_denial', 'gate_disabled']),
  verifyTrainerHistory: Object.freeze(['valid_snapshot', 'count_mismatch', 'oversized_snapshot', 'stale_version', 'same_version_conflict', 'exact_replay', 'restricted_source_denial', 'gate_disabled']),
  setApprovedViewer: Object.freeze(['grant', 'exact_replay', 'self_grant_denial', 'cross_owner_denial', 'revoke', 'immediate_read_denial_after_revoke', 'gate_disabled']),
  evidence: Object.freeze(['expected_result', 'changed_roots', 'unchanged_roots', 'redacted_log', 'idempotency_status', 'teardown_status'])
});

const COST_ASSUMPTIONS = Object.freeze({
  perMauNormal: Object.freeze({ reserveTrainerHandle: 0.05, claimTrainerTagLabel: 2, verifyTrainerHistory: 8, setApprovedViewer: 0.5 }),
  perMauHigh: Object.freeze({ reserveTrainerHandle: 0.1, claimTrainerTagLabel: 10, verifyTrainerHistory: 60, setApprovedViewer: 3 }),
  averageDurationMs: Object.freeze({ reserveTrainerHandle: 250, claimTrainerTagLabel: 180, verifyTrainerHistory: 350, setApprovedViewer: 180 }),
  rtdbOperations: Object.freeze({
    reserveTrainerHandle: Object.freeze({ reads: 6, writes: 4 }),
    claimTrainerTagLabel: Object.freeze({ reads: 4, writes: 4 }),
    verifyTrainerHistory: Object.freeze({ reads: 8, writes: 4 }),
    setApprovedViewer: Object.freeze({ reads: 7, writes: 3 })
  }),
  memoryGiB: 0.25,
  appCheckAssessmentsPerInvocation: 1,
  logEventsPerInvocation: 2,
  averageEgressBytesPerInvocation: 8192,
  normalDeploymentsPerMonth: 2,
  highDeploymentsPerMonth: 8,
  artifactStorageGiB: 0.5
});

function workloadFor(mau, activity = 'normal') {
  if (![100, 1000, 10000].includes(mau)) throw new RangeError('Unsupported MAU scenario');
  const calls = activity === 'high' ? COST_ASSUMPTIONS.perMauHigh : COST_ASSUMPTIONS.perMauNormal;
  const byOperation = Object.fromEntries(CALLABLES.map((operation) => [operation, Math.ceil(calls[operation] * mau)]));
  const invocations = Object.values(byOperation).reduce((sum, value) => sum + value, 0);
  let computeSeconds = 0;
  let rtdbReads = 0;
  let rtdbWrites = 0;
  for (const operation of CALLABLES) {
    computeSeconds += byOperation[operation] * COST_ASSUMPTIONS.averageDurationMs[operation] / 1000;
    rtdbReads += byOperation[operation] * COST_ASSUMPTIONS.rtdbOperations[operation].reads;
    rtdbWrites += byOperation[operation] * COST_ASSUMPTIONS.rtdbOperations[operation].writes;
  }
  return Object.freeze({
    mau,
    activity,
    byOperation: Object.freeze(byOperation),
    invocations,
    vCpuSeconds: Math.ceil(computeSeconds),
    gibSeconds: Math.ceil(computeSeconds * COST_ASSUMPTIONS.memoryGiB),
    rtdbReads,
    rtdbWrites,
    appCheckAssessments: invocations,
    structuredLogEvents: invocations * COST_ASSUMPTIONS.logEventsPerInvocation,
    estimatedEgressMiB: Math.ceil(invocations * COST_ASSUMPTIONS.averageEgressBytesPerInvocation / 1024 / 1024),
    deployments: activity === 'high' ? COST_ASSUMPTIONS.highDeploymentsPerMonth : COST_ASSUMPTIONS.normalDeploymentsPerMonth,
    artifactStorageGiB: COST_ASSUMPTIONS.artifactStorageGiB
  });
}

const RETENTION = Object.freeze({
  terminalDays: 7,
  pendingDeletionAllowed: false,
  stagingStrategy: 'manual_fixture_teardown_only',
  productionRecommendation: 'separately_reviewed_daily_expiry_bucket_cleanup',
  maxBatch: 100,
  fullCollectionScanAllowed: false,
  schedulerImplemented: false
});

const ROLLBACK = Object.freeze([
  'set_both_server_gates_false',
  'disable_future_client_invocation_paths',
  'disable_staging_app_check_enforcement_if_false_rejections',
  'stop_or_delete_staging_functions',
  'restore_staging_narrow_read_rules_baseline_if_required',
  'clear_only_synthetic_fixture_roots',
  'retain_redacted_diagnostic_logs'
]);

const APPROVALS = Object.freeze([
  'create_isolated_staging_project',
  'select_staging_region_after_rtdb_location_verification',
  'create_runtime_and_deployment_service_accounts',
  'assign_reviewed_iam_roles',
  'register_staging_app_check',
  'deploy_additive_staging_rules',
  'deploy_functions_to_staging',
  'create_synthetic_fixtures',
  'enable_share_visibility_staging_gate',
  'run_share_visibility_canaries',
  'enable_trainer_preferences_staging_gate',
  'run_trainer_preferences_canaries',
  'configure_retention_cleanup',
  'create_billing_alerts'
]);

const COMMAND_TEMPLATES = Object.freeze({
  verifyProject: "firebase projects:list # manually confirm <STAGING_PROJECT_ID>",
  deployRules: "firebase deploy --only database --project <STAGING_PROJECT_ID> --config <STAGING_FIREBASE_CONFIG>",
  deployFunctions: "TRUSTED_FUNCTIONS_REGION=<REGION> TRUSTED_FUNCTIONS_RUNTIME_SERVICE_ACCOUNT=<RUNTIME_SERVICE_ACCOUNT> firebase deploy --only functions:reserveTrainerHandle,functions:claimTrainerTagLabel,functions:verifyTrainerHistory,functions:setApprovedViewer --project <STAGING_PROJECT_ID> --config <STAGING_FIREBASE_CONFIG>"
});

module.exports = Object.freeze({
  CALLABLES,
  RUNTIME,
  IAM,
  PATH_MATRIX,
  GATE_SEQUENCE,
  RATE_LIMITS,
  CANARIES,
  COST_ASSUMPTIONS,
  workloadFor,
  RETENTION,
  ROLLBACK,
  APPROVALS,
  COMMAND_TEMPLATES
});
