'use strict';

function emulatorBypassAllowed(env = process.env) {
  return env.FUNCTIONS_EMULATOR === 'true' &&
    String(env.GCLOUD_PROJECT || '').startsWith('demo-') &&
    env.TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS === 'true';
}

function appCheckRequired(env = process.env) {
  return !emulatorBypassAllowed(env);
}

function firebaseAdminOptions(env = process.env) {
  const projectId = String(env.GCLOUD_PROJECT || '');
  const databaseHost = String(env.FIREBASE_DATABASE_EMULATOR_HOST || '');
  if (env.FUNCTIONS_EMULATOR !== 'true') return Object.freeze({});
  if (!projectId.startsWith('demo-') || !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(databaseHost)) {
    throw new Error('trusted/emulator-database-target-invalid');
  }
  return Object.freeze({
    projectId,
    databaseURL: `http://${databaseHost}?ns=${projectId}-default-rtdb`
  });
}

module.exports = { appCheckRequired, emulatorBypassAllowed, firebaseAdminOptions };
