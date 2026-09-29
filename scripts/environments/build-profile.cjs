#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {configuration,validateConfiguration,configBlock,replaceConfiguration,configurationDigest}=require('./configuration.cjs');
const CONTROL_SHA='6f58a1a39065c6d1b6070c9ed8fc4fd25efdab43';
function buildProfile(options){
  const source=path.resolve(options.source),output=path.resolve(options.output),control=path.resolve(options.controlRoot);
  const profile=options.profile,config=configuration(profile,source);
  assert.match(options.sourceTree||'',/^[0-9a-f]{40}$/,'Source tree must be exact');
  const sourceConfig=configBlock(fs.readFileSync(path.join(source,'index.html'),'utf8')).value;
  validateConfiguration(sourceConfig,'production');
  assert.deepEqual(sourceConfig,configuration('production',source),'Source must retain the reviewed production profile');
  assert.equal(options.controlWorkflowSha,CONTROL_SHA,'Unreviewed Pages control');
  const builder=require(path.join(control,'scripts/pages/build-artifact.cjs'));
  const result=builder.buildArtifact(options);
  if(profile==='staging')fs.writeFileSync(path.join(output,'index.html'),replaceConfiguration(fs.readFileSync(path.join(output,'index.html'),'utf8'),config));
  validateConfiguration(configBlock(fs.readFileSync(path.join(output,'index.html'),'utf8')).value,profile);
  const validator=require(path.join(control,'scripts/pages/validate-release.cjs'));
  const release=validator.validateReleaseCoherence(output,{expectedReleaseId:options.runtimeReleaseId});
  const digest=builder.artifactDigest(output,release.files);
  const manifest={...result,environment_profile:profile,runtime_config_digest:configurationDigest(config),source_tree:options.sourceTree,artifact_digest:digest};
  delete manifest.file_count;
  fs.writeFileSync(path.join(output,'deployment-manifest.json'),builder.stableJson(manifest));
  return{...manifest,file_count:result.file_count};
}
function compareProfiles(production,staging,controlRoot){
  const {walk}=require(path.join(path.resolve(controlRoot),'scripts/pages/build-artifact.cjs'));
  const p=walk(production).sort(),s=walk(staging).sort();assert.deepEqual(s,p,'Artifact file sets differ');
  const differences=[];
  for(const file of p){
    const a=fs.readFileSync(path.join(production,file)),b=fs.readFileSync(path.join(staging,file));
    if(a.equals(b))continue;
    differences.push(file);
    if(file==='index.html'){
      validateConfiguration(configBlock(a.toString()).value,'production');validateConfiguration(configBlock(b.toString()).value,'staging');
      assert.equal(replaceConfiguration(a.toString(),{}),replaceConfiguration(b.toString(),{}),'Application markup/logic differs outside configuration');
    }else assert.equal(file,'deployment-manifest.json','Application/runtime bytes differ');
  }
  assert.deepEqual(differences.sort(),['deployment-manifest.json','index.html']);
  const a=JSON.parse(fs.readFileSync(path.join(production,'deployment-manifest.json'))),b=JSON.parse(fs.readFileSync(path.join(staging,'deployment-manifest.json')));
  const builder=require(path.join(path.resolve(controlRoot),'scripts/pages/build-artifact.cjs'));
  for(const [directory,manifest,profile]of [[production,a,'production'],[staging,b,'staging']]){
    assert.equal(manifest.environment_profile,profile);
    assert.equal(manifest.runtime_config_digest,configurationDigest(configBlock(fs.readFileSync(path.join(directory,'index.html'),'utf8')).value));
    assert.equal(manifest.artifact_digest,builder.artifactDigest(directory,p.filter(file=>file!=='deployment-manifest.json')),'Artifact digest mismatch');
  }
  for(const field of ['source_sha','source_tree','release_id','release_tag','dispatcher_sha','deployment_selector','control_workflow_sha'])assert.equal(a[field],b[field],`Provenance mismatch: ${field}`);
  return{applicationBytesEquivalent:true,differenceFiles:differences,configurationBoundary:'index.html: POGO_ENVIRONMENT_CONFIG_BEGIN/END',sourceSha:a.source_sha,sourceTree:a.source_tree,productionDigest:a.artifact_digest,stagingDigest:b.artifact_digest};
}
if(require.main===module){
  try{
    const source=path.resolve(process.env.SOURCE_DIR||process.cwd()),control=path.resolve(process.env.PAGES_CONTROL_ROOT||'');
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:control,encoding:'utf8'}).trim(),CONTROL_SHA);
    const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
    assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim(),'','Commit the candidate before building');
    assert.equal(sha,process.env.RUNTIME_SOURCE_SHA);
    console.log(JSON.stringify(buildProfile({source,output:process.env.ARTIFACT_DIR,profile:process.env.ENVIRONMENT_PROFILE,controlRoot:control,
      runtimeSourceSha:sha,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:source,encoding:'utf8'}).trim(),
      runtimeReleaseId:process.env.RUNTIME_RELEASE_ID,runtimeReleaseTag:process.env.RUNTIME_RELEASE_TAG,dispatcherSha:process.env.DISPATCHER_SHA,
      controlSelectorTag:process.env.CONTROL_SELECTOR_TAG,controlWorkflowSha:CONTROL_SHA,githubRunId:'0'})));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={CONTROL_SHA,buildProfile,compareProfiles};
