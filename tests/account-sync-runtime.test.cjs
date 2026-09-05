const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {sanitizeProviderPublicProjection}=require('../functions/e1-authority-service/providerPublicProjection');

const root=path.join(__dirname,'..');
const files=[
  'js/domain/publicSharePublication.js','js/domain/providerPublicProjection.js',
  'js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js','js/domain/accountSyncProduct.js',
  'js/data/accountSyncController.js','js/data/accountSyncRuntime.js','js/testing/accountSyncHarness.js'
];

function load(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),navigator:{onLine:true}};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,queueMicrotask,structuredClone,console,setTimeout,clearTimeout});
  for(const file of files)vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window;
}

function source(deviceInstallId,{remote={},local={},remoteBoard={lf:[],ft:[]},localBoard={lf:[],ft:[]},queue={}}={}){
  return{
    deviceInstallId,legacyRemoteLists:{wishlist:remote},legacyLocalLists:{wishlist:local},legacyRemoteBoard:remoteBoard,legacyLocalBoard:localBoard,
    legacyQueue:queue,orders:{},favorites:[],tags:{},legacyRetainedSnapshot:{deviceInstallId,remote,local,remoteBoard,localBoard,queue},
    dependencies:{parseListValue:value=>({p:String(value||'').charAt(0)}),catalogIdentity:(_type,name)=>({catalogId:`pokemon:${String(name).toLocaleLowerCase('en-US')}`}),genderForVariant:()=>'',resolveFavoriteUid:async()=>null}
  };
}

function runtimeRepository(window,h,{orders={}}={}){
  let meta=null,profile=null;const migrations={},recoveryCandidates={},recoveryReviewAcceptances={},listeners=new Set(),events=[],calls={createMigration:0,createRecoveryCandidate:0,readRecoveryReviewAcceptance:0,createRecoveryReviewAcceptance:0,updateMeta:0,writeProfile:0,readAccount:0};
  const snapshot=()=>({...h.server.snapshot(),...(meta?{meta}:{}),...(profile?{profile}:{}),migrations:{...migrations},recoveryCandidates:{...recoveryCandidates}});
  function publish(value=snapshot()){for(const listener of listeners)listener.onData(value);}
  function failListener(error=new Error('listener failed')){for(const listener of listeners)listener.onError?.(error);}
  function publishDirect(method){
    const order=orders[method]||'callback-before';
    if(order==='callback-before')publish();
    else if(order==='microtask')queueMicrotask(publish);
    else if(order==='promise-before')setTimeout(publish,0);
    else if(order==='silent')return;
    else throw new Error(`unknown direct write order: ${order}`);
  }
  const repository={
    ...h.server,ownerUid:'uid-owner',
    listenAccount(handlers){listeners.add(handlers);const unsubscribe=h.server.listenAccount({onData:()=>handlers.onData(snapshot()),onError:handlers.onError});return()=>{listeners.delete(handlers);unsubscribe();};},
    async readAccount(){calls.readAccount++;events.push('readAccount');return snapshot();},
    async readProfile(){return profile;},
    async createMigration(record){calls.createMigration++;events.push('createMigration');if(migrations[record.deviceMigrationId])return window.PogoDomain.accountSyncModel.failure('account-sync/migration-exists','exists');migrations[record.deviceMigrationId]=record;publishDirect('createMigration');return{ok:true,status:'created',value:record};},
    async createRecoveryCandidate(record){calls.createRecoveryCandidate++;events.push('createRecoveryCandidate');if(recoveryCandidates[record.candidateId])return window.PogoDomain.accountSyncModel.failure('account-sync/recovery-candidate-exists','exists');recoveryCandidates[record.candidateId]=record;publishDirect('createRecoveryCandidate');return{ok:true,status:'created',value:record};},
    async readRecoveryReviewAcceptance(record){
      calls.readRecoveryReviewAcceptance++;events.push('readRecoveryReviewAcceptance');const value=recoveryReviewAcceptances[record.evidenceFingerprint]||null;
      if(value&&(value.ownerUid!==record.ownerUid||value.trainerUsername!==record.trainerUsername||value.candidateCount!==record.candidateCount))return window.PogoDomain.accountSyncModel.failure('account-sync/recovery-review-acceptance-conflict','conflict');
      return{ok:true,status:value?'found':'missing',value};
    },
    async createRecoveryReviewAcceptance(record){
      calls.createRecoveryReviewAcceptance++;events.push('createRecoveryReviewAcceptance');const prior=recoveryReviewAcceptances[record.evidenceFingerprint];
      if(prior&&(prior.ownerUid!==record.ownerUid||prior.trainerUsername!==record.trainerUsername||prior.candidateCount!==record.candidateCount))return window.PogoDomain.accountSyncModel.failure('account-sync/recovery-review-acceptance-conflict','conflict');
      recoveryReviewAcceptances[record.evidenceFingerprint]=prior||record;return{ok:true,status:prior?'idempotent':'created',value:recoveryReviewAcceptances[record.evidenceFingerprint]};
    },
    async updateMeta(patch){
      calls.updateMeta++;events.push('updateMeta');if(meta&&patch.initializedAt!==meta.initializedAt)return window.PogoDomain.accountSyncModel.failure('account-sync/meta-conflict','initializedAt changed');
      const timestamp=h.clock();meta={...(meta||{}),...patch,ownerUid:'uid-owner',schemaVersion:window.PogoDomain.accountSyncModel.SCHEMA_VERSION,initializedAt:meta?.initializedAt??timestamp,updatedAt:timestamp};
      publishDirect('updateMeta');return{ok:true,status:'updated',value:meta};
    },
    async writeProfile(values,{baseRevision=0}={}){
      calls.writeProfile++;events.push('writeProfile');const model=window.PogoDomain.accountSyncModel,normalized=model.normalizeProfileValues(values);
      if(!normalized.ok)return normalized;
      if(profile&&model.canonicalJson(model.profileValues(profile))===model.canonicalJson(normalized.value))return{ok:true,status:'idempotent',value:profile};
      if((profile?.revision||0)!==baseRevision)return model.failure('account-sync/profile-conflict','conflict');
      const timestamp=h.clock();profile={schemaVersion:model.SCHEMA_VERSION,ownerUid:'uid-owner',...normalized.value,revision:(profile?.revision||0)+1,createdAt:profile?.createdAt??timestamp,lastUpdated:timestamp};
      publishDirect('writeProfile');return{ok:true,status:'updated',value:profile};
    }
  };
  return{repository,get meta(){return meta;},get profile(){return profile;},set profile(value){profile=value;},migrations,recoveryCandidates,recoveryReviewAcceptances,calls,events,publish,failListener,snapshot};
}

function createRuntime(window,h,repositoryState,journalState,readMigrationSources,onCanonicalEntities=()=>{},onState=()=>{},onPublicProjection=async()=>({ok:true}),options={}){
  const journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',journalState,h.clock);
  return window.PogoData.accountSyncRuntime.createAccountSyncRuntime({
    ownerUid:'uid-owner',username:'Owner',journal,repository:repositoryState.repository,enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],
    readMigrationSources,onCanonicalEntities,onState,onPublicProjection,clock:h.clock,crypto:webcrypto,...options
  });
}

async function directWriteAttempt(method,{order='callback-before',configure}={}){
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),orders={[method]:order},repositoryState=runtimeRepository(window,h,{orders}),journalState=h.createMemoryJournalState();
  const runtime=createRuntime(window,h,repositoryState,journalState,async()=>source(`device-${method}-${order}`,{remote:{Pikachu:'H'}}));
  if(method==='createRecoveryCandidate'){
    await runtime.start();
    configure?.({window,h,repositoryState,journalState,runtime,original:repositoryState.repository[method].bind(repositoryState.repository)});
    const operation=runtime.recordRecoveryCandidate({reason:'watched-write-test',entityType:'tradeEntry',entityId:'unresolved:test',identity:{unresolved:true},values:{unresolved:true},source:'test'});
    return{window,h,repositoryState,journalState,runtime,operation};
  }
  configure?.({window,h,repositoryState,journalState,runtime,original:repositoryState.repository[method].bind(repositoryState.repository)});
  return{window,h,repositoryState,journalState,runtime,operation:runtime.start()};
}

async function directWriteScenario(method,options){
  const context=await directWriteAttempt(method,options);return{...context,result:await context.operation};
}

