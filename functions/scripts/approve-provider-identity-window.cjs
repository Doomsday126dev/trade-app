#!/usr/bin/env node
'use strict';

const { RunStore, provenance } = require('../production/providerIdentityRun.cjs');

async function run(argv, input = process.stdin) {
  if (argv.length !== 4 || argv[0] !== '--run-directory' || argv[2] !== '--repository') throw new Error('approval_arguments_invalid');
  const store = new RunStore(argv[1]);
  const actual = provenance(argv[3]);
  let phrase = '';
  for await (const chunk of input) {
    phrase += chunk.toString('utf8');
    if (Buffer.byteLength(phrase) > 512) throw new Error('approval_input_invalid');
  }
  store.approve(phrase.replace(/\r\n/gu, '\n').replace(/\n$/u, ''), actual, Date.now());
  process.stdout.write('Bound execution and restoration capabilities created. No cloud action performed.\n');
}
module.exports = { run };
if (require.main === module) run(process.argv.slice(2)).catch(() => {
  process.stderr.write('Approval rejected; no cloud action performed.\n');
  process.exitCode = 1;
});
