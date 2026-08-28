const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const root=path.join(__dirname,'..');
const files=[
  'js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js',
  'js/data/accountSyncController.js','js/testing/accountSyncHarness.js'
];
function load(){
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),navigator:{onLine:true}};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,queueMicrotask,structuredClone,console,setTimeout,clearTimeout});
  for(const file of files)vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window;
}
function identity(window,catalogId,lane='wishlist',surface='my-list'){
  const value={surface,lane,catalogId};return{entityType:'tradeEntry',entityId:window.PogoDomain.accountSyncModel.tradeEntryId(value),identity:value};
}
async function add(device,window,catalogId,values={},lane='wishlist',surface='my-list'){
  return device.controller.addEntity({...identity(window,catalogId,lane,surface),values:{priority:'H',variant:'',gender:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:'',sortOrder:0,quantity:1,note:'',mirror:false,...values}});
}
async function activeEntity(device,type='tradeEntry'){
  return device.controller.activeEntities(type)[0]||null;
}
async function persistedAddOperation(window,catalogId,operationId,clientAt=10){
  const model=window.PogoDomain.accountSyncModel,binding=identity(window,catalogId),patch={priority:'H',variant:'',gender:'',lucky:false,xxl:false,xxs:false,shiny:false,backgroundId:'',sortOrder:0,quantity:1,note:'',mirror:false};
  return(await model.createOperation({...binding,ownerUid:'uid-owner',kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(patch).map(field=>[field,0])),patch,clientAt,operationId})).value;
}

test('trade IDs bind surface, lane, and canonical catalog identity without mutable qualifiers',()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel;
  const a=model.tradeEntryId({surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'});
  const b=model.tradeEntryId({surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'});
  assert.equal(a,b);assert.notEqual(a,model.tradeEntryId({surface:'my-list',lane:'dynamax',catalogId:'pokemon:pikachu'}));
  assert.doesNotMatch(a,/Pikachu/);assert.throws(()=>model.tradeEntryId({surface:'my-list',lane:'bad',catalogId:'pokemon:pikachu'}));
});

test('operations are canonical-hash bound and reject altered fields or unsafe generations',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,id=identity(window,'pokemon:pikachu');
  const created=await model.createOperation({...id,ownerUid:'uid-owner',kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_0000000000000001'});
  assert.equal(created.ok,true);assert.equal((await model.verifyOperation(created.value)).ok,true);
  assert.equal((await model.verifyOperation({...created.value,patch:{priority:'L'}})).error.code,'account-sync/input-hash-mismatch');
  assert.equal((await model.createOperation({...id,ownerUid:'uid-owner',kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{},patch:{},clientAt:10,operationId:'op_0000000000000003'})).error.code,'account-sync/patch-empty');
  assert.equal((await model.createOperation({...id,ownerUid:'uid-owner',kind:'patch',baseGeneration:1,generation:2,baseFieldRevisions:{priority:0},patch:{priority:'L'},clientAt:10,operationId:'op_0000000000000002'})).error.code,'account-sync/generation-invalid');
});

test('active records survive RTDB null elision and tombstones require a deletion timestamp',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),device=h.createDevice('A');await device.start();
  const added=await add(device,window,'pokemon:pikachu');await h.settle();
  const entity=h.server.entities.get(`tradeEntry|${added.value.entityId}`),merge=window.PogoDomain.accountSyncMerge;
  assert.equal(Object.hasOwn(entity,'deletedAt'),false);
  assert.equal(merge.validateEntity(JSON.parse(JSON.stringify(entity)),{ownerUid:'uid-owner',entityType:'tradeEntry',entityId:added.value.entityId}).ok,true);
  await device.controller.deleteEntity({entityType:'tradeEntry',entityId:added.value.entityId});await h.settle();
  const tombstone=h.server.entities.get(`tradeEntry|${added.value.entityId}`);assert.equal(Number.isSafeInteger(tombstone.deletedAt),true);
  const malformed={...tombstone};delete malformed.deletedAt;
  assert.equal(merge.validateEntity(malformed,{ownerUid:'uid-owner',entityType:'tradeEntry',entityId:added.value.entityId}).ok,false);
});

test('adjacent lifecycle transitions preserve deleted values and restart re-added field metadata from the lifecycle mutation',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),device=h.createDevice('A');await device.start();
  const added=await add(device,window,'pokemon:lugia',{note:'keep'});await h.settle();const id=added.value.entityId,active=JSON.parse(JSON.stringify(h.server.entities.get(`tradeEntry|${id}`)));
  await device.controller.deleteEntity({entityType:'tradeEntry',entityId:id});await h.settle();const deleted=JSON.parse(JSON.stringify(h.server.entities.get(`tradeEntry|${id}`)));
  assert.equal(merge.validateTransition(active,deleted).ok,true);
  const rewrittenDelete=structuredClone(deleted);rewrittenDelete.values.note='rewritten';
  assert.equal(merge.validateEntity(rewrittenDelete,{ownerUid:'uid-owner',entityType:'tradeEntry',entityId:id}).ok,true);
  assert.equal(merge.validateTransition(active,rewrittenDelete).error.code,'account-sync/transition-delete-invalid');
  const reusedLifecycleHash=structuredClone(deleted);reusedLifecycleHash.lifecycleMutationHash=active.lifecycleMutationHash;
  assert.equal(merge.validateTransition(active,reusedLifecycleHash).error.code,'account-sync/transition-lifecycle-invalid');

  await add(device,window,'pokemon:lugia',{note:'returned'});await h.settle();const readded=JSON.parse(JSON.stringify(h.server.entities.get(`tradeEntry|${id}`))),noteToken=model.fieldToken('note');
  assert.equal(merge.validateTransition(deleted,readded).ok,true);
  const wrongRevision=structuredClone(readded);wrongRevision.fieldRevisions[noteToken]=2;
  assert.equal(merge.validateTransition(deleted,wrongRevision).error.code,'account-sync/transition-readd-invalid');
  const wrongMutation=structuredClone(readded);wrongMutation.fieldMutations[noteToken]=deleted.lifecycleMutation;
  assert.equal(merge.validateTransition(deleted,wrongMutation).error.code,'account-sync/transition-readd-invalid');
  const wrongHash=structuredClone(readded);wrongHash.fieldMutationHashes[noteToken]=deleted.lifecycleMutationHash;
  assert.equal(merge.validateTransition(deleted,wrongHash).error.code,'account-sync/transition-readd-invalid');
});

test('Device A and B offline additions converge without replacing either list',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false}),b=h.createDevice('B',{online:false});await a.start();await b.start();
  await add(a,window,'pokemon:pikachu');await add(b,window,'pokemon:rayquaza');
  await a.setOnline(true);await b.setOnline(true);await h.settle();
  assert.deepEqual([...h.server.entities.values()].filter(entity=>!entity.deleted).map(entity=>entity.identity.catalogId).sort(),['pokemon:pikachu','pokemon:rayquaza']);
});

test('same-field first server-accepted edit wins and losing value is recoverable conflict',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:pikachu');await h.settle();
  const id=added.value.entityId;a.online=false;b.online=false;
  await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'M'}});
  await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}});
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.priority,'M');
  const details=await b.controller.conflictDetails();assert.equal(details.length,1);assert.equal(details[0].fields[0].deviceValue,'L');assert.equal(details[0].fields[0].accountValue,'M');
  const reapplied=await b.controller.reapplyConflict(details[0].conflictId);await h.settle();assert.equal(reapplied.ok,true);assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.priority,'L');assert.equal((await b.journal.listConflicts()).length,0);assert.equal((await b.journal.listOperations({statuses:['resolved']})).length,1);
});

test('duplicate offline adds become a fieldless lifecycle conflict that can only accept the canonical item',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false}),b=h.createDevice('B',{online:false});await a.start();await b.start();
  const first=await add(a,window,'pokemon:wiglett',{priority:'L'}),second=await add(b,window,'pokemon:wiglett',{priority:'L'});assert.equal(first.value.entityId,second.value.entityId);
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  const details=await b.controller.conflictDetails();assert.equal(details.length,1);assert.equal(details[0].code,'lifecycle-conflict');assert.equal(details[0].fields.length,0);
  assert.equal((await b.controller.reapplyConflict(details[0].conflictId)).error.code,'account-sync/conflict-not-reapplicable');
  const accepted=await b.controller.acceptConflict(details[0].conflictId);
  assert.equal(accepted.ok,true);assert.equal(b.states.at(-1).state,'saved');await h.settle();
  assert.equal((await b.journal.snapshot()).conflictCount,0);assert.equal((await b.controller.snapshot()).state,'saved');
  assert.equal([...h.server.entities.values()].filter(entity=>!entity.deleted&&entity.identity.catalogId==='pokemon:wiglett').length,1);
});

