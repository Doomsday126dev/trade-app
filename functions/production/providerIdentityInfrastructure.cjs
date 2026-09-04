'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { atomicWrite, privateDirectory, readPrivate } = require('./providerIdentityPrivateFiles.cjs');
const { stableJson, sha256 } = require('./providerIdentityWindow.cjs');
const { TARGET } = require('./providerIdentityRun.cjs');
const { exclusive } = require('./providerIdentityRun.cjs');
const { EXPECTED_GATEWAYS, DISABLED_AUTHORITY_GATES, DISABLED_GATEWAY_GATES, sourceManifest,
  gatewayExports } = require('./providerIdentityDeploymentPlan.cjs');

const SECRET = 'e1-provider-subject-hmac-key';
const ACCESSOR = `serviceAccount:e1-identity-authority-runtime@${TARGET.projectId}.iam.gserviceaccount.com`;
const POLICY = Object.freeze({ version: 1, bindings: [{ role: 'roles/secretmanager.secretAccessor', members: [ACCESSOR] }] });
const same = (a, b) => stableJson(a) === stableJson(b);
const bytesDigest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function assertInactive(configuration, required) {
  if (!configuration || !configuration.environment || configuration.debugAppCheck || configuration.broadIam) {
    throw new Error('inactive_configuration_invalid');
  }
  const env = configuration.environment;
  for (const [key, value] of Object.entries(required)) if (env[key] !== value) throw new Error('inactive_gate_invalid');
  for (const [key, value] of Object.entries(env)) {
    if ((key.endsWith('_ENABLED') && value !== 'false') ||
        (key.startsWith('GROUP_E_') && key !== 'GROUP_E_CLIENT_MODE') ||
        (/DEBUG/u.test(key) && value !== 'false') || /PRIVATE|SUBJECT_BINDINGS/u.test(key) || key === 'PROVIDER_SUBJECT_HMAC_KEY') {
      throw new Error('private_or_enabled_environment');
    }
  }
}

function validatePlan(plan, request) {
  const { planDigest, ...unsigned } = plan;
  if (bytesDigest(JSON.stringify(unsigned)) !== planDigest || request.planDigest !== planDigest ||
      !same(plan.source, { commit: request.operator.commit, tree: request.operator.tree }) ||
      plan.authority.sourceFingerprint !== request.operator.authority ||
      plan.gateways.sourceFingerprint !== request.operator.gateway || !same(plan.gateways.functions, EXPECTED_GATEWAYS) ||
      plan.rules.candidateDigest !== request.rulesDigest || plan.rules.rollbackDigest !== plan.rules.currentDigest ||
      plan.authority.runtimeServiceAccount !== ACCESSOR.slice(15) ||
      plan.gateways.runtimeServiceAccount !== `e1-authority-gateway@${TARGET.projectId}.iam.gserviceaccount.com` ||
      !same(plan.authority.secretReference, { environmentVariable: 'PROVIDER_SUBJECT_HMAC_KEY', secret: SECRET, version: '1' }) ||
      plan.providerAccountsExist !== false || plan.secretAndIam.accessor !== ACCESSOR ||
      plan.secretAndIam.role !== 'roles/secretmanager.secretAccessor') throw new Error('provider_deployment_plan_invalid');
  assertInactive(plan.authority, { ...DISABLED_AUTHORITY_GATES, GROUP_E_CLIENT_MODE: 'disabled', READ_PROOF_MODE: 'false',
    PROVIDER_SUBJECT_HMAC_KEY_VERSION: '1', PROVIDER_ACCOUNT_COMPATIBILITY_REQUIRED: 'false' });
  assertInactive(plan.gateways, DISABLED_GATEWAY_GATES);
}

