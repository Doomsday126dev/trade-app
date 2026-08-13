const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
function load(){
  const window={};const context=vm.createContext({window});
  for(const file of ['js/domain/productLimits.js','js/domain/trainerPreferenceSync.js','js/data/trainerPreferenceSyncQueue.js'])vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  return window;
}
function storage(){const values=new Map();return{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}
function operation(kind,overrides={}){return{operationId:'operation-0000001',kind,viewerUid:'viewer-a',entityId:'owner-a',baseRevision:0,createdAt:100,schemaVersion:1,payload:{},...overrides};}
function validLocal(){return{favorites:[{displayName:'Trainer A',key:'trainer a',tagIds:['tag_a'],createdAt:10,updatedAt:20}],tags:{tag_a:{label:'Group A',createdAt:10,updatedAt:20}},recent:[{displayName:'Trainer A',key:'trainer a',openedAt:30}],snapshots:{'trainer a':{seenAt:30,snapshot:{lists:{wishlist:{one:{p:'H'}},dynamax:{},gmax:{},costumes:{}}}}}};}

test('sync contract keeps locale and transient state device-only',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync;
  assert.equal(sync.SYNCABLE_PRIVATE_DATA.includes('private-trainer-notes'),false);
  assert.ok(sync.DEVICE_ONLY_DATA.includes('interface-locale'));
  assert.deepEqual(JSON.parse(JSON.stringify(sync.localeSyncRecommendation())),{sync:false,storage:'device-local',reason:'device-language-intent',coupledToOrganizer:false,browserFallbackPreserved:true});
});

test('only local-only is reachable while either client or server gate is disabled',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync;
  for(const state of ['pending-sync','synced','conflict','sync-error']){
    assert.equal(sync.preferenceSyncPresentation({featureEnabled:false,writesEnabled:true,state}).state,'local-only');
    assert.equal(sync.preferenceSyncPresentation({featureEnabled:true,writesEnabled:false,state}).state,'local-only');
  }
  assert.equal(sync.preferenceSyncPresentation({featureEnabled:true,writesEnabled:true,state:'conflict'}).state,'conflict');
});

test('concurrent favorite adds merge without erasing separate metadata',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,current={trainerName:'Trainer A',addedAt:50,revision:1,updatedAt:80,operationId:'operation-current1',deleted:false};
  const result=sync.resolveFavoriteMutation(current,operation('favorite-upsert',{operationId:'operation-0000002',payload:{trainerName:'TRAINER A',addedAt:70}}));
  assert.equal(result.status,'merged-concurrent-add');assert.equal(result.value.addedAt,50);assert.equal(result.value.trainerName,'TRAINER A');assert.equal('note' in result.value,false);
});

test('favorite delete wins only from an exact revision and stale edits conflict',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,current={trainerName:'Trainer A',addedAt:50,revision:1,updatedAt:80,operationId:'operation-current1',deleted:false};
  const deleted=sync.resolveFavoriteMutation(current,operation('favorite-delete',{operationId:'operation-0000002',baseRevision:1,createdAt:120}));
  assert.equal(deleted.ok,true);assert.equal(deleted.value.deleted,true);assert.equal(deleted.value.deletedAt,120);
  assert.equal(sync.resolveFavoriteMutation(deleted.value,operation('favorite-upsert',{operationId:'operation-0000003',baseRevision:1,payload:{trainerName:'Trainer A',addedAt:50}})).error.code,'trainer-preference-sync/conflict');
  assert.equal(sync.resolveFavoriteMutation(null,operation('favorite-delete')).status,'already-deleted');
  const restored=sync.resolveFavoriteMutation(deleted.value,operation('favorite-upsert',{operationId:'operation-0000007',baseRevision:2,payload:{trainerName:'Trainer A',addedAt:999}}));
  assert.equal(restored.value.addedAt,50);
});

