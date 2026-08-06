#!/usr/bin/env node
'use strict';

const readline = require('node:readline/promises');
const readiness = require('../staging/stagingResourceReadiness.cjs');

function print(value, output = console.log) {
  output(JSON.stringify(value, null, 2));
}

async function hiddenPrompt(promptText, io = {}) {
  if (io.promptHidden) return io.promptHidden(promptText);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Object.assign(new Error('Interactive TTY required'), { code: 'readiness/tty_required' });
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    let complete = false;
    for await (const chunk of process.stdin) {
      for (const key of chunk) {
        if (key === '\r' || key === '\n') { complete = true; break; }
        if (key === '\u0003') throw Object.assign(new Error('Cancelled'), { code: 'readiness/cancelled' });
        if (key === '\u007f') value = value.slice(0, -1);
        else if (key >= ' ') value += key;
      }
      if (complete) break;
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  }
  return value;
}

async function visiblePrompt(promptText, io = {}) {
  if (io.promptVisible) return io.promptVisible(promptText);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(promptText); } finally { rl.close(); }
}

async function run(argv = process.argv.slice(2), io = {}) {
  const output = io.output || console.log;
  const [command, option, extra] = argv;
  if (extra !== undefined) throw Object.assign(new Error('Too many arguments'), { code: 'readiness/usage' });
  if (command === 'apply-public' && option === undefined) return print(readiness.applyPublicInputs(), output);
  if (command === 'generate-suffix' && option === undefined) return print(readiness.configureGeneratedSuffix(), output);
  if (command === 'compose-project-id' && option === undefined) return print(readiness.configureProjectId(), output);
  if (command === 'set-private' && readiness.PRIVATE_FIELDS.includes(option)) {
    const value = await hiddenPrompt(`Enter ${option} (hidden): `, io);
    return print(readiness.configurePrivateField(option, value), output);
  }
  if (command === 'set-window' && readiness.WINDOW_FIELDS.includes(option)) {
    const value = await visiblePrompt(`Enter future ISO-8601 start for ${option}: `, io);
    return print(readiness.configureWindow(option, value, io.now), output);
  }
  if (command === 'availability' && option === '--check-only') return print(readiness.availabilityStatus(), output);
  if (command === 'verify-rules' && option === undefined) return print(readiness.verifyRuleHashes(), output);
  throw Object.assign(new Error('Usage error'), { code: 'readiness/usage' });
}

if (require.main === module) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: 'readiness-error', code: error.code || 'readiness/failed', ...readiness.ZERO_OPERATIONS }));
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ hiddenPrompt, visiblePrompt, run });
