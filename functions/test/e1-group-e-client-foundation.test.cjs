'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { GATES, createHandler, loadConfiguration } = require('../e1-authority-service/server');
const { PRODUCTION } = require('../e1-authority-service/e1TargetContracts');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization');
const { createAuthorityInvoker, createGatewayOperation, loadGatewayConfiguration } = require('../e1-gateway/gatewayCore');
const { controlPaths, createGroupEControlStore } = require('../e1-gateway/groupEControlStore');
const { createAdmissionReceipt, responseBinding } = require('../e1-gateway/groupEAdmission');
const { createFixture } = require('./helpers/groupEFixture.cjs');

class FakeFirestore {
  constructor(seed = {}, callbackAttempts = 1) {
    this.documents = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
    this.callbackAttempts = callbackAttempts;
    this.callbackCount = 0;
    this.queue = Promise.resolve();
  }
  doc(documentPath) { return Object.freeze({ path: documentPath }); }
  async runTransaction(callback, options) {
    assert.deepEqual(options, { maxAttempts: 3 });
    let release;
    const prior = this.queue;
    this.queue = new Promise((resolve) => { release = resolve; });
    await prior;
    try {
      let result;
      for (let attempt = 0; attempt < this.callbackAttempts; attempt++) {
        const writes = [];
        const transaction = {
          get: async (reference) => ({ exists: this.documents.has(reference.path),
            data: () => structuredClone(this.documents.get(reference.path)) }),
          create: (reference, value) => writes.push([reference.path, structuredClone(value)])
        };
        this.callbackCount++;
        result = await callback(transaction);
        if (attempt === this.callbackAttempts - 1) {
          for (const [documentPath] of writes) {
            if (this.documents.has(documentPath)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
          }
          writes.forEach(([documentPath, value]) => this.documents.set(documentPath, value));
        }
      }
      return result;
    } finally { release(); }
  }
}

function bindingsValue(fixture) {
  return ['A', 'B'].map((slot) => `${fixture.bindings[slot].uidHash}:${fixture.bindings[slot].trainerHash}`).join(';');
}

function gatewayEnvironment(fixture, overrides = {}) {
  return {
    APP_ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'trade-list-a4297', SERVICE_REGION: 'us-central1',
    E1_AUTHORITY_URL: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/',
    E1_AUTHORITY_AUDIENCE: 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    E1_GATEWAY_SERVICE_ACCOUNT: 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    GATEWAY_INVOCATION_ENABLED: 'true', APP_CHECK_ENFORCEMENT_MODE: 'monitor',
    APP_CHECK_DEBUG_TOKENS_ALLOWED: 'false', E1_RATE_LIMIT_POLICY: 'firestore-rolling-v1', READ_PROOF_MODE: 'false',
    GROUP_E_CLIENT_MODE: 'synthetic-canary', GROUP_E_SUBJECT_BINDINGS: bindingsValue(fixture),
    GROUP_E_COHORT_DIGEST: fixture.cohortDigest, GROUP_E_RUN_ID: fixture.RUN_ID,
    GROUP_E_RUN_MANIFEST_DIGEST: fixture.run.manifestDigest, GROUP_E_KEY_ID: fixture.run.keyId,
    GROUP_E_PUBLIC_KEY_SPKI: fixture.publicKeySpki, GROUP_E_FIREBASE_APP_ID_HASH: fixture.run.firebaseAppIdHash,
    GROUP_E_CONTROL_DATABASE_ID: 'e1-group-e-control', ...overrides
  };
}

function authorityEnvironment(fixture, overrides = {}) {
  return {
    APP_ENVIRONMENT: PRODUCTION.environment, FIREBASE_PROJECT_ID: PRODUCTION.projectId,
    EXPECTED_PROJECT_NUMBER: '1053781218847', FIRESTORE_DATABASE_ID: PRODUCTION.databaseId,
    SERVICE_REGION: PRODUCTION.region, AUTHORITY_SERVICE_NAME: PRODUCTION.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT: PRODUCTION.runtimeServiceAccount, RTDB_DATABASE_URL: PRODUCTION.rtdbDatabaseUrl,
    FIREBASE_WEB_API_KEY: 'synthetic-production-firebase-web-key', EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64), K_REVISION: fixture.PROVENANCE.authorityRevision,
    ...Object.fromEntries(GATES.map((gate) => [gate, 'false'])), READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
    READ_PROOF_MODE: 'false', GROUP_E_CLIENT_MODE: 'synthetic-canary',
    GROUP_E_SUBJECT_BINDINGS: bindingsValue(fixture), GROUP_E_COHORT_DIGEST: fixture.cohortDigest,
    GROUP_E_RUN_ID: fixture.RUN_ID, GROUP_E_KEY_ID: fixture.run.keyId, ...overrides
  };
}

