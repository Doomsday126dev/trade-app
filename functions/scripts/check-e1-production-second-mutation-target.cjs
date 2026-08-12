#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PRIVATE_HARNESS_PATHS,
  PRIVATE_READINESS_PATH,
  guardProductionSecondMutation,
  validatePrivateHarnessSource
} = require('../production/e1ProductionSecondMutationGuard.cjs');

const localRoot = path.resolve(__dirname, '../.local');

function privatePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`${label} must remain private under functions/.local`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
  return resolved;
}

const harnessSlot = process.argv.includes('--harness-a') ? 'A' : process.argv.includes('--harness-b') ? 'B' : null;
if (harnessSlot) {
  const readinessPath = privatePath(process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS || PRIVATE_READINESS_PATH, 'Group D2 readiness');
  const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
  const candidate = readiness.candidates?.find((value) => value.slot === harnessSlot);
  const harnessPath = privatePath(
    process.env[`E1_GROUP_D2_${harnessSlot}_BROWSER_HARNESS`] || PRIVATE_HARNESS_PATHS[harnessSlot],
    `Group D2 candidate ${harnessSlot} browser harness`
  );
  process.stdout.write(`${JSON.stringify(validatePrivateHarnessSource(fs.readFileSync(harnessPath, 'utf8'), candidate), null, 2)}\n`);
} else {
  const inputValue = process.env.E1_PRODUCTION_SECOND_MUTATION_GUARD_INPUT;
  if (!inputValue) throw new Error('E1_PRODUCTION_SECOND_MUTATION_GUARD_INPUT is required');
  const inputPath = privatePath(inputValue, 'Group D2 guard input');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const readinessPath = process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS;
  const options = { inputPath, ...(readinessPath ? { readinessPath: privatePath(readinessPath, 'Group D2 readiness') } : {}) };
  process.stdout.write(`${JSON.stringify(guardProductionSecondMutation(input, options), null, 2)}\n`);
}
