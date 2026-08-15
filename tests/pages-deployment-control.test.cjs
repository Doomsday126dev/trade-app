const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const YAML=require('yaml');

const root=path.resolve(process.env.PAGES_SOURCE_DIR||path.join(__dirname,'..'));
const reusableText=fs.readFileSync(path.join(root,'.github/workflows/pages-release-control.yml'),'utf8');
const dispatcherPath=path.join(root,'.github/workflows/deploy-pages.yml');
const dispatcherExists=fs.existsSync(dispatcherPath);
const dispatcherText=dispatcherExists?fs.readFileSync(dispatcherPath,'utf8'):'';
const reusable=YAML.parse(reusableText),dispatcher=dispatcherExists?YAML.parse(dispatcherText):null;
const validator=require(path.join(root,'scripts/pages/validate-release.cjs'));
const builder=require(path.join(root,'scripts/pages/build-artifact.cjs'));
const verifier=require(path.join(root,'scripts/pages/verify-deployment.cjs'));

const RUNTIME_SHA='d7491e83a917bdbbf341bfb68fc947549557a54e';
const PREVIOUS_SHA='4505828ca7fc8f48ca1b23dfcadf860691e6e588';
const DISPATCHER_SHA='b'.repeat(40),OTHER_DISPATCHER='e'.repeat(40),CONTROL_SHA='c'.repeat(40);
const RELEASE_ID='2026-08-05.46',RUNTIME_TAG=`release-${RELEASE_ID}`;
const SELECTOR=`release-pages-control-${DISPATCHER_SHA}`;
const RUN_ID='31861434906',ARTIFACT_DIGEST='98fd4696359e7cbc478ef808fe86f57094ae48d59c2f1a2bee55de913556efe4';
const DEPLOYMENT_ID=5916645350;

