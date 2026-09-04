'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHandle } = require('../e1-authority-service/handleNormalization.js');
const { privatePath } = require('./providerIdentityPrivateFiles.cjs');

const CLASSES = Object.freeze([
  'ALREADY_CANONICAL',
  'MIGRATE_RECIPROCAL_IDENTITY',
  'CREATE_LEGACY_HANDLE_HOLD',
  'UNPAIRED_AUTHINDEX_REVIEW',
  'BLOCKED_CONFLICT',
  'MALFORMED'
]);
const WRITABLE_CLASSES = new Set(['MIGRATE_RECIPROCAL_IDENTITY', 'CREATE_LEGACY_HANDLE_HOLD']);
const TARGET_STATES = Object.freeze({ ALL_ABSENT: 'ALL_ABSENT', ALL_EXACT: 'ALL_EXACT',
  PARTIAL_OR_DIFFERENT: 'PARTIAL_OR_DIFFERENT' });

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
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
  const uidReferences = new Map();
  for (const user of Object.values(users)) {
    if (typeof user?.authUid === 'string' && user.authUid) {
      uidReferences.set(user.authUid, (uidReferences.get(user.authUid) || 0) + 1);
    }
  }

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
    if (uid && (!/^[A-Za-z0-9:_-]{1,128}$/u.test(uid) || uidReferences.get(uid) !== 1)) {
      records.push({ classification: 'BLOCKED_CONFLICT', canonicalTrainerName,
        normalizedTrainerName: normalized.normalized, handleKey: normalized.handleKey,
        reason: 'invalid_or_duplicate_uid' });
      continue;
    }
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
      if (!Number.isSafeInteger(expected.legacyAuthVersion) || expected.legacyAuthVersion < 1 ||
          (authRecord.authVersion !== undefined && directory.authVersion !== undefined &&
           Number(authRecord.authVersion) !== Number(directory.authVersion))) {
        records.push({ classification: 'BLOCKED_CONFLICT', ...expected, reason: 'legacy_auth_version_conflict' });
        continue;
      }
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
      provisioningContractDigest: metadata.provisioningContractDigest,
      namespaceBaselines: Object.fromEntries(['operationRequests', 'identityMigrations'].map((root) =>
        [root, structuredClone(snapshot[root] || {})]))
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
  privatePath(file, { missing: true });
  const directory = path.dirname(file);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
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

function operationId(manifest, record) {
  return keyedDigest(manifest.manifestDigest, [record.classification, record.uid || null, record.handleKey || null]);
}

function progressEntry(documents) {
  return Object.freeze({ state: 'verified', documentsDigest: sha256(documents) });
}

function progressVerified(value, documents) {
  return value === 'verified' || (value?.state === 'verified' && value.documentsDigest === sha256(documents));
}

async function readExpectedDocuments(adapter, documents) {
  const targets = Object.keys(documents);
  if (typeof adapter.readDocuments === 'function') return adapter.readDocuments(targets);
  if (typeof adapter.readDocument === 'function') {
    return Object.fromEntries(await Promise.all(targets.map(async (target) => [target, await adapter.readDocument(target)])));
  }
  throw new Error('document_reader_required');
}

function classifyTargetState(observed, expected) {
  const targets = Object.keys(expected);
  if (targets.every((target) => observed[target] === null || observed[target] === undefined)) return TARGET_STATES.ALL_ABSENT;
  if (targets.every((target) => stableJson(observed[target]) === stableJson(expected[target]))) return TARGET_STATES.ALL_EXACT;
  return TARGET_STATES.PARTIAL_OR_DIFFERENT;
}

async function verifyRecordExact(record, documents, adapter) {
  if (!Object.keys(documents).length) {
    await adapter.verify(record);
    return;
  }
  const observed = await readExpectedDocuments(adapter, documents);
  if (classifyTargetState(observed, documents) !== TARGET_STATES.ALL_EXACT) throw new Error('verified_progress_not_exact');
}

async function runManifest(manifest, adapter, options = {}) {
  validateManifest(manifest);
  if (options.expectedSourceMappingFingerprint &&
      options.expectedSourceMappingFingerprint !== manifest.sourceMappingFingerprint) throw new Error('source_evidence_changed');

  const progress = options.progress || new Map();
  let writes = 0;
  let processed = 0;
  let skipped = 0;
  for (const record of manifest.records) {
    const id = operationId(manifest, record);
    const documents = record.expectedResult || expectedDocuments(record, options.timestamp || 1);
    if (progressVerified(progress.get(id), documents)) {
      await verifyRecordExact(record, documents, adapter);
      skipped += 1;
      continue;
    }
    if (!WRITABLE_CLASSES.has(record.classification) || record.operation === 'VERIFY_ONLY') {
      await verifyRecordExact(record, documents, adapter);
      progress.set(id, progressEntry(documents));
      await options.checkpoint?.(progress, { operationId: id, record, reconciled: true });
      processed += 1;
      await options.afterCheckpoint?.({ operationId: id, record });
      if (options.interruptAfter && processed === options.interruptAfter) {
        throw Object.assign(new Error('simulated_interruption'), { progress });
      }
      continue;
    }
    let observed = await readExpectedDocuments(adapter, documents);
    let state = classifyTargetState(observed, documents);
    let sent = false;
    if (state === TARGET_STATES.PARTIAL_OR_DIFFERENT) throw new Error('manifest_target_partial_or_different');
    if (state === TARGET_STATES.ALL_ABSENT) {
      try {
        if (options.beforeCommit) await options.beforeCommit(record, documents);
        await adapter.createOnly(record, documents);
        sent = true;
      } catch (error) {
        const reconcilable = error?.code === 'transport_ambiguous' || [409, 412].includes(error?.status);
        if (!reconcilable) throw error;
      }
      observed = await readExpectedDocuments(adapter, documents);
      state = classifyTargetState(observed, documents);
      if (state !== TARGET_STATES.ALL_EXACT) throw new Error('create_only_reconciliation_conflict');
      await options.afterCommitBeforeCheckpoint?.({ operationId: id, record, sent });
    }
    progress.set(id, progressEntry(documents));
    await options.checkpoint?.(progress, { operationId: id, record, reconciled: !sent });
    writes += sent ? Object.keys(documents).length : 0;
    processed += 1;
    await options.afterCheckpoint?.({ operationId: id, record });
    if (options.interruptAfter && processed === options.interruptAfter) throw Object.assign(new Error('simulated_interruption'), { progress });
  }
  return Object.freeze({ processed, skipped, writes, progress, coverageDigest: sha256([...progress.entries()].sort()) });
}

