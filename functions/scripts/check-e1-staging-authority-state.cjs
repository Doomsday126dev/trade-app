#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const PROJECT = 'trainer-hub-staging-37ib4wct';
const DATABASE = 'phase-e-identity';
const TOKEN = process.env.GCLOUD_ACCESS_TOKEN;
const EXPECTED_ROOTS = new Set(['accounts', 'identityConflicts', 'identityMigrations', 'operationRequests', 'trainerHandles']);
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;

if (typeof TOKEN !== 'string' || !TOKEN) throw new Error('GCLOUD_ACCESS_TOKEN required');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function decodeValue(value) {
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'booleanValue')) return value.booleanValue;
  if (Object.hasOwn(value, 'timestampValue')) return value.timestampValue;
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  throw new Error('Unsupported Firestore value in authority state');
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

async function request(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`Firestore metadata read failed: ${response.status}`);
  return response.json();
}

async function collectionIds(parentPath = '') {
  const suffix = parentPath ? `/${parentPath}:listCollectionIds` : ':listCollectionIds';
  const result = await request(`${BASE}${suffix}`, { pageSize: 1000 });
  if (result.nextPageToken) throw new Error('Unexpected collection pagination');
  return (result.collectionIds || []).sort();
}

async function collectionDocuments(collectionPath) {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`${BASE}/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    url.searchParams.set('orderBy', '__name__');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await request(url);
    documents.push(...(result.documents || []));
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function walkCollection(collectionPath, output) {
  const documents = await collectionDocuments(collectionPath);
  for (const document of documents) {
    const path = document.name.split('/documents/')[1];
    output.push({ path, fields: canonical(document.fields || {}) });
    for (const child of await collectionIds(path)) await walkCollection(`${path}/${child}`, output);
  }
}

async function collectionGroupDocuments(collectionId) {
  const result = await request(`${BASE}:runQuery`, {
    structuredQuery: { from: [{ collectionId, allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' } }] }
  });
  return result.flatMap((entry) => entry.document ? [entry.document] : []);
}

(async () => {
  const roots = await collectionIds();
  const unexpectedRoots = roots.filter((root) => !EXPECTED_ROOTS.has(root));
  if (unexpectedRoots.length) throw new Error(`Unexpected authority roots: ${unexpectedRoots.join(',')}`);
  const documents = [];
  for (const root of roots) await walkCollection(root, documents);
  for (const collectionId of ['events', 'operations', 'requests']) {
    for (const document of await collectionGroupDocuments(collectionId)) {
      const path = document.name.split('/documents/')[1];
      if (!documents.some((existing) => existing.path === path)) documents.push({ path, fields: canonical(document.fields || {}) });
    }
  }
  documents.sort((left, right) => left.path.localeCompare(right.path));
  const rootCounts = Object.fromEntries([...EXPECTED_ROOTS].sort().map((root) => [
    root,
    documents.filter((document) => document.path.split('/')[0] === root).length
  ]));
  const decoded = documents.map((document) => ({ path: document.path, data: decodeFields(document.fields) }));
  const accounts = new Map(decoded.filter((document) => /^accounts\/[^/]+$/u.test(document.path))
    .map((document) => [document.path.split('/')[1], document.data]));
  const handles = new Map(decoded.filter((document) => /^trainerHandles\/[^/]+$/u.test(document.path))
    .map((document) => [document.path.split('/')[1], document.data]));
  for (const [uid, account] of accounts) {
    const handle = handles.get(account.handleKey);
    if (account.uid !== uid || account.revision !== 1 || account.status !== 'active' || !handle ||
        handle.uid !== uid || handle.revision !== 1 || handle.state !== 'active') throw new Error('Account/handle invariant failed');
  }
  for (const [handleKey, handle] of handles) {
    const account = accounts.get(handle.uid);
    if (!account || account.handleKey !== handleKey) throw new Error('Orphan or mismatched handle');
  }
  for (const migration of decoded.filter((document) => document.path.startsWith('identityMigrations/'))) {
    const account = accounts.get(migration.data.uid);
    if (!account || account.handleKey !== migration.data.handleKey || migration.data.status !== 'complete') {
      throw new Error('Migration evidence invariant failed');
    }
  }
  process.stdout.write(`${JSON.stringify({
    project: PROJECT,
    database: DATABASE,
    roots,
    rootCounts,
    documentCount: documents.length,
    invariants: {
      accountHandlePairsExact: true,
      orphanAccounts: 0,
      orphanHandles: 0,
      duplicateHandleDocuments: 0,
      revisionsExact: true,
      migrationEvidenceBounded: true
    },
    stateFingerprint: crypto.createHash('sha256').update(JSON.stringify(documents)).digest('hex'),
    cloudOperations: 0,
    writes: 0
  }, null, 2)}\n`);
})().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'read-failed', message: error.message })}\n`);
  process.exitCode = 1;
});
