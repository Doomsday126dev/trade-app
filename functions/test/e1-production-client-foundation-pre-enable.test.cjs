'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  appIdHash,
  capabilityDigest,
  createPreEnableAbort,
  sessionGenerationContext,
  sessionGenerationDigest,
  subjectHash
} = require('../e1-gateway/groupEAdmission');
const { readProofSubjectHash } = require('../e1-authority-service/readRateLimiters');
const {
  APP_CHECK_MODE,
  appCheckRuntimeProofDigest
} = require('../production/e1ProductionThirdMutationBrowserHarness.cjs');
const {
  D3_CLOSEOUT,
  ENABLE_CONFIRMATION,
  activationGatePlan,
  bindingDigest,
  clientControllerContract,
  d3CloseoutDigest,
  disabledGatePlan,
  evidenceDigest,
  expectedBudget,
  jitDigest,
  replayLedgerDigest,
  validateGroupEGuard
} = require('../production/e1ProductionClientFoundationGuard.cjs');
const {
  LEGACY_OPERATOR_STATE_KEY,
  OPERATOR_LEASE_KEY,
  buildBrowserActionScript,
  buildPreDispatchReadinessScript,
  validatePreDispatchReadiness
} = require('../production/e1ProductionClientFoundationBrowserOperator.cjs');
const {
  SECURITY_BOUNDARY,
  STAGES,
  createExecutionRunManifest,
  createInitialExecutionLedger,
  initializeLedgerDirectory,
  createSignedSlotCapability,
  recordDispatch,
  recordEnablementStarted,
  recordPreEnableAbort,
  ZERO_WRITES
} = require('../production/e1ProductionClientFoundationExecution.cjs');
const { commitGroupEEnablementStart } = require('../scripts/deploy-e1-production-gateway.cjs');
const {
  canonicalIamPlan,
  deploymentDigest,
  expectedRulesDigest,
  loadControlPlanePlan
} = require('../production/e1GroupEControlPlane.cjs');

const NOW = Date.parse('2030-01-01T12:10:00.000Z');
const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const GENERATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const JTI = '323e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = '423e4567-e89b-42d3-a456-426614174000';
const FIREBASE_APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const ORIGIN = 'https://doomsday126dev.github.io';
const PATHNAME = '/trade-app/';
const RAW_SUBJECTS = Object.freeze({
  A: Object.freeze({ uid: 'synthetic-group-e-uid-a', trainer: 'SyntheticGroupEA' }),
  B: Object.freeze({ uid: 'synthetic-group-e-uid-b', trainer: 'SyntheticGroupEB' })
});
const PROVENANCE = Object.freeze({
  toolingSourceSha: '38e76d18bb6c75a0299b27b695f6f971cb98e5d6',
  pagesReleaseId: '2026-08-25.59',
  pagesSourceSha: '38e76d18bb6c75a0299b27b695f6f971cb98e5d6',
  pagesArtifactDigest: '51a5eec23cba73c6e3a174d0032a7ca5b90c5fba86b200f2143ccac9de1b5ab2',
  gatewaySourceSha: 'ad2edab9be2b1c0e6851dfded3a0f3f71a73b987',
  gatewaySourceFingerprint: '6efaab14358355cd2afc8a790a2cace4ae13f394f095f34a5b9c4adf2c8a5258',
  authorityRevision: 'e1-identity-authority-00055-jlz',
  authorityImageDigest: 'sha256:19c7574cb89f25cd7ad710941df63bd32ab41e0e7af3ead236c5641e5b8bd753'
});
const browserSource = fs.readFileSync(path.resolve(__dirname, '../../js/services/e1ClientFoundationCanary.js'), 'utf8');

function loadBrowserRuntime() {
  const runtimeCrypto = {
    subtle: crypto.webcrypto.subtle,
    getRandomValues(value) {
      assert.equal(value.byteLength, 32);
      value.set(Uint8Array.from({ length: 32 }, (_, index) => index));
      return value;
    }
  };
  const window = {
    crypto: runtimeCrypto,
    location: { origin: ORIGIN, pathname: PATHNAME },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64')
  };
  vm.runInNewContext(browserSource, { window, TextEncoder, Uint8Array, setTimeout, clearTimeout });
  return Object.freeze({ runtimeCrypto, service: window.PogoServices.e1ClientFoundationCanary, window });
}

