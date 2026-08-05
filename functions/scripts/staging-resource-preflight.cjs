#!/usr/bin/env node
'use strict';

const contract = require('../staging/stagingResourcePreflight.cjs');

function print(value, output = console.log) {
  output(JSON.stringify(value, null, 2));
}

function run(argv = process.argv.slice(2), io = {}) {
  const output = io.output || console.log;
  const command = argv[0];
  if (!['create-template', 'validate', 'summary'].includes(command) || argv.length !== 1) {
    throw Object.assign(new Error('Usage: staging:resource-preflight -- <create-template|validate|summary>'), { code: 'preflight/usage' });
  }
  if (command === 'create-template') {
    contract.createTemplate();
    print({ status: 'private-template-created', configured: false, approvals: 'undecided', cloudOperations: 0, stagingReads: 0, stagingWrites: 0, productionReads: 0, productionWrites: 0 }, output);
    return;
  }
  const validation = contract.validatePreflight(contract.readPrivateInputs(), { now: io.now });
  const summary = contract.redactedSummary(validation);
  if (command === 'validate') {
    print({ ...summary, fieldStatus: Object.fromEntries(Object.entries(validation.fields).map(([name, value]) => [name, { configured: value.configured, valid: value.valid }])) }, output);
    return;
  }
  print(summary, output);
}

if (require.main === module) {
  try { run(); } catch (error) {
    console.error(JSON.stringify({ status: 'preflight-error', code: error.code || 'preflight/failed', cloudOperations: 0, stagingReads: 0, stagingWrites: 0, productionReads: 0, productionWrites: 0 }));
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ run });
