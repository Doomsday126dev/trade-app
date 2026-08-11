'use strict';

const { ROLES } = require('../domain/e1RuntimeAuthorization');

function value(snapshot) {
  return snapshot?.val?.() ?? null;
}

function accountRecord(input) {
  return Object.freeze({
    schemaVersion: 1,
    trainerName: input.trainerName,
    normalizedTrainerName: input.normalizedTrainerName,
    handleKey: input.handleKey,
    status: 'active',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  });
}

function handleRecord(input) {
  return Object.freeze({
    schemaVersion: 1,
    uid: input.subjectUid,
    trainerName: input.trainerName,
    normalizedTrainerName: input.normalizedTrainerName,
    status: 'active',
    claimedAt: input.createdAt,
    updatedAt: input.updatedAt
  });
}

function createFirebaseDurableAuthAdapter({ openSession }) {
  if (typeof openSession !== 'function') throw new TypeError('E.1 session factory required');

  async function withSession(scope, callback) {
    const session = await openSession(scope);
    try { return await callback(session.database); } finally { await session.close(); }
  }

  async function readConfiguration() {
    return withSession({ role: ROLES.CONFIG_READ }, async (database) => value(await database.ref('durableAuthConfig').get()));
  }

  async function reserveTrainerHandle(input) {
    return withSession({
      role: ROLES.HANDLE_RESERVATION,
      subjectUid: input.subjectUid,
      handleKey: input.handleKey
    }, async (database) => {
      const [config, authIndex, account, handle] = await Promise.all([
        database.ref('durableAuthConfig/handleReservationEnabled').get(),
        database.ref(`authIndex/${input.subjectUid}`).get(),
        database.ref(`accounts/${input.subjectUid}`).get(),
        database.ref(`trainerHandles/${input.handleKey}`).get()
      ]);
      if (value(config) !== true) throw new Error('e1/handle-reservation-disabled');
      const username = value(authIndex)?.username;
      if (!username) throw new Error('e1/source-identity-missing');
      const [user, loginDirectory] = await Promise.all([
        database.ref(`users/${username}`).get(),
        database.ref(`loginDirectory/${username}`).get()
      ]);
      if (value(user)?.authUid !== input.subjectUid || !value(loginDirectory)) throw new Error('e1/source-identity-inconsistent');
      const existingAccount = value(account);
      const existingHandle = value(handle);
      if (existingAccount || existingHandle) {
        if (existingAccount?.handleKey === input.handleKey && existingHandle?.uid === input.subjectUid) return Object.freeze({ status: 'idempotent' });
        throw new Error('e1/foundation-conflict');
      }
      const updates = {
        [`accounts/${input.subjectUid}`]: accountRecord(input),
        [`trainerHandles/${input.handleKey}`]: handleRecord(input)
      };
      await database.ref().update(updates);
      return Object.freeze({ status: 'reserved' });
    });
  }

  async function repairAccountFoundation(input) {
    return withSession({
      role: ROLES.FOUNDATION_REPAIR,
      subjectUid: input.subjectUid,
      handleKey: input.handleKey,
      operationId: input.operationId
    }, async (database) => {
      const [enabled, authIndex] = await Promise.all([
        database.ref('durableAuthConfig/foundationRepairEnabled').get(),
        database.ref(`authIndex/${input.subjectUid}`).get()
      ]);
      if (value(enabled) !== true) throw new Error('e1/foundation-repair-disabled');
      const username = value(authIndex)?.username;
      if (!username || value(await database.ref(`users/${username}`).get())?.authUid !== input.subjectUid) throw new Error('e1/source-identity-inconsistent');
      await database.ref().update({
        [`accounts/${input.subjectUid}`]: accountRecord(input),
        [`trainerHandles/${input.handleKey}`]: handleRecord(input),
        [`identityMigrations/${input.subjectUid}/operations/${input.operationId}`]: {
          schemaVersion: 1,
          kind: 'foundation-repair',
          status: 'complete',
          uid: input.subjectUid,
          handleKey: input.handleKey,
          createdAt: input.updatedAt
        }
      });
      return Object.freeze({ status: 'repaired' });
    });
  }

  return Object.freeze({ readConfiguration, reserveTrainerHandle, repairAccountFoundation });
}

module.exports = { createFirebaseDurableAuthAdapter };