test('executable conflict matrix matches independent metadata and tombstone behavior',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync;
  assert.deepEqual(JSON.parse(JSON.stringify(sync.CONFLICT_MATRIX)),{
    favoriteAddFavoriteAdd:'merge-earliest-timestamp-preserved',favoriteDeleteMetadataEdit:'tombstone-wins',tagRenameTagRename:'explicit-user-conflict',tagDeleteAssignment:'tombstone-wins',offlineEditNewerRemoteEdit:'reject',staleSchemaClientCurrentServer:'reject',accountSwitchPendingOperation:'reject'
  });
  const favorite={trainerName:'Trainer A',addedAt:10,revision:1,updatedAt:20,operationId:'operation-current1',deleted:false};
  const metadata={tagIds:[],revision:1,updatedAt:20,operationId:'operation-current2',deleted:false};
  assert.equal(sync.resolveFavoriteMutation(favorite,operation('favorite-delete',{operationId:'operation-delete01',baseRevision:1})).value.deleted,true);
  assert.deepEqual(Array.from(sync.resolveMetadataMutation(metadata,operation('metadata-upsert',{operationId:'operation-metadata1',baseRevision:1,payload:{tagIds:[]}})).value.tagIds),[]);
});

test('concurrent tag assignments require intervention and deleted tags cannot be assigned',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,current={tagIds:[],revision:2,updatedAt:100,operationId:'operation-current2',deleted:false};
  const stale=sync.resolveMetadataMutation(current,operation('metadata-upsert',{operationId:'operation-0000004',baseRevision:1,payload:{tagIds:[]}}));
  assert.equal(stale.error.code,'trainer-preference-sync/conflict');
  const invalid=sync.resolveMetadataMutation(null,operation('metadata-upsert',{payload:{tagIds:['tag_old']}}),{tags:{tag_old:{active:false,deleted:true}}});
  assert.equal(invalid.error.code,'trainer-preference-sync/tag-unavailable');
});

test('tag rename collisions and stale delete operations fail deterministically',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,current={label:'Raid',normalizedLabel:'raid',labelKey:'tag_raid',active:true,createdAt:10,updatedAt:20,revision:1,operationId:'operation-current1',deleted:false};
  const collision=sync.resolveTagMutation(current,operation('tag-rename',{operationId:'operation-0000005',baseRevision:1,payload:{label:'Lucky',normalizedLabel:'lucky',labelKey:'tag_lucky'}}),{labelClaimAvailable:false});
  assert.equal(collision.error.code,'trainer-preference-sync/tag-label-conflict');
  const stale=sync.resolveTagMutation(current,operation('tag-delete',{operationId:'operation-0000006',baseRevision:0}));
  assert.equal(stale.error.code,'trainer-preference-sync/conflict');
  assert.equal(sync.resolveTagMutation(null,operation('tag-rename',{payload:{label:'Raid',normalizedLabel:'raid',labelKey:'tag_raid'}})).error.code,'trainer-preference-sync/tag-unavailable');
  assert.equal(sync.resolveTagMutation(null,operation('tag-delete')).error.code,'trainer-preference-sync/tag-unavailable');
});

test('queue is disabled by default and exposes no private values in summaries',()=>{
  const window=load(),queue=window.PogoData.trainerPreferenceSyncQueue.createTrainerPreferenceSyncQueue({storage:storage(),identity:{uid:'viewer-a',username:'ViewerA'},domain:window.PogoDomain.trainerPreferenceSync});
  assert.equal(queue.enabled,false);assert.equal(queue.enqueue(operation('favorite-upsert')).error.code,'trainer-preference-sync/disabled');
  assert.equal(queue.next({uid:'viewer-a',username:'ViewerA'}).error.code,'trainer-preference-sync/disabled');
  assert.equal(queue.nextFavoriteDispatch({uid:'viewer-a',username:'ViewerA'}).error.code,'trainer-preference-sync/disabled');
  assert.equal(queue.recordAttempt('operation-0000001').error.code,'trainer-preference-sync/disabled');
  assert.equal(queue.acknowledge('operation-0000001','prefs_invalid').error.code,'trainer-preference-sync/disabled');
  assert.deepEqual(JSON.parse(JSON.stringify(queue.snapshot())),{ownerBound:true,enabled:false,active:true,pendingCount:0,conflictCount:0,operationCount:0,privateValuesExposed:false});
});

