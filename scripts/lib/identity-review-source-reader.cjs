const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {hash}=require('./uid-handle-source-reader.cjs');

const repoRoot=path.resolve(__dirname,'../..');
const privateRoot=path.join(repoRoot,'.local/uid-handle-audits');
const RTDB_SOURCE_KEYS=Object.freeze(['loginDirectory','users','authIndex','admins']);

function insidePrivateRoot(file){
  const relative=path.relative(privateRoot,path.resolve(file));
  return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));
}

function resolveInput(requested,source,label){
  if(!requested)throw Object.assign(new Error(`Missing ${label} input`),{code:'review_input_missing',label});
  const resolved=path.resolve(repoRoot,requested);
  if(!fs.existsSync(resolved))throw Object.assign(new Error(`${label} input was not found`),{code:'review_input_not_found',label});
  if(source==='private'){
    if(!insidePrivateRoot(resolved))throw Object.assign(new Error(`${label} must stay under .local/uid-handle-audits`),{code:'review_input_outside_private_root',label});
    const actual=fs.realpathSync(resolved);
    const actualRoot=fs.realpathSync(privateRoot);
    const relative=path.relative(actualRoot,actual);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error(`${label} resolves outside the private root`),{code:'review_input_outside_private_root',label});
    if((fs.statSync(actual).mode&0o077)!==0)throw Object.assign(new Error(`${label} must use private file permissions`),{code:'review_input_permissions',label});
  }
  return resolved;
}

function readJson(file,label){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){throw Object.assign(new Error(`${label} is not valid JSON`),{code:'review_input_invalid_json',label,cause:error});}
}

function readIdentityReviewInputs(options={}){
  const source=options.source;
  if(source!=='fixture'&&source!=='private')throw Object.assign(new Error('Review source must be fixture or private'),{code:'review_source_unsupported'});
  const reportFile=resolveInput(options.report,source,'reconciliation report');
  const rtdbFile=resolveInput(options.rtdbInput,source,'RTDB snapshot');
  const authFile=resolveInput(options.authInput,source,'sanitized Auth');
  const reportText=fs.readFileSync(reportFile,'utf8');
  const report=readJson(reportFile,'Reconciliation report');
  const rtdb=readJson(rtdbFile,'RTDB snapshot');
  const authInput=readJson(authFile,'Sanitized Auth');
  const unknownRoots=Object.keys(rtdb).filter(key=>!RTDB_SOURCE_KEYS.includes(key));
  if(unknownRoots.length)throw Object.assign(new Error('RTDB snapshot contains an unapproved source root'),{code:'review_source_root_unapproved'});
  for(const key of RTDB_SOURCE_KEYS){
    if(!rtdb[key]||typeof rtdb[key]!=='object'||Array.isArray(rtdb[key]))throw Object.assign(new Error(`Invalid RTDB source root: ${key}`),{code:'invalid_source_root',source:key});
  }
  return{
    report,
    sources:{...Object.fromEntries(RTDB_SOURCE_KEYS.map(key=>[key,rtdb[key]])),authInput},
    metadata:{
      source,
      sourceReportHash:crypto.createHash('sha256').update(reportText).digest('hex'),
      expectedSnapshotHashes:{...report.source.snapshotHashes},
      actualSnapshotHashes:{...Object.fromEntries(RTDB_SOURCE_KEYS.map(key=>[key,hash(rtdb[key])])),authInput:hash(authInput)}
    }
  };
}

module.exports={repoRoot,privateRoot,RTDB_SOURCE_KEYS,insidePrivateRoot,readIdentityReviewInputs};
