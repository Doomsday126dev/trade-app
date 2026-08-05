'use strict';

const { fail } = require('./errors');

function requireAuth(context) {
  const uid = context?.auth?.uid;
  if (typeof uid !== 'string' || !uid) fail('unauthenticated', 'auth/required');
  return uid;
}

function requireAppCheck(context, required) {
  if (required && !context?.app) fail('app_check_required', 'app_check/required');
}

function requireOwner(callerUid, ownerUid) {
  if (callerUid !== ownerUid) fail('permission_denied', 'authorization/owner_required');
}

function requireAdmin(registryValue) {
  if (registryValue !== true) fail('permission_denied', 'authorization/admin_required');
}

module.exports = { requireAdmin, requireAppCheck, requireAuth, requireOwner };
