'use strict';

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

// Registry manifests and linux/amd64 configs independently checked 2026-09-08.
// See e1-authority-toolchain-review.md. Changes require review of the complete inputs.
const TOOLCHAIN = Object.freeze({
  docker: 'gcr.io/cloud-builders/docker@sha256:3d00b6c1a9b862621c30fc74d4f2abfc62bcbdee631ed3febd31e7edbdf6252c',
  node: 'docker.io/library/node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa',
  platform: 'linux/amd64',
  nodeVersion: '24.20.0'
});
const GOOGLE_PROVENANCE_KEY_ID = 'projects/verified-builder/locations/global/keyRings/attestor/cryptoKeys/google-hosted-worker/cryptoKeyVersions/1';
// Public verification key fetched from the immutable Google KMS key version above.
const GOOGLE_PROVENANCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg9KII7kzr/30HBluf00y9WwtMFkE
qc3oCcFVH3QJ37IBLUv/MUApbnNHFfD75ayJ/a0F45xa+MLv5zoep+GxsA==
-----END PUBLIC KEY-----
`;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const RECEIPT_SCHEMA_VERSION = 1;
const fail = (code) => { throw new Error(`e1/authority-${code}`); };
const equal = (actual, expected, code) => { if (!isDeepStrictEqual(actual, expected)) fail(code); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
}

function sealedRecord(value, hashField) {
  const copy = structuredClone(value);
  delete copy[hashField];
  return { ...copy, [hashField]: sha256(`${JSON.stringify(copy)}\n`) };
}

function verifySeal(value, hashField, code) {
  const expected = sealedRecord(value, hashField)[hashField];
  if (!HASH.test(value?.[hashField] || '') || value[hashField] !== expected) fail(code);
}

function decodeCanonicalBase64(value, code) {
  if (typeof value !== 'string') fail(code);
  const bytes = Buffer.from(value, 'base64');
  const standard = bytes.toString('base64');
  const urlSafe = standard.replace(/\+/gu, '-').replace(/\//gu, '_');
  // ProtoJSON bytes accept either alphabet, with or without trailing padding.
  const accepted = [standard, urlSafe].flatMap((encoded) => [encoded, encoded.replace(/=+$/u, '')]);
  if (!accepted.includes(value)) fail(code);
  return bytes;
}

function dockerfile() {
  return `FROM ${TOOLCHAIN.node}
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
USER node
CMD ["node", "server.js"]
`;
}

function expectedBuildConfig(plan, requestId) {
  if (!UUID.test(requestId) || !HASH.test(plan.sourceFingerprint || '') ||
      !/^[a-f0-9]{40}$/u.test(plan.toolingSourceSha || '')) fail('build-expectation-invalid');
  const image = `${plan.target.imageUri}:build-${requestId}`;
  return {
    steps: [{ name: TOOLCHAIN.docker, entrypoint: 'docker', env: ['DOCKER_BUILDKIT=0'],
      args: ['build', '--pull', '--no-cache', `--platform=${TOOLCHAIN.platform}`, '--tag', image, '.'] }],
    images: [image],
    tags: ['e1-authority', `request-${requestId}`, `source-${plan.sourceFingerprint}`, `tooling-${plan.toolingSourceSha}`],
    timeout: '1200s',
    serviceAccount: plan.target.builderServiceAccountResource,
    options: { logging: 'CLOUD_LOGGING_ONLY', requestedVerifyOption: 'VERIFIED', sourceProvenanceHash: ['SHA256'] }
  };
}

function verifyDependencyLock(lockBytes) {
  let lock;
  try { lock = JSON.parse(lockBytes); } catch { fail('dependency-lock-invalid'); }
  if (lock.lockfileVersion !== 3 || !lock.packages || !lock.packages['']) fail('dependency-lock-invalid');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (!/^https:\/\/registry\.npmjs\.org\//u.test(entry.resolved || '') ||
        !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity || '') || entry.link) fail('dependency-integrity-missing');
  }
}

function inputSteps(steps, result = false) {
  if (!Array.isArray(steps)) fail('build-config-mismatch');
  return steps.map((step) => {
    const copy = structuredClone(step);
    if (result) {
      if (copy.status !== 'SUCCESS' || (copy.exitCode !== undefined && copy.exitCode !== 0)) fail('build-step-failed');
      for (const key of ['status', 'exitCode', 'timing', 'pullTiming']) delete copy[key];
    }
    return copy;
  });
}

function inputOptions(options) {
  const copy = structuredClone(options || {});
  // Cloud Build may echo the default public worker pool as an empty message.
  if (isDeepStrictEqual(copy.pool, {})) delete copy.pool;
  return copy;
}

function verifyConfig(actual, expected, result = false) {
  equal(inputSteps(actual.steps, result), expected.steps, 'build-config-mismatch');
  equal(inputOptions(actual.options), expected.options, 'build-config-mismatch');
  equal(actual.substitutions || {}, {}, 'build-substitutions-invalid');
  for (const name of ['secrets', 'availableSecrets', 'buildTriggerId', 'gitConfig', 'dependencies']) {
    if (actual[name] !== undefined) fail('build-unexpected-input');
  }
}

function verifyBuildResult(plan, build, expected) {
  if (!UUID.test(expected.buildId || '') || build?.id !== expected.buildId || build.projectId !== plan.target.projectId ||
      ![plan.target.projectId, plan.target.projectNumber].some((project) =>
        build.name === `projects/${project}/locations/${plan.target.region}/builds/${expected.buildId}`) ||
      build.status !== 'SUCCESS') fail('build-identity-or-status-invalid');
  const times = [build.createTime, build.startTime, build.finishTime].map(Date.parse);
  if (times.some((time) => !Number.isFinite(time)) || times[0] < expected.submittedAt - 60000 ||
      times[0] > times[1] || times[1] > times[2] || times[2] > Date.now() + 60000) fail('build-time-invalid');
  verifyConfig(build, expected.config, true);
  for (const key of ['images', 'tags', 'timeout', 'serviceAccount']) equal(build[key], expected.config[key], 'build-config-mismatch');
  equal(build.results?.buildStepImages, [TOOLCHAIN.docker.split('@')[1]], 'build-toolchain-mismatch');
  const storage = build.source?.storageSource;
  if (!storage || !storage.bucket || !storage.object || !/^[1-9][0-9]*$/u.test(String(storage.generation || '')) ||
      Object.keys(build.source).length !== 1) fail('build-source-invalid');
  equal(storage, expected.storageSource, 'build-source-submission-mismatch');
  equal(build.sourceProvenance?.resolvedStorageSource, storage, 'build-source-mismatch');
  const provenance = build.sourceProvenance;
  if (Object.keys(provenance).some((key) => !['resolvedStorageSource', 'fileHashes'].includes(key))) fail('build-source-invalid');
  const entries = Object.entries(provenance.fileHashes || {});
  const uri = `gs://${storage.bucket}/${storage.object}`;
  if (entries.length !== 1 || ![uri, `${uri}#${storage.generation}`].includes(entries[0][0])) fail('build-source-hash-missing');
  const hashes = entries[0][1]?.fileHash;
  const expectedArchiveHash = Buffer.from(expected.archiveSha256, 'hex');
  if (!Array.isArray(hashes) || !hashes.some((hash) => hash.type === 'SHA256' &&
      decodeCanonicalBase64(hash.value, 'build-source-hash-mismatch').equals(expectedArchiveHash))) {
    fail('build-source-hash-mismatch');
  }
  const images = build.results?.images;
  if (!Array.isArray(images) || images.length !== 1 || images[0].name !== expected.config.images[0] ||
      !DIGEST.test(images[0].digest || '')) fail('build-output-invalid');
  return Object.freeze({ buildId: build.id, imageDigest: images[0].digest,
    image: `${plan.target.imageUri}@${images[0].digest}` });
}

