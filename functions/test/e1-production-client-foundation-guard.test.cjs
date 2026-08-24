'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  D3_CLOSEOUT,
  ENABLE_CONFIRMATION,
  RESTORE_CONFIRMATION,
  activationGatePlan,
  bindingDigest,
  clientControllerContract,
  d3CloseoutDigest,
  disabledGatePlan,
  evidenceDigest,
  expectedBudget,
  guardProductionClientFoundation,
  jitDigest,
  replayLedgerDigest,
  validateGroupEGuard,
  validateGroupEObservation
} = require('../production/e1ProductionClientFoundationGuard.cjs');
const {
  SECURITY_BOUNDARY,
  STAGES,
  createExecutionRunManifest,
  createInitialExecutionLedger,
  initializeLedgerDirectory
} = require('../production/e1ProductionClientFoundationExecution.cjs');
const {
  canonicalIamPlan,
  deploymentDigest,
  expectedRulesDigest,
  loadControlPlanePlan
} = require('../production/e1GroupEControlPlane.cjs');
const {
  APP_CHECK_MODE,
  appCheckRuntimeProofDigest
} = require('../production/e1ProductionThirdMutationBrowserHarness.cjs');
const { appIdHash } = require('../e1-gateway/groupEAdmission');

const NOW = Date.parse('2030-01-01T12:10:00.000Z');
const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const FIREBASE_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';

function clone(value) {
  return structuredClone(value);
}

function runtimeProvenance(slot, index, bindings, cohortDigest) {
  const base = Date.parse(`2030-01-01T12:0${index}:00.000Z`);
  const at = (offset) => new Date(base + offset).toISOString();
  const stage = (start, outcome = 'resolved') => ({
    startedAt: at(start),
    settledAt: at(start + 1000),
    outcome
  });
  const value = {
    slot,
    origin: 'https://doomsday126dev.github.io',
    pathname: '/trade-app/',
    appId: FIREBASE_APP_ID,
    uidHash: bindings[slot].uidHash,
    trainerHash: bindings[slot].trainerHash,
    bindingDigest: cohortDigest,
    probeStartedAt: at(0),
    samePageRuntimeEstablished: true,
    debugTokenGlobalAbsent: true,
    pageRuntimeBinding: stage(0, 'verified'),
    sdkImport: stage(2000),
    readiness: stage(4000),
    appCheckInstance: { ...stage(6000, 'verified'), exactInstance: true },
    limitedUseToken: {
      ...stage(8000),
      nonEmpty: true,
      tokenFingerprint: String(index + 3).repeat(64),
      persisted: false,
      reused: false,
      sentToCallable: false
    },
    failureStage: null,
    runtimeProofDigest: null
  };
  value.runtimeProofDigest = appCheckRuntimeProofDigest(value);
  return value;
}

function deployedControlPlane() {
  const plan = loadControlPlanePlan();
  const value = {
    status: 'DEPLOYED',
    projectId: 'trade-list-a4297',
    databaseId: 'e1-group-e-control',
    location: 'us-central1',
    type: 'FIRESTORE_NATIVE',
    edition: 'STANDARD',
    deletionProtection: true,
    pitr: 'ENABLED',
    ttl: null,
    mobileWebRules: 'deny-all',
    rulesDigest: expectedRulesDigest(),
    iamPlanDigest: canonicalIamPlan(plan),
    verifiedAt: '2030-01-01T12:08:00.000Z',
    deploymentDigest: null
  };
  value.deploymentDigest = deploymentDigest(value);
  return value;
}

