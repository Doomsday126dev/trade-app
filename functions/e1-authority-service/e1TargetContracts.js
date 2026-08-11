'use strict';

const STAGING = Object.freeze({
  environment: 'staging',
  projectId: 'trainer-hub-staging-37ib4wct',
  projectNumber: '391359988648',
  databaseId: 'phase-e-identity',
  region: 'us-central1',
  serviceName: 'e1-identity-authority',
  runtimeServiceAccount: 'e1-identity-authority-runtime@trainer-hub-staging-37ib4wct.iam.gserviceaccount.com',
  rtdbDatabaseUrl: 'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com'
});

const PRODUCTION = Object.freeze({
  environment: 'production',
  projectId: 'trade-list-a4297',
  databaseId: 'phase-e-identity',
  region: 'us-central1',
  serviceName: 'e1-identity-authority',
  runtimeServiceAccount: 'e1-identity-authority-runtime@trade-list-a4297.iam.gserviceaccount.com',
  rtdbDatabaseUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com'
});

function fail() {
  const error = new Error('E1_CONFIGURATION_MISMATCH');
  error.code = 'E1_CONFIGURATION_MISMATCH';
  throw error;
}

function exactRtdbUrl(value, { allowSearch = false } = {}) {
  let parsed;
  try { parsed = new URL(value); } catch { fail(); }
  if (parsed.pathname !== '/' || (!allowSearch && parsed.search) || parsed.hash) fail();
  return parsed;
}

function validateTarget(configuration) {
  const environment = configuration.environment;
  if (!['staging', 'production', 'emulator'].includes(environment)) fail();
  if (!/^\d{1,20}$/.test(configuration.projectNumber || '')) fail();
  const parsed = exactRtdbUrl(configuration.rtdbDatabaseUrl, { allowSearch: environment === 'emulator' });

  if (environment === 'emulator') {
    if (!String(configuration.projectId || '').startsWith('demo-') || configuration.databaseId !== 'phase-e-identity' ||
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.protocol !== 'http:' ||
        (parsed.search && (parsed.searchParams.size !== 1 || parsed.searchParams.get('ns') !== `${configuration.projectId}-default-rtdb`)) ||
        configuration.region !== 'local' || configuration.serviceName !== 'e1-identity-authority-emulator' ||
        typeof configuration.runtimeServiceAccount !== 'string' || !configuration.runtimeServiceAccount.endsWith('@localhost')) fail();
    return Object.freeze({ ...configuration });
  }

  const expected = environment === 'staging' ? STAGING : PRODUCTION;
  for (const field of ['environment', 'projectId', 'databaseId', 'region', 'serviceName', 'runtimeServiceAccount', 'rtdbDatabaseUrl']) {
    if (configuration[field] !== expected[field]) fail();
  }
  if (environment === 'staging' && configuration.projectNumber !== STAGING.projectNumber) fail();
  if (environment === 'production' && (configuration.projectNumber === STAGING.projectNumber || parsed.hostname.includes('-staging-'))) fail();
  return Object.freeze({ ...configuration });
}

function validateRtdbTarget({ environment, projectId, databaseUrl }) {
  const parsed = exactRtdbUrl(databaseUrl, { allowSearch: environment === 'emulator' });
  if (environment === 'staging') {
    if (projectId !== STAGING.projectId || parsed.origin !== STAGING.rtdbDatabaseUrl) fail();
  } else if (environment === 'production') {
    if (projectId !== PRODUCTION.projectId || parsed.origin !== PRODUCTION.rtdbDatabaseUrl || parsed.hostname.includes('-staging-')) fail();
  } else if (environment === 'emulator') {
    if (!String(projectId || '').startsWith('demo-') || parsed.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        (parsed.search && (parsed.searchParams.size !== 1 || parsed.searchParams.get('ns') !== `${projectId}-default-rtdb`))) fail();
  } else {
    fail();
  }
  return parsed;
}

module.exports = Object.freeze({ PRODUCTION, STAGING, validateRtdbTarget, validateTarget });