test('Favorite queue dispatch targets only the narrow Auth-owned callable',()=>{
  const window=load(),owner={uid:'viewer-a',username:'ViewerA'},queue=window.PogoData.trainerPreferenceSyncQueue.createTrainerPreferenceSyncQueue({storage:storage(),identity:owner,domain:window.PogoDomain.trainerPreferenceSync,featureEnabled:true,writesEnabled:true});
  const input=operation('favorite-upsert',{entityId:'owner-stable-uid',payload:{trainerName:'Trainer A',addedAt:1}});
  assert.equal(queue.enqueue(input).status,'queued');
  const dispatch=queue.nextFavoriteDispatch(owner);
  assert.equal(dispatch.callable,'mutateFavoriteTrainer');
  assert.deepEqual(JSON.parse(JSON.stringify(dispatch.request)),{operation:'add',trainerUid:'owner-stable-uid',canonicalTrainerLabel:'Trainer A',expectedRevision:0,requestId:'operation-0000001',schemaVersion:1});
  assert.equal('viewerUid' in dispatch.request,false);
  assert.equal('ownerUid' in dispatch.request,false);
  assert.equal('path' in dispatch.request,false);
});

test('operation payloads and schemas are bounded before queue persistence',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync;
  assert.equal(sync.normalizeOperation(operation('favorite-upsert',{payload:{note:'x'.repeat(sync.MAX_OPERATION_JSON_LENGTH+1)}})).error.code,'trainer-preference-sync/payload-too-large');
  assert.equal(sync.normalizeOperation(operation('favorite-upsert',{schemaVersion:2})).error.code,'trainer-preference-sync/schema-unsupported');
  assert.equal(sync.normalizeOperation(operation('favorite-upsert',{viewerUid:'viewer/a'})).error.code,'trainer-preference-sync/target-invalid');
});

test('enabled future queue is bounded, idempotent, retryable, and UID partitioned',()=>{
  const window=load(),store=storage(),domain=window.PogoDomain.trainerPreferenceSync;
  let clock=100;
  const queue=window.PogoData.trainerPreferenceSyncQueue.createTrainerPreferenceSyncQueue({storage:store,identity:{uid:'viewer-a',username:'ViewerA'},domain,featureEnabled:true,writesEnabled:true,maxOperations:2,now:()=>clock});
  const first=operation('favorite-upsert',{payload:{trainerName:'A',addedAt:1}});
  assert.equal(queue.enqueue(first).status,'queued');assert.equal(queue.enqueue(first).status,'idempotent');
  assert.equal(queue.enqueue({...first,payload:{trainerName:'B',addedAt:1}}).error.code,'trainer-preference-sync/idempotency-conflict');
  assert.equal(queue.enqueue({...first,createdAt:101}).error.code,'trainer-preference-sync/idempotency-conflict');
  assert.equal(queue.next({uid:'viewer-b',username:'ViewerB'}).error.code,'trainer-preference-sync/owner-mismatch');
  assert.equal(queue.recordAttempt(first.operationId,{retryable:true,errorCode:'offline'}).status,'pending');clock=5000;
  assert.equal(queue.next({uid:'viewer-a',username:'ViewerA'}).operation.operationId,first.operationId);
  assert.equal(queue.acknowledge(first.operationId,domain.normalizeOperation(first).value.fingerprint).status,'acknowledged');
  queue.suspend();assert.equal(queue.next({uid:'viewer-a',username:'ViewerA'}).error.code,'trainer-preference-sync/owner-mismatch');
  assert.equal(queue.resume({uid:'viewer-b',username:'ViewerB'}).error.code,'trainer-preference-sync/owner-mismatch');
});

