'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const decision = read('docs/E1-AUTHORITATIVE-STORE-DECISION.md');
const index = read('functions/src/index.js');
const adapterBridge = read('functions/src/adapters/firestoreE1AuthorityAdapter.js');
const adapter = read('functions/e1-authority-service/firestoreE1AuthorityAdapter.js');
const boundary = read('functions/src/domain/e1AuthorityBoundary.js');
const rules = read('tests/firebase/firestore.rules.e1-authority');
const wrapper = read('scripts/check-e1-firestore-authority.sh');

test('decision rejects broad data IAM in ordinary Functions and keeps authority separate', () => {
  assert.match(decision, /Do not grant Firestore or RTDB data permissions to ordinary application Functions/);
  assert.match(decision, /dedicated, private identity-authority service/);
  assert.match(decision, /server libraries bypass Firestore Security Rules/i);
  assert.match(decision, /IAM can be database-scoped but not collection\/document-scoped/);
  assert.doesNotMatch(index, /e1AuthorityBoundary|firestoreE1AuthorityAdapter|phase-e-identity/);
});

test('authority prototype has fixed methods and no generic datastore API', () => {
  assert.match(adapterBridge, /e1-authority-service\/firestoreE1AuthorityAdapter/);
  for (const method of ['readAccountFoundation', 'reserveTrainerHandle', 'repairAccountFoundation', 'applyMigrationManifest', 'freezeIdentityConflict']) {
    assert.match(adapter, new RegExp(`(?:(?:async function|function) ${method}\\b|const ${method}\\s*=)`));
    assert.match(boundary, new RegExp(`async function ${method}\\b`));
  }
  assert.doesNotMatch(adapter, /return Object\.freeze\([^)]*\b(?:read|write|set|update|delete|query|list|collection|ref)\b/s);
  assert.doesNotMatch(boundary, /subjectUid|ownerUid|targetUid/);
});

test('client identity database access is deny-all and no client wiring exists', () => {
  assert.match(rules, /allow read, write: if false/);
  const clientFiles = ['index.html', ...fs.readdirSync(path.join(ROOT, 'js'), { recursive: true }).filter((file) => /\.js$/.test(file)).map((file) => `js/${file}`)];
  const client = clientFiles.map(read).join('\n');
  assert.doesNotMatch(client, /phase-e-identity|firestoreE1AuthorityAdapter|e1AuthorityBoundary/);
});

test('emulator wrapper is demo-only and contains no deploy or cloud credential capability', () => {
  assert.match(wrapper, /--project demo-pogo-e1-authority/);
  assert.match(wrapper, /--only auth,firestore/);
  assert.match(wrapper, /firebase\.e1-authority\.json/);
  assert.doesNotMatch(wrapper, /firebase\s+deploy|gcloud|GOOGLE_APPLICATION_CREDENTIALS|login/);
});

test('accepted RTDB proof remains present and is classified rather than deleted', () => {
  for (const file of [
    'docs/E1-LEAST-PRIVILEGE-RUNTIME-PROOF.md',
    'functions/src/adapters/firebaseDurableAuthAdapter.js',
    'functions/src/domain/e1RuntimeAuthorization.js',
    'tests/firebase/database.rules.durable-auth.json'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, file);
  assert.match(decision, /RTDB-specific but useful evidence/);
  assert.match(decision, /Obsolete as deployable implementation/);
});

test('narrow-read mismatch is isolated as stale test-fixture pairing', () => {
  const narrow = JSON.parse(read('tests/firebase/database.rules.narrow-read.json')).rules;
  const additive = JSON.parse(read('tests/firebase/database.rules.share-visibility.json')).rules;
  assert.equal(narrow.shareDirectory, undefined);
  assert.ok(additive.shareDirectory);
  assert.match(decision, /stale emulator test\/fixture pairing/);
  assert.match(decision, /not a current production regression/);
});

test('staging acceptance is recorded without implying production activation', () => {
  assert.match(decision, /## Staging acceptance checkpoint/);
  assert.match(decision, /revision `e1-identity-authority-00019-lgm`/);
  assert.match(decision, /REPAIR_FOUNDATION_ENABLED=false/);
  assert.match(decision, /No further staging or production action is implied/);
  assert.match(decision, /separate production-activation review/);
});