function callable(fixture, slot = 'A', overrides = {}) {
  return {
    auth: { uid: fixture.UID[slot] }, app: { appId: fixture.FIREBASE_APP_ID, alreadyConsumed: false },
    data: fixture.signedRequest(slot), rawRequest: { headers: { authorization: 'Bearer synthetic-firebase-id-token' } },
    ...overrides
  };
}

function authorityRequest(body, headers = {}) {
  const raw = JSON.stringify(body);
  const request = new EventEmitter();
  request.method = 'POST';
  request.url = '/v1/read-account-foundation';
  request.headers = { 'content-length': String(Buffer.byteLength(raw)),
    'x-firebase-id-token': 'synthetic-firebase-id-token',
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
  request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(raw); };
  return request;
}

function invokeAuthorityHandler(handler, body, headers = {}) {
  return new Promise((resolve) => {
    const response = new EventEmitter();
    response.writeHead = (status, responseHeaders) => { response.status = status; response.headers = responseHeaders; };
    response.end = (payload) => resolve({ ok: response.status >= 200 && response.status < 300,
      status: response.status, headers: response.headers, json: async () => JSON.parse(payload) });
    handler(authorityRequest(body, headers), response);
  });
}

function authorityDependencies(fixture, slot = 'A', overrides = {}) {
  return {
    now: () => fixture.NOW,
    verifyFirebaseIdToken: async (_configuration, token) => {
      assert.equal(token, 'synthetic-firebase-id-token');
      return { uid: fixture.UID[slot] };
    },
    readLegacyBinding: async () => ({ status: 'ready', username: fixture.TRAINER[slot], legacyAuthVersion: 1 }),
    readAccountDocument: async () => null, structuredLog() {}, ...overrides
  };
}

function seededStore(fixture, extra = {}, callbackAttempts = 1) {
  const firestore = new FakeFirestore(
    { [controlPaths(fixture.RUN_ID, 'A').run]: fixture.run, ...extra }, callbackAttempts
  );
  return { firestore, store: createGroupEControlStore(firestore) };
}

function authorityHeaders(fixture, receipt) {
  return { 'x-e1-client-mode': 'synthetic-canary', 'x-e1-cohort-digest': fixture.cohortDigest,
    'x-e1-run-id': fixture.RUN_ID, 'x-e1-key-id': fixture.run.keyId,
    'x-e1-admission-receipt-digest': receipt.receiptDigest };
}

