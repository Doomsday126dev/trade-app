'use strict';

const { DECISION_FIELDS, validateProjectTarget } = require('./stagingCreationApproval.cjs');

const RECOMMENDATION_STATUS = 'recommendation_only';

function decision(recommended, alternative, why, cost, security, complexity, reversibility, requiredBeforeApproval, confidence) {
  return Object.freeze({
    status: RECOMMENDATION_STATUS,
    recommended,
    alternative,
    why,
    cost,
    security,
    complexity,
    reversibility,
    requiredBeforeApproval,
    confidence
  });
}

const DECISION_RECOMMENDATIONS = Object.freeze({
  STAGING_PROJECT_ID: decision(
    '<APP_SLUG>-staging-<RANDOM_SUFFIX>',
    '<APP_SLUG>-sandbox-<RANDOM_SUFFIX>',
    'The explicit staging marker is easy to recognize and the random suffix reduces naming collisions; it is not an authorization control.',
    'Project creation alone is not modeled as workload spend, but retained resources in it can be billable.',
    'Reject equality or visual confusion with the ignored production target and require explicit project-qualified operations.',
    'Low after the private target check and naming policy are automated.',
    'The project ID is permanent; changing it requires a new project.',
    'Final app slug, random suffix, ignored production target, and named operator verification.',
    'high'
  ),
  BILLING_ACCOUNT: decision(
    'Future production billing account with a staging-specific budget',
    'A separate billing account when the organization can operate one safely',
    'A shared account is simpler for a small project while a separate budget preserves staging visibility; a separate account provides stronger accounting isolation at greater administrative cost.',
    'Billing linkage enables paid Gen 2 services and usage beyond allowances. Budgets notify but do not cap charges.',
    'Only a time-bounded billing operator should attach or detach the account; no billing identifier belongs in source.',
    'Shared account: low. Separate account: medium to high.',
    'The link can be changed by authorized operators, but incurred charges and retained resources remain.',
    'Private account choice, billing operator, organizational policy, current official pricing, and budget notification route.',
    'medium'
  ),
  RTDB_LOCATION: decision(
    'us-central1, recommendation only',
    'europe-west1 or asia-southeast1 when residency or measured user geography requires it',
    'The current likely audience is primarily US-based and colocation offers the simplest low-latency default, but production location must be verified rather than assumed.',
    'Colocation avoids avoidable cross-region transfer and latency; the selected region must be repriced.',
    'Residency requirements and future user geography must be reviewed before approval.',
    'Low at creation, very high if changed later.',
    'RTDB location is immutable; changing it requires database recreation and controlled data movement.',
    'Verified audience geography, residency requirements, production-location observation, and official regional pricing.',
    'medium'
  ),
  FUNCTIONS_REGION: decision(
    '<REGION> resolved to the approved RTDB-colocated Gen 2 region',
    'A nearby supported Gen 2 region only when exact colocation is unavailable and its transfer tradeoff is approved',
    'One region for all five callables minimizes latency and operational variance at the current scale.',
    'Colocation reduces cross-region traffic; invocation and compute pricing must be checked for the chosen region.',
    'The current source declaration must be parameterized and deployment must fail while <REGION> is unresolved.',
    'Low with one region; multi-region deployment adds monitoring, IAM, and rollback work.',
    'Functions can be redeployed to another region, with endpoint migration and cleanup.',
    'Approved RTDB location, supported Node 22 Gen 2 region, parameterized source, and fail-closed target validation.',
    'high after RTDB selection'
  ),
  STAGING_WEB_APP_NAME: decision(
    '<APP_SLUG> staging web',
    'Existing app code loaded locally with an ignored staging config',
    'A dedicated Firebase web app gives App Check and client configuration a clear staging boundary; a separate hosted staging deployment can follow only when browser testing needs it.',
    'App registration is normally usage-neutral; hosting, App Check assessments, and traffic are usage-driven.',
    'Never copy production config into tracked files; any future staging UI must be visibly marked staging.',
    'Dedicated registration: low. Separate hosted deployment: medium.',
    'The app registration can be replaced, but tokens/configuration must be revoked and removed.',
    'Private app name, approved staging domain or local origin, App Check registration plan, and hosting decision.',
    'high'
  ),
  APP_CHECK_PROVIDER: decision(
    'reCAPTCHA Enterprise in metrics-only observation before enforcement',
    'Keep App Check unconfigured while callable gates remain false',
    'Enterprise supports the browser/PWA target and aggregate assessment metrics; enforcement must wait for representative compatibility evidence.',
    'One conservative assessment per request is modeled. Token reuse may reduce assessments; official tiers require reverification.',
    'Debug tokens stay ignored and staging-only. App Check supplements Auth, rules, schemas, limits, and idempotency.',
    'Medium because browser, Safari, installed-PWA, token refresh, and false-rejection testing are required.',
    'Enforcement can be disabled while gates remain false; revoke debug tokens and unregister the provider during teardown.',
    'Staging web app, allowed origins, token TTL, billing tier, debug-token custodian, and observation evidence.',
    'medium'
  ),
  RUNTIME_SERVICE_ACCOUNT: decision(
    '<APP_SLUG>-trusted-runtime-staging',
    'One runtime identity per callable after trust boundaries diverge',
    'One unique runtime identity for this fixed five-function set is proportional today because all five share the same bounded roots and controls.',
    'No direct fee; its authority can enable billable RTDB, logging, and callable activity.',
    'Runtime-only roles: instance-wide RTDB Admin, App Check token verification, and log writing. It cannot deploy, manage IAM/Auth, or publish rules.',
    'One shared runtime identity: medium. Per-callable identities: higher operational burden with limited current benefit.',
    'Redeploy Functions onto a replacement identity, then disable and remove the old account and bindings.',
    'Final name, role scope review, compensating controls, mutation-root monitoring, and removal owner.',
    'medium'
  ),
  DEPLOYMENT_SERVICE_ACCOUNT: decision(
    '<APP_SLUG>-trusted-deployer-staging',
    'A named human deployer with equivalent time-bounded grants',
    'A separate deployment identity makes deploy and runtime authority independently revocable and auditable.',
    'No direct fee; deployments may incur build and artifact storage usage.',
    'Grant deploy, scoped runtime-service-account impersonation, and service usage only for a short approved deployment window.',
    'Medium due to temporary IAM grant and revocation handling.',
    'Revoke grants immediately after the deployment window; replace the identity without runtime data migration.',
    'Final name, deploy mechanism, scoped resources, grant duration, approver, and revocation verification.',
    'high'
  ),
  RULES_OPERATOR_IDENTITY: decision(
    '<RULES_RELEASE_OPERATOR>',
    'A dedicated release service account with a reviewed custom role',
    'Keeping rule publication separate from Functions deployment reduces accidental combined authority.',
    'No direct fee; unsafe rule publication can expose or block billable traffic and data.',
    'Use the narrowest reviewed rules-release role for one atomic release window; never give it runtime authority.',
    'Named human: low for a one-time staging release. Dedicated automation: medium.',
    'Remove the grant after hash verification; the identity can be replaced for the next reviewed release.',
    'Named private operator, custom-role permission review, release window, candidate/rollback hashes, and post-publish verifier.',
    'high'
  ),
  HUMAN_OPERATOR: decision(
    '<NAMED_HUMAN_OPERATOR>',
    'Two-person operator/reviewer split when another qualified reviewer is available',
    'A named accountable operator must verify targets, hashes, gates, billing, evidence, and teardown; a second reviewer improves high-risk steps.',
    'No direct fee; prompt containment prevents avoidable spend.',
    'Viewer access should be time-bounded and limited to function, logging, and monitoring evidence.',
    'One operator: low. Two-person release: medium and preferable for later production work.',
    'Viewer grants are removable; changing the operator requires a new private approval record.',
    'Named person selected privately, availability during canary/rollback, reviewer coverage, and incident contact route.',
    'high'
  ),
  BUDGET_AMOUNT: decision(
    'USD 10 monthly staging budget with a USD 3-5 operator stop threshold',
    'USD 5 for very short sessions or USD 25 when repeated measured testing justifies it',
    'USD 10 is visible enough for synthetic tests while still treating unexpected single-digit spend as an investigation trigger.',
    'Budgets are advisory, not hard caps. Normal short synthetic sessions should remain near allowances; persistent charges indicate retained artifacts, traffic, or configuration drift.',
    'A low operator threshold prompts gates-off containment before the formal budget is exhausted.',
    'Low; requires private notification routing and a documented response owner.',
    'Budget values can be changed or deleted without recreating Firebase resources.',
    'Billing currency, official pricing recheck, notification recipients, forecast support, and authority to execute the kill switch.',
    'medium'
  ),
  BUDGET_ALERT_THRESHOLDS: decision(
    '25/50/75/90/100 percent plus USD 1/3/5/10 and daily/forecast alerts where available',
    '50/75/90/100 percent with fewer absolute alerts',
    'Early absolute thresholds are more useful than percentages for a tiny budget; percentages still show acceleration.',
    'Alerts themselves are generally low cost but must be checked against current billing/monitoring pricing.',
    'Recipients remain private placeholders; alerts trigger investigation and containment but never grant automatic data authority.',
    'Medium because routing, forecast semantics, deduplication, and response ownership must be tested.',
    'Thresholds and recipients can be changed; historical charges and alert events remain.',
    'Private recipients, primary/backup operator, alert channels, daily/forecast availability, and actions at each threshold.',
    'high'
  ),
  SYNTHETIC_FIXTURE_NAMESPACE: decision(
    '<SYNTHETIC_FIXTURE_NAMESPACE> used in obviously synthetic IDs at the actual candidate roots',
    'A staging-only parent for auxiliary teardown metadata, never as a substitute for exercising candidate roots',
    'Production-like roots are required to test actual rules and adapters; synthetic IDs plus an allowlisted teardown manifest keep records identifiable and removable.',
    'Tiny bounded RTDB/Auth storage and traffic; teardown verification prevents retained usage.',
    'No production-derived names, IDs, counts, hashes, timestamps, or contents. Teardown deletes only manifest-listed synthetic records.',
    'Medium because every touched root and synthetic Auth identity needs deterministic inventory and cleanup checks.',
    'Fixtures can be removed and recreated; deletion stops on any unrecognized or non-synthetic record.',
    'Final namespace, root allowlist, deterministic fake identities, teardown manifest format, max fixture counts, and cleanup operator.',
    'high'
  )
});

