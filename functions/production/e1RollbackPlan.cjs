'use strict';

const DISABLED_GATES = Object.freeze({
  CLIENT_FOUNDATION_USE_ENABLED: false,
  GATEWAY_INVOCATION_ENABLED: false,
  READ_ACCOUNT_FOUNDATION_ENABLED: false,
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

function rollbackState(overrides = {}) {
  const state = { ...DISABLED_GATES, ...overrides };
  if (Object.entries(state).some(([key, value]) => !Object.hasOwn(DISABLED_GATES, key) || typeof value !== 'boolean')) {
    throw new Error('e1/rollback-gate-invalid');
  }
  if (state.GATEWAY_INVOCATION_ENABLED || state.CLIENT_FOUNDATION_USE_ENABLED ||
      state.RESERVE_HANDLE_ENABLED || state.REPAIR_FOUNDATION_ENABLED ||
      state.APPLY_MIGRATION_ENABLED || state.FREEZE_CONFLICT_ENABLED) {
    throw new Error('e1/rollback-not-contained');
  }
  return Object.freeze({
    gates: Object.freeze(state),
    authorityRecordsDeleted: false,
    legacyUsernamePinEnabled: true,
    orderedActions: ORDERED_ROLLBACK
  });
}

module.exports = Object.freeze({ DISABLED_GATES, ORDERED_ROLLBACK, rollbackState });