function fixture() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const bindings = {
    A: { uidHash: 'a'.repeat(64), trainerHash: '1'.repeat(64) },
    B: { uidHash: 'b'.repeat(64), trainerHash: '2'.repeat(64) }
  };
  const cohortDigest = bindingDigest(bindings);
  const provenance = {
    toolingSourceSha: 'a'.repeat(40),
    pagesReleaseId: '2030-01-01.99',
    pagesSourceSha: 'b'.repeat(40),
    pagesArtifactDigest: 'c'.repeat(64),
    gatewaySourceSha: 'd'.repeat(40),
    gatewaySourceFingerprint: 'e'.repeat(64),
    authorityRevision: 'e1-identity-authority-00123-abc',
    authorityImageDigest: `sha256:${'f'.repeat(64)}`
  };
  const evidence = ['A', 'B'].map((slot, index) => ({
    schemaVersion: 2,
    slot,
    capturedAt: `2030-01-01T12:0${index + 4}:00.000Z`,
    expiresAt: `2030-01-01T12:1${index + 5}:00.000Z`,
    pagesReleaseId: provenance.pagesReleaseId,
    pagesSourceSha: provenance.pagesSourceSha,
    pagesArtifactDigest: provenance.pagesArtifactDigest,
    uidHash: bindings[slot].uidHash,
    trainerHash: bindings[slot].trainerHash,
    cohortDigest,
    browserContextHash: String(index + 5).repeat(64),
    appCheckMode: APP_CHECK_MODE,
    appCheckProvenance: runtimeProvenance(slot, index, bindings, cohortDigest),
    callableConstructed: false,
    callableInvoked: false,
    credentialsOrTokensPersisted: false,
    sanitizedSentinel: String(index + 7).repeat(16)
  }));
  const replayLedger = {
    schemaVersion: 1,
    cohortDigest,
    generationId: '223e4567-e89b-42d3-a456-426614174000',
    createdAt: '2030-01-01T11:59:00.000Z',
    entries: evidence.map((entry) => ({
      slot: entry.slot,
      capturedAt: entry.capturedAt,
      runtimeProofDigest: entry.appCheckProvenance.runtimeProofDigest,
      tokenFingerprint: entry.appCheckProvenance.limitedUseToken.tokenFingerprint
    })),
    callableInvocations: 0,
    ledgerDigest: null
  };
  replayLedger.ledgerDigest = replayLedgerDigest(replayLedger);
  const jit = {
    approvedAt: '2030-01-01T12:06:00.000Z',
    expiresAt: '2030-01-01T12:21:00.000Z',
    cohortDigest,
    evidenceDigest: evidenceDigest(evidence),
    replayLedgerDigest: replayLedger.ledgerDigest,
    activationWindowStart: '2030-01-01T12:06:00.000Z',
    activationWindowEnd: '2030-01-01T12:36:00.000Z',
    confirmation: ENABLE_CONFIRMATION,
    humanOperatorPresent: true,
    restorationOwnerPresent: true
  };
  const executionLedger = createInitialExecutionLedger({
    runId: RUN_ID,
    bindings,
    provenance,
    admission: {
      evidenceDigest: evidenceDigest(evidence),
      replayLedgerDigest: replayLedger.ledgerDigest,
      jitDigest: jitDigest(jit)
    },
    createdAt: jit.approvedAt
  });
  const runManifest = createExecutionRunManifest(executionLedger, {
    cohortDigest,
    firebaseAppIdHash: appIdHash(FIREBASE_APP_ID),
    publicKeySpki,
    d3CloseoutDigest: d3CloseoutDigest(),
    issuedAt: jit.approvedAt,
    expiresAt: jit.expiresAt
  });
  const controlPlaneDeployment = deployedControlPlane();
  const budget = expectedBudget();
  const readiness = {
    schemaVersion: 2,
    environment: 'production',
    projectId: 'trade-list-a4297',
    approvalGroup: 'E',
    cohortStage: 'client-foundation-canary',
    mode: 'durable-at-most-once-admission',
    cohortDigest,
    bindings,
    d3Closeout: D3_CLOSEOUT,
    evidence,
    replayLedger,
    replayLedgerDigest: replayLedger.ledgerDigest,
    jit,
    provenance,
    securityBoundary: SECURITY_BOUNDARY,
    startingGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    clientControllerContract: clientControllerContract(),
    budget,
    executionSequence: [
      'create-run', 'commit-A-dispatch', 'A-read', 'verify-session-boundary', 'create-A-reconciliation',
      'commit-B-dispatch', 'B-read', 'create-B-reconciliation', 'restore', 'observe', 'create-closeout'
    ],
    runManifest,
    executionLedgerDigest: executionLedger.transitionDigest,
    controlPlaneDeploymentDigest: controlPlaneDeployment.deploymentDigest,
    observationPolicy: {
      minimumMinutes: 30,
      targetMaximumMinutes: 60,
      closeoutGraceMinutes: 15,
      startAfterRestoration: true,
      extendOnAnomalyOrWrite: true
    },
    laterGroupsAuthorized: false,
    groupEAuthorized: true
  };
  const input = {
    environment: 'production',
    projectId: 'trade-list-a4297',
    approvalGroup: 'E',
    cohortStage: 'client-foundation-canary',
    mode: 'durable-at-most-once-admission',
    cohortDigest,
    bindings,
    d3Closeout: D3_CLOSEOUT,
    evidenceDigest: evidenceDigest(evidence),
    replayLedgerDigest: replayLedger.ledgerDigest,
    runManifestDigest: runManifest.manifestDigest,
    executionLedgerDigest: executionLedger.transitionDigest,
    controlPlaneDeploymentDigest: controlPlaneDeployment.deploymentDigest,
    provenance,
    securityBoundary: SECURITY_BOUNDARY,
    currentGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    clientControllerContract: clientControllerContract(),
    budget,
    e2Reachable: false,
    readRateLimiterMode: 'group-e-synthetic-read-v1',
    normalDurableLimiterChanged: false,
    confirmation: ENABLE_CONFIRMATION
  };
  return { readiness, input, executionLedger, controlPlaneDeployment };
}

