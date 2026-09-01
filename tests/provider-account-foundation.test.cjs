const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {Readable}=require('node:stream');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {
  GATES,createHandler:createAuthorityHandler,loadConfiguration:loadAuthorityConfiguration
}=require('../functions/e1-authority-service/server');
const {STAGING:AUTHORITY_TARGET}=require('../functions/e1-authority-service/e1TargetContracts');
const {normalizeHandle:normalizeAuthorityHandle}=require('../functions/e1-authority-service/handleNormalization');
const {createGatewayOperation,loadGatewayConfiguration}=require('../functions/e1-gateway/gatewayCore');

const source=readFileSync(path.join(__dirname,'..','js/services/providerAccountFoundation.js'),'utf8');
const onboardingSource=readFileSync(path.join(__dirname,'..','js/domain/providerOnboardingModel.js'),'utf8');
const applicationSource=readFileSync(path.join(__dirname,'..','js/app/application.js'),'utf8');
const englishSource=readFileSync(path.join(__dirname,'..','js/i18n/locales/en.js'),'utf8');
const UUID='123e4567-e89b-42d3-a456-426614174000';
const NOW=Date.parse('2026-08-31T16:00:00.000Z');

function storage(){
  const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),values};
}
function readFoundation(overrides={}){
  return{schemaVersion:1,canonicalTrainerName:'TrainerNew',normalizedTrainerName:'trainernew',
    handleKey:'v1_747261696e65726e6577',legacyUsername:null,identityKind:'provider_only',
    legacyAccessConfigured:false,status:'active',revision:1,...overrides};
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
function loadOnboarding(){
  const window={crypto:webcrypto};window.window=window;
  vm.runInContext(onboardingSource,vm.createContext({window,console,Uint8Array,unescape,encodeURIComponent}),
    {filename:'providerOnboardingModel.js'});
  return window.PogoDomain.providerOnboardingModel;
}
function harness({responses=[],lifecycle={uid:'uid-new',lifecycleId:'auth-1'},appCheck={ok:true,instance:{}},callable}={}){
  const service=load(),calls=[],tokens=[],store=storage();let currentLifecycle={...lifecycle};
  const auth={currentUser:{uid:'uid-new',getIdToken:async force=>{tokens.push(force);return'id-token';}}};
  const cryptoImpl={subtle:webcrypto.subtle,randomUUID:()=>UUID};
  const sdk={
    getFunctions:(app,region)=>{assert.equal(region,'us-central1');return{app};},
    httpsCallable:(_functions,name,options)=>async body=>{
      calls.push({name,options,body});const next=callable?await callable({name,options,body}):responses.shift();if(next instanceof Error)throw next;
      return{data:typeof next==='function'?await next(body):next};
    }
  };
  const client=service.createProviderAccountClient({firebaseApp:{options:{appId:'app'}},auth,
    firebaseAppCheckReady:async()=>appCheck,getLifecycleSnapshot:()=>currentLifecycle,
    importFunctionsSdk:async()=>sdk,storage:store,cryptoImpl,timeoutMs:2000});
  return{service,client,calls,tokens,store,auth,setLifecycle:value=>{currentLifecycle=value;}};
}

function authorityEnvironment(overrides={}){
  return{
    APP_ENVIRONMENT:AUTHORITY_TARGET.environment,FIREBASE_PROJECT_ID:AUTHORITY_TARGET.projectId,
    EXPECTED_PROJECT_NUMBER:AUTHORITY_TARGET.projectNumber,FIRESTORE_DATABASE_ID:AUTHORITY_TARGET.databaseId,
    SERVICE_REGION:AUTHORITY_TARGET.region,AUTHORITY_SERVICE_NAME:AUTHORITY_TARGET.serviceName,
    EXPECTED_RUNTIME_SERVICE_ACCOUNT:AUTHORITY_TARGET.runtimeServiceAccount,
    RTDB_DATABASE_URL:'https://trainer-hub-staging-37ib4wct-e1.firebaseio.com',
    FIREBASE_WEB_API_KEY:'synthetic-firebase-web-api-key-for-tests',EXPECTED_OPERATOR_EMAIL_HASH:'a'.repeat(64),
    EXPECTED_OPERATOR_SUBJECT_HASH:'b'.repeat(64),
    PROVIDER_SUBJECT_HMAC_KEY:'synthetic-provider-subject-key-material-0001',PROVIDER_SUBJECT_HMAC_KEY_VERSION:'1',
    ...Object.fromEntries(GATES.map(gate=>[gate,'false'])),...overrides
  };
}
function gatewayEnvironment(overrides={}){
  return{
    APP_ENVIRONMENT:'production',FIREBASE_PROJECT_ID:'trade-list-a4297',SERVICE_REGION:'us-central1',
    E1_AUTHORITY_URL:'https://e1-identity-authority-wrywkbfzya-uc.a.run.app/',
    E1_AUTHORITY_AUDIENCE:'https://e1-identity-authority-wrywkbfzya-uc.a.run.app',
    E1_GATEWAY_SERVICE_ACCOUNT:'e1-authority-gateway@trade-list-a4297.iam.gserviceaccount.com',
    GATEWAY_INVOCATION_ENABLED:'true',APP_CHECK_ENFORCEMENT_MODE:'monitor',APP_CHECK_DEBUG_TOKENS_ALLOWED:'false',
    E1_RATE_LIMIT_POLICY:'firestore-rolling-v1',READ_PROOF_MODE:'false',...overrides
  };
}
function invokeAuthority(handler,boundary){
  return new Promise((resolve,reject)=>{
    const raw=JSON.stringify(boundary.body),request=Readable.from([raw]);
    request.method='POST';request.url='/v1/create-provider-account-foundation';
    request.headers={'content-length':String(Buffer.byteLength(raw)),'x-firebase-id-token':boundary.firebaseIdToken};
    const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(payload){
      try{resolve({status:this.status,headers:this.headers,body:JSON.parse(payload)});}catch(error){reject(error);}
    }};
    Promise.resolve(handler(request,response)).catch(reject);
  });
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
  const h=harness({responses:[{code:'SUCCESS',foundation:readFoundation({legacyUsername:'LegacyTrainer',
    identityKind:'legacy_migrated',legacyAccessConfigured:true})}]});
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
  assert.equal(h.calls[0].body.providerAccountProtocolVersion,1);
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

test('namespace precondition is definite, clears pending state, and performs zero reconciliation or retry calls',async()=>{
  const rejected=Object.assign(new Error('failed precondition'),{
    code:'functions/failed-precondition',details:{code:'NAMESPACE_NOT_CERTIFIED'}
  });
  const h=harness({responses:[rejected]});
  await assert.rejects(h.client.create({requestedHandle:'TrainerNew'}),error=>
    error.code==='provider-account/namespace-not-certified'&&error.state==='blocked');
  assert.equal(h.client.pending(),null);
  assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation']);
});

test('uncertified namespace stays deterministic through authority gateway browser client and onboarding state',async()=>{
  const counts={authorityTransactions:0,authorityReadbacks:0,gatewayAuthorityCalls:0,clientReads:0};
  const configuration=loadAuthorityConfiguration(authorityEnvironment({CREATE_PROVIDER_ACCOUNT_ENABLED:'true'}));
  const authority=createAuthorityHandler(configuration,{
    now:()=>NOW,
    async verifyFirebaseIdToken(){return{uid:'uid-new',authTime:NOW-1000,signInProvider:'google.com',
      identities:{'google.com':['synthetic-subject']}};},
    async verifyRecentGoogleProviderAuthentication(){return{providerKey:'google',providerId:'google.com',
      providerSubjectKey:`v1_google_${'c'.repeat(64)}`,providerSubjectKeyVersion:1,authTime:NOW-1000};},
    async operationRequestExists(){return false;},async consumeRateLimit(){return{allowed:true,consumed:true};},
    async createProviderAccountFoundation(){counts.authorityTransactions+=1;
      throw Object.assign(new Error('namespace unavailable'),{code:'e1/legacy-namespace-not-certified'});},
    async readProviderAccountFoundation(){counts.authorityReadbacks+=1;return null;},structuredLog(){}
  });
  const gateway=createGatewayOperation('createProviderAccountFoundation',loadGatewayConfiguration(gatewayEnvironment()),{
    invokeAuthority:async(_operation,boundary)=>{
      counts.gatewayAuthorityCalls+=1;const result=await invokeAuthority(authority,boundary);
      return{status:result.status,payload:result.body};
    }
  });
  const h=harness({callable:async({name,body})=>{
    if(name==='readE1AccountFoundation'){counts.clientReads+=1;throw new Error('unexpected reconciliation');}
    try{return await gateway({auth:{uid:'uid-new'},app:{appId:'production-app-id',alreadyConsumed:false},data:body,
      rawRequest:{headers:{authorization:'Bearer id-token'}}});}
    catch(error){throw Object.assign(new Error('Account creation is not ready'),{
      code:'functions/failed-precondition',details:{code:error.code}
    });}
  }});
  const onboarding=loadOnboarding(),model=onboarding.createProviderOnboardingModel({
    authoritySnapshot:()=>({uid:'uid-new',lifecycleId:'auth-1'}),storage:h.store,crypto:webcrypto,
    checkHandle:async()=>({available:true}),createAccount:({handle})=>h.client.create({requestedHandle:handle})
  });
  await model.begin({providerKey:'google'});model.resolveAccount({status:'unlinked'});model.startHandleChoice();
  await model.chooseHandle('TrainerNew');model.confirmProfile({friendCode:'9122 2716 6531'});
  await assert.rejects(model.create(),error=>error.code==='provider-account/namespace-not-certified'&&error.state==='blocked');
  assert.deepEqual({...model.snapshot()},{
    status:'blocked-conflict',providerKey:'google',handle:'TrainerNew',code:'provider-account/namespace-not-certified'
  });
  assert.equal(counts.gatewayAuthorityCalls,1);assert.equal(counts.authorityTransactions,1);
  assert.equal(counts.authorityTransactions-1,0,'creation retries');assert.equal(counts.authorityReadbacks,0);
  assert.equal(counts.clientReads,0);assert.equal(h.client.pending(),null);
  assert.deepEqual(h.calls.map(value=>value.name),['createE1ProviderAccountFoundation']);
  assert.match(applicationSource,/'provider-account\/namespace-not-certified':'security\.googleCreationNotReady'/u);
  assert.match(englishSource,/'security\.googleCreationNotReady':'New provider account creation is not enabled until the legacy handle namespace is certified\.'/u);
});

test('browser rejects account-only provider inference and malformed explicit identity flags',()=>{
  const service=load();
  for(const foundation of [
    {...readFoundation(),identityKind:undefined},
    {...readFoundation(),identityKind:'provider_only',legacyAccessConfigured:true},
    {...readFoundation(),identityKind:'legacy_migrated',legacyAccessConfigured:false,legacyUsername:null}
  ])assert.throws(()=>service.validateReadResponse({code:'SUCCESS',foundation}),/response-invalid/);
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
