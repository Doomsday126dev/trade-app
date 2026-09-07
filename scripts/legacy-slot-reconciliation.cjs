'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createEvidenceReader, manifestFromState, projectAuth, readIdentityInventory } = require('./lib/legacy-slot-reconciliation-evidence.cjs');
const { fingerprint, validateManifest, reconcileLegacySlot } = require('./lib/legacy-slot-reconciliation.cjs');
const { createReconciliationTransport } = require('./lib/legacy-slot-reconciliation-transport.cjs');
const { createProductionReads, PROJECT } = require('./lib/legacy-slot-reconciliation-production.cjs');
const { createBoundaryReader } = require('./lib/legacy-slot-reconciliation-boundary.cjs');
const { authEmail } = require('../functions/legacy-pin-reset/reset');
const { ROOT } = require('../functions/legacy-pin-reset/identity-fence');
function check(condition, code = 'repair/cli-invalid') { if (!condition) throw Object.assign(new Error(code), { code }); }
function parseArgs(argv) {
  const [mode, ...args] = argv; check(['plan', 'apply', 'verify'].includes(mode));
  const options = { mode };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; check(['--username', '--manifest', '--approve-manifest', '--resume'].includes(flag) && !Object.hasOwn(options, flag.slice(2)));
    if (flag === '--resume') options.resume = true;
    else { check(args[i + 1] && !args[i + 1].startsWith('--')); options[flag.slice(2)] = args[++i]; }
  }
  check(/^[A-Za-z0-9 _-]{1,64}$/.test(options.username || '') && options.username.trim() === options.username && options.username !== 'Doomsday126');
  check(path.isAbsolute(options.manifest || '') && options.manifest.endsWith('.private.json'));
  check(mode === 'apply' ? /^[a-f0-9]{64}$/.test(options['approve-manifest'] || '') : !options.resume && !options['approve-manifest']);
  return options;
}
function privateFile(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readManifest(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd); check(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 128 * 1024, 'repair/private-manifest-required');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
async function discoverTarget(username, reads) {
  const inventory = await readIdentityInventory(reads.readDatabase), user = inventory.users[username];
  check(user && /^[A-Za-z0-9_-]{1,128}$/.test(user.authUid || '') && Number.isSafeInteger(user.authVersion) && user.authVersion >= 2, 'repair/target-not-qualified');
  const page = await reads.auth.listUsers(1000); check(!page.pageToken);
  const base = username.toLowerCase().replace(/[^a-z0-9]/g, '_'), pattern = new RegExp(`^${base}(?:_v[1-9][0-9]*)?@pogotrades\\.nyc$`, 'i');
  const matches = page.users.filter(account => pattern.test(account.email || ''));
  check(matches.length === 2 && matches.some(account => account.uid === user.authUid && account.email === authEmail(username, user.authVersion)), 'repair/target-not-qualified');
  const obsolete = matches.filter(account => account.uid !== user.authUid); check(obsolete.length === 1);
  return { username, authoritativeUid: user.authUid, obsoleteUid: obsolete[0].uid };
}
async function run(options, reads = createProductionReads()) {
  let manifest, target;
  if (options.mode === 'plan') target = await discoverTarget(options.username, reads);
  else {
    manifest = readManifest(options.manifest); validateManifest(manifest);
    check(manifest.projectId === PROJECT && manifest.username === options.username, 'repair/explicit-target-mismatch');
    if (options.mode === 'apply') check(fingerprint(manifest) === options['approve-manifest'], 'repair/manifest-approval-mismatch');
    target = manifest;
  }
  const readBoundary = createBoundaryReader(reads);
  const readState = createEvidenceReader({ ...target, ...reads, readBoundary });
  if (options.mode === 'plan') {
    manifest = manifestFromState({ projectId: PROJECT, username: options.username, state: await readState() });
    privateFile(options.manifest, manifest);
    return { phase: 'planned', manifestFingerprint: fingerprint(manifest), mutations: [] };
  }
  const recordProgress = async value => {
    const filename = `${options.manifest}.progress`;
    const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const stat = fs.fstatSync(fd); check(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size < 1024 * 1024, 'repair/private-journal-required');
      fs.writeFileSync(fd, `${JSON.stringify({ observedAt: new Date().toISOString(), ...value })}\n`); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  };
  // Verify mode has no write-capable adapter, even if an unexpected core branch is reached.
  const transport = options.mode === 'apply' ? createReconciliationTransport({ manifest, credential: reads.credential,
    readObsoleteAuth: async uid => projectAuth(await reads.auth.getUser(uid)), readFence: uid => reads.readDatabase(`${ROOT}/${uid}`),
    readIndex: async uid => (await reads.readDatabase(`authIndex/${uid}`)).value }) : {};
  return reconcileLegacySlot(manifest, { readState, recordProgress, ...transport }, { resume: options.resume, verifyOnly: options.mode === 'verify' });
}
if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.code || 'repair/stopped-inspect-private-state'); process.exitCode = 1; });
}
module.exports = { parseArgs, privateFile, readManifest, discoverTarget, run };
