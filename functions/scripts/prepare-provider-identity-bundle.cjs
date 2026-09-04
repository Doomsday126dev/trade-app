#!/usr/bin/env node
'use strict';

const { readPrivate } = require('../production/providerIdentityPrivateFiles.cjs');
const { RunStore } = require('../production/providerIdentityRun.cjs');
const { prepareBundle } = require('../production/providerIdentityPreparation.cjs');

function run(argv = process.argv.slice(2)) {
  const allowed = ['repository', 'run-directory', 'manifest', 'snapshot', 'runtime', 'run-id', 'issued-at', 'expires-at'];
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !allowed.includes(name) || options[name] || !argv[i + 1]) {
      throw new Error('preparation_arguments_invalid');
    }
    options[name] = argv[i + 1];
  }
  if (Object.keys(options).length !== allowed.length) throw new Error('preparation_arguments_invalid');
  const read = (name) => JSON.parse(readPrivate(options[name]));
  const result = prepareBundle({ repo: options.repository, store: new RunStore(options['run-directory']),
    manifest: read('manifest'), snapshot: read('snapshot'), runtime: read('runtime'), runId: options['run-id'],
    issuedAt: Number(options['issued-at']), expiresAt: Number(options['expires-at']) });
  process.stdout.write(`${JSON.stringify({ bundleDigest: result.bundle.bundleDigest,
    planDigest: result.bundle.plan.planDigest, requestDigest: result.request.digest, cloudMutations: 0 })}\n`);
  return result;
}
module.exports = { run };
if (require.main === module) {
  try { run(); } catch { process.stderr.write('preparation_failed\n'); process.exitCode = 1; }
}
