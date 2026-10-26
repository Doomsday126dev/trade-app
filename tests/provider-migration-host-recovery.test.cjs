'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
function load(files){const window={crypto:webcrypto,btoa},context=vm.createContext({window,TextEncoder,URL,Uint8Array,JSON,Object,Number,Error,TypeError,Map,WeakMap,Set,Date});for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);return window;}
test('host canary wraps existing SDK mutations, blocks wrong UID and refuses account creation',async()=>{
  const w=load(['js/dev/providerAuthCommitGate.js','js/dev/providerHostAuthGate.js']),auth={currentUser:null},hooks=new Set();let tail=Promise.resolve();
  const change=async user=>{for(const hook of hooks)await hook(user);auth.currentUser=user;return{user};};
  const sdk={beforeAuthStateChanged:(a,hook)=>{hooks.add(hook);return()=>hooks.delete(hook);},signInWithCustomToken:async(a,uid)=>change({uid}),signInWithEmailAndPassword:async(a,uid)=>change({uid}),signInWithPopup:async(a,p)=>change({uid:p.uid}),signOut:async()=>{await change(null);},linkWithPopup:async user=>({user}),unlink:async user=>user,updatePassword:async()=>{}};
  assert.equal(w.PogoDev.providerHostAuthGate.install({sdk}).sdk,sdk);
  let checkpoint={revision:0,uid:null,status:'settled'};const coordination={read:async()=>({...checkpoint}),write:async value=>{checkpoint={...value};}};
  const host=w.PogoDev.providerHostAuthGate.install({coordination,enabled:true,auth,sdk,expectedSignInUid:'synthetic-owner',locks:{request:(name,opts,work)=>{const next=tail.then(work);tail=next.catch(()=>{});return next;}}});
  await assert.rejects(host.sdk.signInWithEmailAndPassword(auth,'wrong-owner'),{code:'provider-auth/unexpected-account'});assert.equal(auth.currentUser,null);
  await host.sdk.signInWithEmailAndPassword(auth,'synthetic-owner');assert.equal(auth.currentUser.uid,'synthetic-owner');
  assert.throws(()=>host.sdk.unlink({uid:'synthetic-owner',providerData:[{providerId:'password'}]},'google.com'),{code:'provider-auth/session-changed'});
  await host.sdk.linkWithPopup(auth.currentUser,{});await host.sdk.signOut(auth);assert.equal(auth.currentUser,null);
  assert.throws(()=>host.sdk.createUserWithEmailAndPassword(auth,'x','y'),{code:'provider-auth/account-creation-disabled'});
});
async function recovery(){
 const w=load(['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/dev/accountRecoveryBundle.js','js/dev/accountRecoveryDryRun.js','js/dev/accountRecoverySyntheticApply.js']),model=w.PogoDomain.accountSyncModel,merge=w.PogoDomain.accountSyncMerge,bundle=w.PogoDev.accountRecoveryBundle.createAccountRecoveryBundle();
 const uid='synthetic-owner',identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity);
 const operation=(await model.createOperation({ownerUid:uid,entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_synthetic_original_1234'})).value;
 const entity=merge.mergeOperation(null,operation,{acceptedAt:11}).value;
 const sections=Object.fromEntries(w.PogoDev.accountRecoveryBundle.SECTIONS.map(key=>[key,{complete:true,records:[]} ]));
 sections.canonicalEntities.records=[{id:`tradeEntry:${entityId}`,value:entity}];sections.permissions.records=[{id:'references',value:{isAdmin:true}}];
 const source=await bundle.create({source:{ownerUid:uid,trainerHandle:'SyntheticTrainer',capturedAt:1000,revision:'a'.repeat(64)},sections});
 const empty=JSON.parse(JSON.stringify(sections));empty.canonicalEntities.records=[];empty.permissions.records=[];
 const target=await bundle.create({source:{...source.source,revision:'b'.repeat(64)},sections:empty});
 const dry=w.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel:bundle}),plan=await dry.prepare({sourceBundle:source,currentBundle:target,targetUid:uid});
 let session={uid,lifecycleId:'synthetic-life',accountReady:true};
 const store=w.PogoDev.accountRecoverySyntheticApply.create({initialBundle:target,bundleModel:bundle,dryRun:dry,getSession:()=>session,clock:()=>1001});
 return{store,source,plan,target,switchAccount:()=>{session={...session,uid:'another-owner'};}};
}
test('explicit reviewed synthetic apply is additive, atomic, readback verified and concurrent replay is idempotent',async()=>{
 const h=await recovery();await assert.rejects(h.store.review({sourceBundle:h.source,plan:h.plan}),{code:'recovery/explicit-review-required'});
 await assert.rejects(h.store.apply({}),{code:'recovery/review-required'});
 const ticket=await h.store.review({sourceBundle:h.source,plan:h.plan,accepted:true});
 const results=await Promise.all([h.store.apply(ticket),h.store.apply(ticket)]);assert.equal(results[0].status,'verified');assert.equal(results[1].replay,true);
 assert.equal(h.store.read().sections.canonicalEntities.records.length,1);assert.equal(h.store.read().sections.permissions.records.length,0);
 for(const key of Object.keys(h.target.sections).filter(key=>key!=='canonicalEntities'))assert.equal(JSON.stringify(h.store.read().sections[key]),JSON.stringify(h.target.sections[key]));
});
test('reviewed recovery refuses edited plan, forged ticket and account switch before writes',async()=>{
 const h=await recovery(),edited=JSON.parse(JSON.stringify(h.plan));edited.operations[0].patch.priority='L';
 await assert.rejects(h.store.review({sourceBundle:h.source,plan:edited,accepted:true}),{code:'recovery/plan-changed'});
 const ticket=await h.store.review({sourceBundle:h.source,plan:h.plan,accepted:true});h.switchAccount();await assert.rejects(h.store.apply(ticket),{code:'recovery/session-changed'});
 assert.equal(h.store.read().sections.canonicalEntities.records.length,0);
});

