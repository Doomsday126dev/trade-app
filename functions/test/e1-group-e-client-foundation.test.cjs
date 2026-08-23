'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const {GATES,createHandler,groupEAttemptHash,groupEResponseBinding,loadConfiguration}=require('../e1-authority-service/server');
const {GROUP_E_CANARY_MODE,createReadLimiter,groupESubjectHash}=require('../e1-authority-service/readRateLimiters');
const {createGatewayOperation,groupEAttemptHash:gatewayAttemptHash,groupEResponseBinding:gatewayResponseBinding,
  loadGatewayConfiguration}=require('../e1-gateway/gatewayCore');
const {PRODUCTION}=require('../e1-authority-service/e1TargetContracts');

const NOW=Date.parse('2030-01-01T12:00:00.000Z');
const UID_A='syntheticGroupEUidA',UID_B='syntheticGroupEUidB',UID_C='syntheticGroupEUidC';
const TRAINER_A='SyntheticGroupEA',TRAINER_B='SyntheticGroupEB';
const ATTEMPT='123e4567-e89b-42d3-a456-426614174000';
const COHORT='c'.repeat(64);
const BINDINGS=[[UID_A,TRAINER_A],[UID_B,TRAINER_B]].map(([uid,trainer])=>
  `${groupESubjectHash('uid',uid)}:${groupESubjectHash('trainer',trainer)}`).join(';');

function authorityEnvironment(overrides={}){return{
  APP_ENVIRONMENT:PRODUCTION.environment,FIREBASE_PROJECT_ID:PRODUCTION.projectId,EXPECTED_PROJECT_NUMBER:'1053781218847',
  FIRESTORE_DATABASE_ID:PRODUCTION.databaseId,SERVICE_REGION:PRODUCTION.region,AUTHORITY_SERVICE_NAME:PRODUCTION.serviceName,
  EXPECTED_RUNTIME_SERVICE_ACCOUNT:PRODUCTION.runtimeServiceAccount,RTDB_DATABASE_URL:PRODUCTION.rtdbDatabaseUrl,
  FIREBASE_WEB_API_KEY:'synthetic-production-firebase-web-key',EXPECTED_OPERATOR_EMAIL_HASH:'a'.repeat(64),
  EXPECTED_OPERATOR_SUBJECT_HASH:'b'.repeat(64),...Object.fromEntries(GATES.map((gate)=>[gate,'false'])),
  READ_ACCOUNT_FOUNDATION_ENABLED:'true',READ_PROOF_MODE:'false',GROUP_E_CLIENT_MODE:'synthetic-canary',
  GROUP_E_SUBJECT_BINDINGS:BINDINGS,GROUP_E_COHORT_DIGEST:COHORT,GROUP_E_WINDOW_START:'2030-01-01T11:50:00.000Z',
  GROUP_E_WINDOW_END:'2030-01-01T12:20:00.000Z',...overrides};}
function gatewayEnvironment(overrides={}){return{
  APP_ENVIRONMENT:'production',FIREBASE_PROJECT_ID:'trade-list-a4297',SERVICE_REGION:'us-central1',
  E1_AUTHORITY_URL:'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/',
  E1_AUTHORITY_AUDIENCE:'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
  E1_GATEWAY_SERVICE_ACCOUNT:'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
  GATEWAY_INVOCATION_ENABLED:'true',APP_CHECK_ENFORCEMENT_MODE:'monitor',APP_CHECK_DEBUG_TOKENS_ALLOWED:'false',
  E1_RATE_LIMIT_POLICY:'firestore-rolling-v1',READ_PROOF_MODE:'false',GROUP_E_CLIENT_MODE:'synthetic-canary',
  GROUP_E_SUBJECT_BINDINGS:BINDINGS,GROUP_E_COHORT_DIGEST:COHORT,GROUP_E_WINDOW_START:'2030-01-01T11:50:00.000Z',
  GROUP_E_WINDOW_END:'2030-01-01T12:20:00.000Z',...overrides};}
