'use strict';
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getFirestore } = require('firebase-admin/firestore');
const { Storage } = require('@google-cloud/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createResetService } = require('./reset');
const { createAdapter } = require('./adapter');
const { createJournal, createGcsStore } = require('./journal');
const { createPasswordUpdater } = require('./password');
const PROJECT = 'trade-list-a4297';
const RUNTIME = `legacy-pin-reset-runtime@${PROJECT}.iam.gserviceaccount.com`;
const secret = defineSecret('legacy-pin-reset-hmac');
let service;
function configuredService() {
  if (process.env.LEGACY_PIN_RESET_ENABLED !== 'true' || process.env.GCLOUD_PROJECT !== PROJECT ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_DATABASE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(process.env.LEGACY_PIN_RESET_OWNER_UID || '')) throw new HttpsError('unavailable', 'reset/not-enabled');
  if (!service) {
    const app = initializeApp({ projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` }, 'legacy-pin-reset');
    service = createResetService({ ownerUid: process.env.LEGACY_PIN_RESET_OWNER_UID, hmacKey: secret.value(),
      adapter: createAdapter({ database: getDatabase(app), auth: getAuth(app), firestore: getFirestore(app, 'phase-e-identity'),
        updatePassword: createPasswordUpdater({ projectId: PROJECT, credential: applicationDefault() }) }),
      journal: createJournal(createGcsStore(new Storage({ projectId: PROJECT, retryOptions: { autoRetry: false } }).bucket(`${PROJECT}-legacy-pin-reset-journal`))) });
  }
  return service;
}
exports.ownerResetLegacyPin = onCall({ region: 'us-central1', serviceAccount: RUNTIME, secrets: [secret],
  enforceAppCheck: true, consumeAppCheckToken: true, maxInstances: 1, concurrency: 1, timeoutSeconds: 120, memory: '256MiB',
  cors: ['https://doomsday126dev.github.io'], invoker: 'public'
}, async request => {
  try {
    if (!request.auth || !request.app || request.app.alreadyConsumed) throw new HttpsError('unauthenticated', 'reset/unauthenticated');
    const reset = configuredService();
    const bearer = request.rawRequest.headers.authorization;
    if (typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) throw new HttpsError('unauthenticated', 'reset/unauthenticated');
    const token = await getAuth(require('firebase-admin/app').getApp('legacy-pin-reset')).verifyIdToken(bearer.slice(7), true);
    if (token.uid !== request.auth.uid) throw new HttpsError('unauthenticated', 'reset/unauthenticated');
    return await reset.run({ uid: token.uid, authTime: token.auth_time, appVerified: true }, request.data);
  } catch (error) {
    // Do not log SDK errors, request bodies, token material, or replacement PINs.
    const candidate = error.code?.startsWith('reset/') ? error.code : error.message;
    const code = typeof candidate === 'string' && /^reset\/[a-z-]+$/.test(candidate) ? candidate : 'reset/unavailable';
    throw new HttpsError('failed-precondition', code);
  }
});
