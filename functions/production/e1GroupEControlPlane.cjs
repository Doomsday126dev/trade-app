'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PLAN_PATH = path.resolve(__dirname, 'e1-group-e-control-plane-plan.json');
const RULES_PATH = path.resolve(__dirname, 'e1-group-e-control.rules');
const PROJECT_ID = 'trade-list-a4297';
const DATABASE_ID = 'e1-group-e-control';
const DATABASE_RESOURCE = `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
const IAM_CONDITION = `resource.type == "firestore.googleapis.com/Database" && resource.name == "${DATABASE_RESOURCE}"`;
const IAM_CONDITION_TITLE = 'e1-group-e-control-only';
const IAM_CONDITION_DESCRIPTION = 'Restrict Group E control access to the named database';
const IAM_CONDITION_METADATA = Object.freeze({
  title: IAM_CONDITION_TITLE,
  description: IAM_CONDITION_DESCRIPTION,
  expression: IAM_CONDITION
});
const PERMISSIONS = Object.freeze({
  gateway: Object.freeze([
    'datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.get', 'datastore.entities.create'
  ]),
  operator: Object.freeze([
    'datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.get', 'datastore.entities.create'
  ]),
  reviewer: Object.freeze([
    'datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.get'
  ])
});
const ROLE_IDS = Object.freeze({
  gateway: 'e1GroupEControlGateway',
  operator: 'e1GroupEControlOperator',
  reviewer: 'e1GroupEControlReviewer'
});
const FORBIDDEN_PERMISSIONS = Object.freeze([
  'datastore.entities.list', 'datastore.entities.update', 'datastore.entities.delete',
  'datastore.databases.create', 'datastore.databases.update', 'datastore.databases.delete'
]);
const PRINCIPALS = Object.freeze({
  operator: Object.freeze({
    member: 'serviceAccount:e1-group-e-control-operator@trade-list-a4297.iam.gserviceaccount.com',
    serviceAccountStatus: 'NOT_CREATED',
    controlRoleBindingStatus: 'NOT_BOUND',
    authenticationMode: 'short-lived-impersonation-only',
    serviceAccountKeys: 'FORBIDDEN',
    tokenCreatorBinding: Object.freeze({
      role: 'roles/iam.serviceAccountTokenCreator',
      scope: 'service-account-only',
      targetServiceAccount: 'e1-group-e-control-operator@trade-list-a4297.iam.gserviceaccount.com',
      status: 'NOT_BOUND',
      humanImpersonatorSource: 'private-mode-0600-artifact'
    })
  }),
  reviewer: Object.freeze({
    member: 'serviceAccount:e1-group-e-control-reviewer@trade-list-a4297.iam.gserviceaccount.com',
    serviceAccountStatus: 'NOT_CREATED',
    controlRoleBindingStatus: 'NOT_BOUND',
    authenticationMode: 'short-lived-impersonation-only',
    serviceAccountKeys: 'FORBIDDEN',
    tokenCreatorBinding: Object.freeze({
      role: 'roles/iam.serviceAccountTokenCreator',
      scope: 'service-account-only',
      targetServiceAccount: 'e1-group-e-control-reviewer@trade-list-a4297.iam.gserviceaccount.com',
      status: 'NOT_BOUND',
      humanImpersonatorSource: 'private-mode-0600-artifact'
    })
  }),
  gateway: Object.freeze({
    member: 'serviceAccount:e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    serviceAccountStatus: 'EXISTING',
    controlRoleBindingStatus: 'NOT_BOUND',
    authenticationMode: 'runtime-service-account',
    serviceAccountKeys: 'FORBIDDEN'
  }),
  authority: Object.freeze({
    member: 'serviceAccount:e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
    serviceAccountStatus: 'EXISTING',
    controlRole: 'NONE',
    controlRoleBindingStatus: 'NOT_BOUND',
    serviceAccountKeys: 'FORBIDDEN'
  })
});
const DEPLOYED_FIELDS = Object.freeze([
  'status', 'projectId', 'databaseId', 'location', 'type', 'edition', 'deletionProtection', 'pitr', 'ttl',
  'mobileWebRules', 'rulesDigest', 'iamPlanDigest', 'verifiedAt', 'deploymentDigest'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalPrincipalValues(principals) {
  return ['operator', 'reviewer'].flatMap((role) => {
    const principal = principals[role];
    return [role, principal.member, principal.serviceAccountStatus, principal.controlRoleBindingStatus,
      principal.authenticationMode, principal.serviceAccountKeys, principal.tokenCreatorBinding.role,
      principal.tokenCreatorBinding.scope, principal.tokenCreatorBinding.targetServiceAccount,
      principal.tokenCreatorBinding.status, principal.tokenCreatorBinding.humanImpersonatorSource];
  }).concat([
    'gateway', principals.gateway.member, principals.gateway.serviceAccountStatus,
    principals.gateway.controlRoleBindingStatus, principals.gateway.authenticationMode,
    principals.gateway.serviceAccountKeys,
    'authority', principals.authority.member, principals.authority.serviceAccountStatus,
    principals.authority.controlRole, principals.authority.controlRoleBindingStatus,
    principals.authority.serviceAccountKeys
  ]);
}

function canonicalIamPlan(plan) {
  return sha256(JSON.stringify([3, 'group-e-control-iam-plan', IAM_CONDITION_TITLE,
    IAM_CONDITION_DESCRIPTION, IAM_CONDITION,
    ...Object.keys(PERMISSIONS).flatMap((role) => [role, plan.planned.roles[role].roleId, ...PERMISSIONS[role]]),
    ...canonicalPrincipalValues(plan.planned.principals)]));
}

function expectedRulesDigest() {
  return sha256(fs.readFileSync(RULES_PATH));
}

function validateControlPlanePlan(value) {
  const database = value?.planned?.database;
  const roles = value?.planned?.roles;
  const principals = value?.planned?.principals;
  if (!exactFields(value, ['schemaVersion', 'environment', 'projectId', 'planned', 'deployed']) ||
      value.schemaVersion !== 2 || value.environment !== 'production' || value.projectId !== PROJECT_ID ||
      !exactFields(value.planned, ['database', 'rulesSource', 'iamCondition', 'roles', 'principals']) ||
      !exactFields(database, ['databaseId', 'location', 'type', 'edition', 'deletionProtection', 'pitr', 'ttl',
        'mobileWebRules', 'status']) || database.databaseId !== DATABASE_ID || database.location !== 'us-central1' ||
      database.type !== 'FIRESTORE_NATIVE' || database.edition !== 'STANDARD' || database.deletionProtection !== true ||
      database.pitr !== 'ENABLED' || database.ttl !== null || database.mobileWebRules !== 'deny-all' ||
      database.status !== 'NOT_CREATED' || value.planned.rulesSource !== 'functions/production/e1-group-e-control.rules' ||
      !exactFields(value.planned.iamCondition, ['title', 'description', 'expression']) ||
      JSON.stringify(value.planned.iamCondition) !== JSON.stringify(IAM_CONDITION_METADATA) ||
      !exactFields(roles, ['gateway', 'operator', 'reviewer']) ||
      value.deployed !== null) fail('group_e_control_plan_invalid');
  for (const role of Object.keys(PERMISSIONS)) {
    if (!exactFields(roles[role], ['roleId', 'permissions']) ||
        roles[role].roleId !== ROLE_IDS[role] ||
        JSON.stringify(roles[role].permissions) !== JSON.stringify(PERMISSIONS[role]) ||
        roles[role].permissions.some((permission) => FORBIDDEN_PERMISSIONS.includes(permission))) {
      fail('group_e_control_iam_plan_invalid');
    }
  }
  if (!exactFields(principals, ['operator', 'reviewer', 'gateway', 'authority']) ||
      JSON.stringify(principals) !== JSON.stringify(PRINCIPALS) ||
      new Set(Object.values(principals).map((principal) => principal.member)).size !== 4 ||
      JSON.stringify(principals).includes('${') ||
      Object.values(principals).some((principal) => principal.member.startsWith('user:'))) {
    fail('group_e_control_principal_plan_invalid');
  }
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  if (!/allow read, write: if false;/u.test(rules) || /allow\s+(?:read|write):\s*if\s+true/iu.test(rules)) {
    fail('group_e_control_rules_invalid');
  }
  return Object.freeze(structuredClone(value));
}

function deploymentDigest(value) {
  return sha256(JSON.stringify([1, 'group-e-control-deployment', ...DEPLOYED_FIELDS.slice(0, -1).map((field) => value[field])]));
}

function validateDeployedControlPlane(value, options = {}) {
  if (!exactFields(value, DEPLOYED_FIELDS) || value.status !== 'DEPLOYED' || value.projectId !== PROJECT_ID ||
      value.databaseId !== DATABASE_ID || value.location !== 'us-central1' || value.type !== 'FIRESTORE_NATIVE' ||
      value.edition !== 'STANDARD' || value.deletionProtection !== true || value.pitr !== 'ENABLED' ||
      value.ttl !== null || value.mobileWebRules !== 'deny-all' || value.rulesDigest !== expectedRulesDigest() ||
      value.iamPlanDigest !== canonicalIamPlan(loadControlPlanePlan()) ||
      typeof value.verifiedAt !== 'string' || !Number.isFinite(Date.parse(value.verifiedAt)) ||
      value.deploymentDigest !== deploymentDigest(value)) fail('group_e_control_deployment_invalid');
  if (options.now !== undefined && options.maxAgeMs !== undefined &&
      options.now - Date.parse(value.verifiedAt) > options.maxAgeMs) fail('group_e_control_deployment_stale');
  return Object.freeze(structuredClone(value));
}

function requireDeployedControlPlane(value, options = {}) {
  if (!value) fail('group_e_control_deployment_absent');
  return validateDeployedControlPlane(value, options);
}

function loadControlPlanePlan(file = PLAN_PATH) {
  return validateControlPlanePlan(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function publicProvisioningPlan() {
  const plan = loadControlPlanePlan();
  return Object.freeze({
    mode: 'plan',
    cloudOperations: 0,
    projectId: PROJECT_ID,
    database: plan.planned.database,
    rulesDigest: expectedRulesDigest(),
    iamCondition: IAM_CONDITION_METADATA,
    iamPlanDigest: canonicalIamPlan(plan),
    roles: plan.planned.roles,
    principals: plan.planned.principals,
    deployed: false
  });
}

module.exports = Object.freeze({
  DATABASE_ID,
  DATABASE_RESOURCE,
  DEPLOYED_FIELDS,
  FORBIDDEN_PERMISSIONS,
  IAM_CONDITION,
  IAM_CONDITION_DESCRIPTION,
  IAM_CONDITION_METADATA,
  IAM_CONDITION_TITLE,
  PERMISSIONS,
  PRINCIPALS,
  ROLE_IDS,
  PLAN_PATH,
  PROJECT_ID,
  RULES_PATH,
  canonicalIamPlan,
  deploymentDigest,
  expectedRulesDigest,
  loadControlPlanePlan,
  publicProvisioningPlan,
  requireDeployedControlPlane,
  validateControlPlanePlan,
  validateDeployedControlPlane
});
