#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { guardProductionTarget } = require('../production/e1ProductionDeploymentGuard.cjs');

const inputPath = process.env.E1_PRODUCTION_GUARD_INPUT;
if (!inputPath) throw new Error('E1_PRODUCTION_GUARD_INPUT is required');
const resolved = path.resolve(inputPath);
const localRoot = path.resolve(__dirname, '../.local');
if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error('Production guard input must remain private under functions/.local');
const input = JSON.parse(fs.readFileSync(resolved, 'utf8'));
process.stdout.write(`${JSON.stringify(guardProductionTarget(input), null, 2)}\n`);
