const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const acorn=require('acorn');
const root=process.env.INCIDENT_SOURCE_ROOT||path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
const declarations=acorn.parse(app,{ecmaVersion:'latest'}).body;
function appFunction(context,name){const node=declarations.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);vm.runInContext(app.slice(node.start,node.end),context);}
function load(){
  const window={crypto:webcrypto,navigator:{onLine:true},btoa:v=>Buffer.from(v,'binary').toString('base64')};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,structuredClone,queueMicrotask,setTimeout,clearTimeout,console});
  for(const file of ['domain/productLimits','domain/accountSyncModel','domain/accountSyncMerge','domain/accountSyncMigration','domain/accountSyncProduct','data/accountSyncController','data/accountSyncRuntime','data/trainerHistoryStore','testing/accountSyncHarness'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),context);
  return{window,context};
}
function identity(window,name){const identity={surface:'my-list',lane:'wishlist',catalogId:`pokemon:${name}`};return{entityType:'tradeEntry',entityId:window.PogoDomain.accountSyncModel.tradeEntryId(identity),identity};}
function memory(){const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}

test('ordinary legacy migration retains unresolved Favorite tag links for another authorized device',async()=>{
  const {window}=load();
  const plan=await window.PogoDomain.accountSyncMigration.buildMigrationPlan({ownerUid:'uid-owner',username:'Owner',deviceInstallId:'returning-device',legacyRemoteLists:{wishlist:{Pikachu:'H'}},favorites:[{displayName:'Other',tagIds:['tag_legacy']}],tags:{tag_legacy:{label:'Nearby'}}},{parseListValue:()=>({p:'H'}),catalogIdentity:()=>({catalogId:'pokemon:pikachu'}),resolveFavoriteUid:async()=>null});
  assert.equal(plan.ok,true);assert.equal(plan.favoriteSeeds.length,0);
  const candidate=plan.recoveryCandidates.find(c=>c.reason==='favorite-uid-unresolved');
  assert.equal(candidate.values.displayName,'Other');
  assert.equal(candidate.values.tagIds[plan.tagSeeds[0].entityId],true);
});

test('review-only baseline permits canonical projection but blocked, conflicting or unhealthy evidence does not',()=>{
  const {context,window}=load();
  Object.assign(context,{auth:{currentUser:{uid:'uid-owner'}},accountSyncEligibleUid:'uid-owner',accountSyncRuntimeData:window.PogoData.accountSyncRuntime,
    managedAccountSyncRuntime:{ownerUid:'uid-owner',projectionReady:true,profileReady:true},
    accountSyncUiState:{state:'review-required',active:true,listenerHealthy:true,controllerHealthy:true,recoveryCandidateCount:1,pendingCount:0,blockedCount:0,conflictCount:0}});
  appFunction(context,'accountSyncProjectionReady');
  assert.equal(context.accountSyncProjectionReady(),true);
  const base=context.accountSyncUiState;
  for(const patch of [{blockedCount:1},{conflictCount:1},{lastError:'account-sync/owner-mismatch'},{listenerHealthy:false},{controllerHealthy:false},{state:'sync-error'},{state:'unexpected'}]){
    context.accountSyncUiState={...base,...patch};assert.equal(context.accountSyncProjectionReady(),false,JSON.stringify(patch));
  }
});

test('unrelated Favorite review does not block a canonical want patch/delete; overlapping recovery fails closed',async()=>{
  const {window}=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),device=await h.createDevice('returning').start();
  try{
    const want=identity(window,'pikachu');assert.equal((await device.controller.addEntity({...want,values:{priority:'H'}})).ok,true);await h.settle();
    await device.journal.putRecoveryCandidate({ownerUid:'uid-owner',schemaVersion:1,candidateId:'candidate_'+'a'.repeat(64),reason:'favorite-uid-unresolved',entityType:'favorite',entityId:'unresolved:other',identity:{targetUid:''},values:{displayName:'Other'},source:'legacy-favorite',createdAt:1,resolved:false});
    assert.equal((await device.controller.snapshot()).state,'review-required');
    assert.equal((await device.controller.patchEntity({...want,patch:{priority:'M'}})).ok,true);await h.settle();
    assert.equal(h.server.snapshot().tradeEntries[want.entityId].values.priority,'M');
    assert.equal((await device.controller.deleteEntity(want)).ok,true);await h.settle();
    assert.equal(h.server.snapshot().tradeEntries[want.entityId].deleted,true);
    const favorite=await device.controller.addEntity({entityType:'favorite',entityId:'uid-other',identity:{targetUid:'uid-other'},values:{displayName:'Other'}});
    assert.equal(favorite.ok,false);assert.equal(favorite.error.code,'account-sync/entity-review-required');
    await device.journal.putRecoveryCandidate({ownerUid:'uid-owner',schemaVersion:1,candidateId:'candidate_'+'b'.repeat(64),reason:'stale-device-cache',...want,values:{priority:'L'},source:'legacy-local',createdAt:2,resolved:false});
    assert.equal((await device.controller.addEntity({...want,values:{priority:'H'}})).ok,false);
    assert.equal((await device.controller.addEntity({...identity(window,'eevee'),values:{priority:'M'}})).ok,true);
  }finally{await device.controller.deactivate();}
});