function installDirectWriteBehavior(method,behavior,{repositoryState,original}){
  const repository=repositoryState.repository;
  if(behavior==='response-lost')repository[method]=async value=>{await original(value);throw Object.assign(new Error('response lost'),{code:'account-sync/network-failed'});};
  else if(behavior==='read-failure'){
    const originalRead=repository.readAccount.bind(repository);let failNextRead=false;
    repository[method]=async value=>{const result=await original(value);failNextRead=true;return result;};
    repository.readAccount=async()=>{
      if(!failNextRead)return originalRead();
      failNextRead=false;repositoryState.calls.readAccount++;repositoryState.events.push('readAccount');
      throw Object.assign(new Error('canonical read unavailable'),{code:'account-sync/network-failed'});
    };
  }
  else if(behavior==='missing')repository[method]=async value=>{
    repositoryState.calls[method]++;repositoryState.events.push(method);return{ok:true,status:method==='updateMeta'?'updated':'created',value};
  };
  else if(behavior==='divergent')repository[method]=async value=>{
    if(method==='updateMeta'){
      const result=await original(value);repositoryState.meta.featureVersion=999;repositoryState.publish();return result;
    }
    repositoryState.calls[method]++;repositoryState.events.push(method);
    if(method==='createMigration')repositoryState.migrations[value.deviceMigrationId]={...value,sourceFingerprint:'f'.repeat(64)};
    else repositoryState.recoveryCandidates[value.candidateId]={...value,values:{substituted:true}};
    repositoryState.publish();return{ok:true,status:'created',value};
  };
  else if(behavior==='owner-mismatch'||behavior==='schema-mismatch')repository[method]=async value=>{
    if(method==='updateMeta'){
      const result=await original(value);repositoryState.meta[behavior==='owner-mismatch'?'ownerUid':'schemaVersion']=behavior==='owner-mismatch'?'uid-other':999;repositoryState.publish();return result;
    }
    repositoryState.calls[method]++;repositoryState.events.push(method);
    const replacement={...value,[behavior==='owner-mismatch'?'ownerUid':'schemaVersion']:behavior==='owner-mismatch'?'uid-other':999};
    if(method==='createMigration')repositoryState.migrations[value.deviceMigrationId]=replacement;
    else repositoryState.recoveryCandidates[value.candidateId]=replacement;
    repositoryState.publish();return{ok:true,status:'created',value};
  };
  else if(behavior==='unrelated-turnover')repository[method]=async value=>{repositoryState.publish();return original(value);};
  else if(behavior==='listener-failure')repository[method]=async value=>{const result=await original(value);repositoryState.failListener();return result;};
  else if(behavior==='malformed-listener')repository[method]=async value=>{const result=await original(value);repositoryState.publish({unexpected:{private:'invalid'}});return result;};
  else throw new Error(`unknown direct write behavior: ${behavior}`);
}

test('provider-only account initializes an empty UID partition without reading or writing legacy migration evidence',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  const repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),published=[];let legacyReads=0;
  const runtime=createRuntime(window,h,repositoryState,journalState,async()=>{legacyReads++;throw new Error('must not read legacy');},
    ()=>{},()=>{},async(rows,operation)=>{published.push({rows,operation});return{ok:true};},{initializationKind:'provider-only'});
  const result=await runtime.start();
  assert.equal(result.ok,true);assert.equal(result.plan.initializationKind,'provider-only');assert.equal(result.plan.resumed,false);
  assert.equal(legacyReads,0);assert.equal(repositoryState.calls.updateMeta,1);assert.equal(repositoryState.calls.createMigration,0);
  assert.equal(repositoryState.calls.createRecoveryCandidate,0);assert.equal(journalState.meta.has('migration-complete'),false);
  assert.equal(repositoryState.meta.initialized,true);assert.equal(repositoryState.calls.writeProfile,1);assert.equal(repositoryState.profile.friendCode,'');
  assert.equal(journalState.meta.has('provider-profile-pending-v1'),false);assert.equal(runtime.profileReady,true);assert.equal(runtime.projectionReady,true);
  assert.equal(published.length,1);assert.equal(published[0].rows.length,0);assert.equal(published[0].operation.kind,'provider-account-initialized');
});

test('provider-only restart resumes exact metadata without duplicate initialization or migration',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  const repositoryState=runtimeRepository(window,h),firstState=h.createMemoryJournalState(),secondState=h.createMemoryJournalState();
  const first=createRuntime(window,h,repositoryState,firstState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await first.start();await first.stop();
  const second=createRuntime(window,h,repositoryState,secondState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  const result=await second.start();
  assert.equal(result.plan.resumed,true);assert.equal(repositoryState.calls.updateMeta,1);assert.equal(repositoryState.calls.writeProfile,1);
  assert.equal(repositoryState.calls.createMigration,0);assert.equal(Object.keys(repositoryState.migrations).length,0);
});

test('provider onboarding persists the submitted friend code before publication becomes ready',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),profiles=[],publications=[];
  let releaseWrite,enteredWrite;const entered=new Promise(resolve=>{enteredWrite=resolve;}),gate=new Promise(resolve=>{releaseWrite=resolve;}),original=repositoryState.repository.writeProfile.bind(repositoryState.repository);
  repositoryState.repository.writeProfile=async(...args)=>{enteredWrite();await gate;return original(...args);};
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async rows=>{publications.push(rows);return{ok:true};},{
    initializationKind:'provider-only',initialProviderProfile:{friendCode:'000011112222'},onProviderProfile:value=>{profiles.push(value);return true;}
  });
  const starting=runtime.start();await entered;
  assert.equal(runtime.profileReady,false);assert.equal(runtime.projectionReady,false);assert.equal(publications.length,0);
  releaseWrite();const result=await starting;
  assert.equal(result.ok,true);assert.equal(repositoryState.profile.friendCode,'0000 1111 2222');assert.equal(runtime.providerProfile.friendCode,'0000 1111 2222');
  assert.equal(runtime.profileReady,true);assert.equal(runtime.projectionReady,true);assert.equal(publications.length,1);assert.equal(profiles.at(-1).pending,false);
});

test('identity committed before any profile journal can recover on a clean device with an empty canonical profile',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),cleanState=h.createMemoryJournalState(),profiles=[];
  const runtime=createRuntime(window,h,repositoryState,cleanState,undefined,()=>{},()=>{},async()=>({ok:true}),{
    initializationKind:'provider-only',onProviderProfile:value=>{profiles.push(value);return true;}
  });
  const result=await runtime.start();
  assert.equal(result.ok,true);assert.equal(repositoryState.profile.friendCode,'');assert.equal(repositoryState.profile.bio,'');
  assert.equal(cleanState.meta.has('provider-profile-pending-v1'),false);assert.equal(profiles.at(-1).pending,false);
});

test('committed provider profile with a lost network response reconciles and clears its owner journal',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await runtime.start();const original=repositoryState.repository.writeProfile.bind(repositoryState.repository);
  repositoryState.repository.writeProfile=async(...args)=>{await original(...args);throw Object.assign(new Error('response lost'),{code:'account-sync/network-failed'});};
  const result=await runtime.updateProviderProfile({bio:'Committed before response loss'});
  assert.equal(result.ok,true);assert.equal(repositoryState.profile.bio,'Committed before response loss');
  assert.equal(journalState.meta.has('provider-profile-pending-v1'),false);assert.equal(runtime.providerProfile.revision,2);
});

test('clean second device canonical profile wins over a first device stale local journal without a retry loop',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),firstState=h.createMemoryJournalState();
  const first=createRuntime(window,h,repositoryState,firstState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await first.start();const original=repositoryState.repository.writeProfile.bind(repositoryState.repository);
  repositoryState.repository.writeProfile=async()=>{throw Object.assign(new Error('first device offline'),{code:'account-sync/network-failed'});};
  const pending=await first.updateProviderProfile({bio:'First device pending'});
  assert.equal(pending.ok,false);assert.equal(firstState.meta.has('provider-profile-pending-v1'),true);await first.stop();

  repositoryState.repository.writeProfile=original;
  const secondState=h.createMemoryJournalState(),second=createRuntime(window,h,repositoryState,secondState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await second.start();const secondEdit=await second.updateProviderProfile({bio:'Second device canonical'});
  assert.equal(secondEdit.ok,true);assert.equal(repositoryState.profile.revision,2);await second.stop();

  const resolutions=[],writesBefore=repositoryState.calls.writeProfile;
  const reopened=createRuntime(window,h,repositoryState,firstState,undefined,()=>{},()=>{},async()=>({ok:true}),{
    initializationKind:'provider-only',onProviderProfile:value=>{resolutions.push(value.resolution||'');return true;}
  });
  const recovered=await reopened.start();
  assert.equal(recovered.ok,true);assert.equal(reopened.providerProfile.bio,'Second device canonical');
  assert.equal(resolutions.includes('canonical-won'),true);assert.equal(firstState.meta.has('provider-profile-pending-v1'),false);
  assert.equal(repositoryState.calls.writeProfile,writesBefore);
  assert.equal((await reopened.retryProviderProfile()).status,'unchanged');assert.equal(repositoryState.calls.writeProfile,writesBefore);
});

test('provider profile edits hydrate on a clean sign-in restart without legacy migration writes',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),firstState=h.createMemoryJournalState(),firstProfiles=[];
  const first=createRuntime(window,h,repositoryState,firstState,undefined,()=>{},()=>{},async()=>({ok:true}),{
    initializationKind:'provider-only',initialProviderProfile:{friendCode:'000011112222'},onProviderProfile:value=>{firstProfiles.push(value);return true;}
  });
  await first.start();const edited=await first.updateProviderProfile({bio:'Available evenings',discord:'trainer.126',avatarPokemon:'pokemon:150:base'});
  assert.equal(edited.ok,true);assert.equal(repositoryState.profile.revision,2);assert.equal(repositoryState.profile.bio,'Available evenings');assert.equal(firstState.meta.has('provider-profile-pending-v1'),false);
  await first.stop();

  const cleanState=h.createMemoryJournalState(),restored=[];
  const second=createRuntime(window,h,repositoryState,cleanState,undefined,()=>{},()=>{},async()=>({ok:true}),{
    initializationKind:'provider-only',onProviderProfile:value=>{restored.push(value);return true;}
  });
  const resumed=await second.start();
  assert.equal(resumed.ok,true);assert.equal(second.providerProfile.friendCode,'0000 1111 2222');assert.equal(second.providerProfile.bio,'Available evenings');assert.equal(second.providerProfile.discord,'trainer.126');
  assert.equal(restored.at(-1).avatarPokemon,'pokemon:150:base');assert.equal(repositoryState.calls.writeProfile,2);assert.equal(repositoryState.calls.createMigration,0);
});

