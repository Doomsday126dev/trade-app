'use strict';

const crypto = require('node:crypto');

const AUTH_CONTRACT_VERSION = 1;
const ROLES = Object.freeze({
  HANDLE_RESERVATION: 'handle-reservation',
  FOUNDATION_REPAIR: 'foundation-repair',
  CONFIG_READ: 'config-read'
});
const RUNTIME_UIDS = Object.freeze({
  [ROLES.HANDLE_RESERVATION]: 'e1-runtime-handle-reservation',
  [ROLES.FOUNDATION_REPAIR]: 'e1-runtime-foundation-repair',
  [ROLES.CONFIG_READ]: 'e1-runtime-config-read'
});
const ENVIRONMENTS = new Set(['emulator', 'staging', 'production']);
const UID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const HANDLE_KEY_PATTERN = /^v1_[0-9a-f]{2,512}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

function assertEnvironment(environment) {
  if (!ENVIRONMENTS.has(environment)) throw new Error('e1/environment-invalid');
  return environment;
}

function assertSubjectUid(subjectUid) {
  if (!UID_PATTERN.test(subjectUid || '')) throw new Error('e1/subject-uid-invalid');
  return subjectUid;
}

function assertHandleKey(handleKey) {
  if (!HANDLE_KEY_PATTERN.test(handleKey || '')) throw new Error('e1/handle-key-invalid');
  return handleKey;
}

function assertOperationId(operationId) {
  if (!OPERATION_ID_PATTERN.test(operationId || '')) throw new Error('e1/operation-id-invalid');
  return operationId;
}

function encodeHandleKey(normalizedHandle) {
  const normalized = String(normalizedHandle || '');
  if (!normalized) throw new Error('e1/normalized-handle-required');
  return `v1_${Buffer.from(normalized, 'utf8').toString('hex')}`;
}

function createE1AuthOverride({ role, environment, subjectUid, handleKey, operationId } = {}) {
  if (!Object.values(ROLES).includes(role)) throw new Error('e1/role-invalid');
  const token = {
    e1v: AUTH_CONTRACT_VERSION,
    e1Role: role,
    e1Environment: assertEnvironment(environment)
  };
  if (role !== ROLES.CONFIG_READ) {
    token.e1SubjectUid = assertSubjectUid(subjectUid);
    token.e1HandleKey = assertHandleKey(handleKey);
  }
  if (role === ROLES.FOUNDATION_REPAIR) token.e1OperationId = assertOperationId(operationId);
  return Object.freeze({ uid: RUNTIME_UIDS[role], token: Object.freeze(token) });
}

function assertDatabaseTarget({ environment, projectId, databaseURL }) {
  assertEnvironment(environment);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '')) throw new Error('e1/project-id-invalid');
  let parsed;
  try { parsed = new URL(databaseURL); } catch { throw new Error('e1/database-url-invalid'); }
  if (environment === 'emulator') {
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('e1/emulator-target-invalid');
  } else {
    if (parsed.protocol !== 'https:' || !(parsed.hostname.endsWith('.firebaseio.com') || parsed.hostname.endsWith('.firebasedatabase.app'))) throw new Error('e1/cloud-database-url-invalid');
    if (environment === 'staging' && !projectId.includes('-staging-')) throw new Error('e1/staging-project-marker-required');
  }
  return Object.freeze({ environment, projectId, databaseURL: parsed.toString().replace(/\/$/, '') });
}

function createE1DatabaseSessionFactory({ initializeApp, getDatabase, deleteApp, credential, target }) {
  if (![initializeApp, getDatabase, deleteApp].every((value) => typeof value === 'function')) throw new TypeError('Firebase Admin factories required');
  const fixedTarget = assertDatabaseTarget(target);
  return async function openSession(scope) {
    const databaseAuthVariableOverride = createE1AuthOverride({ ...scope, environment: fixedTarget.environment });
    const scopeHash = crypto.createHash('sha256').update(JSON.stringify(databaseAuthVariableOverride)).digest('hex').slice(0, 16);
    const app = initializeApp({
      ...(credential ? { credential } : {}),
      projectId: fixedTarget.projectId,
      databaseURL: fixedTarget.databaseURL,
      databaseAuthVariableOverride
    }, `e1-${scope.role}-${scopeHash}-${crypto.randomBytes(4).toString('hex')}`);
    return Object.freeze({
      database: getDatabase(app),
      authOverride: databaseAuthVariableOverride,
      close: () => deleteApp(app)
    });
  };
}

module.exports = {
  AUTH_CONTRACT_VERSION,
  ROLES,
  RUNTIME_UIDS,
  assertDatabaseTarget,
  createE1AuthOverride,
  createE1DatabaseSessionFactory,
  encodeHandleKey
};
