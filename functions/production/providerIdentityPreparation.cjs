'use strict';

const { execFileSync } = require('node:child_process');
const { sha256, stableJson, validateManifestSource } = require('./providerIdentityWindow.cjs');
const { TARGET, requestArtifact, exclusive, provenance } = require('./providerIdentityRun.cjs');
const { buildPlan, sourceManifest } = require('./providerIdentityDeploymentPlan.cjs');
const { validatePlan } = require('./providerIdentityInfrastructure.cjs');
const { runtimeContract } = require('./providerIdentityDeploymentExecutor.cjs');

const same = (a, b) => stableJson(a) === stableJson(b);
function verifyReviewedFiles(repo, operator, plan, sourceMain, contractDigest) {
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (git(['rev-parse', `${sourceMain.commit}^{tree}`]).trim() !== sourceMain.tree ||
      sha256(git(['show', `${operator.commit}:${plan.rules.candidatePath}`])) !== plan.rules.candidateDigest ||
      sha256(JSON.parse(git(['show', `${operator.commit}:functions/production/legacy-provisioning-contract.json`]))) !== contractDigest) {
    throw new Error('preparation_reviewed_source_changed');
  }
}

// The request binds the single plan digest. The envelope adds the request
// digest afterwards, avoiding a circular digest or a second executable plan.
function prepareBundle({ repo, store, manifest, snapshot, runtime, runId, issuedAt, expiresAt }) {
  validateManifestSource(manifest, snapshot);
  const operator = provenance(repo);
  const sourceMain = { commit: manifest.source.mainCommit, tree: manifest.source.mainTree };
  const c = runtime.contract;
  if (!c || runtime.providerUsage?.accounts !== 0 || runtime.providerUsage?.providers !== 0 ||
      runtime.providerUsage?.subjects !== 0 || !runtime.rulesRelease || !runtime.projectIam ||
      !same(runtime.target, TARGET) || runtime.freeze?.firestore || runtime.freeze?.rtdb) {
    throw new Error('preparation_runtime_incomplete');
  }
  const { plan } = buildPlan({ repoRoot: repo, sourceCommit: operator.commit, sourceTree: operator.tree,
    runtimeContract: c, candidateRulesDigest: sha256(c.rulesCandidate), currentRulesDigest: sha256(c.rulesRollback),
    currentAuthorityRevision: c.authorityBefore.status.latestReadyRevisionName,
    currentAuthorityImageDigest: c.authorityBefore.spec.template.spec.containers[0].image,
    currentGatewayRevisions: Object.fromEntries(Object.entries(c.gatewayRollback).map(([name, v]) => [name, v?.revision ?? null])),
    currentIamPolicyDigest: sha256(runtime.projectIam) });
  delete plan.planDigest;
  plan.preparation = { ...TARGET, sourceMain, manifestDigest: manifest.manifestDigest,
    provisioningContractDigest: manifest.source.provisioningContractDigest,
    rulesRelease: runtime.rulesRelease, projectIam: runtime.projectIam, providerUsage: runtime.providerUsage,
    freeze: runtime.freeze };
  plan.planDigest = sha256(JSON.stringify(plan));
  runtimeContract(plan);
  verifyReviewedFiles(repo, operator, plan, sourceMain, manifest.source.provisioningContractDigest);
  const request = requestArtifact({ runId, manifest, plan, operator, issuedAt, expiresAt });
  validatePlan(plan, request);
  const value = { schemaVersion: 1, type: 'provider-identity-preparation-bundle', plan,
    requestDigest: request.digest, manifestDigest: manifest.manifestDigest };
  const bundle = { ...value, bundleDigest: sha256(value) };
  store.initialize(request);
  exclusive(store.file('preparation.json'), store.seal(bundle));
  return { bundle, request };
}

function loadBundle({ repo, store, manifest, snapshot, actualProvenance = provenance(repo) }) {
  validateManifestSource(manifest, snapshot);
  const bundle = store.read('preparation.json'), request = store.request();
  const { bundleDigest, ...unsigned } = bundle;
  if (bundle.type !== 'provider-identity-preparation-bundle' || bundle.schemaVersion !== 1 ||
      sha256(unsigned) !== bundleDigest || bundle.requestDigest !== request.digest ||
      bundle.manifestDigest !== manifest.manifestDigest || !same(actualProvenance, request.operator)) {
    throw new Error('preparation_bundle_changed');
  }
  const plan = bundle.plan, p = plan.preparation;
  validatePlan(plan, request); runtimeContract(plan);
  if (!p || !same({ projectId: p.projectId, database: p.database, rtdbUrl: p.rtdbUrl }, TARGET) ||
      p.manifestDigest !== manifest.manifestDigest ||
      !same(p.sourceMain, { commit: manifest.source.mainCommit, tree: manifest.source.mainTree }) ||
      p.provisioningContractDigest !== manifest.source.provisioningContractDigest ||
      plan.rules.currentDigest !== manifest.source.currentRulesDigest ||
      sha256(p.projectIam) !== plan.rollback.iamPolicyDigest) throw new Error('preparation_source_changed');
  verifyReviewedFiles(repo, request.operator, plan, p.sourceMain, p.provisioningContractDigest);
  for (const kind of ['authority', 'gateways']) {
    const source = sourceManifest(repo, plan.source.commit, plan[kind].sourceRoot);
    if (source.sourceFingerprint !== plan[kind].sourceFingerprint ||
        !same(source.sourceFiles, plan[kind].sourceFiles)) throw new Error('preparation_runtime_source_changed');
  }
  return bundle;
}

module.exports = { prepareBundle, loadBundle };
