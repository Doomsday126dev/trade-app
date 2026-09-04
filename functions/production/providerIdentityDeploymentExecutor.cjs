'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, stableJson } = require('./providerIdentityWindow.cjs');
const { atomicWrite, readPrivate, privateDirectory } = require('./providerIdentityPrivateFiles.cjs');
const { EXPECTED_GATEWAYS, DISABLED_AUTHORITY_GATES, DISABLED_GATEWAY_GATES } = require('./providerIdentityDeploymentPlan.cjs');
const { validatePlan, stageSource, verifyStage, assertInactive, privateGcloud } = require('./providerIdentityInfrastructure.cjs');
const { TARGET } = require('./providerIdentityRun.cjs');

const REGION = 'us-central1';
const SERVICE = 'e1-identity-authority';
const IMAGE = `us-central1-docker.pkg.dev/${TARGET.projectId}/e1-authority/${SERVICE}`;
const same = (a, b) => stableJson(a) === stableJson(b);

function configuration(service) {
  const container = service?.spec?.template?.spec?.containers?.[0];
  if (service?.spec?.template?.spec?.containers?.length !== 1) throw new Error('authority_container_inventory');
  const env = {};
  for (const entry of container.env || []) {
    if (Object.hasOwn(env, entry.name)) throw new Error('duplicate_environment');
    env[entry.name] = entry.valueFrom ? entry.valueFrom : entry.value;
  }
  return { container, environment: env, runtimeServiceAccount: service.spec.template.spec.serviceAccountName };
}

function runtimeContract(plan) {
  const c = plan.runtimeContract;
  if (!c || !same(Object.keys(c.gatewayRollback).sort(), [...EXPECTED_GATEWAYS].sort()) ||
      !c.authorityBefore || !c.authorityAfter || !c.authorityIam || !c.gatewayEnvironment ||
      !c.gatewayRuntime || !c.rulesRollback || sha256(c.rulesRollback) !== plan.rules.rollbackDigest ||
      sha256(c.rulesCandidate) !== plan.rules.candidateDigest ||
      c.authorityBefore.status?.latestReadyRevisionName !== plan.rollback.authorityRevision) {
    throw new Error('reviewed_runtime_rollback_contract_missing');
  }
  for (const name of EXPECTED_GATEWAYS) {
    const rollback = c.gatewayRollback[name];
    if (rollback !== null && (!rollback.sourceUri?.startsWith('gs://') || !rollback.revision ||
        !rollback.environment || rollback.entryPoint !== name)) throw new Error('gateway_rollback_contract_invalid');
  }
  return c;
}

