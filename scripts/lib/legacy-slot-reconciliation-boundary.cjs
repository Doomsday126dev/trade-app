'use strict';
const { fingerprint } = require('./legacy-slot-reconciliation.cjs');
const { PROJECT, gcloud } = require('./legacy-slot-reconciliation-production.cjs');
const { CONTRACT } = require('../../functions/legacy-pin-reset/identity-fence');
const plan = require('../../functions/legacy-pin-reset/deployment-plan.json');
const expectedRules = require('../../tests/firebase/database.rules.legacy-identity-fences.json');
const sa = name => `${name}@${PROJECT}.iam.gserviceaccount.com`;
const SERVICE_ACCOUNTS = {
  'ownerresetlegacypin': sa('legacy-pin-reset-runtime'), 'e1-identity-authority': sa('e1-identity-authority-runtime'),
  'reade1accountfoundation': sa('e1-authority-gateway'), 'reservee1trainerhandle': sa('e1-authority-gateway')
};
const CUSTOM = name => `projects/${PROJECT}/roles/${name}`;
const EXPECTED_ROLES = {
  [sa('firebase-adminsdk-fbsvc')]: [CUSTOM('legacyIdentityReadOnly')],
  [sa('legacy-pin-reset-runtime')]: [CUSTOM('legacyPinResetIdentityReader'), CUSTOM('legacyPinResetRuntime'), 'roles/firebaseappcheck.tokenVerifier'],
  [sa('e1-identity-authority-runtime')]: [CUSTOM('e1IdentityAuthorityRuntime')],
  [sa('e1-authority-gateway')]: [CUSTOM('e1GroupEControlGateway'), 'roles/firebaseappcheck.tokenVerifier']
};
const EXPECTED_CONDITIONS = {
  [CUSTOM('legacyPinResetIdentityReader')]: `resource.name == 'projects/${PROJECT}/databases/phase-e-identity' && resource.type == 'firestore.googleapis.com/Database'`,
  [CUSTOM('e1IdentityAuthorityRuntime')]: `resource.type == "firestore.googleapis.com/Database" && resource.name == "projects/${PROJECT}/databases/phase-e-identity"`,
  [CUSTOM('e1GroupEControlGateway')]: `resource.type == "firestore.googleapis.com/Database" && resource.name == "projects/${PROJECT}/databases/e1-group-e-control"`
};
const EXPECTED_PERMISSIONS = {
  [CUSTOM('legacyPinResetRuntime')]: plan.runtimePermissions.project,
  [CUSTOM('legacyIdentityReadOnly')]: plan.identityBoundary.legacySdkReplacementPermissions,
  [CUSTOM('legacyPinResetIdentityReader')]: plan.runtimePermissions.identityDatabaseReadOnly.permissions,
  [CUSTOM('e1IdentityAuthorityRuntime')]: ['datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update'],
  [CUSTOM('e1GroupEControlGateway')]: ['datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.create', 'datastore.entities.get'],
  'roles/firebaseappcheck.tokenVerifier': ['firebaseappcheck.appCheckTokens.verify']
};
function check(condition, code = 'repair/writer-boundary-unqualified') { if (!condition) throw Object.assign(new Error(code), { code }); }
function verifyBoundarySources(sources, now = Date.now()) {
  const { config, services, policy, roles, serviceAccountPolicies, rules, journal, ownerUid, ownerAdmin } = sources;
  check(fingerprint(rules) === fingerprint(expectedRules), 'repair/rules-not-deployed');
  check(config.state === 'ACTIVE' && config.serviceConfig?.serviceAccountEmail === plan.runtimeServiceAccount);
  const env = config.serviceConfig.environmentVariables || {};
  check(env.LEGACY_IDENTITY_BOUNDARY === CONTRACT && env.LEGACY_PIN_RESET_ENABLED === 'false' &&
    env.LEGACY_PIN_RESET_OWNER_UID === ownerUid && ownerAdmin === true, 'repair/reset-not-disabled');
  check(Number.isSafeInteger(config.serviceConfig.timeoutSeconds) && config.serviceConfig.timeoutSeconds > 0 && config.serviceConfig.timeoutSeconds <= 120 &&
    Number.isFinite(Date.parse(config.updateTime)) && now - Date.parse(config.updateTime) >= Math.max(150000, config.serviceConfig.timeoutSeconds * 1000 + 30000), 'repair/reset-not-quiesced');
  check(journal.pendingResetCount === 0, 'repair/reset-journal-pending');
  check(Array.isArray(services) && fingerprint(services.map(s => s.metadata.name).sort()) === fingerprint(Object.keys(SERVICE_ACCOUNTS).sort()));
  for (const service of services) {
    const name = service.metadata.name, spec = service.spec.template.spec;
    check(spec.serviceAccountName === SERVICE_ACCOUNTS[name] && spec.containers.length === 1);
    const settings = Object.fromEntries((spec.containers[0].env || []).map(e => [e.name, e.value]));
    check(service.status.latestReadyRevisionName === service.status.latestCreatedRevisionName &&
      service.status.traffic?.length === 1 && service.status.traffic[0].percent === 100 &&
      service.status.traffic[0].revisionName === service.status.latestReadyRevisionName && !service.status.traffic[0].tag);
    if (name === 'ownerresetlegacypin') {
      check(settings.LEGACY_PIN_RESET_ENABLED === 'false' && settings.LEGACY_IDENTITY_BOUNDARY === CONTRACT &&
        settings.LEGACY_PIN_RESET_OWNER_UID === ownerUid && service.status.latestReadyRevisionName === config.serviceConfig.revision);
    } else {
      check(settings.GROUP_E_CLIENT_MODE === 'disabled' && settings.READ_PROOF_MODE === 'false');
      const gates = name === 'e1-identity-authority'
        ? ['READ_ACCOUNT_FOUNDATION_ENABLED', 'RESERVE_HANDLE_ENABLED', 'REPAIR_FOUNDATION_ENABLED', 'APPLY_MIGRATION_ENABLED', 'FREEZE_CONFLICT_ENABLED', 'CLIENT_FOUNDATION_USE_ENABLED']
        : ['GATEWAY_INVOCATION_ENABLED'];
      check(gates.every(gate => settings[gate] === 'false'), 'repair/provider-service-active');
    }
  }
  const principals = Object.keys(EXPECTED_ROLES).map(email => `serviceAccount:${email}`);
  for (const [email, expected] of Object.entries(EXPECTED_ROLES)) {
    const bindings = (policy.bindings || []).filter(b => b.members?.includes(`serviceAccount:${email}`));
    check(fingerprint(bindings.map(b => b.role).sort()) === fingerprint([...expected].sort()));
    for (const binding of bindings) {
      check((binding.condition?.expression || null) === (EXPECTED_CONDITIONS[binding.role] || null));
      const permissions = roles[binding.role]?.includedPermissions;
      check(Array.isArray(permissions) && !roles[binding.role].deleted && roles[binding.role].stage !== 'DISABLED');
      check(fingerprint([...permissions].sort()) === fingerprint([...EXPECTED_PERMISSIONS[binding.role]].sort()));
      check(permissions.every(p => !plan.identityBoundary.prohibitedApplicationPermissions.includes(p) &&
        !/^firebaseauth\.users\.(?:create|delete|import)$/.test(p) && !/^iam\.serviceAccounts\.(?:actAs|getAccessToken|signBlob|signJwt)$/.test(p)));
    }
    check(serviceAccountPolicies[email] && !(serviceAccountPolicies[email].bindings || []).some(b =>
      b.members?.some(member => principals.includes(member) || ['allUsers', 'allAuthenticatedUsers'].includes(member))));
  }
  // Configuration is only an attestation. The enforced properties come from the exact Rules and permissions above.
  return { resetEnabled: false, quiesced: true, pendingResetCount: 0, immutableBindingsVerified: true,
    securityContract: CONTRACT, rulesFingerprint: fingerprint(rules), fingerprint: fingerprint(sources) };
}
function createBoundaryReader(reads, { cloudRead = gcloud, now = Date.now } = {}) {
  const json = (...args) => JSON.parse(cloudRead(...args, '--format=json'));
  return async () => {
    const config = json('functions', 'describe', 'ownerResetLegacyPin', '--gen2', '--region=us-central1', `--project=${PROJECT}`);
    const services = json('run', 'services', 'list', '--platform=managed', '--region=us-central1', `--project=${PROJECT}`);
    const policy = json('projects', 'get-iam-policy', PROJECT);
    const roles = {}, serviceAccountPolicies = {};
    for (const name of new Set(Object.values(EXPECTED_ROLES).flat())) roles[name] = name.startsWith('roles/')
      ? json('iam', 'roles', 'describe', name) : json('iam', 'roles', 'describe', name.split('/').at(-1), `--project=${PROJECT}`);
    for (const email of Object.keys(EXPECTED_ROLES)) serviceAccountPolicies[email] = json('iam', 'service-accounts', 'get-iam-policy', email, `--project=${PROJECT}`);
    const ownerUid = (await reads.readDatabase('users/Doomsday126/authUid')).value;
    check(typeof ownerUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(ownerUid));
    return verifyBoundarySources({ config, services, policy, roles, serviceAccountPolicies, ownerUid,
      ownerAdmin: (await reads.readDatabase(`admins/${ownerUid}`)).value, rules: await reads.readRules(), journal: await reads.readJournal() }, now());
  };
}
module.exports = { SERVICE_ACCOUNTS, EXPECTED_ROLES, EXPECTED_CONDITIONS, EXPECTED_PERMISSIONS, verifyBoundarySources, createBoundaryReader };