test('Group E guard accepts exact schema-v2 evidence, pristine immutable ledger, and deployed control proof', () => {
  const value = fixture();
  const result = validateGroupEGuard(value.readiness, value.input, {
    now: NOW,
    executionLedger: value.executionLedger,
    controlPlaneDeployment: value.controlPlaneDeployment
  });
  assert.equal(result.ok, true);
  assert.equal(result.cohortSize, 2);
  assert.equal(result.executionAuthorized, true);
  assert.equal(result.executionStage, STAGES.A_READY);
  assert.equal(result.nextOperation, 'ENABLE_GATES_AND_COMMIT_A_DISPATCH');
  assert.equal(result.controlDatabaseId, 'e1-group-e-control');
  assert.deepEqual(result.budget, expectedBudget());
});

test('legacy booleans, stale evidence, substitution, missing deployment, and non-pristine execution fail closed', () => {
  const mutations = [
    ({ readiness }) => { readiness.schemaVersion = 1; readiness.mode = 'synthetic-canary'; },
    ({ readiness }) => { readiness.approvalGroup = 'D'; },
    ({ readiness }) => { readiness.bindings.B.uidHash = readiness.bindings.A.uidHash; },
    ({ readiness }) => { readiness.evidence[0].expiresAt = '2030-01-01T12:05:00.000Z'; },
    ({ readiness }) => { readiness.evidence[0] = { ...readiness.evidence[0], samePageRuntime: true,
      existingAppCheckInstanceReused: true, limitedUseTokenAcquired: true }; },
    ({ readiness }) => { readiness.evidence[0].appCheckProvenance.debugTokenGlobalAbsent = false; },
    ({ readiness }) => { readiness.evidence[0].appCheckProvenance.limitedUseToken.sentToCallable = true; },
    ({ readiness }) => { readiness.replayLedger.entries[0].runtimeProofDigest = 'f'.repeat(64); },
    ({ readiness }) => { readiness.runManifest.provenance.gatewaySourceSha = '0'.repeat(40); },
    ({ readiness }) => { readiness.securityBoundary.providerLinkRoutePresent = true; },
    ({ executionLedger }) => { executionLedger.stage = STAGES.A_DISPATCH_COMMITTED; },
    ({ controlPlaneDeployment }) => { controlPlaneDeployment.status = 'NOT_CREATED'; }
  ];
  for (const mutate of mutations) {
    const value = clone(fixture());
    mutate(value);
    assert.throws(() => validateGroupEGuard(value.readiness, value.input, {
      now: NOW,
      executionLedger: value.executionLedger,
      controlPlaneDeployment: value.controlPlaneDeployment
    }));
  }
  const value = fixture();
  assert.throws(() => validateGroupEGuard(value.readiness, value.input, {
    now: NOW,
    executionLedger: value.executionLedger,
    controlPlaneDeployment: null
  }), /group_e_control_deployment_absent/);
});

test('expected and hard budgets reject any expansion or application write allowance', () => {
  for (const [field, value] of [
    ['expectedControlWrites', 5],
    ['phaseEIdentityWrites', 1],
    ['rtdbUserDataWrites', 1],
    ['ordinaryUserWrites', 1],
    ['maxAdmittedA', 2],
    ['maxSuccessfulReads', 3]
  ]) {
    const fixtureValue = fixture();
    fixtureValue.readiness.budget = { ...fixtureValue.readiness.budget, [field]: value };
    assert.throws(() => validateGroupEGuard(fixtureValue.readiness, fixtureValue.input, {
      now: NOW,
      executionLedger: fixtureValue.executionLedger,
      controlPlaneDeployment: fixtureValue.controlPlaneDeployment
    }), /group_e_budget_invalid/);
  }
});

