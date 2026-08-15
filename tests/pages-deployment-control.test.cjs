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
const releaseTag=`release-${releaseId}`;
const RUN_ID='31861434906';
const ARTIFACT_DIGEST='d'.repeat(64);
const REHEARSAL_SHA='d7491e83a917bdbbf341bfb68fc947549557a54e';
const PREVIOUS_SHA='4505828ca7fc8f48ca1b23dfcadf860691e6e588';
const REHEARSAL_DEPLOYMENT_ID=5916645350;

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
function jsonResponse(value){return{ok:true,status:200,json:async()=>value,text:async()=>JSON.stringify(value)};}
function textResponse(value,status=200){return{ok:status>=200&&status<300,status,text:async()=>value,json:async()=>JSON.parse(value)};}
function runLogUrl(runId=RUN_ID,jobId='94955481756'){return`https://github.com/owner/repo/actions/runs/${runId}/job/${jobId}`;}
function currentDeployment(overrides={}){
  return{id:REHEARSAL_DEPLOYMENT_ID,sha:REHEARSAL_SHA,ref:releaseTag,environment:'github-pages',created_at:'2026-08-15T03:18:13Z',...overrides};
}

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
  const predeploy=deploy.steps.find(step=>step.run?.includes('verify-deployment.cjs predeploy'));
  const postdeploy=deploy.steps.find(step=>step.run?.includes('verify-deployment.cjs postdeploy'));
  assert.equal(predeploy.env.EXPECTED_LIVE_SHA,'${{ inputs.expected_live_sha }}');
  assert.equal(postdeploy.env.GITHUB_RUN_ID,'${{ github.run_id }}');
  assert.equal(postdeploy.env.EXPECTED_ARTIFACT_DIGEST,'${{ needs.validate-build.outputs.artifact_digest }}');
  assert.equal(postdeploy.env.DEPLOY_STEP_CONCLUSION,'${{ steps.deployment.conclusion }}');
  assert.equal(postdeploy.env.EXPECTED_LIVE_SHA,undefined);
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

test('rehearsal replay proves old verifier selects previous success while current-run verifier selects deployment 5916645350',async()=>{
  const previous={id:5895368699,sha:PREVIOUS_SHA,ref:'main',environment:'github-pages',created_at:'2026-08-13T20:17:27Z'};
  const current=currentDeployment();
  const fetchImpl=async url=>{
    const parsed=new URL(url),key=parsed.pathname.replace('/repos/owner/repo','')+parsed.search;
    if(key==='/deployments?environment=github-pages&per_page=30')return jsonResponse([current,previous]);
    if(key===`/deployments?environment=github-pages&sha=${REHEARSAL_SHA}&per_page=30`)return jsonResponse([current]);
    if(key===`/deployments/${current.id}/statuses?per_page=20`)return jsonResponse([{state:'in_progress',log_url:runLogUrl()}]);
    if(key===`/deployments/${previous.id}/statuses?per_page=20`)return jsonResponse([{state:'success',log_url:'https://github.com/owner/repo/actions/runs/31740072384/job/94581166711'}]);
    return jsonResponse([]);
  };
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl,repository:'owner/repo',token:'test-token',expectedLiveSha:REHEARSAL_SHA}),new RegExp(PREVIOUS_SHA));
  const selected=await verifier.currentRunDeployment({fetchImpl,repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag});
  assert.equal(selected.id,REHEARSAL_DEPLOYMENT_ID);
  assert.equal(selected.state,'in_progress');
});

