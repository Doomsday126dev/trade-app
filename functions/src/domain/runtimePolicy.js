'use strict';

function emulatorBypassAllowed(env = process.env) {
  return env.FUNCTIONS_EMULATOR === 'true' &&
    String(env.GCLOUD_PROJECT || '').startsWith('demo-') &&
    env.TRUSTED_CALLABLE_EMULATOR_APP_CHECK_BYPASS === 'true';
}

function appCheckRequired(env = process.env) {
  return !emulatorBypassAllowed(env);
}

function runtimeConfiguration(env = process.env) {
  const emulator = env.FUNCTIONS_EMULATOR === 'true';
  const environment = String(env.APP_ENVIRONMENT || (emulator ? 'emulator' : ''));
  const projectId = String(env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || '');
  const region = String(env.FUNCTIONS_REGION || (emulator ? 'us-east1' : ''));
  const databaseHost = String(env.FIREBASE_DATABASE_EMULATOR_HOST || '');
  let databaseURL = String(env.DATABASE_URL || '');
  if (!['emulator', 'staging', 'production'].includes(environment)) throw new Error('trusted/environment-required');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('trusted/project-id-required');
  if (!/^[a-z]+-[a-z]+\d+$/.test(region)) throw new Error('trusted/functions-region-required');
  if (emulator) {
    if (environment !== 'emulator' || !projectId.startsWith('demo-') || !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(databaseHost)) {
      throw new Error('trusted/emulator-database-target-invalid');
    }
    const namespace = String(env.FIREBASE_DATABASE_NAMESPACE || `${projectId}-default-rtdb`);
    if (!/^[a-z0-9-]+$/.test(namespace) || !namespace.startsWith(projectId)) throw new Error('trusted/emulator-namespace-invalid');
    databaseURL ||= `http://${databaseHost}?ns=${namespace}`;
  } else {
    let parsed;
    try { parsed = new URL(databaseURL); } catch { throw new Error('trusted/database-url-required'); }
    if (parsed.protocol !== 'https:' || !(parsed.hostname.endsWith('.firebaseio.com') || parsed.hostname.endsWith('.firebasedatabase.app'))) throw new Error('trusted/database-url-invalid');
    if (environment === 'staging' && (!projectId.includes('-staging-') || !parsed.hostname.startsWith(`${projectId}-`))) {
      throw new Error('trusted/staging-target-mismatch');
    }
  }
  return Object.freeze({ environment, projectId, region, databaseURL });
}

function firebaseAdminOptions(env = process.env) {
  const config = runtimeConfiguration(env);
  return Object.freeze({ projectId: config.projectId, databaseURL: config.databaseURL });
}

function functionsRegion(env = process.env) {
  return runtimeConfiguration(env).region;
}

module.exports = { appCheckRequired, emulatorBypassAllowed, firebaseAdminOptions, functionsRegion, runtimeConfiguration };