class ProviderDeploymentExecutor {
  constructor({ repo, store, plan, rules, spawn, providerUsage, freezeState }) {
    Object.assign(this, { repo, store, plan, rules, spawn, providerUsage, freezeState });
    validatePlan(plan, store.request());
    this.contract = runtimeContract(plan);
    this.directory = privateDirectory(store.file('deployment'));
  }
  call(args) { return privateGcloud(args, undefined, this.spawn); }
  jsonFile(name, value) { const file = path.join(this.directory, name); atomicWrite(file, value); return file; }
  async inspect() {
    const before = this.call(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]);
    if (!same(before, this.contract.authorityBefore)) throw new Error('authority_baseline_changed');
    const iam = this.call(['run', 'services', 'get-iam-policy', SERVICE, `--region=${REGION}`]);
    if (!same(iam, this.contract.authorityIam)) throw new Error('authority_iam_changed');
    const roles = (iam.bindings || []).filter((v) => v.role === 'roles/run.invoker');
    if (roles.length !== 1 || roles[0].condition || !same(roles[0].members,
      [`serviceAccount:${this.plan.gateways.runtimeServiceAccount}`])) throw new Error('authority_invocation_iam_invalid');
    const usage = await this.providerUsage(), freeze = await this.freezeState(), rules = await this.rules.read();
    if (usage.accounts !== 0 || usage.providers !== 0 || usage.subjects !== 0) throw new Error('provider_compatibility_floor_active');
    if (freeze.firestore || freeze.rtdb) throw new Error('freeze_not_absent_for_deployment');
    if (sha256(rules.bytes) !== this.plan.rules.currentDigest || rules.bytes !== this.contract.rulesRollback) throw new Error('rules_baseline_changed');
    const gateways = {};
    for (const name of EXPECTED_GATEWAYS) {
      const functions = this.call(['functions', 'list', `--regions=${REGION}`, `--filter=name:/${name}`]);
      const observed = functions.find((v) => v.name?.endsWith(`/functions/${name}`)) || null;
      const expected = this.contract.gatewayRollback[name];
      if ((observed === null) !== (expected === null) || (observed && observed.serviceConfig?.revision !== expected.revision)) {
        throw new Error('gateway_baseline_changed');
      }
      gateways[name] = observed;
    }
    const legacy = configuration(before);
    for (const [key, value] of Object.entries(legacy.environment)) {
      if (key.endsWith('_ENABLED') && value !== 'false') throw new Error('authority_baseline_gate_active');
    }
    return { authority: before, authorityIam: iam, gateways, rulesDigest: sha256(rules.bytes),
      rulesBytes: rules.bytes, rulesEtag: rules.etag, providerAccountsExist: false, freezeActive: false, gatesFalse: true };
  }
  source(kind) {
    const directory = path.join(this.directory, kind);
    if (!fs.existsSync(directory)) stageSource(this.repo, this.plan, kind, directory);
    verifyStage(this.plan, kind, directory);
    return directory;
  }
  async deployRules() {
    const current = await this.rules.read();
    if (current.bytes === this.contract.rulesCandidate) return;
    if (current.bytes !== this.contract.rulesRollback || sha256(current.bytes) !== this.plan.rules.currentDigest) throw new Error('rules_precondition_changed');
    const freeze = await this.freezeState();
    if (freeze.firestore || freeze.rtdb) throw new Error('rules_deploy_freeze_active');
    await this.rules.replace(current, this.contract.rulesCandidate);
    if ((await this.rules.read()).bytes !== this.contract.rulesCandidate) throw new Error('rules_readback_changed');
  }
  async buildAuthority() {
    const source = this.source('authority');
    const config = this.jsonFile('cloudbuild.json', {
      steps: [{ name: 'gcr.io/k8s-skaffold/pack', entrypoint: 'pack', args: ['config', 'default-builder', 'gcr.io/buildpacks/builder:latest'] },
        { name: 'gcr.io/k8s-skaffold/pack', entrypoint: 'pack', args: ['build', IMAGE, '--network', 'cloudbuild', '--publish'] },
        { name: 'gcr.io/cloud-builders/docker', entrypoint: 'docker', args: ['pull', IMAGE] }],
      images: [IMAGE], options: { logging: 'CLOUD_LOGGING_ONLY' } });
    const built = this.call(['builds', 'submit', source, `--region=${REGION}`, `--config=${config}`,
      `--service-account=projects/${TARGET.projectId}/serviceAccounts/e1-authority-builder@${TARGET.projectId}.iam.gserviceaccount.com`]);
    const digest = built.results?.images?.[0]?.digest;
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest || '') || built.results.images.length !== 1 || built.status !== 'SUCCESS') throw new Error('authority_build_unverified');
    const result = { image: `${IMAGE}@${digest}`, sourceFingerprint: this.plan.authority.sourceFingerprint };
    atomicWrite(path.join(this.directory, 'build.json'), this.store.seal(result));
    return result;
  }
  async deployAuthority() {
    const built = this.store.read('deployment/build.json');
    if (built.sourceFingerprint !== this.plan.authority.sourceFingerprint || !built.image.startsWith(`${IMAGE}@sha256:`)) throw new Error('authority_image_source_mismatch');
    this.source('authority');
    const after = structuredClone(this.contract.authorityAfter);
    const config = configuration(after);
    const ref = config.environment.PROVIDER_SUBJECT_HMAC_KEY;
    delete config.environment.PROVIDER_SUBJECT_HMAC_KEY;
    assertInactive(config, this.plan.authority.environment);
    if (!same(ref, { secretKeyRef: { name: 'e1-provider-subject-hmac-key', key: '1' } }) ||
        config.runtimeServiceAccount !== this.plan.authority.runtimeServiceAccount ||
        after.metadata?.name !== SERVICE) throw new Error('authority_versioned_secret_invalid');
    config.container.image = built.image;
    const file = this.jsonFile('authority-spec.json', after);
    this.call(['run', 'services', 'replace', file, `--region=${REGION}`,
      `--impersonate-service-account=e1-authority-deployer@${TARGET.projectId}.iam.gserviceaccount.com`]);
    const observed = this.call(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]);
    if (!same(observed.spec?.template?.spec, after.spec.template.spec) || observed.status?.traffic?.length !== 1 ||
        observed.status.traffic[0].percent !== 100 || observed.status.traffic[0].revisionName !== observed.status.latestReadyRevisionName) {
      throw new Error('authority_deployment_readback_invalid');
    }
    return { revision: observed.status.latestReadyRevisionName, image: built.image };
  }
  gatewayArgs(name, source, environment, runtime) {
    assertInactive({ environment }, DISABLED_GATEWAY_GATES);
    if (environment.APP_CHECK_DEBUG_TOKENS_ALLOWED !== 'false') throw new Error('gateway_debug_check_invalid');
    const envFile = this.jsonFile(`${name}-env.json`, environment);
    return ['functions', 'deploy', name, '--gen2', `--region=${REGION}`, `--runtime=${runtime}`,
      `--source=${source}`, `--entry-point=${name}`, '--trigger-http',
      `--service-account=${this.plan.gateways.runtimeServiceAccount}`, `--env-vars-file=${envFile}`,
      '--memory=256Mi', '--timeout=60s', '--max-instances=2', '--concurrency=80'];
  }
  async deployGateway(plan, name) {
    if (!same(plan, this.plan) || !EXPECTED_GATEWAYS.includes(name)) throw new Error('gateway_plan_changed');
    const environment = { ...this.contract.gatewayEnvironment, ...plan.gateways.environment };
    this.call(this.gatewayArgs(name, this.source('gateways'), environment, this.contract.gatewayRuntime));
    const observed = this.call(['functions', 'describe', name, '--gen2', `--region=${REGION}`]);
    if (observed.buildConfig?.entryPoint !== name || observed.buildConfig?.runtime !== this.contract.gatewayRuntime ||
        observed.serviceConfig?.serviceAccountEmail !== plan.gateways.runtimeServiceAccount ||
        !same(observed.serviceConfig?.environmentVariables, environment)) throw new Error('gateway_deployment_readback_invalid');
    return { name, revision: observed.serviceConfig.revision, sourceFingerprint: plan.gateways.sourceFingerprint };
  }
  async verify(plan) {
    for (const name of EXPECTED_GATEWAYS) {
      const observed = this.call(['functions', 'describe', name, '--gen2', `--region=${REGION}`]);
      assertInactive({ environment: observed.serviceConfig?.environmentVariables }, DISABLED_GATEWAY_GATES);
      if (observed.buildConfig?.entryPoint !== name || observed.serviceConfig.serviceAccountEmail !== plan.gateways.runtimeServiceAccount) throw new Error('gateway_inventory_changed');
    }
    const config = configuration(this.call(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]));
    delete config.environment.PROVIDER_SUBJECT_HMAC_KEY;
    assertInactive(config, plan.authority.environment);
    if ((await this.rules.read()).bytes !== this.contract.rulesCandidate) throw new Error('rules_postverify_changed');
  }
  async restoreRules(before) {
    const current = await this.rules.read();
    if (current.bytes === before.rulesBytes) return;
    if (current.bytes !== this.contract.rulesCandidate || sha256(before.rulesBytes) !== this.plan.rules.rollbackDigest) throw new Error('rules_rollback_conflict');
    await this.rules.replace(current, before.rulesBytes);
    if ((await this.rules.read()).bytes !== before.rulesBytes) throw new Error('rules_rollback_unverified');
  }
  async restoreAuthority(before) {
    this.call(['run', 'services', 'update-traffic', SERVICE, `--region=${REGION}`,
      `--to-revisions=${before.authority.status.latestReadyRevisionName}=100`]);
    const observed = this.call(['run', 'services', 'describe', SERVICE, `--region=${REGION}`]);
    if (observed.status?.traffic?.length !== 1 || observed.status.traffic[0].revisionName !== before.authority.status.latestReadyRevisionName ||
        observed.status.traffic[0].percent !== 100) throw new Error('authority_rollback_unverified');
  }
  async restoreGateway(before, name) {
    const rollback = this.contract.gatewayRollback[name];
    if (!before.gateways[name] && rollback === null) {
      const list = this.call(['functions', 'list', `--regions=${REGION}`, `--filter=name:/${name}`]);
      if (list.some((v) => v.name?.endsWith(`/functions/${name}`))) this.call(['functions', 'delete', name, '--gen2', `--region=${REGION}`]);
      return;
    }
    this.call(this.gatewayArgs(name, rollback.sourceUri, rollback.environment, rollback.runtime));
    const observed = this.call(['functions', 'describe', name, '--gen2', `--region=${REGION}`]);
    if (!same(observed.serviceConfig?.environmentVariables, rollback.environment) || observed.buildConfig?.entryPoint !== name) throw new Error('gateway_rollback_unverified');
  }
}

module.exports = { configuration, runtimeContract, ProviderDeploymentExecutor };
