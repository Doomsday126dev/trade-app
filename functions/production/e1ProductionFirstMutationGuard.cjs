'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { DURABLE_MODE, GROUP_C_PROOF_MODE, readProofSubjectHash } = require('../e1-authority-service/readRateLimiters');

const MANIFEST_PATH = path.resolve(__dirname, 'e1-production-resource-manifest.json');
const PRIVATE_READINESS_PATH = path.resolve(__dirname, '../.local/e1-production-first-mutation-activation.json');
const PRIVATE_INPUT_PATH = path.resolve(__dirname, '../.local/e1-production-first-mutation-guard-input.json');
const PRIVATE_HARNESS_PATH = path.resolve(__dirname, '../.local/e1-group-d-reserve-console.js');
const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
const OBSERVATION_HOURS = 24;
const EXPECTED_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const EXPECTED_SUBJECT_HASHES = Object.freeze({
  uidHash: '51604d9a78f7486fa0e7c4814594a51de5f69135fcefe466de3468e07ca3833f',
  trainerHash: 'c3a47f6d040ffa1eb2f186cb17ceee6447f952c80cb50b1b98642fb62756461b'
});
const EXPECTED_REQUEST_HASHES = Object.freeze({
  requestIdHash: '7c308995763a652fb9c3710bdd209f5629776978e23ac51497d80c37a373df4d',
  requestBodyHash: '417138d09c3f08a2a4ba96568cdb0263c3aff015701229599a0d3cd6a09dcad1'
});
const EXPECTED_HANDLE = Object.freeze({
  canonical: 'Doomsday126',
  normalized: 'doomsday126',
  handleKey: 'v1_646f6f6d73646179313236'
});
const EXPECTED_TOKEN_VERIFIER = Object.freeze({
  principal: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
  role: 'roles/firebaseappcheck.tokenVerifier',
  permissions: Object.freeze(['firebaseappcheck.appCheckTokens.verify']),
  scope: 'project',
  present: true
});
const EXPECTED_MANIFEST_TOKEN_VERIFIER = Object.freeze({
  principal: EXPECTED_TOKEN_VERIFIER.principal,
  role: EXPECTED_TOKEN_VERIFIER.role,
  permissions: EXPECTED_TOKEN_VERIFIER.permissions,
  scope: EXPECTED_TOKEN_VERIFIER.scope
});
const EXPECTED_FIRST_MUTATION_MANIFEST = Object.freeze({
  approvalGroup: 'D',
  cohortSize: 1,
  canonicalHandle: 'Doomsday126',
  normalizedHandle: 'doomsday126',
  handleKey: 'v1_646f6f6d73646179313236',
  maxWindowHours: 2,
  rateLimiterMode: DURABLE_MODE,
  expectedFirstWriteDocuments: 4,
  expectedReplayDocuments: 4,
  restorationRequiredAfterOutcomes: Object.freeze(['first-success', 'first-failure', 'replay-success', 'replay-failure']),
  observationHours: OBSERVATION_HOURS,
  observationChecks: Object.freeze([
    'authority-gateway-5xx',
    'app-check-failures',
    'replay-duplicate-anomalies',
    'collision-conflict-metrics',
    'exact-firestore-state',
    'iam-drift',
    'rtdb-auth-public-share-isolation',
    'cost-anomalies'
  ]),
  groupEAuthorized: false
});
const ALLOWED_OPERATIONS = Object.freeze([
  'verify-reviewed-owner',
  'verify-handle-eligibility',
  'verify-zero-authority-state',
  'verify-app-check-token-verifier',
  'enable-gateway',
  'enable-reserve',
  'perform-first-reserve',
  'verify-first-write-state',
  'perform-exact-replay',
  'verify-idempotent-state',
  'restore-reserve',
  'restore-gateway',
  'run-post-write-observation-inventory'
]);
const AUTHORITY_GATES = Object.freeze([
  'READ_ACCOUNT_FOUNDATION_ENABLED',
  'READ_PROVIDER_PUBLIC_SHARE_ENABLED',
  'CREATE_PROVIDER_ACCOUNT_ENABLED',
  'RESERVE_HANDLE_ENABLED',
  'REPAIR_FOUNDATION_ENABLED',
  'APPLY_MIGRATION_ENABLED',
  'FREEZE_CONFLICT_ENABLED'
]);
const ALL_GATES = Object.freeze(['CLIENT_FOUNDATION_USE_ENABLED', 'GATEWAY_INVOCATION_ENABLED', ...AUTHORITY_GATES, 'READ_PROOF_MODE']);
const READINESS_FIELDS = Object.freeze([
  'schemaVersion', 'environment', 'projectId', 'projectNumber', 'rtdbDatabaseUrl', 'firestoreDatabaseId', 'region',
  'approvalGroup', 'approved', 'approvedAt', 'humanOperator', 'teardownOwner', 'approvalAcknowledged',
  'teardownOwnerAcknowledged', 'mutationWindow', 'reviewedSubject', 'subjectHashes', 'handle', 'request', 'groupCProof',
  'tokenVerifier', 'cohortSize', 'authorizedOperations', 'activationGatePlan', 'restorationGatePlan', 'rateLimiterMode',
  'expectedState', 'observationHours', 'laterGroupsAuthorized', 'groupEAuthorized'
]);
const INPUT_FIELDS = Object.freeze([
  'environment', 'projectId', 'projectNumber', 'expectedProjectNumber', 'region', 'databaseId', 'rtdbDatabaseUrl',
  'requestedOperations', 'reviewedSubject', 'subjectHashes', 'handle', 'request', 'groupCProof', 'tokenVerifier',
  'cohortSize', 'reciprocalLegacyOwnershipVerified', 'loginDirectoryReady', 'expectedAppId', 'genuineAppCheckAvailable',
  'freshAuthorityState', 'preActivationGates', 'activationGatePlan', 'restorationGatePlan', 'readLimiterMode',
  'groupCProofLimiterPresent', 'reserveConsumesLimitedUseAppCheck', 'expectedState', 'gatewayRuntimeSoleAuthorityInvoker',
  'publicAuthorityInvoker', 'projectWideRunInvoker', 'gatewayForbiddenRolesPresent', 'productionDebugTokensRegistered',
  'productionRtdbWriteCount', 'productionAuthMutationCount', 'productionPublicShareWriteCount', 'observationHours'
]);
const SUBJECT_FIELDS = Object.freeze(['firebaseUid', 'trainerUsername']);
const SUBJECT_HASH_FIELDS = Object.freeze(['uidHash', 'trainerHash']);
const HANDLE_FIELDS = Object.freeze(['canonical', 'normalized', 'handleKey']);
const REQUEST_FIELDS = Object.freeze([
  'requestId', 'requestIdHash', 'requestBodyHash', 'foundationFingerprint', 'rateLimitDocumentPath'
]);
const GROUP_C_PROOF_FIELDS = Object.freeze([
  'accepted', 'acceptedAt', 'correlationHash', 'auth', 'appCheck', 'oidcPrivateAuthority',
  'firebaseAdminVerifyIdToken', 'resultCode', 'firestoreCollectionCount', 'firestoreDocumentCount'
]);
const TOKEN_VERIFIER_FIELDS = Object.freeze(['principal', 'role', 'permissions', 'scope', 'present']);
const FRESH_STATE_FIELDS = Object.freeze([
  'collectionCount', 'documentCount', 'accountAbsent', 'handleAbsent', 'operationRequestAbsent', 'reserveRateLimitAbsent',
  'migrationStateAbsent', 'conflictStateAbsent', 'competingHandleAbsent'
]);
const EXPECTED_STATE_FIELDS = Object.freeze([
  'firstResultCode', 'replayResultCode', 'firstWriteDocumentCount', 'replayDocumentCount', 'documentPaths',
  'identityTransactionPaths', 'forbiddenRecordClassesAbsent', 'sameRequestId', 'sameHandle', 'sameHandleKey',
  'sameFoundationFingerprint', 'sameSemanticBody', 'rateLimitUpdatedOnReplay', 'identityWrittenOnReplay',
  'ownershipUnchanged', 'requestEvidenceUnchanged'
]);
const REQUEST_ID = /^group-d-owner-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_HASH = /^[a-f0-9]{16}$/u;
const RATE_LIMIT_PATH = /^rateLimits\/reserveTrainerHandle_[a-f0-9]{16}$/u;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) && sameValues(Object.keys(value), fields);
}

