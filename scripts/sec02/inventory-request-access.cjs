#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const inventory=require('./request-inventory.cjs');

const TOOL_VERSION='sec02-request-inventory-v1';
const FIXTURE_MODE='--fixture';
const PRODUCTION_MODE='--production-aggregate-inventory';

function safeError(code){const error=new Error(code);error.code=code;return error;}
function normalizeConfirmation(value){return String(value||'').trim().replace(/\s+/gu,' ');}

function assertProductionGate({now=Date.now(),confirmation,origin,token,commitSha}={}){
  if(!Number.isFinite(now)||now<Date.parse(inventory.D2_FINAL_BOUNDARY))throw safeError('SEC02_D2_BOUNDARY_NOT_COMPLETE');
  if(normalizeConfirmation(confirmation)!==inventory.PRODUCTION_CONFIRMATION)throw safeError('SEC02_CONFIRMATION_INVALID');
  if(origin!==inventory.PRODUCTION_ORIGIN)throw safeError('SEC02_PRODUCTION_ORIGIN_INVALID');
  if(typeof token!=='string'||token.length<20)throw safeError('SEC02_READ_TOKEN_MISSING');
  if(!/^[0-9a-f]{40}$/u.test(String(commitSha||'')))throw safeError('SEC02_TOOL_COMMIT_INVALID');
  return true;
}

async function readProductionRequests({origin,token,fetchImpl=globalThis.fetch,timeoutMs=15000,maxBytes=inventory.MAX_RESPONSE_BYTES}={}){
  if(origin!==inventory.PRODUCTION_ORIGIN)throw safeError('SEC02_PRODUCTION_ORIGIN_INVALID');
  if(typeof fetchImpl!=='function')throw safeError('SEC02_FETCH_UNAVAILABLE');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetchImpl(`${inventory.PRODUCTION_ORIGIN}${inventory.PRODUCTION_PATH}`,{
      method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:controller.signal,redirect:'error'
    });
  }catch{
    throw safeError('SEC02_NETWORK_READ_FAILED');
  }finally{clearTimeout(timer);}
  if(!response||!response.ok)throw safeError(response?.status===401?'SEC02_AUTHENTICATION_FAILED':response?.status===403?'SEC02_PERMISSION_DENIED':'SEC02_NETWORK_READ_FAILED');
  const contentLength=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(contentLength)&&contentLength>maxBytes)throw safeError('SEC02_RESPONSE_TOO_LARGE');
  if(!String(response.headers?.get?.('content-type')||'').toLowerCase().includes('application/json'))throw safeError('SEC02_RESPONSE_CONTENT_TYPE_INVALID');
  if(!response.body?.getReader)throw safeError('SEC02_RESPONSE_STREAM_UNAVAILABLE');
  const reader=response.body.getReader();
  let chunks=[],received=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      received+=value.byteLength;
      if(received>maxBytes){controller.abort();throw safeError('SEC02_RESPONSE_TOO_LARGE');}
      chunks=chunks.concat(Buffer.from(value));
    }
  }catch(error){if(error?.code==='SEC02_RESPONSE_TOO_LARGE')throw error;throw safeError('SEC02_RESPONSE_READ_FAILED');}
  const bytes=Buffer.concat(chunks,received);
  let parsed;
  try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw safeError('SEC02_RESPONSE_JSON_INVALID');}
  if(parsed===null)return{};
  if(typeof parsed!=='object'||Array.isArray(parsed))throw safeError('SEC02_SOURCE_SHAPE_INVALID');
  return parsed;
}

function productionEnvelope({report,commitSha,executedAt}){
  const reportDigest=inventory.digestReport(report);
  return{
    report,
    reportDigest,
    audit:{
      schemaVersion:1,toolVersion:TOOL_VERSION,toolCommitSha:commitSha,
      executedAt,sourceDatabase:'trade-list-a4297-default-rtdb',sourcePath:'requests',
      recordCount:report.recordCount,success:true,operatorConfirmationAcknowledged:true,reportDigest
    }
  };
}

function writeEnvelopeAtomically(envelope,outputPath=inventory.REPORT_PATH){
  const absolute=path.resolve(outputPath);
  const allowed=path.resolve(inventory.REPORT_PATH);
  if(absolute!==allowed)throw safeError('SEC02_OUTPUT_PATH_INVALID');
  fs.mkdirSync(path.dirname(absolute),{recursive:true,mode:0o700});
  const temporary=`${absolute}.tmp-${process.pid}`;
  try{
    fs.writeFileSync(temporary,inventory.stableJson(envelope),{mode:0o600,flag:'wx'});
    fs.renameSync(temporary,absolute);
    fs.chmodSync(absolute,0o600);
  }catch(error){
    try{fs.unlinkSync(temporary);}catch{}
    throw safeError('SEC02_LOCAL_REPORT_WRITE_FAILED');
  }
}

function parseArgs(argv){
  const args=[...argv];
  if(args[0]===FIXTURE_MODE&&args[1]&&(args.length===2||(args.length===4&&args[2]==='--now'))){
    const nowIndex=args.indexOf('--now');
    const now=nowIndex>=0?Number(args[nowIndex+1]):Date.parse('2026-01-01T00:00:00Z');
    return{mode:'fixture',fixturePath:args[1],now};
  }
  if(args[0]===PRODUCTION_MODE&&args.length===3&&args[1]==='--confirmation'){
    return{mode:'production',confirmation:args[2]};
  }
  throw safeError('SEC02_MODE_REQUIRED');
}

async function main(argv=process.argv.slice(2),environment=process.env){
  const command=parseArgs(argv);
  if(command.mode==='fixture'){
    let fixture;
    try{fixture=JSON.parse(fs.readFileSync(path.resolve(command.fixturePath),'utf8'));}catch{throw safeError('SEC02_FIXTURE_INVALID');}
    const report=inventory.aggregateRequests(fixture,{executionTimeMs:command.now});
    process.stdout.write(inventory.stableJson({report,reportDigest:inventory.digestReport(report)}));
    return;
  }
  const now=Date.now();
  const config={
    now,confirmation:command.confirmation,origin:environment.SEC02_RTDB_ORIGIN,
    token:environment.SEC02_RTDB_BEARER_TOKEN,commitSha:environment.SEC02_TOOL_COMMIT_SHA
  };
  assertProductionGate(config);
  const records=await readProductionRequests(config);
  const report=inventory.aggregateRequests(records,{executionTimeMs:now});
  const envelope=productionEnvelope({report,commitSha:config.commitSha,executedAt:new Date(now).toISOString()});
  writeEnvelopeAtomically(envelope);
  process.stdout.write(inventory.stableJson({success:true,recordCount:report.recordCount,reportDigest:envelope.reportDigest,outputPath:inventory.REPORT_PATH}));
}

if(require.main===module){
  main().catch(error=>{process.stderr.write(`${error.code||'SEC02_INVENTORY_FAILED'}\n`);process.exitCode=1;});
}

module.exports=Object.freeze({
  TOOL_VERSION,FIXTURE_MODE,PRODUCTION_MODE,normalizeConfirmation,assertProductionGate,
  readProductionRequests,productionEnvelope,writeEnvelopeAtomically,parseArgs,main
});
