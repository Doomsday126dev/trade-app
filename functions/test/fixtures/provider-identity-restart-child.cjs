'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runManifest, operationId } = require('../../production/providerIdentityWindow.cjs');
const { atomicWrite, loadProgress, writeProgress } = require('../../scripts/run-provider-identity-live-window.cjs');

const [manifestFile, storeFile, progressFile, mode = 'resume'] = process.argv.slice(2);

function exact(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function read(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }

async function main() {
  const manifest = read(manifestFile);
  const persisted = read(storeFile);
  const documents = new Map(Object.entries(persisted.documents || {}));
  const sends = { ...(persisted.sends || {}) };
  const saveStore = () => atomicWrite(storeFile, {
    schemaVersion: 1,
    documents: Object.fromEntries([...documents.entries()].sort(([left], [right]) => left.localeCompare(right))),
    sends
  });
  let ambiguousInjected = false;
  const adapter = {
    async readDocument(target) { return documents.has(target) ? structuredClone(documents.get(target)) : null; },
    async readDocuments(targets) {
      return Object.fromEntries(targets.map((target) =>
        [target, documents.has(target) ? structuredClone(documents.get(target)) : null]));
    },
    async verify(record) {
      for (const [target, value] of Object.entries(record.expectedResult || {})) {
        if (!exact(documents.get(target), value)) throw new Error('verify_existing_failed');
      }
    },
    async createOnly(record, values) {
      const id = operationId(manifest, record);
      sends[id] = (sends[id] || 0) + 1;
      if (Object.keys(values).some((target) => documents.has(target))) throw Object.assign(new Error('exists'), { status: 409 });
      for (const [target, value] of Object.entries(values)) documents.set(target, structuredClone(value));
      saveStore();
      if (mode === 'ambiguous' && !ambiguousInjected) {
        ambiguousInjected = true;
        throw Object.assign(new Error('response_lost'), { code: 'transport_ambiguous' });
      }
    }
  };
  const { progress } = loadProgress(progressFile, manifest);
  let committed = false;
  const result = await runManifest(manifest, adapter, {
    progress,
    checkpoint: async (value) => writeProgress(progressFile, manifest, value),
    afterCommitBeforeCheckpoint: async () => {
      committed = true;
      if (mode === 'after-commit' || mode === 'ambiguous') process.exit(81);
    },
    afterCheckpoint: async () => {
      if (mode === 'after-checkpoint' && committed) process.exit(82);
    }
  });
  saveStore();
  process.stdout.write(`${JSON.stringify({ completed: result.progress.size, expected: manifest.records.length,
    duplicateSends: Object.values(sends).filter((count) => count > 1).length })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
