#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'tests/firebase/database.rules.sec02-production.json');
const target = path.join(root, 'tests/firebase/database.rules.permanent-legacy-allocation.json');
const policyFile = path.join(root, 'functions/production/permanent-legacy-allocation-policy.json');
const rules = structuredClone(JSON.parse(fs.readFileSync(source, 'utf8')));
const r = rules.rules;
const admin = "auth != null && root.child('admins').child(auth.uid).val() === true";
const exists = 'data.exists() && newData.exists()';
// No release switch: this is the permanent candidate, independent of the temporary fence.
r.loginDirectory.$username['.write'] = `${admin} && ${exists} && newData.child('authUid').val() === data.child('authUid').val() && newData.child('authReady').val() === data.child('authReady').val()`;
r.users.$username['.write'] = `(${r.users.$username['.write']}) && ${exists} && newData.child('authUid').val() === data.child('authUid').val()`;
r.authIndex.$uid['.write'] = `(${r.authIndex.$uid['.write']}) && ${exists} && newData.child('username').val() === data.child('username').val()`;
r.requests.$id['.write'] = `(${r.requests.$id['.write']}) && (!newData.exists() || newData.child('status').val() !== 'approved')`;
const rendered = `${JSON.stringify(rules, null, 2)}\n`;
const definition = {
  schemaVersion: 1, model: 'permanent-legacy-allocation-closure', normalizationVersion: 1,
  candidateRulesSha256: crypto.createHash('sha256').update(rendered).digest('hex'),
  guardedPaths: ['users/{username}', 'loginDirectory/{username}', 'authIndex/{uid}', 'requests/{requestId}:approved'],
  privilegedWriterClosureRequired: true,
  legacyCreationMayResume: false
};
const policy = { ...definition, policyDigest: crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex') };
const renderedPolicy = `${JSON.stringify(policy, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== rendered || fs.readFileSync(policyFile, 'utf8') !== renderedPolicy) {
    throw new Error('permanent-legacy-allocation-candidate-stale');
  }
} else {
  fs.writeFileSync(target, rendered);
  fs.writeFileSync(policyFile, renderedPolicy);
}
console.log(policy.policyDigest);
