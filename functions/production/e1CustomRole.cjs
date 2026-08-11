'use strict';

const PERMISSIONS = Object.freeze([
  'datastore.databases.get',
  'datastore.databases.getMetadata',
  'datastore.entities.create',
  'datastore.entities.get',
  'datastore.entities.update'
]);

const OPERATION_PERMISSIONS = Object.freeze({
  readiness: Object.freeze(['datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.get']),
  readAccountFoundation: Object.freeze(['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update']),
  reserveTrainerHandle: Object.freeze(['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update']),
  repairAccountFoundation: Object.freeze(['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update']),
  applyMigrationManifest: Object.freeze(['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update']),
  freezeIdentityConflict: Object.freeze(['datastore.entities.create', 'datastore.entities.get', 'datastore.entities.update'])
});

const EXCLUDED_PERMISSIONS = Object.freeze([
  'datastore.entities.delete',
  'datastore.entities.list',
  'datastore.databases.create',
  'datastore.databases.delete',
  'datastore.databases.update',
  'resourcemanager.projects.getIamPolicy',
  'resourcemanager.projects.setIamPolicy',
  'firebaserules.releases.create',
  'firebasedatabase.instances.get',
  'run.routes.invoke'
]);

function verifyPermissionInventory(permissions = PERMISSIONS) {
  const normalized = [...new Set(permissions)].sort();
  if (normalized.join('\n') !== [...PERMISSIONS].sort().join('\n') || EXCLUDED_PERMISSIONS.some((permission) => normalized.includes(permission))) {
    throw new Error('e1/production-role-permission-drift');
  }
  for (const required of Object.values(OPERATION_PERMISSIONS).flat()) {
    if (!normalized.includes(required)) throw new Error('e1/production-role-permission-missing');
  }
  return Object.freeze({ valid: true, permissions: Object.freeze(normalized) });
}

module.exports = Object.freeze({ EXCLUDED_PERMISSIONS, OPERATION_PERMISSIONS, PERMISSIONS, verifyPermissionInventory });
