'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { setup, pipeline } = require('./fixtures/provider-identity-pipeline-fixture.cjs');
const { orchestrate } = require('../production/providerIdentityOrchestrator.cjs');
const { EXPECTED_GATEWAYS } = require('../production/providerIdentityDeploymentPlan.cjs');
const { exclusive } = require('../production/providerIdentityRun.cjs');

let root, sourceRepo;
before(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-pipeline-'));
  sourceRepo = path.join(root, 'source');
  execFileSync('git', ['clone', '--quiet', '--sparse', '--shared', path.resolve(__dirname, '../..'), sourceRepo]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
function create(t) {
  const directory = fs.mkdtempSync(path.join(root, 'run-'));
  const v = setup(directory, sourceRepo);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, ...v };
}
function safe(v, phase) {
  const state = v.read(), ledger = v.store.ledger();
  assert.equal(ledger.state.phase, phase);
  assert.equal(ledger.state.terminal, true);
  assert.equal(state.documents['authorityConfig/providerAccountCreation'], undefined);
  assert.ok(!state.rtdbFreeze || state.rtdbFreeze.state === 'released');
  assert.equal(v.store.read('closeout.json').gatesFalse, true);
  assert.throws(() => v.store.authorize('execution', 'prepare-infrastructure', v.store.binding(), state.at), /run_closed/);
}

test('one sealed preparation drives coordinator through actual secret, Rules, authority and six gateway executors', async (t) => {
  const f = create(t), v = pipeline(f.directory);
  const result = await orchestrate(v.context);
  safe(v, 'CLOSED_HEALTHY');
  assert.equal(result.phase, 'CLOSED_HEALTHY');
  assert.equal(Object.keys(v.read().functions).length, 6);
  assert.equal(v.read().versions.length, 1);
  assert.equal(v.store.read('closeout.json').finalIdentityCoverage, 58);
  const mutations = v.read().commandMutations;
  for (const name of EXPECTED_GATEWAYS) assert.equal(mutations[`functions:deploy:${name}`], 1);
  assert.deepEqual(v.read().proof, ['frozen-semantics', 'zero-write-admission', 'provisioning-restored']);
  const writes = v.read().writes;
  await orchestrate(pipeline(f.directory).context);
  assert.equal(v.read().writes, writes);
  assert.equal(fs.statSync(v.store.file('preparation.json')).mode & 0o777, 0o600);
  assert.ok(v.read().captures.filter((c) => c.args[1] === 'versions' && c.args[2] === 'add').every((c) => c.stdinLength === 64));
});

test('bundle/request mismatch and rollback contract mutation fail before commands', (t) => {
  const f = create(t), bundle = f.store.read('preparation.json');
  bundle.plan.rollback.authorityRevision = 'foreign';
  fs.unlinkSync(f.store.file('preparation.json'));
  exclusive(f.store.file('preparation.json'), f.store.seal(bundle));
  assert.throws(() => pipeline(f.directory), /preparation_bundle_changed/);
});

test('concrete infrastructure and identity failure boundaries reach restored terminal closeout', async (t) => {
  const points = ['api', 'secret', 'version', 'iam', 'rules', 'authority-build', 'authority',
    ...EXPECTED_GATEWAYS.map((name) => `gateway:${name}`)].map((name) => `infra:after:${name}`);
  points.push('after:activate-freeze', 'phase:FROZEN', 'identity:committed',
    'identity:committed:CREATE_LEGACY_HANDLE_HOLD', 'after:verify-coverage',
    'after:create-certification', 'after:verify-zero-write');
  for (const point of points) await t.test(point, async (st) => {
    const f = create(st), v = pipeline(f.directory, { point });
    await orchestrate(v.context);
    safe(v, 'CLOSED_BLOCKED_RESTORED');
    assert.equal(v.read().secret, null);
    assert.equal(Object.keys(v.read().functions).length, 0);
  });
});

test('foreign IAM, provider usage and changed rollback target are safe manual infrastructure terminals', async (t) => {
  for (const anomaly of ['foreign-iam', 'provider-use', 'foreign-authority']) await t.test(anomaly, async (st) => {
    const f = create(st), v = pipeline(f.directory, { anomaly, anomalyAt: 'after:create-certification' });
    await orchestrate(v.context);
    safe(v, 'CLOSED_BLOCKED_MANUAL_INFRA_REVIEW');
    assert.ok(v.store.read('closeout.json').manualItems.length);
    assert.equal(v.store.read('closeout.json').finalIdentityCoverage, 58);
    if (anomaly === 'foreign-iam') assert.ok(v.read().policy.bindings.some((b) => b.members.includes('user:foreign@example.test')));
    if (anomaly === 'provider-use') assert.ok(v.read().secret);
    if (anomaly === 'foreign-authority') assert.equal(v.read().service.metadata.foreignRevision, true);
  });
});

test('separate-process SIGKILL after concrete deployment resumes restoration without redeployment', async (t) => {
  for (const point of ['infra:after:version', 'infra:after:rules', 'infra:after:authority',
    'infra:after:gateway:readE1AccountFoundation', 'after:create-certification']) await t.test(point, async (st) => {
    const f = create(st);
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/provider-identity-pipeline-fixture.cjs'), f.directory, point],
      { encoding: 'utf8', timeout: 120000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const v = pipeline(f.directory), submitted = { ...v.read().commandMutations };
    await orchestrate(v.context);
    safe(v, 'CLOSED_BLOCKED_RESTORED');
    for (const [key, count] of Object.entries(submitted).filter(([key]) => key.includes(':deploy:') || key === 'run:services')) {
      if (key.includes(':deploy:')) assert.equal(v.read().commandMutations[key], count);
    }
  });
});

test('unproven pending cloud operation prevents any terminal safety assertion', async (t) => {
  const f = create(t), v = pipeline(f.directory, { point: 'phase:INFRASTRUCTURE_READY' });
  const state = v.read(); state.operations.remote = { status: 'pending' }; v.save(state);
  await assert.rejects(orchestrate(v.context), /pipeline_containment_unverified/);
  assert.equal(v.store.ledger().state.terminal, false);
  assert.equal(fs.existsSync(v.store.file('closeout.json')), false);
});

test('concrete restoration interruptions resume without changing prior identity results', async (t) => {
  for (const point of ['after:invalidate-certification', 'after:release-freeze', 'after:cleanup-privileges',
    'infra:after:rollback-rules', 'infra:after:rollback-secret']) await t.test(point, async (st) => {
    const f = create(st), v = pipeline(f.directory, { point });
    const original = v.context.checkpoint;
    v.context.checkpoint = async (name) => {
      await original(name);
      if (name === 'after:create-certification') throw new Error('synthetic_stop_for_rollback');
    };
    await assert.rejects(orchestrate(v.context));
    const documents = v.read().documents;
    await orchestrate(pipeline(f.directory).context);
    safe(v, 'CLOSED_BLOCKED_RESTORED');
    for (const [name, value] of Object.entries(documents).filter(([name]) => !name.startsWith('authorityConfig/'))) {
      assert.deepEqual(v.read().documents[name], value);
    }
  });
});

test('committed response loss is reconciled without duplicate version or deployment submission', async (t) => {
  const cases = [
    ['command:after:services:enable:secretmanager.googleapis.com', 'CLOSED_BLOCKED_RESTORED'],
    ['command:after:secrets:versions:add', 'CLOSED_HEALTHY'],
    ['command:after:rules:replace', 'CLOSED_BLOCKED_MANUAL_INFRA_REVIEW'],
    ['command:after:run:services:replace', 'CLOSED_BLOCKED_MANUAL_INFRA_REVIEW']
  ];
  for (const [point, phase] of cases) await t.test(point, async (st) => {
    const f = create(st), v = pipeline(f.directory, { point });
    await orchestrate(v.context);
    safe(v, phase);
    assert.ok(v.read().captures.filter((c) => c.args.slice(0, 3).join(':') === 'secrets:versions:add').length <= 1);
    assert.ok((v.read().commandMutations['run:services'] || 0) <= 1);
  });
});
