#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const freezePath = path.join(root, 'tests/firebase/database.rules.legacy-provisioning-freeze.json');
const providerPath = path.join(root, 'tests/firebase/database.rules.provider-public-projection.json');
const targetPath = path.join(root, 'tests/firebase/database.rules.provider-identity-window.json');
const check = process.argv.includes('--check');

const freeze = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
const provider = JSON.parse(fs.readFileSync(providerPath, 'utf8'));
const combined = structuredClone(freeze);
combined.rules.trainerShares = structuredClone(provider.rules.trainerShares);

if (combined.rules['.read'] !== false || combined.rules.trainerShares['.read'] !== undefined ||
    combined.rules.trainerShares.$ownerUid['.read'] !== true ||
    !String(combined.rules.trainerShares.$ownerUid['.write']).includes('auth.uid === $ownerUid') ||
    !combined.rules.accountSync || !combined.rules.legacyProvisioningFreeze) {
  throw new Error('combined Rules invariant failed');
}
const rendered = `${JSON.stringify(combined, null, 2)}\n`;
const digest = crypto.createHash('sha256').update(rendered).digest('hex');
if (check) {
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== rendered) {
    throw new Error('Provider identity window candidate Rules are stale');
  }
  console.log(`provider identity window Rules ${digest} verified`);
} else {
  fs.writeFileSync(targetPath, rendered);
  console.log(`wrote provider identity window Rules ${digest}`);
}