test('one operation aggregates every same-field conflict and accepting account values removes its optimistic overlay',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:zekrom',{note:'initial'});await h.settle();
  const id=added.value.entityId;a.online=false;b.online=false;
  await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'M',note:'account'}});
  await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L',note:'device'}});
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  const details=await b.controller.conflictDetails();assert.equal(details.length,1);assert.deepEqual(Array.from(details[0].fields,field=>field.path).sort(),['note','priority']);
  assert.deepEqual(Array.from((await b.journal.listConflicts())[0].fields).sort(),['note','priority']);
  assert.equal((await b.controller.acceptConflict(details[0].conflictId)).ok,true);assert.equal((await b.journal.listOperations({statuses:['conflict']})).length,0);assert.equal((await b.journal.listOperations({statuses:['resolved']})).length,1);
  b.controller.deactivate();const reload=h.createDevice('B-reload',{state:b.state,online:false});await reload.start();const current=reload.controller.getEntity('tradeEntry',id);
  assert.equal(current.values.priority,'M');assert.equal(current.values.note,'account');
});

test('concurrent same-device mutations serialize against the latest optimistic field revision',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();const added=await add(a,window,'pokemon:suicune');await h.settle();const id=added.value.entityId;
  a.online=false;const [first,second]=await Promise.all([
    a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'M'}}),
    a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}})
  ]);
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(first.operation.baseFieldRevisions.priority,1);assert.equal(second.operation.baseFieldRevisions.priority,2);
  await a.setOnline(true);await h.settle();assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.priority,'L');assert.equal((await a.journal.listConflicts()).length,0);
});

test('acknowledging an earlier mutation preserves a later optimistic edit on the same entity',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false,releaseSecond,notifySecond;const secondStarted=new Promise(resolve=>{notifySecond=resolve;}),secondGate=new Promise(resolve=>{releaseSecond=resolve;}),original=h.server.applyOperation.bind(h.server);let calls=0;
  const repository={...h.server,ownerUid:'uid-owner',listenAccount({onData}){queueMicrotask(()=>onData(h.server.snapshot()));return()=>{};},async applyOperation(operation){calls++;if(calls===2){notifySecond();await secondGate;}return original(operation);}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,clock:h.clock,crypto:webcrypto});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const added=await controller.addEntity({...identity(window,'pokemon:entei'),values:{priority:'H'}});
  await controller.patchEntity({entityType:'tradeEntry',entityId:added.value.entityId,patch:{priority:'L'}});online=true;const draining=controller.drain();await secondStarted;
  assert.equal(controller.getEntity('tradeEntry',added.value.entityId).values.priority,'L');
  releaseSecond();await draining;assert.equal(h.server.entities.get(`tradeEntry|${added.value.entityId}`).values.priority,'L');
});

test('public projection contains only acknowledged canonical entities while later work stays optimistic',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),projections=[];
  let online=false,releaseSecond,notifySecond;const secondStarted=new Promise(resolve=>{notifySecond=resolve;}),secondGate=new Promise(resolve=>{releaseSecond=resolve;}),original=h.server.applyOperation.bind(h.server);let calls=0;
  const repository={...h.server,ownerUid:'uid-owner',listenAccount({onData}){queueMicrotask(()=>onData(h.server.snapshot()));return()=>{};},async applyOperation(operation){calls++;if(calls===2){notifySecond();await secondGate;}return original(operation);}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,clock:h.clock,crypto:webcrypto,onProjection:value=>projections.push(value)});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);await add({controller},window,'pokemon:pikachu');await add({controller},window,'pokemon:rayquaza');online=true;const draining=controller.drain();await secondStarted;
  assert.equal(controller.activeEntities('tradeEntry').length,2);assert.equal(projections.length,1);assert.deepEqual(Array.from(projections[0],entry=>entry.catalogId),['pokemon:pikachu']);assert.deepEqual(Array.from(controller.publicProjection(),entry=>entry.catalogId),['pokemon:pikachu']);
  releaseSecond();await draining;assert.deepEqual(Array.from(controller.publicProjection(),entry=>entry.catalogId).sort(),['pokemon:pikachu','pokemon:rayquaza']);
});

test('different-field concurrent edits merge while preserving both qualifiers',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:rayquaza');await h.settle();
  const id=added.value.entityId;a.online=false;b.online=false;
  await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{shiny:true}});
  await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{backgroundId:'nyc-2026'}});
  await a.setOnline(true);await b.setOnline(true);await h.settle();const entity=h.server.entities.get(`tradeEntry|${id}`);
  assert.equal(entity.values.shiny,true);assert.equal(entity.values.backgroundId,'nyc-2026');assert.equal((await b.journal.listConflicts()).length,0);
});

test('an already-converged field value is an idempotent no-op without revision churn',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();const added=await add(a,window,'pokemon:celebi');await h.settle();const id=added.value.entityId,before=h.server.entities.get(`tradeEntry|${id}`);
  const result=await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'H'}});await h.settle();const after=h.server.entities.get(`tradeEntry|${id}`);
  assert.equal(result.ok,true);assert.equal(after.revision,before.revision);assert.equal(after.fieldRevisions[window.PogoDomain.accountSyncModel.fieldToken('priority')],1);assert.equal((await a.journal.listConflicts()).length,0);
});

test('delete beats a stale edit and explicit re-add advances generation',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:mewtwo');await h.settle();const id=added.value.entityId;
  a.online=false;b.online=false;await a.controller.deleteEntity({entityType:'tradeEntry',entityId:id});await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}});
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();let entity=h.server.entities.get(`tradeEntry|${id}`);
  assert.equal(entity.deleted,true);assert.equal(entity.generation,2);assert.equal((await b.journal.listConflicts()).at(-1).code,'stale-generation');
  const readd=await a.controller.addEntity({...identity(window,'pokemon:mewtwo'),values:{priority:'H'}});await h.settle();entity=h.server.entities.get(`tradeEntry|${id}`);
  assert.equal(readd.ok,true);assert.equal(entity.deleted,false);assert.equal(entity.generation,3);assert.equal(entity.revision,3);
});

test('a stale delete cannot remove an explicitly re-added generation',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();
  const added=await add(a,window,'pokemon:giratina');await h.settle();const id=added.value.entityId;
  b.online=false;const staleDelete=await b.controller.deleteEntity({entityType:'tradeEntry',entityId:id});
  await a.controller.deleteEntity({entityType:'tradeEntry',entityId:id});await h.settle();
  await a.controller.addEntity({...identity(window,'pokemon:giratina'),values:{priority:'M'}});await h.settle();
  await b.setOnline(true);await h.settle();const current=h.server.entities.get(`tradeEntry|${id}`);
  assert.equal(current.deleted,false);assert.equal(current.generation,3);assert.equal(current.values.priority,'M');
  assert.equal(h.server.attempts.filter(value=>value===staleDelete.operation.operationId).length,1);
  assert.equal((await b.journal.listConflicts()).at(-1).code,'lifecycle-conflict');
});

test('favorite tag additions merge and deletion blocks stale tag resurrection',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();
  const favorite={entityType:'favorite',entityId:'uid-favorite',identity:{targetUid:'uid-favorite'}};
  await a.controller.addEntity({...favorite,values:{displayName:'Favorite Trainer'}});await h.settle();a.online=false;b.online=false;
  await a.controller.patchEntity({...favorite,patch:{'tagIds/tag_alpha':true}});await b.controller.patchEntity({...favorite,patch:{'tagIds/tag_beta':true}});
  await a.setOnline(true);await b.setOnline(true);await h.settle();let entity=h.server.entities.get('favorite|uid-favorite');
  assert.deepEqual(JSON.parse(JSON.stringify(entity.values.tagIds)),{tag_alpha:true,tag_beta:true});
  a.online=false;b.online=false;await a.controller.deleteEntity(favorite);await b.controller.patchEntity({...favorite,patch:{'tagIds/tag_stale':true}});await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  entity=h.server.entities.get('favorite|uid-favorite');assert.equal(entity.deleted,true);assert.equal(entity.values.tagIds.tag_stale,undefined);
});

test('seven-day stale device remains generation-safe and cannot overwrite newer canonical state',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:lugia');await h.settle();const id=added.value.entityId;
  b.online=false;await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}});await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'M'}});await h.settle();
  await b.setOnline(true);await h.settle();assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.priority,'M');assert.equal((await b.journal.listConflicts()).length,1);
});

test('response loss and duplicate delivery are idempotent and never double-increment revisions',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false});await a.start();const queued=await add(a,window,'pokemon:ho-oh');
  h.server.loseResponseOnce(queued.operation.operationId);await a.setOnline(true);assert.equal(h.server.entities.get(`tradeEntry|${queued.value.entityId}`).revision,1);
  h.advance(1000);await a.controller.drain();await h.settle();
  assert.equal(h.server.entities.get(`tradeEntry|${queued.value.entityId}`).revision,1);assert.equal(h.server.attempts.filter(id=>id===queued.operation.operationId).length,2);
});

