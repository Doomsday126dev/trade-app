#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PRIVATE_EXECUTION_LEDGER_PATH,
  applyLedgerTransition,
  blockLedger,
  commitDispatchAndCreateCapability,
  createInitialExecutionLedger,
  initializeLedgerDirectory,
  recordAReconciliationEvidence,
  recordBReconciliation,
  recordCapabilityDeliveryUncertain,
  recordEnablementStarted,
  recordObservationCloseout,
  recordPreEnableAbort,
  recordRestoration,
  recordRuntimeInstanceLoss,
  recordSessionBoundary,
  recordTerminalAttempt,
  validateExecutionLedger,
  validateLedgerDirectory
} = require('../production/e1ProductionClientFoundationExecution.cjs');

const INPUT_FIELDS = Object.freeze(['schemaVersion', 'action', 'expectedPriorDigest', 'payload']);
const ACTIONS = new Set([
  'validate', 'initialize', 'enablement-start', 'pre-enable-abort', 'dispatch', 'terminal', 'a-reconciliation', 'session-boundary',
  'b-reconciliation', 'restore', 'block', 'delivery-uncertain', 'runtime-loss', 'closeout'
]);
const SENSITIVE_KEY = /(?:^|_)(?:raw_?)?(?:id_?token|app_?check_?token|credential|password|pin|secret|auth_?email|trainer_?name|private_?key)$/iu;
const SENSITIVE_VALUE = /(?:^|\s)Bearer\s+[A-Za-z0-9._~-]+/u;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function argumentsMap(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const match = /^--([a-z][a-z0-9-]*)=(.*)$/u.exec(argument);
    if (!match) fail('group_e_execution_argument_invalid');
    return [match[1], match[2]];
  }));
}

function assertNoSensitiveMaterial(value, key = '') {
  if (SENSITIVE_KEY.test(key) || typeof value === 'string' && SENSITIVE_VALUE.test(value)) {
    fail('group_e_execution_sensitive_material_rejected');
  }
  if (Array.isArray(value)) value.forEach((entry) => assertNoSensitiveMaterial(entry));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([entryKey, entry]) => assertNoSensitiveMaterial(entry, entryKey));
  }
}

function privatePath(value, label, options = {}) {
  const resolved = path.resolve(value);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!options.allowExternalPaths && !resolved.startsWith(`${localRoot}${path.sep}`)) {
    fail(`group_e_execution_${label}_not_private`);
  }
  return resolved;
}

function requireMode(file, expected, label) {
  let observed;
  try { observed = fs.statSync(file).mode & 0o777; } catch { fail(`group_e_execution_${label}_missing`); }
  if (observed !== expected) fail(`group_e_execution_${label}_mode_invalid`);
}

function readJson(file, label) {
  requireMode(file, 0o600, label);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fail(`group_e_execution_${label}_invalid`); }
}

function writePrivateJsonExclusive(file, value) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.chmodSync(file, 0o600);
}

function transitionFor(action, payload, options = {}) {
  if (action === 'dispatch') fail('group_e_execution_dispatch_requires_atomic_command');
  if (action === 'terminal') return (ledger) => recordTerminalAttempt(ledger, payload);
  if (action === 'a-reconciliation') return (ledger) => recordAReconciliationEvidence(ledger, payload);
  if (action === 'session-boundary') {
    return (ledger) => recordSessionBoundary(ledger, payload.boundary, { controlRecordCreated: payload.controlRecordCreated });
  }
  if (action === 'b-reconciliation') {
    return (ledger) => recordBReconciliation(ledger, payload.evidence, { controlRecordCreated: payload.controlRecordCreated });
  }
  if (action === 'restore') return (ledger) => recordRestoration(ledger, payload);
  if (action === 'block') return (ledger) => blockLedger(ledger, payload.reason, payload.recordedAt);
  if (action === 'delivery-uncertain') return (ledger) => recordCapabilityDeliveryUncertain(ledger, payload.recordedAt);
  if (action === 'runtime-loss') {
    if (!exactFields(payload, ['recordedAt'])) fail('group_e_execution_action_payload_invalid');
    return (ledger) => recordRuntimeInstanceLoss(ledger, payload.recordedAt);
  }
  if (action === 'closeout') return (ledger) => recordObservationCloseout(ledger, payload).ledger;
  fail('group_e_execution_action_invalid');
}

function sanitizedVerdict(ledger, written) {
  const verdict = validateExecutionLedger(ledger);
  return Object.freeze({
    ok: true,
    written,
    stage: verdict.stage,
    sequence: verdict.sequence,
    completedPrefix: verdict.completedPrefix,
    nextAction: verdict.nextAction,
    remainingAdmittedBudget: verdict.remainingAdmittedBudget,
    canonicalDigest: verdict.transitionDigest
  });
}