test('retried A transaction binds current runtime to one marker and one post-commit authority call', async () => {
  const fixture = createFixture();
  const { firestore, store } = seededStore(fixture, {}, 3);
  const authority = createHandler(loadConfiguration(authorityEnvironment(fixture), () => fixture.NOW),
    authorityDependencies(fixture));
  let fetches = 0;
  let observedRequest;
  const configuration = loadGatewayConfiguration(gatewayEnvironment(fixture));
  const invokeAuthority = createAuthorityInvoker(configuration, {
    getOidcToken: async (audience) => {
      assert.equal(audience, 'https://e1-identity-authority-wrywkbfzya-uc.a.run.app');
      return 'synthetic-oidc-token';
    },
    fetchImpl: async (url, options) => {
      fetches++;
      observedRequest = { url: String(url), options };
      return invokeAuthorityHandler(authority, JSON.parse(options.body), options.headers);
    }
  });
  const logs = [];
  const operation = createGatewayOperation('readAccountFoundation', configuration, {
    controlStore: store, invokeAuthority, now: () => fixture.NOW, structuredLog: (entry) => logs.push(entry)
  });
  const result = await operation(callable(fixture));
  assert.equal(result.code, 'FOUNDATION_NOT_INITIALIZED');
  assert.equal(firestore.callbackCount, 3);
  assert.equal(fetches, 1);
  assert.equal(firestore.documents.has(controlPaths(fixture.RUN_ID, 'A').consumption), true);
  assert.equal(observedRequest.url.endsWith('/v1/read-account-foundation'), true);
  assert.equal(observedRequest.options.headers['X-E1-Admission-Receipt-Digest'], result.admissionReceiptDigest);
  assert.equal(Object.hasOwn(observedRequest.options.headers, 'X-Firebase-AppCheck'), false);
  assert.equal(logs[0].outcome, 'group_e_admitted');
  assert.equal(JSON.stringify(logs).includes(fixture.ATTEMPT.A), false);
  await assert.rejects(operation(callable(fixture)), /GROUP_E_ADMISSION_CONSUMED/);
  assert.equal(fetches, 1);
});

test('wrong signature, subject, app, replayed App Check, and malformed request fail before marker creation', async () => {
  const fixture = createFixture();
  const cases = [
    () => callable(fixture, 'A', { data: { ...fixture.signedRequest('A'), signature: 'A'.repeat(86) } }),
    () => callable(fixture, 'A', { auth: { uid: fixture.UID.B } }),
    () => callable(fixture, 'A', { app: { appId: 'wrong-app', alreadyConsumed: false } }),
    () => callable(fixture, 'A', { app: { appId: fixture.FIREBASE_APP_ID, alreadyConsumed: true } }),
    () => callable(fixture, 'A', { data: { schemaVersion: 1 } })
  ];
  for (const makeRequest of cases) {
    const { firestore, store } = seededStore(fixture);
    let calls = 0;
    const operation = createGatewayOperation('readAccountFoundation', loadGatewayConfiguration(gatewayEnvironment(fixture)), {
      controlStore: store, invokeAuthority: async () => { calls++; return { status: 500, payload: { code: 'UNEXPECTED' } }; },
      now: () => fixture.NOW, structuredLog() {}
    });
    await assert.rejects(operation(makeRequest()));
    assert.equal(calls, 0);
    assert.equal(firestore.documents.has(controlPaths(fixture.RUN_ID, 'A').consumption), false);
  }
});

test('marker-committed crash, timeout, and process restart cannot cause a second authority call', async () => {
  for (const failure of [new Error('synthetic-crash'), Object.assign(new Error('synthetic-timeout'), { name: 'TimeoutError' })]) {
    const fixture = createFixture();
    const { firestore, store } = seededStore(fixture);
    let calls = 0;
    const dependencies = { controlStore: store, invokeAuthority: async () => { calls++; throw failure; },
      now: () => fixture.NOW, structuredLog() {} };
    const configuration = loadGatewayConfiguration(gatewayEnvironment(fixture));
    await assert.rejects(createGatewayOperation('readAccountFoundation', configuration, dependencies)(callable(fixture)), failure);
    assert.equal(firestore.documents.has(controlPaths(fixture.RUN_ID, 'A').consumption), true);
    await assert.rejects(createGatewayOperation('readAccountFoundation', configuration, dependencies)(callable(fixture)),
      /GROUP_E_ADMISSION_CONSUMED/);
    assert.equal(calls, 1);
  }
});

