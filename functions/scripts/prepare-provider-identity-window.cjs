#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { privateDirectory, readPrivate } = require('../production/providerIdentityPrivateFiles.cjs');
const {
  sha256, classifySnapshot, publicReport, writePrivateJson
} = require('../production/providerIdentityWindow.cjs');

const PROJECT_ID = 'trade-list-a4297';
const FIRESTORE_DATABASE = 'phase-e-identity';
const RTDB_URL = 'https://trade-list-a4297-default-rtdb.firebaseio.com';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-production-read') { options.allowProductionRead = true; continue; }
    if (!argument.startsWith('--')) throw new Error('unexpected_argument');
    const name = argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing_argument:${name}`);
    options[name] = value;
  }
  return options;
}

function scalar(value) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['stringValue', 'booleanValue', 'timestampValue']) if (Object.hasOwn(value, key)) return value[key];
  for (const key of ['integerValue', 'doubleValue']) if (Object.hasOwn(value, key)) return Number(value[key]);
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, scalar(item)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(scalar);
  return undefined;
}

function documentData(document) {
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, scalar(value)]));
}

function documentId(document) {
  return String(document.name || '').split('/').at(-1);
}

async function jsonFetch(url, token, options = {}) {
  const response = await fetch(url, { ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`read_failed:${response.status}:${new URL(url).hostname}`);
  return response.json();
}

function relativeDocumentPath(document) {
  return String(document.name || '').split('/documents/').at(-1);
}

async function readCollectionGroup(token, collectionId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents:runQuery`;
  const payload = await jsonFetch(url, token, { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId, allDescendants: true }]
  } }) });
  return Object.fromEntries((payload || []).filter((row) => row.document).map((row) =>
    [relativeDocumentPath(row.document), documentData(row.document)]));
}

async function readRtdb(token) {
  const result = {};
  for (const root of ['authIndex', 'users', 'loginDirectory']) {
    result[root] = (await jsonFetch(`${RTDB_URL}/${root}.json`, token)) || {};
  }
  return {
    authIndex: Object.fromEntries(Object.entries(result.authIndex).map(([uid, value]) => [uid, {
      username: value?.username,
      authVersion: value?.authVersion
    }])),
    users: Object.fromEntries(Object.entries(result.users).map(([username, value]) => [username, {
      authUid: value?.authUid
    }])),
    loginDirectory: Object.fromEntries(Object.entries(result.loginDirectory).map(([username, value]) => [username, {
      authVersion: value?.authVersion,
      authReady: value?.authReady
    }]))
  };
}

async function readCollection(token, collection) {
  const output = {};
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents/${collection}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await jsonFetch(url, token);
    for (const document of payload.documents || []) output[documentId(document)] = documentData(document);
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return output;
}

async function readProduction(token) {
  const [rtdb, accounts, trainerHandles, operationRequests, identityMigrations] = await Promise.all([
    readRtdb(token), readCollection(token, 'accounts'), readCollection(token, 'trainerHandles'),
    readCollectionGroup(token, 'requests'), readCollectionGroup(token, 'operations')
  ]);
  return { ...rtdb, accounts, trainerHandles, operationRequests, identityMigrations };
}

function gitValue(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function run(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const outputDirectory = privateDirectory(options.outputDirectory || '');
  const capturedAt = options.capturedAt || new Date().toISOString();
  let snapshot;
  if (options.fixture) snapshot = JSON.parse(readPrivate(options.fixture));
  else {
    if (!options.allowProductionRead || options.confirmProject !== PROJECT_ID ||
        options.confirmFirestoreDatabase !== FIRESTORE_DATABASE || options.confirmRtdbUrl !== RTDB_URL) {
      throw new Error('production_target_not_confirmed');
    }
    const token = (dependencies.env || process.env)[options.accessTokenEnv || 'GCLOUD_ACCESS_TOKEN'];
    if (!token) throw new Error('production_access_token_missing');
    snapshot = await readProduction(token);
  }

  const sourceDigests = Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, sha256(value)]));
  const metadata = {
    mainCommit: options.mainCommit || gitValue(['rev-parse', 'HEAD']),
    mainTree: options.mainTree || gitValue(['rev-parse', 'HEAD^{tree}']),
    capturedAt,
    sourceDigests,
    currentRulesDigest: options.currentRulesDigest,
    provisioningContractDigest: options.provisioningContractDigest
  };
  for (const required of ['currentRulesDigest', 'provisioningContractDigest']) {
    if (!/^[a-f0-9]{64}$/u.test(metadata[required] || '')) throw new Error(`invalid_metadata:${required}`);
  }

  const { manifest, blockers } = classifySnapshot(snapshot, metadata);
  const runKey = crypto.randomBytes(32);
  const report = publicReport(manifest, runKey);
  const stamp = capturedAt.replace(/[:.]/gu, '-');
  const snapshotPath = path.join(outputDirectory, `identity-snapshot-${stamp}.json`);
  const manifestPath = path.join(outputDirectory, `operation-manifest-${stamp}.json`);
  const reportPath = path.join(outputDirectory, `public-report-${stamp}.json`);
  writePrivateJson(snapshotPath, snapshot);
  writePrivateJson(manifestPath, manifest);
  writePrivateJson(reportPath, report);
  console.log(JSON.stringify({
    ok: blockers === 0,
    counts: report.counts,
    classificationCounts: report.classificationCounts,
    conflictCount: report.conflictCount,
    malformedCount: report.malformedCount,
    coverageDigest: report.coverageDigest,
    manifestDigest: manifest.manifestDigest,
    files: { snapshotPath, manifestPath, reportPath }
  }));
  return { snapshot, manifest, report, files: { snapshotPath, manifestPath, reportPath } };
}

module.exports = { parseArgs, scalar, documentData, readRtdb, readCollection, readCollectionGroup, readProduction, run };

if (require.main === module) run().catch((error) => {
  console.error(`provider identity preparation failed: ${error.message}`);
  process.exitCode = 1;
});