function validContext(overrides={}){
  return{
    runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,
    expectedLiveSha:RUNTIME_SHA,githubSha:DISPATCHER_SHA,checkedOutSha:RUNTIME_SHA,
    refType:'tag',refName:SELECTOR,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,
    mode:'release',confirmation:`DEPLOY ${RUNTIME_TAG} ${RUNTIME_SHA} VIA ${SELECTOR}`,
    controlWorkflowSha:CONTROL_SHA,jobWorkflowSha:CONTROL_SHA,...overrides
  };
}
function rejectContext(overrides,pattern){assert.throws(()=>validator.validateDispatchContext(validContext(overrides)),pattern);}
function tempDir(){return fs.mkdtempSync(path.join(os.tmpdir(),'pages-control-'));}
function jsonResponse(value,status=200){return{ok:status>=200&&status<300,status,json:async()=>value,text:async()=>JSON.stringify(value)};}
function textResponse(value,status=200,extra={}){return{ok:status>=200&&status<300,status,text:async()=>value,json:async()=>JSON.parse(value),...extra};}
function runLogUrl(runId=RUN_ID,jobId='94955481756'){return`https://github.com/owner/repo/actions/runs/${runId}/job/${jobId}`;}
function currentDeployment(overrides={}){return{id:DEPLOYMENT_ID,sha:DISPATCHER_SHA,ref:SELECTOR,environment:'github-pages',created_at:'2026-08-15T03:18:13Z',...overrides};}
function legacyManifest(overrides={}){
  return{schema_version:1,source_sha:RUNTIME_SHA,release_id:RELEASE_ID,release_tag:RUNTIME_TAG,github_run_id:RUN_ID,control_workflow_sha:'f26986786d9c8fe70857f78b777bf35c311fd8de',artifact_digest:ARTIFACT_DIGEST,artifact_digest_algorithm:builder.DIGEST_ALGORITHM,...overrides};
}
function currentManifest(overrides={}){
  return{schema_version:2,source_sha:RUNTIME_SHA,release_id:RELEASE_ID,release_tag:RUNTIME_TAG,deployment_selector:SELECTOR,dispatcher_sha:DISPATCHER_SHA,github_run_id:RUN_ID,control_workflow_sha:CONTROL_SHA,artifact_digest:ARTIFACT_DIGEST,artifact_digest_algorithm:builder.DIGEST_ALGORITHM,...overrides};
}
function runtimeFiles(manifest=currentManifest()){
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Map([
    ['deployment-manifest.json',JSON.stringify(manifest)],['index.html',index],
    ['js/domain/clientRelease.js',fs.readFileSync(path.join(root,'js/domain/clientRelease.js'),'utf8')],
    ['sw.js',fs.readFileSync(path.join(root,'sw.js'),'utf8')]
  ]);
  for(const src of verifier.firstPartyScripts(index)){
    const file=new URL(src,verifier.PAGES_ORIGIN).pathname.replace('/trade-app/','');
    if(!files.has(file))files.set(file,'ok');
  }
  return files;
}
function pagesFetch(files,{manifestSequence=[]}={}){
  let manifestReads=0;
  return async url=>{
    const parsed=new URL(url),file=parsed.pathname.replace('/trade-app/','');
    if(file==='deployment-manifest.json'&&manifestSequence.length){
      const value=manifestSequence[Math.min(manifestReads++,manifestSequence.length-1)];
      return textResponse(JSON.stringify(value));
    }
    return textResponse(files.get(file)||'',files.has(file)?200:404);
  };
}
function git(rootDir,args){const result=spawnSync('git',args,{cwd:rootDir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();}

test('trusted control is workflow_call only and dispatcher is workflow_dispatch only',()=>{
  assert.deepEqual(Object.keys(reusable.on),['workflow_call']);
  for(const trigger of ['push','pull_request','pull_request_target','release','schedule','create','workflow_dispatch'])assert.equal(reusable.on[trigger],undefined);
  if(dispatcher){
    assert.deepEqual(Object.keys(dispatcher.on),['workflow_dispatch']);
    for(const trigger of ['push','pull_request','pull_request_target','release','schedule','create'])assert.equal(dispatcher.on[trigger],undefined);
  }
});

test('dispatcher exposes runtime inputs and derives control identity from immutable GitHub context',{skip:!dispatcherExists},()=>{
  assert.deepEqual(Object.keys(dispatcher.on.workflow_dispatch.inputs),['runtime_source_sha','runtime_release_id','runtime_release_tag','expected_live_sha','mode','confirmation']);
  const job=dispatcher.jobs.deploy,match=job.uses.match(/@([0-9a-f]{40})$/);
  assert.ok(match);assert.equal(job.with.control_workflow_sha,match[1]);
  assert.equal(job.with.control_selector_tag,'${{ github.ref_name }}');assert.equal(job.with.dispatcher_sha,'${{ github.sha }}');
  assert.equal(job.with.runtime_source_sha,'${{ inputs.runtime_source_sha }}');
  assert.doesNotMatch(job.uses,/@(?:main|master|HEAD|latest)$/);
});

test('control-selector validation accepts only a full dispatcher-SHA tag',()=>{
  const result=validator.validateDispatchContext(validContext());
  assert.equal(result.controlSelectorTag,SELECTOR);assert.equal(result.runtimeSourceSha,RUNTIME_SHA);
  rejectContext({refType:'branch'},/requires a tag/);
  rejectContext({refName:RUNTIME_TAG,controlSelectorTag:RUNTIME_TAG},/Control selector/);
  rejectContext({refName:`release-pages-control-${DISPATCHER_SHA.slice(0,12)}`,controlSelectorTag:`release-pages-control-${DISPATCHER_SHA.slice(0,12)}`},/Control selector/);
  rejectContext({dispatcherSha:OTHER_DISPATCHER},/Control selector/);
  rejectContext({githubSha:OTHER_DISPATCHER},/dispatcher_sha/);
  rejectContext({controlSelectorTag:`release-pages-control-${OTHER_DISPATCHER}`},/Control selector/);
});

test('runtime identity is independent and confirmation names runtime plus control selector',()=>{
  rejectContext({runtimeReleaseTag:'release-2026-08-05.45'},/Runtime tag/);
  rejectContext({checkedOutSha:PREVIOUS_SHA},/runtime_source_sha/);
  rejectContext({jobWorkflowSha:OTHER_DISPATCHER},/control SHA/);
  rejectContext({confirmation:'yes'},/Confirmation must exactly equal/);
  const rollback=validContext({mode:'rollback',confirmation:`ROLLBACK ${RUNTIME_TAG} ${RUNTIME_SHA} FROM ${RUNTIME_SHA} VIA ${SELECTOR}`});
  assert.equal(validator.validateDispatchContext(rollback).mode,'rollback');
});

test('runtime tag must resolve exactly to checked-out runtime source SHA',()=>{
  const repo=tempDir();git(repo,['init','-q']);git(repo,['config','user.email','pages@example.test']);git(repo,['config','user.name','Pages Test']);
  fs.writeFileSync(path.join(repo,'runtime.txt'),'one');git(repo,['add','.']);git(repo,['commit','-qm','runtime']);
  const runtimeSha=git(repo,['rev-parse','HEAD']);git(repo,['branch','-M','main']);git(repo,['update-ref','refs/remotes/origin/main',runtimeSha]);git(repo,['tag',RUNTIME_TAG,runtimeSha]);
  assert.equal(validator.validateGitHistory(repo,runtimeSha,RUNTIME_TAG),true);
  fs.writeFileSync(path.join(repo,'runtime.txt'),'two');git(repo,['commit','-qam','other']);
  const otherSha=git(repo,['rev-parse','HEAD']);git(repo,['update-ref','refs/remotes/origin/main',otherSha]);
  assert.throws(()=>validator.validateGitHistory(repo,otherSha,RUNTIME_TAG),/does not resolve/);
  fs.rmSync(repo,{recursive:true,force:true});
});

test('workflow checks out runtime_source_sha, never github.sha, and preserves immutable action pins',()=>{
  const job=reusable.jobs['validate-build'],source=job.steps.find(step=>step.name==='Check out approved release source');
  assert.equal(source.with.ref,'${{ inputs.runtime_source_sha }}');assert.notEqual(source.with.ref,'${{ github.sha }}');
  const uses=[...reusableText.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(match=>match[1]);
  for(const value of uses)assert.match(value,/@[0-9a-f]{40}$/);
  assert.match(reusableText,/actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
  assert.match(reusableText,/actions\/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b/);
  assert.match(reusableText,/actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/);
});

test('workflow permissions remain minimal and deploy/build jobs stay separate',()=>{
  assert.deepEqual(reusable.permissions,{});assert.deepEqual(reusable.jobs['validate-build'].permissions,{contents:'read'});
  assert.deepEqual(reusable.jobs.deploy.permissions,{contents:'read',deployments:'read',pages:'write','id-token':'write'});
  assert.equal(reusable.jobs.deploy.needs,'validate-build');assert.equal(reusable.concurrency['cancel-in-progress'],false);
  if(dispatcher)assert.deepEqual(dispatcher.permissions,{});
});

test('reviewed frontend allowlist stays at 68 files and excludes control/private trees',()=>{
  const result=validator.validateReleaseCoherence(root,{expectedReleaseId:RELEASE_ID});
  assert.equal(result.files.length,68);assert.equal(result.scriptCount,60);
  for(const file of result.files)assert.doesNotMatch(file,/^(?:functions|tests|docs|\.github|\.local|node_modules|screenshots|logs)\//);
});

test('runtime release coherence rejects mixed runtime assets',()=>{
  const fixture=tempDir(),reviewed=validator.validateReleaseCoherence(root);
  for(const file of reviewed.files){const target=path.join(fixture,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
  const manifestTarget=path.join(fixture,'scripts/pages/frontend-files.json');fs.mkdirSync(path.dirname(manifestTarget),{recursive:true});fs.copyFileSync(path.join(root,'scripts/pages/frontend-files.json'),manifestTarget);
  const client=path.join(fixture,'js/domain/clientRelease.js');fs.writeFileSync(client,fs.readFileSync(client,'utf8').replace(RELEASE_ID,'2026-08-05.45'));
  assert.throws(()=>validator.validateReleaseCoherence(fixture),/Mixed release/);fs.rmSync(fixture,{recursive:true,force:true});
});

test('schema 2 artifact records distinct runtime and control provenance without changing runtime digest',()=>{
  const output=tempDir();
  const result=builder.buildArtifact({source:root,output,runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,githubRunId:RUN_ID,controlWorkflowSha:CONTROL_SHA});
  assert.equal(result.schema_version,2);assert.equal(result.source_sha,RUNTIME_SHA);assert.equal(result.release_tag,RUNTIME_TAG);
  assert.equal(result.deployment_selector,SELECTOR);assert.equal(result.dispatcher_sha,DISPATCHER_SHA);assert.equal(result.artifact_digest,ARTIFACT_DIGEST);
  assert.equal(builder.walk(output).length,69);fs.rmSync(output,{recursive:true,force:true});
});

test('artifact builder rejects runtime-tag and selector mismatches and non-empty output',()=>{
  const options={source:root,runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,githubRunId:RUN_ID,controlWorkflowSha:CONTROL_SHA};
  const a=tempDir();assert.throws(()=>builder.buildArtifact({...options,output:a,runtimeReleaseTag:'release-2026-08-05.45'}),/runtime_release_tag/);fs.rmSync(a,{recursive:true,force:true});
  const b=tempDir();assert.throws(()=>builder.buildArtifact({...options,output:b,controlSelectorTag:`release-pages-control-${OTHER_DISPATCHER}`}),/selector/);fs.rmSync(b,{recursive:true,force:true});
  const c=tempDir();fs.writeFileSync(path.join(c,'unexpected'),'no');assert.throws(()=>builder.buildArtifact({...options,output:c}),/must be empty/);fs.rmSync(c,{recursive:true,force:true});
});

test('legacy manifest is accepted only for predeploy compatibility',()=>{
  assert.equal(verifier.parseDeploymentManifest(JSON.stringify(legacyManifest()),{allowLegacy:true}).schema_version,1);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(legacyManifest())),/not accepted post-deploy/);
  assert.equal(verifier.parseDeploymentManifest(JSON.stringify(currentManifest())).schema_version,2);
});

test('manifest parsing is strict and rejects malformed, extra, or contradictory provenance',()=>{
  assert.throws(()=>verifier.parseDeploymentManifest('{'),/invalid JSON/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({extra:true}))),/fields are not exact/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({deployment_selector:`release-pages-control-${OTHER_DISPATCHER}`}))),/control selector/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({release_tag:'release-2026-08-05.45'}))),/release identity/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({dispatcher_sha:OTHER_DISPATCHER}))),/control selector/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({control_workflow_sha:OTHER_DISPATCHER})),{expected:{control_workflow_sha:CONTROL_SHA}}),/control_workflow_sha mismatch/);
  assert.throws(()=>verifier.parseDeploymentManifest(JSON.stringify(currentManifest({artifact_digest:'0'.repeat(64)})),{expected:{artifact_digest:ARTIFACT_DIGEST}}),/artifact_digest mismatch/);
});