function googleSignedStatement(envelope) {
  if (envelope?.payloadType !== 'application/vnd.in-toto+json' || typeof envelope.payload !== 'string') fail('provenance-envelope-invalid');
  const payload = decodeCanonicalBase64(envelope.payload, 'provenance-envelope-invalid');
  const type = envelope.payloadType;
  const message = Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${payload.length} `), payload]);
  const signature = envelope.signatures?.find((entry) => entry.keyid === GOOGLE_PROVENANCE_KEY_ID);
  if (!signature || !crypto.verify('sha256', message, GOOGLE_PROVENANCE_PUBLIC_KEY,
    decodeCanonicalBase64(signature.sig, 'provenance-signature-invalid'))) {
    fail('provenance-signature-invalid');
  }
  try { return JSON.parse(payload.toString('utf8')); } catch { fail('provenance-envelope-invalid'); }
}

function verifyArtifactProvenance(plan, artifact, build, expected, built) {
  if (artifact?.image_summary?.digest !== built.imageDigest || artifact.image_summary.fully_qualified_digest !== built.image) {
    fail('provenance-output-mismatch');
  }
  const invocationId = `https://cloudbuild.googleapis.com/v1/projects/${plan.target.projectId}/locations/${plan.target.region}/builds/${built.buildId}`;
  const occurrences = artifact.provenance_summary?.provenance;
  if (!Array.isArray(occurrences)) fail('provenance-missing');
  // Select this build only; an image can legitimately have provenance from older builds.
  const candidates = occurrences.filter((occurrence) => occurrence.build?.inTotoSlsaProvenanceV1?.predicate?.runDetails?.metadata?.invocationId === invocationId);
  if (candidates.length !== 1) fail('provenance-build-mismatch');
  const occurrence = candidates[0];
  if (occurrence.kind !== 'BUILD' || occurrence.resourceUri !== `https://${built.image}`) fail('provenance-output-mismatch');
  const statement = googleSignedStatement(occurrence.envelope);
  equal(statement, occurrence.build.inTotoSlsaProvenanceV1, 'provenance-envelope-mismatch');
  const predicate = statement.predicate;
  if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
      predicate?.buildDefinition?.buildType !== 'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1' ||
      predicate.runDetails?.builder?.id !== 'https://cloudbuild.googleapis.com/GoogleHostedWorker' ||
      predicate.runDetails.metadata?.invocationId !== invocationId) fail('provenance-builder-invalid');
  const subjects = statement.subject;
  const names = [`https://${plan.target.imageUri}`, `https://${expected.config.images[0]}`, `https://${built.image}`];
  if (!Array.isArray(subjects) || !subjects.length || subjects.some((subject) => !names.includes(subject.name) ||
      !isDeepStrictEqual(subject.digest, { sha256: built.imageDigest.slice(7) }))) fail('provenance-subject-mismatch');
  const definition = predicate.buildDefinition;
  const external = definition.externalParameters;
  if (!external || typeof external.buildConfig !== 'string' || external.buildConfigSource || external.sourceToBuild) fail('provenance-config-missing');
  let config;
  try { config = JSON.parse(Buffer.from(external.buildConfig, 'base64').toString('utf8')); } catch { fail('provenance-config-missing'); }
  verifyConfig(config, expected.config);
  equal(external.substitutions || {}, {}, 'provenance-substitutions-invalid');
  for (const key of ['images', 'tags', 'timeout', 'serviceAccount']) {
    if (config[key] !== undefined) equal(config[key], expected.config[key], 'provenance-config-mismatch');
  }
  if (!definition.resolvedDependencies?.some((dependency) =>
    [TOOLCHAIN.docker, TOOLCHAIN.docker.split('@')[0]].includes(dependency.uri) &&
    dependency.digest?.sha256 === TOOLCHAIN.docker.split('@sha256:')[1])) fail('provenance-toolchain-mismatch');
  // Source archive SHA-256, generation, output and service account are bound through
  // the authenticated Cloud Build resource for this exact signed invocation ID.
  equal(verifyBuildResult(plan, build, expected), built, 'provenance-build-mismatch');
  return true;
}

