#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { guardProductionReadProof } = require('../production/e1ProductionReadProofGuard.cjs');

const inputPath = process.env.E1_PRODUCTION_READ_PROOF_GUARD_INPUT;
if (!inputPath) throw new Error('E1_PRODUCTION_READ_PROOF_GUARD_INPUT is required');
const resolved = path.resolve(inputPath);
const localRoot = path.resolve(__dirname, '../.local');
if (!resolved.startsWith(`${localRoot}${path.sep}`)) {
  throw new Error('Group C guard input must remain private under functions/.local');
}
const input = JSON.parse(fs.readFileSync(resolved, 'utf8'));
process.stdout.write(`${JSON.stringify(guardProductionReadProof(input), null, 2)}\n`);
