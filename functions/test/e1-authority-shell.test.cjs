'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { STAGING: EXPECTED } = require('../e1-authority-service/e1TargetContracts');
const { FORBIDDEN_PROJECT_PERMISSIONS, GATES, assertRuntimeDependencies, createHandler, loadConfiguration, runtimeProbe } = require('../e1-authority-service/server');

function environment(overrides = {}) {
  return {
    APP_ENVIRONMENT: EXPECTED.environment,
    FIREBASE_PROJECT_ID: EXPECTED.projectId,
    EXPECTED_PROJECT_NUMBER: EXPECTED.projectNumber,
    FIRESTORE_DATABASE_ID: EXPECTED.databaseId,
    SERVICE_REGION: EXPECTED.region,
    AUTHORITY_SERVICE_NAME: EXPECTED.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: EXPECTED.runtimeServiceAccount,
    RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-tests',
    EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])),
    ...overrides
  };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return String(body); }, async json() { return body; } };
}

function invoke(handler, path, method = 'GET') {
  return new Promise((resolve) => {
    const output = new EventEmitter();
    output.writeHead = (status, headers) => { output.status = status; output.headers = headers; };
    output.end = (body) => resolve({ status: output.status, headers: output.headers, body: JSON.parse(body) });
    handler({ method, url: path }, output);
  });
}

test('shell configuration is explicit and all authority gates fail closed', () => {
  assert.deepEqual(loadConfiguration(environment()), {
    ...EXPECTED,
    rtdbDatabaseUrl: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    firebaseWebApiKey: 'synthetic-firebase-web-api-key-for-tests',
    operatorEmailHash: 'a'.repeat(64),
    operatorSubjectHash: 'b'.repeat(64),
    revision: 'local',
    readAccountFoundationEnabled: false,
    reserveTrainerHandleEnabled: false,
    repairAccountFoundationEnabled: false,
    applyMigrationManifestEnabled: false,
    freezeIdentityConflictEnabled: false,
    readProofMode: false,
    groupEClientMode: false,
    readLimiterMode: 'firestore-rolling-v1',
    readProof: null,
    groupE: {
      enabled: false,
      mode: 'disabled',
      start: null,
      end: null,
      cohortDigest: null,
      bindings: []
    },
    repairApprovalWindow: null,
    approvedMigrationManifestIds: []
  });
  assert.throws(() => loadConfiguration(environment({ FIRESTORE_DATABASE_ID: '(default)' })), /E1_CONFIGURATION_MISMATCH/);
  assert.equal(loadConfiguration(environment({ RESERVE_HANDLE_ENABLED: 'true' })).reserveTrainerHandleEnabled, true);
  assert.equal(loadConfiguration(environment({
    REPAIR_FOUNDATION_ENABLED: 'true',
    REPAIR_APPROVAL_WINDOW_START: '2030-01-01T00:00:00.000Z',
    REPAIR_APPROVAL_WINDOW_END: '2030-01-02T00:00:00.000Z'
  })).repairAccountFoundationEnabled, true);
  assert.throws(() => loadConfiguration(environment({
    REPAIR_FOUNDATION_ENABLED: 'true', APPLY_MIGRATION_ENABLED: 'true'
  })), /E1_OPERATION_GATE_INVALID/);
  assert.throws(() => loadConfiguration(environment({ READ_ACCOUNT_FOUNDATION_ENABLED: undefined })), /E1_OPERATION_GATE_INVALID/);
});

test('startup dependency check requires Firestore even while reserve remains disabled', () => {
  const configuration = loadConfiguration(environment());
  assert.throws(() => assertRuntimeDependencies(configuration, () => {
    throw new Error('synthetic missing dependency');
  }), /E1_RUNTIME_DEPENDENCY_MISSING/);
});

test('reserve-enabled startup fails closed when the transaction dependency is absent', () => {
  const configuration = loadConfiguration(environment({
    READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    RESERVE_HANDLE_ENABLED: 'true'
  }));
  assert.throws(() => assertRuntimeDependencies(configuration, () => {
    throw new Error('synthetic missing dependency');
  }), /E1_RUNTIME_DEPENDENCY_MISSING/);
  assert.equal(assertRuntimeDependencies(configuration, (request) => {
    assert.equal(request, '@google-cloud/firestore');
    return { Firestore: class Firestore {} };
  }), true);
});

