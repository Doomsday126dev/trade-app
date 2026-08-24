#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'trade-list-a4297';
const DATABASE_ID = 'e1-group-e-control';
const CONFIG_PATH = 'firebase.group-e-control.json';
const RULES_PATH = 'functions/production/e1-group-e-control.rules';
const TOOL_PACKAGE_PATH = 'tools/group-e-control/package.json';
const TOOL_LOCK_PATH = 'tools/group-e-control/package-lock.json';
const FIREBASE_EXECUTABLE = 'tools/group-e-control/node_modules/.bin/firebase';
const FIREBASE_VERSION = '15.28.1';
const FIREBASE_RESOLVED = 'https://registry.npmjs.org/firebase-tools/-/firebase-tools-15.28.1.tgz';
const FIREBASE_INTEGRITY = 'sha512-5qbKmO0Am0++a335zzUe9/TFdM/dn6jGNKVp2JUcHwDrOK+5wU0LT/fGX+8rjQM8AwfzPp+eMowWX1uDGI+aQg==';
const SELECTOR = `firestore:${DATABASE_ID}`;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relativePath), 'utf8'));
}

function validateFirebaseConfig(config, { root = ROOT } = {}) {
  if (!exactFields(config, ['firestore']) || !Array.isArray(config.firestore) || config.firestore.length !== 1 ||
      !exactFields(config.firestore[0], ['database', 'rules']) ||
      config.firestore[0].database !== DATABASE_ID || config.firestore[0].rules !== RULES_PATH) {
    fail('group_e_control_firebase_config_invalid');
  }
  if (fs.existsSync(path.resolve(root, '.firebaserc')) || fs.existsSync(path.resolve(root, 'firebase.json'))) {
    fail('group_e_control_firebase_alias_or_general_config_present');
  }
  const rulesFile = path.resolve(root, RULES_PATH);
  const stat = fs.lstatSync(rulesFile);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('group_e_control_rules_source_invalid');
  return Object.freeze(structuredClone(config));
}

function validateToolPackage(packageJson, lock) {
  if (!exactFields(packageJson, ['name', 'version', 'private', 'dependencies']) ||
      packageJson.name !== 'trade-app-group-e-control-tooling' || packageJson.version !== '1.0.0' ||
      packageJson.private !== true || !exactFields(packageJson.dependencies, ['firebase-tools']) ||
      packageJson.dependencies['firebase-tools'] !== FIREBASE_VERSION || Object.hasOwn(packageJson, 'scripts')) {
    fail('group_e_control_firebase_cli_package_invalid');
  }
  const rootPackage = lock?.packages?.[''];
  const firebasePackage = lock?.packages?.['node_modules/firebase-tools'];
  if (lock?.lockfileVersion !== 3 || rootPackage?.dependencies?.['firebase-tools'] !== FIREBASE_VERSION ||
      firebasePackage?.version !== FIREBASE_VERSION || firebasePackage?.resolved !== FIREBASE_RESOLVED ||
      firebasePackage?.integrity !== FIREBASE_INTEGRITY || firebasePackage.hasInstallScript === true) {
    fail('group_e_control_firebase_cli_lock_invalid');
  }
  return true;
}

function expectedDeployArgs() {
  return Object.freeze([
    'deploy',
    `--project=${PROJECT_ID}`,
    `--config=${CONFIG_PATH}`,
    `--only=${SELECTOR}`,
    '--non-interactive'
  ]);
}

function validateDeployCommand(executable, args) {
  if (executable !== FIREBASE_EXECUTABLE || JSON.stringify(args) !== JSON.stringify(expectedDeployArgs())) {
    fail('group_e_control_deploy_command_invalid');
  }
  return true;
}

function verifyFirebaseCli({ root = ROOT, spawn = spawnSync } = {}) {
  const executable = path.resolve(root, FIREBASE_EXECUTABLE);
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'group-e-firebase-cli-'));
  let result;
  try {
    result = spawn(executable, ['--version'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        CI: 'true',
        FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
        XDG_CONFIG_HOME: configRoot
      }
    });
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
  if (result.status !== 0 || result.signal || result.error || result.stdout.trim() !== FIREBASE_VERSION ||
      result.stderr.trim() !== '') fail('group_e_control_firebase_cli_version_invalid');
  return FIREBASE_VERSION;
}

function commandText() {
  return [FIREBASE_EXECUTABLE, ...expectedDeployArgs()].join(' ');
}

function buildPlan({ root = ROOT, spawn = spawnSync } = {}) {
  const configBytes = fs.readFileSync(path.resolve(root, CONFIG_PATH));
  const rulesBytes = fs.readFileSync(path.resolve(root, RULES_PATH));
  validateFirebaseConfig(JSON.parse(configBytes.toString('utf8')), { root });
  validateToolPackage(readJson(root, TOOL_PACKAGE_PATH), readJson(root, TOOL_LOCK_PATH));
  const cliVersion = verifyFirebaseCli({ root, spawn });
  validateDeployCommand(FIREBASE_EXECUTABLE, expectedDeployArgs());
  return Object.freeze({
    mode: 'plan',
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    selector: SELECTOR,
    rulesSha256: sha256(rulesBytes),
    configSha256: sha256(configBytes),
    firebaseCliVersion: cliVersion,
    command: commandText(),
    networkRequests: 0,
    cloudOperations: 0,
    deploymentExecuted: false
  });
}

function main() {
  if (process.argv.length !== 2) fail('group_e_control_tooling_arguments_forbidden');
  process.stdout.write(`${JSON.stringify(buildPlan())}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.code || 'group_e_control_tooling_failed');
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  CONFIG_PATH,
  DATABASE_ID,
  FIREBASE_EXECUTABLE,
  FIREBASE_INTEGRITY,
  FIREBASE_RESOLVED,
  FIREBASE_VERSION,
  PROJECT_ID,
  RULES_PATH,
  SELECTOR,
  TOOL_LOCK_PATH,
  TOOL_PACKAGE_PATH,
  buildPlan,
  commandText,
  exactFields,
  expectedDeployArgs,
  sha256,
  validateDeployCommand,
  validateFirebaseConfig,
  validateToolPackage,
  verifyFirebaseCli
});