const INITIAL_COST_POSTURE = Object.freeze({
  minInstances: 0,
  maxInstances: 5,
  concurrency: 10,
  timeoutSeconds: 30,
  passivePageLoadCalls: false,
  loginTriggeredCalls: false,
  polling: false,
  scheduledCleanup: false,
  syntheticCanariesOnly: true,
  boundedStructuredLogs: true,
  artifactRegistryCleanup: true,
  shortStagingSessions: true,
  gatesDefaultFalse: true,
  perUidAndOperationLimitsBeforeProduction: true,
  killSwitch: 'set_both_write_gates_false_then_disable_invocation_paths_and_functions'
});

const EXPECTED_STAGING_SPEND = Object.freeze([
  Object.freeze({ activity: 'project_exists_unused', range: 'USD 0-1 per month', caveat: 'No zero-cost promise; retained artifacts, logs, RTDB storage, or configuration can incur charges.' }),
  Object.freeze({ activity: 'one_small_deployment', range: 'USD 0-2 per deployment event', caveat: 'No zero-cost promise; build minutes and retained Artifact Registry images are the first likely deployment costs.' }),
  Object.freeze({ activity: 'one_synthetic_canary_session', range: 'USD 0-2 per session', caveat: 'Assumes bounded calls, gates reopened briefly, and no polling or retries.' }),
  Object.freeze({ activity: 'several_test_sessions_monthly', range: 'USD 0-5 per month', caveat: 'Assumes cleanup, bounded logs, no passive traffic, and current allowances; investigate unexpected spend promptly.' })
]);

