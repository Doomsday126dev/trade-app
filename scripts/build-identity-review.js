#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {readIdentityReviewInputs}=require('./lib/identity-review-source-reader.cjs');
const {buildPrivateReviewArtifact,writePrivateReviewArtifact,reviewAggregateLines}=require('./lib/private-identity-review.cjs');

const repoRoot=path.resolve(__dirname,'..');

function parseArgs(argv){
  const options={};
  const allowed=new Set(['source','report','rtdbInput','authInput','output']);
  for(let index=0;index<argv.length;index++){
    const arg=argv[index];
    if(!arg.startsWith('--'))throw new Error('Unexpected CLI argument');
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(!allowed.has(key))throw new Error('Unsupported CLI option');
    const value=argv[++index];
    if(value==null||value.startsWith('--'))throw new Error('Missing CLI option value');
    options[key]=value;
  }
  return options;
}

function loadDomain(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot,'js/domain/identityConflictDiagnostics.js'),'utf8'),context,{filename:'js/domain/identityConflictDiagnostics.js'});
  return context.window.PogoDomain.identityConflictDiagnostics;
}

async function run(argv=process.argv.slice(2)){
  const options=parseArgs(argv);
  const input=readIdentityReviewInputs(options);
  const result=loadDomain().deriveIdentityConflictDiagnostics({
    report:input.report,
    sources:input.sources,
    actualSnapshotHashes:input.metadata.actualSnapshotHashes
  });
  if(!result.ok)throw Object.assign(new Error(`Identity diagnostics failed: ${result.error.code}`),{code:result.error.code});
  const artifact=buildPrivateReviewArtifact(result.value,input.metadata);
  writePrivateReviewArtifact(artifact,options.output);
  reviewAggregateLines(artifact).forEach(line=>console.log(line));
  return{artifact};
}

module.exports={parseArgs,loadDomain,run};
if(require.main===module)run().catch(error=>{console.error(`Identity review failed: ${error.code||'unexpected_error'}`);process.exitCode=1;});
