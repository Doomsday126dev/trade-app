'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-legacy-identity-guard.cjs');
const baseline = structuredClone(require('./firebase/database.rules.sec02-production.json'));
// Production snapshot differs only by the not-yet-deployed profile Rules.
delete baseline.rules.accountSync.$uid.profile;
test('guard changes only the three identity write policies in the exact production baseline', () => {
  const actual = require('./firebase/database.rules.legacy-identity-guard.json');
  assert.deepEqual(actual, build(baseline));
  const restored = structuredClone(actual);
  for (const [root, key] of [['users', '$username'], ['authIndex', '$uid'], ['loginDirectory', '$username']]) {
    assert.notEqual(actual.rules[root][key]['.write'], baseline.rules[root][key]['.write']);
    restored.rules[root][key]['.write'] = baseline.rules[root][key]['.write'];
  }
  assert.deepEqual(restored, baseline);
  assert.throws(() => build({ rules: {} }), /Unreviewed/);
});
