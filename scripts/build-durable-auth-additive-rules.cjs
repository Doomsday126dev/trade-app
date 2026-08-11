'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASE_PATH = path.join(ROOT, 'tests/firebase/database.rules.narrow-read.json');
const OUTPUT_PATH = path.join(ROOT, 'tests/firebase/database.rules.durable-auth.json');

const runtime = (role, extra = '') => `auth != null && auth.uid === 'e1-runtime-${role}' && auth.token.e1v === 1 && auth.token.e1Role === '${role}' && auth.token.e1Environment === root.child('durableAuthConfig').child('environment').val()${extra}`;
const handle = runtime('handle-reservation', " && auth.token.e1SubjectUid === $uid && auth.token.e1HandleKey === newData.child('handleKey').val() && root.child('durableAuthConfig').child('handleReservationEnabled').val() === true");
const repair = runtime('foundation-repair', " && auth.token.e1SubjectUid === $uid && auth.token.e1HandleKey === newData.child('handleKey').val() && root.child('durableAuthConfig').child('foundationRepairEnabled').val() === true");
const handleReadUid = runtime('handle-reservation', " && auth.token.e1SubjectUid === $uid");
const repairReadUid = runtime('foundation-repair', " && auth.token.e1SubjectUid === $uid");
const admin = "auth != null && root.child('admins').child(auth.uid).val() === true";