test('authority invoker performs one bounded fetch and never retries a failed response', async () => {
  const fixture = createFixture();
  const receipt = createAdmissionReceipt(fixture.consumption('A'));
  let fetches = 0;
  const invoker = createAuthorityInvoker(loadGatewayConfiguration(gatewayEnvironment(fixture)), {
    getOidcToken: async () => 'synthetic-oidc-token',
    fetchImpl: async (_url, options) => {
      fetches++;
      assert.equal(options.signal instanceof AbortSignal, true);
      return { status: 503, json: async () => ({ code: 'INTERNAL_ERROR' }) };
    }
  });
  await invoker('readAccountFoundation', { firebaseIdToken: 'synthetic-firebase-id-token', body: {},
    authorityBody: { schemaVersion: 1, attemptId: fixture.ATTEMPT.A, admissionReceipt: receipt }, groupE: { receipt } });
  assert.equal(fetches, 1);
});

test('authority validates exact receipt, headers, UID and reciprocal trainer before its zero-write read', async () => {
  const fixture = createFixture();
  const receipt = createAdmissionReceipt(fixture.consumption('A'));
  let reads = 0;
  let writes = 0;
  const handler = createHandler(loadConfiguration(authorityEnvironment(fixture), () => fixture.NOW),
    authorityDependencies(fixture, 'A', {
      readAccountDocument: async (configuration, uid) => {
        reads++;
        assert.equal(configuration.databaseId, 'phase-e-identity');
        assert.equal(uid, fixture.UID.A);
        return null;
      },
      consumeRateLimit: async () => { writes++; }
    }));
  const body = { schemaVersion: 1, attemptId: fixture.ATTEMPT.A, admissionReceipt: receipt };
  const response = await invokeAuthorityHandler(handler, body, authorityHeaders(fixture, receipt));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.subjectBinding, responseBinding(fixture.UID.A, fixture.ATTEMPT.A, receipt.receiptDigest));
  assert.deepEqual({ reads, writes }, { reads: 1, writes: 0 });
  const rejected = await invokeAuthorityHandler(handler, body,
    { ...authorityHeaders(fixture, receipt), 'x-e1-run-id': '223e4567-e89b-42d3-a456-426614174000' });
  assert.equal(rejected.status, 403);
  assert.equal(reads, 1);
});

test('authority terminal outcomes retain safe correlation and never expose raw attempts', async () => {
  const fixture = createFixture();
  const canonical = normalizeHandle(fixture.TRAINER.A);
  const account = (status) => ({ fields: { schemaVersion: { integerValue: '1' }, uid: { stringValue: fixture.UID.A },
    trainerName: { stringValue: fixture.TRAINER.A }, normalizedTrainerName: { stringValue: canonical.normalized },
    handleKey: { stringValue: canonical.handleKey }, legacyUsername: { stringValue: fixture.TRAINER.A },
    status: { stringValue: status }, revision: { integerValue: '1' }, createdAt: { integerValue: '1' },
    updatedAt: { integerValue: '2' } } });
  for (const [document, status, outcome] of [[null, 200, 'not_initialized'], [account('active'), 200, 'success'],
    [account('frozen'), 423, 'frozen']]) {
    const receipt = createAdmissionReceipt(fixture.consumption('A'));
    const logs = [];
    const handler = createHandler(loadConfiguration(authorityEnvironment(fixture), () => fixture.NOW),
      authorityDependencies(fixture, 'A', { readAccountDocument: async () => document,
        structuredLog: (_configuration, operation, actualOutcome, _startedAt, extra) =>
          logs.push({ operation, outcome: actualOutcome, extra }) }));
    const response = await invokeAuthorityHandler(handler,
      { schemaVersion: 1, attemptId: fixture.ATTEMPT.A, admissionReceipt: receipt }, authorityHeaders(fixture, receipt));
    assert.equal(response.status, status);
    assert.equal(logs[0].outcome, outcome);
    assert.equal(logs[0].extra.canarySlot, 'A');
    assert.equal(logs[0].extra.admissionReceiptDigest, receipt.receiptDigest);
    assert.equal(JSON.stringify(logs).includes(fixture.ATTEMPT.A), false);
  }
});

