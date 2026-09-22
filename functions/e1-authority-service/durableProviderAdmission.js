'use strict';

const crypto = require('node:crypto');
// Pinned to the reviewed, undeployed permanent Rules/policy candidate. A policy
// revision must update this constant and its source/Rules digest tests together.
const POLICY_DIGEST = 'debda873f5d19714a7cc47aeb80befdff093cfd997d124448b02a962621b57a7';

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const GENERATION_FIELDS = Object.freeze([
  'schemaVersion', 'state', 'generationId', 'normalizationVersion', 'inventoryEvidenceDigest',
  'coveredHandleKeysDigest', 'protectedClaimsDigest', 'coveredHandleCount', 'heldHandleCount',
  'writerPolicyDigest', 'writerClosureEvidenceDigest', 'sealedAt'
]);
const CONTROL_FIELDS = Object.freeze([
  'schemaVersion', 'state', 'generationId', 'generationDigest', 'writerPolicyDigest',
  'writerClosureEvidenceDigest', 'activatedAt', 'invalidatedAt', 'operatorSignature'
]);

function exact(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...fields].sort().join('\n');
}
function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function digest(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function validGeneration(value) {
  return exact(value, GENERATION_FIELDS) && value.schemaVersion === 1 && value.state === 'sealed' &&
    ID.test(value.generationId) && value.normalizationVersion === 1 &&
    [value.inventoryEvidenceDigest, value.coveredHandleKeysDigest, value.protectedClaimsDigest,
      value.writerPolicyDigest, value.writerClosureEvidenceDigest].every(item => HASH.test(item || '')) &&
    value.writerPolicyDigest === POLICY_DIGEST && Number.isSafeInteger(value.coveredHandleCount) &&
    value.coveredHandleCount >= 0 && Number.isSafeInteger(value.heldHandleCount) &&
    value.heldHandleCount >= 0 && value.heldHandleCount <= value.coveredHandleCount &&
    Number.isSafeInteger(value.sealedAt) && value.sealedAt > 0;
}
function validAdmission(control, generation, publicKey, now, expectedGenerationId) {
  if (!validGeneration(generation) || !exact(control, CONTROL_FIELDS) || control.schemaVersion !== 1 ||
      control.state !== 'active' || control.invalidatedAt !== null ||
      control.generationId !== generation.generationId || control.generationId !== expectedGenerationId ||
      control.generationDigest !== digest(generation) ||
      control.writerPolicyDigest !== POLICY_DIGEST ||
      control.writerClosureEvidenceDigest !== generation.writerClosureEvidenceDigest ||
      !Number.isSafeInteger(control.activatedAt) || control.activatedAt < generation.sealedAt ||
      control.activatedAt > now || typeof control.operatorSignature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/u.test(control.operatorSignature) || !publicKey) return false;
  try {
    const { operatorSignature, ...signed } = control;
    return crypto.verify(null, Buffer.from(canonicalJson(signed)), publicKey,
      Buffer.from(operatorSignature, 'base64url'));
  } catch { return false; }
}

module.exports = Object.freeze({ POLICY_DIGEST, GENERATION_FIELDS, CONTROL_FIELDS, canonicalJson, digest,
  validGeneration, validAdmission });
