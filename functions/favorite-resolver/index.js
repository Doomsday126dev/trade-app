'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { getDatabase } = require('firebase-admin/database');
const { Storage } = require('@google-cloud/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { CONTRACT } = require('./contract');
const { createIdentityReader, createIdentityResolver } = require('./identity');
const { createGcsQuotaStore, createQuota } = require('./quota');
const { createHandler } = require('./handler');
const PROJECT = 'trade-list-a4297';
const APP_ID = '1:1053781218847:web:378b312470943152d9a72a';
const RUNTIME = `favorite-resolver-runtime@${PROJECT}.iam.gserviceaccount.com`;
const ORIGINS = Object.freeze(['https://doomsday126dev.github.io']);
let handler;
function enabled() {
  return process.env.GCLOUD_PROJECT === PROJECT && process.env.FAVORITE_RESOLVER_ENABLED === 'true' &&
    process.env.FAVORITE_RESOLVER_IDENTITY_BOUNDARY === CONTRACT &&
    ['canary', 'all'].includes(process.env.FAVORITE_RESOLVER_COHORT) &&
    !['FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'].some(key => process.env[key]);
}
function configuredHandler() {
  if (!handler) {
    const app = initializeApp({ projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` }, 'favorite-resolver');
    const auth = getAuth(app), appCheck = getAppCheck(app);
    const quota = createQuota(createGcsQuotaStore(new Storage({ projectId: PROJECT, retryOptions: { autoRetry: false } }).bucket(`${PROJECT}-favorite-resolver-quota`)));
    handler = createHandler({ enabled, origins: ORIGINS, quota, resolve: createIdentityResolver(createIdentityReader(getDatabase(app))),
      verifyAuth: async token => {
        const caller = await auth.verifyIdToken(token, true);
        if (caller.firebase?.tenant) throw new Error('unsupported tenant');
        if (process.env.FAVORITE_RESOLVER_COHORT !== 'all') {
          const canaries = (process.env.FAVORITE_RESOLVER_CANARY_UIDS || '').split(',').filter(Boolean);
          if (canaries.length > 4 || !canaries.includes(caller.uid)) throw new Error('outside canary');
        }
        return caller;
      },
      verifyAppCheck: async token => { const result = await appCheck.verifyToken(token, { consume: true }); return result.appId === APP_ID && result.alreadyConsumed === false; }
    });
  }
  return handler;
}
exports.resolveLegacyFavoriteIdentities = onRequest({ region: 'us-central1', serviceAccount: RUNTIME,
  invoker: 'public', cors: false, maxInstances: 2, concurrency: 8, timeoutSeconds: 30, memory: '256MiB'
}, (req, res) => configuredHandler()(req, res));