test('queue enforces 128 operations, eight attempts, and isolates corrupt or retargeted storage',()=>{
  const window=load(),store=storage(),domain=window.PogoDomain.trainerPreferenceSync,owner={uid:'viewer-a',username:'ViewerA'};
  let clock=1;
  const queue=window.PogoData.trainerPreferenceSyncQueue.createTrainerPreferenceSyncQueue({storage:store,identity:owner,domain,featureEnabled:true,writesEnabled:true,now:()=>clock});
  for(let index=0;index<128;index++)assert.equal(queue.enqueue(operation('favorite-upsert',{operationId:`operation-${String(index).padStart(8,'0')}`,createdAt:index+1,payload:{trainerName:`Trainer ${index}`,addedAt:index}})).status,'queued');
  assert.equal(queue.enqueue(operation('favorite-upsert',{operationId:'operation-overflow1',payload:{trainerName:'Overflow',addedAt:1}})).error.code,'trainer-preference-sync/queue-full');
  const firstId='operation-00000000';
  for(let attempt=1;attempt<=8;attempt++)assert.equal(queue.recordAttempt(firstId,{retryable:true,errorCode:'offline'}).attempts,attempt);
  clock=1000000;assert.notEqual(queue.next(owner).operation?.operationId,firstId);
  const raw=JSON.parse(store.values.get(queue.key));raw.operations[firstId].operation.viewerUid='viewer-b';store.values.set(queue.key,JSON.stringify(raw));
  assert.equal(queue.snapshot().operationCount,127);
  store.values.set(queue.key,'{"broken":');assert.equal(queue.snapshot().operationCount,0);
});

test('interrupted acknowledgement retains the exact idempotent operation for safe replay',()=>{
  const window=load(),base=storage(),owner={uid:'viewer-a',username:'ViewerA'};let failWrite=false;
  const store={...base,setItem(key,value){if(failWrite)throw new Error('interrupted');base.setItem(key,value);}};
  const queue=window.PogoData.trainerPreferenceSyncQueue.createTrainerPreferenceSyncQueue({storage:store,identity:owner,domain:window.PogoDomain.trainerPreferenceSync,featureEnabled:true,writesEnabled:true});
  const input=operation('favorite-upsert',{payload:{trainerName:'A',addedAt:1}}),normalized=window.PogoDomain.trainerPreferenceSync.normalizeOperation(input).value;
  assert.equal(queue.enqueue(input).status,'queued');failWrite=true;
  assert.throws(()=>queue.acknowledge(input.operationId,normalized.fingerprint),/interrupted/);
  assert.equal(queue.next(owner).operation.fingerprint,normalized.fingerprint);
});

test('migration is explicit, current-generation hydrated, resumable, and never deletes local state',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,owner={uid:'viewer-a',username:'ViewerA'},local=validLocal();
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,local}).error.code,'trainer-preference-sync/hydration-required');
  const plan=sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,local,serverHydrated:true,hydrationGeneration:2,activeGeneration:2,userApproved:true,featureEnabled:false,writesEnabled:false});
  assert.equal(plan.status,'review-required');assert.equal(plan.executable,false);assert.equal(plan.deleteLocal,false);assert.equal(plan.publicShareWrites,0);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.favoriteMigration)),{strategy:'one-at-a-time-trusted-callable',callable:'mutateFavoriteTrainer',operationCount:1,batchEndpoint:false,stableUidResolutionRequired:true,sourceFingerprintRequired:true});
  assert.equal(sync.verifyMigration(plan,{migrationFingerprint:plan.migrationFingerprint,migrationState:'verified'},local).localDeletionAllowed,false);
  assert.equal(sync.verifyMigration(plan,{migrationFingerprint:plan.migrationFingerprint,migrationState:'verified'},{...local,recent:[]}).error.code,'trainer-preference-sync/migration-source-changed');
});

test('migration counts normalized actual records and validates per-history snapshot bounds',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,owner={uid:'viewer-a',username:'ViewerA'},local=validLocal();
  local.favorites.push({...local.favorites[0],displayName:'Ｔｒａｉｎｅｒ Ａ',updatedAt:10});
  local.recent.push({...local.recent[0],openedAt:20});
  const plan=sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,local,server:{metadata:{revision:4}},serverHydrated:true,hydrationGeneration:2,activeGeneration:2});
  assert.deepEqual(JSON.parse(JSON.stringify(plan.counts)),{favorites:1,tags:1,recents:1,history:1,historyEntries:1});
  assert.equal(plan.baselineRevision,4);assert.match(plan.sourceFingerprint,/^prefs_/);
  const oversized=validLocal();oversized.snapshots['trainer a'].snapshot.lists.wishlist=Object.fromEntries(Array.from({length:1501},(_,index)=>[`entry-${index}`,{}]));
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,local:oversized,serverHydrated:true,hydrationGeneration:1,activeGeneration:1}).error.code,'trainer-preference-sync/migration-too-large');
});