test('private guard requires five mode-0600 records and a mode-0700 immutable ledger directory', () => {
  const value = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-e-guard-'));
  const ledgerDirectory = path.join(root, 'execution-ledger');
  initializeLedgerDirectory(ledgerDirectory, value.executionLedger);
  const artifacts = {
    readiness: value.readiness,
    input: value.input,
    evidence: value.readiness.evidence,
    jit: value.readiness.jit,
    replayLedger: value.readiness.replayLedger,
    controlDeployment: value.controlPlaneDeployment
  };
  const paths = { executionLedgerPath: ledgerDirectory };
  try {
    for (const [name, artifact] of Object.entries(artifacts)) {
      const file = path.join(root, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(artifact), { mode: 0o600 });
      paths[`${name}Path`] = file;
    }
    assert.equal(guardProductionClientFoundation(value.input, { ...paths, now: NOW }).ok, true);
    fs.chmodSync(paths.evidencePath, 0o644);
    assert.throws(() => guardProductionClientFoundation(value.input, { ...paths, now: NOW }),
      /group_e_private_artifact_mode_invalid/);
    fs.chmodSync(paths.evidencePath, 0o600);
    fs.chmodSync(ledgerDirectory, 0o755);
    assert.throws(() => guardProductionClientFoundation(value.input, { ...paths, now: NOW }),
      /group_e_private_artifact_mode_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore confirmation and disabled plan remain independent of expired JIT and control-store availability', () => {
  assert.equal(RESTORE_CONFIRMATION, 'RESTORE E1 GROUP E CLIENT FOUNDATION GATES');
  assert.equal(ENABLE_CONFIRMATION, 'ENABLE E1 GROUP E CLIENT FOUNDATION CANARY');
  assert.deepEqual(disabledGatePlan(), {
    CLIENT_FOUNDATION_USE_ENABLED: false,
    GATEWAY_INVOCATION_ENABLED: false,
    READ_ACCOUNT_FOUNDATION_ENABLED: false,
    RESERVE_HANDLE_ENABLED: false,
    REPAIR_FOUNDATION_ENABLED: false,
    APPLY_MIGRATION_ENABLED: false,
    FREEZE_CONFLICT_ENABLED: false,
    READ_PROOF_MODE: false
  });
});

test('closeout separates five execution writes from one post-observation closeout write', () => {
  const value = {
    schemaVersion: 3,
    cohortDigest: 'c'.repeat(64),
    execution: {
      startAt: '2030-01-01T12:55:00.000Z',
      endAt: '2030-01-01T13:00:00.000Z',
      gatewayInvocations: 2,
      admittedClaims: 2,
      authorityCalls: 2,
      successfulReads: 2,
      controlWritesBeforeCloseout: 5,
      phaseEIdentityWrites: 0,
      rtdbUserDataWrites: 0,
      ordinaryUserWrites: 0,
      stateDigest: D3_CLOSEOUT.stateDigest,
      d3DocumentCount: 32,
      gatesRestored: true
    },
    postRestorationObservation: {
      startAt: '2030-01-01T13:00:00.000Z',
      endAt: '2030-01-01T14:01:00.000Z',
      durationMinutes: 61,
      additionalGatewayInvocations: 0,
      additionalAdmittedClaims: 0,
      additionalAuthorityCalls: 0,
      additionalSuccessfulReads: 0,
      closeoutControlWrites: 1,
      totalControlWrites: 6,
      phaseEIdentityWrites: 0,
      rtdbUserDataWrites: 0,
      ordinaryUserWrites: 0,
      gatesRestored: true,
      iamAndExposureStable: true,
      anomaliesAbsent: true
    },
    healthy: true
  };
  assert.deepEqual(validateGroupEObservation(value), { ok: true, healthy: true });
  for (const mutate of [
    (candidate) => { candidate.execution.admittedClaims = 3; },
    (candidate) => { candidate.execution.controlWritesBeforeCloseout = 6; },
    (candidate) => { candidate.postRestorationObservation.additionalGatewayInvocations = 1; },
    (candidate) => { candidate.postRestorationObservation.totalControlWrites = 5; },
    (candidate) => { candidate.postRestorationObservation.durationMinutes = 76;
      candidate.postRestorationObservation.endAt = '2030-01-01T14:16:00.000Z'; },
    (candidate) => { candidate.postRestorationObservation.gatesRestored = false; }
  ]) {
    const candidate = clone(value);
    mutate(candidate);
    assert.throws(() => validateGroupEObservation(candidate), /group_e_observation_invalid/);
  }
});
