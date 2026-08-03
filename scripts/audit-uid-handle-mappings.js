#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {readSources}=require('./lib/uid-handle-source-reader.cjs');
const {buildPrivateReport,writePrivateReport,aggregateLines}=require('./lib/private-identity-report.cjs');
const repoRoot=path.resolve(__dirname,'..');
function parseArgs(argv){
  const options={source:'fixture',input:'tests/fixtures/uid-handle-rtdb.synthetic.json',authInput:'tests/fixtures/uid-handle-auth.synthetic.json'};
  const allowed=new Set(['source','input','authInput','output','projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','authTokenEnv']);
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--allow-production-read'){options.allowProductionRead=true;continue;}
    if(!arg.startsWith('--'))throw new Error('Unexpected CLI argument');
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(!allowed.has(key))throw new Error('Unsupported CLI option');
    const value=argv[++i];
    if(value==null||value.startsWith('--'))throw new Error('Missing CLI option value');
    options[key]=value;
  }
  return options;
}
function loadDomain(){
  const context={window:{}};vm.createContext(context);
  for(const file of ['js/domain/trainerNames.js','js/domain/identityReconciliation.js'])vm.runInContext(fs.readFileSync(path.join(repoRoot,file),'utf8'),context,{filename:file});
  return context.window.PogoDomain.identityReconciliation;
}
async function run(argv=process.argv.slice(2),dependencies={}){
  const options=parseArgs(argv);
  const collected=await readSources(options,dependencies);
  const result=loadDomain().reconcileIdentitySources(collected.sources);
  if(!result.ok)throw Object.assign(new Error(`Reconciliation failed: ${result.error.code}`),{code:result.error.code});
  const report=buildPrivateReport(result.value,collected.metadata);
  writePrivateReport(report,options.output);
  aggregateLines(report).forEach(line=>console.log(line));
  return{report};
}
module.exports={parseArgs,loadDomain,run};
if(require.main===module)run().catch(error=>{console.error(`UID/handle dry-run failed: ${error.code||'unexpected_error'}`);process.exitCode=1;});
