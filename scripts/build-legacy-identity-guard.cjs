'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const BASELINE = 'b8bedced813bed8ac8fb947531317cc8eed0fa6955fcafd931be3bbb85e8913a';
const OUTPUT = path.join(__dirname, '../tests/firebase/database.rules.legacy-identity-guard.json');
function build(input) {
  const value = structuredClone(input);
  const hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  if (hash !== BASELINE) throw new Error('Unreviewed live Rules baseline');
  const rules = value.rules;
  const user = rules.users.$username;
  const index = rules.authIndex.$uid;
  const directory = rules.loginDirectory.$username;
  // Put preservation in .write, not .validate: deletions skip validation Rules.
  user['.write'] = `(${user['.write']}) && (!data.child('authUid').exists() || (newData.child('authUid').val() === data.child('authUid').val() && (!data.child('authEmail').exists() || newData.child('authEmail').val() === data.child('authEmail').val()) && (!data.child('authVersion').exists() || newData.child('authVersion').val() === data.child('authVersion').val()))) && (!newData.child('authUid').exists() || !root.child('authIndex').child(newData.child('authUid').val()).child('username').exists() || root.child('authIndex').child(newData.child('authUid').val()).child('username').val() === $username)`;
  index['.write'] = `(${index['.write']}) && (!data.child('username').exists() || newData.child('username').val() === data.child('username').val()) && newData.child('username').isString() && root.child('users').child(newData.child('username').val()).child('authUid').val() === $uid`;
  directory['.write'] = `(${directory['.write']}) && (!root.child('users').child($username).child('authUid').exists() || (newData.exists() && newData.child('authVersion').val() === root.child('users').child($username).child('authVersion').val() && (!newData.child('authEmail').exists() || newData.child('authEmail').val() === root.child('users').child($username).child('authEmail').val()) && (!newData.child('authUid').exists() || newData.child('authUid').val() === root.child('users').child($username).child('authUid').val())))`;
  return value;
}
if (require.main === module) {
  const source = process.argv[2];
  if (!source) throw new Error('Pass the exact read-only production Rules snapshot');
  fs.writeFileSync(OUTPUT, JSON.stringify(build(JSON.parse(fs.readFileSync(source, 'utf8'))), null, 2) + '\n');
  console.log('Generated bounded legacy identity Rules');
}
module.exports = { build, BASELINE, OUTPUT };
