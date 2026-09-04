'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { privateDirectory, privatePath, readPrivate } = require('./providerIdentityPrivateFiles.cjs');
const { stableJson, sha256, validateManifest } = require('./providerIdentityWindow.cjs');
const { sourceManifest } = require('./providerIdentityDeploymentPlan.cjs');

const TARGET = Object.freeze({ projectId: 'trade-list-a4297', database: 'phase-e-identity',
  rtdbUrl: 'https://trade-list-a4297-default-rtdb.firebaseio.com' });
const NORMAL_ACTIONS = Object.freeze(['prepare-infrastructure', 'activate-freeze', 'apply-manifest',
  'verify-coverage', 'create-certification', 'verify-zero-write']);
const RESTORATION_ACTIONS = Object.freeze(['restore-infrastructure', 'invalidate-certification',
  'release-freeze', 'cleanup-privileges', 'verify-restored', 'closeout']);
const NORMAL_MS = 25 * 60 * 1000;
const RESTORE_MS = 10 * 60 * 1000;
const PHASES = Object.freeze(['PREPARED', 'INFRASTRUCTURE_READY', 'FREEZE_ACTIVATING', 'FROZEN',
  'MANIFEST_APPLYING', 'COVERAGE_VERIFIED', 'CERTIFICATION_CREATED', 'ZERO_WRITE_VERIFIED', 'RESTORING',
  'CERTIFICATION_INVALIDATED', 'FREEZE_RELEASED', 'PRIVILEGES_CLEANED', 'CLOSED_HEALTHY', 'CLOSED_BLOCKED_RESTORED']);
const HASH = /^[a-f0-9]{64}$/u;
const same = (a, b) => stableJson(a) === stableJson(b);
const fail = (code) => { throw new Error(code); };

function provenance(repo) {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) fail('operator_repository_dirty');
  const commit = git('rev-parse', 'HEAD');
  return { commit, tree: git('rev-parse', 'HEAD^{tree}'),
    authority: sourceManifest(repo, commit, 'functions/e1-authority-service').sourceFingerprint,
    gateway: sourceManifest(repo, commit, 'functions/e1-gateway').sourceFingerprint };
}

function requestArtifact({ runId, manifest, plan, operator, issuedAt, expiresAt }) {
  validateManifest(manifest);
  if (!/^[a-z0-9][a-z0-9-]{15,79}$/u.test(runId || '') || !HASH.test(plan.planDigest || '') ||
      !HASH.test(plan.rules?.candidateDigest || '') || !/^[a-f0-9]{40}$/u.test(operator.commit || '') ||
      !/^[a-f0-9]{40}$/u.test(operator.tree || '') || !HASH.test(operator.authority || '') ||
      !same(Object.keys(operator).sort(), ['authority', 'commit', 'gateway', 'tree']) ||
      !HASH.test(operator.gateway || '') || !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) || issuedAt <= 0 || expiresAt - issuedAt < NORMAL_MS + RESTORE_MS ||
      expiresAt - issuedAt > 24 * 60 * 60 * 1000 || !same(plan.source, { commit: operator.commit, tree: operator.tree }) ||
      plan.authority.sourceFingerprint !== operator.authority || plan.gateways.sourceFingerprint !== operator.gateway) {
    fail('approval_request_binding_invalid');
  }
  const { planDigest, ...unsignedPlan } = plan;
  if (crypto.createHash('sha256').update(JSON.stringify(unsignedPlan)).digest('hex') !== planDigest) fail('plan_digest_invalid');
  const value = { schemaVersion: 1, type: 'provider-identity-approval-request', ...TARGET, runId,
    manifestDigest: manifest.manifestDigest, planDigest, rulesDigest: plan.rules.candidateDigest, operator,
    normalActions: [...NORMAL_ACTIONS], restorationActions: [...RESTORATION_ACTIONS], issuedAt, expiresAt,
    normalBudgetMs: NORMAL_MS, restorationReserveMs: RESTORE_MS, restorationLifecycle: 'until-sealed-terminal-closeout' };
  return { ...value, digest: sha256(value) };
}

function verifyRequest(request) {
  const { digest, ...value } = request;
  const fields = ['schemaVersion', 'type', 'projectId', 'database', 'rtdbUrl', 'runId', 'manifestDigest', 'planDigest',
    'rulesDigest', 'operator', 'normalActions', 'restorationActions', 'issuedAt', 'expiresAt', 'normalBudgetMs',
    'restorationReserveMs', 'restorationLifecycle'];
  if (!HASH.test(digest || '') || sha256(value) !== digest || value.schemaVersion !== 1 ||
      !same(Object.keys(value).sort(), fields.sort()) ||
      !/^[a-z0-9][a-z0-9-]{15,79}$/u.test(value.runId || '') ||
      !['manifestDigest', 'planDigest', 'rulesDigest'].every((key) => HASH.test(value[key] || '')) ||
      !same(Object.keys(value.operator || {}).sort(), ['authority', 'commit', 'gateway', 'tree']) ||
      !['commit', 'tree'].every((key) => /^[a-f0-9]{40}$/u.test(value.operator[key] || '')) ||
      !['authority', 'gateway'].every((key) => HASH.test(value.operator[key] || '')) ||
      !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt - value.issuedAt < NORMAL_MS + RESTORE_MS || value.expiresAt - value.issuedAt > 86400000 ||
      value.type !== 'provider-identity-approval-request' ||
      !same({ projectId: value.projectId, database: value.database, rtdbUrl: value.rtdbUrl }, TARGET) ||
      !same(value.normalActions, NORMAL_ACTIONS) || !same(value.restorationActions, RESTORATION_ACTIONS) ||
      value.normalBudgetMs !== NORMAL_MS || value.restorationReserveMs !== RESTORE_MS ||
      value.restorationLifecycle !== 'until-sealed-terminal-closeout') fail('approval_request_invalid');
  return request;
}

