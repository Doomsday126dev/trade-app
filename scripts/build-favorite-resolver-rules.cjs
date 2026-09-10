'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const BASELINE = '3866f6b56d855d1fb6793ec5ce122770003dd136e5f92c1bb08f0135524da3f7';
const OUTPUT = path.join(__dirname, '../tests/firebase/database.rules.favorite-resolver.json');
function build(input) {
  if (createHash('sha256').update(JSON.stringify(input)).digest('hex') !== BASELINE) throw new Error('Unreviewed live Rules baseline');
  const result = structuredClone(input), rules = result.rules;
  const favorite = rules.accountSync.$uid.favorites.$entityId;
  const wholeNext = 'newData.parent().parent().parent().parent()';
  const handle = "newData.child('values').child('displayName').val()";
  const slotsFor = (base, uid, target) => Array.from({ length: 100 }, (_, slot) => `${base}.child('favoriteSlots').child(${uid}).child('s${slot}').val() === ${target}`).join(' || ');
  const active = "newData.child('deleted').val() === false";
  const caller = "root.child('authIndex').child($uid).child('username').val()";
  const identity = ["$entityId !== $uid", "!root.child('legacyIdentityFences').child($uid).exists()",
    "!root.child('legacyIdentityFences').child($entityId).exists()",
    `root.child('users').child(${caller}).child('authUid').val() === $uid`,
    `root.child('users').child(${handle}).child('authUid').val() === $entityId`,
    `root.child('authIndex').child($entityId).child('username').val() === ${handle}`,
    `(${slotsFor(wholeNext, '$uid', '$entityId')})`].join(' && ');
  // Existing entity/schema/tombstone contracts stay intact. Only new active
  // generations require current reciprocal identity and a capacity-index entry.
  favorite['.validate'] = `(${favorite['.validate']}) && ((!(${active}) || (data.exists() && data.child('deleted').val() === false)) || (${identity}))`;
  const rootNext = 'newData.parent().parent().parent()';
  const canonical = target => `${rootNext}.child('accountSync').child($uid).child('favorites').child(${target})`;
  const old = canonical('data.val()'), next = canonical('newData.val()');
  const oldReleased = `(!data.exists() || newData.val() === data.val() || !${old}.exists() || ${old}.child('deleted').val() === true || (${slotsFor(rootNext, '$uid', 'data.val()')}))`;
  rules.favoriteSlots = {
    '$uid': {
      '.read': 'auth != null && auth.uid === $uid',
      '$slot': {
        '.write': `auth != null && auth.uid === $uid && $slot.matches(/^s(0|[1-9][0-9]?)$/) && ${oldReleased} && (!newData.exists() || !root.child('legacyIdentityFences').child($uid).exists())`,
        '.validate': `newData.isString() && newData.val().length > 0 && newData.val().length <= 128 && ${next}.exists() && ${next}.child('deleted').val() === false`
      }
    }
  };
  return result;
}
if (require.main === module) {
  const output = `${JSON.stringify(build(JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/firebase/database.rules.legacy-identity-fences.json'), 'utf8'))), null, 2)}\n`;
  if (process.argv.includes('--check')) { if (fs.readFileSync(OUTPUT, 'utf8') !== output) throw new Error('Favorite resolver Rules differ from reviewed build'); }
  else fs.writeFileSync(OUTPUT, output);
}
module.exports = { BASELINE, OUTPUT, build };
