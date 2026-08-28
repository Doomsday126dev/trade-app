#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const SHA_RE=/^[0-9a-f]{40}$/;
const RELEASE_RE=/^\d{4}-\d{2}-\d{2}\.\d+$/;
const CONTROL_SELECTOR_PREFIX='release-pages-control-';
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
function runtimeReleaseTag(releaseId){return`release-${normalizeReleaseId(releaseId)}`;}
function controlSelectorTag(dispatcherSha){return`${CONTROL_SELECTOR_PREFIX}${normalizeSha(dispatcherSha,'dispatcher_sha')}`;}
function loadFrontendManifest(root,{manifestRoot=CONTROL_ROOT}={}){
  const file=path.join(manifestRoot,'scripts/pages/frontend-files.json');
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  if(manifest.schemaVersion!==1)fail('Unsupported frontend-files manifest schema');
  const groups=['entryFiles','styleFiles','scriptFiles','assetFiles'];
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
function htmlStyles(html){
  return[...html.matchAll(/<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]
    .map(match=>match[1]).filter(href=>!/^https?:\/\//i.test(href));
}
function requireTrustedOrder(actual,expected,label){
  const length=Math.max(actual.length,expected.length);
  for(let index=0;index<length;index++){
    if(actual[index]===expected[index])continue;
    const runtime=actual[index]===undefined?'<missing>':actual[index];
    const trusted=expected[index]===undefined?'<missing>':expected[index];
    fail(`${label} differs from trusted-control frontend manifest at index ${index}: runtime=${runtime}, trusted=${trusted}; reviewed inventory changes require a new immutable control revision and dispatcher selector`);
  }
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
  requireTrustedOrder(scriptPaths,allowlist.scriptFiles,'HTML first-party script order');
  const styles=htmlStyles(html);
  const stylePaths=styles.map(href=>{
    const url=new URL(href,'https://example.test/trade-app/');
    if(url.searchParams.get('v')!==releases.index)fail(`First-party stylesheet has a mixed or missing release: ${href}`);
    return url.pathname.replace(/^\/trade-app\//,'');
  });
  requireTrustedOrder(stylePaths,allowlist.styleFiles,'HTML first-party stylesheet order');
  const precache=workerArray(worker,'RELEASE_ASSETS');
  requireTrustedOrder(precache,[...allowlist.styleFiles,...allowlist.scriptFiles],'Service-worker release graph');
  const declaredAssets=manifestAssets(webManifest);
  for(const asset of declaredAssets)if(!allowlist.assetFiles.includes(asset))fail(`Web manifest asset is not allowlisted: ${asset}`);
  for(const required of ['index.html','manifest.json','sw.js','js/domain/clientRelease.js'])if(!allowlist.files.includes(required))fail(`Required runtime file omitted: ${required}`);
  return{releaseId:releases.index,scriptCount:scriptPaths.length,files:allowlist.files,allowlist};
}
function expectedConfirmation({mode,runtimeReleaseTag:tag,runtimeSourceSha,expectedLiveSha,controlSelectorTag:selector}){
  if(mode==='release')return`DEPLOY ${tag} ${runtimeSourceSha} VIA ${selector}`;
  if(mode==='rollback')return`ROLLBACK ${tag} ${runtimeSourceSha} FROM ${expectedLiveSha} VIA ${selector}`;
  fail('mode must be release or rollback');
}
function validateDispatchContext(input){
  const runtimeReleaseId=normalizeReleaseId(input.runtimeReleaseId);
  const runtimeSourceSha=normalizeSha(input.runtimeSourceSha,'runtime_source_sha');
  const expectedLiveSha=normalizeSha(input.expectedLiveSha,'expected_live_sha');
  const githubSha=normalizeSha(input.githubSha,'github.sha');
  const checkedOutSha=normalizeSha(input.checkedOutSha,'checked-out SHA');
  const dispatcherSha=normalizeSha(input.dispatcherSha,'dispatcher_sha');
  const controlWorkflowSha=normalizeSha(input.controlWorkflowSha,'control workflow SHA');
  const jobWorkflowSha=normalizeSha(input.jobWorkflowSha,'job.workflow_sha');
  const expectedRuntimeTag=runtimeReleaseTag(runtimeReleaseId);
  const expectedSelector=controlSelectorTag(dispatcherSha);
  if(input.refType!=='tag')fail('Production deployment requires a tag ref');
  if(input.runtimeReleaseTag!==expectedRuntimeTag)fail('Runtime tag does not match runtime_release_id');
  if(input.controlSelectorTag!==expectedSelector||input.refName!==expectedSelector)fail('Control selector must contain the full dispatcher SHA');
  if(dispatcherSha!==githubSha)fail('dispatcher_sha must equal github.sha');
  if(runtimeSourceSha!==checkedOutSha)fail('runtime_source_sha must equal checked-out SHA');
  if(controlWorkflowSha!==jobWorkflowSha)fail('Dispatcher control SHA does not match executing reusable workflow SHA');
  const expected=expectedConfirmation({mode:input.mode,runtimeReleaseTag:expectedRuntimeTag,runtimeSourceSha,expectedLiveSha,controlSelectorTag:expectedSelector});
  if(input.confirmation!==expected)fail(`Confirmation must exactly equal: ${expected}`);
  return{runtimeReleaseId,runtimeReleaseTag:expectedRuntimeTag,runtimeSourceSha,expectedLiveSha,controlSelectorTag:expectedSelector,dispatcherSha,mode:input.mode,controlWorkflowSha};
}
function git(root,args){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  if(result.status!==0)fail(`Git validation failed: git ${args.join(' ')}`);
  return result.stdout.trim();
}
function validateGitHistory(root,runtimeSourceSha,runtimeTag){
  normalizeSha(runtimeSourceSha,'runtime_source_sha');
  if(runtimeTag!==runtimeReleaseTag(runtimeTag?.slice('release-'.length)))fail('Invalid runtime release tag');
  git(root,['cat-file','-e',`${runtimeSourceSha}^{commit}`]);
  git(root,['show-ref','--verify','refs/remotes/origin/main']);
  git(root,['merge-base','--is-ancestor',runtimeSourceSha,'refs/remotes/origin/main']);
  if(git(root,['rev-parse','HEAD'])!==runtimeSourceSha)fail('Checked-out HEAD differs from runtime source SHA');
  if(git(root,['rev-parse',`${runtimeTag}^{commit}`])!==runtimeSourceSha)fail('Runtime release tag does not resolve to runtime source SHA');
  return true;
}
function envInput(){
  return{
    runtimeSourceSha:process.env.RUNTIME_SOURCE_SHA,runtimeReleaseId:process.env.RUNTIME_RELEASE_ID,
    runtimeReleaseTag:process.env.RUNTIME_RELEASE_TAG,expectedLiveSha:process.env.EXPECTED_LIVE_SHA,
    githubSha:process.env.GITHUB_SHA,checkedOutSha:process.env.CHECKED_OUT_SHA,
    refType:process.env.GITHUB_REF_TYPE,refName:process.env.GITHUB_REF_NAME,
    controlSelectorTag:process.env.CONTROL_SELECTOR_TAG,dispatcherSha:process.env.DISPATCHER_SHA,
    mode:process.env.DEPLOY_MODE,
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
  const release=validateReleaseCoherence(root,{expectedReleaseId:context.runtimeReleaseId});
  if(process.env.VALIDATE_GIT_HISTORY==='true')validateGitHistory(root,context.runtimeSourceSha,context.runtimeReleaseTag);
  process.stdout.write(`${JSON.stringify({...context,scriptCount:release.scriptCount,fileCount:release.files.length})}\n`);
}
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}

module.exports={SHA_RE,RELEASE_RE,CONTROL_SELECTOR_PREFIX,FORBIDDEN_PREFIXES,CONTROL_ROOT,normalizeSha,normalizeReleaseId,runtimeReleaseTag,controlSelectorTag,loadFrontendManifest,validateReleaseCoherence,validateDispatchContext,validateGitHistory,expectedConfirmation};
