'use strict';
const { normalizeHandle, fold } = require('../../functions/e1-authority-service/handleNormalization');
const { digest } = require('../../functions/e1-authority-service/durableProviderAdmission');

const REQUIRED_SOURCES = Object.freeze(['users', 'loginDirectory', 'authIndex', 'aliases', 'canonicalClaims']);
function inventoryNames(sourceSets) {
  if (!sourceSets || Object.keys(sourceSets).sort().join('\n') !== [...REQUIRED_SOURCES].sort().join('\n')) {
    throw new Error('protection/inventory-incomplete');
  }
  const names = new Map();
  for (const source of REQUIRED_SOURCES) {
    const set = sourceSets[source];
    if (!set || Object.keys(set).sort().join('\n') !== 'complete\nnames' || set.complete !== true ||
        !Array.isArray(set.names) || set.names.some(name => typeof name !== 'string' || !name)) {
      throw new Error('protection/inventory-incomplete');
    }
    for (const name of set.names) {
      const kind = source === 'aliases' ? 'alias' : 'canonical';
      if (!names.has(name) || kind === 'canonical') names.set(name, { name, kind });
    }
  }
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function protectionPlan({ sourceSets, claims = {}, accounts = {}, completed = {} }) {
  const names = inventoryNames(sourceSets);
  if (!claims || !accounts || !completed ||
      typeof claims !== 'object' || typeof accounts !== 'object' ||
      typeof completed !== 'object') throw new Error('protection/input-invalid');
  const byKey = new Map();
  const rejected = [];
  for (const entry of names) {
    if (!entry || typeof entry.name !== 'string' || !entry.name ||
        !['canonical', 'alias'].includes(entry.kind)) throw new Error('protection/name-invalid');
    let normalized;
    try { normalized = normalizeHandle(entry.name); }
    catch { rejected.push({ nameDigest: digest(entry.name), foldedDigest: digest(fold(entry.name)) }); continue; }
    const group = byKey.get(normalized.handleKey) || { handleKey: normalized.handleKey, normalizedTrainerName: normalized.normalized, names: [] };
    group.names.push({ name: entry.name, kind: entry.kind });
    byKey.set(normalized.handleKey, group);
  }
  const entries = [...byKey.values()].sort((a, b) => a.handleKey.localeCompare(b.handleKey));
  const actions = [], conflicts = [], expectedClaims = {};
  for (const entry of entries) {
    entry.names.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    const existing = claims[entry.handleKey] || completed[entry.handleKey];
    // Deliberately omit normalizedTrainerName: Firestore directory orderBy skips
    // holds, while point reads still see them as occupied.
    const expected = { schemaVersion: 1, state: 'held', sourceNamesDigest: digest(entry.names), generationId: null };
    if (claims[entry.handleKey] && completed[entry.handleKey]) {
      conflicts.push(entry.handleKey); continue;
    }
    if (existing) {
      // Preserve valid canonical claims exactly. A conflicting claim or mismatched hold
      // requires review; retries never overwrite it.
      const canonical = entry.names.some(name => name.kind === 'canonical' &&
        normalizeHandle(name.name).display === existing.canonicalTrainerName);
      const account = accounts[existing.uid];
      if (existing.state === 'active' && typeof existing.uid === 'string' && canonical &&
          new Set(entry.names.map(name => name.name)).size === 1 &&
          existing.normalizedTrainerName === entry.normalizedTrainerName &&
          account?.uid === existing.uid && account.handleKey === entry.handleKey &&
          account.normalizedTrainerName === entry.normalizedTrainerName &&
          account.canonicalTrainerName === existing.canonicalTrainerName) {
        expectedClaims[entry.handleKey] = existing; continue;
      }
      if (JSON.stringify(existing) === JSON.stringify(expected)) {
        expectedClaims[entry.handleKey] = existing; continue;
      }
      conflicts.push(entry.handleKey); continue;
    }
    actions.push({ path: `trainerHandles/${entry.handleKey}`, precondition: 'must-not-exist', document: expected });
    expectedClaims[entry.handleKey] = expected;
  }
  const coveredHandleKeys = entries.map(entry => entry.handleKey);
  const claimKeys = coveredHandleKeys.filter(key => expectedClaims[key]?.state === 'active');
  const heldKeys = coveredHandleKeys.filter(key => expectedClaims[key]?.state === 'held');
  const normalizedSets = Object.fromEntries(REQUIRED_SOURCES.map(source => [source,
    [...new Set(sourceSets[source].names)].sort()]));
  return Object.freeze({ schemaVersion: 1, complete: conflicts.length === 0,
    inventoryEvidenceDigest: digest({ sourceSets: normalizedSets, accounts }),
    coveredHandleKeysDigest: digest(coveredHandleKeys),
    protectedClaimsDigest: digest(expectedClaims), coveredHandleCount: coveredHandleKeys.length,
    heldHandleCount: heldKeys.length, rejectedLegacyNames: rejected.sort((a,b) => a.nameDigest.localeCompare(b.nameDigest)),
    normalizedCollisions: entries.filter(entry => entry.names.length > 1).map(entry => entry.handleKey),
    actions, conflicts, expectedClaims });
}

function verifyProtection(plan, actualClaims) {
  if (!plan?.complete || !actualClaims || typeof actualClaims !== 'object') return false;
  const actualKeys = Object.keys(actualClaims).sort();
  // Caller must supply exact readback for the inventory keys, including claim contents.
  const ordered = Object.fromEntries(actualKeys.map(key => [key, actualClaims[key]]));
  return actualKeys.length === plan.coveredHandleCount && digest(actualKeys) === plan.coveredHandleKeysDigest &&
    digest(ordered) === plan.protectedClaimsDigest;
}
module.exports = Object.freeze({ REQUIRED_SOURCES, inventoryNames, protectionPlan, verifyProtection });
