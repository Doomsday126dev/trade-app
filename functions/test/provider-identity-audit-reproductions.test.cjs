'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '../..');
const baseline = 'cb816de8a12b1ccbc3ed51fee50686a262d241b4';
const filename = path.join(repo, 'functions/scripts/run-provider-identity-live-window.cjs');
const original = new Module(filename, module);
original.filename = filename;
original.paths = Module._nodeModulePaths(path.dirname(filename));
original._compile(execFileSync('git', ['-C', repo, 'show', baseline + ':functions/scripts/run-provider-identity-live-window.cjs'],
  { encoding: 'utf8' }), filename);
const before = original.exports;
const { classifySnapshot, sha256 } = require('../production/providerIdentityWindow.cjs');
const { createAdapter } = require('../scripts/dry-run-provider-identity-window.cjs');

// These reproduce the reviewed starting commit, not acceptance tests for launch.
test('baseline P1: phrase-only approval is accepted with another manifest and expired window', () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-baseline-'));
  try {
    const file = path.join(directory, 'approval.txt');
    fs.writeFileSync(file, before.APPROVAL, { mode: 0o600 });
    assert.doesNotThrow(() => before.requireApproval({ execute: true, approvalFile: file,
      manifestDigest: 'different', operatorCommit: 'unreviewed', expiresAt: 1, windowId: 'different-day' }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('baseline P1: full apply CLI creates four identity documents with no freeze', async () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-baseline-'));
  try {
    const source = { authIndex: { 'synthetic-uid': { username: 'Synthetic', authVersion: 1 } },
      users: { Synthetic: { authUid: 'synthetic-uid' } }, loginDirectory: { Synthetic: { authVersion: 1 } },
      accounts: {}, trainerHandles: {} };
    const { manifest } = classifySnapshot(source, { mainCommit: 'a'.repeat(40), mainTree: 'b'.repeat(40),
      capturedAt: '2026-09-01T00:00:00Z', currentRulesDigest: 'c'.repeat(64), provisioningContractDigest: 'd'.repeat(64),
      sourceDigests: Object.fromEntries(Object.entries(source).map(([key, value]) => [key, sha256(value)])) });
    const adapter = createAdapter(source);
    adapter.readRtdb = async () => ({ value: null });
    const current = async () => {
      const value = { ...source, accounts: {}, trainerHandles: {}, operationRequests: {}, identityMigrations: {} };
      for (const [target, doc] of adapter.store) {
        const root = target.split('/')[0];
        value[root][['accounts', 'trainerHandles'].includes(root) ? target.split('/')[1] : target] = doc;
      }
      return value;
    };
    before.atomicWrite(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'approval.txt'), before.APPROVAL, { mode: 0o600 });
    await assert.rejects(before.run(['--action', 'apply-manifest', '--execute',
      '--manifest', path.join(directory, 'manifest.json'), '--progress-file', path.join(directory, 'progress.json'),
      '--completion-file', path.join(directory, 'completion.json'), '--approval-file', path.join(directory, 'approval.txt'),
      '--confirm-project', 'trade-list-a4297', '--confirm-firestore-database', 'phase-e-identity',
      '--confirm-rtdb-url', 'https://trade-list-a4297-default-rtdb.firebaseio.com'], {
      adapter, readProduction: current, env: { GCLOUD_ACCESS_TOKEN: 'synthetic-only' }
    }), /freeze_not_exact_active/);
    assert.equal(adapter.store.size, 4);
    assert.equal([...adapter.sends.values()].reduce((a, b) => a + b, 0), 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('baseline P1: invalidation deletes a certification from an unrelated freeze', async () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-baseline-'));
  try {
    const { manifest } = classifySnapshot({ users: { Synthetic: {} }, loginDirectory: { Synthetic: {} } }, {
      capturedAt: '2026-09-01T00:00:00Z', mainCommit: 'a'.repeat(40), mainTree: 'b'.repeat(40),
      sourceDigests: {}, currentRulesDigest: 'c'.repeat(64), provisioningContractDigest: 'd'.repeat(64)
    });
    before.atomicWrite(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'approval.txt'), before.APPROVAL, { mode: 0o600 });
    const foreign = { freezeId: 'unrelated-freeze', state: 'certified' };
    let deleted = false;
    await before.run(['--action', 'invalidate-certification', '--execute', '--manifest', path.join(directory, 'manifest.json'),
      '--approval-file', path.join(directory, 'approval.txt'), '--confirm-project', 'trade-list-a4297',
      '--confirm-firestore-database', 'phase-e-identity', '--confirm-rtdb-url',
      'https://trade-list-a4297-default-rtdb.firebaseio.com'], {
      env: { GCLOUD_ACCESS_TOKEN: 'synthetic-only' }, adapter: { readDocument: async () => foreign,
        deleteExactDocument: async (target, expected) => { assert.deepEqual(expected, foreign); deleted = true; } }
    });
    assert.equal(deleted, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
