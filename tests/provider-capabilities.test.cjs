'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/domain/authenticationReadiness.js'), 'utf8');

function policy() {
  const window = {};
  vm.runInNewContext(source, { window }, { filename: 'authenticationReadiness.js' });
  return window.PogoDomain.providerCapabilities;
}

test('six provider lifecycle responsibilities resolve independently and default closed', () => {
  const domain = policy();
  assert.deepEqual({ ...domain.resolveProviderCapabilities() }, { ...domain.DISABLED });
  for (const key of domain.CAPABILITY_KEYS) {
    const resolved = domain.resolveProviderCapabilities({ requested: { [key]: true } });
    assert.equal(resolved[key], true);
    assert.equal(domain.CAPABILITY_KEYS.filter((candidate) => candidate !== key)
      .every((candidate) => resolved[candidate] === false), true);
  }
});

test('post-first-account floor irreversibly preserves account compatibility and existing public reads only', () => {
  const domain = policy();
  const resolved = domain.resolveProviderCapabilities({
    requested: { providerAccountCompatibility: false, providerPublicReadSupport: false },
    floor: { schemaVersion: 1, providerAccountsExist: true }
  });
  assert.deepEqual({ ...resolved }, {
    providerAccountCompatibility: true,
    googlePublicEntry: false,
    googleExistingAccountLinking: false,
    providerAccountCreation: false,
    providerPublicReadSupport: true,
    providerPublicWriteSupport: false
  });
  assert.equal(domain.providerModulesRequired(resolved), true);
});

test('stage-aware rollback can fully disable pre-first support but preserves post-first returning support', () => {
  const domain = policy();
  assert.deepEqual({ ...domain.rollbackCapabilities('pre-first-provider-account') }, { ...domain.DISABLED });
  assert.deepEqual({ ...domain.rollbackCapabilities('post-first-provider-account') }, {
    providerAccountCompatibility: true,
    googlePublicEntry: false,
    googleExistingAccountLinking: false,
    providerAccountCreation: false,
    providerPublicReadSupport: true,
    providerPublicWriteSupport: false
  });
});
