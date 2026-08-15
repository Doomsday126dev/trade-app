#!/usr/bin/env node
'use strict';

const {SHA_RE,RELEASE_RE,controlSelectorTag:expectedControlSelectorTag}=require('./validate-release.cjs');
const RUN_ID_RE=/^[1-9][0-9]*$/;
const DIGEST_RE=/^[0-9a-f]{64}$/;
const DEPLOYMENT_ENVIRONMENT='github-pages';
const DIGEST_ALGORITHM='sha256-path-null-content-sha256-v1';
const PAGES_ORIGIN='https://doomsday126dev.github.io/trade-app/';
const LEGACY_MANIFEST_FIELDS=['schema_version','source_sha','release_id','release_tag','github_run_id','control_workflow_sha','artifact_digest','artifact_digest_algorithm'];
const CURRENT_MANIFEST_FIELDS=['schema_version','source_sha','release_id','release_tag','deployment_selector','dispatcher_sha','github_run_id','control_workflow_sha','artifact_digest','artifact_digest_algorithm'];

function fail(message){throw new Error(message);}
function normalizeOrigin(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('Pages origin must be a clean HTTPS origin/path');
  const normalized=url.href.endsWith('/')?url.href:`${url.href}/`;
  if(normalized!==PAGES_ORIGIN)fail('Pages origin does not match the reviewed production origin');
  return normalized;
}
function deploymentSha(deployment){return deployment.sha||deployment.ref||deployment.payload?.sha||'';}
async function githubJson(fetchImpl,url,token){
  const response=await fetchImpl(url,{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2022-11-28'},cache:'no-store'});
  if(!response.ok)fail(`GitHub provenance request failed (${response.status})`);
  return response.json();
}
async function latestSuccessfulDeployment({fetchImpl=fetch,repository,token}){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))fail('Invalid GITHUB_REPOSITORY');
  if(!token)fail('GITHUB_TOKEN is required for deployment provenance');
  const base=`https://api.github.com/repos/${repository}`;
  const deployments=await githubJson(fetchImpl,`${base}/deployments?environment=github-pages&per_page=30`,token);
  const sorted=[...deployments].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  for(const deployment of sorted){
    const statuses=await githubJson(fetchImpl,`${base}/deployments/${deployment.id}/statuses?per_page=20`,token);
    if(statuses[0]?.state==='success'){
      const sha=deploymentSha(deployment);
      if(!SHA_RE.test(sha))fail('Successful GitHub deployment has no exact source SHA');
      return{sha,id:deployment.id,createdAt:deployment.created_at};
    }
  }
  fail('No successful github-pages deployment provenance found');
}
function assertPagesUrl(value){
  const url=value instanceof URL?value:new URL(value),root=new URL(PAGES_ORIGIN);
  if(url.protocol!=='https:'||url.origin!==root.origin||!url.pathname.startsWith(root.pathname)||url.username||url.password)fail('Served asset URL escapes the reviewed Pages origin');
  return url;
}
async function fetchText(fetchImpl,url,{timeoutMs=10000}={}){
  const target=assertPagesUrl(url),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{response=await fetchImpl(target,{cache:'no-store',redirect:'manual',headers:{'cache-control':'no-cache'},signal:controller.signal});}
  catch(error){fail(`Served asset request failed: ${error.message}`);}
  finally{clearTimeout(timer);}
  if(response.status>=300&&response.status<400)fail('Served asset redirected unexpectedly');
  if(response.url)assertPagesUrl(response.url);
  if(!response.ok)fail(`Served asset failed: ${target} (${response.status})`);
  return response.text();
}
function exactFields(value,fields){
  if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...fields].sort()))fail('Served deployment manifest fields are not exact');
}
function parseDeploymentManifest(text,{allowLegacy=false,expected={}}={}){
  let value;
  try{value=JSON.parse(text);}catch{fail('Served deployment manifest is invalid JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Served deployment manifest must be an object');
  if(value.schema_version===1){
    if(!allowLegacy)fail('Legacy deployment manifest is not accepted post-deploy');
    exactFields(value,LEGACY_MANIFEST_FIELDS);
  }else if(value.schema_version===2)exactFields(value,CURRENT_MANIFEST_FIELDS);
  else fail('Unsupported deployment manifest schema');
  if(!SHA_RE.test(value.source_sha||'')||!SHA_RE.test(value.control_workflow_sha||''))fail('Served deployment manifest contains an invalid SHA');
  if(!RELEASE_RE.test(value.release_id||'')||value.release_tag!==`release-${value.release_id}`)fail('Served deployment manifest release identity is invalid');
  if(!RUN_ID_RE.test(String(value.github_run_id||'')))fail('Served deployment manifest run ID is invalid');
  if(!DIGEST_RE.test(value.artifact_digest||'')||value.artifact_digest_algorithm!==DIGEST_ALGORITHM)fail('Served deployment manifest artifact digest is invalid');
  if(value.schema_version===2&&(!SHA_RE.test(value.dispatcher_sha||'')||value.deployment_selector!==expectedControlSelectorTag(value.dispatcher_sha)))fail('Served deployment manifest control selector is invalid');
  for(const[key,expectedValue]of Object.entries(expected))if(value[key]!==expectedValue)fail(`Served deployment manifest ${key} mismatch`);
  return value;
}
async function retryVerification(operation,{attempts=24,delayMs=5000}={}){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await operation();}catch(error){lastError=error;if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,delayMs));}
  }
  throw lastError;
}
async function readLiveManifest({fetchImpl=fetch,expectedLiveSha},retryOptions){
  if(!SHA_RE.test(expectedLiveSha||''))fail('expected_live_sha must be a full lowercase SHA');
  return retryVerification(async()=>{
    const nonce=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const text=await fetchText(fetchImpl,new URL(`deployment-manifest.json?verify=${nonce}`,PAGES_ORIGIN));
    return parseDeploymentManifest(text,{allowLegacy:true,expected:{source_sha:expectedLiveSha}});
  },retryOptions);
}
async function verifyExpectedLiveSha(options,retryOptions){
  const served=await readLiveManifest(options,retryOptions);
  let latestSuccessful=null,metadataError=null;
  if(options.repository&&options.token){
    try{latestSuccessful=await latestSuccessfulDeployment(options);}catch(error){metadataError=error.message;}
  }
  return{sourceSha:served.source_sha,releaseId:served.release_id,artifactDigest:served.artifact_digest,schemaVersion:served.schema_version,latestSuccessfulSha:latestSuccessful?.sha||null,latestSuccessfulMatches:latestSuccessful?latestSuccessful.sha===served.source_sha:null,metadataError};
}
function statusBelongsToRun({status,repository,runId}){
  if(status?.state!=='in_progress'||typeof status.log_url!=='string')return false;
  let url;
  try{url=new URL(status.log_url);}catch{return false;}
  const prefix=`/${repository}/actions/runs/${runId}/job/`;
  return url.origin==='https://github.com'&&url.search===''&&url.hash===''&&url.pathname.startsWith(prefix)&&/^\d+$/.test(url.pathname.slice(prefix.length));
}
async function currentRunDeployment({fetchImpl=fetch,repository,token,runId,dispatcherSha,controlSelectorTag}){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))fail('Invalid GITHUB_REPOSITORY');
  if(!token)fail('GITHUB_TOKEN is required for deployment provenance');
  if(!RUN_ID_RE.test(String(runId||'')))fail('GITHUB_RUN_ID must be numeric');
  if(!SHA_RE.test(dispatcherSha||''))fail('dispatcher_sha must be a full lowercase SHA');
  if(controlSelectorTag!==expectedControlSelectorTag(dispatcherSha))fail('Invalid control selector tag');
  const base=`https://api.github.com/repos/${repository}`;
  const query=new URLSearchParams({environment:DEPLOYMENT_ENVIRONMENT,sha:dispatcherSha,per_page:'30'});
  const deployments=await githubJson(fetchImpl,`${base}/deployments?${query}`,token),matches=[];
  for(const deployment of deployments){
    if(!Number.isSafeInteger(deployment.id)||deployment.id<=0)continue;
    if(deploymentSha(deployment)!==dispatcherSha||deployment.environment!==DEPLOYMENT_ENVIRONMENT||deployment.ref!==controlSelectorTag)continue;
    const statuses=await githubJson(fetchImpl,`${base}/deployments/${deployment.id}/statuses?per_page=20`,token),current=statuses[0];
    if(!statusBelongsToRun({status:current,repository,runId:String(runId)}))continue;
    matches.push({id:deployment.id,sha:dispatcherSha,ref:deployment.ref,environment:deployment.environment,state:current.state,logUrl:current.log_url,createdAt:deployment.created_at});
  }
  if(matches.length!==1)fail(`Expected exactly one current-run Pages deployment; found ${matches.length}`);
  return matches[0];
}
function parseReleaseText({index,clientRelease,worker}){
  const releases={index:index.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1],client:clientRelease.match(/const RELEASE_ID='([^']+)'/)?.[1],worker:worker.match(/const RELEASE='([^']+)'/)?.[1]};
  if(!Object.values(releases).every(value=>RELEASE_RE.test(value||'')))fail('Served release identifiers are missing');
  if(new Set(Object.values(releases)).size!==1)fail(`Served release is mixed: ${JSON.stringify(releases)}`);
  return releases.index;
}
function firstPartyScripts(index){return[...index.matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!/^https?:\/\//i.test(src));}
async function verifyServedDeployment({fetchImpl=fetch,siteOrigin,runtimeSourceSha,runtimeReleaseId,runtimeReleaseTag,controlSelectorTag,dispatcherSha,controlWorkflowSha,runId,expectedArtifactDigest}){
  for(const[label,value]of [['runtime_source_sha',runtimeSourceSha],['dispatcher_sha',dispatcherSha],['control_workflow_sha',controlWorkflowSha]])if(!SHA_RE.test(value||''))fail(`${label} must be an exact lowercase SHA`);
  if(!RELEASE_RE.test(runtimeReleaseId||'')||runtimeReleaseTag!==`release-${runtimeReleaseId}`)fail('Verification runtime release/tag mismatch');
  if(controlSelectorTag!==expectedControlSelectorTag(dispatcherSha))fail('Verification control selector mismatch');
  if(!RUN_ID_RE.test(String(runId||'')))fail('Verification run ID must be numeric');
  if(!DIGEST_RE.test(expectedArtifactDigest||''))fail('Expected artifact digest must be lowercase SHA-256');
  const origin=normalizeOrigin(siteOrigin),nonce=Date.now().toString(36);
  const [manifest,index,clientRelease,worker]=await Promise.all([
    fetchText(fetchImpl,new URL(`deployment-manifest.json?verify=${nonce}`,origin)),fetchText(fetchImpl,new URL(`index.html?verify=${nonce}`,origin)),
    fetchText(fetchImpl,new URL(`js/domain/clientRelease.js?verify=${nonce}`,origin)),fetchText(fetchImpl,new URL(`sw.js?verify=${nonce}`,origin))
  ]);
  const provenance=parseDeploymentManifest(manifest,{expected:{schema_version:2,source_sha:runtimeSourceSha,release_id:runtimeReleaseId,release_tag:runtimeReleaseTag,deployment_selector:controlSelectorTag,dispatcher_sha:dispatcherSha,github_run_id:String(runId),control_workflow_sha:controlWorkflowSha,artifact_digest:expectedArtifactDigest,artifact_digest_algorithm:DIGEST_ALGORITHM}});
  const servedRelease=parseReleaseText({index,clientRelease,worker});
  if(servedRelease!==runtimeReleaseId)fail(`Served release ${servedRelease} does not match ${runtimeReleaseId}`);
  const scripts=firstPartyScripts(index);
  await Promise.all(scripts.map(async src=>{const url=new URL(src,origin);if(url.searchParams.get('v')!==runtimeReleaseId)fail(`Mixed first-party script URL: ${src}`);await fetchText(fetchImpl,url);}));
  return{sourceSha:provenance.source_sha,releaseId:servedRelease,artifactDigest:provenance.artifact_digest,deploymentSelector:provenance.deployment_selector,scriptCount:scripts.length};
}
async function verifyCurrentRunPostDeploy(options,retryOptions){
  if(options.deployStepConclusion!=='success')fail('deploy-pages step did not succeed');
  return retryVerification(async()=>({deployment:await currentRunDeployment(options),served:await verifyServedDeployment(options)}),retryOptions);
}
async function main(){
  const common={repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,expectedLiveSha:process.env.EXPECTED_LIVE_SHA};
  if(process.argv[2]==='predeploy'){process.stdout.write(`${JSON.stringify(await verifyExpectedLiveSha(common))}\n`);return;}
  if(process.argv[2]==='postdeploy'){
    const result=await verifyCurrentRunPostDeploy({...common,runId:process.env.GITHUB_RUN_ID,runtimeSourceSha:process.env.RUNTIME_SOURCE_SHA,runtimeReleaseId:process.env.RUNTIME_RELEASE_ID,runtimeReleaseTag:process.env.RUNTIME_RELEASE_TAG,controlSelectorTag:process.env.CONTROL_SELECTOR_TAG,dispatcherSha:process.env.DISPATCHER_SHA,controlWorkflowSha:process.env.CONTROL_WORKFLOW_SHA,siteOrigin:process.env.SITE_ORIGIN,expectedArtifactDigest:process.env.EXPECTED_ARTIFACT_DIGEST,deployStepConclusion:process.env.DEPLOY_STEP_CONCLUSION});
    process.stdout.write(`${JSON.stringify(result)}\n`);return;
  }
  fail('Usage: verify-deployment.cjs predeploy|postdeploy');
}
if(require.main===module){main().catch(error=>{console.error(error.message);process.exitCode=1;});}

module.exports={PAGES_ORIGIN,DIGEST_ALGORITHM,normalizeOrigin,latestSuccessfulDeployment,parseDeploymentManifest,readLiveManifest,verifyExpectedLiveSha,statusBelongsToRun,currentRunDeployment,parseReleaseText,firstPartyScripts,verifyServedDeployment,retryVerification,verifyCurrentRunPostDeploy};