function callable(uid=UID_A,data={schemaVersion:1,attemptId:ATTEMPT}){return{auth:{uid},app:{appId:'production-app'},data,
  rawRequest:{headers:{authorization:'Bearer firebase-id-token'}}};}
function request(body={schemaVersion:1,attemptId:ATTEMPT},headers={}){
  const raw=JSON.stringify(body),input=new EventEmitter();input.method='POST';input.url='/v1/read-account-foundation';
  input.headers={'content-length':String(Buffer.byteLength(raw)),'x-firebase-id-token':'synthetic-token',
    'x-e1-client-mode':'synthetic-canary','x-e1-cohort-digest':COHORT,...headers};
  input[Symbol.asyncIterator]=async function*(){yield Buffer.from(raw);};return input;
}
function invoke(handler,body,headers){return new Promise((resolve)=>{const output=new EventEmitter();
  output.writeHead=(status)=>{output.status=status;};output.end=(payload)=>resolve({status:output.status,body:JSON.parse(payload)});
  handler(request(body,headers),output);});}

test('Group E gateway admits only exact A/B Auth subjects and propagates the exact caller-neutral schema',async()=>{
  const config=loadGatewayConfiguration(gatewayEnvironment(),()=>NOW),logs=[];let calls=0,boundary;
  const handler=createGatewayOperation('readAccountFoundation',config,{structuredLog:(entry)=>logs.push(entry),
    invokeAuthority:async(_operation,value)=>{calls++;boundary=value;return{status:200,payload:{schemaVersion:1,
      code:'FOUNDATION_NOT_INITIALIZED',attemptHash:gatewayAttemptHash(ATTEMPT),subjectBinding:gatewayResponseBinding(UID_A,ATTEMPT)}};}});
  const result=await handler(callable());
  assert.equal(result.code,'FOUNDATION_NOT_INITIALIZED');assert.deepEqual(boundary.body,{schemaVersion:1,attemptId:ATTEMPT});
  assert.equal(logs[0].attemptHash,gatewayAttemptHash(ATTEMPT));assert.equal(logs[0].authoritativeCallBudget,false);
  assert.equal(JSON.stringify(logs).includes(ATTEMPT),false);
  await assert.rejects(handler(callable(UID_C)),/GROUP_E_SUBJECT_DENIED/);assert.equal(calls,1);
});

test('Group E gateway rejects malformed wrong-mode and expired activation before authority use',async()=>{
  assert.throws(()=>loadGatewayConfiguration(gatewayEnvironment({GROUP_E_WINDOW_END:'2030-01-01T12:50:00.000Z'}),()=>NOW),
    /GROUP_E_CONFIGURATION_INVALID/);
  assert.throws(()=>loadGatewayConfiguration(gatewayEnvironment({READ_PROOF_MODE:'true'}),()=>NOW),/GROUP_E_CONFIGURATION_INVALID/);
  const disabled=gatewayEnvironment({GATEWAY_INVOCATION_ENABLED:'false',GROUP_E_CLIENT_MODE:'disabled',GROUP_E_SUBJECT_BINDINGS:undefined,
    GROUP_E_COHORT_DIGEST:undefined,GROUP_E_WINDOW_START:undefined,GROUP_E_WINDOW_END:undefined});
  assert.equal(loadGatewayConfiguration(disabled,()=>NOW).groupE.enabled,false);
  const config=loadGatewayConfiguration(gatewayEnvironment(),()=>NOW);
  const handler=createGatewayOperation('readAccountFoundation',config,{invokeAuthority:async()=>({status:200,payload:{}})});
  await assert.rejects(handler(callable(UID_A,{schemaVersion:1})),/REQUEST_INVALID/);
});

