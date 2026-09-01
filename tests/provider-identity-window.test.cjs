'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { normalizeHandle } = require('../functions/e1-authority-service/handleNormalization.js');
const {
  sha256, classifySnapshot, publicReport, writePrivateJson, expectedDocuments, runManifest
} = require('../functions/production/providerIdentityWindow.cjs');

function metadata() {
  return {
    mainCommit: 'a'.repeat(40), mainTree: 'b'.repeat(40), capturedAt: '2026-09-01T20:00:00.000Z',
    sourceDigests: { authIndex: '1'.repeat(64), users: '2'.repeat(64), loginDirectory: '3'.repeat(64),
      accounts: '4'.repeat(64), trainerHandles: '5'.repeat(64) },
    currentRulesDigest: '6'.repeat(64), provisioningContractDigest: '7'.repeat(64)
  };
}

function identity(name, uid, authVersion = 1) {
  const handle = normalizeHandle(name);
  return { name, uid, authVersion, ...handle };
}

function canonical(item) {
  return {
    account: {
      schemaVersion: 1, uid: item.uid, canonicalTrainerName: item.display,
      normalizedTrainerName: item.normalized, handleKey: item.handleKey,
      identityKind: 'legacy_migrated', legacyAccessConfigured: true, legacyUsername: item.display,
      legacyAuthVersion: item.authVersion, status: 'active', revision: 1
    },
    handle: {
      schemaVersion: 1, uid: item.uid, canonicalTrainerName: item.display,
      normalizedTrainerName: item.normalized, state: 'active', revision: 1,
      claimedAt: 1, updatedAt: 1
    }
  };
}

function fixture() {
  const existing = identity('Existing', 'uid-existing');
  const migrate = identity('Migrate', 'uid-migrate', 2);
  const hold = identity('HoldOnly', null);
  const pair = canonical(existing);
  return {
    authIndex: {
      [existing.uid]: { username: existing.name, authVersion: existing.authVersion },
      [migrate.uid]: { username: migrate.name, authVersion: migrate.authVersion },
      'uid-unpaired': { username: 'NoActiveUser', authVersion: 1 }
    },
    users: {
      [existing.name]: { authUid: existing.uid }, [migrate.name]: { authUid: migrate.uid }, [hold.name]: {}
    },
    loginDirectory: {
      [existing.name]: { authVersion: 1 }, [migrate.name]: { authVersion: 2 }, [hold.name]: { authVersion: 1 }
    },
    accounts: { [existing.uid]: pair.account }, trainerHandles: { [existing.handleKey]: pair.handle }
  };
}

test('manifest classifies each active handle exactly once and keeps unpaired auth separate', () => {
  const { manifest, blockers } = classifySnapshot(fixture(), metadata());
  assert.equal(blockers, 0);
  assert.deepEqual(manifest.operationCounts, {
    ALREADY_CANONICAL: 1, MIGRATE_RECIPROCAL_IDENTITY: 1, CREATE_LEGACY_HANDLE_HOLD: 1,
    UNPAIRED_AUTHINDEX_REVIEW: 1, BLOCKED_CONFLICT: 0, MALFORMED: 0
  });
  assert.equal(manifest.expectedInitialCounts.activeHandles, 3);
  assert.equal(manifest.expectedInitialCounts.providerOnlyAccounts, 0);
  assert.equal(manifest.records.filter((record) => record.classification !== 'UNPAIRED_AUTHINDEX_REVIEW').length, 3);
});

test('split ownership and duplicate normalized handles stop preparation', () => {
  const value = fixture();
  const migrate = identity('Migrate', 'uid-migrate', 2);
  value.trainerHandles[migrate.handleKey] = { ...canonical(migrate).handle, uid: 'other-owner' };
  const { manifest, blockers } = classifySnapshot(value, metadata());
  assert.equal(blockers, 1);
  assert.equal(manifest.operationCounts.BLOCKED_CONFLICT, 1);
});

test('public report contains keyed digests and no raw identities', () => {
  const { manifest } = classifySnapshot(fixture(), metadata());
  const report = publicReport(manifest, Buffer.alloc(32, 9));
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /Existing|Migrate|HoldOnly|uid-/u);
  assert.equal(report.setEquality.everyActiveHandleClassifiedOnce, true);
  assert.equal(report.runScopedRecordDigests.length, 4);
});

