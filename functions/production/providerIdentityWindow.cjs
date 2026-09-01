'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization.js');

const CLASSES = Object.freeze([
  'ALREADY_CANONICAL',
  'MIGRATE_RECIPROCAL_IDENTITY',
  'CREATE_LEGACY_HANDLE_HOLD',
  'UNPAIRED_AUTHINDEX_REVIEW',
  'BLOCKED_CONFLICT',
  'MALFORMED'
]);
const WRITABLE_CLASSES = new Set(['MIGRATE_RECIPROCAL_IDENTITY', 'CREATE_LEGACY_HANDLE_HOLD']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) || typeof value === 'string' ? value : stableJson(value);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function keyedDigest(key, value) {
  return crypto.createHmac('sha256', key).update(stableJson(value)).digest('hex');
}

function exactCanonical(account, handle, expected) {
  return account?.schemaVersion === 1 && account.uid === expected.uid &&
    account.canonicalTrainerName === expected.canonicalTrainerName &&
    account.normalizedTrainerName === expected.normalizedTrainerName &&
    account.handleKey === expected.handleKey && account.status === 'active' && account.revision === 1 &&
    (account.identityKind === undefined || account.identityKind === 'legacy_migrated') &&
    (account.legacyAccessConfigured === undefined || account.legacyAccessConfigured === true) &&
    account.legacyUsername === expected.canonicalTrainerName &&
    Number(account.legacyAuthVersion) === expected.legacyAuthVersion &&
    handle?.schemaVersion === 1 && handle.uid === expected.uid &&
    handle.canonicalTrainerName === expected.canonicalTrainerName &&
    handle.normalizedTrainerName === expected.normalizedTrainerName && handle.state === 'active' &&
    handle.revision === 1;
}

function exactHold(handle, expected) {
  return handle?.schemaVersion === 1 && handle.canonicalTrainerName === expected.canonicalTrainerName &&
    handle.normalizedTrainerName === expected.normalizedTrainerName && handle.state === 'legacy_hold' &&
    handle.revision === 1 && !Object.hasOwn(handle, 'uid');
}

function sourceFingerprint(record) {
  return sha256([1, record.uid, record.canonicalTrainerName, record.normalizedTrainerName,
    record.handleKey, record.legacyAuthVersion]);
}