test('provider-only restart accepts legitimate canonical entries after exact initialization',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),publications=[];
  const first=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async rows=>{publications.push(rows);return{ok:true,status:'published'};},{
    initializationKind:'provider-only',initialProviderProfile:{friendCode:'000011112222'}
  });
  await first.start();
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=window.PogoDomain.accountSyncModel.tradeEntryId(identity);
  const queued=await first.controller.addEntity({entityType:'tradeEntry',entityId,identity,values:{priority:'H'}});
  assert.equal(queued.ok,true);await first.controller.drain();assert.equal(h.server.entities.size,1);await first.stop();

  const restarted=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async rows=>{publications.push(rows);return{ok:true,status:'published'};},{initializationKind:'provider-only'});
  const result=await restarted.start();
  assert.equal(result.ok,true);assert.equal(restarted.projectionReady,true);assert.equal(restarted.controller.activeEntities('tradeEntry').length,1);
  assert.equal(repositoryState.calls.updateMeta,1);assert.ok(publications.length>=3);await restarted.stop();
});

test('a transient provider profile edit remains durable and retries once after PWA restart',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  const first=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await first.start();const original=repositoryState.repository.writeProfile.bind(repositoryState.repository);let failedCalls=0;
  repositoryState.repository.writeProfile=async()=>{failedCalls++;throw Object.assign(new Error('temporary network failure'),{code:'account-sync/network-failed'});};
  const pending=await first.updateProviderProfile({bio:'Retry after restart'});
  assert.equal(pending.ok,false);assert.equal(pending.error.code,'account-sync/profile-pending');assert.equal(failedCalls,1);assert.equal(journalState.meta.has('provider-profile-pending-v1'),true);assert.equal(repositoryState.profile.bio,'');
  await first.stop();repositoryState.repository.writeProfile=original;

  const reopened=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  const result=await reopened.start();
  assert.equal(result.ok,true);assert.equal(repositoryState.profile.bio,'Retry after restart');assert.equal(repositoryState.profile.revision,2);assert.equal(journalState.meta.has('provider-profile-pending-v1'),false);assert.equal(repositoryState.calls.writeProfile,2);
});

test('provider public projection failure remains owner-durable and retries on authenticated restart',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  let attempts=0;
  const first=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>{
    attempts++;throw Object.assign(new Error('temporary publication failure'),{code:'provider-public/write-timeout'});
  },{initializationKind:'provider-only'});
  const initial=await first.start();assert.equal(initial.ok,true);assert.equal(attempts,1);
  assert.equal(journalState.meta.has('provider-publication-pending-v1'),true);await first.stop();
  const reopened=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>{
    attempts++;return{ok:true,status:'published',shareVersion:1};
  },{initializationKind:'provider-only'});
  const resumed=await reopened.start();assert.equal(resumed.ok,true);assert.equal(attempts,2);
  assert.equal(journalState.meta.has('provider-publication-pending-v1'),false);assert.equal(reopened.publicProjectionPending,false);
});

test('provider profile edit republishes canonical rows without rolling back the private profile',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),publications=[];
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async(rows,operation)=>{
    publications.push({rows,operation});return{ok:true,status:'published'};
  },{initializationKind:'provider-only'});
  await runtime.start();const result=await runtime.updateProviderProfile({bio:'Canonical profile update'});
  assert.equal(result.ok,true);assert.equal(repositoryState.profile.bio,'Canonical profile update');
  assert.equal(publications.length,2);assert.equal(publications.at(-1).operation.kind,'provider-profile-update');
});

test('stopped provider runtime cannot clear a pending publication completed by a stale session',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>{entered();await gate;return{ok:true,status:'published'};},{initializationKind:'provider-only'});
  const starting=runtime.start();await waiting;const stopping=runtime.stop();release();
  await assert.rejects(starting,error=>error.code==='account-sync/runtime-closed');await stopping;
  assert.equal(journalState.meta.has('provider-publication-pending-v1'),true);
});

test('provider canonical add edit delete and retry publish exact monotonic anonymous projections',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),domain=window.PogoDomain.providerPublicProjection;
  let stored=null,failNext=false,writes=0;
  const publish=async rows=>{
    if(failNext){failNext=false;throw Object.assign(new Error('temporary RTDB failure'),{code:'provider-public/write-timeout'});}
    const wishlist={};
    for(const row of rows){
      if(row.surface!=='my-list'||row.lane!=='wishlist')continue;
      const raw=String(row.catalogId).split(':').at(-1),name=raw.charAt(0).toUpperCase()+raw.slice(1);
      wishlist[name]={p:row.priority||'H',...(row.shiny?{shiny:true}:{})};
    }
    const profile=repositoryState.profile,snapshot={version:1,username:'Owner',profile:{friendCode:profile.friendCode,bio:profile.bio,discord:profile.discord,avatarPokemon:profile.avatarPokemon,lastUpdated:profile.lastUpdated},lists:{wishlist,dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:profile.lastUpdated};
    if(stored&&domain.projectionContentMatches(snapshot,stored,{trainerName:'Owner'}))return{ok:true,status:'reconciled',shareVersion:stored.shareVersion};
    stored=domain.nextProjection(snapshot,stored,{trainerName:'Owner',now:h.clock()});writes++;
    return{ok:true,status:'published',shareVersion:stored.shareVersion};
  };
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},publish,{initializationKind:'provider-only'});
  await runtime.start();assert.equal(stored.shareVersion,1);assert.equal(writes,1);
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=window.PogoDomain.accountSyncModel.tradeEntryId(identity);
  assert.equal((await runtime.controller.addEntity({entityType:'tradeEntry',entityId,identity,values:{priority:'H'}})).ok,true);await runtime.controller.drain();
  assert.equal(stored.shareVersion,2);assert.equal(sanitizeProviderPublicProjection(stored,{trainerName:'Owner'}).lists.wishlist.Pikachu.p,'H');
  assert.equal((await runtime.controller.patchEntity({entityType:'tradeEntry',entityId,patch:{priority:'M'}})).ok,true);await runtime.controller.drain();
  assert.equal(stored.shareVersion,3);assert.equal(sanitizeProviderPublicProjection(stored,{trainerName:'Owner'}).lists.wishlist.Pikachu.p,'M');
  assert.equal((await runtime.controller.deleteEntity({entityType:'tradeEntry',entityId})).ok,true);await runtime.controller.drain();
  assert.equal(stored.shareVersion,4);assert.deepEqual(Object.keys(sanitizeProviderPublicProjection(stored,{trainerName:'Owner'}).lists.wishlist),[]);
  await runtime.publishCurrentProjection();assert.equal(stored.shareVersion,4);assert.equal(writes,4);
  const eevee={surface:'my-list',lane:'wishlist',catalogId:'pokemon:eevee'},eeveeId=window.PogoDomain.accountSyncModel.tradeEntryId(eevee);failNext=true;
  assert.equal((await runtime.controller.addEntity({entityType:'tradeEntry',entityId:eeveeId,identity:eevee,values:{priority:'L'}})).ok,true);await runtime.controller.drain();
  assert.equal(h.server.entities.size,2);assert.equal(stored.shareVersion,4);assert.equal(journalState.meta.has('provider-publication-pending-v1'),true);
  const retried=await runtime.retryPublicProjection();assert.equal(retried.ok,true);assert.equal(stored.shareVersion,5);assert.equal(stored.lists.wishlist.Eevee.p,'L');assert.equal(journalState.meta.has('provider-publication-pending-v1'),false);
});

test('provider-only initialization rejects partial canonical entities and never publishes them',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  const operation=await window.PogoDomain.accountSyncModel.createOperation({ownerUid:'uid-owner',entityType:'tag',entityId:'tag_partial',
    kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{label:0},patch:{label:'stale'},
    identity:{tagId:'tag_partial'},clientAt:h.clock()},{crypto:webcrypto});
  assert.equal(operation.ok,true);await h.server.applyOperation(operation.value);
  const repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();let publications=0;
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>{publications++;return{ok:true};},{initializationKind:'provider-only'});
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/provider-initialization-conflict');
  assert.equal(repositoryState.calls.updateMeta,0);assert.equal(publications,0);assert.equal(runtime.projectionReady,false);
});

test('provider-only initialization cannot reactivate a retained legacy migration marker',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  const repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  journalState.meta.set('migration-complete',{schemaVersion:1,ownerUid:'uid-owner',verified:true,legacyRetained:true});
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/provider-initialization-conflict');
  assert.equal(repositoryState.calls.updateMeta,0);assert.equal(repositoryState.calls.createMigration,0);
});

test('provider-only initialization accepts an exact committed metadata write after a lost response without resending',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  const repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState();
  const original=repositoryState.repository.updateMeta.bind(repositoryState.repository);
  repositoryState.repository.updateMeta=async value=>{await original(value);throw Object.assign(new Error('response lost'),{code:'account-sync/network-failed'});};
  const runtime=createRuntime(window,h,repositoryState,journalState,undefined,()=>{},()=>{},async()=>({ok:true}),{initializationKind:'provider-only'});
  const result=await runtime.start();
  assert.equal(result.ok,true);assert.equal(repositoryState.calls.updateMeta,1);assert.equal(runtime.projectionReady,true);
});