test('canonical adoption keeps an immutable raw trainer-history backup without resurrecting Favorites',()=>{
  const {window}=load(),storage=memory(),store=window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage,identity:{uid:'uid-owner',username:'Owner'}});
  const original=JSON.stringify({version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-owner',username:'Owner'},favorites:[{displayName:'Other',tagIds:['tag_old'],createdAt:1}],tags:{tag_old:{label:'Nearby'}},recent:[],snapshots:{other:{seenAt:1,snapshot:{wishlist:{Pikachu:'H'}}}},unknownHistoricalField:'retain exactly'});
  storage.setItem(store.key,original);
  store.replaceSyncedOrganization({favorites:[],tags:{}});
  assert.equal(storage.getItem(store.retainedKey),original);
  assert.equal(store.read().favorites.length,0);
  store.replaceSyncedOrganization({favorites:[],tags:{}});
  assert.equal(storage.getItem(store.retainedKey),original);
});

test('existing owner canonical Favorite identity survives own-account reads with no private target records',async()=>{
  const {window,context}=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge;
  const operation=await model.createOperation({ownerUid:'uid-owner',entityType:'favorite',entityId:'uid-other',identity:{targetUid:'uid-other'},kind:'add',patch:{displayName:'Other'},baseGeneration:0,generation:1,baseFieldRevisions:{displayName:0},clientAt:1},{crypto:webcrypto});
  assert.equal(operation.ok,true);const canonical=merge.mergeOperation(null,operation.value,{acceptedAt:1}).value;assert.ok(canonical);
  Object.assign(context,{accountSyncModel:model,accountSyncMerge:merge,accountSyncProduct:window.PogoDomain.accountSyncProduct,auth:{currentUser:{uid:'uid-owner'}},allData:{users:{Owner:{authUid:'uid-owner'}},authIndex:{'uid-owner':{username:'Owner'}}},managedAccountSyncRuntime:null,resolveFavoriteIdentityForSession:async()=>null});
  appFunction(context,'accountSyncExactFavoriteUid');
  assert.equal(await context.accountSyncExactFavoriteUid('Other',{targetUid:'uid-other'},{favorites:{'uid-other':canonical}}),'uid-other');
  assert.equal(await context.accountSyncExactFavoriteUid('Other',{targetUid:'uid-forged'},{}),null);
});


test('interrupted name-only migration resumes with its original record and fingerprint',async()=>{
  const {window}=load();
  const input={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'returning-device',favorites:[{displayName:'Other',tagIds:['tag_legacy']}],tags:{tag_legacy:{label:'Nearby'}}};
  const dependencies={resolveFavoriteUid:async()=>null};
  const plan=await window.PogoDomain.accountSyncMigration.buildMigrationPlan(input,dependencies);
  // Golden record generated from immutable production 07ee65bb (.103).
  const before=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/saving-favorites/interrupted-103.json'),'utf8'));
  const original=window.PogoDomain.accountSyncMigration;
  const earlier=before.recoveryCandidates[0];
  const resumed=await original.buildMigrationPlan({...input,remoteRecoveryCandidates:{[earlier.candidateId]:earlier}},dependencies);
  assert.equal(resumed.deviceMigrationId,before.deviceMigrationId);
  assert.equal(resumed.sourceFingerprint,before.sourceFingerprint);
  assert.deepEqual(JSON.parse(JSON.stringify(resumed.recoveryCandidates)),JSON.parse(JSON.stringify(before.recoveryCandidates)));
  assert.ok(plan.recoveryCandidates[0].values.tagIds);
});