test('normal and Group C modes remain isolated from signed Group E admission', () => {
  const fixture = createFixture();
  const disabled = gatewayEnvironment(fixture, { GATEWAY_INVOCATION_ENABLED: 'false', GROUP_E_CLIENT_MODE: 'disabled',
    GROUP_E_SUBJECT_BINDINGS: undefined, GROUP_E_COHORT_DIGEST: undefined, GROUP_E_RUN_ID: undefined,
    GROUP_E_RUN_MANIFEST_DIGEST: undefined, GROUP_E_KEY_ID: undefined, GROUP_E_PUBLIC_KEY_SPKI: undefined,
    GROUP_E_FIREBASE_APP_ID_HASH: undefined, GROUP_E_CONTROL_DATABASE_ID: undefined });
  assert.equal(loadGatewayConfiguration(disabled).groupE.enabled, false);
  assert.throws(() => loadGatewayConfiguration(gatewayEnvironment(fixture, { READ_PROOF_MODE: 'true' })),
    /GROUP_E_CONFIGURATION_INVALID/);
  assert.throws(() => loadGatewayConfiguration(gatewayEnvironment(fixture,
    { PROVIDER_PUBLIC_PROJECTION_ENABLED: 'true' })), /GROUP_E_CONFIGURATION_INVALID/);
  assert.throws(() => loadGatewayConfiguration(gatewayEnvironment(fixture,
    { GROUP_E_WINDOW_START: '2030-01-01T12:00:00Z' })), /GROUP_E_CONFIGURATION_INVALID/);
});

test('Group E runtime denies provider account creation and exposes no broad control-plane write adapter', async () => {
  const fixture = createFixture();
  const configuration = loadGatewayConfiguration(gatewayEnvironment(fixture));
  const { store } = seededStore(fixture);
  let calls = 0;
  const createRequest = callable(fixture, 'A', {
    data: {
      schemaVersion: 1,
      providerAccountProtocolVersion: 1,
      requestId: 'provider-request-1',
      requestedHandle: 'Trainer',
      lifecycleId: 'auth-1',
      clientRelease: '2026-08-31.86',
      idempotencyFingerprint: 'a'.repeat(64)
    }
  });
  await assert.rejects(createGatewayOperation('createProviderAccountFoundation', configuration, {
    controlStore: store,
    invokeAuthority: async () => { calls++; return { status: 500, payload: { code: 'UNEXPECTED' } }; },
    now: () => fixture.NOW,
    structuredLog() {}
  })(createRequest), /GROUP_E_OPERATION_DENIED/);
  assert.equal(calls, 0);
  const runtime = [fs.readFileSync(path.resolve(__dirname, '../e1-gateway/index.js'), 'utf8'),
    fs.readFileSync(path.resolve(__dirname, '../e1-gateway/gatewayCore.js'), 'utf8'),
    fs.readFileSync(path.resolve(__dirname, '../e1-authority-service/server.js'), 'utf8')].join('\n');
  assert.doesNotMatch(runtime, /providerLink|linkProvider|unlinkProvider|provider-link/u);
  assert.deepEqual([...fs.readFileSync(path.resolve(__dirname, '../e1-gateway/index.js'), 'utf8')
    .matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)].map((match) => match[1]),
  ['readE1AccountFoundation', 'readE1ProviderPublicShare',
    'listE1TrainerDirectory', 'resolveE1FavoriteTrainerIdentity',
    'createE1ProviderAccountFoundation', 'reserveE1TrainerHandle']);
  const controlModule = require('../e1-gateway/groupEControlStore');
  assert.equal(controlModule.createRun, undefined);
  assert.equal(controlModule.createReconciliation, undefined);
  assert.equal(controlModule.createCloseout, undefined);
});
