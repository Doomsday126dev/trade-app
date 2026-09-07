'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const BASELINE = 'a42209aca30fee63c62b9f0494b823106e3c3677e1152b28a56b92fac212053e';
const OUTPUT = path.join(__dirname, '../tests/firebase/database.rules.legacy-identity-fences.json');
const IDENTITY_PATHS = ['users/$username', 'authIndex/$uid', 'loginDirectory/$username', 'admins/$uid'];
const CANONICAL_PATHS = ['meta', 'tradeEntries/$entityId', 'favorites/$entityId', 'tags/$entityId', 'migrations/$migrationId', 'recoveryCandidates/$candidateId'].map(p => `accountSync/$uid/${p}`);
function build(input) {
  if (createHash('sha256').update(JSON.stringify(input)).digest('hex') !== BASELINE) throw new Error('Unreviewed live Rules baseline');
  const result = structuredClone(input), rules = result.rules;
  const clear = uid => `!root.child('legacyIdentityFences').child(${uid}).exists()`;
  const optional = field => `(!${field}.exists() || ${clear(`${field}.val()`)})`;
  const append = (path, condition) => {
    const node = path.split('/').reduce((value, key) => value[key], rules);
    node['.write'] = `(${node['.write']}) && (${condition})`;
  };
  append('users/$username', [clear('auth.uid'), optional("data.child('authUid')"), optional("newData.child('authUid')")].join(' && '));
  append('authIndex/$uid', `${clear('auth.uid')} && ${clear('$uid')}`);
  append('loginDirectory/$username', [clear('auth.uid'), optional("root.child('users').child($username).child('authUid')"), optional("newData.child('authUid')")].join(' && '));
  append('admins/$uid', `${clear('auth.uid')} && ${clear('$uid')}`);
  // New UID-rooted records can revive canonical ownership during a repair.
  // Keep reads and edits to existing records under their unchanged validators.
  for (const path of CANONICAL_PATHS) append(path, `${clear('$uid')} || data.exists()`);
  rules.legacyIdentityFences = { '.read': false, '.write': false };
  return result;
}
if (require.main === module) {
  const args = process.argv.slice(2), check = args.includes('--check');
  if (args.filter(arg => arg !== '--check').length > 1) throw new Error('Pass at most one reviewed Rules snapshot');
  const source = args.find(arg => arg !== '--check') || path.join(__dirname, '../tests/firebase/database.rules.legacy-identity-guard.json');
  const output = `${JSON.stringify(build(JSON.parse(fs.readFileSync(source, 'utf8'))), null, 2)}\n`;
  if (check) {
    if (fs.readFileSync(OUTPUT, 'utf8') !== output) throw new Error('UID-fence Rules differ from the reviewed deterministic build');
  } else fs.writeFileSync(OUTPUT, output);
  console.log(check ? 'Verified bounded UID-fence Rules' : 'Generated bounded UID-fence Rules');
}
module.exports = { build, BASELINE, OUTPUT, IDENTITY_PATHS, CANONICAL_PATHS };
