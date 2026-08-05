const path=require('path');
const {PRODUCTION_PATHS,privateRoot,hash,verifyProduction}=require('./uid-handle-source-reader.cjs');
const fs=require('fs');
const {spawnSync}=require('child_process');
const MAX_EXACT_SHARE_READS=500;
const FORBIDDEN_KEY=/[.#$\[\]\/\u0000-\u001f\u007f]/;

function readPrivateAuth(file){
  const resolved=path.resolve(file||'');
  const relative=path.relative(privateRoot,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Sanitized Auth input must stay private'),{code:'auth_input_outside_private_root'});
  const actual=fs.realpathSync(resolved),actualRoot=fs.realpathSync(privateRoot);
  const realRelative=path.relative(actualRoot,actual);
  if(realRelative.startsWith('..')||path.isAbsolute(realRelative))throw Object.assign(new Error('Sanitized Auth input must stay private'),{code:'auth_input_outside_private_root'});
  return JSON.parse(fs.readFileSync(actual,'utf8'));
}
async function getJson(url,token,fetchImpl){
  const endpoint=new URL(url);endpoint.searchParams.set('auth',token);
  const response=await fetchImpl(endpoint,{method:'GET',headers:{Accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error(`Approved production read failed with HTTP ${response.status}`),{code:'production_read_failed',status:response.status});
  return(await response.json())||null;
}
function verifyCliProduction(options){
  if(!options.allowProductionRead)throw Object.assign(new Error('Production reads require explicit confirmation'),{code:'production_read_not_confirmed'});
  for(const key of ['projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','firebaseCli'])if(!options[key])throw Object.assign(new Error(`Missing production option: ${key}`),{code:'production_target_incomplete'});
  if(options.projectId!==options.confirmProject||options.databaseId!==options.confirmDatabase)throw Object.assign(new Error('Production target confirmation mismatch'),{code:'production_target_mismatch'});
  const url=new URL(options.databaseUrl);
  const hostOk=url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.hostname===`${options.databaseId}.firebaseio.com`||(url.hostname.startsWith(`${options.databaseId}.`)&&url.hostname.endsWith('.firebasedatabase.app')));
  if(!hostOk||!(options.databaseId===options.projectId||options.databaseId.startsWith(`${options.projectId}-`)))throw Object.assign(new Error('Production database target mismatch'),{code:'production_target_mismatch'});
  const cli=path.resolve(options.firebaseCli);if(!fs.existsSync(cli))throw Object.assign(new Error('Firebase CLI executable was not found'),{code:'firebase_cli_missing'});
  return{url,cli};
}
function cliGet(cli,target,options,commandRunner=spawnSync){
  const args=['database:get',`/${target}`,'--project',options.projectId,'--instance',options.databaseId,'--non-interactive'];
  const result=commandRunner(cli,args,{encoding:'utf8',env:process.env,maxBuffer:16*1024*1024});
  if(result?.status!==0)throw Object.assign(new Error('Approved Firebase CLI read failed'),{code:'production_read_failed'});
  return JSON.parse(result.stdout||'null');
}
function exactNames(payload){
  const names=new Set([...Object.keys(payload.loginDirectory||{}),...Object.keys(payload.users||{})]);
  for(const row of Object.values(payload.authIndex||{}))if(row&&typeof row==='object'&&typeof row.username==='string'&&row.username)names.add(row.username);
  const values=[...names].sort();
  if(values.length>MAX_EXACT_SHARE_READS)throw Object.assign(new Error('Exact public-share read bound exceeded'),{code:'share_read_bound_exceeded'});
  if(values.some(name=>!name||FORBIDDEN_KEY.test(name)))throw Object.assign(new Error('Unsafe username cannot be used for an exact share read'),{code:'share_read_key_invalid'});
  return values;
}
async function readShareMigrationSources(options,{fetchImpl=global.fetch,env=process.env}={}){
  if(options.source!=='production')throw Object.assign(new Error('Share migration audit supports verified production only'),{code:'source_unsupported'});
  const cliMode=options.transport==='firebase-cli';
  const target=cliMode?verifyCliProduction(options):verifyProduction(options,env);
  const authInput=readPrivateAuth(options.authInput);
  const base=target.url.href.endsWith('/')?target.url.href:`${target.url.href}/`;
  const payload={};
  const commandRunner=arguments[1]?.commandRunner;
  for(const key of PRODUCTION_PATHS)payload[key]=(cliMode?cliGet(target.cli,key,options,commandRunner):await getJson(new URL(`${key}.json`,base),target.token,fetchImpl))||{};
  const names=exactNames(payload),publicShares={};
  for(const username of names){
    const value=cliMode?cliGet(target.cli,`publicShares/${username}`,options,commandRunner):await getJson(new URL(`publicShares/${encodeURIComponent(username)}.json`,base),target.token,fetchImpl);
    if(value!==null)publicShares[username]=value;
  }
  return{sources:{...payload,publicShares,authInput},metadata:{source:'production',targetVerified:true,
    sourceCounts:{...Object.fromEntries(PRODUCTION_PATHS.map(key=>[key,Object.keys(payload[key]).length])),authIdentities:Array.isArray(authInput?.identities)?authInput.identities.length:0,exactPublicShareReads:names.length,presentPublicShares:Object.keys(publicShares).length},
    sourceSnapshotHashes:{...Object.fromEntries(PRODUCTION_PATHS.map(key=>[key,hash(payload[key])])),authInput:hash(authInput),publicShares:hash(publicShares)},requestCount:PRODUCTION_PATHS.length+names.length}};
}
module.exports={MAX_EXACT_SHARE_READS,exactNames,verifyCliProduction,cliGet,readShareMigrationSources};
