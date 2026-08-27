const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
const files=[
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

function runtimeRepository(window,h){
  let meta=null;const migrations={},recoveryCandidates={};
  const repository={
    ...h.server,ownerUid:'uid-owner',
    async readAccount(){return{...h.server.snapshot(),...(meta?{meta}:{}),migrations:{...migrations},recoveryCandidates:{...recoveryCandidates}};},
    async createMigration(record){if(migrations[record.deviceMigrationId])return window.PogoDomain.accountSyncModel.failure('account-sync/migration-exists','exists');migrations[record.deviceMigrationId]=record;return{ok:true,status:'created',value:record};},
    async createRecoveryCandidate(record){if(recoveryCandidates[record.candidateId])return window.PogoDomain.accountSyncModel.failure('account-sync/recovery-candidate-exists','exists');recoveryCandidates[record.candidateId]=record;return{ok:true,status:'created',value:record};},
    async updateMeta(patch){if(meta&&patch.initializedAt!==meta.initializedAt)return window.PogoDomain.accountSyncModel.failure('account-sync/meta-conflict','initializedAt changed');meta={...(meta||{}),...patch};return{ok:true,status:'updated',value:meta};}
  };
  return{repository,get meta(){return meta;},migrations,recoveryCandidates};
}

function createRuntime(window,h,repositoryState,journalState,readMigrationSources,onCanonicalEntities=()=>{},onState=()=>{},onPublicProjection=async()=>({ok:true}),options={}){
  const journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',journalState,h.clock);
  return window.PogoData.accountSyncRuntime.createAccountSyncRuntime({
    ownerUid:'uid-owner',username:'Owner',journal,repository:repositoryState.repository,enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],
    readMigrationSources,onCanonicalEntities,onState,onPublicProjection,clock:h.clock,crypto:webcrypto,...options
  });
}

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
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),repositoryState=runtimeRepository(window,h),states=[];
  const runtime=createRuntime(window,h,repositoryState,h.createMemoryJournalState(),async()=>source('device-runtime-candidate'),()=>{},state=>states.push(state));await runtime.start();
  await runtime.recordRecoveryCandidate({reason:'catalog-identity-unresolved',entityType:'tradeEntry',entityId:'unresolved:my-list:wishlist:unknown',identity:{surface:'my-list',lane:'wishlist',unresolved:true},values:{displayName:'Unknown'},source:'product-edit'});
  assert.equal(states.at(-1).state,'review-required');assert.equal(states.at(-1).recoveryCandidateCount,1);assert.equal(states.at(-1).migrationReady,true);
});

async function firstStateSnapshot(state){
  return{pendingCount:[...state.operations.values()].filter(record=>['pending','sending'].includes(record.status)).length};
}