test('private writer enforces 0600 and refuses replacement', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-window-'));
  const file = path.join(directory, 'manifest.json');
  try {
    writePrivateJson(file, { private: true });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => writePrivateJson(file, { replacement: true }), /EEXIST/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('dry run creates exact documents and restart skips verified work', async () => {
  const source = fixture();
  const { manifest } = classifySnapshot(source, metadata());
  const stored = new Map([
    ...Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, structuredClone(value)]),
    ...Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, structuredClone(value)])
  ]);
  const adapter = {
    async readDocument(target) { return stored.has(target) ? stored.get(target) : null; },
    async verify() {},
    async createOnly(record, documents) {
      for (const [target, document] of Object.entries(documents)) {
        assert.equal(stored.has(target), false);
        stored.set(target, structuredClone(document));
      }
      return 'committed';
    },
    async readback(record, documents) {
      return Object.entries(documents).every(([target, document]) =>
        JSON.stringify(stored.get(target)) === JSON.stringify(document));
    }
  };
  let progress;
  await assert.rejects(runManifest(manifest, adapter, { timestamp: 100, interruptAfter: 2 }), (error) => {
    progress = error.progress;
    return error.message === 'simulated_interruption';
  });
  const result = await runManifest(manifest, adapter, { timestamp: 100, progress });
  assert.ok(result.skipped >= 2);
  assert.equal(stored.size, 7);
  assert.match(result.coverageDigest, /^[a-f0-9]{64}$/u);
});

test('ambiguous transport gets one readback and is never blindly resent', async () => {
  const source = fixture();
  const { manifest } = classifySnapshot(source, metadata());
  const stored = new Map([
    ...Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, structuredClone(value)]),
    ...Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, structuredClone(value)])
  ]);
  let sends = 0;
  const adapter = {
    async readDocument(target) { return stored.get(target) || null; },
    async verify() {},
    async createOnly(record, documents) {
      sends += 1;
      for (const [target, value] of Object.entries(documents)) stored.set(target, structuredClone(value));
      throw Object.assign(new Error('lost response'), { code: 'transport_ambiguous' });
    },
    async readback(record, documents) {
      return Object.entries(documents).every(([target, value]) => JSON.stringify(stored.get(target)) === JSON.stringify(value));
    }
  };
  await runManifest(manifest, adapter, { timestamp: 100 });
  assert.equal(sends, 2);
});

test('create-only 409 receives one exact readback and reconciles without a resend', async () => {
  const source = fixture();
  const { manifest } = classifySnapshot(source, metadata());
  const stored = new Map([
    ...Object.entries(source.accounts).map(([id, value]) => [`accounts/${id}`, structuredClone(value)]),
    ...Object.entries(source.trainerHandles).map(([id, value]) => [`trainerHandles/${id}`, structuredClone(value)])
  ]);
  let sends = 0;
  const adapter = {
    async readDocument(target) { return stored.get(target) || null; },
    async verify() {},
    async createOnly(record, documents) {
      sends += 1;
      for (const [target, value] of Object.entries(documents)) stored.set(target, structuredClone(value));
      throw Object.assign(new Error('precondition'), { status: 409 });
    }
  };
  await runManifest(manifest, adapter);
  assert.equal(sends, 2);
});

test('changed source evidence stops before execution', async () => {
  const { manifest } = classifySnapshot(fixture(), metadata());
  await assert.rejects(runManifest(manifest, {}, { expectedSourceMappingFingerprint: sha256('changed') }),
    /source_evidence_changed/u);
});

test('expected documents use accepted canonical migration and hold schemas', () => {
  const { manifest } = classifySnapshot(fixture(), metadata());
  const migration = manifest.records.find((record) => record.classification === 'MIGRATE_RECIPROCAL_IDENTITY');
  const hold = manifest.records.find((record) => record.classification === 'CREATE_LEGACY_HANDLE_HOLD');
  const migrationDocuments = expectedDocuments(migration, 123);
  assert.equal(Object.keys(migrationDocuments).length, 4);
  assert.equal(migrationDocuments[migration.targetPaths[2]].operation, 'applyMigrationManifest');
  assert.equal(migrationDocuments[migration.targetPaths[3]].status, 'complete');
  assert.deepEqual(Object.values(expectedDocuments(hold, 123))[0], {
    schemaVersion: 1, canonicalTrainerName: 'HoldOnly', normalizedTrainerName: 'holdonly',
    state: 'legacy_hold', revision: 1
  });
});

test('combined Rules retain full sync and freeze policies while adding exact provider projection', () => {
  const rules = require('./firebase/database.rules.provider-identity-window.json').rules;
  assert.ok(rules.accountSync);
  assert.ok(rules.legacyProvisioningFreeze);
  assert.equal(rules.trainerShares['.read'], undefined);
  assert.equal(rules.trainerShares.$ownerUid['.read'], true);
  assert.match(rules.trainerShares.$ownerUid['.write'], /auth\.uid === \$ownerUid/u);
  assert.equal(rules['.read'], false);
});