test('current-run deployment identity rejects previous, concurrent, ambiguous, and finalized deployments',async()=>{
  const current=currentDeployment();
  const concurrent=currentDeployment({id:5916645351,created_at:'2026-08-15T03:18:14Z'});
  const statuses=new Map([
    [current.id,[{state:'in_progress',log_url:runLogUrl()}]],
    [concurrent.id,[{state:'in_progress',log_url:runLogUrl('31861499999','94955499999')}]]
  ]);
  const makeFetch=(deployments,statusOverrides=statuses)=>async url=>{
    const parsed=new URL(url),path=parsed.pathname.replace('/repos/owner/repo','');
    if(path==='/deployments')return jsonResponse(deployments);
    const id=Number(path.match(/^\/deployments\/(\d+)\/statuses$/)?.[1]);
    return jsonResponse(statusOverrides.get(id)||[]);
  };
  const selected=await verifier.currentRunDeployment({fetchImpl:makeFetch([concurrent,current]),repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag});
  assert.equal(selected.id,current.id);

  const ambiguousStatuses=new Map(statuses);
  ambiguousStatuses.set(concurrent.id,[{state:'in_progress',log_url:runLogUrl(RUN_ID,'94955499999')}]);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([current,concurrent],ambiguousStatuses),repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag}),/found 2/);

  const failedStatuses=new Map([[current.id,[{state:'failure',log_url:runLogUrl()}]]]);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([current],failedStatuses),repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag}),/found 0/);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([currentDeployment({sha:PREVIOUS_SHA})]),repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag}),/found 0/);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([currentDeployment({ref:'release-2026-08-05.99'})]),repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseTag}),/found 0/);
  assert.equal(verifier.statusBelongsToRun({status:{state:'success',log_url:runLogUrl()},repository:'owner/repo',runId:RUN_ID}),false);
});

test('served verification ties public manifest, release files, and all first-party script responses together',async()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Map([
    ['deployment-manifest.json',JSON.stringify({schema_version:1,source_sha:SHA_A,release_id:releaseId,release_tag:`release-${releaseId}`,github_run_id:RUN_ID,control_workflow_sha:CONTROL,artifact_digest:ARTIFACT_DIGEST,artifact_digest_algorithm:'sha256-path-null-content-sha256-v1'})],
    ['index.html',index],['js/domain/clientRelease.js',fs.readFileSync(path.join(root,'js/domain/clientRelease.js'),'utf8')],['sw.js',fs.readFileSync(path.join(root,'sw.js'),'utf8')]
  ]);
  for(const src of verifier.firstPartyScripts(index)){
    const file=new URL(src,'https://example.test/trade-app/').pathname.replace('/trade-app/','');
    if(!files.has(file))files.set(file,'ok');
  }
  const fetchImpl=async url=>{const key=new URL(url).pathname.replace('/trade-app/','');return{ok:files.has(key),status:files.has(key)?200:404,text:async()=>files.get(key)};};
  const result=await verifier.verifyServedDeployment({fetchImpl,siteOrigin:'https://example.test/trade-app/',approvedSha:SHA_A,releaseId,releaseTag:`release-${releaseId}`,controlWorkflowSha:CONTROL,runId:RUN_ID,expectedArtifactDigest:ARTIFACT_DIGEST});
  assert.equal(result.scriptCount,60);assert.equal(result.releaseId,releaseId);
  files.set('deployment-manifest.json',JSON.stringify({schema_version:1,source_sha:SHA_A,release_id:releaseId,release_tag:`release-${releaseId}`,github_run_id:'31861499999',control_workflow_sha:CONTROL,artifact_digest:ARTIFACT_DIGEST,artifact_digest_algorithm:'sha256-path-null-content-sha256-v1'}));
  await assert.rejects(verifier.verifyServedDeployment({fetchImpl,siteOrigin:'https://example.test/trade-app/',approvedSha:SHA_A,releaseId,releaseTag,controlWorkflowSha:CONTROL,runId:RUN_ID,expectedArtifactDigest:ARTIFACT_DIGEST}),/github_run_id mismatch/);
  files.set('deployment-manifest.json',JSON.stringify({schema_version:1,source_sha:SHA_A,release_id:releaseId,release_tag:`release-${releaseId}`,github_run_id:RUN_ID,control_workflow_sha:CONTROL,artifact_digest:'e'.repeat(64),artifact_digest_algorithm:'sha256-path-null-content-sha256-v1'}));
  await assert.rejects(verifier.verifyServedDeployment({fetchImpl,siteOrigin:'https://example.test/trade-app/',approvedSha:SHA_A,releaseId,releaseTag,controlWorkflowSha:CONTROL,runId:RUN_ID,expectedArtifactDigest:ARTIFACT_DIGEST}),/artifact_digest mismatch/);
});

