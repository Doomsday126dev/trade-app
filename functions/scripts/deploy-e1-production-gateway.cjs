#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { guardProductionReadProof } = require('../production/e1ProductionReadProofGuard.cjs');
const {
  createDeploymentPlan,
  deploymentArguments,
  publicPlan,
  resolveRepositoryRoot,
  stagePinnedSource
} = require('../production/e1GatewayDeploymentPlan.cjs');

function argumentsMap(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const match = /^--([a-z-]+)=(.*)$/u.exec(argument);
    if (!match) throw new Error('e1/gateway-deployment-argument-invalid');
    return [match[1], match[2]];
  }));
}

function verifyGroupCGuard() {
  const inputPath = process.env.E1_PRODUCTION_READ_PROOF_GUARD_INPUT;
  if (!inputPath) throw new Error('e1/group-c-guard-input-required');
  const resolved = path.resolve(inputPath);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error('e1/group-c-guard-input-not-private');
  const result = guardProductionReadProof(JSON.parse(fs.readFileSync(resolved, 'utf8')));
  if (result.ok !== true || result.approvalGroup !== 'C' || result.laterGroupsAuthorized !== false) {
    throw new Error('e1/group-c-guard-failed');
  }
}

function run() {
  const args = argumentsMap(process.argv.slice(2));
  const mode = args.mode;
  if (!['plan', 'deploy'].includes(mode)) throw new Error('e1/gateway-deployment-mode-invalid');
  const repoRoot = resolveRepositoryRoot(__dirname);
  const rootIgnore = path.join(repoRoot, '.gcloudignore');
  const rootIgnoreExisted = fs.existsSync(rootIgnore);
  const plan = createDeploymentPlan({
    action: args.action,
    expectedSha: args['expected-sha'],
    explicitSource: args.source,
    mode,
    repoRoot
  });
  if (mode === 'plan') {
    process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
    return;
  }
  if (plan.action === 'enable-group-c') verifyGroupCGuard();
  let stagedSource;
  try {
    stagedSource = stagePinnedSource(plan);
    for (const functionName of plan.functions) {
      const result = spawnSync('gcloud', deploymentArguments(plan, functionName, stagedSource), { stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`e1/gateway-deployment-failed:${functionName}`);
    }
  } finally {
    if (stagedSource) fs.rmSync(stagedSource, { recursive: true, force: true });
  }
  if (fs.existsSync(rootIgnore) !== rootIgnoreExisted) throw new Error('e1/repository-root-gcloudignore-created');
}

try { run(); }
catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