test('permanent repository rejection blocks after one attempt instead of retrying as a network failure',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false});await a.start();const queued=await add(a,window,'pokemon:regice');
  h.server.failNext(Object.assign(new Error('permission denied'),{code:'PERMISSION_DENIED'}));await a.setOnline(true);
  const blocked=await a.journal.listOperations({statuses:['blocked']});assert.equal(blocked.length,1);assert.equal(blocked[0].attempts,1);assert.equal((await a.controller.snapshot()).state,'sync-error');
  h.advance(60_000);await a.controller.drain();assert.equal(h.server.attempts.filter(id=>id===queued.operation.operationId).length,1);assert.equal(h.server.entities.size,0);
});

test('blocked retry eligibility is exact, mixed unsafe evidence fails closed, and retained bytes do not change',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto});
  assert.deepEqual(Array.from(model.SAFE_BLOCKED_RETRY_CODES),['account-sync/committed-entity-invalid','account-sync/network-failed','account-sync/transaction-aborted']);
  for(const code of model.SAFE_BLOCKED_RETRY_CODES)assert.notEqual(model.blockedRetryCategory(code),'unsafe');
  for(const code of ['account-sync/owner-mismatch','account-sync/schema-version-invalid','account-sync/remote-entity-invalid','account-sync/blocked-operation'])assert.equal(model.blockedRetryCategory(code),'unsafe');

  const safeState=h.createMemoryJournalState(),safe=h.createDevice('safe',{state:safeState,online:false});await safe.start();
  for(const [index,code] of model.SAFE_BLOCKED_RETRY_CODES.entries()){
    const queued=await add(safe,window,`pokemon:safe-${index}`),record=safeState.operations.get(queued.operation.operationId);
    Object.assign(record,{status:'blocked',attempts:6,lastErrorCode:code,nextAttemptAt:999999});
  }
  const safeBefore=await safe.controller.snapshot();assert.equal(safeBefore.recoverableBlockedCount,3);assert.equal(safeBefore.unsafeBlockedCount,0);
  assert.deepEqual(Array.from(safeBefore.blockedCategories),['historical-acknowledgement','transient-transport']);
  await safe.setOnline(true);const attemptsBefore=h.server.attempts.length;
  const safeResult=await safe.controller.retryBlocked();assert.equal(safeResult.ok,true);assert.equal(safeResult.retried,3);
  assert.equal(h.server.attempts.length-attemptsBefore,3);assert.equal((await safe.journal.listOperations({statuses:['acknowledged']})).length,3);assert.equal((await safe.journal.listOperations({statuses:['blocked']})).length,0);

  const mixedState=h.createMemoryJournalState(),mixed=h.createDevice('mixed',{state:mixedState,online:false});await mixed.start();
  const recoverable=await add(mixed,window,'pokemon:recoverable'),unsafeA=await add(mixed,window,'pokemon:unsafe-a'),unsafeB=await add(mixed,window,'pokemon:unsafe-b');
  Object.assign(mixedState.operations.get(recoverable.operation.operationId),{status:'blocked',attempts:6,lastErrorCode:'account-sync/network-failed',nextAttemptAt:111});
  Object.assign(mixedState.operations.get(unsafeA.operation.operationId),{status:'blocked',attempts:1,lastErrorCode:'account-sync/owner-mismatch',nextAttemptAt:222});
  Object.assign(mixedState.operations.get(unsafeB.operation.operationId),{status:'blocked',attempts:1,lastErrorCode:'account-sync/schema-version-invalid',nextAttemptAt:333});
  const before=JSON.stringify([...mixedState.operations.values()]),mixedSnapshot=await mixed.controller.snapshot(),mixedResult=await mixed.controller.retryBlocked(),after=JSON.stringify([...mixedState.operations.values()]);
  assert.equal(mixedSnapshot.recoverableBlockedCount,1);assert.equal(mixedSnapshot.unsafeBlockedCount,2);assert.equal(mixedSnapshot.state,'sync-error');
  assert.deepEqual(Array.from(mixedSnapshot.blockedCategories),['transient-transport','unsafe']);assert.equal(mixedResult.ok,false);assert.equal(mixedResult.error.code,'account-sync/retry-unsafe');assert.equal(after,before);
});

test('same-field conflicts remain recoverable evidence and cannot be retried as transient failures',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');
  await a.start();await b.start();const added=await add(a,window,'pokemon:lugia');await h.settle();const id=added.value.entityId;
  a.online=false;b.online=false;
  const first=await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'M'}});
  const losing=await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}});
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  assert.equal((await b.journal.listOperations({statuses:['conflict']})).length,1);
  const retried=await b.controller.retry(losing.operation.operationId);
  assert.equal(retried.ok,false);assert.equal(retried.error.code,'account-sync/retry-not-available');
  assert.equal(await b.journal.retryBlocked(losing.operation.operationId),false);
  assert.equal(h.server.attempts.filter(value=>value===losing.operation.operationId).length,1);
  assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.priority,'M');
  assert.equal(first.ok,true);
});

test('a malformed canonical owner snapshot fails closed without replacing the last valid state',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();
  const added=await add(a,window,'pokemon:palkia');await h.settle();
  const before=a.controller.getEntity('tradeEntry',added.value.entityId),malformed=JSON.parse(JSON.stringify(before));
  malformed.values.priority='not-a-priority';
  await assert.rejects(a.controller.acceptRemote({tradeEntries:{[malformed.entityId]:malformed}}),error=>error.code==='account-sync/remote-entity-invalid');
  assert.equal(a.controller.getEntity('tradeEntry',added.value.entityId).values.priority,'H');
  await a.controller.acceptRemote(h.server.snapshot());
  assert.equal(a.controller.getEntity('tradeEntry',added.value.entityId).values.priority,'H');
});

test('same-revision timestamp substitution remains fail closed at the canonical listener boundary',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();
  const added=await add(a,window,'pokemon:wiglett');await h.settle();const id=added.value.entityId,before=JSON.parse(JSON.stringify(a.controller.getEntity('tradeEntry',id))),substituted=structuredClone(before);
  substituted.createdAt++;substituted.updatedAt++;
  await assert.rejects(a.controller.acceptRemote({tradeEntries:{[id]:substituted}}),error=>error.code==='account-sync/remote-version-substitution');
  assert.equal(window.PogoDomain.accountSyncModel.canonicalJson(a.controller.getEntity('tradeEntry',id)),window.PogoDomain.accountSyncModel.canonicalJson(before));
});

test('an adjacent shape-valid but semantically invalid canonical transition is rejected without replacing accepted state',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();
  const added=await add(a,window,'pokemon:giratina');await h.settle();const id=added.value.entityId,before=JSON.parse(JSON.stringify(a.controller.getEntity('tradeEntry',id))),malformed=structuredClone(before);
  malformed.revision++;malformed.updatedAt++;malformed.values.priority='M';
  await assert.rejects(a.controller.acceptRemote({tradeEntries:{[id]:malformed}}),error=>error.code==='account-sync/transition-field-invalid');
  assert.equal(a.controller.getEntity('tradeEntry',id).values.priority,'H');
  assert.equal((await a.journal.getEntity('tradeEntry',id)).values.priority,'H');
});

test('canonical collection keys must exactly bind the enclosed entity ID',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();
  const added=await add(a,window,'pokemon:palkia');await h.settle();const entity=h.server.entities.get(`tradeEntry|${added.value.entityId}`);
  await assert.rejects(a.controller.acceptRemote({tradeEntries:{wrong_entity_key:entity}}),error=>error.code==='account-sync/remote-entity-invalid');
  assert.equal(a.controller.getEntity('tradeEntry',added.value.entityId).values.priority,'H');
});

test('canonical account snapshots reject unknown top-level collections',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();
  await assert.rejects(a.controller.acceptRemote({tradeEntries:{},unexpected:{value:true}}),error=>error.code==='account-sync/remote-entity-invalid');
  assert.equal(a.controller.activeEntities().length,0);
});