const APP_CHECK_ENFORCEMENT_CRITERIA = Object.freeze({
  minimumAcceptedSyntheticInvocations: 120,
  minimumAcceptedPerCallablePerEnvironment: 10,
  environments: Object.freeze(['chrome_browser', 'safari_browser', 'installed_pwa']),
  acceptedTokenRateMinimum: 0.99,
  unexplainedRejectionsMaximum: 0,
  tokenCases: Object.freeze(['valid', 'missing', 'invalid', 'expired', 'refreshed', 'consumed']),
  enforcementConfigured: false
});

const COST_SCENARIO_GUARDS = Object.freeze({
  guarded: Object.freeze({ maxInstances: 'effective', rateLimits: 'effective', gates: 'explicit_canary_only', meaning: 'lower_risk_launch_sensitivity' }),
  normal: Object.freeze({ maxInstances: 'effective', rateLimits: 'effective', gates: 'effective', meaning: 'ordinary_product_planning_sensitivity' }),
  high: Object.freeze({ maxInstances: 'effective', rateLimits: 'effective', gates: 'effective', meaning: 'high_legitimate_use_sensitivity' }),
  boundedAbuse: Object.freeze({ maxInstances: 'effective', rateLimits: 'saturated_for_every_uid_every_day', gates: 'effective', meaning: 'severe_bounded_incident_sensitivity' }),
  catastrophic: Object.freeze({ maxInstances: 'not_assumed_effective_for_full_demand_range', rateLimits: 'absent_or_bypassed', gates: 'absent_or_bypassed', meaning: 'attempted_demand_stress_envelope' })
});

