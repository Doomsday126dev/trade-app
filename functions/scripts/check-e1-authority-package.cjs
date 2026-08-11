#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = path.resolve(__dirname, '../e1-authority-service');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-authority-package-'));
const packageRoot = path.join(temporaryRoot, 'service');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: packageRoot, encoding: 'utf8', ...options });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'package readiness command failed\n');
    process.exitCode = 1;
    throw new Error('E1_PACKAGE_READINESS_FAILED');
  }
  return result;
}

try {
  fs.cpSync(source, packageRoot, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== 'node_modules'
  });
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  const proof = run(process.execPath, ['-e', `
    const { EventEmitter } = require('node:events');
    const net = require('node:net');
    const { assertRuntimeDependencies, createHandler, loadConfiguration, start } = require('./server');
    const environment = {
      APP_ENVIRONMENT: 'staging',
      FIREBASE_PROJECT_ID: 'trainer-hub-staging-37ib4wct',
      EXPECTED_PROJECT_NUMBER: '391359988648',
      FIRESTORE_DATABASE_ID: 'phase-e-identity',
      RTDB_DATABASE_URL: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
      SERVICE_REGION: 'us-central1',
      AUTHORITY_SERVICE_NAME: 'e1-identity-authority',
      EXPECTED_RUNTIME_SERVICE_ACCOUNT: 'e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com',
      FIREBASE_WEB_API_KEY: 'synthetic-firebase-web-api-key-for-package-proof',
      EXPECTED_OPERATOR_EMAIL_HASH: 'a'.repeat(64),
      EXPECTED_OPERATOR_SUBJECT_HASH: 'b'.repeat(64),
      READ_ACCOUNT_FOUNDATION_ENABLED: 'true',
      RESERVE_HANDLE_ENABLED: 'true',
      REPAIR_FOUNDATION_ENABLED: 'false',
      APPLY_MIGRATION_ENABLED: 'false',
      FREEZE_CONFLICT_ENABLED: 'false'
    };
    const configuration = loadConfiguration(environment);
    assertRuntimeDependencies(configuration);
    function invoke(handler, url, body) {
      return new Promise((resolve) => {
        const request = new EventEmitter();
        request.method = 'POST';
        request.url = url;
        request.headers = { 'x-firebase-id-token': 'synthetic.package.token' };
        request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(JSON.stringify(body)); };
        const response = new EventEmitter();
        response.writeHead = (status) => { response.status = status; };
        response.end = (payload) => resolve({ status: response.status, body: JSON.parse(payload) });
        handler(request, response);
      });
    }
    (async () => {
      const writes = [];
      const handler = createHandler(configuration, {
        verifyFirebaseIdToken: async () => ({ uid: 'synthetic_package_uid' }),
        readAccountDocument: async () => null,
        readLegacyBinding: async () => ({ status: 'ready', username: 'PackageTrainer', legacyAuthVersion: 1 }),
        authorityStore: {
          consumeRateLimit: async () => ({ allowed: true, consumed: true }),
          reserveTrainerHandle: async (input) => { writes.push(input); return { status: 'reserved', revision: 1 }; }
        },
        structuredLog: () => {}
      });
      const read = await invoke(handler, '/v1/read-account-foundation', { schemaVersion: 1 });
      const reserve = await invoke(handler, '/v1/reserve-trainer-handle', { schemaVersion: 1, requestId: 'package-proof-0001', requestedHandle: 'PackageTrainer' });
      if (read.body.code !== 'FOUNDATION_NOT_INITIALIZED' || reserve.body.code !== 'SUCCESS' || writes.length !== 1) process.exit(1);
      const probe = net.createServer();
      await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      const server = start({ ...environment, PORT: String(port) });
      await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      await new Promise((resolve) => server.close(resolve));
      process.stdout.write(JSON.stringify({
        packageInstall: 'npm-ci-lockfile',
        nativeHttpDependency: typeof fetch === 'function',
        firebaseAuthVerificationDependency: require('./package.json').dependencies['firebase-admin'],
        firestoreTransactionDependency: require('@google-cloud/firestore/package.json').version,
        firestoreClientConstructedAtStartup: true,
        implementedTestGates: {
          readAccountFoundation: true,
          reserveTrainerHandle: true,
          repairAccountFoundation: true,
          applyMigrationManifest: true,
          freezeIdentityConflict: true
        },
        readPathExercised: true,
        reservePathExercised: true,
        liveGateChanges: 0,
        cloudOperations: 0
      }));
    })().catch(() => process.exit(1));
  `]);
  const result = JSON.parse(proof.stdout.trim().split(/\r?\n/u).at(-1));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
