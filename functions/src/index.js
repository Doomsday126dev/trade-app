'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { createFirebaseTrustedAdapter } = require('./adapters/firebaseTrustedAdapter');
const { createRedactedLogger } = require('./domain/redactedLogging');
const { appCheckRequired, firebaseAdminOptions } = require('./domain/runtimePolicy');
const { createTrustedOperations } = require('./domain/trustedOperations');

const createReserveTrainerHandle = require('./callable/reserveTrainerHandle');
const createClaimTrainerTagLabel = require('./callable/claimTrainerTagLabel');
const createVerifyTrainerHistory = require('./callable/verifyTrainerHistory');
const createSetApprovedViewer = require('./callable/setApprovedViewer');

initializeApp(firebaseAdminOptions(process.env));
const adapter = createFirebaseTrustedAdapter({ database: getDatabase() });
const operations = createTrustedOperations({ adapter });
const logger = createRedactedLogger();
const HTTPS_CODES = Object.freeze({
  unauthenticated: 'unauthenticated',
  app_check_required: 'failed-precondition',
  invalid_argument: 'invalid-argument',
  permission_denied: 'permission-denied',
  conflict: 'already-exists',
  stale_state: 'failed-precondition',
  replay_mismatch: 'failed-precondition',
  payload_too_large: 'invalid-argument',
  unavailable: 'unavailable',
  internal: 'internal'
});
const makePublicError = ({ code, reason }) => new HttpsError(HTTPS_CODES[code] || 'internal', reason);
const options = Object.freeze({ region: 'us-east1', enforceAppCheck: appCheckRequired(process.env), consumeAppCheckToken: true, timeoutSeconds: 30, memory: '256MiB', maxInstances: 5 });

exports.reserveTrainerHandle = onCall(options, createReserveTrainerHandle({ operations, logger, makePublicError }));
exports.claimTrainerTagLabel = onCall(options, createClaimTrainerTagLabel({ operations, logger, makePublicError }));
exports.verifyTrainerHistory = onCall(options, createVerifyTrainerHistory({ operations, logger, makePublicError }));
exports.setApprovedViewer = onCall(options, createSetApprovedViewer({ operations, logger, makePublicError }));
