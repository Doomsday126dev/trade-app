'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { fixture, runtime } = require('./fixtures/provider-identity-orchestrator-fixture.cjs');
const { orchestrate } = require('../production/providerIdentityOrchestrator.cjs');
const { RunStore, approvalPhrase, NORMAL_MS, RESTORE_MS } = require('../production/providerIdentityRun.cjs');
const { atomicWrite } = require('../production/providerIdentityPrivateFiles.cjs');
const { sha256 } = require('../production/providerIdentityWindow.cjs');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provider-run-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, ...fixture(directory) };
}

test('exact bound approval creates separate capabilities without storing the phrase', (t) => {
  const v = setup(t);
  assert.equal(v.store.read('execution.json').requestDigest, v.request.digest);
  assert.equal(v.store.read('restoration.json').expiresAt, null);
  for (const name of fs.readdirSync(v.directory).filter((name) => name.endsWith('.json'))) {
    assert.equal(fs.statSync(path.join(v.directory, name)).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(v.directory, name), 'utf8').includes(approvalPhrase(v.request)), false);
  }
  assert.throws(() => v.store.approve(approvalPhrase(v.request), v.operator, v.at + 3), /EEXIST/);
});

test('all target, manifest, plan, Rules, operator and runtime binding mutations are rejected', async (t) => {
  for (const [field, value] of [['projectId', 'other'], ['database', 'other'], ['rtdbUrl', 'https://other.test'],
    ['manifestDigest', '0'.repeat(64)], ['planDigest', '0'.repeat(64)], ['rulesDigest', '0'.repeat(64)],
    ...['commit', 'tree', 'authority', 'gateway'].map((key) => [`operator.${key}`, '0'.repeat(key === 'commit' || key === 'tree' ? 40 : 64)])]) {
    await t.test(field, (st) => {
      const v = setup(st), binding = v.store.binding();
      if (field.startsWith('operator.')) binding.operator[field.slice(9)] = value; else binding[field] = value;
      assert.throws(() => v.store.authorize('execution', 'activate-freeze', binding, v.at + 3), /capability_binding/);
    });
  }
});

test('wrong run or request phrase and wrong operator cannot mint capabilities', async (t) => {
  for (const variant of ['run', 'digest', 'operator', 'expiry']) await t.test(variant, (st) => {
    const v = setup(st), next = path.join(v.directory, 'unapproved'); fs.mkdirSync(next, { mode: 0o700 });
    const store = new RunStore(next); store.initialize(v.request);
    const phrase = approvalPhrase(v.request);
    assert.throws(() => store.approve(variant === 'run' ? phrase.replace(v.request.runId, 'different-window') :
      variant === 'digest' ? phrase.replace(v.request.digest, '0'.repeat(64)) : phrase,
    variant === 'operator' ? { ...v.operator, commit: '0'.repeat(40) } : v.operator,
    variant === 'expiry' ? v.request.expiresAt : v.at + 3), /approval_rejected/);
    assert.equal(fs.existsSync(store.file('execution.json')), false);
  });
});

test('edited request, copied run directory and substituted capability fail closed', async (t) => {
  for (const variant of ['request', 'copy', 'capability']) await t.test(variant, (st) => {
    const v = setup(st);
    if (variant === 'request') {
      const sealed = JSON.parse(fs.readFileSync(v.store.file('request.json')));
      sealed.value.request.runId = 'different-window'; atomicWrite(v.store.file('request.json'), sealed);
      assert.throws(() => v.store.request(), /seal_invalid/);
    } else if (variant === 'copy') {
      const next = `${v.directory}-copy`; fs.cpSync(v.directory, next, { recursive: true }); fs.chmodSync(next, 0o700);
      st.after(() => fs.rmSync(next, { recursive: true, force: true }));
      assert.throws(() => new RunStore(next).ledger(), /location_mismatch/);
    } else {
      atomicWrite(v.store.file('execution.json'), JSON.parse(fs.readFileSync(v.store.file('restoration.json'))));
      assert.throws(() => v.store.authorize('execution', 'activate-freeze', v.store.binding(), v.at + 3), /capability_binding/);
    }
  });
});

