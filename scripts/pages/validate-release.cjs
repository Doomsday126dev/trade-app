#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const SHA_RE=/^[0-9a-f]{40}$/;
const RELEASE_RE=/^\d{4}-\d{2}-\d{2}\.\d+$/;
const FORBIDDEN_PREFIXES=['functions/','tests/','docs/','.github/','.local/','logs/','screenshots/','node_modules/','test-results/','playwright-report/'];
const CONTROL_ROOT=path.resolve(__dirname,'../..');

function fail(message){throw new Error(message);}
function readText(root,file){return fs.readFileSync(path.join(root,file),'utf8');}
function unique(values){return[...new Set(values)];}
function normalizeSha(value,label='SHA'){
  if(!SHA_RE.test(value||''))fail(`${label} must be exactly 40 lowercase hexadecimal characters`);
  return value;
}
function normalizeReleaseId(value){
  if(!RELEASE_RE.test(value||''))fail('release_id must use YYYY-MM-DD.N format');
  return value;
}
function loadFrontendManifest(root,{manifestRoot=CONTROL_ROOT}={}){
  const file=path.join(manifestRoot,'scripts/pages/frontend-files.json');
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  if(manifest.schemaVersion!==1)fail('Unsupported frontend-files manifest schema');
  const groups=['entryFiles','scriptFiles','assetFiles'];
  for(const group of groups)if(!Array.isArray(manifest[group]))fail(`Missing ${group}`);
  const files=groups.flatMap(group=>manifest[group]);
  if(unique(files).length!==files.length)fail('frontend-files manifest contains duplicate paths');
  for(const filePath of files){
    if(!filePath||path.posix.normalize(filePath)!==filePath||path.isAbsolute(filePath)||filePath.startsWith('../'))fail(`Unsafe frontend path: ${filePath}`);
    if(FORBIDDEN_PREFIXES.some(prefix=>filePath===prefix.slice(0,-1)||filePath.startsWith(prefix)))fail(`Forbidden frontend path: ${filePath}`);
    const absolute=path.join(root,filePath);
    const stat=fs.lstatSync(absolute);
    if(!stat.isFile()||stat.isSymbolicLink())fail(`Frontend path must be a regular non-symlink file: ${filePath}`);
    const relative=path.relative(fs.realpathSync(root),fs.realpathSync(absolute));
    if(relative.startsWith('..')||path.isAbsolute(relative))fail(`Frontend path escapes the approved source root: ${filePath}`);
  }
  return{...manifest,files};
}
function htmlScripts(html){
  return[...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)]
    .map(match=>match[1]).filter(src=>!/^https?:\/\//i.test(src));
}
function manifestAssets(webManifest){
  const values=[];
  for(const icon of webManifest.icons||[])if(icon.src)values.push(icon.src);
  for(const shortcut of webManifest.shortcuts||[])for(const icon of shortcut.icons||[])if(icon.src)values.push(icon.src);
  return unique(values.map(value=>value.replace(/^\.\//,'')));
}
function workerArray(worker,name){
  const body=worker.match(new RegExp(`const ${name}=\\[([\\s\\S]*?)\\n\\];`))?.[1];
  if(!body)fail(`Unable to parse ${name} from service worker`);
  return[...body.matchAll(/'([^']+)'/g)].map(match=>match[1]);
}
function releaseFromIndex(html){
  const value=html.match(/window\.__POGO_RELEASE_ID='([^']+)'/)?.[1];
  return normalizeReleaseId(value);
}
function releaseFromClient(source){
  const value=source.match(/const RELEASE_ID='([^']+)'/)?.[1];
  return normalizeReleaseId(value);
}
function releaseFromWorker(source){
  const value=source.match(/const RELEASE='([^']+)'/)?.[1];
  return normalizeReleaseId(value);
}
function validateReleaseCoherence(root,{expectedReleaseId}={}){
  const allowlist=loadFrontendManifest(root);
  const html=readText(root,'index.html');
  const worker=readText(root,'sw.js');
  const client=readText(root,'js/domain/clientRelease.js');
  const webManifest=JSON.parse(readText(root,'manifest.json'));
  const releases={index:releaseFromIndex(html),client:releaseFromClient(client),worker:releaseFromWorker(worker)};
  if(unique(Object.values(releases)).length!==1)fail(`Mixed release identifiers: ${JSON.stringify(releases)}`);
  if(expectedReleaseId&&releases.index!==normalizeReleaseId(expectedReleaseId))fail(`Release mismatch: expected ${expectedReleaseId}, found ${releases.index}`);

  const scripts=htmlScripts(html);
  const scriptPaths=scripts.map(src=>{
    const url=new URL(src,'https://example.test/trade-app/');
    if(url.searchParams.get('v')!==releases.index)fail(`First-party script has a mixed or missing release: ${src}`);
    return url.pathname.replace(/^\/trade-app\//,'');
  });
  if(JSON.stringify(scriptPaths)!==JSON.stringify(allowlist.scriptFiles))fail('HTML first-party script order differs from reviewed frontend manifest');
  const precache=workerArray(worker,'RELEASE_ASSETS');
  if(JSON.stringify(precache)!==JSON.stringify(allowlist.scriptFiles))fail('Service-worker release graph differs from reviewed frontend manifest');
  const declaredAssets=manifestAssets(webManifest);
  for(const asset of declaredAssets)if(!allowlist.assetFiles.includes(asset))fail(`Web manifest asset is not allowlisted: ${asset}`);
  for(const required of ['index.html','manifest.json','sw.js','js/domain/clientRelease.js'])if(!allowlist.files.includes(required))fail(`Required runtime file omitted: ${required}`);
  return{releaseId:releases.index,scriptCount:scriptPaths.length,files:allowlist.files,allowlist};
}
function expectedConfirmation({mode,releaseId,approvedSha,expectedLiveSha}){
  if(mode==='release')return`DEPLOY release-${releaseId} ${approvedSha}`;
  if(mode==='rollback')return`ROLLBACK release-${releaseId} ${approvedSha} FROM ${expectedLiveSha}`;
  fail('mode must be release or rollback');
}
function validateDispatchContext(input){
  const releaseId=normalizeReleaseId(input.releaseId);
  const approvedSha=normalizeSha(input.approvedSha,'approved_sha');
  const expectedLiveSha=normalizeSha(input.expectedLiveSha,'expected_live_sha');
  const githubSha=normalizeSha(input.githubSha,'github.sha');
  const checkedOutSha=normalizeSha(input.checkedOutSha,'checked-out SHA');
  const controlWorkflowSha=normalizeSha(input.controlWorkflowSha,'control workflow SHA');
  const jobWorkflowSha=normalizeSha(input.jobWorkflowSha,'job.workflow_sha');
  if(input.refType!=='tag')fail('Production deployment requires a tag ref');
  if(input.refName!==`release-${releaseId}`)fail('Tag name does not match release_id');
  if(approvedSha!==githubSha||approvedSha!==checkedOutSha)fail('approved_sha, tag target, github.sha, and checked-out SHA must match');
  if(controlWorkflowSha!==jobWorkflowSha)fail('Dispatcher control SHA does not match executing reusable workflow SHA');
  const expected=expectedConfirmation({mode:input.mode,releaseId,approvedSha,expectedLiveSha});
  if(input.confirmation!==expected)fail(`Confirmation must exactly equal: ${expected}`);
  return{releaseId,releaseTag:`release-${releaseId}`,approvedSha,expectedLiveSha,mode:input.mode,controlWorkflowSha};
}
function git(root,args){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  if(result.status!==0)fail(`Git validation failed: git ${args.join(' ')}`);
  return result.stdout.trim();
}
function validateGitHistory(root,sha){
  normalizeSha(sha,'approved_sha');
  git(root,['cat-file','-e',`${sha}^{commit}`]);
  git(root,['show-ref','--verify','refs/remotes/origin/main']);
  git(root,['merge-base','--is-ancestor',sha,'refs/remotes/origin/main']);
  if(git(root,['rev-parse','HEAD'])!==sha)fail('Checked-out HEAD differs from approved SHA');
  return true;
}
function envInput(){
  return{
    approvedSha:process.env.APPROVED_SHA,expectedLiveSha:process.env.EXPECTED_LIVE_SHA,
    githubSha:process.env.GITHUB_SHA,checkedOutSha:process.env.CHECKED_OUT_SHA,
    refType:process.env.GITHUB_REF_TYPE,refName:process.env.GITHUB_REF_NAME,
    releaseId:process.env.RELEASE_ID,mode:process.env.DEPLOY_MODE,
    confirmation:process.env.DEPLOY_CONFIRMATION,
    controlWorkflowSha:process.env.CONTROL_WORKFLOW_SHA,jobWorkflowSha:process.env.JOB_WORKFLOW_SHA
  };
}
function main(){
  const root=path.resolve(process.env.SOURCE_DIR||process.cwd());
  if(process.argv.includes('--local')){
    const result=validateReleaseCoherence(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const context=validateDispatchContext(envInput());
  const release=validateReleaseCoherence(root,{expectedReleaseId:context.releaseId});
  if(process.env.VALIDATE_GIT_HISTORY==='true')validateGitHistory(root,context.approvedSha);
  process.stdout.write(`${JSON.stringify({...context,scriptCount:release.scriptCount,fileCount:release.files.length})}\n`);
}
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}

module.exports={SHA_RE,RELEASE_RE,FORBIDDEN_PREFIXES,CONTROL_ROOT,loadFrontendManifest,validateReleaseCoherence,validateDispatchContext,validateGitHistory,expectedConfirmation};
