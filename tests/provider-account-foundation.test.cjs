const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {normalizeHandle:normalizeAuthorityHandle}=require('../functions/e1-authority-service/handleNormalization');

const source=readFileSync(path.join(__dirname,'..','js/services/providerAccountFoundation.js'),'utf8');
const UUID='123e4567-e89b-42d3-a456-426614174000';

function storage(){
  const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),values};
}
function readFoundation(overrides={}){
  return{schemaVersion:1,canonicalTrainerName:'TrainerNew',normalizedTrainerName:'trainernew',
    handleKey:'v1_747261696e65726e6577',legacyUsername:null,status:'active',revision:1,createdAt:1,updatedAt:2,...overrides};
}
function createFoundation(overrides={}){
  return{schemaVersion:1,canonicalTrainerName:'TrainerNew',normalizedTrainerName:'trainernew',
    handleKey:'v1_747261696e65726e6577',legacyUsername:null,identityKind:'provider_only',legacyAccessConfigured:false,
    status:'active',revision:1,...overrides};
}
function load(){
  const window={};window.window=window;
  vm.runInContext(source,vm.createContext({window,console,TextEncoder,TextDecoder,setTimeout,clearTimeout,structuredClone}),
    {filename:'providerAccountFoundation.js'});
  return window.PogoServices.providerAccountFoundation;
}
function harness({responses=[],lifecycle={uid:'uid-new',lifecycleId:'auth-1'},appCheck={ok:true,instance:{}}}={}){
  const service=load(),calls=[],tokens=[],store=storage();let currentLifecycle={...lifecycle};
  const auth={currentUser:{uid:'uid-new',getIdToken:async force=>{tokens.push(force);return'id-token';}}};
  const cryptoImpl={subtle:webcrypto.subtle,randomUUID:()=>UUID};
  const sdk={
    getFunctions:(app,region)=>{assert.equal(region,'us-central1');return{app};},
    httpsCallable:(_functions,name,options)=>async body=>{
      calls.push({name,options,body});const next=responses.shift();if(next instanceof Error)throw next;
      return{data:typeof next==='function'?await next(body):next};
    }
  };
  const client=service.createProviderAccountClient({firebaseApp:{options:{appId:'app'}},auth,
    firebaseAppCheckReady:async()=>appCheck,getLifecycleSnapshot:()=>currentLifecycle,
    importFunctionsSdk:async()=>sdk,storage:store,cryptoImpl,timeoutMs:2000});
  return{service,client,calls,tokens,store,auth,setLifecycle:value=>{currentLifecycle=value;}};
}

test('browser and authority handle normalization stay byte-for-byte compatible',()=>{
  const service=load();
  for(const value of [' TrainerNew ','Ｆｏｏ 2',"O'Brien",'Poké Trade']){
    assert.deepEqual({...service.normalizeHandle(value)},{...normalizeAuthorityHandle(value)});
  }
  for(const value of ['admin','bad/name','LatinА','\u200bhidden'])assert.throws(()=>service.normalizeHandle(value),/handle-invalid/);
});

test('read resolves a provider-only foundation without legacy identity evidence',async()=>{
  const h=harness({responses:[{code:'SUCCESS',foundation:readFoundation()}]});
  const result=await h.client.read();
  assert.equal(result.status,'ready');assert.equal(result.foundation.identityKind,'provider_only');
  assert.equal(result.foundation.legacyAccessConfigured,false);
  assert.deepEqual(h.calls.map(value=>value.name),['readE1AccountFoundation']);
  assert.equal(h.calls[0].options,undefined);assert.equal(JSON.stringify(h.calls[0].body),'{"schemaVersion":1}');
});

test('read retains explicit legacy compatibility for migrated Username and PIN accounts',async()=>{
  const h=harness({responses:[{code:'SUCCESS',foundation:readFoundation({legacyUsername:'LegacyTrainer'})}]});
  const result=await h.client.read();
  assert.equal(result.foundation.identityKind,'legacy_migrated');assert.equal(result.foundation.legacyAccessConfigured,true);
});