test('a rejected operation persists the exact server value before exposing or accepting its conflict',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),source=h.createDevice('source');await source.start();
  const added=await add(source,window,'pokemon:virizion');await h.settle();const id=added.value.entityId,base=h.server.entities.get(`tradeEntry|${id}`),priorityToken=model.fieldToken('priority');
  const accountOperation=await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId:id,kind:'patch',patch:{priority:'M'},baseGeneration:base.generation,generation:base.generation,baseFieldRevisions:{priority:base.fieldRevisions[priorityToken]},clientAt:20_000,operationId:'op_conflict_server_0001'},{crypto:webcrypto});
  const accountValue=merge.mergeOperation(base,accountOperation.value,{acceptedAt:20_001}).value,state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false,listenerHandlers=null;
  const repository=Object.freeze({ownerUid:'uid-owner',listenAccount(handlers){listenerHandlers=handlers;return()=>{};},async applyOperation(operation){const result=merge.mergeOperation(accountValue,operation,{acceptedAt:20_002});return{ok:false,status:'conflict',error:result.error,conflicts:result.conflicts,current:accountValue};}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,crypto:webcrypto,clock:h.clock});
  await controller.activate();listenerHandlers.onData({tradeEntries:{[id]:base}});assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const losing=await controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{priority:'L'}});online=true;await controller.drain();
  const details=await controller.conflictDetails();assert.equal(details.length,1);assert.equal(details[0].fields[0].deviceValue,'L');assert.equal(details[0].fields[0].accountValue,'M');
  assert.equal(controller.getEntity('tradeEntry',id).values.priority,'M');assert.equal((await journal.getEntity('tradeEntry',id)).values.priority,'M');
  assert.equal((await controller.acceptConflict(details[0].conflictId)).ok,true);assert.equal(controller.getEntity('tradeEntry',id).values.priority,'M');
  assert.equal((await journal.listOperations({statuses:['resolved']}))[0].operationId,losing.operation.operationId);
});

test('listener attachment alone is pending, blocks product mutation, and becomes healthy only after accepted canonical data',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);let handlers=null;
  const repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;return()=>{};},async applyOperation(){throw new Error('must not dispatch while listener is pending');}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  await controller.activate();const attached=await controller.snapshot();
  assert.equal(attached.listenerState,'listening');assert.equal(attached.listenerHealthy,false);assert.equal(attached.controllerHealthy,false);assert.equal(attached.state,'pending-sync');
  const mutation=await controller.addEntity({...identity(window,'pokemon:pending-listener'),values:{priority:'H'}});assert.equal(mutation.ok,false);assert.equal(mutation.error.code,'account-sync/listener-not-ready');assert.equal(state.operations.size,0);
  const ready=controller.waitForListenerReady({timeoutMs:1000});handlers.onData({});assert.equal((await ready).ok,true);const accepted=await controller.snapshot();assert.equal(accepted.listenerState,'healthy');assert.equal(accepted.listenerHealthy,true);assert.equal(accepted.controllerHealthy,true);assert.equal(accepted.state,'saved');
});

test('persisted pending and sending operations remain byte-identical until a current listener snapshot grants authority',async()=>{
  const window=load(),merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  const pending=await persistedAddOperation(window,'pokemon:pending-proof','op_0000000000007201'),sending=await persistedAddOperation(window,'pokemon:sending-proof','op_0000000000007202');
  await journal.enqueueOperations([pending,sending]);state.operations.get(sending.operationId).status='sending';
  let handlers=null,applyCalls=0;const canonical=new Map(),repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;return()=>{};},async applyOperation(operation){applyCalls++;const entity=merge.mergeOperation(canonical.get(operation.entityId)||null,operation,{acceptedAt:100+applyCalls}).value;canonical.set(operation.entityId,entity);return{ok:true,status:'applied',value:entity};}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  const before=JSON.stringify([...state.operations.values()]);await controller.activate();await controller.drain();
  assert.equal(applyCalls,0);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await controller.snapshot()).listenerState,'listening');
  const ready=controller.waitForListenerReady({timeoutMs:1000});handlers.onData({});assert.equal((await ready).ok,true);await controller.drain();
  assert.equal(applyCalls,2);assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,2);assert.deepEqual([...canonical.keys()].sort(),[pending.entityId,sending.entityId].sort());
});

test('listener timeout leaves a persisted operation byte-identical and makes no repository call',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),operation=await persistedAddOperation(window,'pokemon:timeout-proof','op_0000000000007208');await journal.enqueueOperation(operation);
  let applyCalls=0;const repository={ownerUid:'uid-owner',listenAccount(){return()=>{};},async applyOperation(){applyCalls++;throw new Error('must not dispatch without listener authority');}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  const before=JSON.stringify([...state.operations.values()]);await controller.activate();const ready=await controller.waitForListenerReady({timeoutMs:5});await controller.drain();
  assert.equal(ready.ok,false);assert.equal(ready.error.code,'account-sync/listener-timeout');assert.equal(applyCalls,0);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await controller.snapshot()).listenerState,'failed');
});

test('listener error and late prior-epoch callbacks cannot mutate or arm a replacement session',async()=>{
  const window=load(),merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),operation=await persistedAddOperation(window,'pokemon:epoch-proof','op_0000000000007203');await journal.enqueueOperation(operation);
  const listeners=[];let applyCalls=0;const repository={ownerUid:'uid-owner',listenAccount(value){listeners.push(value);return()=>{};},async applyOperation(value){applyCalls++;return{ok:true,status:'applied',value:merge.mergeOperation(null,value,{acceptedAt:200}).value};}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  const before=JSON.stringify([...state.operations.values()]);await controller.activate();listeners[0].onError(new Error('private listener detail'));await Promise.resolve();await controller.drain();
  assert.equal(applyCalls,0);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await controller.snapshot()).listenerState,'failed');
  await controller.deactivate();await controller.activate();listeners[0].onData({});await Promise.resolve();await controller.drain();
  assert.equal(applyCalls,0);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await controller.snapshot()).listenerState,'listening');
  const ready=controller.waitForListenerReady({timeoutMs:1000});listeners[1].onData({});assert.equal((await ready).ok,true);await controller.drain();assert.equal(applyCalls,1);assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,1);
});

test('listener authority loss during a multi-operation drain preserves ambiguous evidence and prevents the next call',async()=>{
  const window=load(),merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),first=await persistedAddOperation(window,'pokemon:mid-drain-a','op_0000000000007204'),second=await persistedAddOperation(window,'pokemon:mid-drain-b','op_0000000000007205');await journal.enqueueOperations([first,second]);
  let handlers=null,applyCalls=0;const repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;return()=>{};},async applyOperation(operation){applyCalls++;handlers.onError(new Error('listener lost'));return{ok:true,status:'applied',value:merge.mergeOperation(null,operation,{acceptedAt:300}).value};}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  await controller.activate();const ready=controller.waitForListenerReady({timeoutMs:1000});handlers.onData({});assert.equal((await ready).ok,true);const before=JSON.stringify([...state.operations.values()]);await controller.drain();
  assert.equal(applyCalls,1);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await controller.snapshot()).listenerState,'failed');assert.equal((await journal.snapshot()).pendingCount,2);
});

test('an invalid listener callback cannot mint authority from a matching idempotent response',async()=>{
  const window=load(),merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),operation=await persistedAddOperation(window,'pokemon:invalid-listener-idempotent','op_0000000000007207'),canonical=merge.mergeOperation(null,operation,{acceptedAt:350}).value;
  await journal.enqueueOperation(operation);await journal.markAttempt(operation.operationId,{retryable:false,errorCode:'account-sync/network-failed'});
  let handlers=null,applyCalls=0;const repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;return()=>{};},async applyOperation(){applyCalls++;handlers.onData({unexpected:{private:'invalid'}});return{ok:true,status:'idempotent',value:canonical};}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  await controller.activate();const ready=controller.waitForListenerReady({timeoutMs:1000});handlers.onData({tradeEntries:{[canonical.entityId]:canonical}});assert.equal((await ready).ok,true);
  const before=JSON.stringify([...state.operations.values()]),result=await controller.retryBlocked();await Promise.resolve();
  assert.equal(result.ok,false);assert.equal(result.error.code,'account-sync/listener-authority-lost');assert.equal(result.retried,1);assert.equal(applyCalls,1);assert.equal(JSON.stringify([...state.operations.values()]),before);assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,0);assert.equal((await controller.snapshot()).listenerState,'failed');
});

test('a stale pre-write listener snapshot cannot manufacture remote-entity-missing after dispatch',async()=>{
  const window=load(),merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);let online=false,handlers=null,applyCalls=0,canonical=null,releaseSecond,secondStarted;const secondGate=new Promise(resolve=>{releaseSecond=resolve;}),started=new Promise(resolve=>{secondStarted=resolve;});
  const repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;queueMicrotask(()=>handlers.onData({}));return()=>{};},async applyOperation(operation){applyCalls++;canonical=canonical||merge.mergeOperation(null,operation,{acceptedAt:400}).value;if(applyCalls===1)handlers.onData({});else{secondStarted();await secondGate;handlers.onData({tradeEntries:{[canonical.entityId]:canonical}});}return{ok:true,status:applyCalls===1?'applied':'idempotent',value:canonical};}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,clock:h.clock,crypto:webcrypto});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const queued=await controller.addEntity({...identity(window,'pokemon:stale-listener-proof'),values:{priority:'H'}});online=true;const draining=controller.drain();await started;
  assert.equal((await journal.listOperations({statuses:['pending']}))[0].operationId,queued.operation.operationId);assert.notEqual((await controller.snapshot()).lastError,'account-sync/remote-entity-missing');
  releaseSecond();await draining;await controller.drain();assert.equal(applyCalls,2);assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,1);assert.notEqual((await controller.snapshot()).lastError,'account-sync/remote-entity-missing');
});

