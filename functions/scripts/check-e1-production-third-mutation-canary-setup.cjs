#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateSyntheticCanarySetup
} = require('../production/e1ProductionThirdMutationCanarySetup.cjs');

const localRoot = path.resolve(__dirname, '../.local');
const value = process.env.E1_PRODUCTION_THIRD_MUTATION_CANARY_SETUP;
if (!value) throw new Error('E1_PRODUCTION_THIRD_MUTATION_CANARY_SETUP is required');
const setupPath = path.resolve(value);
if (!setupPath.startsWith(`${localRoot}${path.sep}`)) {
  throw new Error('Group D3 synthetic setup must remain private under functions/.local');
}
if ((fs.statSync(setupPath).mode & 0o777) !== 0o600) {
  throw new Error('Group D3 synthetic setup must use mode 0600');
}
const plan = JSON.parse(fs.readFileSync(setupPath, 'utf8'));
const result = validateSyntheticCanarySetup(plan, { setupPath });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
