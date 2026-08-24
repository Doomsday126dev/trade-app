#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const PROJECT_ID = 'trade-list-a4297';
const DATABASE_ID = 'e1-group-e-control';
const PROBE_PATH = 'group-e-rules-probe/deny-all';
const API_HOST = 'firestore.googleapis.com';
const API_KEY_ENV = 'GROUP_E_CONTROL_FIREBASE_WEB_API_KEY';
const API_KEY_SHA256 = 'f1e7497896e17e8bb2fc0ee65f4c6700b1d89d8ee50bf59df3de366b17814392';
const CONFIRMATION = 'VERIFY E1 GROUP E CONTROL RULES DENY ALL';
const TIMEOUT_MS = 10_000;
const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo';
const ERROR_INFO_REASON = /^[A-Z][A-Z0-9_]{0,127}$/u;
const INFRASTRUCTURE_DENIAL_REASON = /^(?:API_KEY_[A-Z0-9_]*|SERVICE_DISABLED|BILLING_DISABLED|ACCESS_TOKEN_[A-Z0-9_]*)$/u;
const REQUEST_PHASES = Object.freeze(['read', 'update']);

function fail(code, diagnostic = {}) {
  const error = new Error(code);
  error.code = code;
  error.diagnostic = Object.freeze({ ...diagnostic });
  throw error;
}

function validateProbePath(value) {
  if (typeof value !== 'string') fail('group_e_control_rules_verifier_probe_path_invalid');
  const segments = value.split('/');
  if (segments.length !== 2 || segments.some((segment) => !segment || segment.includes('/') ||
      segment === '.' || segment === '..' || /^__.*__$/u.test(segment))) {
    fail('group_e_control_rules_verifier_probe_path_invalid');
  }
  return value;
}

const BASE_URL = `https://${API_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${validateProbePath(PROBE_PATH)}`;

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
  validateProbePath(PROBE_PATH);
  const url = new URL(BASE_URL);
  url.searchParams.set('key', apiKey);
  if (update) url.searchParams.set('currentDocument.exists', 'true');
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.pathname !==
      `/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${PROBE_PATH}`) {
    fail('group_e_control_rules_verifier_target_invalid');
  }
  return url;
}

function errorInfoReasons(payload) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  return Object.freeze([...new Set(details.filter((detail) => detail?.['@type'] === ERROR_INFO_TYPE)
    .map((detail) => detail?.reason)
    .filter((reason) => typeof reason === 'string' && ERROR_INFO_REASON.test(reason)))].slice(0, 8));
}

function responseDiagnostic(response, requestPhase) {
  const googleErrorStatus = typeof response?.payload?.error?.status === 'string' &&
    ERROR_INFO_REASON.test(response.payload.error.status) ? response.payload.error.status : undefined;
  const reasons = errorInfoReasons(response?.payload);
  return Object.freeze({
    ...(Number.isSafeInteger(response?.status) ? { httpStatus: response.status } : {}),
    ...(googleErrorStatus ? { googleErrorStatus } : {}),
    ...(reasons.length ? { errorInfoReasons: reasons } : {}),
    ...(REQUEST_PHASES.includes(requestPhase) ? { requestPhase } : {})
  });
}

function sanitizedFailure(error) {
  const diagnostic = error?.diagnostic || {};
  const verifierErrorCode = typeof error?.code === 'string' &&
    /^group_e_control_rules_verifier_[a-z_]+$/u.test(error.code) ? error.code :
    'group_e_control_rules_verifier_failed';
  return Object.freeze({
    verifierErrorCode,
    ...(Number.isSafeInteger(diagnostic.httpStatus) ? { httpStatus: diagnostic.httpStatus } : {}),
    ...(typeof diagnostic.googleErrorStatus === 'string' && ERROR_INFO_REASON.test(diagnostic.googleErrorStatus) ?
      { googleErrorStatus: diagnostic.googleErrorStatus } : {}),
    ...(Array.isArray(diagnostic.errorInfoReasons) && diagnostic.errorInfoReasons.length ?
      { errorInfoReasons: diagnostic.errorInfoReasons.filter((reason) =>
        typeof reason === 'string' && ERROR_INFO_REASON.test(reason)).slice(0, 8) } : {}),
    ...(REQUEST_PHASES.includes(diagnostic.requestPhase) ? { requestPhase: diagnostic.requestPhase } : {}),
    credentialsPersisted: 0,
    documentsCreatedByDesign: 0
  });
}

function sanitizedResponse(response, requestPhase) {
  const payload = response.payload;
  const errorClass = payload?.error?.status;
  const diagnostic = responseDiagnostic(response, requestPhase);
  if (errorInfoReasons(payload).some((reason) => INFRASTRUCTURE_DENIAL_REASON.test(reason))) {
    fail('group_e_control_rules_verifier_infrastructure_denied', diagnostic);
  }
  if (response.status !== 403 || errorClass !== 'PERMISSION_DENIED') {
    if (response.status === 404 || errorClass === 'NOT_FOUND') {
      fail('group_e_control_rules_verifier_not_found', diagnostic);
    }
    if (response.status === 412 || errorClass === 'FAILED_PRECONDITION') {
      fail('group_e_control_rules_verifier_precondition_allowed', diagnostic);
    }
    fail('group_e_control_rules_verifier_not_denied', diagnostic);
  }
  return Object.freeze({ httpStatus: response.status, errorClass });
}

async function boundedFetch(fetchImpl, url, init, timeoutMs = TIMEOUT_MS, requestPhase) {
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
      if (timedOut || error?.name === 'AbortError') {
        fail('group_e_control_rules_verifier_timeout', { requestPhase });
      }
      fail('group_e_control_rules_verifier_network_failed', { requestPhase });
    }
    let payload;
    try {
      payload = await Promise.race([Promise.resolve().then(() => response.json()), timeout]);
    } catch (error) {
      if (timedOut || error?.name === 'AbortError') {
        fail('group_e_control_rules_verifier_timeout', { requestPhase });
      }
      fail('group_e_control_rules_verifier_response_malformed', {
        requestPhase,
        ...(Number.isSafeInteger(response?.status) ? { httpStatus: response.status } : {})
      });
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
  }, timeoutMs, 'read'), 'read');
  const update = sanitizedResponse(await boundedFetch(fetchImpl, probeUrl(apiKey, { update: true }), {
    method: 'PATCH',
    headers: requestHeaders(true),
    body: JSON.stringify({ fields: { probe: { booleanValue: true } } })
  }, timeoutMs, 'update'), 'update');
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
    process.stderr.write(`${JSON.stringify(sanitizedFailure(error))}\n`);
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
  errorInfoReasons,
  parseArguments,
  plan,
  probeUrl,
  requestHeaders,
  responseDiagnostic,
  run,
  sanitizedFailure,
  sanitizedResponse,
  validateApiKey,
  validateProbePath,
  verifyProduction
});
