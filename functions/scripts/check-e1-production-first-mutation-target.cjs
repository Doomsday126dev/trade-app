#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PRIVATE_HARNESS_PATH,
  guardProductionFirstMutation,
  validatePrivateHarnessSource
} = require('../production/e1ProductionFirstMutationGuard.cjs');

const localRoot = path.resolve(__dirname, '../.local');

function privatePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`${label} must remain private under functions/.local`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
  return resolved;
}

if (process.argv.includes('--harness-only')) {
  const harnessPath = privatePath(process.env.E1_GROUP_D_BROWSER_HARNESS || PRIVATE_HARNESS_PATH, 'Group D browser harness');
  process.stdout.write(`${JSON.stringify(validatePrivateHarnessSource(fs.readFileSync(harnessPath, 'utf8')), null, 2)}\n`);
} else {
  const inputValue = process.env.E1_PRODUCTION_FIRST_MUTATION_GUARD_INPUT;
  if (!inputValue) throw new Error('E1_PRODUCTION_FIRST_MUTATION_GUARD_INPUT is required');
  const inputPath = privatePath(inputValue, 'Group D guard input');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(guardProductionFirstMutation(input, { inputPath }), null, 2)}\n`);
}
