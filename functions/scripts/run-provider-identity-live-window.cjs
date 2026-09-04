#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  sha256, stableJson, runManifest, validateManifest, validateManifestSource, operationId, progressEntry, progressVerified,
  readExpectedDocuments, classifyTargetState, TARGET_STATES
} = require('../production/providerIdentityWindow.cjs');
const { readProduction } = require('./prepare-provider-identity-window.cjs');
const { AUTHORITY_CONFIG_PATHS } = require('../production/providerIdentityAuthorityContract.cjs');
const { privatePath, readPrivate, atomicWrite } = require('../production/providerIdentityPrivateFiles.cjs');

const PROJECT_ID = 'trade-list-a4297';
const FIRESTORE_DATABASE = 'phase-e-identity';
const RTDB_URL = 'https://trade-list-a4297-default-rtdb.firebaseio.com';
const APPROVAL = 'APPROVE LIVE IDENTITY PREP WINDOW';
const MUTATING_ACTIONS = new Set(['activate-freeze', 'apply-manifest', 'create-certification',
  'invalidate-certification', 'release-freeze']);
const ACTIONS = new Set([...MUTATING_ACTIONS, 'verify-freeze', 'verify-certification']);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--execute') { options.execute = true; continue; }
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('invalid_arguments');
    options[argv[index].slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  return options;
}

function requireTarget(options) {
  if (options.confirmProject !== PROJECT_ID || options.confirmFirestoreDatabase !== FIRESTORE_DATABASE ||
      options.confirmRtdbUrl !== RTDB_URL) throw new Error('production_target_not_confirmed');
}

function requireApproval(options) {
  if (!options.execute) return;
  const approval = readPrivate(options.approvalFile).trim();
  if (approval !== APPROVAL) throw new Error('live_approval_missing');
  const mode = fs.statSync(path.resolve(options.approvalFile)).mode & 0o777;
  if (mode !== 0o600) throw new Error('approval_file_permissions_invalid');
}

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isSafeInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') return {
    mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) }
  };
  throw new Error('firestore_value_unsupported');
}

function decode(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'timestampValue')) return value.timestampValue;
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  throw new Error('firestore_value_unsupported');
}

function fields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}

function documentData(document) {
  return document?.fields ? Object.fromEntries(Object.entries(document.fields).map(([key, item]) => [key, decode(item)])) : null;
}

function exact(actual, expected) {
  return stableJson(actual) === stableJson(expected);
}