function stageSource(repo, plan, kind, directory) {
  privateDirectory(directory);
  const approved = plan[kind], actual = sourceManifest(repo, plan.source.commit, approved.sourceRoot);
  if (!same(actual.sourceFiles, approved.sourceFiles) || actual.sourceFingerprint !== approved.sourceFingerprint) {
    throw new Error('provider_source_changed');
  }
  if (kind === 'gateways' && !same(gatewayExports(actual.files.find((v) => v.path === 'index.js')?.contents || ''), EXPECTED_GATEWAYS)) {
    throw new Error('provider_export_inventory_invalid');
  }
  for (const file of actual.files) {
    if (!/^[a-zA-Z0-9_.-]+$/u.test(file.path) || file.path.startsWith('.')) throw new Error('source_path_invalid');
    const target = path.join(directory, file.path);
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, file.contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  return directory;
}

function verifyStage(plan, kind, directory) {
  if (!same(fs.readdirSync(directory).sort(), plan[kind].sourceFiles.map((v) => v.path).sort())) throw new Error('staged_inventory_changed');
  for (const file of plan[kind].sourceFiles) {
    if (bytesDigest(readPrivate(path.join(directory, file.path))) !== file.sha256) throw new Error('staged_source_changed');
  }
}

// The command runner never forwards stdout/stderr to logs. In particular a
// version-add failure must not echo its stdin or the cloud command's diagnostics.
function privateGcloud(args, input, spawn = spawnSync) {
  const result = spawn('gcloud', [...args, `--project=${TARGET.projectId}`, '--quiet', '--format=json'], {
    input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) throw new Error('provider_cloud_command_failed');
  try { return result.stdout?.trim() ? JSON.parse(result.stdout) : null; }
  catch { throw new Error('provider_cloud_response_invalid'); }
}

class SecretCommands {
  constructor({ spawn, providerUsage, projectPolicy }) { this.spawn = spawn; this.providerUsage = providerUsage; this.projectPolicy = projectPolicy; }
  call(args, input) { return privateGcloud(args, input, this.spawn); }
  async api() {
    const entries = this.call(['services', 'list', '--enabled', '--filter=config.name:secretmanager.googleapis.com']);
    if (!Array.isArray(entries)) throw new Error('api_inventory_invalid');
    return entries.some((entry) => entry.config?.name === 'secretmanager.googleapis.com');
  }
  async enableApi() { this.call(['services', 'enable', 'secretmanager.googleapis.com']); }
  async secret() {
    const entries = this.call(['secrets', 'list', `--filter=name:/${SECRET}`]);
    if (!Array.isArray(entries)) throw new Error('secret_inventory_invalid');
    return entries.find((v) => v.name === `projects/1053781218847/secrets/${SECRET}` ||
      v.name === `projects/${TARGET.projectId}/secrets/${SECRET}`) || null;
  }
  async createSecret(runId) { this.call(['secrets', 'create', SECRET, '--replication-policy=automatic', `--labels=provider-window=${runId}`]); }
  async versions() { return this.call(['secrets', 'versions', 'list', SECRET]); }
  async addVersion(input) { this.call(['secrets', 'versions', 'add', SECRET, '--data-file=-'], input); }
  async policy() { return this.call(['secrets', 'get-iam-policy', SECRET]); }
  async setPolicy(value) { this.call(['secrets', 'set-iam-policy', SECRET, '-'], JSON.stringify(value)); }
  async deleteSecret() { this.call(['secrets', 'delete', SECRET]); }
  async usage() { return this.providerUsage(); }
  async privileges() { return this.projectPolicy(); }
}

class Infrastructure {
  constructor({ store, plan, commands, deployment, guard, checkpoint = async () => {} }) {
    Object.assign(this, { store, plan, commands, deployment, guard, checkpoint });
    validatePlan(plan, store.request());
  }
  journal() {
    const digest = this.store.ledger().state.infrastructureDigest;
    if (!digest) return { runId: this.store.request().runId, steps: {}, before: null };
    const value = this.store.read(`infrastructure/${digest}.json`);
    if (sha256(value) !== digest || value.runId !== this.store.request().runId) throw new Error('infrastructure_foreign_journal');
    return value;
  }
  save(value) {
    const digest = sha256(value), directory = privateDirectory(this.store.file('infrastructure'));
    const file = path.join(directory, `${digest}.json`);
    if (!fs.existsSync(file)) exclusive(file, this.store.seal(value));
    const ledger = this.store.ledger();
    this.store.append(ledger, { ...ledger.state, infrastructureDigest: digest }, 'infrastructure-checkpoint', ledger.at);
  }
  async intent(name, operation, restoring = false) {
    await this.guard(restoring ? 'restoration' : 'execution', restoring ? 'restore-infrastructure' : 'prepare-infrastructure', 180000);
    let value = this.journal();
    value.steps[name] = { ...(value.steps[name] || {}), intent: true };
    this.save(value);
    await this.checkpoint(`infra:before:${name}`);
    const evidence = await operation();
    await this.checkpoint(`infra:after:${name}`);
    value = this.journal(); value.steps[name] = { intent: true, verified: true, evidence: evidence ?? null }; this.save(value);
    return evidence;
  }
  async noProviderUse() {
    const usage = await this.commands.usage();
    if (!usage || usage.accounts !== 0 || usage.providers !== 0 || usage.subjects !== 0) throw new Error('provider_key_compatibility_obligation');
  }
  owned(secret) {
    if (!secret || !same(secret.labels, { 'provider-window': this.store.request().runId }) ||
        !same(secret.replication, { automatic: {} })) throw new Error('foreign_secret_configuration');
  }
  async prepare() {
    let value = this.journal();
    if (!value.before) {
      await this.noProviderUse();
      const before = { api: await this.commands.api(), privileges: await this.commands.privileges(),
        deployment: await this.deployment.inspect() };
      if (before.deployment.rulesDigest !== this.plan.rules.currentDigest || before.deployment.freezeActive ||
          before.deployment.providerAccountsExist || before.deployment.gatesFalse !== true) throw new Error('deployment_baseline_changed');
      if (sha256(before.privileges) !== this.plan.rollback.iamPolicyDigest) throw new Error('project_iam_baseline_changed');
      value.before = before; this.save(value);
    }
    if (!(await this.commands.api())) await this.intent('api', async () => {
      await this.commands.enableApi(); if (!(await this.commands.api())) throw new Error('api_enable_unverified');
    });
    let secret = await this.commands.secret();
    if (secret && !this.journal().steps.secret?.intent) throw new Error('foreign_preexisting_secret');
    if (!secret) await this.intent('secret', async () => {
      await this.commands.createSecret(this.store.request().runId); this.owned(await this.commands.secret());
    });
    secret = await this.commands.secret(); this.owned(secret);
    const versions = await this.commands.versions();
    if (!Array.isArray(versions) || versions.length > 1 || (versions.length && (!this.journal().steps.version?.intent ||
      !versions[0].name.endsWith('/versions/1') || versions[0].state !== 'ENABLED'))) throw new Error('secret_version_conflict');
    if (!versions.length) await this.intent('version', async () => {
      const key = crypto.randomBytes(48), material = Buffer.from(key.toString('base64url'));
      try {
        try { await this.commands.addVersion(material); }
        catch {
          // Version 1 may have committed. Never resend secret bytes after an
          // ambiguous response; metadata must prove exactly one owned version.
          const observed = await this.commands.versions();
          if (!Array.isArray(observed) || observed.length !== 1 || !observed[0].name.endsWith('/versions/1') ||
              observed[0].state !== 'ENABLED') throw new Error('secret_version_ambiguous');
        }
      } finally { key.fill(0); material.fill(0); }
      const current = await this.commands.versions();
      if (current.length !== 1 || !current[0].name.endsWith('/versions/1') || current[0].state !== 'ENABLED') throw new Error('secret_version_unverified');
    });
    const policy = await this.commands.policy();
    if ((policy.bindings || []).length && !same({ version: policy.version || 1, bindings: policy.bindings }, POLICY)) throw new Error('foreign_secret_iam');
    if (!(policy.bindings || []).length) await this.intent('iam', async () => {
      const journal = this.journal(); journal.secretPolicyBefore = policy; this.save(journal);
      await this.commands.setPolicy({ ...POLICY, etag: policy.etag });
      const actual = await this.commands.policy();
      if (!same({ version: actual.version || 1, bindings: actual.bindings }, POLICY)) throw new Error('secret_iam_unverified');
    });
    await this.intent('rules', () => this.deployment.deployRules(this.plan));
    await this.intent('authority-build', () => this.deployment.buildAuthority(this.plan));
    await this.intent('authority', () => this.deployment.deployAuthority(this.plan));
    for (const name of EXPECTED_GATEWAYS) await this.intent(`gateway:${name}`, () => this.deployment.deployGateway(this.plan, name));
    await this.deployment.verify(this.plan);
  }
  async restore() {
    const journal = this.journal();
    if (!journal.before) return;
    await this.noProviderUse();
    // Roll back independently so a single failed component does not suppress
    // containment of other components. A failed readback prevents closeout.
    const failures = [];
    const attempts = [
      ...[...EXPECTED_GATEWAYS].reverse().filter((name) => journal.steps[`gateway:${name}`]?.intent)
        .map((name) => [`rollback-gateway:${name}`, () => this.deployment.restoreGateway(journal.before.deployment, name)]),
      ...(journal.steps.authority?.intent ? [['rollback-authority', () => this.deployment.restoreAuthority(journal.before.deployment)]] : []),
      ...(journal.steps.rules?.intent ? [['rollback-rules', () => this.deployment.restoreRules(journal.before.deployment)]] : [])
    ];
    for (const [name, action] of attempts) {
      try { await this.intent(name, action, true); } catch { failures.push(name); }
    }
    if (failures.length) throw new Error('infrastructure_restoration_incomplete');
  }
  async cleanup(blocked) {
    const journal = this.journal();
    if (!journal.before) return;
    // This executor grants no temporary project roles. Drift, including a newly
    // appearing privileged member, is not silently removed as if we owned it.
    if (!same(await this.commands.privileges(), journal.before.privileges)) throw new Error('temporary_iam_or_foreign_policy_drift');
    if (blocked && journal.steps.secret?.intent) {
      await this.noProviderUse();
      const secret = await this.commands.secret();
      if (secret) {
        this.owned(secret);
        const policy = await this.commands.policy();
        if ((policy.bindings || []).length && !same({ version: policy.version || 1, bindings: policy.bindings }, POLICY)) throw new Error('foreign_secret_iam');
        await this.intent('rollback-secret', async () => {
          await this.noProviderUse(); await this.commands.deleteSecret();
          if (await this.commands.secret()) throw new Error('secret_cleanup_unverified');
        }, true);
      }
    }
    if (!blocked) {
      this.owned(await this.commands.secret());
      const policy = await this.commands.policy();
      if (!same({ version: policy.version || 1, bindings: policy.bindings }, POLICY)) throw new Error('secret_iam_unverified');
    }
  }
}

module.exports = { SECRET, ACCESSOR, POLICY, assertInactive, validatePlan, stageSource, verifyStage,
  privateGcloud, SecretCommands, Infrastructure };
