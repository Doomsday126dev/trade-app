'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../js/services/e1ClientFoundationCanary.js'),'utf8');
function digest(parts){return crypto.createHash('sha256').update(JSON.stringify(parts),'utf8').digest('hex');}
function load(){
  const window={crypto:crypto.webcrypto};
  vm.runInNewContext(source,{window,TextEncoder,setTimeout,clearTimeout});
  return window.PogoServices.e1ClientFoundationCanary;
}
function success(uid,attemptId){return{
  schemaVersion:1,code:'SUCCESS',attemptHash:digest([1,'group-e-client-attempt',attemptId]).slice(0,16),
  subjectBinding:digest([1,'group-e-client-response',uid,attemptId]),foundation:{schemaVersion:1,
    canonicalTrainerName:'Synthetic A',normalizedTrainerName:'synthetica',handleKey:'v1_73796e74686574696361',
    legacyUsername:'Synthetic A',status:'active',revision:1,createdAt:'2030-01-01T00:00:00.000Z',updatedAt:'2030-01-01T00:00:00.000Z'}
};}
function setup(overrides={}){
  const service=load(),uid='syntheticUidA123',attemptId='123e4567-e89b-42d3-a456-426614174000';
  const app={},instance={},auth={currentUser:{uid,getIdToken:async(force)=>{assert.equal(force,true);return'id-token';}}};
  let imports=0,calls=0,generation=1;
  const sdk={getFunctions(received,region){assert.equal(received,app);assert.equal(region,'us-central1');return{};},
    httpsCallable(_functions,name,options){assert.equal(name,'readE1AccountFoundation');
      assert.equal(JSON.stringify(options),JSON.stringify({limitedUseAppCheckTokens:true}));return async(body)=>{calls++;
      assert.equal(JSON.stringify(body),JSON.stringify({schemaVersion:1,attemptId}));return{data:success(uid,attemptId)};};}};
  const controller=service.createClientFoundationCanary({firebaseApp:app,auth,
    firebaseAppCheckReady:async()=>({ok:true,instance}),getSessionGeneration:()=>generation,
    importFunctionsSdk:async()=>{imports++;return sdk;},cryptoImpl:crypto.webcrypto,timeoutMs:1000,...overrides});
  const bindings={A:digest([1,'group-e-client-foundation','uid',uid]),B:'b'.repeat(64)};
  const config=(authorizedSlot='A')=>({mode:'synthetic-ab',bindings,cohortDigest:'c'.repeat(64),authorizedSlot,
    generationId:'123e4567-e89b-42d3-a456-426614174000',priorReconciliationDigest:authorizedSlot==='A'?null:'d'.repeat(64)});
  return{service,controller,auth,uid,attemptId,bindings,config,stats:()=>({imports,calls}),switchGeneration:()=>generation++};
}

test('Group E client is disabled by default and imports Functions only through explicit open/read',async()=>{
  const state=setup();
  assert.equal(state.controller.isEnabled(),false);
  assert.equal(state.controller.currentResult(),null);
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/disabled/);
  assert.deepEqual(state.stats(),{imports:0,calls:0});
  state.controller.open(state.config());
  const result=await state.controller.read({slot:'A',attemptId:state.attemptId});
  assert.equal(result.code,'SUCCESS');
  assert.equal(state.controller.currentResult(),result);
  assert.deepEqual(state.stats(),{imports:1,calls:1});
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/invocation-terminal/);
  assert.deepEqual(state.stats(),{imports:1,calls:1});
});

test('exact response allowlist rejects extra provider/internal fields and malformed frozen or missing responses',()=>{
  const {service,uid,attemptId}=setup();
  const expected={attemptHash:digest([1,'group-e-client-attempt',attemptId]).slice(0,16),
    subjectBinding:digest([1,'group-e-client-response',uid,attemptId])};
  assert.throws(()=>service.validateResponse({...success(uid,attemptId),providerLinks:[]},expected),/group-e\/response-invalid/);
  assert.deepEqual(service.validateResponse({schemaVersion:1,code:'FOUNDATION_NOT_INITIALIZED',...expected},expected).code,
    'FOUNDATION_NOT_INITIALIZED');
  assert.throws(()=>service.validateResponse({...success(uid,attemptId),code:'ACCOUNT_FROZEN'},expected),/group-e\/response-invalid/);
});