test('normal expiry leaves restoration authority usable, with disjoint action sets', (t) => {
  const v = setup(t);
  assert.throws(() => v.store.authorize('execution', 'activate-freeze', v.store.binding(), v.request.expiresAt), /expired/);
  assert.doesNotThrow(() => v.store.authorize('restoration', 'release-freeze', v.store.binding(), v.request.expiresAt + 1));
  for (const [kind, action] of [['execution', 'release-freeze'], ['restoration', 'apply-manifest'], ['execution', 'arbitrary']]) {
    assert.throws(() => v.store.authorize(kind, action, v.store.binding(), v.at + 3), /capability_binding/);
  }
});

test('ledger rejects phase skips, edits, gaps, stale writes and deadline extensions', (t) => {
  const v = setup(t), old = v.store.ledger();
  assert.throws(() => v.store.append(old, { ...old.state, phase: 'CERTIFICATION_CREATED' }, 'skip', v.at + 3), /phase_invalid/);
  const next = v.store.append(old, { ...old.state, phase: 'INFRASTRUCTURE_READY' }, 'prepare', v.at + 3);
  assert.throws(() => v.store.append(old, next.state, 'stale', v.at + 4), /previous_state_changed/);
  const active = v.store.append(next, { ...next.state, phase: 'FREEZE_ACTIVATING', activatedAt: v.at + 4,
    normalDeadline: v.at + 4 + NORMAL_MS, hardDeadline: v.at + 4 + NORMAL_MS + RESTORE_MS,
    freeze: { immutable: true } }, 'freeze', v.at + 4);
  assert.throws(() => v.store.append(active, { ...active.state, hardDeadline: active.state.hardDeadline + 1 }, 'extend', v.at + 5), /immutable/);
  const file = v.store.file('events/000002.json'), sealed = JSON.parse(fs.readFileSync(file));
  sealed.value.state.phase = 'CLOSED_HEALTHY'; atomicWrite(file, sealed);
  assert.throws(() => v.store.ledger(), /seal_invalid/);
});

test('full persistent orchestrator completes 68 operations, 110 creates, 58 protected handles and closes once', async (t) => {
  const v = setup(t), r = runtime(v.directory), before = Object.keys(r.read().documents).length;
  assert.equal(v.manifest.records.length, 68);
  const state = await orchestrate(r);
  assert.equal(state.phase, 'CLOSED_HEALTHY');
  assert.equal(Object.keys(r.read().documents).length - before, 111); // 110 identity documents plus released freeze.
  assert.equal(r.store.read('completion.json').completeProtectedHandleCount, 58);
  assert.equal(r.store.read('completion.json').completedOperationCount, 68);
  assert.equal(r.store.read('closeout.json').certificationAbsent, true);
  const writes = r.read().writes;
  assert.equal((await orchestrate(runtime(v.directory))).phase, 'CLOSED_HEALTHY');
  assert.equal(r.read().writes, writes);
  assert.throws(() => v.store.authorize('restoration', 'release-freeze', v.store.binding(), r.read().at), /run_closed/);
  assert.throws(() => v.store.authorize('execution', 'apply-manifest', v.store.binding(), r.read().at), /run_closed/);
  assert.ok(r.read().captures.some((v) => v.args.slice(0, 3).join(' ') === 'secrets versions add' && v.stdinLength >= 48));
  assert.equal(JSON.stringify(r.read().captures).includes('APPROVE LIVE'), false);
});

test('each material normal boundary enters restored blocked closeout', async (t) => {
  const pilot = setup(t), capture = [];
  assert.equal((await orchestrate(runtime(pilot.directory, { capture }))).phase, 'CLOSED_HEALTHY');
  const points = [...new Set(capture.slice(0, capture.indexOf('phase:RESTORING')))];
  for (const point of points) await t.test(point, async (st) => {
    const v = setup(st), r = runtime(v.directory, { point });
    assert.equal((await orchestrate(r)).phase, 'CLOSED_BLOCKED_RESTORED');
    assert.equal(r.store.read('closeout.json').certificationAbsent, true);
    assert.equal(r.store.read('closeout.json').freezesInactive, true);
    assert.equal(r.read().secret, null);
    assert.equal(r.read().deployments.authority, 'old');
    assert.deepEqual(r.read().deployments.gateways, {});
  });
});