function createProductionAdapter(token, fetcher = fetch) {
  const resourceRoot = `projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}`;
  const firestoreRoot = `https://firestore.googleapis.com/v1/${resourceRoot}`;
  const headers = { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': PROJECT_ID,
    'Content-Type': 'application/json' };
  async function request(url, options = {}) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30000), ...options,
        headers: { ...headers, ...(options.headers || {}) } });
      const body = await response.text();
      if (!response.ok) throw Object.assign(new Error(`http_${response.status}`), { status: response.status });
      return body ? JSON.parse(body) : null;
    } catch (error) {
      if (error.status) throw error;
      throw Object.assign(new Error('transport_ambiguous'), { code: 'transport_ambiguous' });
    }
  }
  async function readDocument(target) {
    try { return documentData(await request(`${firestoreRoot}/documents/${target}`)); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function commitCreateOnly(documents) {
    const writes = Object.entries(documents).map(([target, value]) => ({
      update: { name: `${resourceRoot}/documents/${target}`, fields: fields(value) },
      currentDocument: { exists: false }
    }));
    return request(`${firestoreRoot}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
  }
  async function createExactDocument(target, value) {
    const initial = await readDocument(target);
    if (exact(initial, value)) return;
    if (initial !== null) throw new Error('create_only_conflict');
    try { await commitCreateOnly({ [target]: value }); }
    catch (error) {
      if (![409, 412].includes(error.status) && error.code !== 'transport_ambiguous') throw error;
      const observed = await readDocument(target);
      if (!exact(observed, value)) throw new Error('create_only_conflict');
    }
    if (!exact(await readDocument(target), value)) throw new Error('exact_readback_failed');
  }
  async function updateExactDocument(target, current, next) {
    const existing = await request(`${firestoreRoot}/documents/${target}`);
    if (!exact(documentData(existing), current)) throw new Error('update_precondition_changed');
    await request(`${firestoreRoot}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [{
      update: { name: `${resourceRoot}/documents/${target}`, fields: fields(next) },
      currentDocument: { updateTime: existing.updateTime }
    }] }) });
    if (!exact(await readDocument(target), next)) throw new Error('exact_readback_failed');
  }
  async function deleteExactDocument(target, expected) {
    const existing = await request(`${firestoreRoot}/documents/${target}`);
    if (!exact(documentData(existing), expected)) throw new Error('delete_precondition_changed');
    await request(`${firestoreRoot}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [{
      delete: `${resourceRoot}/documents/${target}`, currentDocument: { updateTime: existing.updateTime }
    }] }) });
    if (await readDocument(target)) throw new Error('delete_readback_failed');
  }
  async function readRtdb(target) {
    const response = await fetcher(`${RTDB_URL}/${target}.json`, {
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' }
    });
    if (!response.ok) throw new Error(`rtdb_read_${response.status}`);
    return { value: await response.json(), etag: response.headers.get('etag') };
  }
  async function writeRtdbExact(target, current, next) {
    const observed = await readRtdb(target);
    if (!exact(observed.value, current)) throw new Error('rtdb_precondition_changed');
    if (!observed.etag) throw new Error('rtdb_etag_missing');
    const response = await fetcher(`${RTDB_URL}/${target}.json`, {
      signal: AbortSignal.timeout(30000),
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'if-match': observed.etag }, body: JSON.stringify(next)
    });
    if (!response.ok) throw new Error(`rtdb_write_${response.status}`);
    if (!exact((await readRtdb(target)).value, next)) throw new Error('rtdb_readback_failed');
  }
  return {
    readDocument,
    async readDocuments(targets) {
      return Object.fromEntries(await Promise.all(targets.map(async (target) => [target, await readDocument(target)])));
    },
    createExactDocument, updateExactDocument, deleteExactDocument, readRtdb, writeRtdbExact,
    async verify(record) {
      if (!record.expectedResult) return;
      for (const [target, expected] of Object.entries(record.expectedResult)) {
        if (!exact(await readDocument(target), expected)) throw new Error('verify_existing_failed');
      }
    },
    async createOnly(record, documents) { return commitCreateOnly(documents); },
    async readback(record, documents) {
      for (const [target, expected] of Object.entries(documents)) if (!exact(await readDocument(target), expected)) return false;
      return true;
    }
  };
}

function unsignedDigest(value, digestField) {
  return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestField)));
}

function progressLedger(manifest, progress) {
  const base = {
    schemaVersion: 1,
    ledgerType: 'provider-identity-operation-progress-v1',
    manifestDigest: manifest.manifestDigest,
    operations: Object.fromEntries([...progress.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
  return { ...base, ledgerDigest: sha256(base) };
}

function loadProgress(file, manifest) {
  const resolved = privatePath(file, { missing: true });
  if (!fs.existsSync(resolved)) return { progress: new Map(), ledger: progressLedger(manifest, new Map()) };
  const ledger = JSON.parse(readPrivate(resolved));
  if (ledger.schemaVersion !== 1 || ledger.ledgerType !== 'provider-identity-operation-progress-v1' ||
      ledger.manifestDigest !== manifest.manifestDigest || unsignedDigest(ledger, 'ledgerDigest') !== ledger.ledgerDigest ||
      !ledger.operations || typeof ledger.operations !== 'object' || Array.isArray(ledger.operations)) {
    throw new Error('progress_ledger_invalid');
  }
  const progress = new Map(Object.entries(ledger.operations));
  const known = new Map(manifest.records.map((record) => {
    const documents = record.expectedResult || {};
    return [operationId(manifest, record), progressEntry(documents)];
  }));
  for (const [id, entry] of progress) {
    if (!known.has(id) || !exact(entry, known.get(id))) throw new Error('progress_ledger_entry_invalid');
  }
  return { progress, ledger };
}

function writeProgress(file, manifest, progress) {
  const ledger = progressLedger(manifest, progress);
  atomicWrite(file, ledger);
  return ledger;
}

function freezeDocuments(manifest, activatedAt) {
  if (!Number.isSafeInteger(Number(activatedAt)) || Number(activatedAt) <= 0) throw new Error('freeze_timestamp_invalid');
  const freezeId = `legacy-freeze-${manifest.manifestDigest.slice(0, 16)}`;
  return {
    freezeId,
    active: {
      schemaVersion: 1, state: 'active', provisioningModel: 'bounded-legacy-provisioning-freeze', freezeId,
      provisioningContractDigest: manifest.source.provisioningContractDigest,
      activatedAt: Number(activatedAt), releasedAt: null
    }
  };
}

function activeFreezeForManifest(manifest, candidate, fallbackActivatedAt) {
  const activatedAt = candidate?.activatedAt ?? Number(fallbackActivatedAt);
  const { active } = freezeDocuments(manifest, activatedAt);
  if (candidate && !exact(candidate, active)) throw new Error('freeze_manifest_conflict');
  return active;
}

function freezeState(value, active, released) {
  if (value === null || value === undefined) return 'ABSENT';
  if (exact(value, active)) return 'ACTIVE';
  if (released && exact(value, released)) return 'RELEASED';
  return 'DIFFERENT';
}

async function activateFreeze(adapter, active) {
  const firestore = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
  const rtdb = (await adapter.readRtdb('legacyProvisioningFreeze')).value;
  const states = [freezeState(firestore, active), freezeState(rtdb, active)];
  if (states.includes('DIFFERENT') || states.includes('RELEASED')) throw new Error('freeze_activation_conflict');
  if (states[0] === 'ABSENT') await adapter.createExactDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, active);
  if (states[1] === 'ABSENT') await adapter.writeRtdbExact('legacyProvisioningFreeze', null, active);
  if (!exact(await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze), active) ||
      !exact((await adapter.readRtdb('legacyProvisioningFreeze')).value, active)) throw new Error('freeze_activation_readback_failed');
  return { firestore: states[0], rtdb: states[1] };
}

async function releaseFreeze(adapter, active, releasedAt) {
  if (await adapter.readDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation)) {
    throw new Error('certification_must_be_invalidated_before_release');
  }
  const firestore = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
  const rtdb = (await adapter.readRtdb('legacyProvisioningFreeze')).value;
  const existingReleased = [firestore, rtdb].find((value) => value?.state === 'released');
  const released = existingReleased || { ...active, state: 'released', releasedAt: Number(releasedAt) };
  if (!Number.isSafeInteger(released.releasedAt) || released.releasedAt < active.activatedAt) {
    throw new Error('freeze_release_timestamp_invalid');
  }
  if (!exact({ ...released, state: 'active', releasedAt: null }, active)) throw new Error('freeze_release_conflict');
  const states = [freezeState(firestore, active, released), freezeState(rtdb, active, released)];
  if (states.includes('DIFFERENT')) throw new Error('freeze_release_conflict');
  if (states[0] === 'ACTIVE') await adapter.updateExactDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze, active, released);
  if (states[1] === 'ACTIVE') await adapter.writeRtdbExact('legacyProvisioningFreeze', active, released);
  if (!exact(await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze), states[0] === 'ABSENT' ? null : released) ||
      !exact((await adapter.readRtdb('legacyProvisioningFreeze')).value, states[1] === 'ABSENT' ? null : released)) {
    throw new Error('freeze_release_readback_failed');
  }
  return { released, firestore: states[0], rtdb: states[1] };
}

async function verifyActiveFreeze(adapter, active) {
  const firestore = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
  const rtdb = (await adapter.readRtdb('legacyProvisioningFreeze')).value;
  if (!exact(firestore, active) || !exact(rtdb, active) || firestore.freezeId !== rtdb.freezeId ||
      firestore.provisioningContractDigest !== rtdb.provisioningContractDigest) throw new Error('freeze_not_exact_active');
  return { firestore, rtdb };
}

function expectedNamespace(manifest, progress, collection) {
  const expected = {};
  for (const record of manifest.records) {
    const documents = record.expectedResult || {};
    const initial = record.operation === 'VERIFY_ONLY';
    if (!initial && !progressVerified(progress.get(operationId(manifest, record)), documents)) continue;
    for (const [target, value] of Object.entries(documents)) {
      if (target.startsWith(`${collection}/`)) expected[target.slice(collection.length + 1)] = value;
    }
  }
  return expected;
}

function expectedNestedNamespace(manifest, progress, prefix) {
  const expected = structuredClone(manifest.source.namespaceBaselines?.[prefix] || {});
  for (const record of manifest.records) {
    const documents = record.expectedResult || {};
    if (!progressVerified(progress.get(operationId(manifest, record)), documents)) continue;
    for (const [target, value] of Object.entries(documents)) if (target.startsWith(`${prefix}/`)) expected[target] = value;
  }
  return expected;
}

function verifyProgressAwareDrift(manifest, current, progress) {
  for (const root of ['authIndex', 'users', 'loginDirectory']) {
    if (sha256(current[root] || {}) !== manifest.source.sourceDigests[root]) throw new Error(`unexpected_source_drift:${root}`);
  }
  for (const collection of ['accounts', 'trainerHandles']) {
    if (!exact(current[collection] || {}, expectedNamespace(manifest, progress, collection))) {
      throw new Error(`unexpected_namespace_drift:${collection}`);
    }
  }
  for (const collection of ['operationRequests', 'identityMigrations']) {
    if (!manifest.source.namespaceBaselines) throw new Error('manifest_namespace_baseline_missing');
    if (!exact(current[collection] || {},
      expectedNestedNamespace(manifest, progress, collection))) {
      throw new Error(`unexpected_namespace_drift:${collection}`);
    }
  }
}

async function preflightManifest(manifest, adapter, progress, checkpoint) {
  for (const record of manifest.records) {
    const id = operationId(manifest, record);
    const documents = record.expectedResult || {};
    if (!Object.keys(documents).length) {
      await adapter.verify(record);
      if (!progressVerified(progress.get(id), documents)) {
        progress.set(id, progressEntry(documents));
        await checkpoint(progress);
      }
      continue;
    }
    const state = classifyTargetState(await readExpectedDocuments(adapter, documents), documents);
    if (progressVerified(progress.get(id), documents) && state !== TARGET_STATES.ALL_EXACT) {
      throw new Error('verified_progress_not_exact');
    }
    if (state === TARGET_STATES.PARTIAL_OR_DIFFERENT) throw new Error('manifest_target_partial_or_different');
    if (state === TARGET_STATES.ALL_EXACT && !progressVerified(progress.get(id), documents)) {
      progress.set(id, progressEntry(documents));
      await checkpoint(progress);
    }
    if (record.operation === 'VERIFY_ONLY' && state !== TARGET_STATES.ALL_EXACT) throw new Error('verify_existing_failed');
  }
}

function coverageDigest(manifest, current) {
  const records = manifest.records.filter((record) => record.classification !== 'UNPAIRED_AUTHINDEX_REVIEW');
  return sha256(records.map((record) => [record.handleKey,
    current.trainerHandles?.[record.handleKey]?.state || null]).sort(([left], [right]) => left.localeCompare(right)));
}

function buildCompletionArtifact(manifest, active, ledger, current, inventoryCapturedAt) {
  const activeRecords = manifest.records.filter((record) => record.classification !== 'UNPAIRED_AUTHINDEX_REVIEW');
  const base = {
    schemaVersion: 1,
    artifactType: 'provider-identity-live-completion-v1',
    manifestDigest: manifest.manifestDigest,
    freezeId: active.freezeId,
    progressLedgerDigest: ledger.ledgerDigest,
    completedOperationCount: Object.keys(ledger.operations).length,
    expectedOperationCount: manifest.records.length,
    finalAccountCount: Object.keys(current.accounts || {}).length,
    finalTrainerHandleCount: Object.keys(current.trainerHandles || {}).length,
    activeLegacyHandleCount: manifest.expectedInitialCounts.activeHandles,
    activeFirestoreHandleCount: Object.values(current.trainerHandles || {}).filter((value) => value?.state === 'active').length,
    legacyHoldCount: Object.values(current.trainerHandles || {}).filter((value) => value?.state === 'legacy_hold').length,
    completeProtectedHandleCount: activeRecords.filter((record) => ['active', 'legacy_hold'].includes(
      current.trainerHandles?.[record.handleKey]?.state)).length,
    coverageDigest: coverageDigest(manifest, current),
    inventoryCapturedAt: Number(inventoryCapturedAt),
    rtdbSourceDigests: Object.fromEntries(['authIndex', 'users', 'loginDirectory'].map((root) => [root, sha256(current[root] || {})])),
    firestoreSourceDigests: Object.fromEntries(['accounts', 'trainerHandles', 'operationRequests', 'identityMigrations']
      .map((root) => [root, sha256(current[root] || {})])),
    conflictCount: 0,
    malformedCount: 0,
    partialRecordCount: 0
  };
  return { ...base, artifactDigest: sha256(base) };
}

function verifyCompletionArtifact(completion, manifest, active, ledger, current) {
  if (completion.schemaVersion !== 1 || completion.artifactType !== 'provider-identity-live-completion-v1' ||
      unsignedDigest(completion, 'artifactDigest') !== completion.artifactDigest ||
      completion.manifestDigest !== manifest.manifestDigest || completion.freezeId !== active.freezeId ||
      completion.progressLedgerDigest !== ledger.ledgerDigest ||
      completion.completedOperationCount !== manifest.records.length ||
      completion.expectedOperationCount !== manifest.records.length ||
      completion.completeProtectedHandleCount !== manifest.expectedInitialCounts.activeHandles ||
      completion.coverageDigest !== coverageDigest(manifest, current) ||
      completion.conflictCount !== 0 || completion.malformedCount !== 0 || completion.partialRecordCount !== 0 ||
      !Number.isSafeInteger(completion.inventoryCapturedAt) ||
      completion.inventoryCapturedAt <= active.activatedAt ||
      completion.inventoryCapturedAt > Date.now()) throw new Error('live_completion_invalid');
  const rebuilt = buildCompletionArtifact(manifest, active, ledger, current, completion.inventoryCapturedAt);
  if (!exact(completion, rebuilt)) throw new Error('live_completion_stale');
}

function certificationFromCompletion(manifest, active, completion, certifiedAt) {
  const now = Number(certifiedAt);
  if (!Number.isSafeInteger(now) || now < completion.inventoryCapturedAt || now > Date.now()) {
    throw new Error('certification_timestamp_invalid');
  }
  return {
    schemaVersion: 2, state: 'certified', normalizationVersion: 1,
    provisioningModel: 'bounded-legacy-provisioning-freeze', freezeId: active.freezeId,
    provisioningContractDigest: active.provisioningContractDigest,
    legacyNamespaceCoverageCertified: true,
    activeLegacyHandleCount: completion.activeLegacyHandleCount,
    certifiedHandleCount: completion.completeProtectedHandleCount,
    coverageDigest: completion.coverageDigest,
    inventoryCapturedAt: completion.inventoryCapturedAt,
    certifiedAt: now,
    expiresAt: now + 15 * 60 * 1000
  };
}

function certificationIntent(manifest, active, completion, certification) {
  const value = { schemaVersion: 1, manifestDigest: manifest.manifestDigest,
    completionDigest: completion.artifactDigest, freezeId: active.freezeId, certification };
  return { ...value, intentDigest: sha256(value) };
}

function loadCertificationIntent(file, manifest) {
  const intent = JSON.parse(readPrivate(file));
  if (intent.schemaVersion !== 1 || intent.manifestDigest !== manifest.manifestDigest ||
      unsignedDigest(intent, 'intentDigest') !== intent.intentDigest ||
      intent.freezeId !== freezeDocuments(manifest, 1).freezeId ||
      intent.certification?.freezeId !== intent.freezeId ||
      !/^[a-f0-9]{64}$/u.test(intent.completionDigest || '')) throw new Error('certification_intent_invalid');
  return intent;
}

async function invalidateCertification(adapter, expected) {
  const existing = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation);
  if (!existing) return;
  if (!expected || !exact(existing, expected)) throw new Error('certification_invalidation_conflict');
  await adapter.deleteExactDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation, expected);
}

async function run(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  requireTarget(options);
  if (!ACTIONS.has(options.action)) throw new Error('unsupported_action');
  // Audit containment, not a substitute for the outstanding window capability,
  // provenance, deployment, and emergency-closeout qualification. No CLI bypass.
  if (options.execute && !dependencies.adapter) throw new Error('live_window_audit_blocked');
  if (MUTATING_ACTIONS.has(options.action)) requireApproval(options);
  const manifest = JSON.parse(readPrivate(options.manifest));
  validateManifest(manifest);
  const token = (dependencies.env || process.env)[options.accessTokenEnv || 'GCLOUD_ACCESS_TOKEN'];
  if (!token && options.execute) throw new Error('access_token_missing');
  const activatedAt = Number(options.activatedAt || Date.now());
  const { freezeId } = freezeDocuments(manifest, activatedAt);
  if (!options.execute) {
    console.log(JSON.stringify({ action: options.action, execute: false, productionWrites: 0,
      manifestDigest: manifest.manifestDigest, freezeId, executionQualified: false,
      blocker: 'live_window_audit_blocked' }));
    return { dryRun: true };
  }
  const adapter = dependencies.adapter || createProductionAdapter(token);
  if (['apply-manifest', 'create-certification', 'verify-certification'].includes(options.action)) {
    validateManifestSource(manifest, JSON.parse(readPrivate(options.snapshot)));
  }
  const inputPaths = [options.manifest, options.snapshot, options.approvalFile].filter(Boolean);
  const outputPaths = [options.progressFile, options.completionFile, options.certificationFile].filter(Boolean);
  if (new Set([...inputPaths, ...outputPaths]).size !== inputPaths.length + outputPaths.length) {
    throw new Error('operator_artifact_path_collision');
  }
  for (const file of outputPaths) privatePath(file, { missing: true });

  if (options.action === 'activate-freeze') {
    const [firestore, rtdb] = await Promise.all([
      adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze),
      adapter.readRtdb('legacyProvisioningFreeze').then((result) => result.value)
    ]);
    const active = activeFreezeForManifest(manifest, firestore || rtdb, activatedAt);
    await activateFreeze(adapter, active);
  } else if (options.action === 'verify-freeze') {
    const observed = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
    const active = activeFreezeForManifest(manifest, observed, activatedAt);
    await verifyActiveFreeze(adapter, active);
  } else if (options.action === 'apply-manifest') {
    const progressFile = privatePath(options.progressFile, { missing: true });
    privatePath(options.completionFile, { missing: true });
    const observedFreeze = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
    const active = activeFreezeForManifest(manifest, observedFreeze, activatedAt);
    await verifyActiveFreeze(adapter, active);
    const loaded = loadProgress(progressFile, manifest);
    const progress = loaded.progress;
    const checkpoint = async (value) => writeProgress(progressFile, manifest, value);
    await preflightManifest(manifest, adapter, progress, checkpoint);
    const before = await (dependencies.readProduction || readProduction)(token);
    verifyProgressAwareDrift(manifest, before, progress);
    const result = await runManifest(manifest, adapter, {
      progress, expectedSourceMappingFingerprint: manifest.sourceMappingFingerprint, checkpoint,
      beforeCommit: async () => verifyActiveFreeze(adapter, active),
      afterCommitBeforeCheckpoint: dependencies.afterCommitBeforeCheckpoint,
      afterCheckpoint: dependencies.afterCheckpoint
    });
    const ledger = writeProgress(progressFile, manifest, result.progress);
    if (result.progress.size !== manifest.records.length) throw new Error('manifest_progress_incomplete');
    const current = await (dependencies.readProduction || readProduction)(token);
    verifyProgressAwareDrift(manifest, current, result.progress);
    await verifyActiveFreeze(adapter, active);
    const completion = buildCompletionArtifact(manifest, active, ledger, current,
      Number(options.inventoryCapturedAt || Date.now()));
    verifyCompletionArtifact(completion, manifest, active, ledger, current);
    atomicWrite(options.completionFile, completion);
  } else if (options.action === 'create-certification') {
    if (options.dryRunReport) throw new Error('dry_run_report_not_certification_authority');
    const { progress, ledger } = loadProgress(path.resolve(options.progressFile), manifest);
    if (progress.size !== manifest.records.length) throw new Error('manifest_progress_incomplete');
    await preflightManifest(manifest, adapter, progress, async () => { throw new Error('certification_progress_incomplete'); });
    const current = await (dependencies.readProduction || readProduction)(token);
    verifyProgressAwareDrift(manifest, current, progress);
    const observedFreeze = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
    const active = activeFreezeForManifest(manifest, observedFreeze, activatedAt);
    await verifyActiveFreeze(adapter, active);
    const completion = JSON.parse(readPrivate(options.completionFile));
    verifyCompletionArtifact(completion, manifest, active, ledger, current);
    const now = Number(options.certifiedAt || Date.now());
    if (now < completion.inventoryCapturedAt) throw new Error('certification_precedes_inventory');
    privatePath(options.certificationFile, { missing: true });
    let certification;
    if (fs.existsSync(options.certificationFile)) {
      const intent = loadCertificationIntent(options.certificationFile, manifest);
      if (intent.completionDigest !== completion.artifactDigest || !exact(intent.certification,
        certificationFromCompletion(manifest, active, completion, intent.certification.certifiedAt))) {
        throw new Error('certification_intent_conflict');
      }
      certification = intent.certification;
    } else {
      certification = certificationFromCompletion(manifest, active, completion, now);
      atomicWrite(options.certificationFile, certificationIntent(manifest, active, completion, certification));
    }
    if (certification.expiresAt <= (dependencies.now?.() ?? Date.now())) throw new Error('certification_expired');
    await adapter.createExactDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation, certification);
  } else if (options.action === 'verify-certification') {
    const { progress, ledger } = loadProgress(path.resolve(options.progressFile), manifest);
    if (progress.size !== manifest.records.length) throw new Error('manifest_progress_incomplete');
    await preflightManifest(manifest, adapter, progress, async () => { throw new Error('certification_progress_incomplete'); });
    const current = await (dependencies.readProduction || readProduction)(token);
    verifyProgressAwareDrift(manifest, current, progress);
    const observedFreeze = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze);
    const active = activeFreezeForManifest(manifest, observedFreeze, activatedAt);
    await verifyActiveFreeze(adapter, active);
    const completion = JSON.parse(readPrivate(options.completionFile));
    verifyCompletionArtifact(completion, manifest, active, ledger, current);
    const certification = await adapter.readDocument(AUTHORITY_CONFIG_PATHS.providerAccountCreation);
    if (!certification || !exact(certification, certificationFromCompletion(manifest, active, completion,
      certification.certifiedAt)) || certification.certifiedAt < completion.inventoryCapturedAt ||
      certification.expiresAt <= (dependencies.now?.() ?? Date.now())) {
      throw new Error('certification_not_exact');
    }
  } else if (options.action === 'invalidate-certification') {
    const intent = loadCertificationIntent(options.certificationFile, manifest);
    await invalidateCertification(adapter, intent.certification);
  } else if (options.action === 'release-freeze') {
    const [firestore, rtdb] = await Promise.all([
      adapter.readDocument(AUTHORITY_CONFIG_PATHS.legacyProvisioningFreeze),
      adapter.readRtdb('legacyProvisioningFreeze').then((result) => result.value)
    ]);
    const candidate = [firestore, rtdb].find((value) => value?.freezeId === freezeId);
    const active = activeFreezeForManifest(manifest,
      candidate?.state === 'released' ? { ...candidate, state: 'active', releasedAt: null } : candidate, activatedAt);
    await releaseFreeze(adapter, active, Number(options.releasedAt || Date.now()));
  } else throw new Error('unsupported_action');
  console.log(JSON.stringify({ action: options.action, execute: true, status: 'verified', manifestDigest: manifest.manifestDigest }));
  return { status: 'verified' };
}

module.exports = {
  APPROVAL, parseArgs, requireTarget, requireApproval, encode, decode, exact, atomicWrite,
  createProductionAdapter, progressLedger, loadProgress, writeProgress, freezeDocuments, freezeState,
  activateFreeze, releaseFreeze, verifyActiveFreeze, verifyProgressAwareDrift, preflightManifest,
  buildCompletionArtifact, verifyCompletionArtifact, certificationFromCompletion, run,
  certificationIntent, loadCertificationIntent, invalidateCertification
};
if (require.main === module) run().catch((error) => {
  console.error(`provider identity live operator failed: ${error.message}`);
  process.exitCode = 1;
});
