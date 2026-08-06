'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInMemoryTrustedAdapter } = require('../src/adapters/inMemoryTrustedAdapter');
const { createFirebaseTrustedAdapter } = require('../src/adapters/firebaseTrustedAdapter');
const { REQUEST_RETENTION_MS } = require('../src/domain/idempotency');
const { harness, context, requestId } = require('./helpers.cjs');

const functionsRoot = path.resolve(__dirname, '..');

test('adapter exports no arbitrary-path capability', () => {
  const adapter = createInMemoryTrustedAdapter();
  for (const method of ['read', 'write', 'set', 'update', 'remove', 'mutatePath', 'bulk']) assert.equal(adapter[method], undefined);
});

test('exactly five narrow callable entrypoints are exported and rename remains absent', () => {
  const source = fs.readFileSync(path.join(functionsRoot, 'src/index.js'), 'utf8');
  const names = [...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]).sort();
  assert.deepEqual(names, ['claimTrainerTagLabel', 'mutateFavoriteTrainer', 'reserveTrainerHandle', 'setApprovedViewer', 'verifyTrainerHistory']);
  assert.doesNotMatch(source, /exports\.renameTrainerHandle/);
});

test('workspace contains no deploy scripts, production aliases, URLs, or credentials', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(functionsRoot, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.scripts).some((name) => /deploy|publish|postinstall/i.test(name)), false);
  const files = [
    'package.json',
    ...fs.readdirSync(path.join(functionsRoot, 'src'), { recursive: true }).map((name) => `src/${name}`)
  ];
  const text = files.filter((name) => /\.(js|cjs|json)$/.test(name)).map((name) => fs.readFileSync(path.join(functionsRoot, name), 'utf8')).join('\n');
  assert.doesNotMatch(text, /trade-list-[a-z0-9-]+|BEGIN PRIVATE KEY|service_account|client_email/i);
});

test('idempotency records retain only fingerprint, status, timing, and bounded result', async () => {
  const { adapter, operations } = harness();
  await operations.reserveTrainerHandle({ requestedHandle: 'PrivateHandle', requestId: requestId('record-shape') }, context('newuid_100'));
  const record = Object.values(adapter.inspect().trustedOperationRequests)[0];
  assert.deepEqual(Object.keys(record).sort(), ['createdAt', 'expiresAt', 'fingerprint', 'result', 'status']);
  assert.doesNotMatch(JSON.stringify(record), /PrivateHandle|newuid_100/);
});