test('one retained retry action makes one deduplicated call and a failed call remains blocked without backoff',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),operation=await persistedAddOperation(window,'pokemon:manual-once','op_0000000000007206');await journal.enqueueOperation(operation);await journal.markAttempt(operation.operationId,{retryable:false,errorCode:'account-sync/network-failed'});
  let handlers=null,applyCalls=0,releaseCall,callStarted;const gate=new Promise(resolve=>{releaseCall=resolve;}),started=new Promise(resolve=>{callStarted=resolve;}),repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;queueMicrotask(()=>handlers.onData({}));return()=>{};},async applyOperation(){applyCalls++;callStarted();await gate;throw Object.assign(new Error('network unavailable'),{code:'account-sync/network-failed'});}};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);
  const first=controller.retryBlocked(),second=controller.retryBlocked();assert.equal(first,second);await started;releaseCall();const result=await first,retained=(await journal.listOperations({statuses:['blocked']}))[0];
  assert.equal(result.ok,false);assert.equal(result.retried,1);assert.equal(applyCalls,1);assert.equal(retained.operationId,operation.operationId);assert.equal(retained.attempts,2);assert.equal(retained.lastErrorCode,'account-sync/network-failed');
  h.advance(60_000);await controller.drain();assert.equal(applyCalls,1);const emptyState=h.createMemoryJournalState(),emptyJournal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',emptyState,h.clock),empty=window.PogoData.accountSyncController.createAccountSyncController({journal:emptyJournal,repository:{...repository,ownerUid:'uid-owner'},ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});await empty.activate();await Promise.resolve();const noEligible=await empty.retryBlocked();assert.equal(noEligible.ok,false);assert.equal(noEligible.error.code,'account-sync/retry-empty');assert.equal(applyCalls,1);
});

test('pre-.70 estimated acknowledgement is preserved on substitution and a fresh controller hydrates the authoritative timestamp without mutation',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);let handlers=null,applyCalls=0;
  const repository={ownerUid:'uid-owner',listenAccount(value){handlers=value;queueMicrotask(()=>value.onData({}));return()=>{};},async applyOperation(operation){applyCalls++;return{ok:true,status:'applied',value:merge.mergeOperation(null,operation,{acceptedAt:69_001}).value};}};
  const first=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});await first.activate();await first.waitForListenerReady({timeoutMs:1000});
  const queued=await add({controller:first},window,'pokemon:wiglett');await first.drain();const estimated=structuredClone(first.getEntity('tradeEntry',queued.value.entityId)),actual=structuredClone(estimated);actual.createdAt+=500;actual.updatedAt+=500;
  assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,1);handlers.onData({tradeEntries:{[actual.entityId]:actual}});await new Promise(resolve=>setTimeout(resolve,0));
  const failed=await first.snapshot();assert.equal(failed.lastError,'account-sync/remote-version-substitution');assert.equal(failed.lastErrorCategory,'unsafe-evidence');assert.equal(failed.state,'sync-error');assert.equal(model.canonicalJson(first.getEntity('tradeEntry',actual.entityId)),model.canonicalJson(estimated));assert.equal((await journal.listOperations({statuses:['acknowledged']})).length,1);
  await first.deactivate();

  let freshHandlers=null;const freshRepository={ownerUid:'uid-owner',listenAccount(value){freshHandlers=value;return()=>{};},async applyOperation(){throw new Error('fresh hydration must not mutate');}};
  const fresh=window.PogoData.accountSyncController.createAccountSyncController({journal,repository:freshRepository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});await fresh.activate();const ready=fresh.waitForListenerReady({timeoutMs:1000});freshHandlers.onData({tradeEntries:{[actual.entityId]:actual}});assert.equal((await ready).ok,true);
  assert.equal(model.canonicalJson(fresh.getEntity('tradeEntry',actual.entityId)),model.canonicalJson(actual));assert.equal((await fresh.snapshot()).state,'saved');assert.equal(applyCalls,1);
});

test('a conflict response missing its canonical current value fails closed',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false,listenerHandlers=null;const repository=Object.freeze({ownerUid:'uid-owner',listenAccount(handlers){listenerHandlers=handlers;return()=>{};},async applyOperation(){return{ok:false,status:'conflict',conflicts:['priority']};}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,crypto:webcrypto,clock:h.clock});
  await controller.activate();const ready=controller.waitForListenerReady({timeoutMs:1000});listenerHandlers.onData({});assert.equal((await ready).ok,true);const queued=await controller.addEntity({...identity(window,'pokemon:terrakion'),values:{priority:'H'}});online=true;await controller.drain();
  assert.equal((await journal.listConflicts()).length,0);assert.equal((await journal.listOperations({statuses:['pending']})).length,0);
  assert.equal((await journal.listOperations({statuses:['blocked']})).length,1);assert.equal((await controller.snapshot()).lastError,'account-sync/conflict-current-invalid');assert.equal(queued.ok,true);
});

test('remote snapshots apply in listener order even when older journal persistence is delayed',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge;
  const h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),source=h.createDevice('source');await source.start();
  const added=await add(source,window,'pokemon:dialga');await h.settle();
  const first=h.server.entities.get(`tradeEntry|${added.value.entityId}`),priorityToken=model.fieldToken('priority');
  const operation=await model.createOperation({
    ownerUid:'uid-owner',entityType:'tradeEntry',entityId:first.entityId,identity:first.identity,kind:'patch',patch:{priority:'M'},
    baseGeneration:first.generation,generation:first.generation,baseFieldRevisions:{priority:first.fieldRevisions[priorityToken]},clientAt:20_000,operationId:'op_snapshot_order_0001'
  },{crypto:webcrypto});
  assert.equal(operation.ok,true);
  const merged=merge.mergeOperation(first,operation.value,{acceptedAt:20_001});assert.equal(merged.ok,true);

  const state=h.createMemoryJournalState(),baseJournal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let releaseFirstWrite,putCount=0;const firstWriteGate=new Promise(resolve=>{releaseFirstWrite=resolve;});
  const journal=Object.freeze({...baseJournal,async putEntity(entity){putCount++;if(putCount===1)await firstWriteGate;return baseJournal.putEntity(entity);}});
  const repository=Object.freeze({ownerUid:'uid-owner',listenAccount(){return()=>{};},async applyOperation(){throw new Error('not used');}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>false,crypto:webcrypto,clock:h.clock});
  await controller.activate();
  const older=controller.acceptRemote({tradeEntries:{[first.entityId]:first}});await Promise.resolve();
  const newer=controller.acceptRemote({tradeEntries:{[merged.value.entityId]:merged.value}});await Promise.resolve();
  assert.equal(controller.getEntity('tradeEntry',first.entityId),null);
  releaseFirstWrite();await Promise.all([older,newer]);
  assert.equal(controller.getEntity('tradeEntry',first.entityId).values.priority,'M');
  assert.equal((await baseJournal.getEntity('tradeEntry',first.entityId)).values.priority,'M');
});

test('late older snapshots cannot roll accepted canonical state backward and missing canonical entities fail closed',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),source=h.createDevice('source');await source.start();
  const added=await add(source,window,'pokemon:cobalion');await h.settle();const id=added.value.entityId,older=h.server.entities.get(`tradeEntry|${id}`),priorityToken=model.fieldToken('priority');
  const operation=await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId:id,kind:'patch',patch:{priority:'M'},baseGeneration:older.generation,generation:older.generation,baseFieldRevisions:{priority:older.fieldRevisions[priorityToken]},clientAt:30_000,operationId:'op_snapshot_late_0001'},{crypto:webcrypto});
  const newer=merge.mergeOperation(older,operation.value,{acceptedAt:30_001}).value,state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),repository=Object.freeze({ownerUid:'uid-owner',listenAccount(){return()=>{};},async applyOperation(){throw new Error('not used');}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>false,crypto:webcrypto,clock:h.clock});await controller.activate();
  await controller.acceptRemote({tradeEntries:{[id]:newer}});await controller.acceptRemote({tradeEntries:{[id]:older}});
  await assert.rejects(controller.acceptRemote({tradeEntries:{}}),error=>error.code==='account-sync/remote-entity-missing');
  assert.equal(controller.getEntity('tradeEntry',id).values.priority,'M');assert.equal((await journal.getEntity('tradeEntry',id)).values.priority,'M');
});

