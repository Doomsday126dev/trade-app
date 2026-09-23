'use strict';
const crypto = require('node:crypto');
const { POLICY_DIGEST, digest, validGeneration, validAdmission } =
  require('../../functions/e1-authority-service/durableProviderAdmission');
const policy = require('../../functions/production/permanent-legacy-allocation-policy.json');
const temporaryContract = require('../../functions/production/legacy-provisioning-contract.json');
const { verifyProtection } = require('./protected-legacy-namespace.cjs');
const { verifyPermanentWriterClosure } = require('./permanent-legacy-writer-closure.cjs');
const safeDigest = value => { try { return digest(value); } catch { return null; } };
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
  const deny = () => { throw new Error(`transition/${next}-unqualified`); };
  let closure = null;
  if (position < STAGES.indexOf('permanent-writers-closed')) {
    const barrier = evidence.temporaryBarrier;
    const rulesDigest = crypto.createHash('sha256').update(`${JSON.stringify(barrier?.rules, null, 2)}\n`).digest('hex');
    const freeze = barrier?.freeze;
    if (rulesDigest !== temporaryContract.candidateRulesSha256 ||
        barrier?.rulesRelease !== barrier?.readbackRefs?.rulesRelease || !barrier?.rulesRelease ||
        barrier?.readbackRefs?.freezeDigest !== safeDigest(freeze) ||
        barrier?.readbackRefs?.scriptInventoryDigest !== safeDigest(barrier?.provisioningScripts) ||
        !Array.isArray(barrier?.provisioningScripts) ||
        barrier.provisioningScripts.some(script => script?.state !== 'quiesced') ||
        freeze?.schemaVersion !== 1 || freeze?.state !== 'active' || freeze?.releasedAt !== null ||
        freeze?.provisioningContractDigest !== temporaryContract.provisioningContractDigest ||
        !Number.isSafeInteger(barrier.capturedAt) || freeze.activatedAt > barrier.capturedAt) deny();
  }
  if (next === 'permanent-writers-closed' || position >= STAGES.indexOf('permanent-writers-closed')) {
    try { closure = verifyPermanentWriterClosure(evidence.writerEvidence, {
      reviewedDeployment: evidence.reviewedDeployment, approvedReviewDigest: evidence.approvedReviewDigest }); }
    catch { deny(); }
  }
  if (next === 'inflight-accounted' && (!Array.isArray(evidence.legacyOperations) ||
      evidence.legacyOperations.length !== 0 ||
      evidence.legacyOperationsDigest !== safeDigest(evidence.legacyOperations))) deny();
  if (next === 'names-protected' && !verifyProtection(evidence.protectionPlan,
    evidence.protectedClaimsReadback)) deny();
  if (next === 'generation-sealed' && (!validGeneration(evidence.generation) ||
      evidence.generation.writerPolicyDigest !== POLICY_DIGEST ||
      evidence.generation.writerClosureEvidenceDigest !== closure.evidenceDigest ||
      evidence.generation.coveredHandleKeysDigest !== evidence.protectionPlan?.coveredHandleKeysDigest ||
      evidence.generation.protectedClaimsDigest !== evidence.protectionPlan?.protectedClaimsDigest ||
      !verifyProtection(evidence.protectionPlan, evidence.protectedClaimsReadback))) deny();
  if (next === 'temporary-admission-invalidated' && (evidence.boundedCertification !== null ||
      !Array.isArray(evidence.boundedInFlightOperations) || evidence.boundedInFlightOperations.length !== 0 ||
      evidence.boundedInFlightDigest !== safeDigest(evidence.boundedInFlightOperations))) deny();
  if ((next === 'durable-active' || next === 'temporary-fence-ended') && (!validAdmission(evidence.control, evidence.generation,
      evidence.runtimePublicKey, evidence.writerEvidence?.capturedAt, evidence.runtimeConfiguration?.DURABLE_ADMISSION_GENERATION_ID) ||
      evidence.runtimeConfiguration?.CREATE_PROVIDER_ACCOUNT_ENABLED !== 'true' ||
      evidence.runtimeConfiguration?.DURABLE_PROVIDER_ADMISSION_ENABLED !== 'true' ||
      evidence.runtimeConfigurationDigest !== safeDigest(evidence.runtimeConfiguration) ||
      evidence.generation.writerClosureEvidenceDigest !== closure.evidenceDigest)) deny();
  if (next === 'temporary-fence-ended' &&
      (evidence.temporaryBarrier?.freeze?.state !== 'released' ||
       evidence.temporaryBarrier?.readbackRefs?.freezeDigest !== safeDigest(evidence.temporaryBarrier.freeze) ||
       evidence.temporaryBarrier?.readbackRefs?.rulesRelease !== evidence.temporaryBarrier?.rulesRelease ||
       evidence.temporaryBarrier.freeze.releasedAt <= evidence.temporaryBarrier.freeze.activatedAt ||
       evidence.providerSmoke?.status !== 'SUCCESS' || evidence.providerSmoke?.appCheckCode !== 'app-check/initialized' ||
       evidence.providerSmokeDigest !== safeDigest(evidence.providerSmoke) || closure.rulesDigest !== policy.candidateRulesSha256)) deny();
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
// Invalidation is safe against restoration of the old signed pointer only after
// every reachable serving revision has stopped creation and rejected its pin.
// This is an operator readback requirement, not a Firestore IAM restriction.
function verifyRevocationBarrier({ oldGenerationId, replacementGenerationId, writerEvidence,
  reviewedDeployment, approvedReviewDigest, servingRoutes, routeReadbackDigest } = {}) {
  let closure;
  try { closure = verifyPermanentWriterClosure(writerEvidence, { reviewedDeployment, approvedReviewDigest }); }
  catch { return false; }
  const expectedRouteKeys = closure.reachableRouteKeys;
  if (!oldGenerationId || !replacementGenerationId || replacementGenerationId === oldGenerationId ||
      !Array.isArray(expectedRouteKeys) || expectedRouteKeys.length === 0 ||
      !Array.isArray(servingRoutes) || servingRoutes.length !== expectedRouteKeys.length ||
      new Set(expectedRouteKeys).size !== expectedRouteKeys.length ||
      expectedRouteKeys.some(key => !servingRoutes.some(route => `${route.service}:${route.method}:${route.path}` === key)) ||
      routeReadbackDigest !== safeDigest(servingRoutes)) return false;
  return servingRoutes.every(route => route?.reachable === true && route?.revision && route?.sourceFingerprint &&
    route?.configuration?.CREATE_PROVIDER_ACCOUNT_ENABLED === 'false' &&
    route?.configuration?.DURABLE_ADMISSION_GENERATION_ID === replacementGenerationId);
}
module.exports = Object.freeze({ STAGES, advance, rollback, verifyRevocationBarrier });