const APPROVAL_DEPENDENCY_ORDER = Object.freeze([
  'official_pricing_reverification',
  'staging_project_and_billing_strategy',
  'rtdb_location',
  'functions_region',
  'staging_web_app_and_app_check',
  'runtime_deployment_rules_and_human_identities',
  'iam_role_matrix_and_revocation',
  'budget_and_alerts',
  'synthetic_fixture_namespace_and_teardown',
  'additive_and_rollback_rule_hashes',
  'separate_resource_creation_approval'
]);

function createRecommendationPackage() {
  return Object.freeze({
    schemaVersion: 1,
    status: RECOMMENDATION_STATUS,
    operationCapability: 'none',
    mutatesApprovalTemplate: false,
    recommendations: DECISION_RECOMMENDATIONS,
    initialCostPosture: INITIAL_COST_POSTURE,
    expectedStagingSpend: EXPECTED_STAGING_SPEND,
    appCheckEnforcementCriteria: APP_CHECK_ENFORCEMENT_CRITERIA,
    costScenarioGuards: COST_SCENARIO_GUARDS,
    approvalDependencyOrder: APPROVAL_DEPENDENCY_ORDER
  });
}

function projectIdSkeleton(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replaceAll('0', 'o')
    .replaceAll('1', 'l')
    .replaceAll('5', 's')
    .replace(/[^a-z0-9]/g, '');
}

function validateRecommendedProjectTarget(projectId, productionProjectId) {
  const base = validateProjectTarget(projectId, productionProjectId);
  const errors = [...base.errors];
  const candidate = projectIdSkeleton(projectId);
  const production = projectIdSkeleton(productionProjectId);
  if (production && candidate.includes(production) && !errors.includes('production_target_forbidden')) {
    errors.push('project_id_visually_similar_to_production');
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

module.exports = Object.freeze({
  RECOMMENDATION_STATUS,
  DECISION_RECOMMENDATIONS,
  INITIAL_COST_POSTURE,
  EXPECTED_STAGING_SPEND,
  APP_CHECK_ENFORCEMENT_CRITERIA,
  COST_SCENARIO_GUARDS,
  APPROVAL_DEPENDENCY_ORDER,
  createRecommendationPackage,
  validateRecommendedProjectTarget,
  decisionFields: DECISION_FIELDS
});