test('actual SIGKILL at mutation boundaries restarts in restoration only', async (t) => {
  for (const point of ['infra:after:api', 'infra:after:secret', 'infra:after:version', 'infra:after:iam',
    'infra:after:rules', 'infra:after:authority', 'infra:after:gateway:listE1TrainerDirectory',
    'store:create:authorityConfig/legacyProvisioningFreeze', 'store:rtdb:active', 'identity:committed',
    'store:create:authorityConfig/providerAccountCreation', 'store:delete:authorityConfig/providerAccountCreation',
    'store:rtdb:released']) await t.test(point, (st) => {
    const v = setup(st), child = path.join(__dirname, 'fixtures/provider-identity-orchestrator-fixture.cjs');
    const killed = spawnSync(process.execPath, [child, v.directory, point], { encoding: 'utf8', timeout: 120000 });
    assert.equal(killed.signal, 'SIGKILL', killed.stderr);
    const r = runtime(v.directory), beforeAccounts = Object.keys(r.read().documents).filter((k) => k.startsWith('accounts/')).length;
    const resumed = spawnSync(process.execPath, [child, v.directory], { encoding: 'utf8', timeout: 120000 });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /CLOSED_BLOCKED_RESTORED/);
    assert.equal(Object.keys(r.read().documents).filter((k) => k.startsWith('accounts/')).length, beforeAccounts);
    assert.equal(r.store.read('closeout.json').freezesInactive, true);
  });
});

test('SIGINT/SIGTERM stop subsequent normal writes and restore', async (t) => {
  for (const signal of ['SIGINT', 'SIGTERM']) await t.test(signal, async (st) => {
    const v = setup(st), r = runtime(v.directory, { point: 'phase:FROZEN', signal });
    assert.equal((await orchestrate(r)).phase, 'CLOSED_BLOCKED_RESTORED');
    assert.equal(r.store.read('closeout.json').accountCount, 8);
  });
});

test('version-add lost response reconciles metadata without sending a second key', async (t) => {
  const v = setup(t), r = runtime(v.directory, { versionLost: true });
  assert.equal((await orchestrate(r)).phase, 'CLOSED_HEALTHY');
  assert.equal(r.read().captures.filter((v) => v.args.slice(0, 3).join(' ') === 'secrets versions add').length, 1);
});

test('version-add failure before commit rolls back the unused secret', async (t) => {
  const v = setup(t), r = runtime(v.directory, { versionBefore: true });
  assert.equal((await orchestrate(r)).phase, 'CLOSED_BLOCKED_RESTORED');
  assert.equal(r.read().secret, null);
});

test('normal deadline consumes no restoration reserve and restart cannot extend it', async (t) => {
  const v = setup(t), r = runtime(v.directory), original = r.checkpoint;
  let deadlines;
  r.checkpoint = async (point) => {
    await original(point);
    if (point === 'phase:FROZEN') {
      deadlines = r.store.ledger().state;
      const state = r.read(); state.at = deadlines.normalDeadline; r.save(state);
    }
  };
  assert.equal((await orchestrate(r)).phase, 'CLOSED_BLOCKED_RESTORED');
  assert.equal(r.store.read('closeout.json').accountCount, 8);
  assert.equal(r.store.ledger().state.normalDeadline, deadlines.normalDeadline);
  assert.equal(r.store.ledger().state.hardDeadline - deadlines.normalDeadline, RESTORE_MS);
});

test('restoration interruptions are restartable and never resume normal identity writes', async (t) => {
  for (const point of ['before:invalidate-certification', 'after:invalidate-certification',
    'before:release-freeze', 'after:release-freeze', 'before:cleanup-privileges', 'after:cleanup-privileges',
    'phase:PRIVILEGES_CLEANED', 'before:verify-restored', 'after:verify-restored']) await t.test(point, async (st) => {
    const v = setup(st), r = runtime(v.directory, { point });
    await assert.rejects(orchestrate(r));
    const before = sha256((await r.cloud.inventory()).accounts);
    const final = await orchestrate(runtime(v.directory));
    assert.equal(final.phase, 'CLOSED_BLOCKED_RESTORED');
    assert.equal(sha256((await r.cloud.inventory()).accounts), before);
    assert.equal(r.store.read('closeout.json').freezesInactive, true);
  });
});

test('crash between sealed closeout and terminal ledger append requires zero cloud writes', async (t) => {
  const v = setup(t), r = runtime(v.directory), append = r.store.append.bind(r.store);
  r.store.append = (previous, state, action, at) => {
    if (action === 'closeout') throw new Error('synthetic_closeout_crash');
    return append(previous, state, action, at);
  };
  await assert.rejects(orchestrate(r), /closeout_crash/);
  const before = r.read().writes;
  assert.equal((await orchestrate(runtime(v.directory))).phase, 'CLOSED_HEALTHY');
  assert.equal(r.read().writes, before);
});