function validateManifest(manifest) {
  if (sha256(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestDigest'))) !== manifest.manifestDigest) {
    throw new Error('manifest_digest_mismatch');
  }
  if (manifest.schemaVersion !== 1 || manifest.manifestType !== 'provider-identity-production-window-v1' ||
      !Array.isArray(manifest.records) || !manifest.records.length) throw new Error('manifest_schema_invalid');
  const counts = Object.fromEntries(CLASSES.map((name) => [name, manifest.records.filter((r) => r.classification === name).length]));
  if (stableJson(counts) !== stableJson(manifest.operationCounts)) throw new Error('manifest_counts_invalid');
  if (counts.BLOCKED_CONFLICT || counts.MALFORMED) throw new Error('manifest_blocked');
  const handles = new Set(), uids = new Set(), targets = new Set();
  for (const record of manifest.records) {
    if (!CLASSES.includes(record.classification)) throw new Error('manifest_class_invalid');
    if (record.classification === 'UNPAIRED_AUTHINDEX_REVIEW') {
      if (record.operation !== 'PRESERVE_ONLY' || record.targetPaths || record.expectedResult) throw new Error('unpaired_write_forbidden');
      continue;
    }
    const normalized = normalizeHandle(record.canonicalTrainerName);
    if (normalized.normalized !== record.normalizedTrainerName || normalized.handleKey !== record.handleKey ||
        handles.has(record.handleKey)) throw new Error('manifest_handle_invalid');
    handles.add(record.handleKey);
    if (record.classification !== 'CREATE_LEGACY_HANDLE_HOLD') {
      if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(record.uid || '') || uids.has(record.uid)) throw new Error('manifest_uid_invalid');
      uids.add(record.uid);
    }
    const allowed = record.classification === 'CREATE_LEGACY_HANDLE_HOLD' ? [`trainerHandles/${record.handleKey}`] :
      [`accounts/${record.uid}`, `trainerHandles/${record.handleKey}`];
    if (record.classification === 'MIGRATE_RECIPROCAL_IDENTITY') {
      if (record.operation !== 'CREATE_ACCOUNT_AND_HANDLE' ||
          record.sourceMappingFingerprint !== sourceFingerprint(record) ||
          record.operationId !== `migration-${record.sourceMappingFingerprint.slice(0, 24)}`) throw new Error('manifest_migration_invalid');
      allowed.push(`operationRequests/${record.uid}/requests/${record.operationId}`,
        `identityMigrations/${record.uid}/operations/${record.operationId}`);
    } else if (record.classification === 'ALREADY_CANONICAL' && record.operation !== 'VERIFY_ONLY') {
      throw new Error('canonical_write_forbidden');
    }
    if (stableJson(allowed) !== stableJson(record.targetPaths) ||
        stableJson([...allowed].sort()) !== stableJson(Object.keys(record.expectedResult || {}).sort())) {
      throw new Error('manifest_targets_invalid');
    }
    for (const target of allowed) {
      if (targets.has(target)) throw new Error('manifest_target_duplicate');
      targets.add(target);
    }
    if (WRITABLE_CLASSES.has(record.classification) && stableJson(record.expectedResult) !==
        stableJson(expectedDocuments(record, Date.parse(manifest.source.capturedAt)))) throw new Error('manifest_documents_invalid');
    if (record.classification === 'ALREADY_CANONICAL' && !exactCanonical(
      record.expectedResult[allowed[0]], record.expectedResult[allowed[1]], record)) throw new Error('canonical_identity_invalid');
  }
  if (handles.size !== manifest.expectedInitialCounts.activeHandles) throw new Error('manifest_coverage_invalid');
}

function validateManifestSource(manifest, snapshot) {
  validateManifest(manifest);
  for (const root of ['authIndex', 'users', 'loginDirectory', 'accounts', 'trainerHandles']) {
    if (sha256(snapshot[root] || {}) !== manifest.source.sourceDigests?.[root]) throw new Error('manifest_snapshot_digest_invalid');
  }
  const rebuilt = classifySnapshot(snapshot, manifest.source).manifest;
  if (stableJson(rebuilt.records) !== stableJson(manifest.records) ||
      stableJson(rebuilt.expectedInitialCounts) !== stableJson(manifest.expectedInitialCounts) ||
      rebuilt.sourceMappingFingerprint !== manifest.sourceMappingFingerprint ||
      stableJson(rebuilt.source.namespaceBaselines) !== stableJson(manifest.source.namespaceBaselines)) {
    throw new Error('manifest_snapshot_mapping_invalid');
  }
}

module.exports = {
  CLASSES, stableJson, sha256, keyedDigest, classifySnapshot, publicReport, writePrivateJson,
  TARGET_STATES, expectedDocuments, operationId, progressEntry, progressVerified, readExpectedDocuments,
  classifyTargetState, runManifest, validateManifest, validateManifestSource
};
