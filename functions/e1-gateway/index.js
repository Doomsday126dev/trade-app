'use strict';

const { GoogleAuth } = require('google-auth-library');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { createAuthorityInvoker, createGatewayOperation, loadGatewayConfiguration } = require('./gatewayCore');
const { createProductionGroupEControlStore } = require('./groupEControlStore');

const configuration = loadGatewayConfiguration();
const controlStore = configuration.groupE.enabled ? createProductionGroupEControlStore() : null;
const auth = new GoogleAuth();
const invokeAuthority = createAuthorityInvoker(configuration, {
  async getOidcToken(audience) {
    const client = await auth.getIdTokenClient(audience);
    return client.idTokenProvider.fetchIdToken(audience);
  }
});

function callable(operation, consumeAppCheckToken) {
  const handler = createGatewayOperation(operation, configuration, { invokeAuthority, controlStore });
  return onCall({
    region: configuration.region,
    enforceAppCheck: configuration.appCheckEnforcementMode === 'enforced',
    consumeAppCheckToken,
    serviceAccount: configuration.gatewayServiceAccount,
    maxInstances: 2,
    invoker: 'public'
  }, async (request) => {
    try { return await handler(request); }
    catch (error) {
      const mapping = {
        AUTH_REQUIRED: ['unauthenticated', 'Authentication required'],
        APP_CHECK_REQUIRED: ['unauthenticated', 'App Check required'],
        APP_CHECK_REPLAYED: ['permission-denied', 'App Check token already consumed'],
        REQUEST_INVALID: ['invalid-argument', 'Invalid request'],
        RATE_LIMITED: ['resource-exhausted', 'Too many requests'],
        NAMESPACE_NOT_CERTIFIED: ['failed-precondition', 'Account creation is not ready'],
        PROVIDER_IDENTITY_REQUIRED: ['permission-denied', 'Verified Google sign-in required'],
        ACCOUNT_EXISTS: ['already-exists', 'Account already exists'],
        HANDLE_CONFLICT: ['already-exists', 'Trainer handle is unavailable'],
        PROVIDER_CONFLICT: ['already-exists', 'Provider is already connected'],
        FOUNDATION_CONFLICT: ['failed-precondition', 'Account foundation conflict'],
        PUBLIC_IDENTITY_CONFLICT: ['failed-precondition', 'Public identity is unavailable'],
        PUBLIC_SHARE_INVALID: ['failed-precondition', 'Public share is invalid'],
        PUBLIC_SHARE_UNAVAILABLE: ['unavailable', 'Public share is unavailable'],
        GROUP_E_ADMISSION_CONSUMED: ['already-exists', 'Admission already consumed'],
        GROUP_E_CAPABILITY_EXPIRED: ['permission-denied', 'Admission expired'],
        GROUP_E_BOUNDARY_INVALID: ['permission-denied', 'Admission denied'],
        GROUP_E_OPERATION_DENIED: ['unavailable', 'Service unavailable'],
        GATEWAY_NOT_ENABLED: ['unavailable', 'Service unavailable']
      };
      const [code, message] = mapping[error?.code] || ['unavailable', 'Service unavailable'];
      throw new HttpsError(code, message, { code: String(error?.code || 'SERVICE_UNAVAILABLE') });
    }
  });
}

exports.readE1AccountFoundation = callable('readAccountFoundation', configuration.groupE.enabled);
exports.readE1ProviderPublicShare = callable('readProviderPublicShare', true);
exports.createE1ProviderAccountFoundation = callable('createProviderAccountFoundation', true);
exports.reserveE1TrainerHandle = callable('reserveTrainerHandle', true);