test('post-deploy verification retries stale CDN bytes and binds current run, deployment, and artifact',async()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const staleManifest={schema_version:1,source_sha:PREVIOUS_SHA,release_id:releaseId,release_tag:releaseTag,github_run_id:'31740072384',control_workflow_sha:CONTROL,artifact_digest:'e'.repeat(64),artifact_digest_algorithm:'sha256-path-null-content-sha256-v1'};
  const currentManifest={...staleManifest,source_sha:REHEARSAL_SHA,github_run_id:RUN_ID,artifact_digest:ARTIFACT_DIGEST};
  const files=new Map([
    ['index.html',index],['js/domain/clientRelease.js',fs.readFileSync(path.join(root,'js/domain/clientRelease.js'),'utf8')],['sw.js',fs.readFileSync(path.join(root,'sw.js'),'utf8')]
  ]);
  for(const src of verifier.firstPartyScripts(index)){
    const file=new URL(src,'https://example.test/trade-app/').pathname.replace('/trade-app/','');
    if(!files.has(file))files.set(file,'ok');
  }
  let manifestReads=0;
  const fetchImpl=async url=>{
    const parsed=new URL(url);
    if(parsed.origin==='https://api.github.com'){
      const apiPath=parsed.pathname.replace('/repos/owner/repo','');
      if(apiPath==='/deployments')return jsonResponse([currentDeployment()]);
      if(apiPath===`/deployments/${REHEARSAL_DEPLOYMENT_ID}/statuses`)return jsonResponse([{state:'in_progress',log_url:runLogUrl()}]);
      return jsonResponse([]);
    }
    const file=parsed.pathname.replace('/trade-app/','');
    if(file==='deployment-manifest.json')return textResponse(JSON.stringify(++manifestReads===1?staleManifest:currentManifest));
    return textResponse(files.get(file)||'',files.has(file)?200:404);
  };
  const options={fetchImpl,repository:'owner/repo',token:'test-token',runId:RUN_ID,approvedSha:REHEARSAL_SHA,releaseId,releaseTag,controlWorkflowSha:CONTROL,siteOrigin:'https://example.test/trade-app/',expectedArtifactDigest:ARTIFACT_DIGEST,deployStepConclusion:'success'};
  const result=await verifier.verifyCurrentRunPostDeploy(options,{attempts:2,delayMs:0});
  assert.equal(result.deployment.id,REHEARSAL_DEPLOYMENT_ID);
  assert.equal(result.served.artifactDigest,ARTIFACT_DIGEST);
  assert.equal(manifestReads,2);

  manifestReads=0;
  const staleFetch=async url=>{
    const parsed=new URL(url);
    if(parsed.origin==='https://api.github.com')return fetchImpl(url);
    const file=parsed.pathname.replace('/trade-app/','');
    if(file==='deployment-manifest.json')return textResponse(JSON.stringify(staleManifest));
    return textResponse(files.get(file)||'',files.has(file)?200:404);
  };
  await assert.rejects(verifier.verifyCurrentRunPostDeploy({...options,fetchImpl:staleFetch},{attempts:2,delayMs:0}),/source_sha mismatch/);
  await assert.rejects(verifier.verifyCurrentRunPostDeploy({...options,deployStepConclusion:'failure'},{attempts:1,delayMs:0}),/deploy-pages step did not succeed/);
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