function createBuildReceipt(plan, expected) {
  const submittedAt = new Date(expected.submittedAt).toISOString();
  if (!UUID.test(expected.buildId || '') || !Number.isFinite(Date.parse(submittedAt)) ||
      !HASH.test(expected.archiveSha256 || '') || !UUID.test(expected.requestId || '')) fail('build-receipt-invalid');
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'e1-authority-build',
    state: 'submitted',
    projectId: plan.target.projectId,
    projectNumber: plan.target.projectNumber,
    region: plan.target.region,
    buildId: expected.buildId,
    requestId: expected.requestId,
    submittedAt,
    toolingSourceSha: plan.toolingSourceSha,
    sourceCommitSha: plan.sourceCommitSha,
    sourceFingerprint: plan.sourceFingerprint,
    sourceFiles: plan.manifest.sourceFiles.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    archiveSha256: expected.archiveSha256,
    dockerfileSha256: sha256(dockerfile()),
    buildConfig: structuredClone(expected.config),
    toolchain: structuredClone(TOOLCHAIN)
  };
  return Object.freeze(sealedRecord(receipt, 'receiptSha256'));
}

function verifyBuildReceipt(plan, receipt) {
  const fields = ['schemaVersion', 'kind', 'state', 'projectId', 'projectNumber', 'region', 'buildId', 'requestId',
    'submittedAt', 'toolingSourceSha', 'sourceCommitSha', 'sourceFingerprint', 'sourceFiles', 'archiveSha256',
    'dockerfileSha256', 'buildConfig', 'toolchain', 'receiptSha256'];
  if (!exactFields(receipt, fields) || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      receipt.kind !== 'e1-authority-build' || receipt.state !== 'submitted' || !UUID.test(receipt.buildId || '') ||
      !UUID.test(receipt.requestId || '') || !Number.isFinite(Date.parse(receipt.submittedAt || '')) ||
      !HASH.test(receipt.archiveSha256 || '') || receipt.projectId !== plan.target.projectId ||
      receipt.projectNumber !== plan.target.projectNumber || receipt.region !== plan.target.region ||
      receipt.toolingSourceSha !== plan.toolingSourceSha || receipt.sourceCommitSha !== plan.sourceCommitSha ||
      receipt.sourceFingerprint !== plan.sourceFingerprint || receipt.dockerfileSha256 !== sha256(dockerfile())) {
    fail('build-receipt-invalid');
  }
  equal(receipt.sourceFiles, plan.manifest.sourceFiles.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    'build-receipt-invalid');
  equal(receipt.toolchain, TOOLCHAIN, 'build-receipt-invalid');
  equal(receipt.buildConfig, expectedBuildConfig(plan, receipt.requestId), 'build-receipt-invalid');
  verifySeal(receipt, 'receiptSha256', 'build-receipt-invalid');
  return Object.freeze({
    buildId: receipt.buildId,
    requestId: receipt.requestId,
    submittedAt: Date.parse(receipt.submittedAt),
    archiveSha256: receipt.archiveSha256,
    config: structuredClone(receipt.buildConfig)
  });
}

