'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CONFIG_PATH,
  FIREBASE_EXECUTABLE,
  FIREBASE_INTEGRITY,
  FIREBASE_RESOLVED,
  FIREBASE_VERSION,
  RULES_PATH,
  buildPlan,
  commandText,
  expectedDeployArgs,
  sha256,
  validateDeployCommand,
  validateFirebaseConfig,
  validateToolPackage,
  verifyFirebaseCli
} = require('../scripts/check-group-e-control-rules-tooling.cjs');

const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8'));
}

test('dedicated Firebase config selects only the Group E named database and deterministic deny-all Rules', () => {
  const configBytes = fs.readFileSync(path.resolve(ROOT, CONFIG_PATH));
  const rulesBytes = fs.readFileSync(path.resolve(ROOT, RULES_PATH));
  const config = validateFirebaseConfig(JSON.parse(configBytes), { root: ROOT });

  assert.deepEqual(config, {
    firestore: [{ database: 'e1-group-e-control', rules: 'functions/production/e1-group-e-control.rules' }]
  });
  assert.equal(sha256(configBytes), '383fa3d1d373fe3ab81911605e49bf2e4955895b4fd45f7eaa4b20213452b003');
  assert.equal(sha256(rulesBytes), 'cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b');
  assert.match(rulesBytes.toString('utf8'), /allow read, write: if false;/u);
  assert.doesNotMatch(JSON.stringify(config), /phase-e-identity|\(default\)|hosting|storage|apphosting|dataconnect|predeploy|postdeploy/iu,
    'config must contain no unrelated Firebase product or deployment hook');
  assert.equal(Object.hasOwn(config, 'database'), false, 'Realtime Database config must be absent');
  assert.equal(Object.hasOwn(config, 'functions'), false);
  assert.equal(fs.existsSync(path.resolve(ROOT, '.firebaserc')), false);
  assert.equal(fs.existsSync(path.resolve(ROOT, 'firebase.json')), false);
});

test('config validator rejects extra products entries fields aliases and general config reliance', () => {
  const valid = readJson(CONFIG_PATH);
  const invalid = [
    { ...valid, database: [] },
    { ...valid, hosting: {} },
    { firestore: [] },
    { firestore: [...valid.firestore, valid.firestore[0]] },
    { firestore: [{ ...valid.firestore[0], indexes: 'firestore.indexes.json' }] },
    { firestore: [{ ...valid.firestore[0], database: '(default)' }] },
    { firestore: [{ ...valid.firestore[0], database: 'phase-e-identity' }] },
    { firestore: [{ ...valid.firestore[0], rules: '*.rules' }] }
  ];
  for (const config of invalid) {
    assert.throws(() => validateFirebaseConfig(config, { root: ROOT }), /group_e_control_firebase_config_invalid/);
  }
});

test('isolated Firebase CLI package and lock pin exact version and registry integrity without scripts', () => {
  const packageJson = readJson('tools/group-e-control/package.json');
  const lock = readJson('tools/group-e-control/package-lock.json');
  assert.equal(validateToolPackage(packageJson, lock), true);
  assert.equal(packageJson.dependencies['firebase-tools'], '15.28.1');
  assert.equal(lock.packages['node_modules/firebase-tools'].version, '15.28.1');
  assert.equal(lock.packages['node_modules/firebase-tools'].integrity,
    FIREBASE_INTEGRITY);
  assert.equal(lock.packages['node_modules/firebase-tools'].resolved, FIREBASE_RESOLVED);
  assert.equal(Object.hasOwn(packageJson, 'scripts'), false);
});

test('planner invokes only the package-local exact CLI and constructs one exact non-executed deploy command', () => {
  const calls = [];
  const spawn = (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 0, signal: null, error: null, stdout: `${FIREBASE_VERSION}\n`, stderr: '' };
  };
  assert.equal(verifyFirebaseCli({ root: ROOT, spawn }), FIREBASE_VERSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, path.resolve(ROOT, FIREBASE_EXECUTABLE));
  assert.deepEqual(calls[0].args, ['--version']);
  assert.equal(calls[0].options.env.FIREBASE_CLI_DISABLE_UPDATE_CHECK, 'true');
  assert.match(calls[0].options.env.XDG_CONFIG_HOME, /group-e-firebase-cli-/u);
  assert.equal(fs.existsSync(calls[0].options.env.XDG_CONFIG_HOME), false);

  const plan = buildPlan({ root: ROOT, spawn });
  assert.equal(plan.command, commandText());
  assert.equal(plan.command,
    'tools/group-e-control/node_modules/.bin/firebase deploy --project=trade-list-a4297 ' +
    '--config=firebase.group-e-control.json --only=firestore:e1-group-e-control --non-interactive');
  assert.equal(plan.networkRequests, 0);
  assert.equal(plan.cloudOperations, 0);
  assert.equal(plan.deploymentExecuted, false);
});

test('deploy command validation rejects global CLI broad selectors defaults missing bindings and extra arguments', () => {
  const exact = [...expectedDeployArgs()];
  assert.equal(validateDeployCommand(FIREBASE_EXECUTABLE, exact), true);
  const invalid = [
    ['firebase', exact],
    [FIREBASE_EXECUTABLE, exact.filter((value) => !value.startsWith('--project='))],
    [FIREBASE_EXECUTABLE, exact.filter((value) => !value.startsWith('--config='))],
    [FIREBASE_EXECUTABLE, exact.map((value) => value === '--only=firestore:e1-group-e-control' ? '--only=firestore' : value)],
    [FIREBASE_EXECUTABLE, exact.map((value) => value === '--only=firestore:e1-group-e-control' ? '--only=firestore:(default)' : value)],
    [FIREBASE_EXECUTABLE, exact.map((value) => value === '--only=firestore:e1-group-e-control' ? '--only=firestore:phase-e-identity' : value)],
    [FIREBASE_EXECUTABLE, [...exact, '--debug']]
  ];
  for (const [executable, args] of invalid) {
    assert.throws(() => validateDeployCommand(executable, args), /group_e_control_deploy_command_invalid/);
  }
});

test('tracked scripts contain no broader Firebase deploy command', () => {
  const files = fs.readdirSync(path.resolve(ROOT, 'scripts'), { recursive: true })
    .filter((file) => /\.(?:cjs|js)$/u.test(file));
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(ROOT, 'scripts', file), 'utf8');
    assert.doesNotMatch(source, /\bfirebase\s+deploy\b/u, file);
  }
});