test('runtime probe verifies identity named-database access and forbidden permissions without writes or count dependence', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/email')) return response(200, EXPECTED.runtimeServiceAccount);
    if (url.endsWith('/numeric-project-id')) return response(200, EXPECTED.projectNumber);
    if (url.endsWith('/token')) return response(200, { access_token: 'never-log-this-token', expires_in: 3599 });
    if (url.endsWith(`/databases/${EXPECTED.databaseId}`)) return response(200, { name: 'database' });
    if (url.includes('/documents/runtimeReadiness/e1-authority-sentinel')) return response(404, {});
    if (url.includes(':testIamPermissions')) return response(200, {});
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runtimeProbe(loadConfiguration(environment()), fetchImpl);
  assert.deepEqual(result, {
    runtimeIdentityVerified: true,
    firestoreConnected: true,
    requiredPermissionsVerified: true,
    forbiddenPermissionsGranted: false
  });
  assert.match(calls[0].url, /service-accounts\/default\/email$/u);
  assert.match(calls[1].url, /\/project\/numeric-project-id$/u);
  assert.match(calls[3].url, /databases\/phase-e-identity$/);
  assert.equal(calls[3].options.method, 'GET');
  assert.match(calls[4].url, /documents\/runtimeReadiness\/e1-authority-sentinel$/);
  assert.equal(calls[4].options.method, 'GET');
  assert.deepEqual(JSON.parse(calls[5].options.body).permissions, FORBIDDEN_PROJECT_PERMISSIONS);
  assert.equal(calls.some((call) => call.url.includes('listCollectionIds')), false);
  assert.equal(calls.some((call) => /firebaseio|firebasedatabase\.app/.test(call.url)), false);
  assert.equal(calls.filter((call) => /documents\/[^:]+$/u.test(call.url)).length, 1);
});

test('runtime probe fails closed for wrong identity missing database access and forbidden capability', async () => {
  const configuration = loadConfiguration(environment());
  const probe = (overrides = {}) => runtimeProbe(configuration, async (url) => {
    if (url.endsWith('/email')) return response(200, overrides.email || EXPECTED.runtimeServiceAccount);
    if (url.endsWith('/numeric-project-id')) return response(200, overrides.projectNumber || EXPECTED.projectNumber);
    if (url.endsWith('/token')) return response(200, { access_token: 'never-log-this-token' });
    if (url.endsWith(`/databases/${EXPECTED.databaseId}`)) return response(overrides.firestoreStatus || 200, {});
    if (url.includes('/documents/runtimeReadiness/e1-authority-sentinel')) return response(overrides.sentinelStatus || 404, {});
    if (url.includes(':testIamPermissions')) return response(200, { permissions: overrides.permissions || [] });
    throw new Error(`unexpected URL ${url}`);
  });
  await assert.rejects(probe({ email: 'wrong-runtime@example.test' }), /E1_RUNTIME_IDENTITY_MISMATCH/);
  await assert.rejects(probe({ projectNumber: '999999999999' }), /E1_RUNTIME_PROJECT_MISMATCH/);
  await assert.rejects(probe({ firestoreStatus: 403 }), /E1_FIRESTORE_UNAVAILABLE/);
  await assert.rejects(probe({ permissions: ['run.routes.invoke'] }), /E1_FORBIDDEN_PERMISSION_PRESENT/);
});

test('ready is healthy for empty or populated authority data and unhealthy when a required dependency fails', async () => {
  const config = loadConfiguration(environment());
  for (const applicationState of ['empty', 'valid-foundation-present']) {
    const handler = createHandler(config, {
      runtimeProbe: async () => ({
        runtimeIdentityVerified: true,
        firestoreConnected: true,
        requiredPermissionsVerified: true,
        forbiddenPermissionsGranted: false,
        applicationState
      })
    });
    const result = await invoke(handler, '/ready');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      status: 'ready', runtimeIdentity: 'verified', firestore: 'connected', permissions: 'bounded', rtdbTarget: 'validated'
    });
  }
  const unavailable = createHandler(config, {
    runtimeProbe: async () => { const error = new Error('E1_FIRESTORE_UNAVAILABLE'); error.code = 'E1_FIRESTORE_UNAVAILABLE'; throw error; }
  });
  assert.deepEqual(await invoke(unavailable, '/ready'), {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 23 },
    body: { code: 'E1_NOT_READY' }
  });
});

test('shell exposes only health readiness and a fixed disabled operation surface', async () => {
  const config = loadConfiguration(environment());
  const handler = createHandler(config, { runtimeProbe: async () => ({
    runtimeIdentityVerified: true, firestoreConnected: true, requiredPermissionsVerified: true, forbiddenPermissionsGranted: false
  }) });
  assert.deepEqual(await invoke(handler, '/health'), {
    status: 200,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 20 },
    body: { status: 'healthy' }
  });
  assert.equal((await invoke(handler, '/ready')).status, 200);
  assert.equal((await invoke(handler, '/healthz')).status, 404);
  assert.equal((await invoke(handler, '/readyz')).status, 404);
  assert.deepEqual((await invoke(handler, '/operations')).body, { code: 'E1_NOT_ENABLED' });
  assert.equal((await invoke(handler, '/reserveTrainerHandle')).status, 404);
  assert.equal((await invoke(handler, '/health', 'POST')).status, 405);
});