test('predeploy trusts served d749 manifest even when latest successful GitHub metadata remains 450',async()=>{
  const files=runtimeFiles(legacyManifest()),fetchPages=pagesFetch(files);
  const fetchImpl=async url=>{
    const parsed=new URL(url);
    if(parsed.origin!=='https://api.github.com')return fetchPages(url);
    const key=parsed.pathname.replace('/repos/owner/repo','')+parsed.search;
    if(key==='/deployments?environment=github-pages&per_page=30')return jsonResponse([{id:1,sha:PREVIOUS_SHA,created_at:'2026-08-13T20:17:27Z'}]);
    if(key==='/deployments/1/statuses?per_page=20')return jsonResponse([{state:'success'}]);
    return jsonResponse([]);
  };
  const result=await verifier.verifyExpectedLiveSha({fetchImpl,repository:'owner/repo',token:'token',expectedLiveSha:RUNTIME_SHA},{attempts:1,delayMs:0});
  assert.equal(result.sourceSha,RUNTIME_SHA);assert.equal(result.latestSuccessfulSha,PREVIOUS_SHA);assert.equal(result.latestSuccessfulMatches,false);
});

test('predeploy retries stale served manifest but fails closed when it never converges',async()=>{
  const stale=legacyManifest({source_sha:PREVIOUS_SHA}),current=legacyManifest(),files=runtimeFiles(current);
  const passing=await verifier.verifyExpectedLiveSha({fetchImpl:pagesFetch(files,{manifestSequence:[stale,current]}),expectedLiveSha:RUNTIME_SHA},{attempts:2,delayMs:0});
  assert.equal(passing.sourceSha,RUNTIME_SHA);
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl:pagesFetch(files,{manifestSequence:[stale]}),expectedLiveSha:RUNTIME_SHA},{attempts:2,delayMs:0}),/source_sha mismatch/);
});

