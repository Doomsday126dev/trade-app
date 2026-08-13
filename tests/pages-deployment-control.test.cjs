const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const YAML=require('yaml');

const root=path.resolve(process.env.PAGES_SOURCE_DIR||path.join(__dirname,'..'));
const reusablePath=path.join(root,'.github/workflows/pages-release-control.yml');
const dispatcherPath=path.join(root,'.github/workflows/deploy-pages.yml');
const reusableText=fs.readFileSync(reusablePath,'utf8');
const dispatcherExists=fs.existsSync(dispatcherPath);
const dispatcherText=dispatcherExists?fs.readFileSync(dispatcherPath,'utf8'):'';
const reusable=YAML.parse(reusableText);
const dispatcher=dispatcherExists?YAML.parse(dispatcherText):null;
const validator=require(path.join(root,'scripts/pages/validate-release.cjs'));
const builder=require(path.join(root,'scripts/pages/build-artifact.cjs'));
const verifier=require(path.join(root,'scripts/pages/verify-deployment.cjs'));
const SHA_A='a'.repeat(40),SHA_B='b'.repeat(40),CONTROL='c'.repeat(40);
const releaseId='2026-08-05.46';

function validContext(overrides={}){
  return{
    approvedSha:SHA_A,expectedLiveSha:SHA_B,githubSha:SHA_A,checkedOutSha:SHA_A,
    refType:'tag',refName:`release-${releaseId}`,releaseId,mode:'release',
    confirmation:`DEPLOY release-${releaseId} ${SHA_A}`,
    controlWorkflowSha:CONTROL,jobWorkflowSha:CONTROL,...overrides
  };
}
function expectRejected(overrides,pattern){assert.throws(()=>validator.validateDispatchContext(validContext(overrides)),pattern);}
function tempDir(){return fs.mkdtempSync(path.join(os.tmpdir(),'pages-control-'));}

test('reusable control exposes workflow_call only and has no automatic production trigger',()=>{
  assert.deepEqual(Object.keys(reusable.on),['workflow_call']);
  for(const trigger of ['push','pull_request','pull_request_target','release','schedule','create','workflow_dispatch'])assert.equal(reusable.on[trigger],undefined);
});

test('dispatcher has workflow_dispatch only and no automatic production trigger',{skip:!dispatcherExists},()=>{
  assert.deepEqual(Object.keys(dispatcher.on),['workflow_dispatch']);
  for(const trigger of ['push','pull_request','pull_request_target','release','schedule','create'])assert.equal(dispatcher.on[trigger],undefined);
});

test('dispatcher is a tiny fail-closed placeholder for the later immutable Commit 1 pin',{skip:!dispatcherExists},()=>{
  const job=dispatcher.jobs.deploy;
  const match=job.uses.match(/^Doomsday126dev\/trade-app\/\.github\/workflows\/pages-release-control\.yml@([0-9a-f]{40})$/);
  assert.ok(match,'reusable workflow reference must use a full SHA-shaped ref');
  assert.equal(job.with.control_workflow_sha,match[1]);
  if(match[1]==='0'.repeat(40))assert.match(dispatcherText,/FAIL-CLOSED LOCAL PLACEHOLDER/);
  else assert.notEqual(match[1],'0'.repeat(40));
  assert.doesNotMatch(job.uses,/@(?:main|master|v\d+|latest)$/);
});

