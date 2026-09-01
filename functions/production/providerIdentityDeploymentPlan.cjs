'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PROJECT_ID = 'trade-list-a4297';
const REGION = 'us-central1';
const AUTHORITY_SERVICE = 'e1-identity-authority';
const AUTHORITY_SERVICE_ACCOUNT = 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com';
const GATEWAY_SERVICE_ACCOUNT = 'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com';
const SECRET_NAME = 'e1-provider-subject-hmac-key';
const EXPECTED_GATEWAYS = Object.freeze([
  'readE1AccountFoundation',
  'readE1ProviderPublicShare',
  'listE1TrainerDirectory',
  'resolveE1FavoriteTrainerIdentity',
  'createE1ProviderAccountFoundation',
  'reserveE1TrainerHandle'
]);
const DISABLED_AUTHORITY_GATES = Object.freeze({
  READ_ACCOUNT_FOUNDATION_ENABLED: 'false',
  READ_PROVIDER_PUBLIC_SHARE_ENABLED: 'false',
  CREATE_PROVIDER_ACCOUNT_ENABLED: 'false',
  RESERVE_HANDLE_ENABLED: 'false',
  REPAIR_FOUNDATION_ENABLED: 'false',
  APPLY_MIGRATION_ENABLED: 'false',
  FREEZE_CONFLICT_ENABLED: 'false'
});
const DISABLED_GATEWAY_GATES = Object.freeze({
  GATEWAY_INVOCATION_ENABLED: 'false',
  PROVIDER_PUBLIC_PROJECTION_ENABLED: 'false',
  GROUP_E_CLIENT_MODE: 'disabled',
  READ_PROOF_MODE: 'false'
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding });
}

function sourceManifest(repoRoot, commit, sourceRoot) {
  const paths = git(repoRoot, ['ls-tree', '-r', '--name-only', commit, '--', sourceRoot]).trim().split('\n').filter(Boolean);
  const files = paths.map((file) => {
    const contents = git(repoRoot, ['show', `${commit}:${file}`], null);
    return { path: file.slice(sourceRoot.length + 1), sha256: sha256(contents), contents };
  });
  const fingerprint = sha256(files.map((file) => `${file.path}\0${file.sha256}\n`).join(''));
  return { sourceRoot, sourceCommit: commit, sourceFingerprint: fingerprint,
    sourceFiles: files.map(({ contents, ...file }) => file), files };
}

function gatewayExports(contents) {
  return [...contents.toString('utf8').matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)].map((match) => match[1]);
}

function buildPlan(options) {
  const authority = sourceManifest(options.repoRoot, options.sourceCommit, 'functions/e1-authority-service');
  const gateway = sourceManifest(options.repoRoot, options.sourceCommit, 'functions/e1-gateway');
  const index = gateway.files.find((file) => file.path === 'index.js');
  const exports = gatewayExports(index?.contents || Buffer.alloc(0));
  if (JSON.stringify(exports) !== JSON.stringify(EXPECTED_GATEWAYS)) throw new Error('gateway_export_inventory_mismatch');
  if (git(options.repoRoot, ['rev-parse', `${options.sourceCommit}^{tree}`]).trim() !== options.sourceTree) {
    throw new Error('source_tree_mismatch');
  }

  const plan = {
    schemaVersion: 1,
    planType: 'provider-identity-inactive-deployment-v1',
    source: { commit: options.sourceCommit, tree: options.sourceTree },
    providerAccountsExist: false,
    authority: {
      service: AUTHORITY_SERVICE,
      region: REGION,
      sourceRoot: authority.sourceRoot,
      sourceFingerprint: authority.sourceFingerprint,
      sourceFiles: authority.sourceFiles,
      runtimeServiceAccount: AUTHORITY_SERVICE_ACCOUNT,
      target: `next-inactive-revision-for-${authority.sourceFingerprint.slice(0, 12)}`,
      environment: { ...DISABLED_AUTHORITY_GATES,
        PROVIDER_SUBJECT_HMAC_KEY_VERSION: '1', PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'false' },
      secretReference: { environmentVariable: 'PROVIDER_SUBJECT_HMAC_KEY', secret: SECRET_NAME, version: '1' }
    },
    gateways: {
      functions: [...EXPECTED_GATEWAYS],
      region: REGION,
      sourceRoot: gateway.sourceRoot,
      sourceFingerprint: gateway.sourceFingerprint,
      sourceFiles: gateway.sourceFiles,
      runtimeServiceAccount: GATEWAY_SERVICE_ACCOUNT,
      environment: { ...DISABLED_GATEWAY_GATES }
    },
    rules: {
      candidatePath: 'tests/firebase/database.rules.provider-identity-window.json',
      candidateDigest: options.candidateRulesDigest,
      currentDigest: options.currentRulesDigest,
      rollbackDigest: options.currentRulesDigest
    },
    secretAndIam: {
      secret: SECRET_NAME,
      initialVersion: '1',
      plaintextPersistenceAllowed: false,
      accessor: `serviceAccount:${AUTHORITY_SERVICE_ACCOUNT}`,
      role: 'roles/secretmanager.secretAccessor',
      ordinaryGatewayAccess: false,
      browserAccess: false,
      builderAccess: false,
      compatibilityRetentionAfterFirstProviderAccount: true
    },
    rollback: {
      authorityRevision: options.currentAuthorityRevision,
      authorityImageDigest: options.currentAuthorityImageDigest,
      gatewayRevisions: options.currentGatewayRevisions,
      rulesDigest: options.currentRulesDigest,
      iamPolicyDigest: options.currentIamPolicyDigest,
      preserveIdentityBackfillsAndHolds: true,
      preserveProviderSubjectSecretAfterFirstProviderAccount: true,
      restoreAllGatesFalse: true
    },
    mutationBudgetNow: 0
  };
  const publicPlan = structuredClone(plan);
  return { plan: { ...plan, planDigest: sha256(JSON.stringify(plan)) }, publicPlan };
}

module.exports = {
  EXPECTED_GATEWAYS, DISABLED_AUTHORITY_GATES, DISABLED_GATEWAY_GATES, sha256, sourceManifest,
  gatewayExports, buildPlan
};