function validIdentity(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 254 && !/[\r\n\/#$\[\]]/u.test(value);
}

function validSubject(value) {
  return exactFields(value, SUBJECT_FIELDS) && validIdentity(value.firebaseUid) && validIdentity(value.trainerUsername);
}

function requestIdHash(requestId) {
  return sha256(JSON.stringify([1, 'group-d-request-id', requestId]));
}

function requestBodyHash(requestId) {
  return sha256(JSON.stringify([1, 'group-d-first-reserve-body', 1, requestId, EXPECTED_HANDLE.canonical]));
}

function foundationFingerprint(subject) {
  return sha256(JSON.stringify([
    1,
    subject.firebaseUid,
    subject.trainerUsername,
    EXPECTED_HANDLE.normalized,
    EXPECTED_HANDLE.handleKey
  ]));
}

function subjectHashesFor(subject) {
  return Object.freeze({
    uidHash: readProofSubjectHash('uid', subject.firebaseUid),
    trainerHash: readProofSubjectHash('trainer', subject.trainerUsername)
  });
}

function disabledGatePlan() {
  return Object.freeze(Object.fromEntries(ALL_GATES.map((gate) => [gate, false])));
}

function activationGatePlan() {
  return Object.freeze({
    ...disabledGatePlan(),
    GATEWAY_INVOCATION_ENABLED: true,
    RESERVE_HANDLE_ENABLED: true
  });
}

function expectedState(subject, request) {
  const account = `accounts/${subject.firebaseUid}`;
  const handle = `trainerHandles/${EXPECTED_HANDLE.handleKey}`;
  const operation = `operationRequests/${subject.firebaseUid}/requests/${request.requestId}`;
  return Object.freeze({
    firstResultCode: 'SUCCESS',
    replayResultCode: 'IDEMPOTENT',
    firstWriteDocumentCount: 4,
    replayDocumentCount: 4,
    documentPaths: Object.freeze([request.rateLimitDocumentPath, account, handle, operation]),
    identityTransactionPaths: Object.freeze([account, handle, operation]),
    forbiddenRecordClassesAbsent: Object.freeze(['authorityConfig', 'identityConflicts', 'identityMigrations']),
    sameRequestId: true,
    sameHandle: true,
    sameHandleKey: true,
    sameFoundationFingerprint: true,
    sameSemanticBody: true,
    rateLimitUpdatedOnReplay: false,
    identityWrittenOnReplay: false,
    ownershipUnchanged: true,
    requestEvidenceUnchanged: true
  });
}

function validRequestContract(value, subject, approvedHashes) {
  return exactFields(value, REQUEST_FIELDS) && REQUEST_ID.test(value.requestId || '') &&
    value.requestIdHash === requestIdHash(value.requestId) && value.requestBodyHash === requestBodyHash(value.requestId) &&
    value.requestIdHash === approvedHashes.requestIdHash && value.requestBodyHash === approvedHashes.requestBodyHash &&
    value.foundationFingerprint === foundationFingerprint(subject) && RATE_LIMIT_PATH.test(value.rateLimitDocumentPath || '');
}

function validGroupCProof(value) {
  return exactFields(value, GROUP_C_PROOF_FIELDS) && value.accepted === true && Number.isFinite(Date.parse(value.acceptedAt)) &&
    SAFE_HASH.test(value.correlationHash || '') && value.auth === 'VALID' && value.appCheck === 'VALID' &&
    value.oidcPrivateAuthority === true && value.firebaseAdminVerifyIdToken === true &&
    value.resultCode === 'FOUNDATION_NOT_INITIALIZED' && value.firestoreCollectionCount === 0 && value.firestoreDocumentCount === 0;
}

function validTokenVerifier(value, manifest) {
  return exactFields(value, TOKEN_VERIFIER_FIELDS) && sameJson(value, EXPECTED_TOKEN_VERIFIER) &&
    sameJson(manifest?.appCheck?.tokenVerifier, EXPECTED_MANIFEST_TOKEN_VERIFIER) &&
    value.principal === manifest?.gateway?.serviceAccount && value.role === manifest?.appCheck?.tokenVerifier?.role &&
    sameValues(value.permissions, manifest?.appCheck?.tokenVerifier?.permissions || []) && value.scope === manifest?.appCheck?.tokenVerifier?.scope;
}

function validFreshState(value) {
  return exactFields(value, FRESH_STATE_FIELDS) && value.collectionCount === 0 && value.documentCount === 0 &&
    FRESH_STATE_FIELDS.slice(2).every((field) => value[field] === true);
}

function privateMode(file) {
  try { return (fs.statSync(file).mode & 0o777) === 0o600; } catch { return false; }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function guardProductionFirstMutation(input, options = {}) {
  const errors = [];
  const now = options.now ? options.now() : Date.now();
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const readinessPath = options.readinessPath || PRIVATE_READINESS_PATH;
  const inputPath = options.inputPath;
  const approvedSubjectHashes = options.expectedSubjectHashes || EXPECTED_SUBJECT_HASHES;
  const approvedRequestHashes = options.expectedRequestHashes || EXPECTED_REQUEST_HASHES;
  let manifest;
  let readiness;
  try { manifest = readJson(manifestPath); } catch { errors.push('production_manifest_missing_or_invalid'); }
  try { readiness = readJson(readinessPath); } catch { errors.push('group_d_readiness_missing_or_invalid'); }

  if (!exactFields(input, INPUT_FIELDS)) errors.push('group_d_input_schema_invalid');
  if (readiness && !exactFields(readiness, READINESS_FIELDS)) errors.push('group_d_readiness_schema_invalid');
  const project = manifest?.project || {};
  if (manifest?.environment !== 'production' || input?.environment !== 'production') errors.push('environment_not_production');
  if (project.id !== 'trade-list-a4297' || input?.projectId !== project.id) errors.push('project_id_mismatch');
  if (project.number !== '1053781218847' || project.numberReviewed !== true || input?.projectNumber !== project.number ||
      input?.expectedProjectNumber !== project.number) errors.push('project_number_mismatch');
  if (project.region !== 'us-central1' || input?.region !== project.region) errors.push('region_mismatch');
  if (manifest?.firestore?.databaseId !== 'phase-e-identity' || input?.databaseId !== manifest?.firestore?.databaseId) {
    errors.push('firestore_database_mismatch');
  }
  if (manifest?.legacyRtdb?.url !== 'https://trade-list-a4297-default-rtdb.firebaseio.com' ||
      input?.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url) errors.push('rtdb_mismatch');
  if (!sameJson(manifest?.firstMutation, EXPECTED_FIRST_MUTATION_MANIFEST)) errors.push('group_d_manifest_contract_invalid');
  if (JSON.stringify({ manifest, input, readiness }).includes('trainer-hub-staging-37ib4wct')) errors.push('staging_target_present');

  if (readiness) {
    if (readiness.schemaVersion !== 1 || readiness.environment !== 'production' || readiness.projectId !== project.id ||
        readiness.projectNumber !== project.number || readiness.rtdbDatabaseUrl !== manifest?.legacyRtdb?.url ||
        readiness.firestoreDatabaseId !== manifest?.firestore?.databaseId || readiness.region !== project.region) {
      errors.push('group_d_readiness_target_mismatch');
    }
    if (readiness.approvalGroup !== 'D' || readiness.approved !== true || readiness.approvalAcknowledged !== true ||
        readiness.teardownOwnerAcknowledged !== true || readiness.humanOperator !== readiness.teardownOwner ||
        !validIdentity(readiness.humanOperator) || readiness.laterGroupsAuthorized !== false || readiness.groupEAuthorized !== false ||
        readiness.cohortSize !== 1 || readiness.observationHours !== OBSERVATION_HOURS) errors.push('group_d_approval_invalid');
    const start = Date.parse(readiness.mutationWindow?.startAt);
    const end = Date.parse(readiness.mutationWindow?.endAt);
    const approvedAt = Date.parse(readiness.approvedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(approvedAt) || start >= end ||
        end - start > MAX_WINDOW_MS || now < start || now >= end || approvedAt > now) errors.push('group_d_window_invalid');
    if (!privateMode(readinessPath)) errors.push('group_d_readiness_permissions_invalid');
  }
  if (inputPath && !privateMode(inputPath)) errors.push('group_d_input_permissions_invalid');
  if (!sameValues(readiness?.authorizedOperations, ALLOWED_OPERATIONS) || !sameValues(input?.requestedOperations, ALLOWED_OPERATIONS)) {
    errors.push('group_d_operations_invalid');
  }

  if (!validSubject(readiness?.reviewedSubject) || !validSubject(input?.reviewedSubject) ||
      !sameJson(readiness?.reviewedSubject, input?.reviewedSubject)) errors.push('group_d_subject_mismatch');
  const subject = readiness?.reviewedSubject;
  const hashes = validSubject(subject) ? subjectHashesFor(subject) : null;
  if (!exactFields(readiness?.subjectHashes, SUBJECT_HASH_FIELDS) || !exactFields(input?.subjectHashes, SUBJECT_HASH_FIELDS) ||
      !sameJson(readiness?.subjectHashes, hashes) || !sameJson(input?.subjectHashes, hashes) ||
      !sameJson(hashes, approvedSubjectHashes)) errors.push('group_d_subject_hash_mismatch');

  let normalized;
  try { normalized = normalizeHandle(readiness?.handle?.canonical); } catch { normalized = null; }
  if (!exactFields(readiness?.handle, HANDLE_FIELDS) || !exactFields(input?.handle, HANDLE_FIELDS) ||
      !sameJson(readiness?.handle, EXPECTED_HANDLE) || !sameJson(input?.handle, EXPECTED_HANDLE) ||
      !normalized || normalized.display !== EXPECTED_HANDLE.canonical || normalized.normalized !== EXPECTED_HANDLE.normalized ||
      normalized.handleKey !== EXPECTED_HANDLE.handleKey) errors.push('group_d_handle_mismatch');

  if (!validSubject(subject) || !validRequestContract(readiness?.request, subject, approvedRequestHashes) ||
      !validRequestContract(input?.request, subject, approvedRequestHashes) || !sameJson(readiness?.request, input?.request)) {
    errors.push('group_d_request_contract_invalid');
  }
  if (!validGroupCProof(readiness?.groupCProof) || !validGroupCProof(input?.groupCProof) ||
      !sameJson(readiness?.groupCProof, input?.groupCProof)) errors.push('group_d_group_c_proof_invalid');
  if (!validTokenVerifier(readiness?.tokenVerifier, manifest) || !validTokenVerifier(input?.tokenVerifier, manifest) ||
      !sameJson(readiness?.tokenVerifier, input?.tokenVerifier)) errors.push('group_d_token_verifier_invalid');

  if (input?.cohortSize !== 1 || input?.reciprocalLegacyOwnershipVerified !== true || input?.loginDirectoryReady !== true ||
      input?.expectedAppId !== EXPECTED_APP_ID || input?.genuineAppCheckAvailable !== true) errors.push('group_d_owner_ineligible');
  if (!validFreshState(input?.freshAuthorityState)) errors.push('group_d_authority_state_not_zero');

  const disabled = disabledGatePlan();
  const enabled = activationGatePlan();
  if (!exactFields(input?.preActivationGates, ALL_GATES) || !sameJson(input?.preActivationGates, disabled) ||
      !exactFields(readiness?.activationGatePlan, ALL_GATES) || !exactFields(input?.activationGatePlan, ALL_GATES) ||
      !sameJson(readiness?.activationGatePlan, enabled) || !sameJson(input?.activationGatePlan, enabled) ||
      !exactFields(readiness?.restorationGatePlan, ALL_GATES) || !exactFields(input?.restorationGatePlan, ALL_GATES) ||
      !sameJson(readiness?.restorationGatePlan, disabled) || !sameJson(input?.restorationGatePlan, disabled)) {
    errors.push('group_d_gate_plan_invalid');
  }
  if (readiness?.rateLimiterMode !== DURABLE_MODE || input?.readLimiterMode !== DURABLE_MODE ||
      input?.groupCProofLimiterPresent !== false || input?.readLimiterMode === GROUP_C_PROOF_MODE ||
      input?.reserveConsumesLimitedUseAppCheck !== true) errors.push('group_d_limiter_or_app_check_invalid');

  const modeled = validSubject(subject) && validRequestContract(readiness?.request, subject, approvedRequestHashes)
    ? expectedState(subject, readiness.request)
    : null;
  if (!exactFields(readiness?.expectedState, EXPECTED_STATE_FIELDS) || !exactFields(input?.expectedState, EXPECTED_STATE_FIELDS) ||
      !sameJson(readiness?.expectedState, modeled) || !sameJson(input?.expectedState, modeled)) errors.push('group_d_expected_state_invalid');
  if (readiness?.observationHours !== OBSERVATION_HOURS || input?.observationHours !== OBSERVATION_HOURS) {
    errors.push('group_d_observation_invalid');
  }

  if (input?.gatewayRuntimeSoleAuthorityInvoker !== true || input?.publicAuthorityInvoker !== false ||
      input?.projectWideRunInvoker !== false || input?.gatewayForbiddenRolesPresent !== false ||
      input?.productionDebugTokensRegistered !== false) errors.push('group_d_security_boundary_invalid');
  if (input?.productionRtdbWriteCount !== 0 || input?.productionAuthMutationCount !== 0 ||
      input?.productionPublicShareWriteCount !== 0) errors.push('group_d_pre_activation_write_detected');

  if (errors.length) {
    const error = new Error('e1/production-first-mutation-guard-failed');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    approvalGroup: 'D',
    environment: 'production',
    targetVerified: true,
    reviewedOwnerVerified: true,
    handleVerified: true,
    preMutationStateVerified: true,
    expectedFirstWriteDocuments: 4,
    expectedReplayDocuments: 4,
    rateLimiterMode: DURABLE_MODE,
    cohortSize: 1,
    observationHours: OBSERVATION_HOURS,
    laterGroupsAuthorized: false,
    cloudOperations: 0
  });
}

function validatePrivateHarnessSource(source) {
  const errors = [];
  if (typeof source !== 'string' || !source) errors.push('group_d_harness_missing');
  const requestIds = [...String(source).matchAll(/const requestId = '(group-d-owner-[^']+)'/gu)].map((match) => match[1]);
  if (requestIds.length !== 1 || !REQUEST_ID.test(requestIds[0] || '') ||
      requestIdHash(requestIds[0] || '') !== EXPECTED_REQUEST_HASHES.requestIdHash ||
      requestBodyHash(requestIds[0] || '') !== EXPECTED_REQUEST_HASHES.requestBodyHash) {
    errors.push('group_d_harness_request_id_invalid');
  }
  for (const required of [
    "candidate.name === 'pogo'",
    EXPECTED_APP_ID,
    "window.__POGO_RELEASE_ID !== '2026-08-05.34'",
    "location.hostname !== 'doomsday126dev.github.io'",
    EXPECTED_SUBJECT_HASHES.uidHash,
    EXPECTED_SUBJECT_HASHES.trainerHash,
    "requestedHandle: 'Doomsday126'",
    'limitedUseAppCheckTokens: true',
    "'reserveE1TrainerHandle'",
    'window.__E1_GROUP_D_FIRST_ATTEMPTED__',
    'window.__E1_GROUP_D_REPLAY_ATTEMPTED__',
    'firstSucceeded !== true',
    'callable(requestBody)'
  ]) if (!String(source).includes(required)) errors.push('group_d_harness_contract_missing');
  if ((String(source).match(/callable\(requestBody\)/gu) || []).length !== 2) errors.push('group_d_harness_call_count_invalid');
  if ((String(source).match(/const requestId =/gu) || []).length !== 1 || String(source).includes('crypto.randomUUID')) {
    errors.push('group_d_harness_request_id_not_pinned');
  }
  if (!String(source).includes('getApps()') || String(source).includes('initializeApp(')) errors.push('group_d_harness_app_boundary_invalid');
  if (/localStorage|sessionStorage|indexedDB/iu.test(String(source))) errors.push('group_d_harness_persistent_storage_forbidden');
  if (/signIn|signOut|firebase-database|\.firebaseio\.com|e1-identity-authority|fetch\s*\(/iu.test(String(source))) {
    errors.push('group_d_harness_direct_or_auth_operation_forbidden');
  }
  if (/readE1AccountFoundation|repairAccountFoundation|applyMigrationManifest|freezeIdentityConflict/iu.test(String(source))) {
    errors.push('group_d_harness_callable_forbidden');
  }
  if (/console\.log\([^\n]*(?:\.uid|\bcur\b|token|email|trainerUsername)/iu.test(String(source))) {
    errors.push('group_d_harness_sensitive_logging_forbidden');
  }
  if (errors.length) {
    const error = new Error('e1/group-d-harness-invalid');
    error.reasons = Object.freeze([...new Set(errors)].sort());
    throw error;
  }
  return Object.freeze({
    ok: true,
    requestIdHash: requestIdHash(requestIds[0]),
    firstInvocationCount: 1,
    replayInvocationCount: 1,
    limitedUseAppCheckTokens: true,
    persistentStorage: false
  });
}

module.exports = Object.freeze({
  ALLOWED_OPERATIONS,
  ALL_GATES,
  EXPECTED_APP_ID,
  EXPECTED_FIRST_MUTATION_MANIFEST,
  EXPECTED_HANDLE,
  EXPECTED_REQUEST_HASHES,
  EXPECTED_SUBJECT_HASHES,
  EXPECTED_TOKEN_VERIFIER,
  GROUP_C_PROOF_FIELDS,
  INPUT_FIELDS,
  MANIFEST_PATH,
  MAX_WINDOW_MS,
  OBSERVATION_HOURS,
  PRIVATE_HARNESS_PATH,
  PRIVATE_INPUT_PATH,
  PRIVATE_READINESS_PATH,
  READINESS_FIELDS,
  activationGatePlan,
  disabledGatePlan,
  expectedState,
  foundationFingerprint,
  guardProductionFirstMutation,
  requestBodyHash,
  requestIdHash,
  subjectHashesFor,
  validatePrivateHarnessSource
});
