'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, atomicWrite, exact } = require('../../scripts/run-provider-identity-live-window.cjs');
const [directory, mode] = process.argv.slice(2);
const storeFile = path.join(directory, 'store.json');
const load = () => JSON.parse(fs.readFileSync(storeFile, 'utf8'));
const save = (value) => atomicWrite(storeFile, value);
const die = () => process.kill(process.pid, 'SIGKILL');
let injected = false;
const adapter = {
  async readDocument(target) { return load().documents[target] ?? null; },
  async readDocuments(targets) {
    const store = load();
    return Object.fromEntries(targets.map((target) => [target, store.documents[target] ?? null]));
  },
  async readRtdb() { return { value: load().rtdbFreeze }; },
  async verify(record) {
    for (const [target, expected] of Object.entries(record.expectedResult || {})) {
      if (!exact(load().documents[target], expected)) throw new Error('existing_changed');
    }
  },
  async createOnly(record, documents) {
    if (!injected && mode === 'before-commit') die();
    const store = load();
    const key = record.targetPaths.join('|');
    store.sends[key] = (store.sends[key] || 0) + 1;
    if (!injected && mode === 'transport-no-commit') { save(store); die(); }
    if (Object.keys(documents).some((target) => Object.hasOwn(store.documents, target))) {
      throw Object.assign(new Error('already_exists'), { status: 409 });
    }
    Object.assign(store.documents, documents);
    save(store);
    if (!injected && mode === 'lost-response') {
      injected = true;
      throw Object.assign(new Error('response_lost'), { code: 'transport_ambiguous' });
    }
  }
};
async function readProduction() {
  const store = load();
  const current = { ...store.source, accounts: {}, trainerHandles: {}, operationRequests: {}, identityMigrations: {} };
  for (const [target, value] of Object.entries(store.documents)) {
    const root = target.split('/')[0];
    if (root === 'accounts' || root === 'trainerHandles') current[root][target.split('/')[1]] = value;
    if (root === 'operationRequests' || root === 'identityMigrations') current[root][target] = value;
  }
  return current;
}
const args = ['--action', 'apply-manifest', '--manifest', path.join(directory, 'manifest.json'),
  '--snapshot', path.join(directory, 'snapshot.json'),
  '--progress-file', path.join(directory, 'progress.json'), '--completion-file', path.join(directory, 'completion.json'),
  '--approval-file', path.join(directory, 'approval.txt'), '--confirm-project', 'trade-list-a4297',
  '--confirm-firestore-database', 'phase-e-identity', '--confirm-rtdb-url',
  'https://trade-list-a4297-default-rtdb.firebaseio.com', '--execute'];
run(args, {
  adapter, readProduction, env: { GCLOUD_ACCESS_TOKEN: 'synthetic-only' },
  afterCommitBeforeCheckpoint: async () => { if (mode === 'after-commit' || mode === 'lost-response') die(); },
  afterCheckpoint: async ({ record }) => {
    if (['after-checkpoint', 'between-records'].includes(mode) && record.operation !== 'VERIFY_ONLY') die();
  }
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
