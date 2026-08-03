const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const privateRoot=path.join(repoRoot,'.local/uid-handle-audits');
const PRODUCTION_PATHS=Object.freeze(['loginDirectory','users','authIndex','admins']);

function stableJson(value){
  if(Array.isArray(value))return`[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value){return crypto.createHash('sha256').update(stableJson(value)).digest('hex');}
function insidePrivateRoot(file){const rel=path.relative(privateRoot,path.resolve(file));return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}
function readJson(file,label){
  const resolved=path.resolve(file);
  if(!fs.existsSync(resolved))throw Object.assign(new Error(`${label} input was not found`),{code:'input_not_found'});
  return JSON.parse(fs.readFileSync(resolved,'utf8'));
}
function verifyProduction(options,env=process.env){
  if(!options.allowProductionRead)throw Object.assign(new Error('Production reads require --allow-production-read'),{code:'production_read_not_confirmed'});
  for(const key of ['projectId','databaseId','databaseUrl','confirmProject','confirmDatabase','authTokenEnv'])if(!options[key])throw Object.assign(new Error(`Missing production option: ${key}`),{code:'production_target_incomplete'});
  if(options.projectId!==options.confirmProject||options.databaseId!==options.confirmDatabase)throw Object.assign(new Error('Production target confirmation mismatch'),{code:'production_target_mismatch'});
  const url=new URL(options.databaseUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Object.assign(new Error('Invalid production database URL'),{code:'production_url_invalid'});
  const hostOk=url.hostname===`${options.databaseId}.firebaseio.com`||(url.hostname.startsWith(`${options.databaseId}.`)&&url.hostname.endsWith('.firebasedatabase.app'));
  if(!hostOk||!(options.databaseId===options.projectId||options.databaseId.startsWith(`${options.projectId}-`)))throw Object.assign(new Error('Production database target mismatch'),{code:'production_target_mismatch'});
  const token=env[options.authTokenEnv];
  if(!token)throw Object.assign(new Error('Production auth token environment variable is empty'),{code:'production_token_missing'});
  return{url,token};
}
function authInputPath(options){
  if(!options.authInput)return null;
  const resolved=path.resolve(repoRoot,options.authInput);
  if(options.source!=='fixture'&&!insidePrivateRoot(resolved))throw Object.assign(new Error('Auth input must stay under .local/uid-handle-audits'),{code:'auth_input_outside_private_root'});
  if(options.source!=='fixture'){
    const actual=fs.realpathSync(resolved);
    const actualRoot=fs.realpathSync(privateRoot);
    const relative=path.relative(actualRoot,actual);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Auth input must stay under .local/uid-handle-audits'),{code:'auth_input_outside_private_root'});
  }
  return resolved;
}
async function readSources(options,{fetchImpl=global.fetch,env=process.env}={}){
  const source=options.source||'fixture';
  const authFile=authInputPath({...options,source});
  const authInput=authFile?readJson(authFile,'Sanitized Auth'):null;
  if(source==='fixture'){
    const file=path.resolve(repoRoot,options.input||'tests/fixtures/uid-handle-rtdb.synthetic.json');
    const payload=readJson(file,'RTDB fixture');
    return packageResult(source,payload,authInput,false);
  }
  if(source!=='production')throw Object.assign(new Error('Unsupported source; use fixture or production'),{code:'source_unsupported'});
  const target=verifyProduction(options,env);
  const payload={};
  for(const key of PRODUCTION_PATHS){
    const endpoint=new URL(`${key}.json`,target.url.href.endsWith('/')?target.url.href:`${target.url.href}/`);
    endpoint.searchParams.set('auth',target.token);
    const response=await fetchImpl(endpoint,{method:'GET',headers:{Accept:'application/json'}});
    if(!response.ok)throw Object.assign(new Error(`Production read failed for an approved source with HTTP ${response.status}`),{code:'production_read_failed',status:response.status});
    payload[key]=(await response.json())||{};
  }
  return packageResult(source,payload,authInput,true);
}
function packageResult(source,payload,authInput,targetVerified){
  for(const key of PRODUCTION_PATHS)if(!payload[key]||typeof payload[key]!=='object'||Array.isArray(payload[key]))throw Object.assign(new Error(`Invalid source root: ${key}`),{code:'invalid_source_root'});
  return{
    sources:{...Object.fromEntries(PRODUCTION_PATHS.map(key=>[key,payload[key]])),authInput},
    metadata:{source,targetVerified,sourceCounts:{...Object.fromEntries(PRODUCTION_PATHS.map(key=>[key,Object.keys(payload[key]).length])),authIdentities:Array.isArray(authInput?.identities)?authInput.identities.length:0},sourceSnapshotHashes:{...Object.fromEntries(PRODUCTION_PATHS.map(key=>[key,hash(payload[key])])),authInput:hash(authInput)}}
  };
}
module.exports={PRODUCTION_PATHS,privateRoot,stableJson,hash,insidePrivateRoot,verifyProduction,readSources};
