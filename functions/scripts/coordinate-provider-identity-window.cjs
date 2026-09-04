#!/usr/bin/env node
'use strict';

const { RunStore, provenance } = require('../production/providerIdentityRun.cjs');
const { sha256 } = require('../production/providerIdentityWindow.cjs');
const { loadBundle } = require('../production/providerIdentityPreparation.cjs');
const { readPrivate } = require('../production/providerIdentityPrivateFiles.cjs');

function run(argv = process.argv.slice(2)) {
  // Keep this before reading any artifacts, credentials, or production state.
  // Removing it requires qualification of the concrete cloud command adapters,
  // including interrupted deployment-operation rollback and all failure paths.
  if (argv.includes('--execute')) throw new Error('live_window_audit_blocked');
  if (argv.length !== 8 || argv[0] !== '--run-directory' || argv[2] !== '--repository' ||
      argv[4] !== '--manifest' || argv[6] !== '--snapshot') throw new Error('operator_arguments_invalid');
  const store = new RunStore(argv[1]), request = store.request(), actual = provenance(argv[3]);
  if (sha256(actual) !== sha256(request.operator)) throw new Error('operator_provenance_mismatch');
  const bundle = loadBundle({ repo: argv[3], store, actualProvenance: actual,
    manifest: JSON.parse(readPrivate(argv[5])), snapshot: JSON.parse(readPrivate(argv[7])) });
  const result = { execute: false, cloudMutations: 0, runId: request.runId, requestDigest: request.digest,
    bundleDigest: bundle.bundleDigest, planDigest: bundle.plan.planDigest,
    qualified: false, blocker: 'live_window_audit_blocked' };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}
module.exports = { run };
if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
