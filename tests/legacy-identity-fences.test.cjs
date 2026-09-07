'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, IDENTITY_PATHS, CANONICAL_PATHS } = require('../scripts/build-legacy-identity-fences.cjs');
const baseline = require('./firebase/database.rules.legacy-identity-guard.json');
test('UID fence changes only exact identity writes, canonical creation and private metadata', () => {
  const actual = require('./firebase/database.rules.legacy-identity-fences.json');
  assert.deepEqual(actual, build(baseline));
  assert.deepEqual(actual.rules.legacyIdentityFences, { '.read': false, '.write': false });
  const restored = structuredClone(actual);
  for (const path of [...IDENTITY_PATHS, ...CANONICAL_PATHS]) {
    const node = path.split('/').reduce((v, k) => v[k], restored.rules);
    const old = path.split('/').reduce((v, k) => v[k], baseline.rules);
    assert.ok(node['.write'].startsWith(`(${old['.write']}) && (`));
    node['.write'] = old['.write'];
  }
  delete restored.rules.legacyIdentityFences;
  assert.deepEqual(restored, baseline);
  assert.throws(() => build({ rules: {} }), /Unreviewed/);
});
test('no ancestor or wildcard policy can expose or write private fence records', () => {
  const actual = require('./firebase/database.rules.legacy-identity-fences.json');
  assert.equal(actual.rules['.read'], false);
  assert.ok(actual.rules['.write'] === false || actual.rules['.write'] === undefined);
  assert.deepEqual(Object.keys(actual.rules).filter(key => key.startsWith('$')), []);
  assert.deepEqual(Object.keys(actual.rules.legacyIdentityFences).sort(), ['.read', '.write']);
});