function loadBrowserService() {
  return loadBrowserRuntime().service;
}

function runtimeProvenance(slot, index, bindings, cohortDigest) {
  const base = Date.parse(`2030-01-01T12:0${index + 1}:00.000Z`);
  const at = (offset) => new Date(base + offset).toISOString();
  const stage = (start, outcome = 'resolved') => ({ startedAt: at(start), settledAt: at(start + 1000), outcome });
  const value = {
    slot,
    origin: ORIGIN,
    pathname: PATHNAME,
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
      tokenFingerprint: String(index + 5).repeat(64),
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

async function buildGoldenAssembly(mutate = () => {}, options = {}) {
  const browser = loadBrowserService();
  const bindings = {};
  for (const slot of ['A', 'B']) {
    bindings[slot] = {
      uidHash: await browser.subjectHash('uid', RAW_SUBJECTS[slot].uid, crypto.webcrypto),
      trainerHash: await browser.subjectHash('trainer', RAW_SUBJECTS[slot].trainer, crypto.webcrypto)
    };
    assert.equal(bindings[slot].uidHash, subjectHash('uid', RAW_SUBJECTS[slot].uid));
    assert.equal(bindings[slot].trainerHash, subjectHash('trainer', RAW_SUBJECTS[slot].trainer));
  }
  const cohortDigest = bindingDigest(bindings);
  const evidence = ['A', 'B'].map((slot, index) => ({
    schemaVersion: 2,
    slot,
    capturedAt: `2030-01-01T12:0${index + 3}:00.000Z`,
    expiresAt: `2030-01-01T12:1${index + 8}:00.000Z`,
    pagesReleaseId: PROVENANCE.pagesReleaseId,
    pagesSourceSha: PROVENANCE.pagesSourceSha,
    pagesArtifactDigest: PROVENANCE.pagesArtifactDigest,
    uidHash: bindings[slot].uidHash,
    trainerHash: bindings[slot].trainerHash,
    cohortDigest,
    browserContextHash: String(index + 7).repeat(64),
    appCheckMode: APP_CHECK_MODE,
    appCheckProvenance: runtimeProvenance(slot, index, bindings, cohortDigest),
    callableConstructed: false,
    callableInvoked: false,
    credentialsOrTokensPersisted: false,
    sanitizedSentinel: (index === 0 ? '9' : 'a').repeat(16)
  }));
  const replayLedger = {
    schemaVersion: 1,
    cohortDigest,
    generationId: '523e4567-e89b-42d3-a456-426614174000',
    createdAt: '2030-01-01T12:00:00.000Z',
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
    provenance: PROVENANCE,
    admission: {
      evidenceDigest: evidenceDigest(evidence),
      replayLedgerDigest: replayLedger.ledgerDigest,
      jitDigest: jitDigest(jit)
    },
    createdAt: jit.approvedAt
  });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const runManifest = createExecutionRunManifest(executionLedger, {
    cohortDigest,
    firebaseAppIdHash: appIdHash(FIREBASE_APP_ID),
    publicKeySpki,
    d3CloseoutDigest: d3CloseoutDigest(),
    issuedAt: jit.approvedAt,
    expiresAt: jit.activationWindowEnd
  });
  const controlPlaneDeployment = deployedControlPlane();
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
    provenance: PROVENANCE,
    securityBoundary: SECURITY_BOUNDARY,
    startingGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    clientControllerContract: clientControllerContract(),
    budget: expectedBudget(),
    executionSequence: [
      'create-run', 'commit-enablement-start', 'commit-A-dispatch', 'A-read', 'verify-session-boundary', 'create-A-reconciliation',
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
    provenance: PROVENANCE,
    securityBoundary: SECURITY_BOUNDARY,
    currentGates: disabledGatePlan(),
    activationGatePlan: activationGatePlan(),
    restorationGatePlan: disabledGatePlan(),
    clientControllerContract: clientControllerContract(),
    budget: expectedBudget(),
    e2Reachable: false,
    readRateLimiterMode: 'group-e-synthetic-read-v1',
    normalDurableLimiterChanged: false,
    confirmation: ENABLE_CONFIRMATION
  };
  const assembly = {
    browser, bindings, cohortDigest, evidence, replayLedger, jit, executionLedger, runManifest,
    controlPlaneDeployment, readiness, input, privateKeyPem
  };
  mutate(assembly);
  const guard = validateGroupEGuard(readiness, input, { now: NOW, executionLedger, controlPlaneDeployment });
  const startedLedger = recordEnablementStarted(executionLedger, runManifest, {
    startedAt: new Date(NOW).toISOString(),
    jit
  });
  const continuedGuard = validateGroupEGuard(readiness, input, {
    now: Date.parse('2030-01-01T12:22:00.000Z'),
    executionLedger: startedLedger,
    controlPlaneDeployment
  });

  const browserContextDigest = await browser.browserContextDigest(ORIGIN, PATHNAME, FIREBASE_APP_ID, crypto.webcrypto);
  const runtimeInstanceDigest = await browser.runtimeInstanceDigest(runManifest.firebaseAppIdHash);
  const dispatchContext = {
    schemaVersion: 1,
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: RUN_ID,
    cohortDigest,
    slot: 'A',
    uidHash: bindings.A.uidHash,
    trainerHash: bindings.A.trainerHash,
    generationId: GENERATION_ID,
    sessionGeneration: 10,
    firebaseAppIdHash: runManifest.firebaseAppIdHash,
    browserContextDigest,
    runtimeInstanceDigest
  };
  const dispatch = {
    slot: 'A',
    generationId: GENERATION_ID,
    sessionGeneration: 10,
    jti: JTI,
    attemptId: ATTEMPT_ID,
    browserContextDigest,
    runtimeInstanceDigest,
    sessionGenerationDigest: sessionGenerationDigest(sessionGenerationContext(dispatchContext)),
    committedAt: '2030-01-01T12:10:00.000Z'
  };
  if (options.stopBeforeDispatch === true) {
    return { ...assembly, guard, startedLedger, continuedGuard, dispatchContext, dispatch };
  }
  const dispatchedLedger = recordDispatch(startedLedger, runManifest, dispatch);
  const storedEnvelope = createSignedSlotCapability(dispatchedLedger, runManifest, {
    slot: 'A',
    jti: JTI,
    attemptId: ATTEMPT_ID,
    expiresAt: '2030-01-01T12:25:00.000Z'
  }, privateKeyPem);
  const configuration = browser.browserConfigurationFromStoredEnvelope(storedEnvelope);
  const counters = { appCheck: 0, sdkImports: 0, callables: 0, cloud: 0, iam: 0, persistedFiles: 0 };
  const controller = browser.createClientFoundationCanary({
    firebaseApp: { options: { appId: FIREBASE_APP_ID } },
    auth: { currentUser: { uid: RAW_SUBJECTS.A.uid } },
    firebaseAppCheckReady: async () => { counters.appCheck++; return { ok: false }; },
    getSessionGeneration: () => 10,
    getBrowserContextDigest: () => browserContextDigest,
    importFunctionsSdk: async () => { counters.sdkImports++; return {}; },
    cryptoImpl: crypto.webcrypto,
    timeoutMs: 1000,
    now: () => NOW
  });
  const opened = await controller.open(configuration);
  const result = Object.freeze({
    status: 'READY_TO_ENABLE',
    guardAccepted: guard.ok,
    executionStage: guard.executionStage,
    envelopeFields: Object.keys(storedEnvelope).length,
    browserConfigurationFields: Object.keys(configuration).length,
    capabilityDigestProjectedToBrowser: Object.hasOwn(configuration, 'capabilityDigest'),
    openedSlot: opened.slot,
    callableConstructed: counters.callables,
    firebaseSdkImports: counters.sdkImports,
    appCheckOperations: counters.appCheck,
    cloudOperations: counters.cloud,
    iamOperations: counters.iam,
    persistedFiles: counters.persistedFiles
  });
  return { ...assembly, guard, startedLedger, continuedGuard, dispatchedLedger, storedEnvelope, configuration,
    controller, counters, result };
}

test('production-exact Group E pre-enable golden path reaches READY_TO_ENABLE with zero side effects', async () => {
  const value = await buildGoldenAssembly();
  assert.deepEqual(value.result, {
    status: 'READY_TO_ENABLE',
    guardAccepted: true,
    executionStage: STAGES.A_READY,
    envelopeFields: 5,
    browserConfigurationFields: 4,
    capabilityDigestProjectedToBrowser: false,
    openedSlot: 'A',
    callableConstructed: 0,
    firebaseSdkImports: 0,
    appCheckOperations: 0,
    cloudOperations: 0,
    iamOperations: 0,
    persistedFiles: 0
  });
  assert.equal(value.storedEnvelope.capabilityDigest, capabilityDigest(value.storedEnvelope.capability));
  assert.equal(Object.hasOwn(value.configuration, 'capabilityDigest'), false);
  assert.deepEqual(value.guard.bindings, value.bindings);
  assert.equal(value.guard.cohortDigest, value.cohortDigest);
  assert.deepEqual(value.guard.budget, expectedBudget());
  assert.deepEqual(value.guard.activationGatePlan, activationGatePlan());
  assert.equal(value.runManifest.admissionEvidenceDigest, evidenceDigest(value.evidence));
  assert.equal(value.runManifest.preCallReplayLedgerDigest, value.replayLedger.ledgerDigest);
  assert.equal(value.executionLedger.admission.jitDigest, jitDigest(value.jit));
  assert.equal(value.guard.executionLedgerDigest, value.executionLedger.transitionDigest);
  assert.equal(value.startedLedger.stage, STAGES.ENABLEMENT_STARTED);
  assert.equal(value.continuedGuard.enablementStarted, true);
  assert.equal(value.continuedGuard.executionLedgerDigest, value.startedLedger.transitionDigest);
  assert.equal(Date.parse(value.continuedGuard.enablementStartedAt) < Date.parse(value.jit.expiresAt), true);
  assert.equal(value.guard.keyId, value.runManifest.keyId);
  assert.equal(value.storedEnvelope.capability.runManifestDigest, value.runManifest.manifestDigest);
  assert.equal(value.storedEnvelope.capability.dispatchLedgerDigest, value.dispatchedLedger.transitionDigest);
  const sanitized = JSON.stringify(value.result);
  for (const subject of Object.values(RAW_SUBJECTS)) {
    assert.equal(sanitized.includes(subject.uid), false);
    assert.equal(sanitized.includes(subject.trainer), false);
  }
});

test('deployment helper atomically commits the enablement-start marker before any cloud operation', async () => {
  const value = await buildGoldenAssembly();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-e-enable-start-'));
  const ledger = path.join(root, 'ledger');
  const readinessPath = path.join(root, 'readiness.json');
  try {
    initializeLedgerDirectory(ledger, value.executionLedger, { mode: 'apply' });
    fs.writeFileSync(readinessPath, JSON.stringify(value.readiness), { mode: 0o600 });
    fs.chmodSync(readinessPath, 0o600);
    const result = commitGroupEEnablementStart(value.guard, {
      now: NOW,
      groupEPaths: { readinessPath, executionLedgerPath: ledger }
    });
    assert.equal(result.written, true);
    assert.equal(result.ledger.stage, STAGES.ENABLEMENT_STARTED);
    assert.equal(result.ledger.priorTransitionDigest, value.executionLedger.transitionDigest);
    assert.equal(result.ledger.updatedAt, new Date(NOW).toISOString());
    assert.equal(value.counters.cloud, 0);
    assert.throws(() => commitGroupEEnablementStart(value.guard, {
      now: NOW,
      groupEPaths: { readinessPath, executionLedgerPath: ledger }
    }), /group_e_ledger_stale_writer/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('production-exact pre-enable expiry closes a pristine run without A/B execution or observation', async () => {
  const value = await buildGoldenAssembly();
  assert.throws(() => validateGroupEGuard(value.readiness, value.input, {
    now: Date.parse(value.jit.expiresAt),
    executionLedger: value.executionLedger,
    controlPlaneDeployment: value.controlPlaneDeployment
  }), /group_e_evidence_invalid|group_e_jit_invalid/);
  const abort = createPreEnableAbort({
    runId: value.runManifest.runId,
    runManifestDigest: value.runManifest.manifestDigest,
    executionLedgerDigest: value.executionLedger.transitionDigest,
    reason: 'TIMING_EXPIRED_BEFORE_ENABLEMENT',
    gates: disabledGatePlan(),
    prohibitedWrites: ZERO_WRITES,
    aDispatchAbsent: true,
    consumptionsAbsent: true,
    reconciliationsAbsent: true,
    createdAt: value.jit.expiresAt
  });
  const closed = recordPreEnableAbort(value.executionLedger, value.runManifest, abort,
    { controlRecordCreated: true });
  assert.equal(closed.stage, STAGES.PRE_ENABLE_ABORTED);
  assert.equal(closed.remainingAdmittedBudget, 0);
  assert.equal(closed.dispatches.A, null);
  assert.equal(closed.dispatches.B, null);
  assert.throws(() => recordDispatch(closed, value.runManifest, {}), /group_e_dispatch_invalid/);
});

test('Group E evidence uses its canonical subject domain and D3 remains distinct and unchanged', async () => {
  const browser = loadBrowserService();
  for (const [kind, value] of [['uid', RAW_SUBJECTS.A.uid], ['trainer', RAW_SUBJECTS.A.trainer]]) {
    const groupE = subjectHash(kind, value);
    assert.equal(await browser.subjectHash(kind, value, crypto.webcrypto), groupE);
    assert.notEqual(groupE, readProofSubjectHash(kind, value));
    assert.equal(readProofSubjectHash(kind, value),
      crypto.createHash('sha256').update(JSON.stringify([1, 'group-c-read-proof', kind, value]), 'utf8').digest('hex'));
  }
  await assert.rejects(browser.subjectHash('other', 'value', crypto.webcrypto), /group-e\/subject-invalid/);
  await assert.rejects(browser.subjectHash('uid', '', crypto.webcrypto), /group-e\/subject-invalid/);
});

test('pre-enable rehearsal rejects binding, digest, provenance, key, and projection substitutions', async () => {
  const d3Hash = readProofSubjectHash('uid', RAW_SUBJECTS.A.uid);
  await assert.rejects(buildGoldenAssembly(({ evidence }) => {
    evidence[0].uidHash = d3Hash;
    evidence[0].appCheckProvenance.uidHash = d3Hash;
    evidence[0].appCheckProvenance.runtimeProofDigest = appCheckRuntimeProofDigest(evidence[0].appCheckProvenance);
  }), /group_e_evidence_binding_invalid/);
  await assert.rejects(buildGoldenAssembly(({ evidence }) => {
    [evidence[0].uidHash, evidence[1].uidHash] = [evidence[1].uidHash, evidence[0].uidHash];
    [evidence[0].trainerHash, evidence[1].trainerHash] = [evidence[1].trainerHash, evidence[0].trainerHash];
    for (const entry of evidence) {
      entry.appCheckProvenance.uidHash = entry.uidHash;
      entry.appCheckProvenance.trainerHash = entry.trainerHash;
      entry.appCheckProvenance.runtimeProofDigest = appCheckRuntimeProofDigest(entry.appCheckProvenance);
    }
  }), /group_e_evidence_binding_invalid/);
  for (const [name, mutate] of [
    ['evidence digest', ({ input }) => { input.evidenceDigest = '0'.repeat(64); }],
    ['run manifest digest', ({ readiness }) => { readiness.runManifest.manifestDigest = '0'.repeat(64); }],
    ['JIT digest', ({ executionLedger }) => { executionLedger.admission.jitDigest = '0'.repeat(64); }],
    ['ledger digest', ({ readiness }) => { readiness.executionLedgerDigest = '0'.repeat(64); }],
    ['key ID', ({ readiness }) => { readiness.runManifest.keyId = '0'.repeat(64); }],
    ['release', ({ evidence }) => { evidence[0].pagesReleaseId = '2026-08-25.58'; }],
    ['source', ({ evidence }) => { evidence[0].pagesSourceSha = '0'.repeat(40); }],
    ['artifact', ({ evidence }) => { evidence[0].pagesArtifactDigest = '0'.repeat(64); }]
  ]) {
    await assert.rejects(buildGoldenAssembly(mutate), undefined, name);
  }

  const value = await buildGoldenAssembly();
  assert.throws(() => value.browser.browserConfigurationFromStoredEnvelope({ ...value.storedEnvelope, extra: true }),
    /group-e\/configuration-invalid/);
  await assert.rejects(value.controller.open(value.storedEnvelope), /group-e\/configuration-invalid/);
  for (const field of ['schemaVersion', 'capability', 'signature', 'publicKeySpki']) {
    const missing = { ...value.configuration };
    delete missing[field];
    await assert.rejects(value.controller.open(missing), /group-e\/configuration-invalid/);
  }
  assert.deepEqual(value.counters, {
    appCheck: 0,
    sdkImports: 0,
    callables: 0,
    cloud: 0,
    iam: 0,
    persistedFiles: 0
  });
});

test('stateful golden path rejects the legacy stale operator before dispatch and reaches exact delivery open after correction', async () => {
  const value = await buildGoldenAssembly(() => {}, { stopBeforeDispatch: true });
  const { runtimeCrypto, service, window } = loadBrowserRuntime();
  class Button {
    constructor(document) {
      this.document = document;
      this.dataset = {};
      this.style = {};
      this.disabled = false;
      this.textContent = '';
      this.listeners = new Map();
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    async click() { return this.listeners.get('click')?.(); }
    remove() { this.document.buttons = this.document.buttons.filter((entry) => entry !== this); }
  }
  const document = {
    buttons: [],
    createElement(name) {
      assert.equal(name, 'button');
      return new Button(document);
    },
    querySelectorAll(name) { return name === 'button' ? [...document.buttons] : []; }
  };
  document.body = { appendChild(button) { document.buttons.push(button); } };
  let clipboard = '';
  const dispatch = value.dispatch;
  const expected = {
    releaseId: PROVENANCE.pagesReleaseId,
    sourceSha: PROVENANCE.pagesSourceSha,
    origin: ORIGIN,
    pathname: PATHNAME,
    runId: RUN_ID,
    cohortDigest: value.cohortDigest,
    slot: 'A',
    uidHash: value.bindings.A.uidHash,
    trainerHash: value.bindings.A.trainerHash,
    generationId: dispatch.generationId,
    sessionGeneration: dispatch.sessionGeneration,
    firebaseAppIdHash: value.runManifest.firebaseAppIdHash,
    browserContextDigest: dispatch.browserContextDigest,
    runtimeInstanceDigest: dispatch.runtimeInstanceDigest,
    sessionGenerationDigest: dispatch.sessionGenerationDigest
  };
  window.__POGO_RELEASE_ID = PROVENANCE.pagesReleaseId;
  window.__groupELiveRuntimeRecord = Object.freeze({
    schemaVersion: 1,
    recordType: 'group-e-browser-session-context',
    releaseId: expected.releaseId,
    sourceSha: expected.sourceSha,
    environment: 'production',
    projectId: 'trade-list-a4297',
    runId: expected.runId,
    cohortDigest: expected.cohortDigest,
    slot: expected.slot,
    uidHash: expected.uidHash,
    trainerHash: expected.trainerHash,
    generationId: expected.generationId,
    sessionGeneration: expected.sessionGeneration,
    firebaseAppIdHash: expected.firebaseAppIdHash,
    browserContextDigest: expected.browserContextDigest,
    runtimeInstanceDigest: expected.runtimeInstanceDigest,
    sessionGenerationDigest: expected.sessionGenerationDigest,
    capturedAt: new Date(NOW).toISOString()
  });
  const auth = { currentUser: { uid: RAW_SUBJECTS.A.uid } };
  const fbApp = { options: { appId: FIREBASE_APP_ID } };
  const counters = { dispatches: 0, factories: 0, sdkImports: 0, appCheck: 0, callables: 0, cloud: 0, iam: 0 };
  const context = vm.createContext({
    window,
    location: window.location,
    document,
    navigator: { clipboard: { writeText: async (text) => { clipboard = text; } } },
    auth,
    fbApp,
    cur: RAW_SUBJECTS.A.trainer,
    _sessionTransientGeneration: dispatch.sessionGeneration,
    e1ClientFoundationCanary: null,
    crypto: runtimeCrypto,
    TextEncoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { log() {}, error() {} }
  });
  window.__pogoCreateGroupEClientFoundationCanary = async (storedEnvelope) => {
    counters.factories += 1;
    if (context.e1ClientFoundationCanary) context.e1ClientFoundationCanary.close();
    context.e1ClientFoundationCanary = service.createClientFoundationCanary({
      firebaseApp: fbApp,
      auth,
      firebaseAppCheckReady: async () => { counters.appCheck += 1; return { ok: false }; },
      getSessionGeneration: () => context._sessionTransientGeneration,
      getBrowserContextDigest: () => expected.browserContextDigest,
      importFunctionsSdk: async () => { counters.sdkImports += 1; return {}; },
      cryptoImpl: runtimeCrypto,
      timeoutMs: 1000,
      now: () => NOW
    });
    await context.e1ClientFoundationCanary.open(service.browserConfigurationFromStoredEnvelope(storedEnvelope));
    return context.e1ClientFoundationCanary;
  };

  window[LEGACY_OPERATOR_STATE_KEY] = 'GROUP E A RUNTIME CAPTURE';
  await assert.rejects(vm.runInContext(buildPreDispatchReadinessScript(expected), context),
    (error) => error.code === 'GROUP_E_STALE_OPERATOR_STATE');
  assert.equal(counters.dispatches, 0);
  assert.equal(clipboard, '');
  delete window[LEGACY_OPERATOR_STATE_KEY];

  await vm.runInContext(buildPreDispatchReadinessScript(expected), context);
  await new Promise((resolve) => setTimeout(resolve, 225));
  await document.buttons.at(-1).click();
  const copiedReadiness = JSON.parse(clipboard);
  const preDispatch = validatePreDispatchReadiness(copiedReadiness, expected,
    { now: Date.parse(copiedReadiness.capturedAt) });
  assert.equal(preDispatch.runtimeRecordMatched, true);
  assert.equal(preDispatch.callableConstructed, false);
  assert.equal(preDispatch.callableInvoked, false);
  assert.equal(Object.hasOwn(window, OPERATOR_LEASE_KEY), false);

  const committed = recordDispatch(value.startedLedger, value.runManifest, {
    slot: dispatch.slot,
    generationId: dispatch.generationId,
    sessionGeneration: dispatch.sessionGeneration,
    jti: JTI,
    attemptId: ATTEMPT_ID,
    browserContextDigest: dispatch.browserContextDigest,
    runtimeInstanceDigest: dispatch.runtimeInstanceDigest,
    sessionGenerationDigest: dispatch.sessionGenerationDigest,
    committedAt: dispatch.committedAt
  });
  counters.dispatches += 1;
  assert.equal(committed.stage, STAGES.A_DISPATCH_COMMITTED);
  assert.equal(committed.priorTransitionDigest, value.startedLedger.transitionDigest);
  const envelope = createSignedSlotCapability(committed, value.runManifest, {
    slot: 'A',
    jti: JTI,
    attemptId: ATTEMPT_ID,
    expiresAt: '2030-01-01T12:25:00.000Z'
  }, value.privateKeyPem);
  clipboard = '';
  const deliveryScript = buildBrowserActionScript({
    label: 'GROUP E A DELIVERY OPEN',
    body: `await window.__pogoCreateGroupEClientFoundationCanary(${JSON.stringify(envelope)});`,
    origin: ORIGIN,
    pathname: PATHNAME,
    releaseId: PROVENANCE.pagesReleaseId,
    requireCleanExecutionState: true
  });
  await vm.runInContext(deliveryScript, context);
  await document.buttons.at(-1).click();
  assert.equal(counters.dispatches, 1);
  assert.equal(counters.factories, 1);
  assert.equal(context.e1ClientFoundationCanary.isEnabled(), true);
  assert.equal(context.e1ClientFoundationCanary.isTerminal(), false);
  assert.equal(Object.hasOwn(window, OPERATOR_LEASE_KEY), false);
  assert.deepEqual(counters, {
    dispatches: 1,
    factories: 1,
    sdkImports: 0,
    appCheck: 0,
    callables: 0,
    cloud: 0,
    iam: 0
  });
  assert.equal(value.guard.ok, true);
  assert.equal(value.startedLedger.stage, STAGES.ENABLEMENT_STARTED);
});