test('all action dependencies are immutable full SHAs and source checkout never selects main',()=>{
  const uses=[...reusableText.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(match=>match[1]);
  assert.ok(uses.length>=5);
  for(const value of uses)assert.match(value,/@[0-9a-f]{40}$/);
  assert.doesNotMatch(reusableText,/uses:\s*[^\s]+@(?:main|master|v\d+|latest)\b/);
  const sourceCheckout=reusable.jobs['validate-build'].steps.find(step=>step.name==='Check out approved release source');
  assert.equal(sourceCheckout.with.ref,'${{ inputs.approved_sha }}');
  assert.notEqual(sourceCheckout.with.ref,'main');
  for(const step of reusable.jobs['validate-build'].steps.filter(step=>step.uses?.startsWith('actions/checkout@')))assert.equal(step.with['persist-credentials'],false);
});

test('workflow permissions and production environment are minimal and explicit',()=>{
  assert.deepEqual(reusable.permissions,{});
  if(dispatcher)assert.deepEqual(dispatcher.permissions,{});
  assert.deepEqual(reusable.jobs['validate-build'].permissions,{contents:'read'});
  assert.deepEqual(reusable.jobs.deploy.permissions,{contents:'read',deployments:'read',pages:'write','id-token':'write'});
  if(dispatcher)assert.deepEqual(dispatcher.jobs.deploy.permissions,{contents:'read',deployments:'read',pages:'write','id-token':'write'});
  assert.equal(reusable.jobs.deploy.environment.name,'github-pages');
  assert.equal(reusable.concurrency.group,'pages-production');
  assert.equal(reusable.concurrency['cancel-in-progress'],false);
  for(const forbidden of ['contents: write','actions: write','deployments: write','packages: write','security-events: write'])assert.doesNotMatch(reusableText,new RegExp(forbidden));
});

test('validation/build and environment-gated deployment remain separate jobs',()=>{
  const build=reusable.jobs['validate-build'],deploy=reusable.jobs.deploy;
  assert.equal(deploy.needs,'validate-build');
  assert.ok(build.steps.some(step=>step.uses?.startsWith('actions/upload-pages-artifact@')));
  assert.ok(deploy.steps.some(step=>step.uses?.startsWith('actions/deploy-pages@')));
  assert.equal(deploy.steps.some(step=>/build/i.test(step.name||'')),false);
  assert.match(reusableText,/artifact_name:\s*\$\{\{ needs\.validate-build\.outputs\.artifact_name \}\}/);
});

test('exact tag, SHA, checkout, trusted control, and release confirmation are required',()=>{
  const result=validator.validateDispatchContext(validContext());
  assert.equal(result.approvedSha,SHA_A);
  expectRejected({refType:'branch'},/requires a tag/);
  expectRejected({refName:'release-2026-08-05.45'},/Tag name/);
  expectRejected({approvedSha:'A'.repeat(40)},/lowercase/);
  expectRejected({approvedSha:'abc'},/40 lowercase/);
  expectRejected({githubSha:SHA_B},/must match/);
  expectRejected({checkedOutSha:SHA_B},/must match/);
  expectRejected({jobWorkflowSha:SHA_B},/control SHA/);
  expectRejected({confirmation:'yes'},/Confirmation must exactly equal/);
  const rollback=validContext({mode:'rollback',confirmation:`ROLLBACK release-${releaseId} ${SHA_A} FROM ${SHA_B}`});
  assert.equal(validator.validateDispatchContext(rollback).mode,'rollback');
  expectRejected({mode:'rollback',confirmation:`DEPLOY release-${releaseId} ${SHA_A}`},/Confirmation/);
});

test('reviewed frontend manifest exactly covers runtime references and excludes private/development trees',()=>{
  const result=validator.validateReleaseCoherence(root,{expectedReleaseId:releaseId});
  assert.equal(result.scriptCount,60);
  assert.ok(result.files.includes('index.html'));
  assert.ok(result.files.includes('assets/tradeloop-icon-512.png'));
  for(const file of result.files){
    assert.doesNotMatch(file,/^(?:functions|tests|docs|\.github|\.local|node_modules|screenshots|logs)\//);
    assert.equal(fs.statSync(path.join(root,file)).isFile(),true);
  }
  assert.equal(new Set(result.files).size,result.files.length);
});

test('release coherence rejects a mixed client release before artifact creation',()=>{
  const fixture=tempDir();
  const reviewed=validator.validateReleaseCoherence(root);
  for(const file of reviewed.files){
    const target=path.join(fixture,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,file),target);
  }
  const allowlistTarget=path.join(fixture,'scripts/pages/frontend-files.json');
  fs.mkdirSync(path.dirname(allowlistTarget),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/pages/frontend-files.json'),allowlistTarget);
  const client=path.join(fixture,'js/domain/clientRelease.js');
  fs.writeFileSync(client,fs.readFileSync(client,'utf8').replace(releaseId,'2026-08-05.45'));
  assert.throws(()=>validator.validateReleaseCoherence(fixture),/Mixed release/);
  fs.rmSync(fixture,{recursive:true,force:true});
});

test('selected release cannot broaden the immutable control allowlist',()=>{
  const fixture=tempDir(),reviewed=validator.validateReleaseCoherence(root);
  for(const file of reviewed.files){
    const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);
  }
  const candidateManifest=path.join(fixture,'scripts/pages/frontend-files.json');
  fs.mkdirSync(path.dirname(candidateManifest),{recursive:true});
  fs.writeFileSync(candidateManifest,JSON.stringify({schemaVersion:1,entryFiles:['functions/private.txt'],scriptFiles:[],assetFiles:[]}));
  fs.mkdirSync(path.join(fixture,'functions'),{recursive:true});fs.writeFileSync(path.join(fixture,'functions/private.txt'),'must not ship');
  const result=validator.validateReleaseCoherence(fixture);
  assert.equal(result.files.includes('functions/private.txt'),false);
  fs.rmSync(fixture,{recursive:true,force:true});
});

test('deterministic builds contain only reviewed files plus public provenance',()=>{
  const first=tempDir(),second=tempDir();
  const options={source:root,sourceSha:SHA_A,releaseId,releaseTag:`release-${releaseId}`,githubRunId:'1001',controlWorkflowSha:CONTROL};
  const one=builder.buildArtifact({...options,output:first});
  const two=builder.buildArtifact({...options,output:second,githubRunId:'9999'});
  assert.equal(one.artifact_digest,two.artifact_digest);
  assert.equal(one.artifact_digest_algorithm,builder.DIGEST_ALGORITHM);
  const actual=builder.walk(first);
  assert.ok(actual.includes('deployment-manifest.json'));
  assert.equal(actual.some(file=>/^(?:functions|tests|docs|\.github|scripts)\//.test(file)),false);
  const provenance=JSON.parse(fs.readFileSync(path.join(first,'deployment-manifest.json')));
  assert.deepEqual(Object.keys(provenance),['schema_version','source_sha','release_id','release_tag','github_run_id','control_workflow_sha','artifact_digest','artifact_digest_algorithm']);
  assert.equal(JSON.stringify(provenance).includes(process.cwd()),false);
  fs.rmSync(first,{recursive:true,force:true});fs.rmSync(second,{recursive:true,force:true});
});

test('artifact builder fails closed on a non-empty output directory',()=>{
  const output=tempDir();fs.writeFileSync(path.join(output,'unexpected.txt'),'no');
  assert.throws(()=>builder.buildArtifact({source:root,output,sourceSha:SHA_A,releaseId,releaseTag:`release-${releaseId}`,githubRunId:'1',controlWorkflowSha:CONTROL}),/must be empty/);
  fs.rmSync(output,{recursive:true,force:true});
});

test('expected-live verification uses latest successful GitHub deployment provenance',async()=>{
  const calls=[];
  const fixtures={
    '/deployments?environment=github-pages&per_page=30':[{id:2,sha:SHA_A,created_at:'2026-08-05T02:00:00Z'},{id:1,sha:SHA_B,created_at:'2026-08-05T01:00:00Z'}],
    '/deployments/2/statuses?per_page=20':[{state:'success'}]
  };
  const fetchImpl=async url=>{calls.push(url);const key=new URL(url).pathname.replace('/repos/owner/repo','')+new URL(url).search;return{ok:true,json:async()=>fixtures[key]||[]};};
  const result=await verifier.verifyExpectedLiveSha({fetchImpl,repository:'owner/repo',token:'test-token',expectedLiveSha:SHA_A});
  assert.equal(result.sha,SHA_A);assert.equal(calls.length,2);
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl,repository:'owner/repo',token:'test-token',expectedLiveSha:SHA_B}),/differs/);
});