test('idempotency retention is bounded to seven days with future cleanup documented', () => {
  assert.equal(REQUEST_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
  assert.match(fs.readFileSync(path.resolve(functionsRoot, '../docs/TRUSTED-FUNCTIONS-CANDIDATE.md'), 'utf8'), /seven-day retention|cleanup/i);
});

test('Firebase adapter exposes only fixed operation methods', () => {
  const source = fs.readFileSync(path.join(functionsRoot, 'src/adapters/firebaseTrustedAdapter.js'), 'utf8');
  assert.doesNotMatch(source, /return Object\.freeze\([^)]*\b(?:read|write|update|remove|set|bulk)\b/s);
});

test('Firebase idempotency completion verifies and persists the exact acquired request', async () => {
  const records = new Map();
  const hydrated = new Set();
  const database = {
    ref(path = '') {
      return {
        async get() {
          hydrated.add(path);
          return { val: () => records.get(path) ?? null };
        },
        async transaction(update) {
          const current = hydrated.has(path) ? records.get(path) ?? null : null;
          hydrated.delete(path);
          const next = update(structuredClone(current));
          if (next === undefined) return { committed: false };
          records.set(path, structuredClone(next));
          return { committed: true };
        },
        async set(value) {
          records.set(path, structuredClone(value));
        }
      };
    }
  };
  const adapter = createFirebaseTrustedAdapter({ database });
  const input = { callerUid: 'caller_001', operation: 'reserveTrainerHandle', requestId: 'request-hydration', fingerprint: 'a'.repeat(64), createdAt: 1, expiresAt: 2 };
  assert.equal((await adapter.beginOperationRequest(input)).state, 'acquired');
  await adapter.completeOperationRequest({ ...input, result: { ok: true, status: 'reserved' } });
  const replay = await adapter.beginOperationRequest(input);
  assert.equal(replay.state, 'terminal');
  assert.equal(replay.result.status, 'reserved');
});

test('Firebase idempotency completion fails closed without replacing mismatched state', async () => {
  const path = 'trustedOperationRequests/caller_001/reserveTrainerHandle/request-mismatch';
  const records = new Map([[path, { fingerprint: 'b'.repeat(64), status: 'pending' }]]);
  const database = {
    ref(refPath = '') {
      return {
        async get() { return { val: () => structuredClone(records.get(refPath) ?? null) }; },
        async set(value) { records.set(refPath, structuredClone(value)); }
      };
    }
  };
  const adapter = createFirebaseTrustedAdapter({ database });
  await assert.rejects(
    adapter.completeOperationRequest({ callerUid: 'caller_001', operation: 'reserveTrainerHandle', requestId: 'request-mismatch', fingerprint: 'a'.repeat(64), result: { status: 'reserved' } }),
    (error) => error?.code === 'unavailable' && error?.reason === 'idempotency/completion_failed'
  );
  assert.deepEqual(records.get(path), { fingerprint: 'b'.repeat(64), status: 'pending' });
});

test('Firebase fixed transactions prime the local event cache before a sequential revoke', async () => {
  const records = new Map();
  const hydrated = new Set();
  const database = {
    ref(path = '') {
      return {
        async once(event) {
          assert.equal(event, 'value');
          hydrated.add(path);
          return { val: () => structuredClone(records.get(path) ?? null) };
        },
        async transaction(update) {
          const current = hydrated.has(path) ? records.get(path) ?? null : null;
          hydrated.delete(path);
          const next = update(structuredClone(current));
          if (next === undefined) return { committed: false };
          if (next === null) records.delete(path);
          else records.set(path, structuredClone(next));
          return { committed: true };
        }
      };
    }
  };
  const adapter = createFirebaseTrustedAdapter({ database });
  assert.equal((await adapter.setViewerGrantForOwner({ ownerUid: 'owner_001', viewerUid: 'viewer_001', action: 'grant' })).status, 'granted');
  assert.equal((await adapter.setViewerGrantForOwner({ ownerUid: 'owner_001', viewerUid: 'viewer_001', action: 'revoke' })).status, 'revoked');
  assert.equal(records.has('shareAccess/owner_001/viewer_001'), false);
});

test('Firebase transaction retries replace status inferred from an earlier cached callback', async () => {
  const path = 'shareAccess/owner_001/viewer_001';
  let value = true;
  const database = {
    ref(refPath = '') {
      assert.equal(refPath, path);
      return {
        async get() { return { val: () => value }; },
        async transaction(update) {
          update(null);
          value = update(true);
          return { committed: true };
        }
      };
    }
  };
  const adapter = createFirebaseTrustedAdapter({ database });
  const result = await adapter.setViewerGrantForOwner({ ownerUid: 'owner_001', viewerUid: 'viewer_001', action: 'revoke' });
  assert.equal(result.status, 'revoked');
  assert.equal(value, null);

  const favoritePath = 'userPreferences/caller_001/favoriteTrainers';
  let favorites = {
    trainer_001: { trainerName: 'Synthetic Trainer', addedAt: 1, revision: 1, updatedAt: 1, operationId: 'request-seed-favorite', deleted: false }
  };
  const favoriteDatabase = {
    ref(refPath = '') {
      assert.equal(refPath, favoritePath);
      return {
        async once(event) { assert.equal(event, 'value'); return { val: () => structuredClone(favorites) }; },
        async transaction(update) {
          update(null);
          favorites = update(structuredClone(favorites));
          return { committed: true };
        }
      };
    }
  };
  const favoriteAdapter = createFirebaseTrustedAdapter({ database: favoriteDatabase });
  const favoriteResult = await favoriteAdapter.mutateFavoriteForViewer({
    callerUid: 'caller_001', operation: 'remove', trainerUid: 'trainer_001', canonicalTrainerLabel: 'Synthetic Trainer',
    expectedRevision: 1, operationId: 'request-remove-favorite', now: 2
  });
  assert.equal(favoriteResult.status, 'removed');
  assert.equal(favorites.trainer_001.deleted, true);
  assert.equal(favorites.trainer_001.revision, 2);
});

test('server write gates are checked before idempotency acquisition', () => {
  const source = fs.readFileSync(path.join(functionsRoot, 'src/domain/trustedOperations.js'), 'utf8');
  for (const functionName of ['reserveTrainerHandle', 'claimTrainerTagLabel', 'mutateFavoriteTrainer', 'verifyTrainerHistory', 'setApprovedViewer']) {
    const block = source.slice(source.indexOf(`async function ${functionName}`), source.indexOf('\n  }', source.indexOf(`async function ${functionName}`)));
    assert.ok(block.indexOf('assertOperationEnabled') < block.indexOf('runIdempotent'));
  }
});

test('emulator configuration uses a demo project through the command wrapper only', () => {
  const wrapper = fs.readFileSync(path.resolve(functionsRoot, '../scripts/check-trusted-functions-emulator.sh'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.resolve(functionsRoot, '../firebase.trusted-functions.emulator.json'), 'utf8'));
  assert.match(wrapper, /--project demo-pogo-trusted-functions/);
  assert.match(wrapper, /--only auth,database,functions/);
  assert.match(wrapper, /--config firebase\.trusted-functions\.emulator\.json/);
  assert.match(wrapper, /npx --yes --package firebase-tools@15\.24\.0 firebase/);
  assert.match(wrapper, /EMULATOR_TEST_COMMAND/);
  assert.match(wrapper, /"\$NODE_BIN" "functions\/test\/emulator-contract\.test\.cjs"/);
  assert.doesNotMatch(wrapper, /\.firebase-local\/bin\/firebase|FIREBASE=\(firebase\)/);
  assert.equal(config.functions.source, 'functions');
  assert.equal(config.database.rules, 'tests/firebase/database.rules.share-visibility.json');
  assert.equal(config.emulators.auth.port, 9399);
  assert.equal(config.database.rules.includes('..'), false);
  assert.doesNotMatch(wrapper, /firebase\s+deploy|firebase\s+login|GOOGLE_APPLICATION_CREDENTIALS/);
});

test('emulator wrapper requires the production Node 22 runtime', () => {
  const wrapper = fs.readFileSync(path.resolve(functionsRoot, '../scripts/check-trusted-functions-emulator.sh'), 'utf8');
  assert.match(wrapper, /process\.versions\.node/);
  assert.match(wrapper, /!= "22"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(functionsRoot, 'package.json'), 'utf8')).engines.node, '22');
});

test('emulator integration seeds the same default RTDB namespace used by Functions', () => {
  const source = fs.readFileSync(path.join(functionsRoot, 'test/emulator-contract.test.cjs'), 'utf8');
  const runtime = fs.readFileSync(path.join(functionsRoot, 'src/domain/runtimePolicy.js'), 'utf8');
  assert.match(source, /databaseNamespace = `\$\{projectId\}-default-rtdb`/);
  assert.match(source, /databaseURL: `http:\/\/\$\{databaseHost\}\?ns=\$\{databaseNamespace\}`/);
  assert.doesNotMatch(source, /\?ns=\$\{projectId\}`/);
  assert.match(runtime, /databaseURL: `http:\/\/\$\{databaseHost\}\?ns=\$\{projectId\}-default-rtdb`/);
  assert.match(runtime, /127\\\.0\\\.0\\\.1\|localhost/);
});