test('background is an independently mergeable field but concurrent background edits conflict',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');
  await a.start();await b.start();const added=await add(a,window,'pokemon:rayquaza',{backgroundId:'new-york-city'});await h.settle();
  const id=added.value.entityId;a.online=false;b.online=false;
  await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{backgroundId:'osaka'}});
  await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{backgroundId:'london'}});
  await a.setOnline(true);await h.settle();await b.setOnline(true);await h.settle();
  assert.equal(h.server.entities.get(`tradeEntry|${id}`).values.backgroundId,'osaka');
  assert.deepEqual(Array.from((await b.journal.listConflicts())[0].fields),['backgroundId']);
});

test('out-of-order operations preserve independent fields and surface stale same-field edits',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A'),b=h.createDevice('B');await a.start();await b.start();const added=await add(a,window,'pokemon:groudon');await h.settle();const id=added.value.entityId;
  a.online=false;b.online=false;await a.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{note:'from A'}});await b.controller.patchEntity({entityType:'tradeEntry',entityId:id,patch:{mirror:true}});
  await b.setOnline(true);await h.settle();await a.setOnline(true);await h.settle();const entity=h.server.entities.get(`tradeEntry|${id}`);assert.equal(entity.values.note,'from A');assert.equal(entity.values.mirror,true);
});

test('journal state survives reload and account partitions never cross',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),a=h.createDevice('A',{state,online:false});await a.start();await add(a,window,'pokemon:zekrom');a.controller.deactivate();
  const reload=h.createDevice('A-reload',{state,online:false});await reload.start();assert.equal((await reload.journal.snapshot()).pendingCount,1);assert.equal(reload.controller.activeEntities('tradeEntry').length,1);
  const other=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-other',window.PogoTesting.accountSyncHarness.createMemoryJournalState());assert.equal((await other.snapshot()).entityCount,0);
});

test('preserved recovery candidates require review and cannot present as saved',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  await journal.putRecoveryCandidate({ownerUid:'uid-owner',candidateId:'recovery_candidate_0001',reason:'stale-device-cache'});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,crypto:webcrypto,clock:h.clock});
  const snapshot=await controller.snapshot();
  assert.equal(snapshot.recoveryCandidateCount,1);assert.equal(snapshot.state,'review-required');assert.notEqual(snapshot.state,'saved');
});

test('auth detach preserves the owner journal and reattach resumes only that account',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false});await a.start();
  const queued=await add(a,window,'pokemon:reshiram');await a.detachAuth();
  assert.equal((await a.journal.snapshot()).pendingCount,1);assert.equal(h.server.entities.size,0);
  a.online=true;await a.reattachAuth();await h.settle();
  assert.equal(h.server.entities.get(`tradeEntry|${queued.value.entityId}`).identity.catalogId,'pokemon:reshiram');
  assert.equal((await a.journal.snapshot()).pendingCount,0);
});

test('journal persistence failure leaves the current UI entity set unchanged',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState();
  const journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),original=journal.enqueueOperations;
  const failingJournal=Object.freeze({...journal,async enqueueOperations(){throw Object.assign(new Error('quota'),{code:'indexeddb/quota'});}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal:failingJournal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>false,crypto:webcrypto,clock:h.clock});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const result=await controller.addEntity({...identity(window,'pokemon:latios'),values:{priority:'H'}});
  assert.equal(result.ok,false);assert.equal(result.error.code,'account-sync/journal-write-failed');assert.equal(controller.activeEntities().length,0);assert.equal(state.operations.size,0);assert.equal(typeof original,'function');
});

test('multi-entity product actions journal atomically before any optimistic state is exposed',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState();
  const journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock),failingJournal=Object.freeze({...journal,async enqueueOperations(operations){
    assert.equal(operations.length,2);throw Object.assign(new Error('quota'),{code:'indexeddb/quota'});
  }});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal:failingJournal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>false,crypto:webcrypto,clock:h.clock});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);
  const first=identity(window,'pokemon:latias'),second=identity(window,'pokemon:latios');
  const result=await controller.mutateBatch([
    {entityType:first.entityType,entityId:first.entityId,identity:first.identity,kind:'add',patch:{priority:'H'}},
    {entityType:second.entityType,entityId:second.entityId,identity:second.identity,kind:'add',patch:{priority:'M'}}
  ]);
  assert.equal(result.ok,false);assert.equal(result.error.code,'account-sync/journal-write-failed');
  assert.equal(controller.activeEntities().length,0);assert.equal(state.operations.size,0);assert.equal(state.entities.size,0);
});

test('an explicit drain joins an in-flight drain and includes work queued while it is running',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false});await a.start();
  const first=await add(a,window,'pokemon:entei'),secondIdentity=identity(window,'pokemon:raikou');
  let releaseFirst;const blocked=new Promise(resolve=>{releaseFirst=resolve;}),original=h.server.applyOperation.bind(h.server),attempted=[];
  h.server.applyOperation=async operation=>{attempted.push(operation.operationId);if(attempted.length===1)await blocked;return original(operation);};
  a.online=true;const firstDrain=a.controller.drain();
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=await a.controller.addEntity({...secondIdentity,values:{priority:'M'}}),joined=a.controller.drain();
  releaseFirst();await Promise.all([firstDrain,joined]);
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(attempted.length,2);
  assert.equal(h.server.entities.size,2);assert.equal((await a.journal.snapshot()).pendingCount,0);
});

test('work queued after a drain observes an empty journal requests one final authorized pass',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),baseJournal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false,nextCalls=0,releaseEmpty,notifyEmpty;const emptyGate=new Promise(resolve=>{releaseEmpty=resolve;}),emptyObserved=new Promise(resolve=>{notifyEmpty=resolve;});
  const journal=Object.freeze({...baseJournal,async nextOperation(options){const record=await baseJournal.nextOperation(options);if(++nextCalls===2&&!record){notifyEmpty();await emptyGate;}return record;}});
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,clock:h.clock,crypto:webcrypto});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);
  const first=await controller.addEntity({...identity(window,'pokemon:drain-final-a'),values:{priority:'H'}});online=true;const draining=controller.drain();await emptyObserved;
  const second=await controller.addEntity({...identity(window,'pokemon:drain-final-b'),values:{priority:'M'}});releaseEmpty();await draining;await controller.drain();
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(h.server.entities.size,2);assert.equal((await journal.snapshot()).pendingCount,0);assert.equal(h.server.attempts.length,2);
});

test('auth deactivation joins an in-flight dispatch and suppresses old-session publication',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false,releaseDispatch,dispatchStarted;const started=new Promise(resolve=>{dispatchStarted=resolve;}),gate=new Promise(resolve=>{releaseDispatch=resolve;}),original=h.server.applyOperation.bind(h.server),projections=[];
  h.server.applyOperation=async operation=>{dispatchStarted();await gate;return original(operation);};
  const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,crypto:webcrypto,clock:h.clock,onProjection:value=>projections.push(value)});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const queued=await controller.addEntity({...identity(window,'pokemon:suicune'),values:{priority:'H'}});online=true;
  const draining=controller.drain();await started;const stopping=controller.deactivate();releaseDispatch();await Promise.all([draining,stopping]);
  assert.equal(h.server.entities.get(`tradeEntry|${queued.value.entityId}`).deleted,false);
  assert.equal((await journal.snapshot()).pendingCount,1);assert.equal((await journal.listOperations({statuses:['pending']}))[0].operationId,queued.operation.operationId);assert.equal(projections.length,0);assert.equal((await controller.snapshot()).active,false);
});

test('private canonical acknowledgement gates public projection and publication failure never rolls it back',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A',{online:false});await a.start();
  const queued=await add(a,window,'pokemon:kyurem');assert.equal(a.projections.length,0);
  await a.setOnline(true);await h.settle();assert.equal(a.projections.length,1);assert.equal(a.projections[0][0].entryId,queued.value.entityId);
  const state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let online=false;const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository:h.server,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>online,crypto:webcrypto,clock:h.clock,onProjection:async()=>{throw Object.assign(new Error('publication unavailable'),{code:'public-share/unavailable'});}});
  await controller.activate();assert.equal((await controller.waitForListenerReady({timeoutMs:1000})).ok,true);const second=await controller.addEntity({...identity(window,'pokemon:zekrom'),values:{priority:'M'}});online=true;await controller.drain();
  assert.equal(second.ok,true);assert.equal(h.server.entities.get(`tradeEntry|${second.value.entityId}`).deleted,false);
  assert.equal((await controller.snapshot()).lastProjectionError,'public-share/unavailable');
});

