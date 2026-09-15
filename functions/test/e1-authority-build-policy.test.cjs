'use strict';
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const policy=require('../production/e1AuthorityBuildPolicy.cjs');
const deploy=require('../scripts/deploy-e1-production-authority.cjs');
const plans=require('../production/e1AuthorityDeploymentPlan.cjs');
const fixture=require('./helpers/authority-build-fixture.cjs');
const REQUEST='bf17f58f-df78-41a1-90fa-073a5bb77ddf';
const plan={target:plans.authorityTarget(plans.loadResourceManifest()),toolingSourceSha:'a'.repeat(40),sourceFingerprint:'b'.repeat(64)};
function scenario(archiveSha256='c'.repeat(64)){const config=policy.expectedBuildConfig(plan,REQUEST);const expected={config,archiveSha256,submittedAt:Date.now(),buildId:fixture.BUILD_ID};const build=fixture.record(plan,config,archiveSha256);expected.storageSource=structuredClone(build.source.storageSource);return {config,expected,build,built:policy.verifyBuildResult(plan,build,expected)};}
function protoJsonBytes(value){const urlSafe=fixture.gcloudBase64(value);return [...new Set([value,value.replace(/=+$/,''),urlSafe,urlSafe.replace(/=+$/,'')])];}
function stagedPlan(mode='build'){
 const root=execFileSync('git',['-C',__dirname,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
 const manifest=plans.loadManifest(),repository=plans.createGitRepository(root);
 return {...plan,mode,sourceCommitSha:manifest.sourceCommitSha,sourcePath:path.join(root,manifest.sourceRoot),manifest,
  sourceFiles:plans.verifyPinnedSource(manifest,repository),deploymentAllowed:true};
}
function withStaged(run){const p=stagedPlan(),staged=plans.stagePinnedSource(p),work=fs.mkdtempSync(path.join(os.tmpdir(),'authority-build-test-'));try{return run(p,staged,work);}finally{fs.rmSync(staged,{recursive:true,force:true});fs.rmSync(work,{recursive:true,force:true});}}

test('explicit build inputs use immutable executable images and disable dependency lifecycle scripts',()=>{
 const config=policy.expectedBuildConfig(plan,REQUEST);
 assert.match(config.steps[0].name,/@sha256:[a-f0-9]{64}$/);
 assert.match(policy.dockerfile(),/^FROM docker\.io\/library\/node@sha256:[a-f0-9]{64}\n/);
 assert.match(policy.dockerfile(),/npm ci --omit=dev --ignore-scripts --no-audit --no-fund/);
 assert.match(policy.dockerfile(),/USER node\nCMD \["node", "server.js"\]/);
 assert.deepEqual(config.steps[0].env,['DOCKER_BUILDKIT=0']);
 assert.ok(config.steps[0].args.includes('--no-cache'));
 assert.doesNotMatch(JSON.stringify(config),/pack|:latest|--publish|push/);
 assert.equal(config.options.requestedVerifyOption,'VERIFIED');
 assert.equal(policy.sha256(policy.GOOGLE_PROVENANCE_PUBLIC_KEY),'f210fd55df9c83fccc07bbd10c615ebcf695da79f6a2a3213abc4ad0f89e9877');
});
test('source packaging binds the actual reviewed source and Dockerfile into the submitted archive',()=>withStaged((p,staged,work)=>{
 const source=deploy.prepareBuildSource(p,staged,work);
 const files=execFileSync('tar',['-tzf',source.archive],{encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(files,[...p.manifest.sourceFiles.map(f=>f.path),'Dockerfile']);
 assert.equal(execFileSync('tar',['-xOzf',source.archive,'Dockerfile'],{encoding:'utf8'}),policy.dockerfile());
 assert.equal(source.archiveSha256,policy.sha256(fs.readFileSync(source.archive)));
}));
test('lockfile missing integrity or non-registry code cannot enter the build',()=>{
 const lock={lockfileVersion:3,packages:{'':{},'node_modules/example':{resolved:'https://registry.npmjs.org/example/-/example-1.tgz',integrity:`sha512-${'A'.repeat(86)}==`}}};
 policy.verifyDependencyLock(JSON.stringify(lock));
 for(const mutation of [x=>delete x.integrity,x=>x.resolved='https://example.test/code.tgz',x=>x.link=true]){const x=structuredClone(lock);mutation(x.packages['node_modules/example']);assert.throws(()=>policy.verifyDependencyLock(JSON.stringify(x)),/dependency-integrity/);}
});
const wrongBuilds={
 'mutable step':b=>b.steps[0].name='gcr.io/cloud-builders/docker',
 'substituted digest':b=>b.results.buildStepImages[0]=`sha256:${'d'.repeat(64)}`,
 'extra step':b=>b.steps.push(structuredClone(b.steps[0])),
 'changed command':b=>b.steps[0].args.push('--build-arg=EXTRA=1'),
 'allowed failure':b=>b.steps[0].allowFailure=true,
 'failed step':b=>b.steps[0].status='FAILURE',
 'failed build':b=>b.status='FAILURE',
 'queued build':b=>b.status='QUEUED',
 'wrong id':b=>b.id=REQUEST,
 'wrong project':b=>b.projectId='other-project',
 'wrong region':b=>b.name=b.name.replace('/us-central1/','/europe-west1/'),
 'wrong builder account':b=>b.serviceAccount='projects/other/serviceAccounts/other',
 'replayed request':b=>b.tags[1]='request-'+fixture.BUILD_ID,
 'wrong tooling revision':b=>b.tags[3]='tooling-'+ 'd'.repeat(40),
 'wrong archive generation':b=>b.sourceProvenance.resolvedStorageSource.generation='456',
 'wrong archive hash':b=>Object.values(b.sourceProvenance.fileHashes)[0].fileHash[0].value=Buffer.alloc(32).toString('base64'),
 'missing source provenance':b=>delete b.sourceProvenance,
 'missing source hash':b=>delete b.sourceProvenance.fileHashes,
 'wrong archive path':b=>b.source.storageSource.object='other.tgz',
 'unbound source':b=>delete b.source.storageSource.generation,
 'wrong image name':b=>b.results.images[0].name='other/image',
 'extra output':b=>b.results.images.push(structuredClone(b.results.images[0])),
 'missing output':b=>delete b.results.images,
 'wrong digest shape':b=>b.results.images[0].digest='latest',
 'missing verification request':b=>delete b.options.requestedVerifyOption,
 'injected build environment':b=>b.options.env=['EXTRA=1'],
 'unexpected secret':b=>b.availableSecrets={secretManager:[]},
 'old build':b=>b.createTime='2020-01-01T00:00:00Z'
};
for(const [name,mutate] of Object.entries(wrongBuilds))test(`rejects ${name} before deployment`,()=>{
 const s=scenario();mutate(s.build);assert.throws(()=>policy.verifyBuildResult(plan,s.build,s.expected),/e1\/authority-/);
});
test('a synthetic successful Cloud Build result is accepted only with all bindings',()=>{
 const s=scenario();assert.equal(s.built.image,`${plan.target.imageUri}@${fixture.DIGEST}`);
});
test('ProtoJSON standard and URL-safe bytes with or without padding retain their exact bindings',()=>{
 const verify=fixture.mockGoogleSignature(mock);
 try {
  const s=scenario('fbff'.repeat(16));
  const sourceHash=Object.values(s.build.sourceProvenance.fileHashes)[0].fileHash[0].value;
  const sourceVariants=protoJsonBytes(sourceHash);assert.equal(sourceVariants.length,4);
  for(const value of sourceVariants){const build=structuredClone(s.build);Object.values(build.sourceProvenance.fileHashes)[0].fileHash[0].value=value;assert.deepEqual(policy.verifyBuildResult(plan,build,s.expected),s.built);}
  const a=fixture.artifact(plan,s.build,s.config),occurrence=a.provenance_summary.provenance[0];
  occurrence.build.inTotoSlsaProvenanceV1.gcloudEncodingFixture='>';
  occurrence.envelope=fixture.sign(occurrence.build.inTotoSlsaProvenanceV1);
  const payloadVariants=protoJsonBytes(occurrence.envelope.payload);assert.equal(payloadVariants.length,4);
  const signatureVariants=protoJsonBytes(occurrence.envelope.signatures[0].sig);
  for(const payload of payloadVariants)for(const sig of signatureVariants){const candidate=structuredClone(a),envelope=candidate.provenance_summary.provenance[0].envelope;envelope.payload=payload;envelope.signatures[0].sig=sig;assert.equal(policy.verifyArtifactProvenance(plan,candidate,s.build,s.expected,s.built),true);}
 } finally {verify.mock.restore();}
});
test('malformed or mixed-alphabet base64 remains rejected at both ProtoJSON byte boundaries',()=>{
 const s=scenario('fbff'.repeat(16));
 const hash=Object.values(s.build.sourceProvenance.fileHashes)[0].fileHash[0];
 hash.value=fixture.gcloudBase64(hash.value).replace('-', '+');
 assert.throws(()=>policy.verifyBuildResult(plan,s.build,s.expected),/source-hash-mismatch/);
 const a=fixture.artifact(plan,s.build,s.config),occurrence=a.provenance_summary.provenance[0];
 occurrence.envelope.payload+=' ';
 assert.throws(()=>policy.googleSignedStatement(occurrence.envelope),/provenance-envelope-invalid/);
});
test('missing or wrong provenance/signature is rejected by the production Google key',()=>{
 const s=scenario(),a=fixture.artifact(plan,s.build,s.config);
 assert.throws(()=>policy.verifyArtifactProvenance(plan,a,s.build,s.expected,s.built),/signature-invalid/);
 a.provenance_summary.provenance=[];assert.throws(()=>policy.verifyArtifactProvenance(plan,a,s.build,s.expected,s.built),/provenance-build-mismatch/);
});
test('signed provenance binds build identity, builder, configuration and output',()=>{
 const verify=fixture.mockGoogleSignature(mock);
 try {
  const s=scenario();const original=fixture.artifact(plan,s.build,s.config);
  assert.equal(policy.verifyArtifactProvenance(plan,original,s.build,s.expected,s.built),true);
  const mutations=[
   x=>x.subject[0].digest.sha256='d'.repeat(64),
   x=>x.subject[0].name='https://other/image',
   x=>x.predicate.runDetails.metadata.invocationId+='-other',
   x=>x.predicate.runDetails.builder.id='https://other/builder',
   x=>delete x.predicate.buildDefinition.externalParameters.buildConfig,
   x=>x.predicate.buildDefinition.externalParameters.buildConfig=Buffer.from(JSON.stringify({steps:[{name:'substituted'}],options:s.config.options})).toString('base64'),
   x=>x.predicate.buildDefinition.resolvedDependencies[0].digest.sha256='d'.repeat(64)
  ];
  for(const mutate of mutations){const a=structuredClone(original),o=a.provenance_summary.provenance[0];mutate(o.build.inTotoSlsaProvenanceV1);o.envelope=fixture.sign(o.build.inTotoSlsaProvenanceV1);assert.throws(()=>policy.verifyArtifactProvenance(plan,a,s.build,s.expected,s.built),/e1\/authority-/);}
  const a=structuredClone(original);a.provenance_summary.provenance[0].envelope.payload+='x';assert.throws(()=>policy.verifyArtifactProvenance(plan,a,s.build,s.expected,s.built),/provenance-envelope/);
 } finally {verify.mock.restore();}
});
test('build-only persists a sealed receipt and cannot inspect or replace the service',()=>withStaged((p,staged,work)=>{
 const f=fixture.buildSpawn(p),receipt=path.join(work,'build.json');
 const submitted=deploy.submitAuthorityBuild(p,staged,work,receipt,f.spawn);
 assert.equal(submitted.state,'submitted');assert.equal(fs.statSync(receipt).mode&0o777,0o600);
 assert.equal(policy.verifyBuildReceipt(p,deploy.readPrivateJson(receipt)).buildId,fixture.BUILD_ID);
 assert.deepEqual(f.calls.map(c=>c.slice(1,3)),[['builds','submit']]);
 assert.equal(f.calls.some(c=>c.includes('replace')),false);
}));
test('replacement rejects fabricated build objects before any cloud command',()=>{
 let calls=0;assert.throws(()=>deploy.replaceAuthority({...plan,mode:'replace',deploymentAllowed:true},{image:`${plan.target.imageUri}@${fixture.DIGEST}`},os.tmpdir(),()=>calls++),/unverified-build/);assert.equal(calls,0);
});
test('a changed qualification receipt is rejected before any cloud read or replacement',()=>withStaged((p,staged,work)=>{
 const f=fixture.buildSpawn(p),receipt=path.join(work,'build.json'),qualification=path.join(work,'qualification.json');
 deploy.submitAuthorityBuild(p,staged,work,receipt,f.spawn);
 const verify=fixture.mockGoogleSignature(mock);
 try{deploy.qualifyAuthorityBuild({...p,mode:'qualify'},receipt,qualification,work,f.spawn);}finally{verify.mock.restore();}
 const changed=JSON.parse(fs.readFileSync(qualification));changed.imageDigest=`sha256:${'d'.repeat(64)}`;
 fs.writeFileSync(qualification,`${JSON.stringify(changed)}\n`);
 const before=f.calls.length;
 assert.throws(()=>deploy.requalifyAuthorityBuild({...p,mode:'replace'},receipt,qualification,work,f.spawn),/qualification-receipt-invalid/);
 assert.equal(f.calls.length,before);
}));
test('invalid build result never reaches artifact lookup or service replacement',()=>withStaged((p,staged,work)=>{
 const f=fixture.buildSpawn(p,{mutateBuild:b=>b.status='FAILURE'}),receipt=path.join(work,'build.json'),qualification=path.join(work,'qualification.json');
 deploy.submitAuthorityBuild(p,staged,work,receipt,f.spawn);
 assert.throws(()=>deploy.qualifyAuthorityBuild({...p,mode:'qualify'},receipt,qualification,work,f.spawn),/identity-or-status/);
 assert.deepEqual(f.calls.map(c=>c.slice(1,3)),[['builds','submit'],['builds','describe']]);
}));
