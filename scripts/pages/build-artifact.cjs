#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {validateReleaseCoherence,SHA_RE,runtimeReleaseTag,controlSelectorTag}=require('./validate-release.cjs');

const DIGEST_ALGORITHM='sha256-path-null-content-sha256-v1';
function fail(message){throw new Error(message);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function stableJson(value){return`${JSON.stringify(value,null,2)}\n`;}
function artifactDigest(root,files){
  const hash=crypto.createHash('sha256');
  for(const file of [...files].sort()){
    const contentDigest=sha256(fs.readFileSync(path.join(root,file)));
    hash.update(file);hash.update('\0');hash.update(contentDigest);hash.update('\n');
  }
  return hash.digest('hex');
}
function assertEmptyOutput(output){
  if(!fs.existsSync(output)){fs.mkdirSync(output,{recursive:true});return;}
  if(!fs.statSync(output).isDirectory())fail('Artifact output must be a directory');
  if(fs.readdirSync(output).length)fail('Artifact output must be empty');
}
function copyReviewedFiles(source,output,files){
  for(const file of files){
    const from=path.join(source,file),to=path.join(output,file);
    const stat=fs.lstatSync(from);
    if(!stat.isFile()||stat.isSymbolicLink())fail(`Refusing non-regular artifact input: ${file}`);
    fs.mkdirSync(path.dirname(to),{recursive:true});
    fs.copyFileSync(from,to);
  }
}
function walk(root,relative=''){
  const result=[];
  for(const name of fs.readdirSync(path.join(root,relative)).sort()){
    const child=path.posix.join(relative,name),stat=fs.lstatSync(path.join(root,child));
    if(stat.isSymbolicLink())fail(`Artifact contains a symlink: ${child}`);
    if(stat.isDirectory())result.push(...walk(root,child));
    else if(stat.isFile())result.push(child);
    else fail(`Artifact contains an unsupported entry: ${child}`);
  }
  return result;
}
function buildArtifact(options){
  const source=path.resolve(options.source),output=path.resolve(options.output);
  const release=validateReleaseCoherence(source,{expectedReleaseId:options.runtimeReleaseId});
  for(const[label,value]of [['runtime_source_sha',options.runtimeSourceSha],['dispatcher_sha',options.dispatcherSha],['control_workflow_sha',options.controlWorkflowSha]])if(!SHA_RE.test(value||''))fail(`${label} must be a full lowercase SHA`);
  if(options.runtimeReleaseTag!==runtimeReleaseTag(release.releaseId))fail('runtime_release_tag does not match runtime_release_id');
  if(options.controlSelectorTag!==controlSelectorTag(options.dispatcherSha))fail('deployment selector does not match dispatcher SHA');
  if(!/^\d+$/.test(options.githubRunId||''))fail('github_run_id must be numeric');
  assertEmptyOutput(output);
  copyReviewedFiles(source,output,release.files);
  const digest=artifactDigest(output,release.files);
  const deploymentManifest={
    schema_version:2,
    source_sha:options.runtimeSourceSha,
    release_id:release.releaseId,
    release_tag:options.runtimeReleaseTag,
    deployment_selector:options.controlSelectorTag,
    dispatcher_sha:options.dispatcherSha,
    github_run_id:options.githubRunId,
    control_workflow_sha:options.controlWorkflowSha,
    artifact_digest:digest,
    artifact_digest_algorithm:DIGEST_ALGORITHM
  };
  fs.writeFileSync(path.join(output,'deployment-manifest.json'),stableJson(deploymentManifest),{mode:0o644});
  const expected=[...release.files,'deployment-manifest.json'].sort();
  const actual=walk(output).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))fail('Built artifact contains an unexpected or missing file');
  return{...deploymentManifest,file_count:actual.length};
}
function main(){
  const result=buildArtifact({
    source:process.env.SOURCE_DIR||process.cwd(),output:process.env.ARTIFACT_DIR,
    runtimeSourceSha:process.env.RUNTIME_SOURCE_SHA,runtimeReleaseId:process.env.RUNTIME_RELEASE_ID,
    runtimeReleaseTag:process.env.RUNTIME_RELEASE_TAG,controlSelectorTag:process.env.CONTROL_SELECTOR_TAG,
    dispatcherSha:process.env.DISPATCHER_SHA,githubRunId:process.env.GITHUB_RUN_ID,
    controlWorkflowSha:process.env.CONTROL_WORKFLOW_SHA
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}

module.exports={DIGEST_ALGORITHM,artifactDigest,buildArtifact,walk,stableJson};