function build() {
  const candidate = JSON.parse(fs.readFileSync(BASE_PATH, 'utf8'));
  const rules = candidate.rules;
  rules.authIndex.$uid['.read'] = `auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).val() === true || (${handleReadUid}) || (${repairReadUid}))`;
  rules.users.$username['.read'] = `auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('users').child($username).child('authUid').val() === auth.uid || ((${runtime('handle-reservation')}) && root.child('users').child($username).child('authUid').val() === auth.token.e1SubjectUid) || ((${runtime('foundation-repair')}) && root.child('users').child($username).child('authUid').val() === auth.token.e1SubjectUid))`;
  rules.durableAuthConfig = {
    '.read': `${admin} || (${runtime('config-read')})`,
    '.write': "auth != null && auth.uid === 'e1-offline-configuration-operator' && auth.token.e1v === 1 && auth.token.e1Role === 'configuration-operator' && auth.token.e1Environment === newData.child('environment').val()",
    '.validate': "newData.hasChildren(['schemaVersion','environment','clientFoundationEnabled','handleReservationEnabled','foundationRepairEnabled','updatedAt']) && newData.child('schemaVersion').val() === 1 && (newData.child('environment').val() === 'emulator' || newData.child('environment').val() === 'staging' || newData.child('environment').val() === 'production') && newData.child('clientFoundationEnabled').isBoolean() && newData.child('handleReservationEnabled').isBoolean() && newData.child('foundationRepairEnabled').isBoolean() && newData.child('updatedAt').isNumber()",
    clientFoundationEnabled: { '.read': true, '.validate': 'newData.isBoolean()' },
    handleReservationEnabled: { '.read': `${admin} || (${runtime('handle-reservation')})`, '.validate': 'newData.isBoolean()' },
    foundationRepairEnabled: { '.read': `${admin} || (${runtime('foundation-repair')})`, '.validate': 'newData.isBoolean()' },
    environment: { '.read': `${admin} || (${runtime('handle-reservation')}) || (${runtime('foundation-repair')})`, '.validate': "newData.val() === 'emulator' || newData.val() === 'staging' || newData.val() === 'production'" },
    schemaVersion: { '.validate': 'newData.val() === 1' },
    updatedAt: { '.validate': 'newData.isNumber()' },
    '$other': { '.validate': false }
  };
  rules.accounts = {
    '$uid': {
      '.read': `auth != null && ((auth.uid === $uid && root.child('durableAuthConfig').child('clientFoundationEnabled').val() === true) || root.child('admins').child(auth.uid).val() === true || (${handleReadUid}) || (${repairReadUid}))`,
      '.write': `(${handle}) || (${repair})`,
      '.validate': "newData.exists() && newData.hasChildren(['schemaVersion','trainerName','normalizedTrainerName','handleKey','status','createdAt','updatedAt']) && newData.child('schemaVersion').val() === 1 && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('normalizedTrainerName').isString() && newData.child('normalizedTrainerName').val().length > 0 && newData.child('normalizedTrainerName').val().length <= 64 && newData.child('handleKey').isString() && newData.child('handleKey').val() === auth.token.e1HandleKey && newData.child('status').val() === 'active' && newData.child('createdAt').isNumber() && newData.child('updatedAt').isNumber() && newData.child('updatedAt').val() >= newData.child('createdAt').val() && (!data.exists() || (newData.child('createdAt').val() === data.child('createdAt').val() && newData.child('handleKey').val() === data.child('handleKey').val()))",
      '$other': { '.validate': "$other === 'schemaVersion' || $other === 'trainerName' || $other === 'normalizedTrainerName' || $other === 'handleKey' || $other === 'status' || $other === 'createdAt' || $other === 'updatedAt'" }
    }
  };
  rules.trainerHandles = {
    '$handleKey': {
      '.read': `${admin} || ((${runtime('handle-reservation')}) && auth.token.e1HandleKey === $handleKey) || ((${runtime('foundation-repair')}) && auth.token.e1HandleKey === $handleKey)`,
      '.write': `((${runtime('handle-reservation')}) && auth.token.e1HandleKey === $handleKey && newData.child('uid').val() === auth.token.e1SubjectUid && root.child('durableAuthConfig').child('handleReservationEnabled').val() === true) || ((${runtime('foundation-repair')}) && auth.token.e1HandleKey === $handleKey && newData.child('uid').val() === auth.token.e1SubjectUid && root.child('durableAuthConfig').child('foundationRepairEnabled').val() === true)`,
      '.validate': "newData.exists() && newData.hasChildren(['schemaVersion','uid','trainerName','normalizedTrainerName','status','claimedAt','updatedAt']) && newData.child('schemaVersion').val() === 1 && newData.child('uid').isString() && newData.child('uid').val() === auth.token.e1SubjectUid && newData.child('trainerName').isString() && newData.child('trainerName').val().length > 0 && newData.child('trainerName').val().length <= 64 && newData.child('normalizedTrainerName').isString() && newData.child('normalizedTrainerName').val().length > 0 && newData.child('normalizedTrainerName').val().length <= 64 && newData.child('status').val() === 'active' && newData.child('claimedAt').isNumber() && newData.child('updatedAt').isNumber() && newData.child('updatedAt').val() >= newData.child('claimedAt').val() && (!data.exists() || (newData.child('uid').val() === data.child('uid').val() && newData.child('claimedAt').val() === data.child('claimedAt').val()))",
      '$other': { '.validate': "$other === 'schemaVersion' || $other === 'uid' || $other === 'trainerName' || $other === 'normalizedTrainerName' || $other === 'status' || $other === 'claimedAt' || $other === 'updatedAt'" }
    }
  };
  rules.identityMigrations = {
    '$uid': {
      '.read': `auth != null && (root.child('admins').child(auth.uid).val() === true || (${repairReadUid}))`,
      operations: {
        '$operationId': {
          '.write': `(${runtime('foundation-repair')}) && auth.token.e1SubjectUid === $uid && auth.token.e1OperationId === $operationId && root.child('durableAuthConfig').child('foundationRepairEnabled').val() === true`,
          '.validate': "newData.exists() && (!data.exists() || newData.val() === data.val()) && newData.hasChildren(['schemaVersion','kind','status','uid','handleKey','createdAt']) && newData.child('schemaVersion').val() === 1 && newData.child('kind').val() === 'foundation-repair' && newData.child('status').val() === 'complete' && newData.child('uid').val() === $uid && newData.child('handleKey').val() === auth.token.e1HandleKey && newData.child('createdAt').isNumber()",
          '$other': { '.validate': "$other === 'schemaVersion' || $other === 'kind' || $other === 'status' || $other === 'uid' || $other === 'handleKey' || $other === 'createdAt'" }
        }
      },
      '$other': { '.validate': "$other === 'operations'" }
    }
  };
  return candidate;
}

const serialized = `${JSON.stringify(build(), null, 2)}\n`;
if (process.argv.includes('--write')) fs.writeFileSync(OUTPUT_PATH, serialized);
else if (!fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== serialized) {
  console.error('Durable Auth Rules candidate is stale. Run this script with --write.');
  process.exitCode = 1;
} else console.log('Durable Auth Rules candidate matches the live rollback baseline plus E.1 additions.');

module.exports = { build };