test('public projection contains only active product values and no journal metadata',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),a=h.createDevice('A');await a.start();await add(a,window,'pokemon:kyogre',{backgroundId:'osaka-2026'});await h.settle();const projection=a.controller.publicProjection();
  assert.equal(projection.length,1);assert.equal(projection[0].backgroundId,'osaka-2026');
  for(const forbidden of ['ownerUid','revision','fieldRevisions','fieldMutations','fieldMutationHashes','lifecycleMutation','inputHash','deleted'])assert.equal(forbidden in projection[0],false,forbidden);
});

test('migration unions safe records, replays known queue intent, and quarantines stale-device cache',async()=>{
  const window=load(),migration=window.PogoDomain.accountSyncMigration,parse=value=>({priority:String(value||'').charAt(0)}),catalog=(_type,name)=>({catalogId:`pokemon:${name.toLowerCase()}`});
  const initial=await migration.buildMigrationPlan({ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-a',legacyRemoteLists:{wishlist:{Pikachu:'H',Eevee:'L'}},legacyLocalLists:{wishlist:{Pikachu:'H',Rayquaza:'M'}},legacyQueue:{queued:{kind:'my-list-update',path:'wishlist/Owner',data:{Pikachu:'M',Eevee:null}}},favorites:[{displayName:'Friend',tagIds:['old']}],tags:{old:{label:'Raid'}},canonicalInitialized:false},{parseListValue:parse,catalogIdentity:catalog,resolveFavoriteUid:async()=> 'uid-friend'});
  assert.deepEqual(JSON.parse(JSON.stringify(initial.tradeSeeds.map(item=>item.legacyName).sort())),['Pikachu','Rayquaza']);assert.equal(initial.favoriteSeeds[0].entityId,'uid-friend');assert.equal(initial.sourceDeletionAllowed,false);
  assert.equal(initial.tradeSeeds.find(item=>item.legacyName==='Pikachu').values.priority,'M');assert.equal(initial.tradeSeeds.some(item=>item.legacyName==='Eevee'),false);
  const stale=await migration.buildMigrationPlan({ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-b',legacyLocalLists:{wishlist:{Mewtwo:'H'}},canonicalInitialized:true},{parseListValue:parse,catalogIdentity:catalog,resolveFavoriteUid:async()=>null});
  assert.equal(stale.tradeSeeds.length,0);assert.equal(stale.recoveryCandidates[0].reason,'stale-device-cache');
});

test('post-initialization queued updates replay only against an exact legacy base',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,migration=window.PogoDomain.accountSyncMigration,identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=model.tradeEntryId(identity),base=migration.normalizeTradeValues({priority:'H'},{sortOrder:100000}),queue={queued:{kind:'my-list-update',path:'wishlist/Owner',data:{Pikachu:'M'}}};
  const input={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-replay',legacyRemoteLists:{wishlist:{Pikachu:'H'}},legacyQueue:queue,canonicalInitialized:true};
  const dependencies={parseListValue:value=>({priority:String(value||'').charAt(0)}),catalogIdentity:()=>({catalogId:'pokemon:pikachu'}),resolveFavoriteUid:async()=>null};
  const safe=await migration.buildMigrationPlan({...input,remoteCanonical:[{entityType:'tradeEntry',entityId,identity,values:base,deleted:false}]},dependencies);
  assert.equal(safe.replayMutations.length,1);assert.equal(safe.replayMutations[0].kind,'patch');assert.equal(safe.replayMutations[0].patch.priority,'M');assert.equal(safe.recoveryCandidates.length,0);
  const diverged=await migration.buildMigrationPlan({...input,deviceInstallId:'device-review',remoteCanonical:[{entityType:'tradeEntry',entityId,identity,values:{...base,priority:'L'},deleted:false}]},dependencies);
  assert.equal(diverged.replayMutations.length,0);assert.equal(diverged.recoveryCandidates.length,1);assert.equal(diverged.recoveryCandidates[0].reason,'queued-edit-requires-replay');
});

test('migration ignores legacy queue records owned by another trainer',async()=>{
  const window=load(),migration=window.PogoDomain.accountSyncMigration,dependencies={parseListValue:value=>({priority:String(value||'').charAt(0)}),catalogIdentity:(_type,name)=>({catalogId:`pokemon:${name.toLowerCase()}`}),resolveFavoriteUid:async()=>null};
  const base={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-owner-queue',legacyRemoteLists:{wishlist:{Pikachu:'H'}},canonicalInitialized:false};
  const clean=await migration.buildMigrationPlan(base,dependencies),foreign=await migration.buildMigrationPlan({...base,legacyQueue:{batch:{kind:'my-list-update',path:'wishlist/AnotherTrainer',data:{Pikachu:'M'}},item:{path:'wishlist/AnotherTrainer/Pikachu',data:'L'}}},dependencies);
  assert.equal(foreign.tradeSeeds.find(item=>item.legacyName==='Pikachu').values.priority,'H');assert.equal(foreign.sourceFingerprint,clean.sourceFingerprint);
});

test('post-initialization queued deletes without a remote base are retained for review',async()=>{
  const window=load(),migration=window.PogoDomain.accountSyncMigration,dependencies={parseListValue:value=>({priority:String(value||'').charAt(0)}),catalogIdentity:(_type,name)=>({catalogId:`pokemon:${name.toLowerCase()}`}),resolveFavoriteUid:async()=>null};
  const plan=await migration.buildMigrationPlan({ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-delete-review',legacyLocalLists:{wishlist:{Pikachu:'H'}},legacyQueue:{queued:{kind:'my-list-update',path:'wishlist/Owner',data:{Pikachu:null}}},canonicalInitialized:true,remoteCanonical:[]},dependencies);
  assert.equal(plan.tradeSeeds.length,0);assert.equal(plan.replayMutations.length,0);assert.equal(plan.recoveryCandidates.length,1);assert.equal(plan.recoveryCandidates[0].reason,'queued-delete-missing-base');assert.equal(plan.recoveryCandidates[0].identity.catalogId,'pokemon:pikachu');
});

test('queued Special Trade Board deletion requires an exact canonical legacy base and verifies the resulting tombstone',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,migration=window.PogoDomain.accountSyncMigration,identity={surface:'special-board',lane:'for-trade',catalogId:'pokemon:eevee'},entityId=model.tradeEntryId(identity),values=migration.normalizeTradeValues({name:'Eevee',qty:1},{sortOrder:0});
  const add=(await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(values).map(path=>[path,0])),patch:values,clientAt:10,operationId:'op_0000000000000881'})).value,base=merge.mergeOperation(null,add,{acceptedAt:10}).value;
  const input={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-board-delete',legacyRemoteBoard:{lf:[],ft:[{name:'Eevee',qty:1}]},legacyQueue:{profile:{path:'users/Owner',data:{specialTradeBoard:{lf:[],ft:[]}}}},canonicalInitialized:true};
  const dependencies={catalogIdentity:(_type,name)=>({catalogId:`pokemon:${name.toLowerCase()}`}),resolveFavoriteUid:async()=>null};
  const plan=await migration.buildMigrationPlan({...input,remoteCanonical:[base]},dependencies);
  assert.equal(plan.replayMutations.length,1);assert.equal(plan.replayMutations[0].kind,'delete');assert.equal(plan.verificationTombstones.length,1);assert.equal(plan.recoveryCandidates.length,0);
  const deleteOperation=(await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId,kind:'delete',baseGeneration:1,generation:2,baseFieldRevisions:{},patch:{},clientAt:0,operationId:'op_0000000000000882'})).value,tombstone=merge.mergeOperation(base,deleteOperation,{acceptedAt:11}).value;
  const deviceInstallHash=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-device-install','uid-owner','device-board-delete'])),record={schemaVersion:1,ownerUid:'uid-owner',deviceMigrationId:plan.deviceMigrationId,sourceFingerprint:plan.sourceFingerprint,deviceInstallHash,createdAt:12,completedAt:13,seedCount:1,candidateCount:0,verified:true,legacyRetained:true};
  assert.equal((await migration.verifyMigration(plan,{canonicalEntities:[tombstone],migrationRecord:record,requireExact:true})).ok,true);
  const missing=await migration.verifyMigration(plan,{canonicalEntities:[],migrationRecord:record,requireExact:true});assert.deepEqual(Array.from(missing.error.detail.tombstonesMissing),[`tradeEntry|${entityId}`]);
  const stillActive=await migration.verifyMigration(plan,{canonicalEntities:[base],migrationRecord:record,requireExact:true});assert.deepEqual(Array.from(stillActive.error.detail.tombstonesMismatched),[`tradeEntry|${entityId}`]);
  const diverged=await migration.buildMigrationPlan({...input,deviceInstallId:'device-board-diverged',remoteCanonical:[{...base,values:{...base.values,quantity:2}}]},dependencies);
  assert.equal(diverged.replayMutations.length,0);assert.equal(diverged.verificationTombstones.length,0);assert.equal(diverged.recoveryCandidates[0].reason,'queued-board-delete-requires-review');
});

test('migration retains catalog-unresolved list and board rows as deterministic recovery candidates',async()=>{
  const window=load(),migration=window.PogoDomain.accountSyncMigration,dependencies={parseListValue:()=>({priority:'H'}),catalogIdentity:()=>null,resolveFavoriteUid:async()=>null};
  const input={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-unresolved',legacyRemoteLists:{wishlist:{UnknownOne:'H'}},legacyLocalBoard:{ft:[{name:'UnknownTwo',qty:2}]},canonicalInitialized:false};
  const first=await migration.buildMigrationPlan(input,dependencies),again=await migration.buildMigrationPlan(input,dependencies);
  assert.equal(first.tradeSeeds.length,0);assert.equal(first.recoveryCandidates.length,2);
  assert.deepEqual(Array.from(first.recoveryCandidates,item=>item.reason),['catalog-identity-unresolved','catalog-identity-unresolved']);
  assert.deepEqual(Array.from(first.recoveryCandidates,item=>item.candidateId),Array.from(again.recoveryCandidates,item=>item.candidateId));
  assert.ok(first.recoveryCandidates.some(item=>item.identity.surface==='my-list'));
  assert.ok(first.recoveryCandidates.some(item=>item.identity.surface==='special-board'));
});

test('migration quarantines divergent legacy labels that collapse to one canonical identity',async()=>{
  const window=load(),migration=window.PogoDomain.accountSyncMigration,input={ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-duplicate',legacyRemoteLists:{wishlist:{Pikachu:'H','Pikachu localized alias':'M'}},canonicalInitialized:false};
  const plan=await migration.buildMigrationPlan(input,{parseListValue:value=>({priority:String(value||'').charAt(0)}),catalogIdentity:()=>({catalogId:'pokemon:pikachu'}),resolveFavoriteUid:async()=>null});
  assert.equal(plan.tradeSeeds.length,0);assert.equal(plan.verificationSeeds.length,0);assert.equal(plan.recoveryCandidates.length,2);
  assert.deepEqual(Array.from(plan.recoveryCandidates,item=>item.reason),['duplicate-canonical-identity','duplicate-canonical-identity']);
  assert.deepEqual(new Set(plan.recoveryCandidates.map(item=>item.values.priority)),new Set(['H','M']));
});

test('migration verification rejects same-ID seed or candidate payload substitution',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,migration=window.PogoDomain.accountSyncMigration;
  const plan=await migration.buildMigrationPlan({ownerUid:'uid-owner',username:'Owner',deviceInstallId:'device-exact',legacyRemoteLists:{wishlist:{Pikachu:'H'}},legacyLocalBoard:{ft:[{name:'Unknown',qty:2}]},canonicalInitialized:false},{parseListValue:value=>({priority:String(value||'').charAt(0)}),catalogIdentity:(_type,name)=>name==='Pikachu'?{catalogId:'pokemon:pikachu'}:null,resolveFavoriteUid:async()=>null});
  assert.equal(plan.verificationSeeds.length,1);assert.equal(plan.recoveryCandidates.length,1);
  const seed=plan.verificationSeeds[0],operation=(await model.createOperation({ownerUid:'uid-owner',entityType:seed.entityType,entityId:seed.entityId,identity:seed.identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:Object.fromEntries(Object.keys(seed.values).map(path=>[path,0])),patch:seed.values,clientAt:10,operationId:'op_0000000000000991'})).value,entity=merge.mergeOperation(null,operation,{acceptedAt:10}).value;
  const deviceInstallHash=await model.sha256Hex(model.canonicalJson([model.SCHEMA_VERSION,'pogo-account-sync-device-install','uid-owner','device-exact'])),record={schemaVersion:1,ownerUid:'uid-owner',deviceMigrationId:plan.deviceMigrationId,sourceFingerprint:plan.sourceFingerprint,deviceInstallHash,createdAt:10,completedAt:11,seedCount:1,candidateCount:1,verified:true,legacyRetained:true},candidate={...plan.recoveryCandidates[0],createdAt:10};
  assert.equal((await migration.verifyMigration(plan,{canonicalEntities:[entity],migrationRecord:record,recoveryCandidates:[candidate],requireExact:true})).ok,true);
  const wrongEntity={...entity,values:{...entity.values,priority:'M'}},wrongSeed=await migration.verifyMigration(plan,{canonicalEntities:[wrongEntity],migrationRecord:record,recoveryCandidates:[candidate],requireExact:true});
  assert.equal(wrongSeed.ok,false);assert.deepEqual(Array.from(wrongSeed.error.detail.mismatched),[`tradeEntry|${seed.entityId}`]);
  const wrongCandidate=await migration.verifyMigration(plan,{canonicalEntities:[entity],migrationRecord:record,recoveryCandidates:[{...candidate,reason:'substituted'}],requireExact:true});
  assert.equal(wrongCandidate.ok,false);assert.deepEqual(Array.from(wrongCandidate.error.detail.candidatesMismatched),[candidate.candidateId]);
});

test('randomized independent-field sequences converge for both delivery orders',async()=>{
  const window=load(),model=window.PogoDomain.accountSyncModel,merge=window.PogoDomain.accountSyncMerge,id=identity(window,'pokemon:dialga');
  const addOp=(await model.createOperation({...id,ownerUid:'uid-owner',kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0,shiny:0},patch:{priority:'H',shiny:false},clientAt:1,operationId:'op_0000000000000100'})).value;
  const base=merge.mergeOperation(null,addOp,{acceptedAt:1}).value;
  for(let seed=1;seed<=40;seed++){
    const firstField=seed%2?'priority':'shiny',secondField=firstField==='priority'?'shiny':'priority';
    const valueA=firstField==='priority'?'M':true,valueB=secondField==='priority'?'L':true;
    const opA=(await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId:id.entityId,kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{[firstField]:1},patch:{[firstField]:valueA},clientAt:2,operationId:`op_${String(seed).padStart(16,'0')}a`})).value;
    const opB=(await model.createOperation({ownerUid:'uid-owner',entityType:'tradeEntry',entityId:id.entityId,kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{[secondField]:1},patch:{[secondField]:valueB},clientAt:3,operationId:`op_${String(seed).padStart(16,'0')}b`})).value;
    const ab=merge.mergeOperation(merge.mergeOperation(base,opA,{acceptedAt:2}).value,opB,{acceptedAt:3}).value;
    const ba=merge.mergeOperation(merge.mergeOperation(base,opB,{acceptedAt:2}).value,opA,{acceptedAt:3}).value;
    assert.deepEqual(JSON.parse(JSON.stringify(ab.values)),JSON.parse(JSON.stringify(ba.values)));
  }
});

