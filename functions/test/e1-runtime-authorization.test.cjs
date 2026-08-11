'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createE1AuthOverride, createE1DatabaseSessionFactory, encodeHandleKey, ROLES, RUNTIME_UIDS } = require('../src/domain/e1RuntimeAuthorization');

test('runtime claims are minimal, role-specific, and operation scoped', () => {
  const handleKey = encodeHandleKey('trainer one');
  const reservation = createE1AuthOverride({ role: ROLES.HANDLE_RESERVATION, environment: 'staging', subjectUid: 'subject_uid_001', handleKey });
  assert.deepEqual(reservation, {
    uid: RUNTIME_UIDS[ROLES.HANDLE_RESERVATION],
    token: { e1v: 1, e1Role: 'handle-reservation', e1Environment: 'staging', e1SubjectUid: 'subject_uid_001', e1HandleKey: handleKey }
  });
  const repair = createE1AuthOverride({ role: ROLES.FOUNDATION_REPAIR, environment: 'staging', subjectUid: 'subject_uid_001', handleKey, operationId: 'repair-operation-000001' });
  assert.equal(repair.token.e1OperationId, 'repair-operation-000001');
  assert.deepEqual(createE1AuthOverride({ role: ROLES.CONFIG_READ, environment: 'staging' }).token, { e1v: 1, e1Role: 'config-read', e1Environment: 'staging' });
});

test('invalid roles targets and incomplete operation scopes fail closed', () => {
  assert.throws(() => createE1AuthOverride({ role: 'admin', environment: 'staging' }), /role-invalid/);
  assert.throws(() => createE1AuthOverride({ role: ROLES.HANDLE_RESERVATION, environment: 'staging', subjectUid: 'short', handleKey: 'bad' }), /subject-uid-invalid/);
  assert.throws(() => createE1AuthOverride({ role: ROLES.FOUNDATION_REPAIR, environment: 'staging', subjectUid: 'subject_uid_001', handleKey: encodeHandleKey('one') }), /operation-id-invalid/);
  assert.throws(() => createE1DatabaseSessionFactory({ initializeApp() {}, getDatabase() {}, deleteApp() {}, target: { environment: 'staging', projectId: 'production-project', databaseURL: 'https://production-project.firebaseio.com' } }), /staging-project-marker-required/);
});

test('session factory injects databaseAuthVariableOverride without exposing a generic database singleton', async () => {
  const calls = [];
  const factory = createE1DatabaseSessionFactory({
    initializeApp(options, name) { calls.push({ options, name }); return { name }; },
    getDatabase(app) { return { app }; },
    async deleteApp(app) { calls.push({ deleted: app.name }); },
    credential: { kind: 'test' },
    target: { environment: 'emulator', projectId: 'demo-e1-runtime', databaseURL: 'http://127.0.0.1:9800?ns=demo-e1-runtime-default-rtdb' }
  });
  const session = await factory({ role: ROLES.CONFIG_READ });
  assert.equal(calls[0].options.databaseAuthVariableOverride.token.e1Role, 'config-read');
  assert.equal(calls[0].options.projectId, 'demo-e1-runtime');
  await session.close();
  assert.match(calls[1].deleted, /^e1-config-read-/);
});