test('predeploy rejects missing, malformed, redirected, and wrong-origin manifest requests',async()=>{
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl:async()=>textResponse('',404),expectedLiveSha:RUNTIME_SHA},{attempts:1,delayMs:0}),/failed/);
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl:async()=>textResponse('{'),expectedLiveSha:RUNTIME_SHA},{attempts:1,delayMs:0}),/invalid JSON/);
  await assert.rejects(verifier.verifyExpectedLiveSha({fetchImpl:async()=>textResponse('',302,{headers:{location:'https://evil.test/'}}),expectedLiveSha:RUNTIME_SHA},{attempts:1,delayMs:0}),/redirected/);
  assert.throws(()=>verifier.normalizeOrigin('https://example.test/trade-app/'),/reviewed production origin/);
});

test('current-run deployment binds dispatcher SHA and control selector, not runtime tag',async()=>{
  const fetchImpl=async url=>{
    const parsed=new URL(url),path=parsed.pathname.replace('/repos/owner/repo','');
    if(path==='/deployments')return jsonResponse([currentDeployment()]);
    if(path===`/deployments/${DEPLOYMENT_ID}/statuses`)return jsonResponse([{state:'in_progress',log_url:runLogUrl()}]);
    return jsonResponse([]);
  };
  const selected=await verifier.currentRunDeployment({fetchImpl,repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR});
  assert.equal(selected.sha,DISPATCHER_SHA);assert.equal(selected.ref,SELECTOR);assert.notEqual(selected.ref,RUNTIME_TAG);
});

