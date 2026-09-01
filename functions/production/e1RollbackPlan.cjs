'use strict';

const { loadCompatibilityFloor, validateCompatibilityFloor } = require('./providerAccountCompatibilityFloor.cjs');

const DISABLED_GATES = Object.freeze({
  CLIENT_FOUNDATION_USE_ENABLED: false,
  GATEWAY_INVOCATION_ENABLED: false,
  READ_ACCOUNT_FOUNDATION_ENABLED: false,
  CREATE_PROVIDER_ACCOUNT_ENABLED: false,
  RESERVE_HANDLE_ENABLED: false,
  REPAIR_FOUNDATION_ENABLED: false,
  APPLY_MIGRATION_ENABLED: false,
  FREEZE_CONFLICT_ENABLED: false
});

const ORDERED_ROLLBACK = Object.freeze([
  'disable-client-foundation-use',
  'disable-gateway-invocation',
  'disable-reserve',
  'disable-repair',
  'disable-migration',
  'disable-freeze',
  'optionally-disable-authority-reads',
  'remove-gateway-run-invoker-for-emergency-containment'
]);

const POST_FIRST_PROVIDER_GATES = Object.freeze({
  ...DISABLED_GATES,
  CLIENT_FOUNDATION_USE_ENABLED: true,
  GATEWAY_INVOCATION_ENABLED: true,
  READ_ACCOUNT_FOUNDATION_ENABLED: true
});

const POST_FIRST_PROVIDER_ROLLBACK = Object.freeze([
  'hide-google-public-entry',
  'disable-provider-account-creation',
  'disable-provider-public-writes',
  'preserve-provider-account-compatibility',
  'preserve-provider-public-reads',
  'preserve-required-provider-subject-keys'
]);

function rollbackState(overrides = {}, options = {}) {
  const floor = validateCompatibilityFloor(options.compatibilityFloor || loadCompatibilityFloor());
  const baseline = floor.providerAccountsExist ? POST_FIRST_PROVIDER_GATES : DISABLED_GATES;
  const state = { ...baseline, ...overrides };
  if (Object.entries(state).some(([key, value]) => !Object.hasOwn(DISABLED_GATES, key) || typeof value !== 'boolean')) {
    throw new Error('e1/rollback-gate-invalid');
  }
  if (state.CREATE_PROVIDER_ACCOUNT_ENABLED ||
      state.RESERVE_HANDLE_ENABLED || state.REPAIR_FOUNDATION_ENABLED ||
      state.APPLY_MIGRATION_ENABLED || state.FREEZE_CONFLICT_ENABLED) {
    throw new Error('e1/rollback-not-contained');
  }
  if (floor.providerAccountsExist && (!state.CLIENT_FOUNDATION_USE_ENABLED || !state.GATEWAY_INVOCATION_ENABLED ||
      !state.READ_ACCOUNT_FOUNDATION_ENABLED)) throw new Error('e1/rollback-provider-compatibility-required');
  if (!floor.providerAccountsExist && (state.CLIENT_FOUNDATION_USE_ENABLED || state.GATEWAY_INVOCATION_ENABLED ||
      state.READ_ACCOUNT_FOUNDATION_ENABLED)) throw new Error('e1/rollback-not-contained');
  return Object.freeze({
    gates: Object.freeze(state),
    authorityRecordsDeleted: false,
    legacyUsernamePinEnabled: true,
    providerAccountCompatibilityRequired: floor.providerAccountsExist,
    providerSubjectKeysRetained: floor.providerAccountsExist,
    googlePublicEntryEnabled: false,
    providerAccountCreationEnabled: false,
    providerPublicReadSupport: floor.providerAccountsExist,
    providerPublicWriteSupport: false,
    orderedActions: floor.providerAccountsExist ? POST_FIRST_PROVIDER_ROLLBACK : ORDERED_ROLLBACK
  });
}

module.exports = Object.freeze({
  DISABLED_GATES, ORDERED_ROLLBACK, POST_FIRST_PROVIDER_GATES, POST_FIRST_PROVIDER_ROLLBACK, rollbackState
});
