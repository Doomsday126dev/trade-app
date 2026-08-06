'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
const exported = [...source.matchAll(/exports\.([A-Za-z0-9_]+)\s*=/g)].map((match) => match[1]).sort();
assert.deepEqual(exported, ['claimTrainerTagLabel', 'mutateFavoriteTrainer', 'reserveTrainerHandle', 'setApprovedViewer', 'verifyTrainerHistory']);
assert.doesNotMatch(source, /renameTrainerHandle|deploy|serviceAccount|databaseURL/);

const adapter = require('../src/adapters/inMemoryTrustedAdapter').createInMemoryTrustedAdapter();
for (const forbidden of ['read', 'write', 'update', 'remove', 'set', 'mutatePath', 'bulk']) assert.equal(typeof adapter[forbidden], 'undefined');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(Object.keys(pkg.scripts).some((name) => /deploy|publish|postinstall/.test(name)), false);
assert.doesNotMatch(JSON.stringify(pkg), /trade-list-[a-z0-9-]+/i);
console.log('Trusted Functions contract check passed: 5 fixed callables, no generic adapter or deploy capability.');
