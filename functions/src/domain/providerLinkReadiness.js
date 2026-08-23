'use strict';

const { requireAppCheck, requireAuth } = require('./authorization');
const { TrustedOperationError, fail } = require('./errors');
const { fingerprint } = require('./fingerprints');
const { boundedPayload, exactFields, requestId } = require('./validation');

const PROVIDER_LINK_GATE = 'e2_provider_link';
const MAX_LINK_PAYLOAD = 1024;
const VERIFIED_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;
const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const PROVIDERS = Object.freeze({
  google: 'google.com',
  discord: 'discord.com'
});
const ADMITTED_PROVIDERS = Object.freeze(['google']);

function requireRecentAuth(context, timestamp) {
  const authTimeSeconds = Number(context?.auth?.token?.auth_time);
  const authTime = Number.isFinite(authTimeSeconds) ? authTimeSeconds * 1000 : 0;
  if (!authTime || authTime > timestamp || timestamp - authTime > RECENT_AUTH_MAX_AGE_MS) {
    fail('permission_denied', 'auth/recent_auth_required');
  }
}

function verifiedEvidence(value, { callerUid, provider, timestamp }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('permission_denied', 'provider/evidence_missing');
  }
  if (Object.keys(value).sort().join(',') !== 'providerId,subject,uid,verifiedAt') {
    fail('permission_denied', 'provider/evidence_schema_invalid');
  }
  if (value.uid !== callerUid || value.providerId !== PROVIDERS[provider]) {
    fail('permission_denied', 'provider/evidence_binding_invalid');
  }
  if (typeof value.subject !== 'string' || value.subject.length < 1 || value.subject.length > 512) {
    fail('permission_denied', 'provider/evidence_subject_invalid');
  }
  if (!Number.isSafeInteger(value.verifiedAt) || value.verifiedAt > timestamp || timestamp - value.verifiedAt > VERIFIED_EVIDENCE_MAX_AGE_MS) {
    fail('permission_denied', 'provider/evidence_stale');
  }
  return value;
}

function providerSubjectKey(provider, subjectHash) {
  if (!Object.hasOwn(PROVIDERS, provider) || !/^[a-f0-9]{64}$/.test(subjectHash)) {
    fail('internal', 'provider/subject_key_invalid');
  }
  return `v1_${provider}_${subjectHash}`;
}

function createProviderLinkOperations({ adapter, now = Date.now, subjectHasher }) {
  if (!adapter) throw new TypeError('adapter required');
  if (typeof subjectHasher !== 'function') throw new TypeError('keyed subjectHasher required');

  async function linkVerifiedProvider(data, context) {
    const callerUid = requireAuth(context);
    requireAppCheck(context, true);
    exactFields(data, ['provider', 'requestId', 'schemaVersion']);
    boundedPayload(data, MAX_LINK_PAYLOAD);
    if (data.schemaVersion !== 1 || !Object.hasOwn(PROVIDERS, data.provider)) {
      fail('invalid_argument', 'provider/unsupported');
    }
    if (!ADMITTED_PROVIDERS.includes(data.provider)) fail('unavailable', 'provider/not_admitted');
    const id = requestId(data.requestId);
    const timestamp = now();
    requireRecentAuth(context, timestamp);
    await adapter.assertOperationEnabled(PROVIDER_LINK_GATE);
    let rawEvidence;
    try {
      rawEvidence = await adapter.getVerifiedProviderEvidence({ callerUid, providerId: PROVIDERS[data.provider] });
    } catch (error) {
      if (error instanceof TrustedOperationError) throw error;
      fail('internal', 'provider/evidence_unavailable');
    }
    const evidence = verifiedEvidence(rawEvidence, { callerUid, provider: data.provider, timestamp });
    let subjectHash;
    try {
      subjectHash = subjectHasher(PROVIDERS[data.provider], evidence.subject);
    } catch {
      fail('internal', 'provider/subject_key_failed');
    }
    const subjectKey = providerSubjectKey(data.provider, subjectHash);
    const requestFingerprint = fingerprint({
      operation: 'linkVerifiedProvider',
      provider: data.provider,
      providerSubjectKey: subjectKey,
      schemaVersion: 1
    });
    let linked;
    try {
      linked = await adapter.linkVerifiedProviderAtomic({
        callerUid,
        provider: data.provider,
        providerId: PROVIDERS[data.provider],
        providerSubjectKey: subjectKey,
        requestId: id,
        requestFingerprint,
        timestamp
      });
    } catch (error) {
      if (error instanceof TrustedOperationError) throw error;
      fail('internal', 'provider/transaction_failed');
    }
    return Object.freeze({
      ok: true,
      operation: 'linkVerifiedProvider',
      provider: data.provider,
      status: linked.status,
      replay: linked.replay === true
    });
  }

  return Object.freeze({ linkVerifiedProvider });
}

module.exports = {
  ADMITTED_PROVIDERS,
  MAX_LINK_PAYLOAD,
  PROVIDERS,
  PROVIDER_LINK_GATE,
  RECENT_AUTH_MAX_AGE_MS,
  VERIFIED_EVIDENCE_MAX_AGE_MS,
  createProviderLinkOperations,
  providerSubjectKey
};
