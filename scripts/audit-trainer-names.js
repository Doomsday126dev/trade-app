#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const defaultFixture = path.join(repoRoot, 'tests/fixtures/trainer-names.synthetic.json');
const defaultReportDir = path.join(repoRoot, '.local/trainer-name-audits');

function loadTrainerNameDomain(){
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(repoRoot,'js/domain/trainerNames.js'),'utf8'),
    context,
    {filename:'js/domain/trainerNames.js'}
  );
  return context.window.PogoDomain.trainerNames;
}

function parseArgs(argv){
  const options={source:'fixture'};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--allow-production-read'){options.allowProductionRead=true;continue;}
    if(!arg.startsWith('--'))throw new Error(`Unexpected argument: ${arg}`);
    const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    const value=argv[++i];
    if(value==null||value.startsWith('--'))throw new Error(`Missing value for ${arg}`);
    options[key]=value;
  }
  return options;
}

function assertPlainObject(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw new Error(`${label} must be a JSON object`);
  }
}

function extractTrainerNames(payload){
  if(Array.isArray(payload))return payload.map(value=>value==null?'':String(value));
  assertPlainObject(payload,'Trainer-name source');
  if(Array.isArray(payload.names))return payload.names.map(value=>value==null?'':String(value));
  if(payload.loginDirectory!==undefined){
    assertPlainObject(payload.loginDirectory,'loginDirectory');
    return Object.keys(payload.loginDirectory);
  }
  return Object.keys(payload);
}

function verifiedDatabaseTarget(options){
  const source=options.source;
  if(!['fixture','emulator','production'].includes(source)){
    throw new Error(`Unsupported source: ${source}`);
  }
  if(source==='fixture')return{kind:'fixture'};

  if(!options.databaseUrl||!options.projectId){
    throw new Error(`${source} mode requires --database-url and --project-id`);
  }
  const url=new URL(options.databaseUrl);
  if(url.username||url.password||url.search||url.hash){
    throw new Error('Database URL must not contain credentials, query parameters, or fragments');
  }
  if(source==='emulator'){
    if(!['localhost','127.0.0.1','::1'].includes(url.hostname)){
      throw new Error('Emulator mode only permits a loopback database host');
    }
    if(!['http:','https:'].includes(url.protocol))throw new Error('Invalid emulator database URL');
    return{kind:'emulator',url,projectId:options.projectId,databaseId:null};
  }

  if(!options.allowProductionRead){
    throw new Error('Production reads require the explicit --allow-production-read flag');
  }
  if(!options.databaseId||!options.confirmProject||!options.confirmDatabase){
    throw new Error('Production mode requires --database-id, --confirm-project, and --confirm-database');
  }
  if(options.confirmProject!==options.projectId||options.confirmDatabase!==options.databaseId){
    throw new Error('Production project/database confirmation does not match the requested target');
  }
  if(url.protocol!=='https:')throw new Error('Production database URL must use HTTPS');
  const hostMatches=url.hostname===`${options.databaseId}.firebaseio.com`||
    (url.hostname.startsWith(`${options.databaseId}.`)&&url.hostname.endsWith('.firebasedatabase.app'));
  if(!hostMatches)throw new Error('Production database URL does not match --database-id');
  if(options.databaseId!==options.projectId&&!options.databaseId.startsWith(`${options.projectId}-`)){
    throw new Error('Production database ID is not associated with --project-id');
  }
  if(!options.authTokenEnv)throw new Error('Production mode requires --auth-token-env');
  const token=process.env[options.authTokenEnv];
  if(!token)throw new Error(`Production auth token environment variable is empty: ${options.authTokenEnv}`);
  return{kind:'production',url,projectId:options.projectId,databaseId:options.databaseId,token};
}