test('first migration awaits every seed and a stale pre-sync second device cannot overwrite canonical state',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),firstState=h.createMemoryJournalState(),projections=[];
  const first=createRuntime(window,h,repositoryState,firstState,async()=>source('device-a',{remote:{Pikachu:'H',Rayquaza:'M'}}),entities=>projections.push(entities));
  const started=await first.start();
  assert.equal(started.ok,true);assert.equal(first.projectionReady,true);assert.equal(h.server.entities.size,2);assert.equal((await firstStateSnapshot(firstState)).pendingCount,0);
  assert.equal(Object.keys(repositoryState.migrations).length,1);assert.equal(repositoryState.meta.initialized,true);assert.equal(projections.at(-1).length,2);

  const secondState=h.createMemoryJournalState(),second=createRuntime(window,h,repositoryState,secondState,async()=>source('device-b',{remote:{Pikachu:'H',Rayquaza:'M'},local:{Pikachu:'H',Rayquaza:'M',Mewtwo:'H'}}));
  const resumed=await second.start();
  assert.equal(resumed.ok,true);assert.equal(h.server.entities.size,2);assert.equal([...h.server.entities.values()].some(entity=>entity.identity.catalogId==='pokemon:mewtwo'),false);
  assert.equal(Object.keys(repositoryState.recoveryCandidates).length,1);assert.equal(Object.values(repositoryState.recoveryCandidates)[0].reason,'stale-device-cache');
  assert.equal(Object.keys(repositoryState.migrations).length,2);
});

test('simultaneous identical first-sync tabs converge through deterministic seed operations and create-only migration evidence',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),originalRead=repositoryState.repository.readAccount.bind(repositoryState.repository);
  let initialReads=0,releaseReads;const bothReading=new Promise(resolve=>{releaseReads=resolve;}),waiting=[];
  repositoryState.repository.readAccount=async()=>{
    if(initialReads<2){
      initialReads++;const snapshot=await originalRead();
      waiting.push(snapshot);if(initialReads===2)releaseReads();
      await bothReading;return snapshot;
    }
    return originalRead();
  };
  const read=async()=>source('shared-device-install',{remote:{Pikachu:'H',Rayquaza:'M'}}),stateA=h.createMemoryJournalState(),stateB=h.createMemoryJournalState();
  const runtimeA=createRuntime(window,h,repositoryState,stateA,read),runtimeB=createRuntime(window,h,repositoryState,stateB,read);
  const [resultA,resultB]=await Promise.all([runtimeA.start(),runtimeB.start()]);
  assert.equal(resultA.ok,true);assert.equal(resultB.ok,true);assert.equal(h.server.entities.size,2);assert.equal(Object.keys(repositoryState.migrations).length,1);
  const operationsA=[...stateA.operations.values()].map(record=>record.operation),operationsB=[...stateB.operations.values()].map(record=>record.operation);
  assert.deepEqual(operationsA.map(operation=>operation.operationId).sort(),operationsB.map(operation=>operation.operationId).sort());
  assert.deepEqual(operationsA.map(operation=>operation.inputHash).sort(),operationsB.map(operation=>operation.inputHash).sort());
  assert.ok(operationsA.every(operation=>operation.clientAt===0));assert.equal((await firstStateSnapshot(stateA)).pendingCount,0);assert.equal((await firstStateSnapshot(stateB)).pendingCount,0);
  assert.equal(runtimeA.projectionReady,true);assert.equal(runtimeB.projectionReady,true);
});

test('simultaneous divergent first-sync tabs fail closed instead of overwriting either legacy snapshot',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),originalRead=repositoryState.repository.readAccount.bind(repositoryState.repository);
  let initialReads=0,releaseReads;const bothReading=new Promise(resolve=>{releaseReads=resolve;});
  repositoryState.repository.readAccount=async()=>{
    if(initialReads<2){
      initialReads++;const snapshot=await originalRead();if(initialReads===2)releaseReads();
      await bothReading;return snapshot;
    }
    return originalRead();
  };
  const stateA=h.createMemoryJournalState(),stateB=h.createMemoryJournalState();
  const runtimeA=createRuntime(window,h,repositoryState,stateA,async()=>source('shared-device-install',{remote:{Pikachu:'H'}}));
  const runtimeB=createRuntime(window,h,repositoryState,stateB,async()=>source('shared-device-install',{remote:{Pikachu:'M'}}));
  const results=await Promise.allSettled([runtimeA.start(),runtimeB.start()]);
  assert.deepEqual(results.map(result=>result.status).sort(),['fulfilled','rejected']);
  const rejected=results.find(result=>result.status==='rejected');
  assert.equal(rejected.reason.code,'account-sync/migration-pending');
  const entity=[...h.server.entities.values()][0];
  assert.equal(h.server.entities.size,1);assert.ok(['H','M'].includes(entity.values.priority));
  assert.equal(Object.keys(repositoryState.migrations).length,1);
  const losingState=results[0].status==='rejected'?stateA:stateB,winningRuntime=results[0].status==='fulfilled'?runtimeA:runtimeB;
  assert.equal([...losingState.conflicts.values()].length,1);assert.equal(winningRuntime.projectionReady,true);
});

test('startup projects the exact account read but remains pending until the listener proves healthy',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),firstState=h.createMemoryJournalState();
  const read=async()=>source('device-hydrate-a',{remote:{Pikachu:'H'}}),first=createRuntime(window,h,repositoryState,firstState,read);await first.start();await first.stop();
  let handlers=null,sourceReads=0;const delayed={repository:{...repositoryState.repository,listenAccount(value){handlers=value;return()=>{};}}},projections=[],states=[],second=createRuntime(window,h,delayed,h.createMemoryJournalState(),async()=>{sourceReads++;return source('device-hydrate-b',{remote:{Pikachu:'H'}});},entities=>projections.push(entities),state=>states.push(state));
  const starting=second.start();for(let index=0;!handlers&&index<100;index++)await new Promise(resolve=>setImmediate(resolve));
  const pending=await second.snapshot();assert.equal(second.projectionReady,false);assert.equal(projections.length,0);assert.equal(sourceReads,0);
  assert.equal(pending.listenerState,'listening');assert.equal(pending.listenerHealthy,false);assert.equal(pending.controllerHealthy,false);assert.equal(pending.state,'pending-sync');assert.equal(pending.runtimeHealthy,false);assert.equal(states.some(value=>value.state==='saved'),false);
  handlers.onData(await delayed.repository.readAccount());const result=await starting,ready=await second.snapshot();assert.equal(result.ok,true);assert.equal(sourceReads,1);assert.equal(projections.length,1);assert.equal(projections[0][0].identity.catalogId,'pokemon:pikachu');assert.equal(ready.listenerHealthy,true);assert.equal(ready.controllerHealthy,true);assert.equal(ready.state,'saved');assert.equal(ready.runtimeHealthy,true);
});

for(const method of ['createMigration','createRecoveryCandidate','updateMeta']){
  for(const order of ['callback-before','microtask','promise-before'])test(`${method} reconciles exactly when the watched callback order is ${order}`,async()=>{
    const{repositoryState,runtime,result}=await directWriteScenario(method,{order});
    if(order==='promise-before')await new Promise(resolve=>setTimeout(resolve,5));
    const writeIndex=repositoryState.events.lastIndexOf(method),nextWrite=repositoryState.events.findIndex((event,index)=>index>writeIndex&&['createMigration','createRecoveryCandidate','updateMeta'].includes(event)),reconciliationEvents=repositoryState.events.slice(writeIndex+1,nextWrite<0?undefined:nextWrite),snapshot=await runtime.snapshot();
    assert.equal(result.ok,true);assert.equal(repositoryState.calls[method],1);assert.equal(repositoryState.events[writeIndex+1],'readAccount');
    assert.equal(reconciliationEvents.filter(event=>event==='readAccount').length,1);
    assert.equal(snapshot.listenerState,'healthy');assert.equal(snapshot.listenerHealthy,true);assert.notEqual(snapshot.lastError,'account-sync/listener-authority-lost');
  });
}

for(const method of ['createMigration','createRecoveryCandidate','updateMeta'])test(`${method} accepts an exact committed record after an ambiguous response without resending`,async()=>{
  const{repositoryState,runtime,result}=await directWriteScenario(method,{configure:context=>installDirectWriteBehavior(method,'response-lost',context)});
  assert.equal(result.ok,true);assert.equal(repositoryState.calls[method],1);assert.equal((await runtime.snapshot()).listenerHealthy,true);
});

for(const method of ['createMigration','createRecoveryCandidate','updateMeta'])test(`${method} fails closed after one bounded reconciliation read and never resends`,async()=>{
  const context=await directWriteAttempt(method,{configure:value=>installDirectWriteBehavior(method,'read-failure',value)});
  await assert.rejects(context.operation,error=>error.code==='account-sync/watched-write-unreconciled');
  const writeIndex=context.repositoryState.events.lastIndexOf(method),afterWrite=context.repositoryState.events.slice(writeIndex+1);
  assert.equal(context.repositoryState.calls[method],1);assert.equal(afterWrite.filter(event=>event==='readAccount').length,1);
  if(method!=='createRecoveryCandidate')assert.equal(context.journalState.meta.has('migration-complete'),false);
  else assert.equal(context.journalState.recoveryCandidates.size,1);
});

for(const method of ['createMigration','createRecoveryCandidate','updateMeta']){
  const expectedCode={createMigration:'account-sync/migration-evidence-conflict',createRecoveryCandidate:'account-sync/recovery-candidate-conflict',updateMeta:'account-sync/meta-conflict'}[method];
  for(const behavior of ['missing','divergent','owner-mismatch','schema-mismatch'])test(`${method} fails closed when canonical readback is ${behavior}`,async()=>{
    const context=await directWriteAttempt(method,{configure:value=>installDirectWriteBehavior(method,behavior,value)});
    const code=method==='updateMeta'&&behavior!=='missing'?'account-sync/schema-owner-invalid':expectedCode;
    await assert.rejects(context.operation,error=>error.code===code);
    assert.equal(context.repositoryState.calls[method],1);if(method!=='createRecoveryCandidate')assert.equal(context.journalState.meta.has('migration-complete'),false);
    if(method==='createRecoveryCandidate')assert.equal(context.journalState.recoveryCandidates.size,1);
  });
}