test('application SDK binding installs the canary wrapper before exposing mutation functions',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8').split('function loadFirebaseAppCheckSdk()')[0].replace('import(`${base}/firebase-database.js`)','Promise.resolve(dbSdk)');
 for(const enabled of[false,true]){
  const raw={getAuth(){},signInWithEmailAndPassword(){},signOut(){}},wrapped={...raw,signInWithEmailAndPassword:()=> 'guarded'},calls=[];
  const window={__POGO_PROVIDER_AUTH_GATE_CANARY__:enabled,__POGO_PROVIDER_AUTH_GATE_CANARY_UID__:'synthetic-owner',PogoDev:{providerHostAuthGate:{install:options=>{calls.push(options);return{available:true,sdk:wrapped};}}}};
  const context=vm.createContext({window,Promise,Error,dbSdk:{getDatabase(){}},startPogoEarlyAuth:async()=>({appMod:{initializeApp(){}},authMod:raw,auth:{currentUser:null}})});
  await vm.runInContext(source+'\nloadFirebaseSdk()',context);
  assert.equal(calls.length,enabled?1:0);assert.equal(vm.runInContext('signInWithEmailAndPassword',context),enabled?wrapped.signInWithEmailAndPassword:raw.signInWithEmailAndPassword);
 }
});

test('completed auth with failed checkpoint remains visibly blocked and logout preserves local identity',async()=>{
 const w=load(['js/dev/providerAuthCommitGate.js','js/dev/providerHostAuthGate.js']),auth={currentUser:null},hooks=new Set(),statuses=[];
 let checkpoint={revision:0,uid:null,status:'settled'},signOuts=0;
 const coordination={read:async()=>({...checkpoint}),write:async value=>{if(value.status==='settled')throw Error('synthetic storage failure');checkpoint={...value};}};
 const sdk={beforeAuthStateChanged:(a,hook)=>{hooks.add(hook);return()=>hooks.delete(hook);},signInWithCustomToken:async()=>{const user={uid:'synthetic-owner'};for(const hook of hooks)await hook(user);auth.currentUser=user;return{user};},signOut:async()=>{signOuts++;auth.currentUser=null;}};
 const host=w.PogoDev.providerHostAuthGate.install({enabled:true,auth,sdk,coordination,expectedSignInUid:'synthetic-owner',locks:{request:async(name,options,work)=>work()},onStatus:value=>statuses.push(value)});
 const result=await host.sdk.signInWithCustomToken(auth,'synthetic-token');assert.equal(result.authCoordinationBlocked,true);assert.equal(statuses.at(-1).status,'coordination-blocked');
 await assert.rejects(host.prepareSignOut(),{code:'provider-auth/coordination-blocked'});assert.equal(auth.currentUser.uid,'synthetic-owner');assert.equal(signOuts,0);
 const source=fs.readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8'),start=source.indexOf('async function logout(){'),end=source.indexOf('// ── NAV',start),messages=[];
 const context=vm.createContext({window:{__pogoProviderHostAuthGate:host},auth,cur:'SyntheticTrainer',toast:value=>messages.push(value)});
 await vm.runInContext(source.slice(start,end)+'\nlogout()',context);assert.equal(vm.runInContext('cur',context),'SyntheticTrainer');assert.match(messages[0],/still signed in/);assert.equal(signOuts,0);
 // A fresh host must detect pending storage too, without relying on the old latch.
 const fresh=w.PogoDev.providerHostAuthGate.install({enabled:true,auth,sdk,coordination,expectedSignInUid:'synthetic-owner',locks:{request:async(name,options,work)=>work()}});
 await assert.rejects(fresh.prepareSignOut(),{code:'provider-auth/coordination-blocked'});
});
