#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  PRIVATE_BINDING_PATH,
  PRIVATE_READINESS_PATH,
  guardProductionThirdMutation
} = require('../production/e1ProductionThirdMutationGuard.cjs');

const localRoot = path.resolve(__dirname, '../.local');

function privatePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`${label} must remain private under functions/.local`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
  return resolved;
}

const inputValue = process.env.E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT;
if (!inputValue) throw new Error('E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT is required');
const inputPath = privatePath(inputValue, 'Group D3 guard input');
const bindingPath = privatePath(
  process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS || PRIVATE_BINDING_PATH,
  'Group D3 subject binding'
);
const readinessPath = privatePath(
  process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS || PRIVATE_READINESS_PATH,
  'Group D3 readiness'
);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const result = guardProductionThirdMutation(input, { inputPath, bindingPath, readinessPath });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