for(const method of ['createMigration','createRecoveryCandidate','updateMeta'])test(`${method} permits unrelated valid same-session listener turnover only after exact readback`,async()=>{
  const{repositoryState,result,runtime}=await directWriteScenario(method,{configure:context=>installDirectWriteBehavior(method,'unrelated-turnover',context)});
  assert.equal(result.ok,true);assert.equal(repositoryState.calls[method],1);assert.equal((await runtime.snapshot()).listenerHealthy,true);
});

for(const method of ['createMigration','createRecoveryCandidate','updateMeta']){
  for(const [behavior,code] of [['listener-failure','account-sync/listener-failed'],['malformed-listener','account-sync/remote-entity-invalid']])test(`${method} rejects ${behavior} during the watched write`,async()=>{
    const context=await directWriteAttempt(method,{order:behavior==='malformed-listener'?'silent':'callback-before',configure:value=>installDirectWriteBehavior(method,behavior,value)});
    await assert.rejects(context.operation,error=>error.code===code);
    assert.equal(context.repositoryState.calls[method],1);if(method!=='createRecoveryCandidate')assert.equal(context.journalState.meta.has('migration-complete'),false);
  });
}

for(const method of ['createMigration','createRecoveryCandidate','updateMeta'])test(`${method} cannot complete into a stopped replacement runtime`,async()=>{
  let releaseWrite,notifyStarted;const writeGate=new Promise(resolve=>{releaseWrite=resolve;}),started=new Promise(resolve=>{notifyStarted=resolve;});
  const context=await directWriteAttempt(method,{configure:({repositoryState,original})=>{repositoryState.repository[method]=async value=>{notifyStarted();await writeGate;return original(value);};}});
  await started;const stopping=context.runtime.stop();await Promise.resolve();releaseWrite();
  await assert.rejects(context.operation,error=>error.code==='account-sync/session-changed');await stopping;
  assert.equal(context.repositoryState.calls[method],1);if(method!=='createRecoveryCandidate')assert.equal(context.journalState.meta.has('migration-complete'),false);
});

test('an initial listener timeout fails once without an automatic reconnect loop',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),first=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-timeout-a',{remote:{Pikachu:'H'}}));await first.start();await first.stop();
  let subscriptions=0;const silent={repository:{...repositoryState.repository,listenAccount(){subscriptions++;return()=>{};}}},states=[],runtime=createRuntime(window,h,silent,h.createMemoryJournalState(),async()=>source('device-timeout-b',{remote:{Pikachu:'H'}}),()=>{},state=>states.push(state),async()=>({ok:true}),{listenerReadyTimeoutMs:20});
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/listener-timeout');await new Promise(resolve=>setTimeout(resolve,30));const failed=await runtime.snapshot();
  assert.equal(subscriptions,1);assert.equal(runtime.projectionReady,false);assert.equal(failed.listenerState,'failed');assert.equal(failed.listenerHealthy,false);assert.equal(failed.controllerHealthy,false);assert.equal(failed.state,'sync-error');assert.equal(failed.lastError,'account-sync/listener-timeout');assert.equal(failed.lastErrorCategory,'listener');assert.equal(states.some(value=>value.state==='saved'),false);
});

test('a silent listener blocks migration source reads, seed replay, and every direct migration write',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState();let sourceReads=0,applyCalls=0,migrationWrites=0,candidateWrites=0,metaWrites=0;
  const original=repositoryState.repository;const silent={repository:{...original,listenAccount(){return()=>{};},async applyOperation(value){applyCalls++;return original.applyOperation(value);},async createMigration(value){migrationWrites++;return original.createMigration(value);},async createRecoveryCandidate(value){candidateWrites++;return original.createRecoveryCandidate(value);},async updateMeta(value){metaWrites++;return original.updateMeta(value);}}};
  const runtime=createRuntime(window,h,silent,state,async()=>{sourceReads++;return source('device-silent-migration',{remote:{Pikachu:'H'},queue:{queued:{kind:'my-list-update',path:'wishlist/Owner',data:{Pikachu:'M'}}}});},()=>{},()=>{},async()=>({ok:true}),{listenerReadyTimeoutMs:20});
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/listener-timeout');assert.equal(sourceReads,0);assert.equal(applyCalls,0);assert.equal(migrationWrites,0);assert.equal(candidateWrites,0);assert.equal(metaWrites,0);assert.equal(state.operations.size,0);assert.equal(state.entities.size,0);assert.equal(runtime.projectionReady,false);
});

test('migration cannot become projection-ready when canonical meta commitment fails',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState();
  repositoryState.repository.updateMeta=async()=>window.PogoDomain.accountSyncModel.failure('account-sync/meta-conflict','meta rejected');
  const runtime=createRuntime(window,h,repositoryState,state,async()=>source('device-meta-fail',{remote:{Pikachu:'H'}}));
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/meta-conflict');assert.equal(runtime.projectionReady,false);
});

test('catalog projection failure remains a canonical error and never becomes projection-ready',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState(),runtime=createRuntime(window,h,repositoryState,state,async()=>source('device-projection-fail',{remote:{Pikachu:'H'}}),()=>false);
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/catalog-projection-unresolved');
  const snapshot=await runtime.snapshot();assert.equal(runtime.projectionReady,false);assert.equal(snapshot.state,'sync-error');assert.equal(snapshot.lastError,'account-sync/catalog-projection-unresolved');assert.equal(snapshot.lastErrorCategory,'canonical');assert.equal(snapshot.runtimeHealthy,false);
});

test('tampered local migration completion evidence remains blocked across restart',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState(),read=async()=>source('device-evidence',{remote:{Pikachu:'H'}}),first=createRuntime(window,h,repositoryState,state,read);
  await first.start();await first.stop();const completed=state.meta.get('migration-complete');state.meta.set('migration-complete',{...completed,sourceFingerprint:'f'.repeat(64)});
  const restarted=createRuntime(window,h,repositoryState,state,read);await assert.rejects(restarted.start(),error=>error.code==='account-sync/migration-evidence-conflict');
  const snapshot=await restarted.snapshot();assert.equal(restarted.projectionReady,false);assert.equal(snapshot.state,'sync-error');assert.equal(snapshot.lastError,'account-sync/migration-evidence-conflict');assert.equal(snapshot.lastErrorCategory,'migration');
});

test('migration never publishes a partial public projection and publishes one complete snapshot only after verification',async()=>{
  const window=load(),failedHarness=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),failedRepository=runtimeRepository(window,failedHarness),failedState=failedHarness.createMemoryJournalState(),partial=[];
  const apply=failedRepository.repository.applyOperation.bind(failedRepository.repository);let attempts=0;
  failedRepository.repository.applyOperation=operation=>++attempts===2?Promise.reject(Object.assign(new Error('denied'),{code:'permission-denied'})):apply(operation);
  const failed=createRuntime(window,failedHarness,failedRepository,failedState,async()=>source('device-partial-public',{remote:{Pikachu:'H',Rayquaza:'M'}}),()=>{},()=>{},rows=>{partial.push(rows);return{ok:true};});
  await assert.rejects(failed.start(),error=>error.code==='account-sync/migration-pending');assert.equal(partial.length,0);assert.equal(failed.projectionReady,false);await failed.stop();

  const healthyHarness=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),healthyRepository=runtimeRepository(window,healthyHarness),published=[];
  const healthy=createRuntime(window,healthyHarness,healthyRepository,healthyHarness.createMemoryJournalState(),async()=>source('device-complete-public',{remote:{Pikachu:'H',Rayquaza:'M'}}),()=>{},()=>{},(rows,operation)=>{published.push({rows,operation});return{ok:true};});
  const result=await healthy.start();assert.equal(result.ok,true);assert.equal(published.length,1);assert.equal(published[0].rows.length,2);assert.equal(published[0].operation.kind,'migration-complete');assert.equal(healthy.projectionReady,true);
});

test('migration remains active when its complete public projection is temporarily unavailable',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),runtime=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-public-failure',{remote:{Pikachu:'H'}}),()=>{},()=>{},async()=>{throw Object.assign(new Error('publication unavailable'),{code:'db/public-share-timeout'});});
  const result=await runtime.start(),state=await runtime.snapshot();assert.equal(result.ok,true);assert.equal(runtime.projectionReady,true);assert.equal(state.lastProjectionError,'db/public-share-timeout');assert.equal(state.state,'saved');
});

test('restart re-verifies an existing migration and commits missing canonical metadata before projection',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState(),originalUpdate=repositoryState.repository.updateMeta.bind(repositoryState.repository);let attempts=0;
  repositoryState.repository.updateMeta=async patch=>++attempts===1?window.PogoDomain.accountSyncModel.failure('account-sync/meta-conflict','first meta write rejected'):originalUpdate(patch);
  const read=async()=>source('device-restart',{remote:{Pikachu:'H'}}),first=createRuntime(window,h,repositoryState,state,read);
  await assert.rejects(first.start(),error=>error.code==='account-sync/meta-conflict');assert.equal(Object.keys(repositoryState.migrations).length,1);assert.equal(repositoryState.meta,null);await first.stop();
  const projections=[],restarted=createRuntime(window,h,repositoryState,state,read,entities=>projections.push(entities));const result=await restarted.start();
  assert.equal(result.ok,true);assert.equal(attempts,2);assert.equal(repositoryState.meta.initialized,true);assert.equal(restarted.projectionReady,true);assert.equal(projections.at(-1).length,1);
});

test('restart after canonical metadata commit but before the local completion marker remains resumable',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState();
  const read=async()=>source('device-meta-committed',{remote:{Pikachu:'H'}}),first=createRuntime(window,h,repositoryState,state,read);
  await first.start();await first.stop();state.meta.delete('migration-complete');
  const projections=[],restarted=createRuntime(window,h,repositoryState,state,read,entities=>projections.push(entities)),result=await restarted.start();
  assert.equal(result.ok,true);assert.equal(repositoryState.meta.initialized,true);assert.equal(Object.keys(repositoryState.migrations).length,1);
  assert.equal(restarted.projectionReady,true);assert.equal(projections.at(-1).length,1);
});

