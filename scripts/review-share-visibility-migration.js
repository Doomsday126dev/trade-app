#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {
  readPrivateJson,resolvePrivate,buildArtifact,verifyArtifact,applyDecision,
  writePrivateJson,privateInspection,aggregateOutput
}=require('./lib/private-share-migration-review.cjs');

const root=path.resolve(__dirname,'..');
const COMMANDS=new Set(['create','summary','inspect','decide']);
function parseArgs(argv){
  const command=argv[0];if(!COMMANDS.has(command))throw Object.assign(new Error('Unsupported review command'),{code:'review/command_unsupported'});
  const options={command};
  const allowed=new Set(['sourceAudit','review','output','recordId','privateOutput','decision','noteFile']);
  for(let index=1;index<argv.length;index++){
    const arg=argv[index];if(!arg.startsWith('--'))throw new Error('Unexpected CLI argument');
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(!allowed.has(key))throw new Error('Unsupported CLI option');
    const value=argv[++index];if(value==null||value.startsWith('--'))throw new Error('Missing CLI option value');options[key]=value;
  }
  return options;
}
function loadDomain(){
  const context={window:{}};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'js/domain/shareMigrationReview.js'),'utf8'),context,{filename:'js/domain/shareMigrationReview.js'});
  return context.window.PogoDomain.shareMigrationReview;
}
function defaultOutput(){return path.join(root,'.local/uid-handle-audits/reviews',`share-migration-review-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);}
function outputAggregate(artifact,file,status){const bytes=fs.readFileSync(file);console.log(JSON.stringify(aggregateOutput(artifact,bytes,{status}),null,2));}
function sourceInput(options){return readPrivateJson(options.sourceAudit,'source audit');}
function reviewInput(options,source){const input=readPrivateJson(options.review,'manual review');verifyArtifact(input.value,source.bytes);return input;}

async function run(argv=process.argv.slice(2)){
  const options=parseArgs(argv),domain=loadDomain(),source=sourceInput(options);
  if(options.command==='create'){
    const derived=domain.deriveManualReview(source.value);if(!derived.ok)throw Object.assign(new Error('Review derivation failed'),{code:derived.error.code});
    const artifact=buildArtifact(derived.value,source.value,source.bytes),output=options.output||defaultOutput();
    writePrivateJson(artifact,output,'manual review');outputAggregate(artifact,output,'review-created');return{artifact};
  }
  const review=reviewInput(options,source);
  if(options.command==='summary'){outputAggregate(review.value,review.file,'review-ready');return{artifact:review.value};}
  if(options.command==='inspect'){
    const inspection=privateInspection(review.value,options.recordId);
    if(!options.privateOutput)throw Object.assign(new Error('Private inspection output is required'),{code:'review/private_inspection_output_missing'});
    writePrivateJson(inspection,options.privateOutput,'private inspection');outputAggregate(review.value,review.file,'private-inspection-created');return{artifact:review.value};
  }
  let note='';
  if(options.noteFile){const noteFile=resolvePrivate(options.noteFile,'reviewer note',{mustExist:true});note=fs.readFileSync(noteFile,'utf8').replace(/\s+$/,'');}
  const artifact=applyDecision(review.value,source.bytes,{recordId:options.recordId,decision:options.decision,note,allowedDecision:domain.allowedDecision});
  writePrivateJson(artifact,review.file,'manual review');outputAggregate(artifact,review.file,'local-review-updated');return{artifact};
}

module.exports={parseArgs,loadDomain,run};
if(require.main===module)run().catch(error=>{console.error(`Share migration review failed: ${error.code||'unexpected_error'}`);process.exitCode=1;});
