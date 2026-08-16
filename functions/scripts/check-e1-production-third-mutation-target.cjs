#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  PRIVATE_BINDING_PATH,
  PRIVATE_BROWSER_HARNESS_PATH,
  PRIVATE_CANDIDATE_POOL_PATH,
  PRIVATE_READINESS_PATH,
  guardProductionThirdMutation,
  validateCandidatePoolArtifact
} = require('../production/e1ProductionThirdMutationGuard.cjs');

const localRoot = path.resolve(__dirname, '../.local');

function privatePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${localRoot}${path.sep}`)) throw new Error(`${label} must remain private under functions/.local`);
  if ((fs.statSync(resolved).mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
  return resolved;
}

function mode() {
  const values = process.argv.slice(2).filter((value) => value.startsWith('--mode='));
  if (values.length > 1) throw new Error('exactly one --mode is permitted');
  const selected = values.length ? values[0].slice('--mode='.length) : 'readiness';
  if (!['candidate-pool', 'readiness'].includes(selected)) throw new Error('unsupported Group D3 checker mode');
  return selected;
}

const selectedMode = mode();
const candidatePoolPath = privatePath(
  process.env.E1_PRODUCTION_THIRD_MUTATION_CANDIDATE_POOL || PRIVATE_CANDIDATE_POOL_PATH,
  'Group D3 candidate pool'
);
const candidatePool = JSON.parse(fs.readFileSync(candidatePoolPath, 'utf8'));

if (selectedMode === 'candidate-pool') {
  const result = validateCandidatePoolArtifact(candidatePool, { candidatePoolPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const inputValue = process.env.E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT;
  if (!inputValue) throw new Error('E1_PRODUCTION_THIRD_MUTATION_GUARD_INPUT is required');
  const inputPath = privatePath(inputValue, 'Group D3 guard input');
  const bindingPath = privatePath(
    process.env.E1_PRODUCTION_THIRD_MUTATION_SUBJECTS || PRIVATE_BINDING_PATH,
    'Group D3 subject binding'
  );
  const readinessPath = privatePath(
    process.env.E1_PRODUCTION_THIRD_MUTATION_READINESS || PRIVATE_READINESS_PATH,
    'Group D3 readiness'
  );
  const browserHarnessPath = privatePath(
    process.env.E1_PRODUCTION_THIRD_MUTATION_BROWSER_HARNESS || PRIVATE_BROWSER_HARNESS_PATH,
    'Group D3 browser harness evidence'
  );
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const repoRoot = path.resolve(__dirname, '../..');
  const expectedSourceSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const result = guardProductionThirdMutation(input, {
    inputPath,
    candidatePoolPath,
    bindingPath,
    browserHarnessPath,
    readinessPath,
    expectedSourceSha
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