function createQualificationReceipt(plan, buildReceipt, build, expected, built, qualifiedAt = Date.now()) {
  verifyBuildReceipt(plan, buildReceipt);
  const storageSource = structuredClone(build?.source?.storageSource);
  if (!storageSource || !built || !DIGEST.test(built.imageDigest || '')) fail('qualification-receipt-invalid');
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'e1-authority-qualification',
    state: 'qualified',
    projectId: plan.target.projectId,
    projectNumber: plan.target.projectNumber,
    region: plan.target.region,
    buildId: built.buildId,
    qualifiedAt: new Date(qualifiedAt).toISOString(),
    buildReceiptSha256: buildReceipt.receiptSha256,
    toolingSourceSha: plan.toolingSourceSha,
    sourceCommitSha: plan.sourceCommitSha,
    sourceFingerprint: plan.sourceFingerprint,
    archiveSha256: expected.archiveSha256,
    storageSource,
    imageTag: expected.config.images[0],
    imageDigest: built.imageDigest,
    image: built.image,
    toolchain: structuredClone(TOOLCHAIN),
    provenance: {
      predicateType: 'https://slsa.dev/provenance/v1',
      buildType: 'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1',
      builderId: 'https://cloudbuild.googleapis.com/GoogleHostedWorker',
      signingKeyId: GOOGLE_PROVENANCE_KEY_ID
    }
  };
  return Object.freeze(sealedRecord(receipt, 'qualificationSha256'));
}