test('served verification ties public manifest, release files, and all first-party script responses together',async()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Map([
    ['deployment-manifest.json',JSON.stringify({source_sha:SHA_A,release_id:releaseId,release_tag:`release-${releaseId}`,control_workflow_sha:CONTROL,artifact_digest:'d'.repeat(64)})],
    ['index.html',index],['js/domain/clientRelease.js',fs.readFileSync(path.join(root,'js/domain/clientRelease.js'),'utf8')],['sw.js',fs.readFileSync(path.join(root,'sw.js'),'utf8')]
  ]);
  for(const src of verifier.firstPartyScripts(index)){
    const file=new URL(src,'https://example.test/trade-app/').pathname.replace('/trade-app/','');
    if(!files.has(file))files.set(file,'ok');
  }
  const fetchImpl=async url=>{const key=new URL(url).pathname.replace('/trade-app/','');return{ok:files.has(key),status:files.has(key)?200:404,text:async()=>files.get(key)};};
  const result=await verifier.verifyServedDeployment({fetchImpl,siteOrigin:'https://example.test/trade-app/',approvedSha:SHA_A,releaseId,releaseTag:`release-${releaseId}`,controlWorkflowSha:CONTROL});
  assert.equal(result.scriptCount,60);assert.equal(result.releaseId,releaseId);
});

test('post-deploy verification can wait for immutable provenance and served bytes to converge',async()=>{
  let attempts=0;
  const result=await verifier.retryVerification(async()=>{
    attempts++;
    if(attempts<3)throw new Error('not converged');
    return'ok';
  },{attempts:3,delayMs:0});
  assert.equal(result,'ok');assert.equal(attempts,3);
  await assert.rejects(verifier.retryVerification(async()=>{throw new Error('still stale');},{attempts:2,delayMs:0}),/still stale/);
});

test('package exposes validation-only Pages scripts and no deployment command',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  assert.ok(pkg.scripts['check:pages-release']);assert.ok(pkg.scripts['test:pages-release']);
  assert.equal(Object.keys(pkg.scripts).some(name=>/^deploy(?::|$)/.test(name)),false);
});
