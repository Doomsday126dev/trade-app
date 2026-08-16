#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { guardProductionFirstMutation } = require('../production/e1ProductionFirstMutationGuard.cjs');
const { guardProductionReadProof } = require('../production/e1ProductionReadProofGuard.cjs');
const { guardProductionSecondMutation } = require('../production/e1ProductionSecondMutationGuard.cjs');
const { guardProductionThirdMutation } = require('../production/e1ProductionThirdMutationGuard.cjs');
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

const GUARDS = Object.freeze({
  'group-c': Object.freeze({ input: 'E1_PRODUCTION_READ_PROOF_GUARD_INPUT', run: guardProductionReadProof }),
  'group-d1': Object.freeze({ input: 'E1_PRODUCTION_FIRST_MUTATION_GUARD_INPUT', run: guardProductionFirstMutation }),
  'group-d2': Object.freeze({ input: 'E1_PRODUCTION_SECOND_MUTATION_GUARD_INPUT', run: guardProductionSecondMutation }),
  'group-d3': Object.freeze({ input: 'E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT', run: guardProductionThirdMutation })
});

function privateJsonPath(value, label) {
  if (!value) throw new Error(`e1/${label}-input-required`);
  const resolved = path.resolve(value);
  const localRoot = path.resolve(__dirname, '../.local');
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`e1/${label}-input-not-private`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`e1/${label}-input-permissions-invalid`);
  return resolved;
}

function verifiedGuardResult(action, mode, expectedSourceSha) {
  if (action.startsWith('restore-')) return null;
  const cohort = action.replace(/^(?:enable|restore)-/u, '');
  const contract = GUARDS[cohort];
  if (!contract) throw new Error('e1/gateway-action-guard-contract-missing');
  const inputValue = process.env[contract.input];
  if (!inputValue && mode === 'plan') return null;
  const inputPath = privateJsonPath(inputValue, action);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const options = { inputPath };
  if (action === 'enable-group-d2' && process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS) {
    options.readinessPath = privateJsonPath(process.env.E1_PRODUCTION_SECOND_MUTATION_READINESS, 'group-d2-readiness');
  }
  if (action === 'enable-group-d3') {
    options.expectedSourceSha = expectedSourceSha;
    if (process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS) {
      options.readinessPath = privateJsonPath(process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS, 'group-d3-readiness');
    }
    if (process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS) {
      options.bindingPath = privateJsonPath(process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS, 'group-d3-subjects');
    }
  }
  return contract.run(input, options);
}

function run() {
  const args = argumentsMap(process.argv.slice(2));
  const mode = args.mode;
  if (!['plan', 'deploy'].includes(mode)) throw new Error('e1/gateway-deployment-mode-invalid');
  const repoRoot = resolveRepositoryRoot(__dirname);
  const rootIgnore = path.join(repoRoot, '.gcloudignore');
  if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-present');
  const guardResult = verifiedGuardResult(args.action, mode, args['expected-sha']);
  const plan = createDeploymentPlan({
    action: args.action,
    expectedSha: args['expected-sha'],
    explicitSource: args.source,
    mode,
    repoRoot,
    guardResult,
    confirmation: args.confirmation
  });
  if (mode === 'plan') {
    process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`);
    if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-created');
    return;
  }
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
  if (fs.existsSync(rootIgnore)) throw new Error('e1/repository-root-gcloudignore-created');
}

try { run(); }
catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