function verifyQualificationReceipt(plan, buildReceipt, receipt) {
  const fields = ['schemaVersion', 'kind', 'state', 'projectId', 'projectNumber', 'region', 'buildId', 'qualifiedAt',
    'buildReceiptSha256', 'toolingSourceSha', 'sourceCommitSha', 'sourceFingerprint', 'archiveSha256', 'storageSource',
    'imageTag', 'imageDigest', 'image', 'toolchain', 'provenance', 'qualificationSha256'];
  const expected = verifyBuildReceipt(plan, buildReceipt);
  const provenance = {
    predicateType: 'https://slsa.dev/provenance/v1',
    buildType: 'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1',
    builderId: 'https://cloudbuild.googleapis.com/GoogleHostedWorker',
    signingKeyId: GOOGLE_PROVENANCE_KEY_ID
  };
  if (!exactFields(receipt, fields) || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      receipt.kind !== 'e1-authority-qualification' || receipt.state !== 'qualified' ||
      receipt.projectId !== plan.target.projectId || receipt.projectNumber !== plan.target.projectNumber ||
      receipt.region !== plan.target.region || receipt.buildId !== buildReceipt.buildId ||
      !Number.isFinite(Date.parse(receipt.qualifiedAt || '')) || receipt.buildReceiptSha256 !== buildReceipt.receiptSha256 ||
      receipt.toolingSourceSha !== plan.toolingSourceSha || receipt.sourceCommitSha !== plan.sourceCommitSha ||
      receipt.sourceFingerprint !== plan.sourceFingerprint || receipt.archiveSha256 !== buildReceipt.archiveSha256 ||
      receipt.imageTag !== expected.config.images[0] || !DIGEST.test(receipt.imageDigest || '') ||
      receipt.image !== `${plan.target.imageUri}@${receipt.imageDigest}`) fail('qualification-receipt-invalid');
  equal(receipt.toolchain, TOOLCHAIN, 'qualification-receipt-invalid');
  equal(receipt.provenance, provenance, 'qualification-receipt-invalid');
  verifySeal(receipt, 'qualificationSha256', 'qualification-receipt-invalid');
  return Object.freeze({ buildId: receipt.buildId, imageDigest: receipt.imageDigest, image: receipt.image,
    storageSource: structuredClone(receipt.storageSource) });
}

module.exports = Object.freeze({ TOOLCHAIN, GOOGLE_PROVENANCE_KEY_ID, GOOGLE_PROVENANCE_PUBLIC_KEY,
  RECEIPT_SCHEMA_VERSION,
  sha256, dockerfile, expectedBuildConfig, verifyDependencyLock, verifyBuildResult,
  googleSignedStatement, verifyArtifactProvenance, createBuildReceipt, verifyBuildReceipt,
  createQualificationReceipt, verifyQualificationReceipt });
