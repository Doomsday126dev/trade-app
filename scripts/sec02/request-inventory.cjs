'use strict';

const crypto=require('node:crypto');

const SCHEMA_VERSION=1;
const D2_FINAL_BOUNDARY='2026-08-15T20:17:40Z';
const PRODUCTION_CONFIRMATION='READ SEC02 REQUEST AGGREGATES AFTER D2';
const PRODUCTION_ORIGIN='https://trade-list-a4297-default-rtdb.firebaseio.com';
const PRODUCTION_PATH='/requests.json';
const REPORT_PATH='functions/.local/sec02-request-inventory-report.json';
const AUDIT_PATH='functions/.local/sec02-request-inventory-audit.json';
const MAX_RESPONSE_BYTES=10*1024*1024;
const MAX_RECORDS=100000;
const CONTROL=/[\u0000-\u001f\u007f]/u;
const NON_ASCII=/[^\u0000-\u007f]/u;
const CANONICAL_KEY=/^req_([0-9]+)_([a-z0-9]{1,5})$/u;
const CANONICAL_FIELDS=['note','requestedAt','status','username'];
const LENGTH_BUCKETS=Object.freeze([
  ['0',0,0],['1',1,1],['2-8',2,8],['9-16',9,16],['17-32',17,32],
  ['33-64',33,64],['65-128',65,128],['129-280',129,280],
  ['281-512',281,512],['513-1024',513,1024],['>1024',1025,Infinity]
]);
const SKEW_BUCKETS=Object.freeze([
  ['0',0,0],['1ms-1s',1,1000],['1s-1m',1001,60000],['1m-1h',60001,3600000],
  ['1h-1d',3600001,86400000],['1d-30d',86400001,2592000000],['>30d',2592000001,Infinity]
]);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}

function stableJson(value){return`${JSON.stringify(stable(value),null,2)}\n`;}
function digestReport(report){
  const hasher=crypto.createHash('sha256');
  hasher.end(stableJson(report));
  return hasher.digest('hex');
}
function codePoints(value){return[...value].length;}
function valueType(value){return value===null?'null':Array.isArray(value)?'array':typeof value;}
function increment(object,key,amount=1){object[key]=(object[key]||0)+amount;}
function bucketTemplate(definition){return Object.fromEntries(definition.map(([label])=>[label,0]));}
function addBucket(target,value,definition){
  const match=definition.find(([,min,max])=>value>=min&&value<=max);
  if(match)target[match[0]]++;
}

function textAggregate({includeMissing=false}={}){
  return{
    typeCounts:{},...(includeMissing?{missing:0}:{}),empty:0,whitespaceOnly:0,
    trimmedCodePointLength:{min:null,max:null,buckets:bucketTemplate(LENGTH_BUCKETS),label:'inventory buckets only; not validation policy'},
    utf8ByteLengthMax:null,leadingOrTrailingWhitespace:0,controlCharacterBearing:0,unicodeNonAscii:0
  };
}

function inspectText(target,value,{username=false}={}){
  increment(target.typeCounts,valueType(value));
  if(typeof value!=='string')return;
  const trimmed=value.trim();
  const length=codePoints(trimmed);
  const bytes=Buffer.byteLength(trimmed,'utf8');
  target.empty+=value.length===0?1:0;
  target.whitespaceOnly+=value.length>0&&trimmed.length===0?1:0;
  target.trimmedCodePointLength.min=target.trimmedCodePointLength.min===null?length:Math.min(target.trimmedCodePointLength.min,length);
  target.trimmedCodePointLength.max=target.trimmedCodePointLength.max===null?length:Math.max(target.trimmedCodePointLength.max,length);
  target.utf8ByteLengthMax=target.utf8ByteLengthMax===null?bytes:Math.max(target.utf8ByteLengthMax,bytes);
  addBucket(target.trimmedCodePointLength.buckets,length,LENGTH_BUCKETS);
  target.leadingOrTrailingWhitespace+=value!==trimmed?1:0;
  target.controlCharacterBearing+=CONTROL.test(value)?1:0;
  target.unicodeNonAscii+=NON_ASCII.test(value)?1:0;
  if(username)target.underCurrentMinimumTwo+=(length<2)?1:0;
}

function classifyKey(key){
  const canonical=CANONICAL_KEY.exec(key);
  if(canonical)return{category:'canonical',timestamp:Number(canonical[1]),suffixLength:canonical[2].length};
  if(!key.startsWith('req_'))return{category:'wrongPrefix'};
  const parts=key.slice(4).split('_');
  if(parts.length<2||parts.slice(1).join('_')==='')return{category:'suffixMissing',timestamp:/^[0-9]+$/u.test(parts[0])?Number(parts[0]):null};
  const timestamp=/^[0-9]+$/u.test(parts[0])?Number(parts[0]):null;
  if(timestamp===null)return{category:'timestampInvalid'};
  const suffix=parts.slice(1).join('_');
  if(/^[a-z0-9]+$/u.test(suffix)&&suffix.length>5)return{category:'suffixTooLong',timestamp};
  if(!/^[a-z0-9]+$/u.test(suffix))return{category:'uppercaseOrNonBase36Suffix',timestamp};
  return{category:'other',timestamp};
}

