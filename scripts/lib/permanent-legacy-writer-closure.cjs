'use strict';
const crypto = require('node:crypto');
const policy = require('../../functions/production/permanent-legacy-allocation-policy.json');
const resourceManifest = require('../../functions/production/e1-production-resource-manifest.json');
const { digest } = require('../../functions/e1-authority-service/durableProviderAdmission');
const { SERVICE_ACCOUNTS, EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS } =
  require('./legacy-slot-reconciliation-boundary.cjs');

function same(a, b) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
const REQUIRED_SERVICES = Object.freeze({ ...SERVICE_ACCOUNTS,
  reade1providerpublicshare: SERVICE_ACCOUNTS.reade1accountfoundation,
  liste1trainerdirectory: SERVICE_ACCOUNTS.reade1accountfoundation,
  resolvee1favoritetraineridentity: SERVICE_ACCOUNTS.reade1accountfoundation,
  createe1provideraccountfoundation: SERVICE_ACCOUNTS.reade1accountfoundation });
const TRACKED_DEPLOYERS = Object.freeze([resourceManifest.build.builderServiceAccount,
  resourceManifest.build.deployerServiceAccount]);
const HASH = /^[a-f0-9]{64}$/u;
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const routeKey = route => `${route.service}:${route.method}:${route.path}`;
const WRITER_GATES = Object.freeze(['CREATE_PROVIDER_ACCOUNT_ENABLED', 'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED', 'APPLY_MIGRATION_ENABLED', 'FREEZE_CONFLICT_ENABLED']);
function verifyPermanentWriterClosure(evidence, { reviewedDeployment, approvedReviewDigest } = {}) {
  const fail = () => { throw new Error('writer-closure/unqualified'); };
  if (!evidence || typeof evidence !== 'object' || !reviewedDeployment ||
      reviewedDeployment.schemaVersion !== 1 || reviewedDeployment.projectId !== resourceManifest.project.id ||
      !/^[a-f0-9]{40}$/u.test(reviewedDeployment.sourceCommitSha || '') ||
      !Number.isSafeInteger(reviewedDeployment.reviewedAt) || reviewedDeployment.reviewedAt <= 0 ||
      !HASH.test(approvedReviewDigest || '') || digest(reviewedDeployment) !== approvedReviewDigest ||
      !Array.isArray(reviewedDeployment.services) || !Array.isArray(reviewedDeployment.serviceAccounts) ||
      !Array.isArray(reviewedDeployment.operatorBreakGlassPrincipals) ||
      !same(Object.keys(REQUIRED_SERVICES), reviewedDeployment.services.map(item => item.name).filter(name =>
        Object.hasOwn(REQUIRED_SERVICES, name))) ||
      !same(TRACKED_DEPLOYERS, Object.keys(reviewedDeployment.trackedDeployers || {})) ||
      !same(TRACKED_DEPLOYERS, Object.keys(evidence.trackedDeployers || {})) ||
      digest(reviewedDeployment.trackedDeployers) !== digest(evidence.trackedDeployers) ||
      evidence.projectId !== reviewedDeployment.projectId ||
      !Number.isSafeInteger(evidence.capturedAt) || evidence.capturedAt < reviewedDeployment.reviewedAt) fail();
  const rulesDigest = crypto.createHash('sha256').update(`${JSON.stringify(evidence.deployedRules, null, 2)}\n`).digest('hex');
  if (rulesDigest !== policy.candidateRulesSha256 || evidence.iamInventoryComplete !== true ||
      evidence.serviceInventoryComplete !== true || evidence.routeReadbackComplete !== true ||
      evidence.serviceAccountInventoryComplete !== true ||
      !same(evidence.operatorBreakGlassPrincipals || [], reviewedDeployment.operatorBreakGlassPrincipals) ||
      evidence.pendingLegacyAllocations !== 0 ||
      evidence.inflightReadbackComplete !== true || evidence.provisioningScriptsQuiesced !== true ||
      !Array.isArray(evidence.inflightOperations) || evidence.inflightOperations.length !== 0 ||
      !Array.isArray(evidence.provisioningScripts) ||
      evidence.provisioningScripts.some(item => item?.state !== 'quiesced') ||
      !Array.isArray(evidence.services) || !Array.isArray(evidence.reachableRoutes) ||
      !Array.isArray(evidence.serviceAccountInventory) ||
      !same(evidence.services.map(item => item.name), reviewedDeployment.services.map(item => item.name)) ||
      !same(evidence.serviceAccountInventory, reviewedDeployment.serviceAccounts) ||
      !Object.keys(EXPECTED_ROLES).every(account => reviewedDeployment.serviceAccounts.includes(account)) ||
      !evidence.readbackRefs || evidence.readbackRefs.rulesRelease !== evidence.rulesRelease ||
      !evidence.rulesRelease || evidence.readbackRefs.projectIamEtag !== evidence.projectPolicy?.etag ||
      !evidence.projectPolicy?.etag ||
      evidence.readbackRefs.serviceInventoryDigest !== digest(evidence.services) ||
      evidence.readbackRefs.serviceAccountInventoryDigest !== digest(evidence.serviceAccountInventory) ||
      evidence.readbackRefs.routeProbeDigest !== digest(evidence.reachableRoutes) ||
      evidence.readbackRefs.inflightLedgerDigest !== digest(evidence.inflightOperations) ||
      evidence.readbackRefs.scriptInventoryDigest !== digest(evidence.provisioningScripts)) fail();
  const reviewedRoutes = [];
  for (const service of evidence.services) {
    const expected = reviewedDeployment.services.find(item => item.name === service.name);
    if (!expected || (REQUIRED_SERVICES[service.name] && expected.serviceAccount !== REQUIRED_SERVICES[service.name]) ||
        service.serviceAccount !== expected.serviceAccount || service.readyRevision !== service.servingRevision ||
        service.trafficPercent !== 100 || !service.resourceEtag ||
        !IMAGE.test(service.imageDigest || '') || !HASH.test(service.sourceFingerprint || '') ||
        !Array.isArray(expected.allowedRevisions) || expected.allowedRevisions.length === 0 ||
        !expected.allowedRevisions.some(revision => revision.name === service.servingRevision &&
          revision.imageDigest === service.imageDigest && revision.sourceFingerprint === service.sourceFingerprint &&
          digest(revision.environment) === digest(service.environment)) ||
        !Array.isArray(expected.routes) || !expected.routes.length ||
        !expected.routes.every(route => route?.service === service.name && route.method && route.path)) fail();
    if (service.name === 'ownerresetlegacypin' && service.environment?.LEGACY_PIN_RESET_ENABLED !== 'false') fail();
    if (service.name !== 'ownerresetlegacypin' &&
        WRITER_GATES.some(gate => service.environment?.[gate] !== 'false')) fail();
    reviewedRoutes.push(...expected.routes);
  }
  if (!same(reviewedRoutes.map(routeKey), evidence.reachableRoutes.map(routeKey)) ||
      new Set(reviewedRoutes.map(routeKey)).size !== reviewedRoutes.length ||
      new Set(evidence.reachableRoutes.map(routeKey)).size !== evidence.reachableRoutes.length) fail();
  for (const route of evidence.reachableRoutes) {
    const service = evidence.services.find(item => item.name === route.service);
    if (route.reachable !== true || route.servingRevision !== service?.servingRevision ||
        !Number.isInteger(route.httpStatus) || route.httpStatus < 200 || route.httpStatus >= 500 ||
        route.httpStatus === 404) fail();
  }
  const applicationMembers = Object.keys(EXPECTED_ROLES).map(principal => `serviceAccount:${principal}`);
  for (const [principal, expectedRoles] of Object.entries(EXPECTED_ROLES)) {
    const member = `serviceAccount:${principal}`;
    const bindings = (evidence.projectPolicy?.bindings || []).filter(item => item.members?.includes(member));
    if (!same(bindings.map(item => item.role), expectedRoles)) fail();
    for (const binding of bindings) {
      if ((binding.condition?.expression || null) !== (EXPECTED_CONDITIONS[binding.role] || null) ||
          !same(evidence.roles?.[binding.role]?.includedPermissions || [], EXPECTED_PERMISSIONS[binding.role] || [])) fail();
    }
    if (!evidence.serviceAccountPolicies?.[principal] ||
        (evidence.serviceAccountPolicies[principal].bindings || []).some(binding =>
          !Array.isArray(binding.members) || binding.members.some(value =>
            applicationMembers.includes(value) || !reviewedDeployment.operatorBreakGlassPrincipals.includes(value)))) fail();
  }
  if (!same(Object.keys(evidence.serviceAccountPolicies || {}), reviewedDeployment.serviceAccounts)) fail();
  for (const account of reviewedDeployment.serviceAccounts) {
    if (!Array.isArray(evidence.serviceAccountPolicies[account]?.bindings) ||
        evidence.serviceAccountPolicies[account].bindings.some(binding => !Array.isArray(binding.members) ||
          binding.members.some(member => applicationMembers.includes(member) ||
            !reviewedDeployment.operatorBreakGlassPrincipals.includes(member)))) fail();
  }
  const dangerous = /^(?:firebaseauth\.users\.(?:create|import|delete)|firebasedatabase\.instances\.update|datastore\.entities\.(?:create|update|delete)|iam\.(?:serviceAccounts\.(?:actAs|getAccessToken|signBlob|signJwt|setIamPolicy)|roles\.(?:create|update|delete))|resourcemanager\.projects\.setIamPolicy|run\.services\.(?:create|update|delete)|cloudfunctions\.functions\.(?:create|update|delete)|firebaserules\.releases\.create)$/u;
  for (const binding of evidence.projectPolicy.bindings || []) {
    const permissions = evidence.roles?.[binding.role]?.includedPermissions;
    if (!Array.isArray(permissions) || !Array.isArray(binding.members)) fail();
    if (!permissions.some(permission => dangerous.test(permission))) continue;
    for (const member of binding.members) {
      const known = member.startsWith('serviceAccount:') &&
        Object.hasOwn(EXPECTED_ROLES, member.slice('serviceAccount:'.length));
      if (!known && !reviewedDeployment.operatorBreakGlassPrincipals.includes(member)) fail();
    }
  }
  // Rules do not govern Admin SDK. This evidence must come from live IAM/Rules/service
  // readback at a future, separately authorized cutover; emulator tests cannot qualify it.
  return Object.freeze({ schemaVersion: 1, kind: 'verified-permanent-writer-closure',
    policyDigest: policy.policyDigest, rulesDigest, reviewedDeploymentDigest: approvedReviewDigest,
    evidenceDigest: digest({ evidence, approvedReviewDigest }), capturedAt: evidence.capturedAt,
    serviceInventoryDigest: digest(evidence.services), routeProbeDigest: digest(evidence.reachableRoutes),
    reachableRouteKeys: Object.freeze(evidence.reachableRoutes.map(routeKey).sort()) });
}
module.exports = Object.freeze({ REQUIRED_SERVICES, TRACKED_DEPLOYERS, verifyPermanentWriterClosure });