async function readTrainerNames(options,{fetchImpl=global.fetch}={}){
  const target=verifiedDatabaseTarget(options);
  if(target.kind==='fixture'){
    const input=path.resolve(repoRoot,options.input||defaultFixture);
    const payload=JSON.parse(fs.readFileSync(input,'utf8'));
    return{names:extractTrainerNames(payload),source:{kind:'fixture',input:path.relative(repoRoot,input)}};
  }

  const endpoint=new URL('loginDirectory.json',target.url.href.endsWith('/')?target.url.href:`${target.url.href}/`);
  if(target.kind==='emulator')endpoint.searchParams.set('ns',target.projectId);
  if(target.kind==='production')endpoint.searchParams.set('auth',target.token);
  const response=await fetchImpl(endpoint,{method:'GET',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`${target.kind} read failed with HTTP ${response.status}`);
  const payload=await response.json();
  return{
    names:extractTrainerNames(payload||{}),
    source:{
      kind:target.kind,
      projectId:target.projectId,
      databaseId:target.databaseId,
      origin:target.url.origin
    }
  };
}

function collisionId(normalizedTrainerName){
  return`collision-${crypto.createHash('sha256').update(normalizedTrainerName).digest('hex').slice(0,12)}`;
}

function buildReport(names,source,generatedAt=new Date().toISOString()){
  const domain=loadTrainerNameDomain();
  const audit=domain.auditTrainerNames(names);
  return{
    schemaVersion:1,
    generatedAt,
    source,
    normalization:{
      order:['trim','NFKC','toLowerCase'],
      caseMapping:'ECMAScript String.prototype.toLowerCase (locale-independent Unicode lowercase mapping; not full Unicode case folding)',
      internalCharacters:'preserved'
    },
    summary:audit.summary,
    collisions:audit.collisions.map(collision=>({
      id:collisionId(collision.normalizedTrainerName),
      normalizedTrainerName:collision.normalizedTrainerName,
      entries:collision.entries
    })),
    changedByTrimming:audit.entries.filter(entry=>entry.changedByTrimming),
    changedByNfkc:audit.entries.filter(entry=>entry.changedByNfkc),
    invalidOrEmpty:audit.entries.filter(entry=>!entry.valid),
    entries:audit.entries
  };
}

function defaultOutputPath(){
  return path.join(defaultReportDir,`trainer-name-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
}

function privateOutputPath(requestedOutput){
  const output=path.resolve(repoRoot,requestedOutput||defaultOutputPath());
  const relative=path.relative(defaultReportDir,output);
  if(relative.startsWith('..')||path.isAbsolute(relative)){
    throw new Error('Trainer-name reports must stay under the git-ignored .local/trainer-name-audits directory');
  }
  return output;
}

async function run(argv=process.argv.slice(2),dependencies={}){
  const options=parseArgs(argv);
  const result=await readTrainerNames(options,dependencies);
  const report=buildReport(result.names,result.source);
  const output=privateOutputPath(options.output);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,`${JSON.stringify(report,null,2)}\n`,{mode:0o600});

  console.log(`Trainer-name audit source: ${report.source.kind}`);
  if(report.source.projectId)console.log(`Verified project: ${report.source.projectId}`);
  if(report.source.databaseId)console.log(`Verified database: ${report.source.databaseId}`);
  console.log(`Total names: ${report.summary.totalNames}`);
  console.log(`Normalized collision groups: ${report.summary.collisionGroups}`);
  console.log(`Changed by trimming: ${report.summary.changedByTrimming}`);
  console.log(`Changed by NFKC: ${report.summary.changedByNfkc}`);
  console.log(`Invalid or empty: ${report.summary.invalidOrEmpty}`);
  if(report.collisions.length)console.log(`Collision IDs: ${report.collisions.map(item=>item.id).join(', ')}`);
  console.log(`Private machine-readable report: ${path.relative(repoRoot,output)}`);
  return{report,output};
}

module.exports={
  parseArgs,
  extractTrainerNames,
  verifiedDatabaseTarget,
  readTrainerNames,
  collisionId,
  buildReport,
  privateOutputPath,
  run
};

if(require.main===module){
  run().catch(error=>{
    console.error(`Trainer-name audit failed: ${error.message}`);
    process.exitCode=1;
  });
}
