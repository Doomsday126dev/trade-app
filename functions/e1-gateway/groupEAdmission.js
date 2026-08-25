'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const ENVIRONMENT = 'production';
const PROJECT_ID = 'trade-list-a4297';
const MODE = 'synthetic-canary';
const SLOTS = Object.freeze(['A', 'B']);
const HASH = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const REVISION = /^e1-identity-authority-[0-9]{5}-[a-z0-9]{3}$/u;
const IMAGE = /^sha256:[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const RUN_RECORD_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'environment', 'projectId', 'runId', 'approvalGroup', 'mode', 'slots', 'bindings',
  'cohortDigest', 'firebaseAppIdHash', 'keyId', 'publicKeySpki', 'provenance', 'd3CloseoutDigest',
  'identityBaseline', 'admissionEvidenceDigest', 'preCallReplayLedgerDigest', 'initialExecutionLedgerDigest',
  'issuedAt', 'expiresAt', 'maxAdmittedClaims', 'manifestDigest'
]);
const PROVENANCE_FIELDS = Object.freeze([
  'toolingSourceSha', 'pagesReleaseId', 'pagesSourceSha', 'pagesArtifactDigest', 'gatewaySourceSha',
  'gatewaySourceFingerprint', 'authorityRevision', 'authorityImageDigest'
]);
const BINDING_FIELDS = Object.freeze(['uidHash', 'trainerHash']);
const BASELINE_FIELDS = Object.freeze([
  'totalDocuments', 'accounts', 'trainerHandles', 'rateLimits', 'operationRequests', 'identityMigrations',
  'identityConflicts', 'stateDigest'
]);
const CAPABILITY_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'environment', 'projectId', 'runId', 'slot', 'jti', 'uidHash', 'trainerHash',
  'cohortDigest', 'generationId', 'sessionGeneration', 'attemptHash', 'firebaseAppIdHash', 'browserContextDigest',
  'runtimeInstanceDigest', 'sessionGenerationDigest', 'toolingSourceSha', 'pagesReleaseId', 'pagesSourceSha', 'pagesArtifactDigest',
  'gatewaySourceSha', 'gatewaySourceFingerprint', 'authorityRevision', 'authorityImageDigest', 'd3CloseoutDigest',
  'identityBaselineDigest', 'admissionEvidenceDigest', 'preCallReplayLedgerDigest', 'dispatchLedgerDigest',
  'issuedAt', 'expiresAt', 'remainingAdmittedCallBudget', 'runManifestDigest', 'keyId',
  'priorAReconciliationDigest', 'sessionBoundaryDigest'
]);
const SESSION_GENERATION_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'runId', 'cohortDigest', 'slot', 'uidHash', 'trainerHash',
  'generationId', 'sessionGeneration', 'firebaseAppIdHash', 'browserContextDigest', 'runtimeInstanceDigest'
]);
const SIGNED_REQUEST_FIELDS = Object.freeze(['schemaVersion', 'attemptId', 'capability', 'signature']);
const CONSUMPTION_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'slot', 'capabilityDigest', 'jtiHash', 'attemptHash', 'uidHash',
  'appIdHash', 'cohortDigest', 'keyId', 'createdAt', 'recordDigest'
]);
const RECEIPT_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'slot', 'capabilityDigest', 'consumptionRecordDigest', 'attemptHash',
  'uidHash', 'cohortDigest', 'keyId', 'receiptDigest'
]);
const FAMILY_COUNT_FIELDS = Object.freeze([
  'totalDocuments', 'accounts', 'trainerHandles', 'rateLimits', 'operationRequests', 'identityMigrations',
  'identityConflicts'
]);
const PROHIBITED_WRITE_FIELDS = Object.freeze([
  'phaseEIdentityWrites', 'rtdbWrites', 'ordinaryUserWrites', 'unexpectedControlWrites'
]);
const GATE_FIELDS = Object.freeze([
  'CLIENT_FOUNDATION_USE_ENABLED', 'GATEWAY_INVOCATION_ENABLED', 'READ_ACCOUNT_FOUNDATION_ENABLED',
  'RESERVE_HANDLE_ENABLED', 'REPAIR_FOUNDATION_ENABLED', 'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED', 'READ_PROOF_MODE'
]);
const SECURITY_FIELDS = Object.freeze([
  'authorityPrivate', 'gatewayOnlyInvoker', 'projectWideInvoker', 'gatewayForbiddenRolesPresent', 'iamDrift',
  'productionDebugTokensRegistered', 'providerLinkRoutePresent', 'controlDatabaseRules'
]);
const RECONCILIATION_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'slot', 'consumptionRecordDigest', 'admissionReceiptDigest',
  'gatewayRecordDigest', 'authorityRecordDigest', 'responseDigest', 'resultDigest', 'resultCode',
  'foundationStatus', 'identityBaselineDigest', 'familyCounts', 'prohibitedWrites', 'gates', 'securityBoundary',
  'runtimeDigest', 'remainingAdmittedCallBudget', 'priorAReconciliationDigest', 'sessionBoundaryDigest',
  'createdAt', 'reconciliationDigest'
]);
const CLOSEOUT_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'outcome', 'bReconciliationDigest', 'blockedReason',
  'restorationDigest', 'finalStateDigest', 'observationDigest', 'observationStartedAt', 'observationEndedAt',
  'observationAccepted',
  'unexpectedAdditionalAdmittedCalls', 'prohibitedWrites', 'createdAt', 'closeoutDigest'
]);
const PRE_ENABLE_ABORT_FIELDS = Object.freeze([
  'schemaVersion', 'recordType', 'runId', 'runManifestDigest', 'executionLedgerDigest', 'reason', 'gates',
  'prohibitedWrites', 'aDispatchAbsent', 'consumptionsAbsent', 'reconciliationsAbsent', 'createdAt', 'abortDigest'
]);
const PRE_ENABLE_ABORT_REASONS = Object.freeze([
  'TIMING_EXPIRED_BEFORE_ENABLEMENT',
  'OPERATOR_ABORTED_BEFORE_ENABLEMENT'
]);
const MIN_PASSIVE_OBSERVATION_MS = 30 * 60 * 1000;
const MAX_PASSIVE_OBSERVATION_MS = 75 * 60 * 1000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestArray(domain, values) {
  return sha256(Buffer.from(JSON.stringify([SCHEMA_VERSION, domain, ...values]), 'utf8'));
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseSpki(value) {
  if (typeof value !== 'string' || value.length < 40 || value.length > 256 || !BASE64URL.test(value)) {
    fail('GROUP_E_PUBLIC_KEY_INVALID');
  }
  let bytes;
  try { bytes = Buffer.from(value, 'base64url'); } catch { fail('GROUP_E_PUBLIC_KEY_INVALID'); }
  if (!bytes.length || bytes.toString('base64url') !== value) fail('GROUP_E_PUBLIC_KEY_INVALID');
  let key;
  try { key = crypto.createPublicKey({ key: bytes, format: 'der', type: 'spki' }); }
  catch { fail('GROUP_E_PUBLIC_KEY_INVALID'); }
  if (key.asymmetricKeyType !== 'ed25519') fail('GROUP_E_PUBLIC_KEY_INVALID');
  return Object.freeze({ bytes, key });
}

function keyIdFromSpki(publicKeySpki) {
  const { bytes } = parseSpki(publicKeySpki);
  return crypto.createHash('sha256').update('group-e-ed25519-key-id-v1\0', 'utf8').update(bytes).digest('hex');
}

function validBindings(value) {
  return exactFields(value, SLOTS) && SLOTS.every((slot) => exactFields(value[slot], BINDING_FIELDS) &&
    HASH.test(value[slot].uidHash || '') && HASH.test(value[slot].trainerHash || '')) &&
    value.A.uidHash !== value.B.uidHash && value.A.trainerHash !== value.B.trainerHash;
}

function validProvenance(value) {
  return exactFields(value, PROVENANCE_FIELDS) && GIT_SHA.test(value.toolingSourceSha || '') &&
    RELEASE_ID.test(value.pagesReleaseId || '') && GIT_SHA.test(value.pagesSourceSha || '') &&
    HASH.test(value.pagesArtifactDigest || '') && GIT_SHA.test(value.gatewaySourceSha || '') &&
    HASH.test(value.gatewaySourceFingerprint || '') && REVISION.test(value.authorityRevision || '') &&
    IMAGE.test(value.authorityImageDigest || '');
}

function validBaseline(value) {
  return exactFields(value, BASELINE_FIELDS) && value.totalDocuments === 32 && value.accounts === 8 &&
    value.trainerHandles === 8 && value.rateLimits === 8 && value.operationRequests === 8 &&
    value.identityMigrations === 0 && value.identityConflicts === 0 && HASH.test(value.stateDigest || '');
}

function baselineDigest(value) {
  if (!validBaseline(value)) fail('GROUP_E_IDENTITY_BASELINE_INVALID');
  return digestArray('group-e-identity-baseline', BASELINE_FIELDS.map((field) => value[field]));
}

function runManifestDigest(value) {
  return digestArray('group-e-run-manifest', [
    value.schemaVersion, value.recordType, value.environment, value.projectId, value.runId, value.approvalGroup, value.mode,
    value.slots, SLOTS.flatMap((slot) => [slot, value.bindings[slot].uidHash, value.bindings[slot].trainerHash]),
    value.cohortDigest, value.firebaseAppIdHash, value.keyId, value.publicKeySpki,
    PROVENANCE_FIELDS.map((field) => value.provenance[field]), value.d3CloseoutDigest,
    BASELINE_FIELDS.map((field) => value.identityBaseline[field]), value.admissionEvidenceDigest,
    value.preCallReplayLedgerDigest, value.initialExecutionLedgerDigest, value.issuedAt, value.expiresAt,
    value.maxAdmittedClaims
  ]);
}

function validateRunManifest(value, options = {}) {
  const issued = Date.parse(value?.issuedAt);
  const expires = Date.parse(value?.expiresAt);
  if (!exactFields(value, RUN_RECORD_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-run' || value.environment !== ENVIRONMENT || value.projectId !== PROJECT_ID ||
      !UUID_V4.test(value.runId || '') || value.approvalGroup !== 'E' || value.mode !== MODE ||
      JSON.stringify(value.slots) !== JSON.stringify(SLOTS) ||
      !validBindings(value.bindings) || !HASH.test(value.cohortDigest || '') || !HASH.test(value.firebaseAppIdHash || '') ||
      value.keyId !== keyIdFromSpki(value.publicKeySpki) || !validProvenance(value.provenance) ||
      !HASH.test(value.d3CloseoutDigest || '') || !validBaseline(value.identityBaseline) ||
      !HASH.test(value.admissionEvidenceDigest || '') || !HASH.test(value.preCallReplayLedgerDigest || '') ||
      !HASH.test(value.initialExecutionLedgerDigest || '') || !Number.isFinite(issued) || !Number.isFinite(expires) ||
      issued >= expires || expires - issued > 45 * 60 * 1000 || value.maxAdmittedClaims !== 2 ||
      !HASH.test(value.manifestDigest || '') || value.manifestDigest !== runManifestDigest(value)) {
    fail('GROUP_E_RUN_INVALID');
  }
  if (options.expectedManifestDigest && value.manifestDigest !== options.expectedManifestDigest) fail('GROUP_E_RUN_MISMATCH');
  if (options.now !== undefined && (!Number.isFinite(options.now) || options.now < issued || options.now >= expires)) {
    fail('GROUP_E_RUN_EXPIRED');
  }
  return Object.freeze(structuredClone(value));
}

function createRunManifest(value) {
  const manifest = { ...structuredClone(value), schemaVersion: SCHEMA_VERSION, recordType: 'group-e-run',
    environment: ENVIRONMENT, projectId: PROJECT_ID, approvalGroup: 'E', mode: MODE, slots: [...SLOTS],
    keyId: keyIdFromSpki(value.publicKeySpki), maxAdmittedClaims: 2, manifestDigest: null };
  manifest.manifestDigest = runManifestDigest(manifest);
  return validateRunManifest(manifest);
}

function attemptHash(attemptId) {
  if (!UUID_V4.test(attemptId || '')) fail('GROUP_E_ATTEMPT_INVALID');
  return digestArray('group-e-client-attempt', [attemptId]);
}

function appIdHash(appId) {
  if (typeof appId !== 'string' || !appId || appId.length > 256) fail('GROUP_E_APP_ID_INVALID');
  return digestArray('group-e-firebase-app-id', [appId]);
}

function subjectHash(kind, value) {
  if (!['uid', 'trainer'].includes(kind) || typeof value !== 'string' || !value) fail('GROUP_E_SUBJECT_INVALID');
  return digestArray('group-e-client-foundation', [kind, value]);
}

function sessionGenerationContext(value) {
  return Object.fromEntries(SESSION_GENERATION_FIELDS.map((field) => [field, value?.[field]]));
}

function sessionGenerationDigest(value) {
  if (!exactFields(value, SESSION_GENERATION_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.environment !== ENVIRONMENT || value.projectId !== PROJECT_ID || !UUID_V4.test(value.runId || '') ||
      !HASH.test(value.cohortDigest || '') || !SLOTS.includes(value.slot) || !HASH.test(value.uidHash || '') ||
      !HASH.test(value.trainerHash || '') || !UUID_V4.test(value.generationId || '') ||
      !Number.isSafeInteger(value.sessionGeneration) || value.sessionGeneration < 0 ||
      !HASH.test(value.firebaseAppIdHash || '') || !HASH.test(value.browserContextDigest || '') ||
      !HASH.test(value.runtimeInstanceDigest || '')) {
    fail('GROUP_E_SESSION_GENERATION_INVALID');
  }
  return digestArray('group-e-session-generation', SESSION_GENERATION_FIELDS.map((field) => value[field]));
}

function canonicalCapabilityArray(value) {
  return [
    SCHEMA_VERSION, 'group-e-admission-capability-ed25519', value.schemaVersion, value.recordType,
    value.environment, value.projectId, value.runId, value.slot, value.jti, value.uidHash, value.trainerHash,
    value.cohortDigest, value.generationId, value.sessionGeneration, value.attemptHash, value.firebaseAppIdHash,
    value.browserContextDigest, value.runtimeInstanceDigest, value.sessionGenerationDigest,
    value.toolingSourceSha, value.pagesReleaseId,
    value.pagesSourceSha, value.pagesArtifactDigest, value.gatewaySourceSha, value.gatewaySourceFingerprint,
    value.authorityRevision, value.authorityImageDigest, value.d3CloseoutDigest, value.identityBaselineDigest,
    value.admissionEvidenceDigest, value.preCallReplayLedgerDigest, value.dispatchLedgerDigest,
    value.issuedAt, value.expiresAt, value.remainingAdmittedCallBudget, value.runManifestDigest, value.keyId,
    value.priorAReconciliationDigest, value.sessionBoundaryDigest
  ];
}

function canonicalCapabilityBytes(value) {
  return Buffer.from(JSON.stringify(canonicalCapabilityArray(value)), 'utf8');
}

function capabilityDigest(value) {
  return sha256(canonicalCapabilityBytes(value));
}

function validateCapabilityShape(value, options = {}) {
  const issued = Date.parse(value?.issuedAt);
  const expires = Date.parse(value?.expiresAt);
  const slot = value?.slot;
  if (!exactFields(value, CAPABILITY_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-slot-capability' || value.environment !== ENVIRONMENT || value.projectId !== PROJECT_ID ||
      !UUID_V4.test(value.runId || '') || !SLOTS.includes(slot) || !UUID_V4.test(value.jti || '') ||
      !HASH.test(value.uidHash || '') || !HASH.test(value.trainerHash || '') || !HASH.test(value.cohortDigest || '') ||
      !UUID_V4.test(value.generationId || '') || !Number.isSafeInteger(value.sessionGeneration) ||
      value.sessionGeneration < 0 || !HASH.test(value.attemptHash || '') ||
      !HASH.test(value.firebaseAppIdHash || '') || !HASH.test(value.browserContextDigest || '') ||
      !HASH.test(value.runtimeInstanceDigest || '') || !HASH.test(value.sessionGenerationDigest || '') ||
      value.sessionGenerationDigest !== sessionGenerationDigest(sessionGenerationContext(value)) ||
      !GIT_SHA.test(value.toolingSourceSha || '') ||
      !RELEASE_ID.test(value.pagesReleaseId || '') || !GIT_SHA.test(value.pagesSourceSha || '') ||
      !HASH.test(value.pagesArtifactDigest || '') || !GIT_SHA.test(value.gatewaySourceSha || '') ||
      !HASH.test(value.gatewaySourceFingerprint || '') || !REVISION.test(value.authorityRevision || '') ||
      !IMAGE.test(value.authorityImageDigest || '') || !HASH.test(value.d3CloseoutDigest || '') ||
      !HASH.test(value.identityBaselineDigest || '') || !HASH.test(value.admissionEvidenceDigest || '') ||
      !HASH.test(value.preCallReplayLedgerDigest || '') || !HASH.test(value.dispatchLedgerDigest || '') ||
      !Number.isFinite(issued) || !Number.isFinite(expires) || issued >= expires || expires - issued > 15 * 60 * 1000 ||
      value.remainingAdmittedCallBudget !== (slot === 'A' ? 2 : 1) || !HASH.test(value.runManifestDigest || '') ||
      !HASH.test(value.keyId || '') || (slot === 'A' ? value.priorAReconciliationDigest !== null ||
        value.sessionBoundaryDigest !== null : !HASH.test(value.priorAReconciliationDigest || '') ||
        !HASH.test(value.sessionBoundaryDigest || ''))) {
    fail('GROUP_E_CAPABILITY_INVALID');
  }
  if (options.now !== undefined && (!Number.isFinite(options.now) || options.now < issued || options.now >= expires)) {
    fail('GROUP_E_CAPABILITY_EXPIRED');
  }
  return Object.freeze(structuredClone(value));
}

function validateCapabilityAgainstRun(value, run, options = {}) {
  const capability = validateCapabilityShape(value, options);
  const manifest = validateRunManifest(run, { expectedManifestDigest: capability.runManifestDigest, now: options.now });
  const binding = manifest.bindings[capability.slot];
  const provenance = manifest.provenance;
  if (capability.runId !== manifest.runId || capability.uidHash !== binding.uidHash ||
      capability.trainerHash !== binding.trainerHash ||
      capability.cohortDigest !== manifest.cohortDigest || capability.firebaseAppIdHash !== manifest.firebaseAppIdHash ||
      capability.keyId !== manifest.keyId || capability.toolingSourceSha !== provenance.toolingSourceSha ||
      capability.pagesReleaseId !== provenance.pagesReleaseId || capability.pagesSourceSha !== provenance.pagesSourceSha ||
      capability.pagesArtifactDigest !== provenance.pagesArtifactDigest ||
      capability.gatewaySourceSha !== provenance.gatewaySourceSha ||
      capability.gatewaySourceFingerprint !== provenance.gatewaySourceFingerprint ||
      capability.authorityRevision !== provenance.authorityRevision ||
      capability.authorityImageDigest !== provenance.authorityImageDigest ||
      capability.d3CloseoutDigest !== manifest.d3CloseoutDigest ||
      capability.identityBaselineDigest !== baselineDigest(manifest.identityBaseline) ||
      capability.admissionEvidenceDigest !== manifest.admissionEvidenceDigest ||
      capability.preCallReplayLedgerDigest !== manifest.preCallReplayLedgerDigest ||
      Date.parse(capability.issuedAt) < Date.parse(manifest.issuedAt) ||
      Date.parse(capability.expiresAt) > Date.parse(manifest.expiresAt)) {
    fail('GROUP_E_CAPABILITY_RUN_MISMATCH');
  }
  return capability;
}

function signatureBytes(signature) {
  if (typeof signature !== 'string' || signature.length !== 86 || !BASE64URL.test(signature)) {
    fail('GROUP_E_SIGNATURE_INVALID');
  }
  let bytes;
  try { bytes = Buffer.from(signature, 'base64url'); } catch { fail('GROUP_E_SIGNATURE_INVALID'); }
  if (bytes.length !== 64 || bytes.toString('base64url') !== signature) fail('GROUP_E_SIGNATURE_INVALID');
  return bytes;
}

function verifyCapabilitySignature(value, signature, publicKeySpki) {
  const capability = validateCapabilityShape(value);
  const { key } = parseSpki(publicKeySpki);
  if (!crypto.verify(null, canonicalCapabilityBytes(capability), key, signatureBytes(signature))) {
    fail('GROUP_E_SIGNATURE_INVALID');
  }
  return capability;
}

function validateSignedRequest(value) {
  if (!exactFields(value, SIGNED_REQUEST_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      !UUID_V4.test(value.attemptId || '') || !exactFields(value.capability, CAPABILITY_FIELDS) ||
      attemptHash(value.attemptId) !== value.capability.attemptHash) fail('REQUEST_INVALID');
  signatureBytes(value.signature);
  return Object.freeze(structuredClone(value));
}

function jtiHash(jti) {
  if (!UUID_V4.test(jti || '')) fail('GROUP_E_JTI_INVALID');
  return digestArray('group-e-capability-jti', [jti]);
}

function consumptionRecordDigest(value) {
  return digestArray('group-e-consumption-record', [
    value.schemaVersion, value.recordType, value.runId, value.slot, value.capabilityDigest, value.jtiHash,
    value.attemptHash, value.uidHash, value.appIdHash, value.cohortDigest, value.keyId, value.createdAt
  ]);
}

function createConsumptionRecord(value) {
  const record = { schemaVersion: SCHEMA_VERSION, recordType: 'group-e-consumption', ...structuredClone(value),
    recordDigest: null };
  record.recordDigest = consumptionRecordDigest(record);
  return validateConsumptionRecord(record);
}

function validateConsumptionRecord(value) {
  if (!exactFields(value, CONSUMPTION_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-consumption' || !UUID_V4.test(value.runId || '') || !SLOTS.includes(value.slot) ||
      !HASH.test(value.capabilityDigest || '') || !HASH.test(value.jtiHash || '') || !HASH.test(value.attemptHash || '') ||
      !HASH.test(value.uidHash || '') || !HASH.test(value.appIdHash || '') || !HASH.test(value.cohortDigest || '') ||
      !HASH.test(value.keyId || '') || !validTimestamp(value.createdAt) || !HASH.test(value.recordDigest || '') ||
      value.recordDigest !== consumptionRecordDigest(value)) fail('GROUP_E_CONSUMPTION_INVALID');
  return Object.freeze(structuredClone(value));
}

function admissionReceiptDigest(value) {
  return digestArray('group-e-admission-receipt', [
    value.schemaVersion, value.recordType, value.runId, value.slot, value.capabilityDigest,
    value.consumptionRecordDigest, value.attemptHash, value.uidHash, value.cohortDigest, value.keyId
  ]);
}

function createAdmissionReceipt(consumption) {
  const marker = validateConsumptionRecord(consumption);
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    recordType: 'group-e-admission-receipt',
    runId: marker.runId,
    slot: marker.slot,
    capabilityDigest: marker.capabilityDigest,
    consumptionRecordDigest: marker.recordDigest,
    attemptHash: marker.attemptHash,
    uidHash: marker.uidHash,
    cohortDigest: marker.cohortDigest,
    keyId: marker.keyId,
    receiptDigest: null
  };
  receipt.receiptDigest = admissionReceiptDigest(receipt);
  return validateAdmissionReceipt(receipt);
}

function validateAdmissionReceipt(value, context = {}) {
  if (!exactFields(value, RECEIPT_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-admission-receipt' || !UUID_V4.test(value.runId || '') ||
      !SLOTS.includes(value.slot) || !HASH.test(value.capabilityDigest || '') ||
      !HASH.test(value.consumptionRecordDigest || '') || !HASH.test(value.attemptHash || '') ||
      !HASH.test(value.uidHash || '') || !HASH.test(value.cohortDigest || '') || !HASH.test(value.keyId || '') ||
      !HASH.test(value.receiptDigest || '') || value.receiptDigest !== admissionReceiptDigest(value)) {
    fail('GROUP_E_RECEIPT_INVALID');
  }
  for (const [field, expected] of Object.entries(context)) {
    if (expected !== undefined && value[field] !== expected) fail('GROUP_E_RECEIPT_MISMATCH');
  }
  return Object.freeze(structuredClone(value));
}

function validFamilyCounts(value) {
  return exactFields(value, FAMILY_COUNT_FIELDS) && value.totalDocuments === 32 && value.accounts === 8 &&
    value.trainerHandles === 8 && value.rateLimits === 8 && value.operationRequests === 8 &&
    value.identityMigrations === 0 && value.identityConflicts === 0;
}

function validProhibitedWrites(value) {
  return exactFields(value, PROHIBITED_WRITE_FIELDS) && Object.values(value).every((count) => count === 0);
}

function validGates(value, enabled) {
  if (!exactFields(value, GATE_FIELDS)) return false;
  const expected = Object.fromEntries(GATE_FIELDS.map((field) => [field, enabled &&
    ['GATEWAY_INVOCATION_ENABLED', 'READ_ACCOUNT_FOUNDATION_ENABLED'].includes(field)]));
  return GATE_FIELDS.every((field) => value[field] === expected[field]);
}

function validSecurityBoundary(value) {
  return exactFields(value, SECURITY_FIELDS) && value.authorityPrivate === true && value.gatewayOnlyInvoker === true &&
    value.projectWideInvoker === false && value.gatewayForbiddenRolesPresent === false && value.iamDrift === false &&
    value.productionDebugTokensRegistered === false && value.providerLinkRoutePresent === false &&
    value.controlDatabaseRules === 'deny-all';
}

function reconciliationDigest(value) {
  return digestArray('group-e-control-reconciliation', [
    value.schemaVersion, value.recordType, value.runId, value.slot, value.consumptionRecordDigest,
    value.admissionReceiptDigest, value.gatewayRecordDigest, value.authorityRecordDigest, value.responseDigest,
    value.resultDigest, value.resultCode, value.foundationStatus, value.identityBaselineDigest,
    FAMILY_COUNT_FIELDS.map((field) => value.familyCounts[field]),
    PROHIBITED_WRITE_FIELDS.map((field) => value.prohibitedWrites[field]),
    GATE_FIELDS.map((field) => value.gates[field]), SECURITY_FIELDS.map((field) => value.securityBoundary[field]),
    value.runtimeDigest, value.remainingAdmittedCallBudget, value.priorAReconciliationDigest,
    value.sessionBoundaryDigest, value.createdAt
  ]);
}

function createReconciliationRecord(value) {
  const record = { schemaVersion: SCHEMA_VERSION, recordType: 'group-e-reconciliation', ...structuredClone(value),
    reconciliationDigest: null };
  record.reconciliationDigest = reconciliationDigest(record);
  return validateReconciliationRecord(record);
}

function validateReconciliationRecord(value) {
  const slot = value?.slot;
  if (!exactFields(value, RECONCILIATION_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-reconciliation' || !UUID_V4.test(value.runId || '') || !SLOTS.includes(slot) ||
      !HASH.test(value.consumptionRecordDigest || '') || !HASH.test(value.admissionReceiptDigest || '') ||
      !HASH.test(value.gatewayRecordDigest || '') || !HASH.test(value.authorityRecordDigest || '') ||
      !HASH.test(value.responseDigest || '') || !HASH.test(value.resultDigest || '') || value.resultCode !== 'SUCCESS' ||
      value.foundationStatus !== 'active' || !HASH.test(value.identityBaselineDigest || '') ||
      !validFamilyCounts(value.familyCounts) || !validProhibitedWrites(value.prohibitedWrites) ||
      !validGates(value.gates, true) || !validSecurityBoundary(value.securityBoundary) ||
      !HASH.test(value.runtimeDigest || '') || value.remainingAdmittedCallBudget !== (slot === 'A' ? 1 : 0) ||
      (slot === 'A' ? value.priorAReconciliationDigest !== null || value.sessionBoundaryDigest !== null :
        !HASH.test(value.priorAReconciliationDigest || '') || !HASH.test(value.sessionBoundaryDigest || '')) ||
      !validTimestamp(value.createdAt) ||
      !HASH.test(value.reconciliationDigest || '') || value.reconciliationDigest !== reconciliationDigest(value)) {
    fail('GROUP_E_RECONCILIATION_INVALID');
  }
  return Object.freeze(structuredClone(value));
}

function responseBinding(uid, attemptId, receiptDigest) {
  if (typeof uid !== 'string' || !uid || !HASH.test(receiptDigest || '')) fail('GROUP_E_RESPONSE_BINDING_INVALID');
  return digestArray('group-e-client-response', [uid, attemptId, receiptDigest]);
}

function finalCloseoutDigest(value) {
  return digestArray('group-e-final-closeout', [
    value.schemaVersion, value.recordType, value.runId, value.outcome, value.bReconciliationDigest,
    value.blockedReason, value.restorationDigest, value.finalStateDigest, value.observationDigest,
    value.observationStartedAt, value.observationEndedAt, value.observationAccepted,
    value.unexpectedAdditionalAdmittedCalls,
    PROHIBITED_WRITE_FIELDS.map((field) => value.prohibitedWrites?.[field]), value.createdAt
  ]);
}

function createFinalCloseout(value) {
  const record = { schemaVersion: SCHEMA_VERSION, recordType: 'group-e-final-closeout', ...structuredClone(value),
    closeoutDigest: null };
  record.closeoutDigest = finalCloseoutDigest(record);
  return validateFinalCloseout(record);
}

function validateFinalCloseout(value) {
  const healthy = value?.outcome === 'healthy';
  const blocked = value?.outcome === 'blocked';
  const observationStarted = Date.parse(value?.observationStartedAt);
  const observationEnded = Date.parse(value?.observationEndedAt);
  const created = Date.parse(value?.createdAt);
  if (!exactFields(value, CLOSEOUT_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-final-closeout' || !UUID_V4.test(value.runId || '') || (!healthy && !blocked) ||
      (healthy ? !HASH.test(value.bReconciliationDigest || '') || value.blockedReason !== null :
        (value.bReconciliationDigest !== null && !HASH.test(value.bReconciliationDigest || '')) ||
        typeof value.blockedReason !== 'string' || !/^[A-Z0-9_]{3,64}$/u.test(value.blockedReason)) ||
      !HASH.test(value.restorationDigest || '') || !HASH.test(value.finalStateDigest || '') ||
      !HASH.test(value.observationDigest || '') || !Number.isFinite(observationStarted) ||
      !Number.isFinite(observationEnded) || observationEnded - observationStarted < MIN_PASSIVE_OBSERVATION_MS ||
      observationEnded - observationStarted > MAX_PASSIVE_OBSERVATION_MS || !Number.isFinite(created) ||
      created < observationEnded || value.observationAccepted !== true ||
      value.unexpectedAdditionalAdmittedCalls !== 0 || !validProhibitedWrites(value.prohibitedWrites) ||
      !validTimestamp(value.createdAt) || !HASH.test(value.closeoutDigest || '') ||
      value.closeoutDigest !== finalCloseoutDigest(value)) fail('GROUP_E_CLOSEOUT_INVALID');
  return Object.freeze(structuredClone(value));
}

function preEnableAbortDigest(value) {
  return digestArray('group-e-pre-enable-abort', [
    value.schemaVersion, value.recordType, value.runId, value.runManifestDigest, value.executionLedgerDigest,
    value.reason, GATE_FIELDS.map((field) => value.gates?.[field]),
    PROHIBITED_WRITE_FIELDS.map((field) => value.prohibitedWrites?.[field]),
    value.aDispatchAbsent, value.consumptionsAbsent, value.reconciliationsAbsent, value.createdAt
  ]);
}

function createPreEnableAbort(value) {
  const record = { schemaVersion: SCHEMA_VERSION, recordType: 'group-e-pre-enable-abort', ...structuredClone(value),
    abortDigest: null };
  record.abortDigest = preEnableAbortDigest(record);
  return validatePreEnableAbort(record);
}

function validatePreEnableAbort(value) {
  if (!exactFields(value, PRE_ENABLE_ABORT_FIELDS) || value.schemaVersion !== SCHEMA_VERSION ||
      value.recordType !== 'group-e-pre-enable-abort' || !UUID_V4.test(value.runId || '') ||
      !HASH.test(value.runManifestDigest || '') || !HASH.test(value.executionLedgerDigest || '') ||
      !PRE_ENABLE_ABORT_REASONS.includes(value.reason) || !validGates(value.gates, false) ||
      !validProhibitedWrites(value.prohibitedWrites) || value.aDispatchAbsent !== true ||
      value.consumptionsAbsent !== true || value.reconciliationsAbsent !== true ||
      !validTimestamp(value.createdAt) || !HASH.test(value.abortDigest || '') ||
      value.abortDigest !== preEnableAbortDigest(value)) {
    fail('GROUP_E_PRE_ENABLE_ABORT_INVALID');
  }
  return Object.freeze(structuredClone(value));
}

module.exports = Object.freeze({
  BASELINE_FIELDS,
  CAPABILITY_FIELDS,
  CLOSEOUT_FIELDS,
  CONSUMPTION_FIELDS,
  ENVIRONMENT,
  FAMILY_COUNT_FIELDS,
  GATE_FIELDS,
  HASH,
  MODE,
  MIN_PASSIVE_OBSERVATION_MS,
  MAX_PASSIVE_OBSERVATION_MS,
  PROJECT_ID,
  PROHIBITED_WRITE_FIELDS,
  PRE_ENABLE_ABORT_FIELDS,
  PRE_ENABLE_ABORT_REASONS,
  PROVENANCE_FIELDS,
  SESSION_GENERATION_FIELDS,
  RECEIPT_FIELDS,
  RECONCILIATION_FIELDS,
  RUN_RECORD_FIELDS,
  SCHEMA_VERSION,
  SECURITY_FIELDS,
  SIGNED_REQUEST_FIELDS,
  SLOTS,
  UUID_V4,
  admissionReceiptDigest,
  appIdHash,
  attemptHash,
  baselineDigest,
  canonicalCapabilityArray,
  canonicalCapabilityBytes,
  capabilityDigest,
  createAdmissionReceipt,
  createConsumptionRecord,
  createFinalCloseout,
  createPreEnableAbort,
  createReconciliationRecord,
  createRunManifest,
  digestArray,
  exactFields,
  finalCloseoutDigest,
  preEnableAbortDigest,
  jtiHash,
  keyIdFromSpki,
  reconciliationDigest,
  responseBinding,
  sessionGenerationContext,
  sessionGenerationDigest,
  runManifestDigest,
  sha256,
  subjectHash,
  validateAdmissionReceipt,
  validateCapabilityAgainstRun,
  validateCapabilityShape,
  validateConsumptionRecord,
  validateFinalCloseout,
  validatePreEnableAbort,
  validateReconciliationRecord,
  validateRunManifest,
  validateSignedRequest,
  verifyCapabilitySignature
});
