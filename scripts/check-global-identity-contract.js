const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CANDIDATE_PATH = path.join(ROOT, 'tests/firebase/database.rules.global-identity.json');
const HARDENED_PATH = path.join(ROOT, 'tests/firebase/database.rules.hardened.json');
const NEW_RULE_PATHS = Object.freeze([
  'globalIdentityConfig',
  'accounts',
  'trainerHandles',
  'privateProfiles',
  'publicProfiles',
  'publicLists',
  'unlistedShareOwners',
  'unlistedShares',
  'legacyUsernameIndex'
]);
const GATED_DATA_PATHS = NEW_RULE_PATHS.filter(key => key !== 'globalIdentityConfig');
const WRITE_GATE = "root.child('globalIdentityConfig').child('writesEnabled').val() === true";

function collectJavaScriptFiles(root) {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name);
    if (statSync(target).isDirectory()) return collectJavaScriptFiles(target);
    return target.endsWith('.js') ? [target] : [];
  });
}

const hardened = JSON.parse(readFileSync(HARDENED_PATH, 'utf8'));
const candidate = JSON.parse(readFileSync(CANDIDATE_PATH, 'utf8'));
const existingOnly = structuredClone(candidate);
for (const key of NEW_RULE_PATHS) delete existingOnly.rules[key];

assert.deepEqual(existingOnly, hardened, 'Global identity candidate changed an existing hardened rule');
assert.equal(candidate.rules['.read'], 'auth != null', 'Commit 4 must preserve the transitional authenticated root read');

for (const key of GATED_DATA_PATHS) {
  const serializedRules = JSON.stringify(candidate.rules[key]);
  assert.ok(serializedRules.includes(WRITE_GATE), `${key} must gate writes on writesEnabled === true`);
}

const clientFiles = [path.join(ROOT, 'index.html'), ...collectJavaScriptFiles(path.join(ROOT, 'js'))];
const clientSource = clientFiles.map(file => readFileSync(file, 'utf8')).join('\n');
for (const key of NEW_RULE_PATHS) {
  const quotedPath = new RegExp(`[\\\"'\\\`]${key}(?:/|[\\\"'\\\`])`);
  assert.equal(quotedPath.test(clientSource), false, `Production client references inactive path ${key}`);
}

console.log('Global identity static contract checks passed.');
console.log('Existing hardened rules preserved; all new data writes gated; production client references none of the inactive paths.');
