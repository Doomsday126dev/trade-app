'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const {
  EXPECTED_GATEWAYS, DISABLED_AUTHORITY_GATES, DISABLED_GATEWAY_GATES, buildPlan
} = require('../production/providerIdentityDeploymentPlan.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const sourceCommit = '794f8dbe08ee30a7de29ca73013b5ad77070ad44';
const sourceTree = 'a6e14dcc7a2a8c7d0a74c2c2ec033248cbc09ea2';

function plan() {
  return buildPlan({
    repoRoot, sourceCommit, sourceTree,
    candidateRulesDigest: '9'.repeat(64), currentRulesDigest: '8'.repeat(64),
    currentAuthorityRevision: 'e1-identity-authority-00061-jbt',
    currentAuthorityImageDigest: 'sha256:' + '7'.repeat(64),
    currentGatewayRevisions: {
      readE1AccountFoundation: 'reade1accountfoundation-00057-tuw',
      reserveE1TrainerHandle: 'reservee1trainerhandle-00057-wuy'
    },
    currentIamPolicyDigest: '6'.repeat(64)
  }).plan;
}

test('plan binds exact accepted source and all six inactive gateways', () => {
  const value = plan();
  assert.equal(value.source.commit, sourceCommit);
  assert.equal(value.source.tree, sourceTree);
  assert.deepEqual(value.gateways.functions, [...EXPECTED_GATEWAYS]);
  assert.deepEqual(value.authority.environment.READ_ACCOUNT_FOUNDATION_ENABLED,
    DISABLED_AUTHORITY_GATES.READ_ACCOUNT_FOUNDATION_ENABLED);
  assert.deepEqual(value.gateways.environment, { ...DISABLED_GATEWAY_GATES });
  assert.equal(value.providerAccountsExist, false);
  assert.equal(value.mutationBudgetNow, 0);
});

test('secret plan exposes only reference metadata and exact authority accessor', () => {
  const value = plan();
  const text = JSON.stringify(value);
  assert.equal(value.secretAndIam.secret, 'e1-provider-subject-hmac-key');
  assert.equal(value.secretAndIam.initialVersion, '1');
  assert.equal(value.secretAndIam.plaintextPersistenceAllowed, false);
  assert.match(value.secretAndIam.accessor, /e1-identity-authority-runtime/u);
  assert.doesNotMatch(text, /secretValue|plaintextValue|keyMaterial/u);
});

test('rollback pins current revisions, Rules, IAM, and preserves durable identity state', () => {
  const value = plan();
  assert.equal(value.rollback.authorityRevision, 'e1-identity-authority-00061-jbt');
  assert.equal(value.rollback.restoreAllGatesFalse, true);
  assert.equal(value.rollback.preserveIdentityBackfillsAndHolds, true);
  assert.equal(value.rollback.preserveProviderSubjectSecretAfterFirstProviderAccount, true);
});
