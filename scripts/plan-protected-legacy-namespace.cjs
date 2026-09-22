#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { protectionPlan, verifyProtection } = require('./lib/protected-legacy-namespace.cjs');
const root = path.resolve(__dirname, '../tests/fixtures');
const input = process.argv[2];
if (process.argv.length !== 3 || !/^[a-z0-9-]+\.synthetic\.json$/u.test(input || '')) {
  throw new Error('protection/synthetic-fixture-only');
}
const fixture = JSON.parse(fs.readFileSync(path.join(root, input), 'utf8'));
const plan = protectionPlan(fixture);
const simulatedReadback = { ...fixture.claims, ...fixture.completed };
for (const action of plan.actions) simulatedReadback[action.path.split('/')[1]] = action.document;
if (!plan.complete || !verifyProtection(plan, simulatedReadback)) throw new Error('protection/incomplete');
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