test('standalone restart resumes an interrupted stale-device review without replaying canonical evidence',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const base=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-cloud-base',{remote:{Pikachu:'H'}}));
  await base.start();await base.stop();

  const journalState=h.createMemoryJournalState(),read=async()=>source('device-standalone',{remote:{Pikachu:'H'},local:{Pikachu:'H',Mewtwo:'H'}});
  const originalCreateMigration=repositoryState.repository.createMigration.bind(repositoryState.repository),originalReadAccount=repositoryState.repository.readAccount.bind(repositoryState.repository);
  installDirectWriteBehavior('createMigration','read-failure',{repositoryState,original:originalCreateMigration});
  const interrupted=createRuntime(window,h,repositoryState,journalState,read);
  await assert.rejects(interrupted.start(),error=>error.code==='account-sync/watched-write-unreconciled');
  const interruptedSnapshot=await interrupted.snapshot();
  assert.equal(interrupted.projectionReady,false);assert.equal(interruptedSnapshot.recoveryCandidateCount,1);assert.equal(interruptedSnapshot.state,'sync-error');
  assert.equal(Object.keys(repositoryState.recoveryCandidates).length,1);assert.equal(Object.values(repositoryState.recoveryCandidates)[0].reason,'stale-device-cache');
  assert.equal(repositoryState.calls.createRecoveryCandidate,1);assert.equal(repositoryState.calls.createMigration,2);
  await interrupted.stop();

  repositoryState.repository.createMigration=originalCreateMigration;repositoryState.repository.readAccount=originalReadAccount;
  const attemptsBeforeRestart=h.server.attempts.length,restarted=createRuntime(window,h,repositoryState,journalState,read),result=await restarted.start(),reviewSnapshot=await restarted.snapshot();
  assert.equal(result.ok,true);assert.equal(restarted.projectionReady,true);assert.equal(reviewSnapshot.state,'review-required');assert.equal(reviewSnapshot.recoveryCandidateCount,1);
  assert.equal(repositoryState.calls.createRecoveryCandidate,1);assert.equal(repositoryState.calls.createMigration,2);assert.equal(h.server.attempts.length,attemptsBeforeRestart);
  assert.equal([...h.server.entities.values()].some(entity=>entity.identity.catalogId==='pokemon:mewtwo'),false);

  const candidates=await restarted.listRecoveryCandidates(),reviewed=await restarted.completeRecoveryReviews(candidates.map(item=>item.candidateId)),saved=await restarted.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(reviewed)),{ok:true,status:'resolved',count:1});assert.equal(saved.state,'saved');assert.equal(saved.recoveryCandidateCount,0);
  assert.equal(repositoryState.calls.createRecoveryCandidate,1);assert.equal(repositoryState.calls.createMigration,2);assert.equal(h.server.attempts.length,attemptsBeforeRestart);
});

test('standalone migration accepts canonical drift when duplicate legacy snapshots are already preserved for review',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const base=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-canonical-base',{remote:{Pikachu:'H'}}));
  await base.start();const current=base.controller.activeEntities()[0],patched=await base.controller.patchEntity({entityType:current.entityType,entityId:current.entityId,patch:{priority:'M'}});assert.equal(patched.ok,true);await base.controller.drain();await base.stop();

  const attemptsBefore=h.server.attempts.length,journalState=h.createMemoryJournalState(),read=async()=>source('device-stale-duplicates',{remote:{Pikachu:'H'},local:{Pikachu:'H'}}),standalone=createRuntime(window,h,repositoryState,journalState,read),result=await standalone.start(),snapshot=await standalone.snapshot();
  assert.equal(result.ok,true);assert.equal(standalone.projectionReady,true);assert.equal(snapshot.state,'review-required');assert.equal(snapshot.recoveryCandidateCount,1);
  assert.equal(result.plan.verificationSeeds.length,0);assert.equal(result.plan.recoveryCandidates.length,1);assert.equal(result.plan.recoveryCandidates[0].reason,'legacy-after-canonical');
  assert.equal(repositoryState.calls.createRecoveryCandidate,1);assert.equal(h.server.attempts.length,attemptsBefore);assert.equal(standalone.controller.activeEntities()[0].values.priority,'M');
});

test('stopping during migration source acquisition prevents later writes and projection',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState(),projections=[];
  let releaseSource;const sourceGate=new Promise(resolve=>{releaseSource=resolve;});
  const runtime=createRuntime(window,h,repositoryState,state,async()=>{await sourceGate;return source('device-cancelled',{remote:{Pikachu:'H'}});},entities=>projections.push(entities));
  const starting=runtime.start();await Promise.resolve();await Promise.resolve();const stopping=runtime.stop();releaseSource();
  await assert.rejects(starting,error=>error.code==='account-sync/runtime-closed');await stopping;
  assert.equal(h.server.entities.size,0);assert.equal(Object.keys(repositoryState.migrations).length,0);assert.equal(repositoryState.meta,null);
  assert.equal(runtime.projectionReady,false);assert.equal(projections.length,0);
});

test('restart rejects incomplete canonical seeds even when a create-only migration record already exists',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState();
  repositoryState.repository.updateMeta=async()=>window.PogoDomain.accountSyncModel.failure('account-sync/meta-conflict','meta rejected');
  const read=async()=>source('device-incomplete',{remote:{Pikachu:'H'}}),first=createRuntime(window,h,repositoryState,state,read);
  await assert.rejects(first.start(),error=>error.code==='account-sync/meta-conflict');await first.stop();h.server.entities.clear();
  const restarted=createRuntime(window,h,repositoryState,state,read);await assert.rejects(restarted.start(),error=>error.code==='account-sync/migration-incomplete');assert.equal(restarted.projectionReady,false);assert.equal(repositoryState.meta,null);
});

test('a verified device migration is not reinterpreted from evolved legacy state on reload',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),state=h.createMemoryJournalState();
  const first=createRuntime(window,h,repositoryState,state,async()=>source('device-complete',{remote:{Pikachu:'H'}}));await first.start();await first.stop();
  const entity=[...h.server.entities.values()][0];h.server.entities.set(`tradeEntry|${entity.entityId}`,{...entity,revision:entity.revision+1,updatedAt:entity.updatedAt+1,values:{...entity.values,priority:'M'},fieldRevisions:{...entity.fieldRevisions,[window.PogoDomain.accountSyncModel.fieldToken('priority')]:entity.fieldRevisions[window.PogoDomain.accountSyncModel.fieldToken('priority')]+1},fieldMutations:{...entity.fieldMutations,[window.PogoDomain.accountSyncModel.fieldToken('priority')]:'op_0000000000000992'},fieldMutationHashes:{...entity.fieldMutationHashes,[window.PogoDomain.accountSyncModel.fieldToken('priority')]:'a'.repeat(64)}});
  let sourceReads=0;const restarted=createRuntime(window,h,repositoryState,state,async()=>{sourceReads++;throw new Error('completed migration must not reread legacy sources');});const result=await restarted.start();
  assert.equal(result.ok,true);assert.equal(result.plan.resumed,true);assert.equal(sourceReads,0);assert.equal(Object.keys(repositoryState.migrations).length,1);assert.equal(restarted.projectionReady,true);
});

test('a later pre-sync device replays a queued update only while canonical state matches its legacy base',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const first=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-queue-base',{remote:{Pikachu:'H'}}));await first.start();await first.stop();
  const queue={queued:{kind:'my-list-update',path:'wishlist/Owner',data:{Pikachu:'M'}}};
  const second=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-queue-replay',{remote:{Pikachu:'H'},queue}));const result=await second.start();
  const entity=[...h.server.entities.values()].find(value=>value.identity.catalogId==='pokemon:pikachu');
  assert.equal(result.ok,true);assert.equal(result.plan.replayMutations.length,1);assert.equal(result.plan.recoveryCandidates.length,0);assert.equal(entity.values.priority,'M');
  assert.equal(Object.keys(repositoryState.migrations).length,2);assert.equal(second.projectionReady,true);
});

test('a queued full-profile Special Trade Board update replays exact adds edits and tombstone deletions before migration verification',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),baseBoard={lf:[],ft:[{name:'Pikachu',qty:1},{name:'Eevee',qty:1}]};
  const first=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-board-base',{remoteBoard:baseBoard}));await first.start();await first.stop();
  const queue={profile:{path:'users/Owner',data:{friendCode:'1234 5678 9012',specialTradeBoard:{lf:[],ft:[{name:'Pikachu',qty:3},{name:'Mewtwo',qty:2}]}}}};
  const second=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-board-queue',{remoteBoard:baseBoard,queue})),result=await second.start();
  const entities=[...h.server.entities.values()],byCatalog=id=>entities.find(entity=>entity.identity.catalogId===`pokemon:${id}`);
  assert.equal(result.ok,true);assert.equal(result.plan.replayMutations.filter(item=>item.kind==='patch').length,1);assert.equal(result.plan.replayMutations.filter(item=>item.kind==='delete').length,1);
  assert.equal(result.plan.verificationTombstones.length,1);assert.equal(result.plan.recoveryCandidates.length,0);
  assert.equal(byCatalog('pikachu').values.quantity,3);assert.equal(byCatalog('mewtwo').values.quantity,2);assert.equal(byCatalog('eevee').deleted,true);
  assert.equal(Object.values(repositoryState.migrations).at(-1).seedCount,3);assert.equal(second.projectionReady,true);
});

