'use strict';

const crypto = require('node:crypto');
const {
  appIdHash,
  attemptHash,
  baselineDigest,
  createAdmissionReceipt,
  createConsumptionRecord,
  createReconciliationRecord,
  createRunManifest,
  canonicalCapabilityBytes,
  sessionGenerationContext,
  sessionGenerationDigest,
  subjectHash
} = require('../../e1-gateway/groupEAdmission');

const NOW = Date.parse('2030-01-01T12:10:00.000Z');
const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const JTI = Object.freeze({
  A: '223e4567-e89b-42d3-a456-426614174000',
  B: '323e4567-e89b-42d3-a456-426614174000'
});
const GENERATION = Object.freeze({
  A: '423e4567-e89b-42d3-a456-426614174000',
  B: '523e4567-e89b-42d3-a456-426614174000'
});
const SESSION_GENERATION = Object.freeze({ A: 10, B: 11 });
const RUNTIME_INSTANCE_DIGEST = '8'.repeat(64);
const ATTEMPT = Object.freeze({
  A: '623e4567-e89b-42d3-a456-426614174000',
  B: '723e4567-e89b-42d3-a456-426614174000'
});
const UID = Object.freeze({ A: 'syntheticGroupEUidA', B: 'syntheticGroupEUidB' });
const TRAINER = Object.freeze({ A: 'SyntheticGroupEA', B: 'SyntheticGroupEB' });
const FIREBASE_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const BASELINE = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0,
  stateDigest: '6f0caa5435ac7ef027fc8640bce814bd3bd3bbdd272e6c5d5cee46885916f2bb'
});
const COUNTS = Object.freeze({
  totalDocuments: 32,
  accounts: 8,
  trainerHandles: 8,
  rateLimits: 8,
  operationRequests: 8,
  identityMigrations: 0,
  identityConflicts: 0
});
const ZERO_WRITES = Object.freeze({
  phaseEIdentityWrites: 0,
  rtdbWrites: 0,
  ordinaryUserWrites: 0,
  unexpectedControlWrites: 0
});
const GATES_ENABLED = Object.freeze({
  CLIENT_FOUNDATION_USE_ENABLED: false,
  GATEWAY_INVOCATION_ENABLED: true,
  READ_ACCOUNT_FOUNDATION_ENABLED: true,
  CREATE_PROVIDER_ACCOUNT_ENABLED: false,
  RESERVE_HANDLE_ENABLED: false,
  REPAIR_FOUNDATION_ENABLED: false,
  APPLY_MIGRATION_ENABLED: false,
  FREEZE_CONFLICT_ENABLED: false,
  READ_PROOF_MODE: false
});
const SECURITY = Object.freeze({
  authorityPrivate: true,
  gatewayOnlyInvoker: true,
  projectWideInvoker: false,
  gatewayForbiddenRolesPresent: false,
  iamDrift: false,
  productionDebugTokensRegistered: false,
  providerLinkRoutePresent: false,
  controlDatabaseRules: 'deny-all'
});
const PROVENANCE = Object.freeze({
  toolingSourceSha: 'a'.repeat(40),
  pagesReleaseId: '2030-01-01.99',
  pagesSourceSha: 'b'.repeat(40),
  pagesArtifactDigest: 'c'.repeat(64),
  gatewaySourceSha: 'd'.repeat(40),
  gatewaySourceFingerprint: 'e'.repeat(64),
  authorityRevision: 'e1-identity-authority-00123-abc',
  authorityImageDigest: `sha256:${'f'.repeat(64)}`
});

function createFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const bindings = Object.freeze({
    A: Object.freeze({ uidHash: subjectHash('uid', UID.A), trainerHash: subjectHash('trainer', TRAINER.A) }),
    B: Object.freeze({ uidHash: subjectHash('uid', UID.B), trainerHash: subjectHash('trainer', TRAINER.B) })
  });
  const cohortDigest = crypto.createHash('sha256').update(JSON.stringify([1, 'group-e-client-foundation-cohort',
    'A', bindings.A.uidHash, bindings.A.trainerHash, 'B', bindings.B.uidHash, bindings.B.trainerHash]), 'utf8').digest('hex');
  const run = createRunManifest({
    runId: RUN_ID,
    bindings,
    cohortDigest,
    firebaseAppIdHash: appIdHash(FIREBASE_APP_ID),
    publicKeySpki,
    provenance: PROVENANCE,
    d3CloseoutDigest: '1'.repeat(64),
    identityBaseline: BASELINE,
    admissionEvidenceDigest: '2'.repeat(64),
    preCallReplayLedgerDigest: '3'.repeat(64),
    initialExecutionLedgerDigest: '4'.repeat(64),
    issuedAt: '2030-01-01T12:00:00.000Z',
    expiresAt: '2030-01-01T12:30:00.000Z'
  });
  const dependencies = Object.freeze({
    priorAReconciliationDigest: '5'.repeat(64),
    sessionBoundaryDigest: '6'.repeat(64)
  });
  function capability(slot, overrides = {}) {
    const value = {
      schemaVersion: 1,
      recordType: 'group-e-slot-capability',
      environment: 'production',
      projectId: 'trade-list-a4297',
      runId: RUN_ID,
      slot,
      jti: JTI[slot],
      uidHash: bindings[slot].uidHash,
      trainerHash: bindings[slot].trainerHash,
      cohortDigest,
      generationId: GENERATION[slot],
      sessionGeneration: SESSION_GENERATION[slot],
      attemptHash: attemptHash(ATTEMPT[slot]),
      firebaseAppIdHash: run.firebaseAppIdHash,
      browserContextDigest: '7'.repeat(64),
      runtimeInstanceDigest: RUNTIME_INSTANCE_DIGEST,
      sessionGenerationDigest: null,
      ...PROVENANCE,
      d3CloseoutDigest: run.d3CloseoutDigest,
      identityBaselineDigest: baselineDigest(BASELINE),
      admissionEvidenceDigest: run.admissionEvidenceDigest,
      preCallReplayLedgerDigest: run.preCallReplayLedgerDigest,
      dispatchLedgerDigest: slot === 'A' ? 'b'.repeat(64) : 'c'.repeat(64),
      issuedAt: '2030-01-01T12:05:00.000Z',
      expiresAt: '2030-01-01T12:20:00.000Z',
      remainingAdmittedCallBudget: slot === 'A' ? 2 : 1,
      runManifestDigest: run.manifestDigest,
      keyId: run.keyId,
      priorAReconciliationDigest: slot === 'A' ? null : dependencies.priorAReconciliationDigest,
      sessionBoundaryDigest: slot === 'A' ? null : dependencies.sessionBoundaryDigest,
      ...overrides
    };
    if (value.sessionGenerationDigest === null) {
      value.sessionGenerationDigest = sessionGenerationDigest(sessionGenerationContext(value));
    }
    return value;
  }
  function signedRequest(slot, overrides = {}) {
    const value = capability(slot, overrides.capability);
    return Object.freeze({
      schemaVersion: 1,
      attemptId: overrides.attemptId || ATTEMPT[slot],
      capability: value,
      signature: overrides.signature || crypto.sign(null, canonicalCapabilityBytes(value), privateKey).toString('base64url')
    });
  }
  function consumption(slot, overrides = {}) {
    const value = capability(slot, overrides.capability);
    return createConsumptionRecord({
      runId: RUN_ID,
      slot,
      capabilityDigest: require('../../e1-gateway/groupEAdmission').capabilityDigest(value),
      jtiHash: require('../../e1-gateway/groupEAdmission').jtiHash(value.jti),
      attemptHash: value.attemptHash,
      uidHash: value.uidHash,
      appIdHash: value.firebaseAppIdHash,
      cohortDigest,
      keyId: run.keyId,
      createdAt: '2030-01-01T12:10:00.000Z',
      ...overrides.record
    });
  }
  function reconciliationA(marker = consumption('A'), overrides = {}) {
    const receipt = createAdmissionReceipt(marker);
    return createReconciliationRecord({
      runId: RUN_ID,
      slot: 'A',
      consumptionRecordDigest: marker.recordDigest,
      admissionReceiptDigest: receipt.receiptDigest,
      gatewayRecordDigest: 'd'.repeat(64),
      authorityRecordDigest: 'e'.repeat(64),
      responseDigest: 'f'.repeat(64),
      resultDigest: '0'.repeat(64),
      resultCode: 'SUCCESS',
      foundationStatus: 'active',
      identityBaselineDigest: baselineDigest(BASELINE),
      familyCounts: COUNTS,
      prohibitedWrites: ZERO_WRITES,
      gates: GATES_ENABLED,
      securityBoundary: SECURITY,
      runtimeDigest: '1'.repeat(64),
      remainingAdmittedCallBudget: 1,
      priorAReconciliationDigest: null,
      sessionBoundaryDigest: null,
      createdAt: '2030-01-01T12:12:00.000Z',
      ...overrides
    });
  }
  return Object.freeze({
    ATTEMPT,
    BASELINE,
    COUNTS,
    FIREBASE_APP_ID,
    GENERATION,
    GATES_ENABLED,
    JTI,
    NOW,
    PROVENANCE,
    RUNTIME_INSTANCE_DIGEST,
    RUN_ID,
    SECURITY,
    SESSION_GENERATION,
    TRAINER,
    UID,
    ZERO_WRITES,
    bindings,
    capability,
    cohortDigest,
    consumption,
    dependencies,
    privateKey,
    privateKeyPem,
    publicKey,
    publicKeySpki,
    reconciliationA,
    run,
    signedRequest
  });
}

module.exports = Object.freeze({ createFixture });