test('current-run matching rejects concurrent, zero, multiple, wrong selector, and finalized deployments',async()=>{
  const current=currentDeployment(),other=currentDeployment({id:DEPLOYMENT_ID+1});
  const statuses=new Map([[current.id,[{state:'in_progress',log_url:runLogUrl()}]],[other.id,[{state:'in_progress',log_url:runLogUrl('999','111')}]]]);
  const makeFetch=(deployments,map=statuses)=>async url=>{const parsed=new URL(url),p=parsed.pathname.replace('/repos/owner/repo','');if(p==='/deployments')return jsonResponse(deployments);const id=Number(p.match(/deployments\/(\d+)\/statuses/)?.[1]);return jsonResponse(map.get(id)||[]);};
  assert.equal((await verifier.currentRunDeployment({fetchImpl:makeFetch([other,current]),repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR})).id,current.id);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([]),repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR}),/found 0/);
  const both=new Map([[current.id,[{state:'in_progress',log_url:runLogUrl()}]],[other.id,[{state:'in_progress',log_url:runLogUrl(RUN_ID,'222')}]]]);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([current,other],both),repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR}),/found 2/);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([currentDeployment({ref:RUNTIME_TAG})]),repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR}),/found 0/);
  const finalized=new Map([[current.id,[{state:'success',log_url:runLogUrl()}]]]);
  await assert.rejects(verifier.currentRunDeployment({fetchImpl:makeFetch([current],finalized),repository:'owner/repo',token:'token',runId:RUN_ID,dispatcherSha:DISPATCHER_SHA,controlSelectorTag:SELECTOR}),/found 0/);
});

