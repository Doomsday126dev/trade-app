'use strict';

const { GoogleAuth } = require('google-auth-library');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { createAuthorityInvoker, createGatewayOperation, loadGatewayConfiguration } = require('./gatewayCore');

const configuration = loadGatewayConfiguration();
const auth = new GoogleAuth();
const invokeAuthority = createAuthorityInvoker(configuration, {
  async getOidcToken(audience) {
    const client = await auth.getIdTokenClient(audience);
    return client.idTokenProvider.fetchIdToken(audience);
  }
});

function callable(operation, consumeAppCheckToken) {
  const handler = createGatewayOperation(operation, configuration, { invokeAuthority });
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
        GATEWAY_NOT_ENABLED: ['unavailable', 'Service unavailable']
      };
      const [code, message] = mapping[error?.code] || ['unavailable', 'Service unavailable'];
      throw new HttpsError(code, message);
    }
  });
}

exports.readE1AccountFoundation = callable('readAccountFoundation', false);
exports.reserveE1TrainerHandle = callable('reserveTrainerHandle', true);
