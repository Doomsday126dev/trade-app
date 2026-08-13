#!/usr/bin/env node
'use strict';

const {SHA_RE,RELEASE_RE}=require('./validate-release.cjs');

function fail(message){throw new Error(message);}
function normalizeOrigin(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('SITE_ORIGIN must be a clean HTTPS origin/path');
  return url.href.endsWith('/')?url.href:`${url.href}/`;
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
async function verifyExpectedLiveSha(options){
  if(!SHA_RE.test(options.expectedLiveSha||''))fail('expected_live_sha must be a full lowercase SHA');
  const latest=await latestSuccessfulDeployment(options);
  if(latest.sha!==options.expectedLiveSha)fail(`Expected live SHA ${options.expectedLiveSha} differs from latest successful Pages deployment ${latest.sha}`);
  return latest;
}
function parseReleaseText({index,clientRelease,worker}){
  const releases={
    index:index.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1],
    client:clientRelease.match(/const RELEASE_ID='([^']+)'/)?.[1],
    worker:worker.match(/const RELEASE='([^']+)'/)?.[1]
  };
  if(!Object.values(releases).every(value=>RELEASE_RE.test(value||'')))fail('Served release identifiers are missing');
  if(new Set(Object.values(releases)).size!==1)fail(`Served release is mixed: ${JSON.stringify(releases)}`);
  return releases.index;
}
function firstPartyScripts(index){
  return[...index.matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!/^https?:\/\//i.test(src));
}
async function fetchText(fetchImpl,url){
  const response=await fetchImpl(url,{cache:'no-store',headers:{'cache-control':'no-cache'}});
  if(!response.ok)fail(`Served asset failed: ${url} (${response.status})`);
  return response.text();
}
async function retryVerification(operation,{attempts=24,delayMs=5000}={}){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{return await operation();}catch(error){
      lastError=error;
      if(attempt<attempts)await new Promise(resolve=>setTimeout(resolve,delayMs));
    }
  }
  throw lastError;
}
async function verifyServedDeployment({fetchImpl=fetch,siteOrigin,approvedSha,releaseId,releaseTag,controlWorkflowSha}){
  if(!SHA_RE.test(approvedSha||'')||!SHA_RE.test(controlWorkflowSha||''))fail('Verification SHAs must be exact lowercase SHAs');
  if(!RELEASE_RE.test(releaseId||'')||releaseTag!==`release-${releaseId}`)fail('Verification release/tag mismatch');
  const origin=normalizeOrigin(siteOrigin),nonce=Date.now().toString(36);
  const [manifest,index,clientRelease,worker]=await Promise.all([
    fetchText(fetchImpl,new URL(`deployment-manifest.json?verify=${nonce}`,origin)),
    fetchText(fetchImpl,new URL(`index.html?verify=${nonce}`,origin)),
    fetchText(fetchImpl,new URL(`js/domain/clientRelease.js?verify=${nonce}`,origin)),
    fetchText(fetchImpl,new URL(`sw.js?verify=${nonce}`,origin))
  ]);
  const provenance=JSON.parse(manifest);
  for(const[key,expected]of Object.entries({source_sha:approvedSha,release_id:releaseId,release_tag:releaseTag,control_workflow_sha:controlWorkflowSha}))if(provenance[key]!==expected)fail(`Served deployment manifest ${key} mismatch`);
  const servedRelease=parseReleaseText({index,clientRelease,worker});
  if(servedRelease!==releaseId)fail(`Served release ${servedRelease} does not match ${releaseId}`);
  const scripts=firstPartyScripts(index);
  await Promise.all(scripts.map(async src=>{
    const url=new URL(src,origin);
    if(url.searchParams.get('v')!==releaseId)fail(`Mixed first-party script URL: ${src}`);
    await fetchText(fetchImpl,url);
  }));
  return{sourceSha:provenance.source_sha,releaseId:servedRelease,artifactDigest:provenance.artifact_digest,scriptCount:scripts.length};
}
async function main(){
  const common={repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,expectedLiveSha:process.env.EXPECTED_LIVE_SHA};
  if(process.argv[2]==='predeploy'){
    process.stdout.write(`${JSON.stringify(await verifyExpectedLiveSha(common))}\n`);return;
  }
  if(process.argv[2]==='postdeploy'){
    const result=await retryVerification(async()=>({
      deployment:await verifyExpectedLiveSha({...common,expectedLiveSha:process.env.APPROVED_SHA}),
      served:await verifyServedDeployment({siteOrigin:process.env.SITE_ORIGIN,approvedSha:process.env.APPROVED_SHA,releaseId:process.env.RELEASE_ID,releaseTag:process.env.RELEASE_TAG,controlWorkflowSha:process.env.CONTROL_WORKFLOW_SHA})
    }));
    const{deployment,served}=result;
    process.stdout.write(`${JSON.stringify({deployment,served})}\n`);return;
  }
  fail('Usage: verify-deployment.cjs predeploy|postdeploy');
}
if(require.main===module){main().catch(error=>{console.error(error.message);process.exitCode=1;});}

module.exports={normalizeOrigin,latestSuccessfulDeployment,verifyExpectedLiveSha,parseReleaseText,firstPartyScripts,verifyServedDeployment,retryVerification};