function compatibilityStatus(exceptionCount,policyPending=false){
  if(exceptionCount>0)return'HISTORICAL EXCEPTION EXISTS';
  return policyPending?'NEEDS POLICY DECISION':'COMPATIBLE WITH CURRENT CONTRACT';
}

function aggregateRequests(records,{executionTimeMs}={}){
  if(!records||typeof records!=='object'||Array.isArray(records))throw new Error('SEC02_SOURCE_SHAPE_INVALID');
  if(!Number.isSafeInteger(executionTimeMs)||executionTimeMs<0)throw new Error('SEC02_EXECUTION_TIME_INVALID');
  const entries=Object.entries(records);
  if(entries.length>MAX_RECORDS)throw new Error('SEC02_RECORD_LIMIT_EXCEEDED');
  const report={
    schemaVersion:SCHEMA_VERSION,
    scope:'aggregate-only requests subtree compatibility inventory',
    policyNotice:'Evidence only. No username, note, or timestamp-skew limits are selected.',
    recordCount:entries.length,
    keys:{canonical:0,noncanonical:0,classifications:{wrongPrefix:0,timestampInvalid:0,suffixMissing:0,suffixTooLong:0,uppercaseOrNonBase36Suffix:0,other:0},suffixLengthDistribution:{},timestampParseability:{parseable:0,unparseable:0},unexpectedKeyForms:0},
    fieldSets:{exactCanonicalFourFieldShape:0,missing:{username:0,note:0,requestedAt:0,status:0},unknownChildCount:0,nestedObjectCount:0,distinctShapes:[]},
    username:{...textAggregate({includeMissing:true}),underCurrentMinimumTwo:0},
    note:textAggregate({includeMissing:true}),
    requestedAt:{typeCounts:{},integer:0,nonInteger:0,negative:0,numericMinimum:null,numericMaximum:null,keyPayloadRelationship:{equal:0,payloadBeforeKey:0,payloadAfterKey:0,unavailable:0},absoluteSkewBuckets:{...bucketTemplate(SKEW_BUCKETS),label:'inventory evidence only; not skew policy'},obviousFuture:0,impossibleNumericValue:0},
    status:{counts:{},missing:0,wrongType:0},unknownChildren:[],compatibility:{}
  };
  const shapes={},unknown={};
  let current46RejectedRecords=0,legacy40RejectedRecords=0,candidateRulesRejectedRecords=0;
  for(const [key,record] of entries){
    const keyInfo=classifyKey(String(key));
    let currentRejected=keyInfo.category!=='canonical';
    let legacyRejected=currentRejected;
    let candidateRejected=currentRejected;
    if(keyInfo.category==='canonical'){
      report.keys.canonical++;
      increment(report.keys.suffixLengthDistribution,String(keyInfo.suffixLength));
    }else{
      report.keys.noncanonical++;report.keys.unexpectedKeyForms++;increment(report.keys.classifications,keyInfo.category);
    }
    if(Number.isSafeInteger(keyInfo.timestamp))report.keys.timestampParseability.parseable++;else report.keys.timestampParseability.unparseable++;
    if(!record||typeof record!=='object'||Array.isArray(record)){
      current46RejectedRecords++;legacy40RejectedRecords++;candidateRulesRejectedRecords++;
      increment(shapes,JSON.stringify([]));
      for(const field of CANONICAL_FIELDS)report.fieldSets.missing[field]++;
      report.requestedAt.typeCounts[valueType(undefined)]=(report.requestedAt.typeCounts[valueType(undefined)]||0)+1;
      report.requestedAt.keyPayloadRelationship.unavailable++;
      report.status.missing++;
      continue;
    }
    const fields=Object.keys(record).sort();
    const exactShape=JSON.stringify(fields)===JSON.stringify(CANONICAL_FIELDS);
    currentRejected||=!exactShape;legacyRejected||=!exactShape;candidateRejected||=!exactShape;
    increment(shapes,JSON.stringify(fields));
    if(JSON.stringify(fields)===JSON.stringify(CANONICAL_FIELDS))report.fieldSets.exactCanonicalFourFieldShape++;
    for(const field of CANONICAL_FIELDS)if(!Object.hasOwn(record,field))report.fieldSets.missing[field]++;
    for(const field of fields){
      if(!CANONICAL_FIELDS.includes(field)){report.fieldSets.unknownChildCount++;increment(unknown,field);}
      if(record[field]&&typeof record[field]==='object')report.fieldSets.nestedObjectCount++;
    }
    if(Object.hasOwn(record,'username'))inspectText(report.username,record.username,{username:true});else report.username.missing++;
    if(Object.hasOwn(record,'note'))inspectText(report.note,record.note);else report.note.missing++;
    const requestedAt=record.requestedAt;
    increment(report.requestedAt.typeCounts,valueType(requestedAt));
    if(typeof requestedAt==='number'&&Number.isFinite(requestedAt)){
      report.requestedAt.numericMinimum=report.requestedAt.numericMinimum===null?requestedAt:Math.min(report.requestedAt.numericMinimum,requestedAt);
      report.requestedAt.numericMaximum=report.requestedAt.numericMaximum===null?requestedAt:Math.max(report.requestedAt.numericMaximum,requestedAt);
      if(Number.isInteger(requestedAt))report.requestedAt.integer++;else report.requestedAt.nonInteger++;
      if(requestedAt<0)report.requestedAt.negative++;
      if(requestedAt>253402300799999)report.requestedAt.impossibleNumericValue++;
      if(requestedAt>executionTimeMs+86400000)report.requestedAt.obviousFuture++;
      if(Number.isSafeInteger(keyInfo.timestamp)){
        if(requestedAt===keyInfo.timestamp)report.requestedAt.keyPayloadRelationship.equal++;
        else if(requestedAt<keyInfo.timestamp)report.requestedAt.keyPayloadRelationship.payloadBeforeKey++;
        else report.requestedAt.keyPayloadRelationship.payloadAfterKey++;
        addBucket(report.requestedAt.absoluteSkewBuckets,Math.abs(requestedAt-keyInfo.timestamp),SKEW_BUCKETS);
      }else report.requestedAt.keyPayloadRelationship.unavailable++;
    }else{
      report.requestedAt.nonInteger++;
      report.requestedAt.keyPayloadRelationship.unavailable++;
    }
    if(!Object.hasOwn(record,'status'))report.status.missing++;
    else if(typeof record.status!=='string')report.status.wrongType++;
    else increment(report.status.counts,record.status);
    const usernameValid=typeof record.username==='string'&&record.username===record.username.trim()&&codePoints(record.username)>=2;
    const noteValid=typeof record.note==='string'&&record.note===record.note.trim();
    const timestampValid=Number.isSafeInteger(record.requestedAt)&&record.requestedAt>=0;
    const statusValid=typeof record.status==='string'&&['pending','approved','denied'].includes(record.status);
    legacyRejected||=!usernameValid||!noteValid||!timestampValid||!statusValid;
    currentRejected||=legacyRejected||CONTROL.test(record.username||'')||CONTROL.test(record.note||'');
    candidateRejected||=currentRejected;
    current46RejectedRecords+=currentRejected?1:0;
    legacy40RejectedRecords+=legacyRejected?1:0;
    candidateRulesRejectedRecords+=candidateRejected?1:0;
  }
  report.fieldSets.distinctShapes=Object.entries(shapes).map(([fields,count])=>({fields:JSON.parse(fields),count})).sort((a,b)=>JSON.stringify(a.fields).localeCompare(JSON.stringify(b.fields)));
  report.unknownChildren=Object.entries(unknown).map(([field,count])=>({field,count})).sort((a,b)=>a.field.localeCompare(b.field));
  report.compatibility={
    current46:{result:compatibilityStatus(current46RejectedRecords,true),rejectedRecordCount:current46RejectedRecords,unresolvedPolicies:['username maximum','note maximum','requestedAt skew']},
    legacy40:{result:compatibilityStatus(legacy40RejectedRecords,true),rejectedRecordCount:legacy40RejectedRecords,note:'Legacy cached writer comparison does not treat newly rejected C0/DEL values as writer incompatibility.',unresolvedPolicies:['username maximum','note maximum','requestedAt skew']},
    candidateRules:{wouldRejectObservedCount:candidateRulesRejectedRecords,result:compatibilityStatus(candidateRulesRejectedRecords)},
    automaticPolicySelection:false
  };
  return stable(report);
}

module.exports=Object.freeze({
  SCHEMA_VERSION,D2_FINAL_BOUNDARY,PRODUCTION_CONFIRMATION,PRODUCTION_ORIGIN,PRODUCTION_PATH,
  REPORT_PATH,AUDIT_PATH,MAX_RESPONSE_BYTES,MAX_RECORDS,LENGTH_BUCKETS,CANONICAL_KEY,
  stable,stableJson,digestReport,classifyKey,aggregateRequests
});