function classifySnapshot(snapshot, metadata) {
  const { authIndex = {}, users = {}, loginDirectory = {}, accounts = {}, trainerHandles = {} } = snapshot;
  for (const [name, value] of Object.entries({ authIndex, users, loginDirectory, accounts, trainerHandles })) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid_source_root:${name}`);
  }

  const records = [];
  const normalizedOwners = new Map();
  const activeHandles = [...new Set([...Object.keys(users), ...Object.keys(loginDirectory)])].sort();
  const reciprocalUids = new Set();
  const malformedHandles = new Set();

  for (const canonicalTrainerName of activeHandles) {
    let normalized;
    try { normalized = normalizeHandle(canonicalTrainerName); }
    catch (error) {
      malformedHandles.add(canonicalTrainerName);
      records.push({ classification: 'MALFORMED', canonicalTrainerName, reason: error.reason || 'invalid_handle' });
      continue;
    }
    const prior = normalizedOwners.get(normalized.normalized);
    if (prior && prior !== canonicalTrainerName) {
      records.push({ classification: 'BLOCKED_CONFLICT', canonicalTrainerName,
        normalizedTrainerName: normalized.normalized, handleKey: normalized.handleKey,
        reason: 'duplicate_normalized_handle' });
      continue;
    }
    normalizedOwners.set(normalized.normalized, canonicalTrainerName);

    const user = users[canonicalTrainerName];
    const directory = loginDirectory[canonicalTrainerName];
    if (!user || typeof user !== 'object' || !directory || typeof directory !== 'object') {
      records.push({ classification: 'MALFORMED', canonicalTrainerName,
        normalizedTrainerName: normalized.normalized, handleKey: normalized.handleKey,
        reason: !user ? 'missing_user' : 'missing_login_directory' });
      continue;
    }

    const uid = typeof user.authUid === 'string' && user.authUid ? user.authUid : null;
    const authRecord = uid ? authIndex[uid] : null;
    const reciprocal = Boolean(uid && authRecord && authRecord.username === canonicalTrainerName);
    const expected = {
      canonicalTrainerName,
      normalizedTrainerName: normalized.normalized,
      handleKey: normalized.handleKey,
      ...(uid ? { uid } : {}),
      ...(reciprocal ? { legacyAuthVersion: Number(authRecord.authVersion || directory.authVersion || 1) } : {})
    };
    const account = uid ? accounts[uid] : null;
    const handle = trainerHandles[normalized.handleKey];

    if (reciprocal) {
      reciprocalUids.add(uid);
      if (exactCanonical(account, handle, expected)) {
        records.push({ classification: 'ALREADY_CANONICAL', operation: 'VERIFY_ONLY', ...expected,
          targetPaths: [`accounts/${uid}`, `trainerHandles/${normalized.handleKey}`],
          sourceMappingFingerprint: sourceFingerprint(expected) });
      } else if (!account && !handle) {
        records.push({ classification: 'MIGRATE_RECIPROCAL_IDENTITY', operation: 'CREATE_ACCOUNT_AND_HANDLE', ...expected,
          targetPaths: [`accounts/${uid}`, `trainerHandles/${normalized.handleKey}`],
          sourceMappingFingerprint: sourceFingerprint(expected) });
      } else {
        records.push({ classification: 'BLOCKED_CONFLICT', ...expected, reason: 'canonical_partial_or_different' });
      }
    } else if (!account && (!handle || exactHold(handle, expected))) {
      records.push({ classification: 'CREATE_LEGACY_HANDLE_HOLD',
        operation: handle ? 'VERIFY_ONLY' : 'CREATE_HANDLE_HOLD', ...expected,
        targetPaths: [`trainerHandles/${normalized.handleKey}`] });
    } else {
      records.push({ classification: 'BLOCKED_CONFLICT', ...expected, reason: 'nonreciprocal_canonical_collision' });
    }
  }

  for (const [uid, authRecord] of Object.entries(authIndex).sort(([a], [b]) => a.localeCompare(b))) {
    if (reciprocalUids.has(uid)) continue;
    records.push({ classification: 'UNPAIRED_AUTHINDEX_REVIEW', operation: 'PRESERVE_ONLY', uid,
      legacyUsername: typeof authRecord?.username === 'string' ? authRecord.username : null,
      reason: 'no_exact_reciprocal_active_user' });
  }

  const expectedTimestamp = Date.parse(metadata.capturedAt);
  if (!Number.isSafeInteger(expectedTimestamp)) throw new Error('invalid_capture_timestamp');
  const manifestId = `provider-window-${metadata.capturedAt.replace(/[^0-9A-Za-z]/gu, '').slice(0, 24)}`;
  const exactRecords = records.map((record) => {
    if (record.classification === 'MIGRATE_RECIPROCAL_IDENTITY') {
      const reviewedAt = metadata.capturedAt;
      const operationId = `migration-${record.sourceMappingFingerprint.slice(0, 24)}`;
      const reviewerDecision = 'eligible';
      const manifestFingerprint = sha256([
        1, manifestId, record.uid, record.canonicalTrainerName, record.normalizedTrainerName, record.handleKey,
        record.legacyAuthVersion, record.sourceMappingFingerprint, reviewerDecision, reviewedAt
      ]);
      const fingerprint = sha256([1, 'applyMigrationManifest', record.uid, operationId, manifestFingerprint]);
      const enriched = { ...record, manifestId, operationId, reviewerDecision, reviewedAt,
        manifestFingerprint, fingerprint,
        targetPaths: [...record.targetPaths,
          `operationRequests/${record.uid}/requests/${operationId}`,
          `identityMigrations/${record.uid}/operations/${operationId}`] };
      return { ...enriched, expectedResult: expectedDocuments(enriched, expectedTimestamp) };
    }
    if (record.classification === 'CREATE_LEGACY_HANDLE_HOLD') {
      return { ...record, expectedResult: expectedDocuments(record, expectedTimestamp) };
    }
    if (record.classification === 'ALREADY_CANONICAL') {
      return { ...record, expectedResult: Object.fromEntries(record.targetPaths.map((target) => {
        const [collection, id] = target.split('/');
        return [target, structuredClone(collection === 'accounts' ? accounts[id] : trainerHandles[id])];
      })) };
    }
    return record;
  });
  const counts = Object.fromEntries(CLASSES.map((classification) => [classification,
    exactRecords.filter((record) => record.classification === classification).length]));
  const blockers = counts.BLOCKED_CONFLICT + counts.MALFORMED;
  const classifiedActiveHandles = exactRecords.filter((record) => record.canonicalTrainerName &&
    record.classification !== 'UNPAIRED_AUTHINDEX_REVIEW').length;
  if (classifiedActiveHandles !== activeHandles.length || malformedHandles.size > counts.MALFORMED) {
    throw new Error('classification_coverage_invariant_failed');
  }

  const manifestBase = {
    schemaVersion: 1,
    manifestType: 'provider-identity-production-window-v1',
    source: {
      mainCommit: metadata.mainCommit,
      mainTree: metadata.mainTree,
      normalizationVersion: 1,
      capturedAt: metadata.capturedAt,
      sourceDigests: metadata.sourceDigests,
      currentRulesDigest: metadata.currentRulesDigest,
      provisioningContractDigest: metadata.provisioningContractDigest
    },
    expectedInitialCounts: {
      authIndex: Object.keys(authIndex).length,
      users: Object.keys(users).length,
      loginDirectory: Object.keys(loginDirectory).length,
      accounts: Object.keys(accounts).length,
      trainerHandles: Object.keys(trainerHandles).length,
      activeHandles: activeHandles.length,
      reciprocalIdentities: reciprocalUids.size,
      providerOnlyAccounts: Object.values(accounts).filter((account) => account?.identityKind === 'provider_only').length
    },
    operationCounts: counts,
    sourceMappingFingerprint: sha256(exactRecords.map((record) => ({
      classification: record.classification,
      uid: record.uid || null,
      canonicalTrainerName: record.canonicalTrainerName || record.legacyUsername || null,
      handleKey: record.handleKey || null,
      sourceMappingFingerprint: record.sourceMappingFingerprint || null
    }))),
    records: exactRecords
  };
  const manifestDigest = sha256(manifestBase);
  return Object.freeze({ manifest: Object.freeze({ ...manifestBase, manifestDigest }), blockers });
}

function publicReport(manifest, runKey) {
  const activeRecords = manifest.records.filter((record) => record.classification !== 'UNPAIRED_AUTHINDEX_REVIEW');
  const digestRecord = (record) => ({
    classification: record.classification,
    recordDigest: keyedDigest(runKey, [record.uid || null, record.canonicalTrainerName || record.legacyUsername || null,
      record.handleKey || null])
  });
  return {
    schemaVersion: 1,
    reportType: 'provider-identity-window-privacy-safe-v1',
    capturedAt: manifest.source.capturedAt,
    sourceCommit: manifest.source.mainCommit,
    counts: manifest.expectedInitialCounts,
    classificationCounts: manifest.operationCounts,
    setEquality: {
      usersEqualsLoginDirectory: manifest.expectedInitialCounts.users === manifest.expectedInitialCounts.loginDirectory,
      canonicalAccountsEqualHandles: manifest.expectedInitialCounts.accounts === manifest.expectedInitialCounts.trainerHandles,
      everyActiveHandleClassifiedOnce: activeRecords.length === manifest.expectedInitialCounts.activeHandles
    },
    conflictCount: manifest.operationCounts.BLOCKED_CONFLICT,
    malformedCount: manifest.operationCounts.MALFORMED,
    runScopedRecordDigests: manifest.records.map(digestRecord).sort((a, b) =>
      a.recordDigest.localeCompare(b.recordDigest)),
    coverageDigest: keyedDigest(runKey, activeRecords.map(digestRecord)),
    manifestDigest: manifest.manifestDigest
  };
}

function writePrivateJson(file, value) {
  const directory = path.dirname(path.resolve(file));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { fs.closeSync(fd); }
  fs.chmodSync(file, 0o600);
}

function expectedDocuments(record, timestamp) {
  if (record.classification === 'MIGRATE_RECIPROCAL_IDENTITY') {
    const result = { status: 'migrated', handleKey: record.handleKey, revision: 1 };
    return {
      [record.targetPaths[0]]: {
        schemaVersion: 1, uid: record.uid, canonicalTrainerName: record.canonicalTrainerName,
        normalizedTrainerName: record.normalizedTrainerName, handleKey: record.handleKey,
        identityKind: 'legacy_migrated', legacyAccessConfigured: true,
        legacyUsername: record.canonicalTrainerName, legacyAuthVersion: record.legacyAuthVersion,
        status: 'active', revision: 1, createdAt: timestamp, updatedAt: timestamp
      },
      [record.targetPaths[1]]: {
        schemaVersion: 1, uid: record.uid, canonicalTrainerName: record.canonicalTrainerName,
        normalizedTrainerName: record.normalizedTrainerName, state: 'active', revision: 1,
        claimedAt: timestamp, updatedAt: timestamp
      },
      [record.targetPaths[2]]: {
        schemaVersion: 1, operation: 'applyMigrationManifest', fingerprint: record.fingerprint,
        result, createdAt: timestamp
      },
      [record.targetPaths[3]]: {
        schemaVersion: 1, uid: record.uid, handleKey: record.handleKey,
        operation: 'applyMigrationManifest', fingerprint: record.fingerprint,
        sourceMappingFingerprint: record.sourceMappingFingerprint, manifestId: record.manifestId,
        manifestFingerprint: record.manifestFingerprint, reviewerDecision: record.reviewerDecision,
        reviewedAt: record.reviewedAt, status: 'complete', createdAt: timestamp
      }
    };
  }
  if (record.classification === 'CREATE_LEGACY_HANDLE_HOLD') {
    return { [record.targetPaths[0]]: {
      schemaVersion: 1, canonicalTrainerName: record.canonicalTrainerName,
      normalizedTrainerName: record.normalizedTrainerName, state: 'legacy_hold', revision: 1
    } };
  }
  return {};
}

async function runManifest(manifest, adapter, options = {}) {
  if (sha256(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestDigest'))) !== manifest.manifestDigest) {
    throw new Error('manifest_digest_mismatch');
  }
  if (manifest.operationCounts.BLOCKED_CONFLICT || manifest.operationCounts.MALFORMED) throw new Error('manifest_blocked');
  if (options.expectedSourceMappingFingerprint &&
      options.expectedSourceMappingFingerprint !== manifest.sourceMappingFingerprint) throw new Error('source_evidence_changed');

  const progress = options.progress || new Map();
  let writes = 0;
  let processed = 0;
  let skipped = 0;
  for (const record of manifest.records) {
    const operationId = keyedDigest(manifest.manifestDigest, [record.classification, record.uid || null,
      record.handleKey || null]);
    if (progress.get(operationId) === 'verified') { skipped += 1; continue; }
    if (!WRITABLE_CLASSES.has(record.classification) || record.operation === 'VERIFY_ONLY') {
      await adapter.verify(record);
      progress.set(operationId, 'verified');
      processed += 1;
      if (options.interruptAfter && processed === options.interruptAfter) {
        throw Object.assign(new Error('simulated_interruption'), { progress });
      }
      continue;
    }
    const documents = record.expectedResult || expectedDocuments(record, options.timestamp || 1);
    let outcome;
    try { outcome = await adapter.createOnly(record, documents); }
    catch (error) {
      if (error?.code !== 'transport_ambiguous') throw error;
      outcome = 'ambiguous';
    }
    const exact = await adapter.readback(record, documents);
    if (!exact) throw new Error(outcome === 'ambiguous' ? 'ambiguous_readback_failed' : 'exact_readback_failed');
    progress.set(operationId, 'verified');
    writes += Object.keys(documents).length;
    processed += 1;
    if (options.interruptAfter && processed === options.interruptAfter) throw Object.assign(new Error('simulated_interruption'), { progress });
  }
  return Object.freeze({ processed, skipped, writes, progress, coverageDigest: sha256([...progress.entries()].sort()) });
}

module.exports = {
  CLASSES, stableJson, sha256, keyedDigest, classifySnapshot, publicReport, writePrivateJson,
  expectedDocuments, runManifest
};