function run(argv = process.argv.slice(2), options = {}) {
  const args = argumentsMap(argv);
  const mode = args.mode || 'plan';
  if (!['plan', 'apply'].includes(mode)) fail('group_e_execution_mode_invalid');
  const inputPath = privatePath(args.input || '', 'input', options);
  const ledgerPath = privatePath(args.ledger || PRIVATE_EXECUTION_LEDGER_PATH, 'ledger', options);
  const input = readJson(inputPath, 'input');
  if (!exactFields(input, INPUT_FIELDS) || input.schemaVersion !== 1 || !ACTIONS.has(input.action) ||
      (input.action === 'initialize' ? input.expectedPriorDigest !== null :
        typeof input.expectedPriorDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedPriorDigest))) {
    fail('group_e_execution_input_invalid');
  }
  assertNoSensitiveMaterial(input);

  let result;
  if (input.action === 'initialize') {
    const ledger = createInitialExecutionLedger(input.payload);
    result = initializeLedgerDirectory(ledgerPath, ledger, { mode });
  } else if (input.action === 'validate') {
    if (!exactFields(input.payload, [])) fail('group_e_execution_action_payload_invalid');
    requireMode(ledgerPath, 0o700, 'ledger');
    const ledger = validateLedgerDirectory(ledgerPath).latest;
    if (ledger.transitionDigest !== input.expectedPriorDigest) fail('group_e_ledger_stale_writer');
    result = Object.freeze({ written: false, ledger });
  } else if (input.action === 'enablement-start') {
    if (!exactFields(input.payload, ['startedAt', 'jit', 'runManifestPath'])) {
      fail('group_e_execution_action_payload_invalid');
    }
    requireMode(ledgerPath, 0o700, 'ledger');
    const manifest = readJson(privatePath(input.payload.runManifestPath, 'run-manifest', options), 'run_manifest');
    result = applyLedgerTransition(ledgerPath, input.expectedPriorDigest,
      (ledger) => recordEnablementStarted(ledger, manifest,
        { startedAt: input.payload.startedAt, jit: input.payload.jit }), { mode });
  } else if (input.action === 'pre-enable-abort') {
    if (!exactFields(input.payload, ['record', 'runManifestPath', 'controlRecordCreated'])) {
      fail('group_e_execution_action_payload_invalid');
    }
    requireMode(ledgerPath, 0o700, 'ledger');
    const manifest = readJson(privatePath(input.payload.runManifestPath, 'run-manifest', options), 'run_manifest');
    result = applyLedgerTransition(ledgerPath, input.expectedPriorDigest,
      (ledger) => recordPreEnableAbort(ledger, manifest, input.payload.record,
        { controlRecordCreated: input.payload.controlRecordCreated }), { mode });
  } else if (input.action === 'dispatch') {
    const fields = ['slot', 'generationId', 'sessionGeneration', 'jti', 'attemptId', 'browserContextDigest',
      'runtimeInstanceDigest', 'sessionGenerationDigest', 'committedAt', 'expiresAt', 'runManifestPath', 'signingKeyPath',
      'capabilityOutputPath'];
    if (!exactFields(input.payload, fields)) fail('group_e_execution_action_payload_invalid');
    requireMode(ledgerPath, 0o700, 'ledger');
    const manifestPath = privatePath(input.payload.runManifestPath, 'run-manifest', options);
    const keyPath = privatePath(input.payload.signingKeyPath, 'signing-key', options);
    const outputPath = privatePath(input.payload.capabilityOutputPath, 'capability-output', options);
    const manifest = readJson(manifestPath, 'run_manifest');
    let privateKey = null;
    if (mode === 'apply') {
      requireMode(keyPath, 0o600, 'signing_key');
      if (fs.existsSync(outputPath)) fail('group_e_execution_capability_output_exists');
      privateKey = fs.readFileSync(keyPath);
    }
    const dispatch = Object.fromEntries(['slot', 'generationId', 'sessionGeneration', 'jti', 'attemptId',
      'browserContextDigest', 'runtimeInstanceDigest', 'sessionGenerationDigest', 'committedAt']
      .map((field) => [field, input.payload[field]]));
    result = commitDispatchAndCreateCapability(ledgerPath, input.expectedPriorDigest, manifest, dispatch,
      { slot: input.payload.slot, jti: input.payload.jti, attemptId: input.payload.attemptId,
        expiresAt: input.payload.expiresAt }, privateKey, { mode });
    if (result.written) writePrivateJsonExclusive(outputPath, result.capability);
  } else {
    requireMode(ledgerPath, 0o700, 'ledger');
    result = applyLedgerTransition(ledgerPath, input.expectedPriorDigest,
      transitionFor(input.action, input.payload, options), { mode });
  }
  const verdict = sanitizedVerdict(result.ledger, result.written);
  (options.stdout || process.stdout).write(`${JSON.stringify(verdict)}\n`);
  return Object.freeze({ ledger: result.ledger, verdict });
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  ACTIONS,
  argumentsMap,
  assertNoSensitiveMaterial,
  privatePath,
  run,
  sanitizedVerdict,
  transitionFor
});