test('listener failure is explicit, deactivation unsubscribes, and a fresh controller resubscribes without a reconnect loop',async()=>{
  const window=load(),h=window.PogoTesting.accountSyncHarness.createMultiDeviceHarness({crypto:webcrypto}),state=h.createMemoryJournalState(),journal=window.PogoTesting.accountSyncHarness.createMemoryJournal('uid-owner',state,h.clock);
  let subscriptions=0,unsubscribes=0,currentHandlers=null;
  const repository={ownerUid:'uid-owner',listenAccount(handlers){subscriptions++;currentHandlers=handlers;queueMicrotask(()=>handlers.onData({}));return()=>{unsubscribes++;};}};
  const make=()=>window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:'uid-owner',enabled:true,writesEnabled:true,allowlistedUids:['uid-owner'],online:()=>true,clock:h.clock,crypto:webcrypto});
  const first=make();await first.activate();await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await first.snapshot()).state,'saved');
  currentHandlers.onError(new Error('private listener detail'));await new Promise(resolve=>setTimeout(resolve,0));const failed=await first.snapshot();
  assert.equal(failed.state,'sync-error');assert.equal(failed.listenerState,'failed');assert.equal(failed.listenerHealthy,false);assert.equal(failed.controllerHealthy,false);assert.equal(failed.lastError,'account-sync/listener-failed');assert.doesNotMatch(JSON.stringify(failed),/private listener detail/);assert.equal(subscriptions,1);
  await first.deactivate();assert.equal(unsubscribes,1);
  const second=make();await second.activate();await new Promise(resolve=>setTimeout(resolve,0));const healthy=await second.snapshot();
  assert.equal(healthy.state,'saved');assert.equal(healthy.listenerState,'healthy');assert.equal(healthy.listenerHealthy,true);assert.equal(healthy.controllerHealthy,true);assert.equal(subscriptions,2);
  currentHandlers.onError(new Error('again'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal((await second.snapshot()).state,'sync-error');assert.equal(subscriptions,2);
  await second.deactivate();assert.equal(unsubscribes,2);
});
