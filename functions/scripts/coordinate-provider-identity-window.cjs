#!/usr/bin/env node
'use strict';

const { RunStore, provenance } = require('../production/providerIdentityRun.cjs');
const { sha256 } = require('../production/providerIdentityWindow.cjs');

function run(argv = process.argv.slice(2)) {
  // Keep this before reading any artifacts, credentials, or production state.
  // Removing it requires qualification of the concrete cloud command adapters,
  // including interrupted deployment-operation rollback and all failure paths.
  if (argv.includes('--execute')) throw new Error('live_window_audit_blocked');
  if (argv.length !== 4 || argv[0] !== '--run-directory' || argv[2] !== '--repository') throw new Error('operator_arguments_invalid');
  const store = new RunStore(argv[1]), request = store.request(), actual = provenance(argv[3]);
  if (sha256(actual) !== sha256(request.operator)) throw new Error('operator_provenance_mismatch');
  const result = { execute: false, cloudMutations: 0, runId: request.runId, requestDigest: request.digest,
    qualified: false, blocker: 'live_window_audit_blocked' };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}
module.exports = { run };
if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
