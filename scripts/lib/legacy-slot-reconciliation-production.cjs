'use strict';
const { execFileSync } = require('node:child_process');
const { fingerprint } = require('./legacy-slot-reconciliation.cjs');
const PROJECT = 'trade-list-a4297';
const DATABASE = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/phase-e-identity/documents`;
const AUTH_FIELDS = 'users(localId,email,disabled,createdAt,providerUserInfo(providerId,rawId,email,displayName,photoUrl,phoneNumber),tenantId,phoneNumber,customAttributes,mfaInfo),nextPageToken';
function check(condition, code = 'repair/production-read-invalid') { if (!condition) throw Object.assign(new Error(code), { code }); }
function gcloud(...args) {
  try { return execFileSync('/opt/homebrew/bin/gcloud', [...args, '--quiet'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }); }
  catch { throw Object.assign(new Error('repair/cloud-read-failed'), { code: 'repair/cloud-read-failed' }); }
}
function createCredential() {
  let expiresAt = 0, token;
  return { async getAccessToken() {
    if (Date.now() >= expiresAt) { token = gcloud('auth', 'print-access-token').trim(); check(token.length > 20); expiresAt = Date.now() + 5 * 60 * 1000; }
    return { access_token: token };
  } };
}
function decodeAuth(record) {
  check(record && typeof record.localId === 'string');
  const customClaims = record.customAttributes ? JSON.parse(record.customAttributes) : {};
  check(customClaims && typeof customClaims === 'object' && !Array.isArray(customClaims));
  return { uid: record.localId, email: record.email || null, disabled: record.disabled === true,
    metadata: { creationTime: new Date(Number(record.createdAt)).toUTCString() }, creationTimestampMillis: Number(record.createdAt),
    providerData: (record.providerUserInfo || []).map(p => ({ providerId: p.providerId, uid: p.rawId, email: p.email || null,
      displayName: p.displayName || null, photoURL: p.photoUrl || null, phoneNumber: p.phoneNumber || null })),
    tenantId: record.tenantId || null, phoneNumber: record.phoneNumber || null, customClaims, multiFactor: { enrolledFactors: record.mfaInfo || [] } };
}
function createProductionReads({ credential = createCredential(), fetchImpl = fetch } = {}) {
  async function api(url, { body, allow404 = false, etag = false } = {}) {
    const parsed = new URL(url), method = body === undefined ? 'GET' : 'POST';
    const allowed = parsed.origin === DATABASE || url.startsWith(FIRESTORE) ||
      url.startsWith(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`) ||
      url.startsWith(`https://storage.googleapis.com/storage/v1/b/${PROJECT}-legacy-pin-reset-journal/`);
    check(allowed && (method === 'GET' || parsed.pathname.endsWith('/accounts:lookup') || parsed.pathname.endsWith(':runQuery')), 'repair/read-only-scope');
    const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${(await credential.getAccessToken()).access_token}`, 'X-Goog-User-Project': PROJECT,
        'Content-Type': 'application/json', ...(etag ? { 'X-Firebase-ETag': 'true' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 404 && allow404) { await response.body?.cancel(); return { value: null, etag: null }; }
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`repair/read-http-${response.status}`), { code: `repair/read-http-${response.status}` }); }
    return { value: await response.json(), etag: response.headers.get('etag')?.replace(/^"(null_etag)"$/, '$1') || null };
  }
  const readDatabase = (path, { shallow = false } = {}) => {
    check(typeof path === 'string' && path.length > 0 && !path.split('/').some(p => !p || p === '.' || p === '..' || /[.#$\[\]]/.test(p)));
    const url = new URL(`${DATABASE}/${path.split('/').map(encodeURIComponent).join('/')}.json`);
    if (shallow) url.searchParams.set('shallow', 'true');
    return api(url.href, { etag: !shallow });
  };
  const auth = {
    async listUsers(limit = 1000) {
      check(limit === 1000);
      const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?${new URLSearchParams({ maxResults: '1000', fields: AUTH_FIELDS })}`;
      const result = (await api(url)).value;
      return { users: (result.users || []).map(decodeAuth), pageToken: result.nextPageToken };
    },
    async getUser(uid) {
      check(/^[A-Za-z0-9_-]{1,128}$/.test(uid));
      const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup?${new URLSearchParams({ fields: AUTH_FIELDS.replace(',nextPageToken', '') })}`;
      const result = (await api(url, { body: { localId: [uid] } })).value;
      check(result.users?.length === 1 && result.users[0].localId === uid, 'repair/auth-identity-missing');
      return decodeAuth(result.users[0]);
    }
  };
  const allowedPath = path => /^(?:accounts|trainerHandles|identityConflicts|identityMigrations|operationRequests)\/[A-Za-z0-9_-]{1,300}(?:\/(?:providers|events|operations|requests))?$/.test(path);
  const firestore = {
    doc(path) {
      check(allowedPath(path) && path.split('/').length === 2, 'repair/firestore-read-scope');
      return { get: async () => ({ exists: (await api(`${FIRESTORE}/${path}?mask.fieldPaths=__name__`, { allow404: true })).value !== null }) };
    },
    collection(path) {
      check(allowedPath(path) && path.split('/').length === 3 || ['providerSubjects', 'trainerHandles'].includes(path), 'repair/firestore-read-scope');
      let filter, limit;
      const query = {
        where(field, operator, uid) {
          check(['providerSubjects', 'trainerHandles'].includes(path) && field === 'uid' && operator === '==' && /^[A-Za-z0-9_-]{1,128}$/.test(uid));
          filter = { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } }; return query;
        },
        limit(count) { check(count === 1); limit = count; return query; },
        async get() {
          check(limit === 1 && (path.includes('/') || filter));
          const parts = path.split('/'), collectionId = parts.pop(), parent = parts.length ? `/${parts.join('/')}` : '';
          const result = (await api(`${FIRESTORE}${parent}:runQuery`, { body: { structuredQuery: { from: [{ collectionId }],
            select: { fields: [{ fieldPath: '__name__' }] }, ...(filter ? { where: filter } : {}), limit } } })).value;
          check(Array.isArray(result)); return { empty: !result.some(entry => entry.document) };
        }
      }; return query;
    }
  };
  return { readDatabase, auth, firestore, credential,
    readRules: async () => (await api(`${DATABASE}/.settings/rules.json`)).value,
    async readJournal() {
      const object = encodeURIComponent('legacy-pin-reset/v1/ledger.json');
      const url = `https://storage.googleapis.com/storage/v1/b/${PROJECT}-legacy-pin-reset-journal/o/${object}`;
      const meta = (await api(url)).value; check(/^[0-9]+$/.test(meta.generation) && Number(meta.size) <= 2 * 1024 * 1024);
      const ledger = (await api(`${url}?alt=media&generation=${meta.generation}`)).value;
      check(ledger.schemaVersion === 1 && Array.isArray(ledger.records) && ledger.records.length <= 1000 &&
        ledger.records.every(r => ['pending', 'ambiguous', 'aborted', 'completed'].includes(r.status)));
      return { generation: meta.generation, fingerprint: fingerprint(ledger), count: ledger.records.length,
        pendingResetCount: ledger.records.filter(r => ['pending', 'ambiguous'].includes(r.status)).length };
    }
  };
}
module.exports = { PROJECT, DATABASE, FIRESTORE, AUTH_FIELDS, decodeAuth, createCredential, gcloud, createProductionReads };
