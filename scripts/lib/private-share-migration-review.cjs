const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {privateRoot}=require('./identity-review-source-reader.cjs');

function canonical(value){
  if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:canonical(value)).digest('hex');}
function insidePrivateRoot(file){const relative=path.relative(privateRoot,path.resolve(file));return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));}
function resolvePrivate(file,label,{mustExist=false}={}){
  if(!file)throw Object.assign(new Error(`Missing ${label}`),{code:'review/private_path_missing'});
  const resolved=path.resolve(file);
  if(!insidePrivateRoot(resolved))throw Object.assign(new Error(`${label} must stay private`),{code:'review/private_path_outside_root'});
  if(mustExist){
    const actual=fs.realpathSync(resolved),actualRoot=fs.realpathSync(privateRoot),relative=path.relative(actualRoot,actual);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error(`${label} escaped private root`),{code:'review/private_path_outside_root'});
    if((fs.statSync(actual).mode&0o077)!==0)throw Object.assign(new Error(`${label} permissions are not private`),{code:'review/private_permissions'});
    return actual;
  }
  return resolved;
}
function readPrivateJson(file,label){
  const resolved=resolvePrivate(file,label,{mustExist:true});
  try{return{file:resolved,bytes:fs.readFileSync(resolved),value:JSON.parse(fs.readFileSync(resolved,'utf8'))};}
  catch(error){throw Object.assign(new Error(`${label} is not valid JSON`),{code:'review/invalid_json',cause:error});}
}
function evidenceFor(record){
  const value={...record};
  for(const key of ['reviewerDecision','reviewerNote','reviewedAt','evidenceHash'])delete value[key];
  return value;
}
function counts(values,keys){return Object.fromEntries(keys.map(key=>[key,values.filter(value=>value===key).length]));}
function summarize(artifact){
  const records=artifact.records;
  const classificationKeys=[...new Set(records.map(record=>record.classification))].sort();
  const reasonKeys=[...new Set(records.flatMap(record=>record.reasonCodes))].sort();
  const decisionKeys=[...new Set(['unreviewed',...records.map(record=>record.reviewerDecision)])].sort();
  const confidenceKeys=['high','medium','low','unknown'];
  const queueKeys=['protected_accounts','duplicate_conflicts','invalid_uid_authindex_linkage','individually_reviewable','unresolved_records','missing_incomplete_projections','other_diagnostic'];
  return{
    totalRecords:records.length,
    classificationCounts:counts(records.map(record=>record.classification),classificationKeys),
    reasonCodeCounts:Object.fromEntries(reasonKeys.map(key=>[key,records.filter(record=>record.reasonCodes.includes(key)).length])),
    reviewerDecisionCounts:counts(records.map(record=>record.reviewerDecision),decisionKeys),
    confidenceCounts:counts(records.map(record=>record.confidence),confidenceKeys),
    queueCounts:counts(records.map(record=>record.queue),queueKeys)
  };
}
function historyEventHash(event){const value={...event};delete value.eventHash;return hash(value);}
function reportContentHash(artifact){const value=JSON.parse(JSON.stringify(artifact));if(value.integrity)delete value.integrity.reportContentHash;return hash(value);}
function seal(artifact){
  const next=JSON.parse(JSON.stringify(artifact));
  next.summary=summarize(next);
  next.integrity=next.integrity||{};
  next.integrity.evidenceRootHash=hash(next.records.map(record=>record.evidenceHash));
  next.integrity.historyHeadHash=next.reviewHistory.length?next.reviewHistory.at(-1).eventHash:null;
  next.integrity.reportContentHash=reportContentHash(next);
  return next;
}
function buildArtifact(derived,sourceReport,sourceBytes,{createdAt=new Date().toISOString()}={}){
  const records=derived.records.map(record=>({...record,evidenceHash:hash(evidenceFor(record)),reviewerDecision:'unreviewed',reviewerNote:'',reviewedAt:null,seedEligible:false}));
  return seal({
    schemaVersion:1,
    toolVersion:'share-migration-manual-review-v1',
    createdAt,
    updatedAt:createdAt,
    sourceAudit:{
      sha256:hash(sourceBytes),
      schemaVersion:sourceReport.schemaVersion,
      toolVersion:sourceReport.toolVersion,
      generatedAt:sourceReport.generatedAt,
      sourceSnapshots:{capturedAt:sourceReport.generatedAt,hashes:{...sourceReport.source.snapshotHashes}},
      staleWarning:'This review is diagnostic only and becomes stale when production source state changes. Run a fresh read-only audit instead of merging evidence.'
    },
    constraints:{diagnosticOnly:true,productionWrites:0,seedEligible:false,createsMigrationPayload:false,createsOwnershipAuthorization:false},
    records,
    reviewHistory:[],
    summary:{},
    integrity:{}
  });
}
function verifyArtifact(artifact,sourceBytes){
  if(!artifact||artifact.schemaVersion!==1||!Array.isArray(artifact.records)||!Array.isArray(artifact.reviewHistory))throw Object.assign(new Error('Invalid review artifact'),{code:'review/artifact_invalid'});
  if(hash(sourceBytes)!==artifact.sourceAudit?.sha256)throw Object.assign(new Error('Source audit hash changed; regenerate the review'),{code:'review/source_audit_changed'});
  if(artifact.records.some(record=>record.seedEligible!==false))throw Object.assign(new Error('Seed eligibility invariant failed'),{code:'review/seed_eligibility_changed'});
  for(const record of artifact.records)if(hash(evidenceFor(record))!==record.evidenceHash)throw Object.assign(new Error('Immutable evidence changed'),{code:'review/evidence_tampered'});
  let previous=null;
  for(let index=0;index<artifact.reviewHistory.length;index++){
    const event=artifact.reviewHistory[index];
    if(event.sequence!==index+1||event.previousEventHash!==previous||historyEventHash(event)!==event.eventHash)throw Object.assign(new Error('Review history changed'),{code:'review/history_tampered'});
    previous=event.eventHash;
  }
  const expectedEvidence=hash(artifact.records.map(record=>record.evidenceHash));
  if(artifact.integrity?.evidenceRootHash!==expectedEvidence||artifact.integrity?.historyHeadHash!==previous||artifact.integrity?.reportContentHash!==reportContentHash(artifact))throw Object.assign(new Error('Review integrity check failed'),{code:'review/integrity_failed'});
  return true;
}
function applyDecision(artifact,sourceBytes,{recordId,decision,note='',reviewedAt=new Date().toISOString(),allowedDecision}){
  verifyArtifact(artifact,sourceBytes);
  const next=JSON.parse(JSON.stringify(artifact));
  const record=next.records.find(item=>item.recordId===recordId);
  if(!record)throw Object.assign(new Error('Review record was not found'),{code:'review/record_not_found'});
  if(typeof allowedDecision!=='function'||!allowedDecision(record,decision))throw Object.assign(new Error('Decision is not allowed for this record'),{code:'review/decision_invalid'});
  if(typeof note!=='string'||note.length>4000)throw Object.assign(new Error('Reviewer note is invalid'),{code:'review/note_invalid'});
  const event={
    sequence:next.reviewHistory.length+1,
    recordId,
    previousEventHash:next.reviewHistory.length?next.reviewHistory.at(-1).eventHash:null,
    previousDecision:record.reviewerDecision,
    newDecision:decision,
    previousNote:record.reviewerNote,
    newNote:note,
    reviewedAt
  };
  event.eventHash=historyEventHash(event);
  next.reviewHistory.push(event);
  record.reviewerDecision=decision;record.reviewerNote=note;record.reviewedAt=reviewedAt;record.seedEligible=false;
  next.updatedAt=reviewedAt;
  return seal(next);
}
function writePrivateJson(value,file,label){
  const output=resolvePrivate(file,label);
  fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  const actualRoot=fs.realpathSync(privateRoot),actualParent=fs.realpathSync(path.dirname(output)),relative=path.relative(actualRoot,actualParent);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error(`${label} parent escaped private root`),{code:'review/private_path_outside_root'});
  fs.chmodSync(path.dirname(output),0o700);
  const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0),0o600);
  try{fs.writeFileSync(fd,`${JSON.stringify(value,null,2)}\n`);}finally{fs.closeSync(fd);}fs.chmodSync(output,0o600);return output;
}
function privateInspection(artifact,recordId){
  const record=artifact.records.find(item=>item.recordId===recordId);
  if(!record)throw Object.assign(new Error('Review record was not found'),{code:'review/record_not_found'});
  return{schemaVersion:1,toolVersion:artifact.toolVersion,sourceAuditHash:artifact.sourceAudit.sha256,staleWarning:artifact.sourceAudit.staleWarning,record:JSON.parse(JSON.stringify(record)),seedEligible:false,productionWrites:0};
}
function aggregateOutput(artifact,bytes,{status='review-ready'}={}){
  return{...summarize(artifact),sourceAuditHash:`sha256:${artifact.sourceAudit.sha256}`,reportHash:`sha256:${hash(bytes)}`,status,writes:0};
}

module.exports={canonical,hash,resolvePrivate,readPrivateJson,evidenceFor,summarize,buildArtifact,verifyArtifact,applyDecision,writePrivateJson,privateInspection,aggregateOutput};
