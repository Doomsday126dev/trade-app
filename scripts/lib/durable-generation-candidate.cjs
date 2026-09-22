'use strict';
const crypto = require('node:crypto');
const { POLICY_DIGEST, canonicalJson, digest, validGeneration, validAdmission } =
  require('../../functions/e1-authority-service/durableProviderAdmission');
const { verifyProtection } = require('./protected-legacy-namespace.cjs');
const { verifyPermanentWriterClosure } = require('./permanent-legacy-writer-closure.cjs');

function sealGeneration({ plan, protectedClaimsReadback, writerEvidence, generationId, sealedAt }) {
  if (!verifyProtection(plan, protectedClaimsReadback)) throw new Error('generation/coverage-unqualified');
  const closure = verifyPermanentWriterClosure(writerEvidence);
  const generation = {
    schemaVersion: 1, state: 'sealed', generationId, normalizationVersion: 1,
    inventoryEvidenceDigest: plan.inventoryEvidenceDigest,
    coveredHandleKeysDigest: plan.coveredHandleKeysDigest,
    protectedClaimsDigest: plan.protectedClaimsDigest,
    coveredHandleCount: plan.coveredHandleCount,
    heldHandleCount: plan.heldHandleCount,
    writerPolicyDigest: POLICY_DIGEST,
    writerClosureEvidenceDigest: closure.evidenceDigest,
    sealedAt
  };
  if (!validGeneration(generation)) throw new Error('generation/input-invalid');
  return Object.freeze(generation);
}

function signActiveGeneration({ generation, activatedAt, privateKey }) {
  if (!validGeneration(generation) || !Number.isSafeInteger(activatedAt) || activatedAt < generation.sealedAt) {
    throw new Error('generation/activation-invalid');
  }
  const key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('generation/operator-key-invalid');
  const control = {
    schemaVersion: 1, state: 'active', generationId: generation.generationId,
    generationDigest: digest(generation), writerPolicyDigest: POLICY_DIGEST,
    writerClosureEvidenceDigest: generation.writerClosureEvidenceDigest,
    activatedAt, invalidatedAt: null
  };
  const result = { ...control, operatorSignature: crypto.sign(null,
    Buffer.from(canonicalJson(control)), key).toString('base64url') };
  if (!validAdmission(result, generation, crypto.createPublicKey(key), activatedAt, generation.generationId)) {
    throw new Error('generation/signature-invalid');
  }
  return Object.freeze(result);
}
module.exports = Object.freeze({ sealGeneration, signActiveGeneration });
