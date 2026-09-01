const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));

function share(username='ProviderTrainer'){
  return{version:1,username,profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:0},
    lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},
    publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:100};
}

function load(enabled=false){
  const window={__POGO_PROVIDER_PUBLIC_PROJECTION_DEV__:enabled};window.window=window;
  const context=vm.createContext({window,console,setTimeout,clearTimeout});
  for(const file of ['js/domain/publicSharePublication.js','js/domain/providerPublicProjection.js','js/services/providerPublicShareGateway.js']){
    vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return window.PogoServices.providerPublicShareGateway;
}

function harness({enabled=true,result={code:'SUCCESS',share:share()}}={}){
  const service=load(enabled),calls=[];
  const sdk={
    getFunctions:(app,region)=>{calls.push({kind:'functions',app,region});return{app,region};},
    httpsCallable:(_functions,name,options)=>async body=>{calls.push({kind:'callable',name,options,body});return{data:result};}
  };
  const client=service.createProviderPublicShareClient({firebaseApp:{name:'public'},enabled,
    firebaseAppCheckReady:async()=>({ok:true,instance:{kind:'app-check'}}),importFunctionsSdk:async()=>sdk,timeoutMs:2000});
  return{service,client,calls};
}

test('provider public gateway is dormant by default and performs no SDK or App Check work',async()=>{
  const service=load(false);let touched=false;
  const client=service.createProviderPublicShareClient({firebaseApp:{},firebaseAppCheckReady:async()=>{touched=true;},
    importFunctionsSdk:async()=>{touched=true;},timeoutMs:2000});
  assert.deepEqual(plain(await client.read('ProviderTrainer')),{ok:false,status:'disabled'});
  assert.equal(touched,false);assert.equal(service.DEFAULT_ENABLED,false);
});

test('anonymous exact-handle lookup uses a limited-use App Check callable and sends no UID or Auth evidence',async()=>{
  const h=harness();const result=await h.client.read('ProviderTrainer');
  assert.equal(result.ok,true);assert.equal(result.source,'provider');
  assert.deepEqual(plain(h.calls[1]),{kind:'callable',name:'readE1ProviderPublicShare',
    options:{limitedUseAppCheckTokens:true},body:{schemaVersion:1,trainerHandle:'ProviderTrainer'}});
  assert.doesNotMatch(JSON.stringify(h.calls),/uid|idToken|authorization|email|credential/i);
});

test('normalization-equivalent handle casing resolves to the stored canonical trainer name',async()=>{
  const h=harness();const result=await h.client.read('providertrainer');
  assert.equal(result.ok,true);assert.equal(result.snapshot.username,'ProviderTrainer');
});

test('mismatched identities and private response fields fail closed',async()=>{
  const mismatch=harness({result:{code:'SUCCESS',share:share('OtherTrainer')}});
  await assert.rejects(mismatch.client.read('ProviderTrainer'),error=>error.code==='provider-public/response-invalid');
  const leaked=harness({result:{code:'SUCCESS',share:{...share(),ownerUid:'private'}}});
  await assert.rejects(leaked.client.read('ProviderTrainer'),error=>error.code==='provider-public/response-invalid');
});

test('not-found and temporary failures remain bounded fallback outcomes',async()=>{
  assert.deepEqual(plain(await harness({result:{code:'SHARE_NOT_FOUND'}}).client.read('MissingTrainer')),{ok:false,status:'not_found'});
  const service=load(true),client=service.createProviderPublicShareClient({firebaseApp:{},enabled:true,timeoutMs:2000,
    firebaseAppCheckReady:async()=>({ok:true,instance:{}}),importFunctionsSdk:async()=>({getFunctions:()=>({}),
      httpsCallable:()=>async()=>{throw Object.assign(new Error('offline'),{code:'functions/unavailable'});}})});
  assert.deepEqual(plain(await client.read('ProviderTrainer')),{ok:false,status:'unavailable'});
});

test('invalid trainer input is rejected before App Check or network work',async()=>{
  const h=harness();assert.deepEqual(plain(await h.client.read('bad/name')),{ok:false,status:'invalid'});assert.equal(h.calls.length,0);
});
