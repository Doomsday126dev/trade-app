#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { buildPlan } = require('../production/providerIdentityDeploymentPlan.cjs');
const { writePrivateJson } = require('../production/providerIdentityWindow.cjs');

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('invalid_arguments');
    output[argv[index].slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return output;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const currentGatewayRevisions = JSON.parse(options.currentGatewayRevisions);
  const { plan } = buildPlan({ ...options, currentGatewayRevisions, repoRoot: path.resolve(options.repoRoot || '.') });
  writePrivateJson(path.resolve(options.output), plan);
  console.log(JSON.stringify({
    planDigest: plan.planDigest,
    sourceCommit: plan.source.commit,
    authoritySourceFingerprint: plan.authority.sourceFingerprint,
    gatewaySourceFingerprint: plan.gateways.sourceFingerprint,
    gatewayFunctions: plan.gateways.functions,
    allAuthorityGatesFalse: Object.values(plan.authority.environment).filter((value) => value === 'true').length === 0,
    allGatewayGatesFalse: Object.values(plan.gateways.environment).filter((value) => value === 'true').length === 0,
    providerAccountsExist: plan.providerAccountsExist,
    mutationBudgetNow: plan.mutationBudgetNow,
    output: path.resolve(options.output)
  }));
  return plan;
}

module.exports = { parseArgs, run };
if (require.main === module) {
  try { run(); } catch (error) { console.error(`deployment plan failed: ${error.message}`); process.exitCode = 1; }
}