test('authority independently verifies UID and reciprocal trainer binding and performs an exact named-database zero-write read',async()=>{
  const config=loadConfiguration(authorityEnvironment(),()=>NOW);assert.equal(config.readLimiterMode,GROUP_E_CANARY_MODE);
  let legacyReads=0,accountReads=0,durableWrites=0;const logs=[];
  const handler=createHandler(config,{now:()=>NOW,verifyFirebaseIdToken:async()=>({uid:UID_A}),
    readLegacyBinding:async()=>{legacyReads++;return{status:'ready',username:TRAINER_A,legacyAuthVersion:1};},
    readAccountDocument:async(configuration,uid)=>{accountReads++;assert.equal(configuration.databaseId,'phase-e-identity');assert.equal(uid,UID_A);return null;},
    consumeRateLimit:async()=>{durableWrites++;return{allowed:true};},structuredLog(_c,operation,outcome,_s,extra){logs.push({operation,outcome,extra});}});
  assert.deepEqual(await invoke(handler),{status:200,body:{schemaVersion:1,attemptHash:groupEAttemptHash(ATTEMPT),
    subjectBinding:groupEResponseBinding(UID_A,ATTEMPT),code:'FOUNDATION_NOT_INITIALIZED'}});
  assert.deepEqual({legacyReads,accountReads,durableWrites},{legacyReads:1,accountReads:1,durableWrites:0});
  assert.equal(logs[0].extra.authoritativeCallBudget,false);
});

test('authority rejects wrong trainer, wrong boundary, duplicate local telemetry and expired mode without writes',async()=>{
  const config=loadConfiguration(authorityEnvironment(),()=>NOW);let reads=0,writes=0;
  const wrong=createHandler(config,{now:()=>NOW,verifyFirebaseIdToken:async()=>({uid:UID_A}),
    readLegacyBinding:async()=>({status:'ready',username:TRAINER_B,legacyAuthVersion:1}),readAccountDocument:async()=>{reads++;return null;},
    consumeRateLimit:async()=>{writes++;},structuredLog(){}});
  assert.equal((await invoke(wrong)).status,403);assert.deepEqual({reads,writes},{reads:0,writes:0});
  const good=createHandler(config,{now:()=>NOW,verifyFirebaseIdToken:async()=>({uid:UID_A}),
    readLegacyBinding:async()=>({status:'ready',username:TRAINER_A,legacyAuthVersion:1}),readAccountDocument:async()=>null,structuredLog(){}});
  assert.equal((await invoke(good)).status,200);assert.equal((await invoke(good)).status,429);
  assert.equal((await invoke(good,undefined,{'x-e1-cohort-digest':'d'.repeat(64)})).status,403);
  assert.throws(()=>loadConfiguration(authorityEnvironment(),()=>Date.parse('2030-01-01T12:30:00.000Z')),
    /E1_GROUP_E_CONFIGURATION_INVALID/);
});

test('normal durable limiter and Group C remain separate and E.2 provider linking stays unreachable',()=>{
  const normal=loadConfiguration({...authorityEnvironment(),GROUP_E_CLIENT_MODE:'disabled',GROUP_E_SUBJECT_BINDINGS:undefined,
    GROUP_E_COHORT_DIGEST:undefined,GROUP_E_WINDOW_START:undefined,GROUP_E_WINDOW_END:undefined},()=>NOW);
  assert.equal(normal.readLimiterMode,'firestore-rolling-v1');
  assert.throws(()=>createReadLimiter({mode:'group-e-synthetic-read-v1',groupE:{bindings:[],start:1,end:2},now:()=>1}),
    /E1_GROUP_E_CONFIGURATION_INVALID/);
  const runtime=[fs.readFileSync(path.resolve(__dirname,'../e1-gateway/index.js'),'utf8'),
    fs.readFileSync(path.resolve(__dirname,'../e1-gateway/gatewayCore.js'),'utf8'),
    fs.readFileSync(path.resolve(__dirname,'../e1-authority-service/server.js'),'utf8')].join('\n');
  assert.doesNotMatch(runtime,/providerLink|linkProvider|unlinkProvider|provider-link/u);
  assert.deepEqual([...fs.readFileSync(path.resolve(__dirname,'../e1-gateway/index.js'),'utf8').matchAll(/exports\.([A-Za-z0-9_]+)\s*=/gu)]
    .map((match)=>match[1]),['readE1AccountFoundation','reserveE1TrainerHandle']);
});