test('account switch session generation and App Check instance changes suppress stale results and clear memory',async()=>{
  let resolveCall;
  let markStarted;
  const callPromise=new Promise((resolve)=>{resolveCall=resolve;});
  const started=new Promise((resolve)=>{markStarted=resolve;});
  const state=setup({importFunctionsSdk:async()=>({getFunctions:()=>({}),httpsCallable:()=>()=>{markStarted();return callPromise;}})});
  state.controller.open(state.config());
  const pending=state.controller.read({slot:'A',attemptId:state.attemptId});
  await started;
  state.switchGeneration();
  resolveCall({data:success(state.uid,state.attemptId)});
  await assert.rejects(pending,/group-e\/stale-session/);
  assert.equal(state.controller.currentResult(),null);
  state.controller.close();
  assert.equal(state.controller.isEnabled(),false);
});

test('session change during SDK import is rejected before the terminal callable boundary',async()=>{
  let releaseImport,callCount=0;
  const importWait=new Promise((resolve)=>{releaseImport=resolve;});
  const state=setup({importFunctionsSdk:async()=>{await importWait;return{getFunctions:()=>({}),
    httpsCallable:()=>async()=>{callCount++;return{data:success(state.uid,state.attemptId)};}};}});
  state.controller.open(state.config());
  const pending=state.controller.read({slot:'A',attemptId:state.attemptId});
  await new Promise((resolve)=>setTimeout(resolve,0));
  state.switchGeneration();
  releaseImport();
  await assert.rejects(pending,/group-e\/stale-session/);
  assert.equal(callCount,0);
  assert.equal(state.controller.isTerminal(),false);
});

test('wrong sequence is rejected and callable failure permanently terminates the generation',async()=>{
  const state=setup({importFunctionsSdk:async()=>({getFunctions:()=>({}),httpsCallable:()=>async()=>{throw new Error('offline');}})});
  state.controller.open(state.config());
  await assert.rejects(state.controller.read({slot:'B',attemptId:state.attemptId}),/group-e\/sequence-denied/);
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/offline/);
  assert.equal(state.controller.isTerminal(),true);
  state.controller.clear();
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/invocation-terminal/);
  assert.equal(state.controller.currentResult(),null);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|set\(|update\(/);
});

test('malformed response is terminal and only a closed newly created controller can authorize a later slot',async()=>{
  const state=setup({importFunctionsSdk:async()=>({getFunctions:()=>({}),httpsCallable:()=>async()=>({data:{code:'SUCCESS'}})})});
  state.controller.open(state.config());
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/response-invalid/);
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/invocation-terminal/);
  state.controller.close();
  assert.throws(()=>state.controller.open(state.config('B')),/group-e\/controller-closed/);
});

test('a callable timeout is ambiguous and terminal with no resend',async()=>{
  const state=setup({timeoutMs:1000,importFunctionsSdk:async()=>({getFunctions:()=>({}),httpsCallable:()=>()=>new Promise(()=>{})})});
  state.controller.open(state.config());
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/callable-timeout/);
  assert.equal(state.controller.isTerminal(),true);
  await assert.rejects(state.controller.read({slot:'A',attemptId:state.attemptId}),/group-e\/invocation-terminal/);
});

test('slot B requires an exact prior reconciliation digest and cannot be opened from A configuration',()=>{
  const state=setup();
  const invalid={...state.config('B'),priorReconciliationDigest:null};
  assert.throws(()=>state.controller.open(invalid),/group-e\/configuration-invalid/);
  assert.equal(state.controller.open(state.config('B')).authorizedSlot,'B');
});

test('page integration has no ordinary startup trigger and clears the canary on every session boundary',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  assert.match(html,/__pogoCreateGroupEClientFoundationCanary=\(configuration\)=>/);
  assert.match(html,/import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-functions\.js'\)/);
  assert.match(html,/function resetSessionTransientUi[\s\S]*e1ClientFoundationCanary\.close\(\)/);
  assert.equal((html.match(/__pogoCreateGroupEClientFoundationCanary\(/g)||[]).length,0);
  assert.doesNotMatch(html,/providerLink|linkWithPopup|unlink\(/);
});