function approvalPhrase(request) {
  verifyRequest(request);
  return `APPROVE LIVE IDENTITY PREP WINDOW\nRUN=${request.runId}\nREQUEST=${request.digest}`;
}

function exclusive(file, value) {
  privatePath(file, { missing: true });
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

class RunStore {
  constructor(directory) {
    this.directory = privateDirectory(directory);
    this.eventsDirectory = path.join(directory, 'events');
    this.keyFile = path.join(directory, 'seal-key.json');
  }
  file(name) { return path.join(this.directory, name); }
  location() {
    const stat = fs.statSync(this.directory);
    return { path: this.directory, device: stat.dev, inode: stat.ino };
  }
  seal(value) {
    const key = Buffer.from(JSON.parse(readPrivate(this.keyFile)).key, 'hex');
    try { return { value, mac: crypto.createHmac('sha256', key).update(stableJson(value)).digest('hex') }; }
    finally { key.fill(0); }
  }
  read(name) {
    const sealed = JSON.parse(readPrivate(this.file(name)));
    if (!HASH.test(sealed.mac || '') || !crypto.timingSafeEqual(Buffer.from(sealed.mac, 'hex'),
      Buffer.from(this.seal(sealed.value).mac, 'hex'))) fail('run_seal_invalid');
    return sealed.value;
  }
  initialize(request) {
    verifyRequest(request);
    exclusive(this.keyFile, { key: crypto.randomBytes(32).toString('hex') });
    privateDirectory(this.eventsDirectory);
    exclusive(this.file('request.json'), this.seal({ request, location: this.location() }));
  }
  request() {
    const bound = this.read('request.json');
    if (!same(bound.location, this.location())) fail('run_location_mismatch');
    return verifyRequest(bound.request);
  }
  approve(phrase, actual, now) {
    const request = this.request();
    if (phrase !== approvalPhrase(request) || !same(actual, request.operator) || !Number.isSafeInteger(now) ||
        now < request.issuedAt || now >= request.expiresAt) fail('approval_rejected');
    // An interrupted approval is deliberately not retried: prepare a new request.
    exclusive(this.file('approval-consumed.json'), this.seal({ requestDigest: request.digest, at: now }));
    for (const kind of ['execution', 'restoration']) {
      exclusive(this.file(`${kind}.json`), this.seal({ schemaVersion: 1, kind, requestDigest: request.digest,
        runId: request.runId, location: this.location(), issuedAt: now,
        expiresAt: kind === 'execution' ? request.expiresAt : null,
        actions: kind === 'execution' ? request.normalActions : request.restorationActions }));
    }
    const state = { phase: 'PREPARED', runId: request.runId, requestDigest: request.digest,
      manifestDigest: request.manifestDigest, operator: request.operator,
      executionDigest: sha256(this.read('execution.json')), restorationDigest: sha256(this.read('restoration.json')),
      activatedAt: null, normalDeadline: null, hardDeadline: null, freeze: null,
      certification: null, rollback: null, lastVerifiedState: null, completedActions: [], pending: null,
      terminal: false, reason: null, startedAt: now };
    this.append(null, state, 'approved', now);
  }
  ledger() {
    this.request();
    const names = fs.readdirSync(this.eventsDirectory).sort();
    let previous = null;
    for (let i = 0; i < names.length; i += 1) {
      if (names[i] !== `${String(i).padStart(6, '0')}.json`) fail('run_chain_gap');
      const event = this.read(`events/${names[i]}`);
      if (event.sequence !== i || event.previous !== (previous ? sha256(previous) : null) ||
          !PHASES.includes(event.state.phase)) fail('run_chain_invalid');
      previous = event;
    }
    if (!previous) fail('run_not_approved');
    return previous;
  }
  append(previous, state, action, at) {
    if (!Number.isSafeInteger(at) || at <= 0 || (previous && at < previous.at)) fail('run_clock_invalid');
    if (previous && sha256(this.ledger()) !== sha256(previous)) fail('run_previous_state_changed');
    if (previous?.state.terminal) fail('run_closed');
    if (previous && (state.runId !== previous.state.runId || state.requestDigest !== previous.state.requestDigest ||
        state.manifestDigest !== previous.state.manifestDigest || !same(state.operator, previous.state.operator) ||
        (previous.state.activatedAt !== null && (!same(state.freeze, previous.state.freeze) ||
          state.activatedAt !== previous.state.activatedAt || state.normalDeadline !== previous.state.normalDeadline ||
          state.hardDeadline !== previous.state.hardDeadline)))) fail('run_immutable_evidence_changed');
    if (previous && state.phase !== previous.state.phase && state.phase !== 'RESTORING' &&
        !(previous.state.phase === 'PRIVILEGES_CLEANED' && state.phase.startsWith('CLOSED_')) &&
        PHASES.indexOf(state.phase) !== PHASES.indexOf(previous.state.phase) + 1) fail('run_phase_invalid');
    if (previous?.state.phase === 'RESTORING' && PHASES.indexOf(state.phase) < PHASES.indexOf('RESTORING')) fail('run_restoration_only');
    const event = { sequence: previous ? previous.sequence + 1 : 0, previous: previous ? sha256(previous) : null,
      state, action, at };
    exclusive(path.join(this.eventsDirectory, `${String(event.sequence).padStart(6, '0')}.json`), this.seal(event));
    return event;
  }
  authorize(kind, action, binding, now, allowanceMs = 0) {
    const request = this.request(), ledger = this.ledger(), capability = this.read(`${kind}.json`);
    const expected = kind === 'execution' ? NORMAL_ACTIONS : kind === 'restoration' ? RESTORATION_ACTIONS : [];
    if (ledger.state.terminal) fail('run_closed');
    if (!same(binding, { ...TARGET, manifestDigest: request.manifestDigest, planDigest: request.planDigest,
      rulesDigest: request.rulesDigest, operator: request.operator }) || capability.kind !== kind ||
        capability.requestDigest !== request.digest || capability.runId !== request.runId ||
        !same(capability.location, this.location()) || !same(capability.actions, expected) || !expected.includes(action) ||
        sha256(capability) !== ledger.state[`${kind}Digest`]) fail('capability_binding_invalid');
    if (!Number.isSafeInteger(now) || now < ledger.at || allowanceMs < 0) fail('run_clock_invalid');
    if (kind === 'execution' && (PHASES.indexOf(ledger.state.phase) >= PHASES.indexOf('RESTORING') ||
      now + allowanceMs >= Math.min(capability.expiresAt, ledger.state.normalDeadline ?? Infinity))) fail('normal_authority_expired');
    const normalPhase = { 'prepare-infrastructure': 'PREPARED', 'activate-freeze': 'FREEZE_ACTIVATING',
      'apply-manifest': 'MANIFEST_APPLYING', 'verify-coverage': 'MANIFEST_APPLYING',
      'create-certification': 'COVERAGE_VERIFIED', 'verify-zero-write': 'CERTIFICATION_CREATED' };
    if (kind === 'execution' && ledger.state.phase !== normalPhase[action]) fail('normal_action_out_of_sequence');
    return ledger;
  }
  binding() {
    const r = this.request();
    return { ...TARGET, manifestDigest: r.manifestDigest, planDigest: r.planDigest, rulesDigest: r.rulesDigest, operator: r.operator };
  }
  closeout(evidence, now) {
    let ledger = this.authorize('restoration', 'closeout', this.binding(), now);
    if (ledger.state.phase !== 'PRIVILEGES_CLEANED' || evidence.certificationAbsent !== true ||
        evidence.freezesInactive !== true || evidence.gatesFalse !== true || evidence.temporaryIamAbsent !== true) fail('closeout_unsafe');
    const phase = ledger.state.reason ? 'CLOSED_BLOCKED_RESTORED' : 'CLOSED_HEALTHY';
    const value = { schemaVersion: 1, ...evidence, ...ledger.state, phase, terminal: true, endedAt: now,
      transitionChainDigest: sha256(ledger), request: this.request() };
    if (fs.existsSync(this.file('closeout.json'))) {
      if (!same(this.read('closeout.json'), value)) fail('closeout_conflict');
    } else exclusive(this.file('closeout.json'), this.seal(value));
    ledger = this.append(ledger, { ...ledger.state, terminal: true, phase, lastVerifiedState: evidence }, 'closeout', now);
    return ledger;
  }
  finalizeCloseout() {
    const ledger = this.ledger();
    if (ledger.state.terminal) return ledger;
    const value = this.read('closeout.json');
    if (value.transitionChainDigest !== sha256(ledger) || value.request.digest !== this.request().digest ||
        value.runId !== ledger.state.runId || value.manifestDigest !== ledger.state.manifestDigest ||
        value.certificationAbsent !== true || value.freezesInactive !== true || value.gatesFalse !== true ||
        value.temporaryIamAbsent !== true || !value.terminal || !['CLOSED_HEALTHY', 'CLOSED_BLOCKED_RESTORED'].includes(value.phase)) {
      fail('closeout_conflict');
    }
    return this.append(ledger, { ...ledger.state, terminal: true, phase: value.phase, lastVerifiedState: value }, 'closeout', value.endedAt);
  }
}

module.exports = { TARGET, NORMAL_ACTIONS, RESTORATION_ACTIONS, NORMAL_MS, RESTORE_MS, PHASES,
  provenance, requestArtifact, verifyRequest, approvalPhrase, RunStore, exclusive };
