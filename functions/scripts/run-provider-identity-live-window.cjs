#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  sha256, stableJson, runManifest
} = require('../production/providerIdentityWindow.cjs');
const { readProduction } = require('./prepare-provider-identity-window.cjs');

const PROJECT_ID = 'trade-list-a4297';
const FIRESTORE_DATABASE = 'phase-e-identity';
const RTDB_URL = 'https://trade-list-a4297-default-rtdb.firebaseio.com';
const APPROVAL = 'APPROVE LIVE IDENTITY PREP WINDOW';
const MUTATING_ACTIONS = new Set(['activate-freeze', 'apply-manifest', 'create-certification',
  'invalidate-certification', 'release-freeze']);

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
  const approval = fs.readFileSync(path.resolve(options.approvalFile), 'utf8').trim();
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
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  return undefined;
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

function atomicWrite(file, value) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, resolved);
  fs.chmodSync(resolved, 0o600);
}

function createProductionAdapter(token) {
  const firestoreRoot = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}`;
  const headers = { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': PROJECT_ID,
    'Content-Type': 'application/json' };
  async function request(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } }); }
    catch (error) { throw Object.assign(error, { code: 'transport_ambiguous' }); }
    const body = await response.text();
    if (!response.ok) throw Object.assign(new Error(`http_${response.status}`), { status: response.status, body });
    return body ? JSON.parse(body) : null;
  }
  async function readDocument(target) {
    try { return documentData(await request(`${firestoreRoot}/documents/${target}`)); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function commitCreateOnly(documents) {
    const writes = Object.entries(documents).map(([target, value]) => ({
      update: { name: `${firestoreRoot}/documents/${target}`, fields: fields(value) },
      currentDocument: { exists: false }
    }));
    return request(`${firestoreRoot}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
  }
  async function createExactDocument(target, value) {
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
      update: { name: `${firestoreRoot}/documents/${target}`, fields: fields(next) },
      currentDocument: { updateTime: existing.updateTime }
    }] }) });
    if (!exact(await readDocument(target), next)) throw new Error('exact_readback_failed');
  }
  async function deleteExactDocument(target, expected) {
    const existing = await request(`${firestoreRoot}/documents/${target}`);
    if (!exact(documentData(existing), expected)) throw new Error('delete_precondition_changed');
    await request(`${firestoreRoot}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [{
      delete: `${firestoreRoot}/documents/${target}`, currentDocument: { updateTime: existing.updateTime }
    }] }) });
    if (await readDocument(target)) throw new Error('delete_readback_failed');
  }
  async function readRtdb(target) {
    const response = await fetch(`${RTDB_URL}/${target}.json`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' }
    });
    if (!response.ok) throw new Error(`rtdb_read_${response.status}`);
    return { value: await response.json(), etag: response.headers.get('etag') };
  }
  async function writeRtdbExact(target, current, next) {
    const observed = await readRtdb(target);
    if (!exact(observed.value, current)) throw new Error('rtdb_precondition_changed');
    const response = await fetch(`${RTDB_URL}/${target}.json`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'if-match': observed.etag }, body: JSON.stringify(next)
    });
    if (!response.ok) throw new Error(`rtdb_write_${response.status}`);
    if (!exact((await readRtdb(target)).value, next)) throw new Error('rtdb_readback_failed');
  }
  return {
    readDocument, createExactDocument, updateExactDocument, deleteExactDocument, readRtdb, writeRtdbExact,
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

async function run(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  requireTarget(options);
  if (!options.action) throw new Error('action_required');
  if (MUTATING_ACTIONS.has(options.action)) requireApproval(options);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
  const unsigned = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestDigest'));
  if (sha256(unsigned) !== manifest.manifestDigest) throw new Error('manifest_digest_mismatch');
  const token = (dependencies.env || process.env)[options.accessTokenEnv || 'GCLOUD_ACCESS_TOKEN'];
  if (!token && options.execute) throw new Error('access_token_missing');
  const freezeId = `legacy-freeze-${manifest.manifestDigest.slice(0, 16)}`;
  const activatedAt = Number(options.activatedAt || Date.now());
  const freeze = {
    schemaVersion: 1, state: 'active', provisioningModel: 'bounded-legacy-provisioning-freeze', freezeId,
    provisioningContractDigest: manifest.source.provisioningContractDigest, activatedAt, releasedAt: null
  };
  if (!options.execute) {
    console.log(JSON.stringify({ action: options.action, execute: false, productionWrites: 0,
      manifestDigest: manifest.manifestDigest, freezeId, requiredApproval: APPROVAL }));
    return { dryRun: true };
  }
  const adapter = dependencies.adapter || createProductionAdapter(token);

  if (options.action === 'activate-freeze') {
    await adapter.createExactDocument('authorityConfig/legacyProvisioningFreeze', freeze);
    await adapter.writeRtdbExact('legacyProvisioningFreeze', null, freeze);
  } else if (options.action === 'verify-freeze') {
    if (!exact(await adapter.readDocument('authorityConfig/legacyProvisioningFreeze'), freeze) ||
        !exact((await adapter.readRtdb('legacyProvisioningFreeze')).value, freeze)) throw new Error('freeze_not_exact');
  } else if (options.action === 'apply-manifest') {
    const current = await (dependencies.readProduction || readProduction)(token);
    const digests = Object.fromEntries(Object.entries(current).map(([key, value]) => [key, sha256(value)]));
    if (!exact(digests, manifest.source.sourceDigests)) throw new Error('post_freeze_source_evidence_changed');
    const progressFile = path.resolve(options.progressFile);
    const progressData = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : {};
    const progress = new Map(Object.entries(progressData));
    const result = await runManifest(manifest, adapter, {
      progress, expectedSourceMappingFingerprint: manifest.sourceMappingFingerprint
    });
    atomicWrite(progressFile, Object.fromEntries(result.progress));
  } else if (options.action === 'create-certification') {
    const report = JSON.parse(fs.readFileSync(path.resolve(options.dryRunReport), 'utf8'));
    const now = Number(options.certifiedAt || Date.now());
    const certification = { ...report.certificationCandidate, freezeId, inventoryCapturedAt: activatedAt,
      certifiedAt: now, expiresAt: now + 15 * 60 * 1000 };
    await adapter.createExactDocument('authorityConfig/providerCreationCertification', certification);
  } else if (options.action === 'invalidate-certification') {
    const existing = await adapter.readDocument('authorityConfig/providerCreationCertification');
    if (existing) await adapter.deleteExactDocument('authorityConfig/providerCreationCertification', existing);
  } else if (options.action === 'release-freeze') {
    const active = await adapter.readDocument('authorityConfig/legacyProvisioningFreeze');
    if (!active || active.state !== 'active' || active.freezeId !== freezeId) throw new Error('freeze_not_active');
    const released = { ...active, state: 'released', releasedAt: Number(options.releasedAt || Date.now()) };
    await adapter.updateExactDocument('authorityConfig/legacyProvisioningFreeze', active, released);
    await adapter.writeRtdbExact('legacyProvisioningFreeze', active, released);
  } else throw new Error('unsupported_action');
  console.log(JSON.stringify({ action: options.action, execute: true, status: 'verified', manifestDigest: manifest.manifestDigest }));
  return { status: 'verified' };
}

module.exports = { APPROVAL, parseArgs, requireTarget, requireApproval, encode, decode, exact, createProductionAdapter, run };
if (require.main === module) run().catch((error) => {
  console.error(`provider identity live operator failed: ${error.message}`);
  process.exitCode = 1;
});