test('a runtime recovery candidate immediately changes the published state from saved to review-required',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),states=[];
  const runtime=createRuntime(window,h,repositoryState,journalState,async()=>source('device-runtime-candidate'),()=>{},state=>states.push(state));await runtime.start();
  await runtime.recordRecoveryCandidate({reason:'catalog-identity-unresolved',entityType:'tradeEntry',entityId:'unresolved:my-list:wishlist:unknown',identity:{surface:'my-list',lane:'wishlist',unresolved:true},values:{displayName:'Unknown'},source:'product-edit'});
  assert.equal(states.at(-1).state,'review-required');assert.equal(states.at(-1).recoveryCandidateCount,1);assert.equal(states.at(-1).migrationReady,true);
  const candidate=(await runtime.listRecoveryCandidates())[0],reviewed=await runtime.completeRecoveryReview(candidate.candidateId);
  assert.equal(reviewed.ok,true);assert.equal(reviewed.status,'resolved');assert.equal(states.at(-1).state,'saved');assert.equal(states.at(-1).recoveryCandidateCount,0);
  assert.equal((await runtime.listRecoveryCandidates()).length,0);assert.equal(journalState.recoveryCandidates.get(candidate.candidateId).resolved,true);
  assert.equal(repositoryState.recoveryCandidates[candidate.candidateId].resolved,false);assert.equal(repositoryState.calls.createRecoveryCandidate,1);
  assert.equal(repositoryState.calls.createRecoveryReviewAcceptance,1);assert.equal(Object.keys(repositoryState.recoveryReviewAcceptances).length,1);
});

test('owner review atomically accepts the exact canonical account copy without replaying preserved candidates',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),journalState=h.createMemoryJournalState(),states=[];
  const runtime=createRuntime(window,h,repositoryState,journalState,async()=>source('device-exact-review',{remote:{Pikachu:'H'}}),()=>{},state=>states.push(state));await runtime.start();
  for(const [index,name] of ['Wiglett','Mazer'].entries())await runtime.recordRecoveryCandidate({reason:'historical-device-value',entityType:index?'favorite':'tradeEntry',entityId:`unresolved:${name.toLowerCase()}`,identity:{displayName:name,unresolved:true},values:{displayName:name},source:'owner-review'});
  const candidates=await runtime.listRecoveryCandidates(),ids=candidates.map(item=>item.candidateId).sort(),attemptsBefore=h.server.attempts.length;
  assert.equal((await runtime.snapshot()).state,'review-required');assert.equal(candidates.length,2);

  const incomplete=await runtime.completeRecoveryReviews(ids.slice(0,1));
  assert.equal(incomplete.ok,false);assert.equal(incomplete.error.code,'account-sync/recovery-review-not-ready');
  assert.equal((await runtime.listRecoveryCandidates()).length,2);assert.equal([...journalState.recoveryCandidates.values()].filter(item=>item.resolved===true).length,0);
  const duplicate=await runtime.completeRecoveryReviews([ids[0],ids[0]]);
  assert.equal(duplicate.ok,false);assert.equal(duplicate.error.code,'account-sync/recovery-review-changed');assert.equal(repositoryState.calls.createRecoveryReviewAcceptance,0);

  const reviewed=await runtime.completeRecoveryReviews(ids),snapshot=await runtime.snapshot(),all=[...journalState.recoveryCandidates.values()];
  assert.deepEqual(JSON.parse(JSON.stringify(reviewed)),{ok:true,status:'resolved',count:2});assert.equal(snapshot.state,'saved');assert.equal(snapshot.recoveryCandidateCount,0);
  assert.equal(states.at(-1).state,'saved');assert.equal(new Set(all.map(item=>item.resolvedAt)).size,1);assert.ok(all.every(item=>item.resolved===true));
  assert.ok(Object.values(repositoryState.recoveryCandidates).every(item=>item.resolved===false));assert.equal(repositoryState.calls.createRecoveryCandidate,2);assert.equal(h.server.attempts.length,attemptsBefore);
  assert.equal(repositoryState.calls.createRecoveryReviewAcceptance,1);assert.equal(Object.keys(repositoryState.recoveryReviewAcceptances).length,1);

  await runtime.stop();
  await assert.rejects(runtime.completeRecoveryReviews(ids),error=>error.code==='account-sync/runtime-closed');
});

test('an exact reviewed recovery set is backfilled once and inherited by a clean browser journal',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const baseline=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-review-baseline',{remote:{Pikachu:'H'}}));await baseline.start();await baseline.stop();

  const reviewedState=h.createMemoryJournalState(),reviewSource=async()=>source('device-review-original',{remote:{Pikachu:'M'}}),original=createRuntime(window,h,repositoryState,reviewedState,reviewSource);await original.start();
  const preserved=[...reviewedState.recoveryCandidates.values()];assert.equal(preserved.length,1);assert.equal((await original.snapshot()).state,'review-required');
  reviewedState.recoveryCandidates.set(preserved[0].candidateId,{...preserved[0],resolved:true,resolvedAt:h.clock()});await original.stop();
  assert.equal(Object.keys(repositoryState.recoveryReviewAcceptances).length,0);

  const upgraded=createRuntime(window,h,repositoryState,reviewedState,reviewSource),upgradedResult=await upgraded.start();
  assert.equal(upgradedResult.ok,true);assert.equal((await upgraded.snapshot()).state,'saved');assert.equal(Object.keys(repositoryState.recoveryReviewAcceptances).length,1);await upgraded.stop();

  const cleanState=h.createMemoryJournalState(),clean=createRuntime(window,h,repositoryState,cleanState,async()=>source('device-review-clean',{remote:{Pikachu:'M'}})),cleanResult=await clean.start();
  assert.equal(cleanResult.ok,true);assert.equal((await clean.snapshot()).state,'saved');assert.equal((await clean.listRecoveryCandidates()).length,0);
  const inherited=await clean.listRecoveryCandidates({unresolvedOnly:false});assert.equal(inherited.length,1);assert.equal(inherited[0].resolved,true);await clean.stop();

  const changed=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-review-changed',{remote:{Pikachu:'L'}}));await changed.start();
  assert.equal((await changed.snapshot()).state,'review-required');assert.equal((await changed.listRecoveryCandidates()).length,1);assert.equal(Object.keys(repositoryState.recoveryReviewAcceptances).length,1);await changed.stop();
});

test('a conflicting recovery acceptance marker fails closed without resolving clean-profile evidence',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const baseline=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-conflict-baseline',{remote:{Pikachu:'H'}}));await baseline.start();await baseline.stop();
  const first=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-conflict-review',{remote:{Pikachu:'M'}}));await first.start();const ids=(await first.listRecoveryCandidates()).map(value=>value.candidateId);await first.completeRecoveryReviews(ids);await first.stop();
  const marker=Object.values(repositoryState.recoveryReviewAcceptances)[0];repositoryState.recoveryReviewAcceptances[marker.evidenceFingerprint]={...marker,candidateCount:marker.candidateCount+1};
  const cleanState=h.createMemoryJournalState(),clean=createRuntime(window,h,repositoryState,cleanState,async()=>source('device-conflict-clean',{remote:{Pikachu:'M'}}));
  await assert.rejects(clean.start(),error=>error.code==='account-sync/recovery-review-acceptance-conflict');assert.equal(clean.projectionReady,false);
  assert.equal([...cleanState.recoveryCandidates.values()].filter(value=>value.resolved!==true).length,1);await clean.stop();
});

async function firstStateSnapshot(state){
  return{pendingCount:[...state.operations.values()].filter(record=>['pending','sending'].includes(record.status)).length};
}

test('normal enrollment preserves all 66 reviewed stale records inactive across restart and clean-device adoption',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
  const normal={admitted:true,allowlistedUids:[]},remote=Object.fromEntries(Array.from({length:66},(_,i)=>[`Pokemon${i}`,'H'])),stale=Object.fromEntries(Object.keys(remote).map(name=>[name,'M']));
  const make=(state,read)=>createRuntime(window,h,repositoryState,state,read,undefined,undefined,undefined,normal);
  const baseline=make(h.createMemoryJournalState(),async()=>source('normal-baseline',{remote}));await baseline.start();await baseline.stop();
  const state=h.createMemoryJournalState(),reviewed=make(state,async()=>source('normal-reviewed',{remote:stale}));await reviewed.start();
  assert.equal((await reviewed.snapshot()).state,'review-required');
  const ids=(await reviewed.listRecoveryCandidates()).map(value=>value.candidateId);assert.equal(ids.length,66);
  assert.equal((await reviewed.completeRecoveryReviews(ids)).ok,true);await reviewed.stop();
  const canonical=JSON.stringify(h.server.snapshot()),preserved=JSON.stringify(repositoryState.recoveryCandidates),attempts=h.server.attempts.length,receipts=repositoryState.calls.createMigration;
  const reopened=make(state,async()=>{throw new Error('completed migration must not reread legacy');});await reopened.start();
  assert.equal((await reopened.snapshot()).state,'saved');assert.equal((await reopened.listRecoveryCandidates()).length,0);
  assert.equal((await reopened.listRecoveryCandidates({unresolvedOnly:false})).length,66);assert.equal(repositoryState.calls.createMigration,receipts);await reopened.stop();
  const second=make(h.createMemoryJournalState(),async()=>source('normal-second',{remote:stale}));await second.start();
  assert.equal((await second.snapshot()).state,'saved');assert.equal((await second.listRecoveryCandidates()).length,0);
  assert.equal((await second.listRecoveryCandidates({unresolvedOnly:false})).length,66);
  assert.equal(JSON.stringify(repositoryState.recoveryCandidates),preserved);assert.equal(JSON.stringify(h.server.snapshot()),canonical);assert.equal(h.server.attempts.length,attempts);assert.equal(repositoryState.calls.updateMeta,1);await second.stop();
});

