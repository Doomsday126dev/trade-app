#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const PROJECT_ID = 'trade-list-a4297';
const DATABASE_ID = 'e1-group-e-control';
const PROBE_PATH = '__group_e_rules_probe__/deny-all';
const API_HOST = 'firestore.googleapis.com';
const API_KEY_ENV = 'GROUP_E_CONTROL_FIREBASE_WEB_API_KEY';
const API_KEY_SHA256 = 'f1e7497896e17e8bb2fc0ee65f4c6700b1d89d8ee50bf59df3de366b17814392';
const CONFIRMATION = 'VERIFY E1 GROUP E CONTROL RULES DENY ALL';
const TIMEOUT_MS = 10_000;
const BASE_URL = `https://${API_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${PROBE_PATH}`;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--mode=plan')) {
    return Object.freeze({ mode: 'plan' });
  }
  const fields = new Map();
  for (const argument of argv) {
    const match = argument.match(/^--([a-z-]+)=(.*)$/u);
    if (!match || fields.has(match[1])) fail('group_e_control_rules_verifier_arguments_invalid');
    fields.set(match[1], match[2]);
  }
  const expected = ['mode', 'project', 'database', 'expected-empty', 'confirm'];
  if (fields.size !== expected.length || expected.some((field) => !fields.has(field)) ||
      fields.get('mode') !== 'production-verify' || fields.get('project') !== PROJECT_ID ||
      fields.get('database') !== DATABASE_ID || fields.get('expected-empty') !== 'true' ||
      fields.get('confirm') !== CONFIRMATION) {
    fail('group_e_control_rules_verifier_arguments_invalid');
  }
  return Object.freeze({ mode: 'production-verify' });
}

function validateApiKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/u.test(value) ||
      crypto.createHash('sha256').update(value).digest('hex') !== API_KEY_SHA256) {
    fail('group_e_control_rules_verifier_api_key_invalid');
  }
  return value;
}

function probeUrl(apiKey, { update = false } = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.set('key', apiKey);
  if (update) url.searchParams.set('currentDocument.exists', 'true');
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.pathname !==
      `/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${PROBE_PATH}`) {
    fail('group_e_control_rules_verifier_target_invalid');
  }
  return url;
}

function sanitizedResponse(response) {
  const payload = response.payload;
  const errorClass = payload?.error?.status;
  if (response.status !== 403 || errorClass !== 'PERMISSION_DENIED') {
    if (response.status === 404 || errorClass === 'NOT_FOUND') fail('group_e_control_rules_verifier_not_found');
    if (response.status === 412 || errorClass === 'FAILED_PRECONDITION') {
      fail('group_e_control_rules_verifier_precondition_allowed');
    }
    fail('group_e_control_rules_verifier_not_denied');
  }
  return Object.freeze({ httpStatus: response.status, errorClass });
}

async function boundedFetch(fetchImpl, url, init, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const error = new Error('timeout');
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs);
  });
  try {
    let response;
    try {
      response = await Promise.race([
        Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' })),
        timeout
      ]);
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') fail('group_e_control_rules_verifier_timeout');
      fail('group_e_control_rules_verifier_network_failed');
    }
    let payload;
    try {
      payload = await Promise.race([Promise.resolve().then(() => response.json()), timeout]);
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') fail('group_e_control_rules_verifier_timeout');
      fail('group_e_control_rules_verifier_response_malformed');
    }
    return Object.freeze({ status: response.status, payload });
  } finally {
    clearTimeout(timer);
  }
}

function requestHeaders(update) {
  return update ? Object.freeze({ accept: 'application/json', 'content-type': 'application/json' }) :
    Object.freeze({ accept: 'application/json' });
}

async function verifyProduction({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  validateApiKey(apiKey);
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) {
    fail('group_e_control_rules_verifier_runtime_invalid');
  }
  const read = sanitizedResponse(await boundedFetch(fetchImpl, probeUrl(apiKey), {
    method: 'GET',
    headers: requestHeaders(false)
  }, timeoutMs));
  const update = sanitizedResponse(await boundedFetch(fetchImpl, probeUrl(apiKey, { update: true }), {
    method: 'PATCH',
    headers: requestHeaders(true),
    body: JSON.stringify({ fields: { probe: { booleanValue: true } } })
  }, timeoutMs));
  return Object.freeze({
    project: PROJECT_ID,
    database: DATABASE_ID,
    probePath: PROBE_PATH,
    readDenied: true,
    updateDenied: true,
    read,
    update,
    credentialsPersisted: 0,
    documentsCreatedByDesign: 0
  });
}

function plan() {
  return Object.freeze({
    mode: 'plan',
    project: PROJECT_ID,
    database: DATABASE_ID,
    probePath: PROBE_PATH,
    readMethod: 'GET',
    updateMethod: 'PATCH',
    updatePrecondition: 'currentDocument.exists=true',
    authentication: 'none',
    apiKeySource: API_KEY_ENV,
    timeoutMs: TIMEOUT_MS,
    networkRequests: 0,
    retries: 0,
    documentsCreatedByDesign: 0
  });
}

async function run(argv = process.argv.slice(2), env = process.env, options = {}) {
  const input = parseArguments(argv);
  if (input.mode === 'plan') return plan();
  return verifyProduction({ apiKey: env[API_KEY_ENV], fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
}

async function main() {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.code || 'group_e_control_rules_verifier_failed');
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  API_HOST,
  API_KEY_ENV,
  API_KEY_SHA256,
  BASE_URL,
  CONFIRMATION,
  DATABASE_ID,
  PROBE_PATH,
  PROJECT_ID,
  TIMEOUT_MS,
  boundedFetch,
  parseArguments,
  plan,
  probeUrl,
  requestHeaders,
  run,
  sanitizedResponse,
  validateApiKey,
  verifyProduction
});
