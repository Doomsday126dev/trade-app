'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const BASE_PATH = path.join(ROOT, 'tests/firebase/database.rules.narrow-read.json');
const CANDIDATE_PATH = path.join(ROOT, 'tests/firebase/database.rules.durable-auth.json');
const NEW_ROOTS = ['accounts', 'trainerHandles', 'identityMigrations', 'durableAuthConfig'];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

test('candidate is rebuilt from the exact live rollback baseline', () => {
  const baseSource = fs.readFileSync(BASE_PATH);
  assert.equal(crypto.createHash('sha256').update(baseSource).digest('hex'), 'e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf');
  const base = readJson(BASE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  for (const root of NEW_ROOTS) delete candidate.rules[root];
  candidate.rules.authIndex.$uid['.read'] = base.rules.authIndex.$uid['.read'];
  candidate.rules.users.$username['.read'] = base.rules.users.$username['.read'];
  assert.deepEqual(candidate, base);
});

test('candidate adds only the four E.1 roots and two narrow legacy-read clauses', () => {
  const base = readJson(BASE_PATH);
  const candidate = readJson(CANDIDATE_PATH);
  const added = Object.keys(candidate.rules).filter((key) => !(key in base.rules)).sort();
  assert.deepEqual(added, [...NEW_ROOTS].sort());
  assert.match(candidate.rules.authIndex.$uid['.read'], /e1-runtime-handle-reservation/);
  assert.match(candidate.rules.users.$username['.read'], /e1SubjectUid/);
  assert.equal(candidate.rules.loginDirectory['.read'], base.rules.loginDirectory['.read']);
});

test('runtime personas are exact and no E.1 parent grants enumeration', () => {
  const rules = readJson(CANDIDATE_PATH).rules;
  assert.equal(rules.accounts['.read'], undefined);
  assert.equal(rules.trainerHandles['.read'], undefined);
  assert.equal(rules.identityMigrations['.read'], undefined);
  assert.match(rules.accounts.$uid['.write'], /e1SubjectUid === \$uid/);
  assert.match(rules.trainerHandles.$handleKey['.write'], /e1HandleKey === \$handleKey/);
  assert.match(rules.identityMigrations.$uid.operations.$operationId['.write'], /e1OperationId === \$operationId/);
  assert.equal(rules.durableAuthConfig.clientFoundationEnabled['.read'], true);
  assert.match(rules.durableAuthConfig['.write'], /e1-offline-configuration-operator/);
  assert.doesNotMatch(rules.durableAuthConfig['.write'], /handle-reservation|foundation-repair|config-read/);
});

test('E.1 adapter exposes fixed operations and uses no root transaction', () => {
  const source = fs.readFileSync(path.join(ROOT, 'functions/src/adapters/firebaseDurableAuthAdapter.js'), 'utf8');
  assert.doesNotMatch(source, /\.transaction\s*\(/);
  assert.match(source, /database\.ref\(\)\.update\(updates\)/);
  assert.doesNotMatch(source, /publicShares|userPreferences|wishlist|dynamax|gmax|costumes/);
  const { createFirebaseDurableAuthAdapter } = require('../functions/src/adapters/firebaseDurableAuthAdapter');
  const adapter = createFirebaseDurableAuthAdapter({ openSession: async () => ({ database: {}, close() {} }) });
  assert.deepEqual(Object.keys(adapter).sort(), ['readConfiguration', 'repairAccountFoundation', 'reserveTrainerHandle']);
  for (const method of ['read', 'write', 'set', 'update', 'remove', 'transaction', 'ref']) assert.equal(adapter[method], undefined);
});

test('E.1 proof is not wired into deployed callable exports or browser assets', () => {
  const index = fs.readFileSync(path.join(ROOT, 'functions/src/index.js'), 'utf8');
  assert.doesNotMatch(index, /firebaseDurableAuthAdapter|e1RuntimeAuthorization|repairAccountFoundation/);
  const client = require('../scripts/lib/frontend-source.cjs').readFrontendSource(ROOT);
  for (const root of NEW_ROOTS) assert.doesNotMatch(client, new RegExp(`['\"]${root}(?:/|['\"])`));
});

test('documentation records exact personas, IAM separation, App Check order, rollback, and cost classes', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/E1-LEAST-PRIVILEGE-RUNTIME-PROOF.md'), 'utf8');
  for (const phrase of [
    'handle-reservation', 'foundation-repair', 'config-read', 'configuration-operator',
    'databaseAuthVariableOverride', 'multi-location', 'App Check', 'rollback',
    'control[- ]plane', 'data plane', 'free quota', 'potentially billable'
  ]) assert.match(doc, new RegExp(phrase, 'i'));
});
