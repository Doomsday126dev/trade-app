#!/usr/bin/env node
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {readShareMigrationSources}=require('./lib/share-migration-source-reader.cjs');
const {buildReport,writeReport,aggregateLines}=require('./lib/private-share-migration-report.cjs');
const root=path.resolve(__dirname,'..');
function parseArgs(argv){
  const options={source:'production'};
  const allowed=new Set(['source','transport','firebaseCli','authInput','output','projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','authTokenEnv']);
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(arg==='--allow-production-read'){options.allowProductionRead=true;continue;}
    if(!arg.startsWith('--'))throw new Error('Unexpected CLI argument');
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());if(!allowed.has(key))throw new Error('Unsupported CLI option');
    const value=argv[++i];if(value==null||value.startsWith('--'))throw new Error('Missing CLI option value');options[key]=value;
  }return options;
}
function loadDomain(){
  const context={window:{}};vm.createContext(context);
  for(const file of ['js/domain/trainerNames.js','js/domain/publicSharePublication.js','js/domain/shareMigrationAudit.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return context.window.PogoDomain.shareMigrationAudit;
}
async function run(argv=process.argv.slice(2),dependencies={}){
  const options=parseArgs(argv),collected=await readShareMigrationSources(options,dependencies);
  const result=loadDomain().auditShareMigration(collected.sources);if(!result.ok)throw Object.assign(new Error('Share migration audit failed'),{code:result.error.code});
  const report=buildReport(result.value,collected.metadata);writeReport(report,options.output);aggregateLines(report).forEach(line=>console.log(line));return{report};
}
module.exports={parseArgs,loadDomain,run};
if(require.main===module)run().catch(error=>{console.error(`Share migration audit failed: ${error.code||'unexpected_error'}`);process.exitCode=1;});