test('new account dispatch uses limited-use App Check and certifies with one exact readback',async()=>{
  const h=harness({responses:[{code:'SUCCESS',foundation:createFoundation()},{code:'SUCCESS',foundation:readFoundation()}]});
  const result=await h.client.create({requestedHandle:' TrainerNew '});
  assert.equal(result.status,'account-ready');assert.equal(result.foundation.canonicalTrainerName,'TrainerNew');
  assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation','readE1AccountFoundation']);
  assert.equal(h.calls[0].options.limitedUseAppCheckTokens,true);assert.equal(h.calls[1].options,undefined);
  assert.equal(h.calls[0].body.requestId,UUID);assert.equal(h.calls[0].body.lifecycleId,'auth-1');
  assert.equal(Object.hasOwn(h.calls[0].body,'uid'),false);assert.equal(Object.hasOwn(h.calls[0].body,'provider'),false);
  assert.match(h.calls[0].body.idempotencyFingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(h.tokens,[true,false]);
});

test('a lost create response performs one readback and never resends the transaction',async()=>{
  const network=Object.assign(new Error('lost'),{code:'functions/unavailable'});
  const h=harness({responses:[network,{code:'SUCCESS',foundation:readFoundation()}]});
  const result=await h.client.create({requestedHandle:'TrainerNew'});
  assert.equal(result.code,'RECONCILED');
  assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation','readE1AccountFoundation']);
});

test('an unconfirmed result stays ambiguous across reopen and is never blindly resent',async()=>{
  const network=Object.assign(new Error('lost'),{code:'functions/unavailable'});
  const h=harness({responses:[network,{code:'FOUNDATION_NOT_INITIALIZED'},{code:'FOUNDATION_NOT_INITIALIZED'}]});
  await assert.rejects(h.client.create({requestedHandle:'TrainerNew'}),error=>error.code==='provider-account/ambiguous-result');
  assert.equal(h.client.pending().phase,'ambiguous');
  await assert.rejects(h.client.create({requestedHandle:'TrainerNew'}),error=>error.code==='provider-account/ambiguous-result');
  assert.deepEqual(h.calls.map(value=>value.name),[
    'createE1ProviderAccountFoundation','readE1AccountFoundation','readE1AccountFoundation'
  ]);
});

test('definite handle conflict is retryable with a different operation and performs no reconciliation read',async()=>{
  const conflict=Object.assign(new Error('unavailable'),{code:'functions/already-exists',details:{code:'HANDLE_CONFLICT'}});
  const h=harness({responses:[conflict]});
  await assert.rejects(h.client.create({requestedHandle:'TrainerNew'}),error=>
    error.code==='provider-account/handle-conflict'&&error.state==='handle-unavailable');
  assert.equal(h.client.pending(),null);assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation']);
});

test('Auth lifecycle change fails closed before account creation can be accepted',async()=>{
  const h=harness({responses:[()=>{h.setLifecycle({uid:'uid-new',lifecycleId:'auth-2'});return{code:'SUCCESS',foundation:createFoundation()};}]});
  await assert.rejects(h.client.create({requestedHandle:'TrainerNew'}),error=>error.code==='provider-account/auth-lifecycle-changed');
  assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation']);
});

test('malformed or UID-bearing authority responses fail closed',()=>{
  const service=load();
  assert.throws(()=>service.validateCreateResponse({code:'SUCCESS',foundation:{...createFoundation(),uid:'uid-new'}}),/response-invalid/);
  assert.throws(()=>service.validateReadResponse({code:'SUCCESS',foundation:{...readFoundation(),email:'private@example.test'}}),/response-invalid/);
});

test('App Check failure prevents every callable invocation',async()=>{
  const h=harness({appCheck:{ok:false,code:'app-check/unavailable'}});
  await assert.rejects(h.client.read(),error=>error.code==='provider-account/app-check-unavailable');
  assert.equal(h.calls.length,0);
});

test('provider client contains no direct Firestore or RTDB identity writer',()=>{
  assert.doesNotMatch(source,/getFirestore|setDoc|addDoc|authIndex|loginDirectory|users\//u);
  assert.match(source,/createE1ProviderAccountFoundation/u);
  assert.match(source,/limitedUseAppCheckTokens:true/u);
});
