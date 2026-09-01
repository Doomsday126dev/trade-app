'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  APPROVAL, parseArgs, requireTarget, requireApproval, encode, decode, exact
} = require('../scripts/run-provider-identity-live-window.cjs');

test('production target requires every exact identifier', () => {
  const exactTarget = {
    confirmProject: 'trade-list-a4297', confirmFirestoreDatabase: 'phase-e-identity',
    confirmRtdbUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com'
  };
  assert.doesNotThrow(() => requireTarget(exactTarget));
  assert.throws(() => requireTarget({ ...exactTarget, confirmProject: 'other' }), /production_target_not_confirmed/u);
});

test('every live mutation requires the exact private approval artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-approval-'));
  const approval = path.join(directory, 'approval.txt');
  try {
    fs.writeFileSync(approval, `${APPROVAL}\n`, { mode: 0o600 });
    assert.doesNotThrow(() => requireApproval({ execute: true, approvalFile: approval }));
    fs.writeFileSync(approval, 'almost approved\n', { mode: 0o600 });
    assert.throws(() => requireApproval({ execute: true, approvalFile: approval }), /live_approval_missing/u);
    fs.writeFileSync(approval, `${APPROVAL}\n`, { mode: 0o644 });
    fs.chmodSync(approval, 0o644);
    assert.throws(() => requireApproval({ execute: true, approvalFile: approval }), /permissions_invalid/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Firestore transport encoder round-trips exact canonical documents', () => {
  const value = { schemaVersion: 1, uid: 'test-uid', active: true, nullable: null,
    nested: { count: 2 }, values: ['a', 2, false] };
  assert.equal(exact(decode(encode(value)), value), true);
});

test('CLI defaults to zero-write planning until execute is explicit', () => {
  const options = parseArgs(['--action', 'apply-manifest', '--manifest', '/private/manifest.json']);
  assert.equal(options.execute, undefined);
  assert.equal(options.action, 'apply-manifest');
});