test('same-UID PIN reset preserves canonical data and reviewed66 across Auth emulator login and runtime reopen',{skip:!process.env.FIREBASE_AUTH_EMULATOR_HOST},async t=>{
  const host=process.env.FIREBASE_AUTH_EMULATOR_HOST,projectId='demo-legacy-pin-reset';
  assert.match(host||'',/^127\.0\.0\.1:9499$/,'Run only through the dedicated Auth emulator configuration');
  const resetRequire=require('node:module').createRequire(path.join(root,'functions/legacy-pin-reset/package.json'));
  const {initializeApp,deleteApp}=resetRequire('firebase-admin/app');
  const {getAuth}=resetRequire('firebase-admin/auth');
  const {createResetService}=require('../functions/legacy-pin-reset/reset');
  const {createPasswordUpdater}=require('../functions/legacy-pin-reset/password');
  const {createJournal}=require('../functions/legacy-pin-reset/journal');
  const app=initializeApp({projectId},'pin-reset-proof'),admin=getAuth(app);
  try{
    await admin.createUser({uid:'reset-admin-uid',email:'reset-admin@example.test',password:'123456'});
    await admin.createUser({uid:'uid-owner',email:'owner@pogotrades.nyc',password:'123456'});
    await admin.updateUser('uid-owner',{providerToLink:{providerId:'google.com',uid:'emulator-google-subject',email:'synthetic@example.test'}});
    const login=async password=>{
      const response=await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@pogotrades.nyc',password,returnSecureToken:true})});
      return{ok:response.ok,body:await response.json()};
    };
    const googleLogin=async()=>{
      // Emulator-only IdP assertions; never contact Google or a production project.
      const postBody=new URLSearchParams({providerId:'google.com',id_token:JSON.stringify({sub:'emulator-google-subject',email:'synthetic@example.test',email_verified:true})}).toString();
      const response=await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=emulator`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody,requestUri:'http://localhost',returnSecureToken:true})});
      assert.equal(response.ok,true);const result=await response.json();assert.equal(result.localId,'uid-owner');assert.notEqual(result.isNewUser,true);
    };
    assert.equal((await login('123456')).body.localId,'uid-owner');
    await googleLogin();
    const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);
    const remote=Object.fromEntries(Array.from({length:66},(_,i)=>[`Pokemon${i}`,'H'])),stale=Object.fromEntries(Object.keys(remote).map(name=>[name,'M']));
    const make=(state,read)=>createRuntime(window,h,repositoryState,state,read,undefined,undefined,undefined,{admitted:true,allowlistedUids:[]});
    const first=make(h.createMemoryJournalState(),async()=>source('reset-baseline',{remote}));await first.start();await first.stop();
    const state=h.createMemoryJournalState(),reviewed=make(state,async()=>source('reset-reviewed',{remote:stale}));await reviewed.start();
    await reviewed.completeRecoveryReviews((await reviewed.listRecoveryCandidates()).map(r=>r.candidateId));await reviewed.stop();
    const evidence={admins:{'reset-admin-uid':true},users:{Doomsday126:{authUid:'reset-admin-uid',isAdmin:true},Owner:{authUid:'uid-owner',authEmail:'owner@pogotrades.nyc',authVersion:1}},
      loginDirectory:{Owner:{authReady:true,authVersion:1}},authIndex:{'reset-admin-uid':{username:'Doomsday126'},'uid-owner':{username:'Owner'}}};
    const products={lf:['Pikachu'],ft:['Eevee'],unprioritized:['Snom'],board:{lf:['Pikachu'],ft:['Eevee']},favorites:['Mazer'],tags:{Mazer:['NYC']},profile:{trainer:'Owner'},publicShare:{ownerUid:'uid-owner'}};
    const before=JSON.stringify({canonical:h.server.snapshot(),recovery:repositoryState.recoveryCandidates,evidence,products});
    const migrationBefore=JSON.stringify(repositoryState.migrations),metaBefore=repositoryState.calls.updateMeta;
    const links=(await admin.getUser('uid-owner')).providerData,attempts=h.server.attempts.length,migrations=repositoryState.calls.createMigration;
    let value={schemaVersion:1,records:[]},generation=1;
    const journal=createJournal({read:async()=>({value:structuredClone(value),generation}),compareAndSwap:async(expected,next)=>{assert.equal(expected,generation);value=structuredClone(next);generation++;}});
    const reset=createResetService({ownerUid:'reset-admin-uid',hmacKey:'emulator-only-key'.repeat(4),journal,adapter:{readEvidence:async()=>structuredClone(evidence),getAuthUser:uid=>admin.getUser(uid),
      listAuthIdentities:async()=>(await admin.listUsers()).users.map(({uid,email})=>({uid,email})),legacyOnly:async()=>true,updatePassword:createPasswordUpdater({projectId,emulatorHost:host})}});
    const caller={uid:'reset-admin-uid',appVerified:true,authTime:Math.floor(Date.now()/1000)},target=await reset.run(caller,{action:'inspect',username:'Owner'});
    const {created,...binding}=target,input={action:'reset',...binding,requestId:webcrypto.randomUUID(),pin:'654321'};
    assert.equal((await reset.run(caller,input)).status,'completed');
    assert.equal((await login('123456')).ok,false);assert.equal((await login('654321')).body.localId,'uid-owner');
    await googleLogin();
    assert.deepEqual((await admin.getUser('uid-owner')).providerData,links);
    const reopened=make(state,async()=>{throw new Error('PIN reset must not rerun migration');});await reopened.start();
    assert.equal((await reopened.snapshot()).state,'saved');assert.equal((await reopened.listRecoveryCandidates()).length,0);
    assert.equal((await reopened.listRecoveryCandidates({unresolvedOnly:false})).length,66);await reopened.stop();
    assert.equal(JSON.stringify(repositoryState.migrations),migrationBefore);
    assert.equal(repositoryState.calls.createMigration,migrations);
    const clean=make(h.createMemoryJournalState(),async()=>source('reset-clean-device',{remote:stale}));await clean.start();
    assert.equal((await clean.snapshot()).state,'saved');assert.equal((await clean.listRecoveryCandidates()).length,0);
    assert.equal((await clean.listRecoveryCandidates({unresolvedOnly:false})).length,66);await clean.stop();
    assert.equal(JSON.stringify({canonical:h.server.snapshot(),recovery:repositoryState.recoveryCandidates,evidence,products}),before);
    assert.equal(h.server.attempts.length,attempts);
    await t.test('clean-device receipt is additive evidence, not a destructive migration',()=>{
      const previous=JSON.parse(migrationBefore);
      for(const [id,receipt] of Object.entries(previous))assert.deepEqual(JSON.parse(JSON.stringify(repositoryState.migrations[id])),receipt);
      const added=Object.entries(repositoryState.migrations).filter(([id])=>!Object.hasOwn(previous,id));
      assert.equal(repositoryState.calls.createMigration,migrations+1);assert.equal(added.length,1);
      assert.equal(added[0][1].ownerUid,'uid-owner');assert.equal(added[0][1].seedCount,0);
      assert.equal(added[0][1].verified,true);assert.equal(added[0][1].legacyRetained,true);
      assert.equal(repositoryState.calls.updateMeta,metaBefore);
      assert.equal(h.server.attempts.length,attempts);
    });
    assert.equal((await reset.run(caller,input)).status,'completed');
  }finally{await deleteApp(app);}
});

test('normal runtime rejects same-UID session replacement during source acquisition before any write',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);let current=true;
  const runtime=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>{current=false;return source('replaced',{remote:{Pikachu:'H'}});},undefined,undefined,undefined,{admitted:true,allowlistedUids:[],sessionCurrent:()=>current});
  await assert.rejects(runtime.start(),error=>error.code==='account-sync/session-changed');assert.equal(h.server.attempts.length,0);assert.equal(repositoryState.calls.createMigration,0);assert.equal(runtime.projectionReady,false);await runtime.stop();
});

test('normal second-device adoption shares canonical state and retains the existing same-field conflict boundary',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h);let onlineA=true,onlineB=true;
  const make=(id,online)=>createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source(id,{remote:{Pikachu:'H'}}),undefined,undefined,undefined,{admitted:true,allowlistedUids:[],online});
  const a=make('normal-conflict-a',()=>onlineA);await a.start();
  const b=make('normal-conflict-b',()=>onlineB);await b.start();
  assert.equal(repositoryState.calls.updateMeta,1);assert.equal(h.server.entities.size,1);
  const entry=[...h.server.entities.values()][0];assert.equal(b.controller.getEntity('tradeEntry',entry.entityId).values.priority,'H');
  onlineA=false;onlineB=false;
  await a.controller.patchEntity({entityType:'tradeEntry',entityId:entry.entityId,patch:{priority:'M'}});
  await b.controller.patchEntity({entityType:'tradeEntry',entityId:entry.entityId,patch:{priority:'L'}});
  onlineA=true;await a.controller.drain();onlineB=true;await b.controller.drain();
  const details=await b.controller.conflictDetails();assert.equal(details.length,1);assert.equal(details[0].fields[0].deviceValue,'L');assert.equal(details[0].fields[0].accountValue,'M');
  assert.equal((await b.snapshot()).state,'conflict');assert.equal(h.server.entities.get(`tradeEntry|${entry.entityId}`).values.priority,'M');
  assert.equal((await b.controller.acceptConflict(details[0].conflictId)).ok,true);assert.equal((await b.snapshot()).state,'saved');await a.stop();await b.stop();
});