test('cross-account and newer-schema migrations are rejected',()=>{
  const sync=load().PogoDomain.trainerPreferenceSync,owner={uid:'viewer-a',username:'ViewerA'};
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:{uid:'viewer-b',username:'ViewerB'},localSchemaVersion:3,serverHydrated:true,hydrationGeneration:1,activeGeneration:1}).error.code,'trainer-preference-sync/partition-mismatch');
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:{uid:'viewer-a',username:'ＶｉｅｗｅｒＡ'},localSchemaVersion:3,serverHydrated:true,hydrationGeneration:1,activeGeneration:1}).error.code,'trainer-preference-sync/partition-mismatch');
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,server:{metadata:{schemaVersion:2}},serverHydrated:true,hydrationGeneration:1,activeGeneration:1}).error.code,'trainer-preference-sync/server-schema-newer');
  assert.equal(sync.buildMigrationPlan({activeIdentity:owner,partitionIdentity:owner,localSchemaVersion:3,local:{recent:Array.from({length:31},(_,index)=>({displayName:`Trainer ${index}`,openedAt:index}))},serverHydrated:true,hydrationGeneration:1,activeGeneration:1}).error.code,'trainer-preference-sync/migration-too-large');
});

test('production activation routes cannot reach preference sync while disabled',()=>{
  const html=readFileSync(path.join(root,'index.html'),'utf8'),sw=readFileSync(path.join(root,'sw.js'),'utf8'),visibility=readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8');
  assert.match(html,/SYNCED_TRAINER_PREFERENCES_ENABLED!==false/);
  assert.match(visibility,/SHARE_VISIBILITY_MODEL_ENABLED:false/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
  assert.doesNotMatch(html,/createTrainerPreferenceSyncQueue\s*\(/);
  assert.doesNotMatch(html,/managedTrainerPreferencesRepository\.(?:read|subscribe|mutate|transaction|write)/);
  for(const route of ["addEventListener('online'","onAuthStateChanged(auth","visibilitychange","setInterval(checkForUpdate","serviceWorker.register"]){
    const start=html.indexOf(route);assert.notEqual(start,-1);assert.doesNotMatch(html.slice(start,start+900),/trainerPreferenceSync|userPreferences|claimTrainerTagLabel|mutateFavoriteTrainer|verifyTrainerHistory/);
  }
  assert.doesNotMatch(sw,/userPreferences|claimTrainerTagLabel|mutateFavoriteTrainer|verifyTrainerHistory|pogoTrainerPreferenceSync_v1/);
  assert.doesNotMatch(html,/id=["'][^"']*(?:sync-preference|preference-sync|migration-sync)[^"']*["']/i);
});

test('sync modules have no Firebase, network, logging, public-share, or access-grant capability',()=>{
  const files=['js/domain/productLimits.js','js/domain/trainerPreferenceSync.js','js/data/trainerPreferenceSyncQueue.js'].map(file=>readFileSync(path.join(root,file),'utf8')).join('\n');
  assert.doesNotMatch(files,/firebase|fetch\(|XMLHttpRequest|console\.|publicShares|shareAccess|Approved Viewer|writeDataPath|queueSync/);
});

test('readiness documentation records the narrow Favorite decision and disabled status',()=>{
  const readiness=readFileSync(path.join(root,'docs/TRAINER-PREFERENCE-SYNC-READINESS.md'),'utf8');
  assert.match(readiness,/Status: \*\*production-inactive client and emulator candidate\*\*/);
  assert.match(readiness,/Strict reconciliation is resolved in the local candidate/);
  assert.match(readiness,/`mutateFavoriteTrainer`/);
  assert.match(readiness,/cannot make direct Favorite writes safe/);
  assert.match(readiness,/This candidate grants none of those approvals/);
});
