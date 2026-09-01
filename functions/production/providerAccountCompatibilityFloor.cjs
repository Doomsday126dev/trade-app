'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FLOOR_PATH = path.resolve(__dirname, 'provider-account-compatibility-floor.json');
const HASH = /^[a-f0-9]{64}$/u;
const VERSION = /^[1-9][0-9]{0,3}$/u;

function exactFields(value, fields) {
  const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function validateCompatibilityFloor(value) {
  if (!exactFields(value, ['schemaVersion', 'stage', 'providerAccountsExist', 'compatibilityIrreversible',
    'requiredProviderSubjectKeyVersions', 'compatibleAuthoritySourceFingerprints']) || value.schemaVersion !== 1 ||
      !['pre-first-provider-account', 'post-first-provider-account'].includes(value.stage) ||
      typeof value.providerAccountsExist !== 'boolean' || typeof value.compatibilityIrreversible !== 'boolean' ||
      !Array.isArray(value.requiredProviderSubjectKeyVersions) ||
      value.requiredProviderSubjectKeyVersions.some((version) => !VERSION.test(String(version))) ||
      new Set(value.requiredProviderSubjectKeyVersions.map(String)).size !== value.requiredProviderSubjectKeyVersions.length ||
      value.requiredProviderSubjectKeyVersions.some((version, index) => index > 0 &&
        Number(version) <= Number(value.requiredProviderSubjectKeyVersions[index - 1])) ||
      !Array.isArray(value.compatibleAuthoritySourceFingerprints) ||
      value.compatibleAuthoritySourceFingerprints.some((fingerprint) => !HASH.test(fingerprint)) ||
      new Set(value.compatibleAuthoritySourceFingerprints).size !== value.compatibleAuthoritySourceFingerprints.length) {
    throw new Error('e1/provider-account-compatibility-floor-invalid');
  }
  const postFirst = value.stage === 'post-first-provider-account';
  if (postFirst !== value.providerAccountsExist || postFirst !== value.compatibilityIrreversible ||
      (postFirst && (!value.requiredProviderSubjectKeyVersions.length || !value.compatibleAuthoritySourceFingerprints.length)) ||
      (!postFirst && (value.requiredProviderSubjectKeyVersions.length || value.compatibleAuthoritySourceFingerprints.length))) {
    throw new Error('e1/provider-account-compatibility-floor-invalid');
  }
  return Object.freeze({
    ...value,
    requiredProviderSubjectKeyVersions: Object.freeze(value.requiredProviderSubjectKeyVersions.map(Number)),
    compatibleAuthoritySourceFingerprints: Object.freeze([...value.compatibleAuthoritySourceFingerprints])
  });
}

function loadCompatibilityFloor(file = FLOOR_PATH) {
  return validateCompatibilityFloor(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function assertProviderCompatibilityDeployment({ floor, authoritySourceFingerprint, environment, availableKeyVersions }) {
  const contract = validateCompatibilityFloor(floor);
  if (!contract.providerAccountsExist) {
    if (environment.PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED !== 'false') {
      throw new Error('e1/provider-account-compatibility-environment-invalid');
    }
    return true;
  }
  const versions = new Set((availableKeyVersions || []).map(Number));
  if (environment.PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED !== 'true' ||
      environment.READ_ACCOUNT_FOUNDATION_ENABLED !== 'true' ||
      !contract.compatibleAuthoritySourceFingerprints.includes(authoritySourceFingerprint) ||
      contract.requiredProviderSubjectKeyVersions.some((version) => !versions.has(version))) {
    throw new Error('e1/provider-account-compatibility-deployment-invalid');
  }
  return true;
}

module.exports = Object.freeze({
  FLOOR_PATH, assertProviderCompatibilityDeployment, loadCompatibilityFloor, validateCompatibilityFloor
});