test('postdeploy requires schema 2 and exact runtime/control provenance',async()=>{
  const files=runtimeFiles(),fetchImpl=pagesFetch(files);
  const result=await verifier.verifyServedDeployment({fetchImpl,siteOrigin:verifier.PAGES_ORIGIN,runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,controlWorkflowSha:CONTROL_SHA,runId:RUN_ID,expectedArtifactDigest:ARTIFACT_DIGEST});
  assert.equal(result.sourceSha,RUNTIME_SHA);assert.equal(result.deploymentSelector,SELECTOR);assert.equal(result.scriptCount,60);
  files.set('deployment-manifest.json',JSON.stringify(legacyManifest()));
  await assert.rejects(verifier.verifyServedDeployment({fetchImpl:pagesFetch(files),siteOrigin:verifier.PAGES_ORIGIN,runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,controlWorkflowSha:CONTROL_SHA,runId:RUN_ID,expectedArtifactDigest:ARTIFACT_DIGEST}),/not accepted post-deploy/);
});

test('postdeploy retries old live manifest, then proves current deployment and exact new artifact',async()=>{
  const files=runtimeFiles(),fetchPages=pagesFetch(files,{manifestSequence:[legacyManifest(),currentManifest()]});
  const fetchImpl=async url=>{
    const parsed=new URL(url);
    if(parsed.origin!=='https://api.github.com')return fetchPages(url);
    const p=parsed.pathname.replace('/repos/owner/repo','');
    if(p==='/deployments')return jsonResponse([currentDeployment()]);
    if(p===`/deployments/${DEPLOYMENT_ID}/statuses`)return jsonResponse([{state:'in_progress',log_url:runLogUrl()}]);
    return jsonResponse([]);
  };
  const options={fetchImpl,repository:'owner/repo',token:'token',runId:RUN_ID,runtimeSourceSha:RUNTIME_SHA,runtimeReleaseId:RELEASE_ID,runtimeReleaseTag:RUNTIME_TAG,controlSelectorTag:SELECTOR,dispatcherSha:DISPATCHER_SHA,controlWorkflowSha:CONTROL_SHA,siteOrigin:verifier.PAGES_ORIGIN,expectedArtifactDigest:ARTIFACT_DIGEST,deployStepConclusion:'success'};
  const result=await verifier.verifyCurrentRunPostDeploy(options,{attempts:2,delayMs:0});
  assert.equal(result.deployment.id,DEPLOYMENT_ID);assert.equal(result.served.artifactDigest,ARTIFACT_DIGEST);
  await assert.rejects(verifier.verifyCurrentRunPostDeploy({...options,deployStepConclusion:'failure'},{attempts:1,delayMs:0}),/did not succeed/);
});

test('current reviewed control can deploy an older immutable runtime in rollback mode',()=>{
  const olderId='2026-08-05.45',olderTag=`release-${olderId}`,olderSha='1'.repeat(40);
  const context=validContext({runtimeSourceSha:olderSha,runtimeReleaseId:olderId,runtimeReleaseTag:olderTag,checkedOutSha:olderSha,mode:'rollback',confirmation:`ROLLBACK ${olderTag} ${olderSha} FROM ${RUNTIME_SHA} VIA ${SELECTOR}`});
  const result=validator.validateDispatchContext(context);
  assert.equal(result.runtimeSourceSha,olderSha);assert.equal(result.controlSelectorTag,SELECTOR);assert.equal(result.mode,'rollback');
});

test('package remains validation-only with no local deployment command',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
  assert.ok(pkg.scripts['check:pages-release']);assert.ok(pkg.scripts['test:pages-release']);
  assert.equal(Object.keys(pkg.scripts).some(name=>/^deploy(?::|$)/.test(name)),false);
});
