'use strict';
const crypto = require('node:crypto');
const policy = require('../../functions/production/permanent-legacy-allocation-policy.json');
const { SERVICE_ACCOUNTS, EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS } =
  require('./legacy-slot-reconciliation-boundary.cjs');

function same(a, b) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
function verifyPermanentWriterClosure(evidence) {
  const fail = () => { throw new Error('writer-closure/unqualified'); };
  if (!evidence || typeof evidence !== 'object') fail();
  const rulesDigest = crypto.createHash('sha256').update(`${JSON.stringify(evidence.deployedRules, null, 2)}\n`).digest('hex');
  if (rulesDigest !== policy.candidateRulesSha256 || evidence.iamInventoryComplete !== true ||
      !Array.isArray(evidence.operatorBreakGlassPrincipals) ||
      evidence.pendingLegacyAllocations !== 0 ||
      evidence.inflightReadbackComplete !== true || evidence.provisioningScriptsQuiesced !== true ||
      !Array.isArray(evidence.services) || !same(evidence.services.map(item => item.name), Object.keys(SERVICE_ACCOUNTS))) fail();
  for (const service of evidence.services) {
    if (service.serviceAccount !== SERVICE_ACCOUNTS[service.name] || service.readyRevision !== service.servingRevision ||
        service.trafficPercent !== 100) fail();
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
            applicationMembers.includes(value) || !evidence.operatorBreakGlassPrincipals.includes(value)))) fail();
  }
  const dangerous = /^(?:firebaseauth\.users\.(?:create|import|delete)|firebasedatabase\.instances\.update|datastore\.entities\.(?:create|update|delete)|iam\.serviceAccounts\.(?:actAs|getAccessToken|signBlob|signJwt)|firebaserules\.releases\.create)$/u;
  for (const binding of evidence.projectPolicy.bindings || []) {
    const permissions = evidence.roles?.[binding.role]?.includedPermissions;
    if (!Array.isArray(permissions) || !Array.isArray(binding.members)) fail();
    if (!permissions.some(permission => dangerous.test(permission))) continue;
    for (const member of binding.members) {
      const known = member.startsWith('serviceAccount:') &&
        Object.hasOwn(EXPECTED_ROLES, member.slice('serviceAccount:'.length));
      if (!known && !evidence.operatorBreakGlassPrincipals.includes(member)) fail();
    }
  }
  // Rules do not govern Admin SDK. This evidence must come from live IAM/Rules/service
  // readback at a future, separately authorized cutover; emulator tests cannot qualify it.
  return Object.freeze({ policyDigest: policy.policyDigest, rulesDigest,
    evidenceDigest: crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    applicationWriterClosureVerified: true });
}
module.exports = Object.freeze({ verifyPermanentWriterClosure });
