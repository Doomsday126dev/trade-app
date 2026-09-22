'use strict';
const { POLICY_DIGEST } = require('../../functions/e1-authority-service/durableProviderAdmission');
const policy = require('../../functions/production/permanent-legacy-allocation-policy.json');
const STAGES = Object.freeze([
  'disabled', 'legacy-writers-blocked', 'inflight-accounted', 'names-protected',
  'permanent-writers-closed', 'generation-sealed', 'temporary-admission-invalidated',
  'durable-active', 'temporary-fence-ended'
]);
function advance(state, evidence) {
  const position = STAGES.indexOf(state);
  if (position < 0 || position === STAGES.length - 1 || !evidence || typeof evidence !== 'object') {
    throw new Error('transition/stage-invalid');
  }
  const next = STAGES[position + 1];
  const permanentClosureVerified = () => evidence.permanentRulesReadbackDigest === policy.candidateRulesSha256 &&
    evidence.privilegedIamReadbackComplete === true && evidence.privilegedAllocationPermissionsAbsent === true &&
    evidence.activeServiceRevisionReadbackComplete === true && evidence.legacyAllocationScriptsQuiesced === true;
  // Every transition must re-read the currently enforced barrier. An expired
  // temporary fence cannot qualify a later snapshot or sealed generation.
  if (position < STAGES.indexOf('permanent-writers-closed') ? evidence.temporaryRulesActive !== true :
      !permanentClosureVerified()) throw new Error(`transition/${next}-unqualified`);
  const checks = {
    'legacy-writers-blocked': () => evidence.temporaryRulesActive === true && evidence.browserAllocationDenied === true &&
      evidence.requestApprovalDenied === true && evidence.adminProvisioningPaused === true,
    'inflight-accounted': () => evidence.pendingLegacyAllocations === 0 && evidence.inflightReadbackComplete === true,
    'names-protected': () => evidence.protectionPlanComplete === true && evidence.exactSetReadback === true &&
      evidence.normalizationVersion === 1,
    'permanent-writers-closed': permanentClosureVerified,
    'generation-sealed': () => evidence.operatorSealedGeneration === true && evidence.generationMatchesExactCoverage === true &&
      evidence.generationPolicyDigest === POLICY_DIGEST,
    'temporary-admission-invalidated': () => evidence.boundedCertificationInvalidated === true &&
      evidence.boundedInFlightAccounted === true,
    'durable-active': () => evidence.operatorSignedActiveGeneration === true &&
      evidence.durableRuntimeGateQualified === true && evidence.providerCreationGateQualified === true,
    'temporary-fence-ended': () => evidence.permanentRulesStillActive === true &&
      evidence.oldClientAllocationStillDenied === true && evidence.providerCreationReadbackHealthy === true
  };
  if (!checks[next]()) throw new Error(`transition/${next}-unqualified`);
  return next;
}
function rollback(stage, providerAccountsExist) {
  if (!STAGES.includes(stage) || typeof providerAccountsExist !== 'boolean') throw new Error('transition/rollback-input-invalid');
  return Object.freeze(providerAccountsExist ? {
    creationEnabled: false, preserveProviderCompatibility: true, preserveGoogleAndPinEntry: true,
    preserveProviderSubjectKeys: true, preservePermanentLegacyClosure: true,
    deleteProviderAccounts: false
  } : {
    creationEnabled: false, preserveProviderCompatibility: false, preserveGoogleAndPinEntry: true,
    preservePermanentLegacyClosure: stage === 'permanent-writers-closed' || STAGES.indexOf(stage) > STAGES.indexOf('permanent-writers-closed'),
    deleteProviderAccounts: false
  });
}
module.exports = Object.freeze({ STAGES, advance, rollback });
