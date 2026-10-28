'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function load(){const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')},context=vm.createContext({window,TextEncoder,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,JSON,Object,Number,Error,TypeError,URL});for(const file of['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncMigration.js','js/dev/accountRecoveryLegacyConversion.js','js/dev/accountRecoveryBatchPlan.js','js/dev/accountRecoveryOwnerConsumer.js','js/dev/accountRecoveryPreferences.js','js/dev/accountRecoveryBundle.js','js/dev/accountRecoveryCollector.js','js/dev/accountRecoveryDryRun.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);return window;}
async function harness(){
  const w=load(),model=w.PogoDomain.accountSyncModel,merge=w.PogoDomain.accountSyncMerge,bundle=w.PogoDev.accountRecoveryBundle.createAccountRecoveryBundle(),uid='synthetic-owner',username='SyntheticTrainer',paths=[];
  let session={uid,username,lifecycleId:'synthetic-life',accountReady:true};
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity),operation=(await model.createOperation({ownerUid:uid,entityType:'tradeEntry',entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_synthetic_original_1234'})).value;
  const entity=merge.mergeOperation(null,operation,{acceptedAt:11}).value;
  const remote={meta:{schemaVersion:1,ownerUid:uid,initialized:true},tradeEntries:{[entityId]:entity},favorites:{},tags:{},migrations:{done:{verified:true}},recoveryCandidates:{old:{resolved:true}}};
  const stores={entities:[{ownerUid:uid,entity}],operations:[{ownerUid:uid,status:'acknowledged',operationId:operation.operationId,operation}],conflicts:[{ownerUid:uid,resolved:true,conflictId:'reviewed-conflict'}],meta:[{ownerUid:uid,name:'retained',value:{orders:{wishlist:['25']}}}],recoveryCandidates:[{ownerUid:uid,candidateId:'reviewed-one',resolved:true}]};
  const local={owner:{uid,username},history:{version:3,owner:{uid,username},favorites:[{targetUid:'synthetic-favorite',tagIds:['tag_group']}],tags:{tag_group:{label:'Friends'}},snapshots:{fav:{seenAt:4,snapshot:{wants:['Pikachu']}}},recent:[{displayName:'SyntheticFavorite',openedAt:4}]},retainedHistory:{version:3,owner:{uid,username},favorites:[]},lists:Object.fromEntries(['wishlist','dynamax','gmax','costumes'].map(key=>[key,{}])),orders:{wishlist:['25']},preferences:{theme:'dark'},pendingQueue:{}};
  const values={['users/'+username]:{authUid:uid,pin:'SENSITIVE-DO-NOT-EXPORT',friendCode:'0000 1111 2222',bio:'Synthetic',specialTradeBoard:{lf:[{catalogId:'pokemon:25:base'}],ft:[]},intentDeclarations:[],isAdmin:true},['authIndex/'+uid]:{username},['userCommunities/'+uid]:{group1:{role:'member'}},['publicShares/'+username]:{username,wishlist:{Pikachu:'H'}}};
  for(const type of['wishlist','dynamax','gmax','costumes'])values[`${type}/${username}`]={Pikachu:'H'};
  const reader=w.PogoDev.accountRecoveryCollector.createOwnerRecoveryReader({database:{},ref:(db,path)=>path,get:async path=>{paths.push(path);return{exists:()=>values[path]!=null,val:()=>values[path]};},uid,trainerHandle:username,sessionCurrent:()=>session.uid===uid,readLocal:async()=>local});
  const repository={ownerUid:uid,readAccount:async()=>remote},journal={captureOwnerSnapshot:async()=>({schemaVersion:1,ownerUid:uid,stores})};
  const make=overrides=>w.PogoDev.accountRecoveryCollector.createAccountRecoveryCollector({repository,journal,ownerReader:reader,getSession:()=>session,bundleModel:bundle,sha256:value=>model.sha256Hex(value),validateEntity:merge.validateEntity,clock:()=>1000,...overrides});
  return{w,model,merge,bundle,uid,username,remote,stores,local,paths,reader,repository,journal,entity,make,setSession:value=>{session={...session,...value};}};
}
test('collector covers all sections, raw history, acknowledged journal and reviewed evidence without credentials',async()=>{
  const h=await harness(),archive=await h.make().collect();assert.equal(archive.sections.journal.records.find(row=>row.id==='operations').value[0].status,'acknowledged');
  assert.equal(archive.sections.recovery.records.find(row=>row.id==='local-candidates').value[0].resolved,true);
  assert.equal(archive.sections.preferences.records.find(row=>row.id==='history').value.snapshots.fav.seenAt,4);
  assert.equal(archive.sections.groups.records[0].value.group1.role,'member');assert.ok(archive.sections.sharing.records[0].value.legacyUrls.every(url=>url.includes('?view=SyntheticTrainer&list=')));
  assert.equal(JSON.stringify(archive).includes('SENSITIVE-DO-NOT-EXPORT'),false);assert.equal(Object.keys(archive.sections).length,12);
  assert.ok(h.paths.every(path=>path.split('/').length===2));
});
test('collector refuses a changed source, account switch, unsupported schema and missing local store',async()=>{
  const h=await harness();let reads=0;
  await assert.rejects(h.make({repository:{readAccount:async()=>{reads++;return{...h.remote,meta:{...h.remote.meta,captureCounter:reads}};}}}).collect(),{code:'recovery/source-changed'});
  await assert.rejects(h.make({repository:{readAccount:async()=>{h.setSession({lifecycleId:'changed'});return h.remote;}}}).collect(),{code:'recovery/session-changed'});
  const x=await harness();x.remote.unknownNewCollection={secretData:1};await assert.rejects(x.make().collect(),{code:'recovery/source-version-unsupported'});
  const y=await harness();delete y.stores.meta;await assert.rejects(y.make().collect(),{code:'recovery/source-version-unsupported'});
});
test('wrong-owner history and unsupported enabled feature cannot be silently omitted',async()=>{
  const h=await harness();h.local.history.owner.uid='someone-else';await assert.rejects(h.make().collect(),{code:'recovery/history-owner-or-version-invalid'});
  assert.throws(()=>h.w.PogoDev.accountRecoveryCollector.createOwnerRecoveryReader({database:{},ref:()=>{},get:()=>{},uid:h.uid,trainerHandle:h.username,sessionCurrent:()=>true,readLocal:async()=>h.local,features:{providerPublicShares:true,syncedPreferences:false,shareVisibility:false}}),{code:'recovery/feature-collector-required'});
});
test('dry-run creates only validated stable-ID canonical additions and repeated simulation is idempotent',async()=>{
  const h=await harness(),source=await h.make().collect();h.remote.tradeEntries={};const target=await h.make().collect();
  const dry=h.w.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel:h.bundle}),args={sourceBundle:source,currentBundle:target,targetUid:h.uid};
  const first=await dry.prepare(args),again=await dry.prepare(args);assert.deepEqual(first,again);assert.equal(first.automaticApply,false);assert.equal(first.operations.length,1);
  const operation=first.operations[0];assert.equal((await h.model.verifyOperation(operation)).ok,true);
  const applied=h.merge.mergeOperation(null,operation,{acceptedAt:1001}),replay=h.merge.mergeOperation(applied.value,operation,{acceptedAt:1002});
  assert.equal(applied.ok,true);assert.equal(replay.status,'idempotent');assert.equal(applied.value.ownerUid,h.uid);
  assert.deepEqual(JSON.parse(JSON.stringify(applied.value.values)),JSON.parse(JSON.stringify(h.entity.values)));
  assert.equal((await dry.revalidate({plan:first,...args})).ok,true);
});
test('dry-run rejects stale or edited plans and never creates permissions, memberships or share writes',async()=>{
  const h=await harness(),source=await h.make().collect();h.remote.tradeEntries={};const target=await h.make().collect();
  const dry=h.w.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel:h.bundle}),args={sourceBundle:source,currentBundle:target,targetUid:h.uid},plan=await dry.prepare(args);
  plan.operations[0].patch.priority='L';await assert.rejects(dry.revalidate({plan,...args}),{code:'recovery/plan-changed'});
  const clean=await dry.prepare(args);h.remote.meta.updatedAt=100;const changed=await h.make().collect();await assert.rejects(dry.revalidate({plan:clean,...args,currentBundle:changed}),{code:'recovery/stale-plan'});
  assert.ok(clean.operations.every(row=>['tradeEntry','favorite','tag'].includes(row.entityType)));assert.ok(clean.rows.some(row=>row.section==='permissions'));
});
test('cross-UID recovery only returns identity review and never turns a file into account-control proof',async()=>{
  const h=await harness(),source=await h.make().collect(),targetData=JSON.parse(JSON.stringify(source));targetData.source.ownerUid='different-owner';targetData.sections.canonicalEntities.records=[];
  const target=await h.bundle.create({source:targetData.source,sections:targetData.sections});
  const dry=h.w.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel:h.bundle}),plan=await dry.prepare({sourceBundle:source,currentBundle:target,targetUid:'different-owner'});
  assert.equal(plan.sameOwner,false);assert.equal(plan.operations.length,0);assert.equal(plan.rows.find(row=>row.section==='canonicalEntities').status,'identity-recovery-required');
});
test('Favorites require exact target proof and restorable tag dependencies before an import operation is proposed',async()=>{
  const h=await harness(),source=await h.make().collect(),empty=JSON.parse(JSON.stringify(source));empty.sections.canonicalEntities.records=[];
  const tagOp=(await h.model.createOperation({ownerUid:h.uid,entityType:'tag',entityId:'tag_group',identity:{tagId:'tag_group'},kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{label:0},patch:{label:'Friends'},clientAt:20,operationId:'op_synthetic_tag_1234567'})).value;
  const favoriteOp=(await h.model.createOperation({ownerUid:h.uid,entityType:'favorite',entityId:'synthetic-favorite',identity:{targetUid:'synthetic-favorite'},kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{displayName:0,'tagIds/tag_group':0},patch:{displayName:'SyntheticFavorite','tagIds/tag_group':true},clientAt:20,operationId:'op_synthetic_favorite_1234'})).value;
  const tag=h.merge.mergeOperation(null,tagOp,{acceptedAt:21}).value,favorite=h.merge.mergeOperation(null,favoriteOp,{acceptedAt:21}).value;
  source.sections.canonicalEntities.records=[{id:'tag:tag_group',value:tag},{id:'favorite:synthetic-favorite',value:favorite}];
  const sourceBundle=await h.bundle.create({source:source.source,sections:source.sections}),currentBundle=await h.bundle.create({source:empty.source,sections:empty.sections});
  const make=resolveFavoriteTarget=>h.w.PogoDev.accountRecoveryDryRun.createAccountRecoveryDryRun({bundleModel:h.bundle,resolveFavoriteTarget});
  const args={sourceBundle,currentBundle,targetUid:h.uid},blocked=await make(async()=>({uid:'wrong-target'})).prepare(args);assert.equal(blocked.operations.length,1);assert.equal(blocked.rows.find(row=>row.id.startsWith('favorite:')).status,'favorite-identity-review');
  const accepted=await make(async()=>({uid:'synthetic-favorite'})).prepare(args);assert.deepEqual([...accepted.operations.map(row=>row.entityType)],['tag','favorite']);
  const deletion=(await h.model.createOperation({ownerUid:h.uid,entityType:'tag',entityId:'tag_group',identity:{tagId:'tag_group'},kind:'delete',baseGeneration:1,generation:2,baseFieldRevisions:{},patch:{},clientAt:25,operationId:'op_synthetic_tag_delete_1234'})).value;
  const tombstone=h.merge.mergeOperation(tag,deletion,{acceptedAt:26}).value;
  empty.sections.canonicalEntities.records=[{id:'tag:tag_group',value:tombstone}];const currentWithTombstone=await h.bundle.create({source:empty.source,sections:empty.sections});
  const conflict=await make(async()=>({uid:'synthetic-favorite'})).prepare({...args,currentBundle:currentWithTombstone});assert.equal(conflict.operations.length,0);assert.equal(conflict.rows.find(row=>row.id.startsWith('favorite:')).status,'tag-reference-review');
});

test('provider-only export uses canonical ownership and complete owner-bound feature adapters',async()=>{
 const h=await harness(),features={providerPublicShares:true,syncedPreferences:true,shareVisibility:true},paths=[];
 const featureAdapters=Object.fromEntries(Object.keys(features).map(key=>[key,{capture:async()=>({schemaVersion:1,ownerUid:h.uid,complete:true,value:{feature:key,version:1}})}]));
 const reader=h.w.PogoDev.accountRecoveryCollector.createOwnerRecoveryReader({database:{},ref:(db,path)=>path,get:async path=>{paths.push(path);return{exists:()=>false};},uid:h.uid,trainerHandle:h.username,sessionCurrent:()=>true,readLocal:async()=>h.local,identityKind:'provider_only',readProviderFoundation:async()=>({uid:h.uid,canonicalTrainerName:h.username,identityKind:'provider_only',legacyAccessConfigured:false}),features,featureAdapters});
 const source=await h.make({ownerReader:reader}).collect();
 assert.ok(paths.every(path=>path===`userCommunities/${h.uid}`||path===`trainerShares/${h.uid}`));
 assert.equal(source.sections.preferences.records.find(row=>row.id==='feature:syncedPreferences').value.version,1);
 assert.equal(source.sections.sharing.records.filter(row=>row.id.startsWith('feature:')).length,2);
 featureAdapters.syncedPreferences.capture=async()=>({schemaVersion:1,ownerUid:'other-owner',complete:true,value:{}});
 await assert.rejects(h.make({ownerReader:reader}).collect(),{code:'recovery/feature-source-invalid'});
});

test('typed content adapters retain conflicts, rebind owned history metadata and reject privilege fields',async()=>{
 const h=await harness(),{createRecoveryContentAdapters}=require('../functions/src/prototype/recoveryContentAdapters'),adapter=createRecoveryContentAdapters({model:h.model});
 const source=JSON.parse(JSON.stringify(await h.make().collect())),current=JSON.parse(JSON.stringify(source));
 current.source.ownerUid='replacement-owner';current.source.trainerHandle='ReplacementTrainer';
 current.sections.profile.records=[];current.sections.legacyLists.records=[];current.sections.preferences.records=[{id:'device',value:{theme:'light'}}];
 const plan=adapter.prepare({source,current});
 assert.equal(plan.rows.find(row=>row.section==='preferences'&&row.id==='device').status,'conflict-review');
 const history=plan.additions.find(row=>row.section==='preferences'&&row.id==='history');assert.equal(history.value.owner.uid,'replacement-owner');assert.equal(history.value.owner.username,'ReplacementTrainer');
 const applied=adapter.apply(JSON.parse(JSON.stringify(current.sections)),plan);
 assert.equal(applied.preferences.records.find(row=>row.id==='device').value.theme,'light');assert.equal(applied.permissions.records[0].value.legacyRoleReferences.isAdmin,true);
 assert.equal(plan.additions.some(row=>['permissions','groups','sharing','journal'].includes(row.section)),false);
 source.sections.preferences.records.find(row=>row.id==='device').value.isAdmin=true;
 assert.throws(()=>adapter.prepare({source,current}),{code:'recovery/privileged-content-forbidden'});
});

test('legacy conversion requires real catalog identity and preserves unresolved content for review',async()=>{
 const h=await harness(),source=await h.make().collect();
 const converter=h.w.PogoDev.accountRecoveryLegacyConversion.create({bundleModel:h.bundle,parseListValue:value=>({priority:value}),catalogIdentity:(lane,name)=>name==='Pikachu'?{catalogId:'pokemon:25:base'}:null,resolveFavoriteUid:async()=>null});
 const converted=await converter.convert(source);assert.equal(converted.bundle.source.ownerUid,h.uid);
 assert.deepEqual(JSON.parse(JSON.stringify(converted.bundle.sections.legacyLists)),JSON.parse(JSON.stringify(source.sections.legacyLists)));
 const unresolved=h.w.PogoDev.accountRecoveryLegacyConversion.create({bundleModel:h.bundle,parseListValue:value=>({priority:value}),catalogIdentity:()=>({catalogId:'legacy:unknown'}),resolveFavoriteUid:async()=>null});
 assert.ok((await unresolved.convert(source)).manualReview.some(row=>row.reason==='catalog-identity-unresolved'));
});
test('large restore batch plan is stable, bounded and refuses wrong-owner or duplicate operations',async()=>{
 const h=await harness(),ops=[];
 for(let n=0;n<101;n++){const identity={surface:'my-list',lane:'wishlist',catalogId:`pokemon:test${n}`};ops.push((await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:h.model.tradeEntryId(identity),identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:`op_test_large_recovery_${String(n).padStart(8,'0')}`})).value);}
 const planner=h.w.PogoDev.accountRecoveryBatchPlan.create({maxItems:25,maxBytes:65536}),args={operations:ops,ownerUid:h.uid,sourceDigest:'a'.repeat(64)};
 const plan=await planner.prepare(args);assert.equal(plan.batches.length,5);assert.equal(plan.operationCount,101);assert.deepEqual(await planner.prepare({...args,operations:[...ops].reverse()}),plan);
 assert.ok(plan.batches.every(batch=>batch.operations.length<=25&&Buffer.byteLength(JSON.stringify(batch.operations))<=65536));
 await assert.rejects(planner.prepare({...args,ownerUid:'other-owner'}),{code:'recovery/batch-operation-invalid'});
 await assert.rejects(planner.prepare({...args,operations:[ops[0],ops[0]]}),{code:'recovery/batch-operation-invalid'});
});

test('owner consumer resumes a lost acknowledgement without resending and rejects later owner changes',async()=>{
 const h=await harness(),source=await h.make().collect(),entity=h.entity,identity=entity.identity;
 const op=(await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:entity.entityId,identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_owner_recovery_consumer_12345678'})).value;
 const meta=new Map();let current=null,writes=0,drop=true,session={uid:h.uid,lifecycleId:'life-1',accountReady:true};
 const repository={ownerUid:h.uid,readAccount:async()=>({meta:{ownerUid:h.uid,initialized:true},tradeEntries:current?{[op.entityId]:current}:{}}),applyOperation:async operation=>{writes++;current=h.merge.mergeOperation(null,operation,{acceptedAt:11}).value;if(drop){drop=false;throw Error('lost acknowledgement');}return{ok:true,value:current};}};
 const args={enabled:true,repository,journal:{getMeta:async key=>meta.get(key),setMeta:async(key,value)=>meta.set(key,JSON.parse(JSON.stringify(value)))},bundleModel:h.bundle,batchPlanner:h.w.PogoDev.accountRecoveryBatchPlan.create(),verifyTradeIdentity:identity=>identity,getSession:()=>session};
 const first=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),ticket=await first.review({sourceBundle:source,operations:[op],accepted:true});await assert.rejects(first.run(ticket),/lost acknowledgement/);
 const reopened=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),review=await reopened.review({sourceBundle:source,resumeDigest:ticket.digest,accepted:true});assert.equal((await reopened.run(review)).status,'verified');assert.equal(writes,1);
 current={...current,values:{...current.values,priority:'L'}};await assert.rejects(reopened.run(review),{code:'recovery/committed-content-changed'});assert.equal(writes,1);
 session={uid:'other-owner',lifecycleId:'life-2',accountReady:true};await assert.rejects(reopened.run(review));assert.equal(writes,1);
});

test('history production consumer is default-off, owner-bound and append-only',()=>{
 const window={},context=vm.createContext({window,console,Object,JSON,Date,Number,Set,Map,Error,TypeError});window.PogoDomain={productLimits:{MAX_FAVORITES:100}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data/trainerHistoryStore.js'),'utf8'),context);
 const map=new Map(),storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
 const identity={uid:'history-owner',username:'HistoryTrainer'},api=window.PogoData.trainerHistoryStore;
 const off=api.createTrainerHistoryStore({storage,identity}),history={version:3,owner:identity,recent:[{displayName:'Other Trainer',openedAt:100}],snapshots:{'other trainer':{seenAt:100,snapshot:{wishlist:{Pikachu:'H'}}}},favorites:[{displayName:'Must not become favorite'}],tags:{}};
 assert.equal(off.restoreOwnedHistoryArchive({sourceDigest:'a'.repeat(64),history}).code,'recovery/disabled');
 const store=api.createTrainerHistoryStore({storage,identity,recoveryEnabled:true});storage.setItem(store.key,JSON.stringify({version:3,schemaVersion:3,migrationVersion:3,owner:identity,recent:[],favorites:[],tags:{},snapshots:{}}));const original=storage.getItem(store.key);
 assert.equal(store.restoreOwnedHistoryArchive({sourceDigest:'a'.repeat(64),history}).ok,true);assert.equal(storage.getItem(store.key),original);
 assert.equal(store.read().recent[0].displayName,'Other Trainer');assert.equal(store.read().favorites.length,0);assert.equal(store.snapshotFor('Other Trainer').snapshot.wishlist.Pikachu,'H');
 assert.equal(store.restoreOwnedHistoryArchive({sourceDigest:'a'.repeat(64),history}).status,'idempotent');
 assert.equal(store.restoreOwnedHistoryArchive({sourceDigest:'b'.repeat(64),history:{...history,owner:{uid:'other-owner',username:'OtherTrainer'}}}).ok,false);
});

test('display preference recovery is reviewed, owner-bound, reloadable and yields to normal choices',async()=>{
 const h=await harness(),source=JSON.parse(JSON.stringify(await h.make().collect()));source.sections.preferences.records.find(row=>row.id==='device').value={theme:'dark',locale:'ja',shareVisibility:'public'};
 const bundle=await h.bundle.create({source:source.source,sections:source.sections}),map=new Map([['pogoTheme','"light"'],['pogoUiLocale:v1','en']]);
 const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
 let session={uid:h.uid,lifecycleId:'life'};const module=h.w.PogoDev.accountRecoveryPreferences,args={enabled:true,storage,bundleModel:h.bundle,getSession:()=>session};
 assert.equal(module.create().available,false);const consumer=module.create(args);
 await assert.rejects(consumer.review({sourceBundle:bundle}),{code:'recovery/explicit-review-required'});
 const ticket=await consumer.review({sourceBundle:bundle,accepted:true});assert.deepEqual([...ticket.unsupported],['shareVisibility']);assert.equal(consumer.confirm(ticket).status,'restored');
 assert.equal(storage.getItem('pogoTheme'),'"light"');assert.equal(storage.getItem('pogoUiLocale:v1'),'en');
 const reopened=module.create(args);assert.equal(reopened.read('theme','light'),'dark');assert.equal(reopened.read('locale','en'),'ja');
 session={uid:'another-owner',lifecycleId:'other'};assert.equal(reopened.read('theme','light'),'light');session={uid:h.uid,lifecycleId:'life'};
 module.noteNormalWrite(storage,'theme');assert.equal(reopened.read('theme','light'),'light');
 const next=await reopened.review({sourceBundle:bundle,accepted:true});storage.setItem('pogoUiLocale:v1','es');assert.throws(()=>reopened.confirm(next),{code:'recovery/preference-conflict'});
 const pending=await reopened.review({sourceBundle:bundle,accepted:true});session={uid:h.uid,lifecycleId:'reload'};assert.throws(()=>reopened.confirm(pending),{code:'recovery/session-changed'});
});

test('competing recovered preferences report conflict through fallback and never overwrite device choices',async()=>{
 const h=await harness(),source=await h.make().collect(),map=new Map(),storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
 const consumer=h.w.PogoDev.accountRecoveryPreferences.create({enabled:true,storage,bundleModel:h.bundle,getSession:()=>({uid:h.uid,lifecycleId:'life'})});
 consumer.confirm(await consumer.review({sourceBundle:source,accepted:true}));const different=JSON.parse(JSON.stringify(source));different.sections.preferences.records.find(row=>row.id==='device').value.theme='light';
 const bundle=await h.bundle.create({source:different.source,sections:different.sections});consumer.confirm(await consumer.review({sourceBundle:bundle,accepted:true}));assert.equal(consumer.read('theme','auto'),'auto');assert.equal(storage.getItem('pogoTheme'),null);
});

test('multiple restore batches resume after interruption, preserve unrelated edits and refuse missing uncertain writes',async()=>{
 const h=await harness(),source=await h.make().collect(),operations=[],entities={};
 for(let i=0;i<7;i++){const identity={surface:'my-list',lane:'wishlist',catalogId:`pokemon:${i+1}:base`},op=(await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:h.model.tradeEntryId(identity),identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:`op_batch_restore_${String(i).padStart(20,'0')}`})).value;operations.push(op);entities[`tradeEntry:${op.entityId}`]=h.merge.mergeOperation(null,op,{acceptedAt:11}).value;}
 source.sections.canonicalEntities.records=Object.entries(entities).map(([id,value])=>({id,value}));const bundle=await h.bundle.create({source:source.source,sections:source.sections});
 const meta=new Map(),rows={},calls=[];let interrupt=true,session={uid:h.uid,lifecycleId:'life',accountReady:true};
 const repository={ownerUid:h.uid,readAccount:async()=>({meta:{ownerUid:h.uid,initialized:true},tradeEntries:rows}),applyOperation:async op=>{calls.push(op.operationId);rows[op.entityId]=h.merge.mergeOperation(rows[op.entityId]||null,op,{acceptedAt:11}).value;return{ok:true};}};
 const args={enabled:true,repository,journal:{getMeta:async key=>meta.get(key),setMeta:async(key,value)=>meta.set(key,JSON.parse(JSON.stringify(value)))},bundleModel:h.bundle,batchPlanner:h.w.PogoDev.accountRecoveryBatchPlan.create({maxItems:2}),verifyTradeIdentity:identity=>identity,getSession:()=>session,onBatch:async()=>{if(interrupt){interrupt=false;throw Error('reload interruption');}}};
 const first=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),ticket=await first.review({sourceBundle:bundle,operations,accepted:true});assert.equal(ticket.batchCount,4);await assert.rejects(first.run(ticket),/reload interruption/);assert.equal(calls.length,2);
 rows.unrelated={ownerUid:h.uid,values:{priority:'L'}};const reopened=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),review=await reopened.review({sourceBundle:bundle,resumeDigest:ticket.digest,accepted:true});assert.equal((await reopened.run(review)).verified,7);assert.equal(calls.length,7);assert.equal(rows.unrelated.values.priority,'L');
 assert.equal((await reopened.run(review)).verified,7);assert.equal(calls.length,7);
 const patched=operations[0],patch=(await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:patched.entityId,identity:patched.identity,kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{priority:1},patch:{priority:'L'},clientAt:12,operationId:'op_batch_later_owner_patch_123456'})).value;
 const result=h.merge.mergeOperation(rows[patched.entityId],patch,{acceptedAt:13});assert.equal(result.ok,true);rows[patched.entityId]=result.value;
 await assert.rejects(reopened.run(review),{code:'recovery/committed-content-changed'});assert.equal(rows[patched.entityId].values.priority,'L');assert.equal(calls.length,7);
 session={uid:'different-user',lifecycleId:'other',accountReady:true};await assert.rejects(reopened.run(review));assert.equal(calls.length,7);
});

test('uncertain missing write remains blocked after reload until authoritative readback proves its outcome',async()=>{
 const h=await harness(),source=await h.make().collect(),entity=h.entity,op=(await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:entity.entityId,identity:entity.identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:entity.values,clientAt:10,operationId:'op_missing_pending_recovery_12345'})).value;
 let row=null,writes=0,mode='reject';const meta=new Map(),args={enabled:true,repository:{ownerUid:h.uid,readAccount:async()=>({meta:{ownerUid:h.uid,initialized:true},tradeEntries:row?{[op.entityId]:row}:{}}),applyOperation:async operation=>{writes++;if(mode==='reject')throw Error('unknown network outcome');row=h.merge.mergeOperation(null,operation,{acceptedAt:11}).value;return{ok:true};}},journal:{getMeta:async key=>meta.get(key),setMeta:async(key,value)=>meta.set(key,JSON.parse(JSON.stringify(value)))},bundleModel:h.bundle,batchPlanner:h.w.PogoDev.accountRecoveryBatchPlan.create(),verifyTradeIdentity:identity=>identity,getSession:()=>({uid:h.uid,lifecycleId:'life',accountReady:true})};
 const create=()=>h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),first=create(),ticket=await first.review({sourceBundle:source,operations:[op],accepted:true});await assert.rejects(first.run(ticket),/unknown network outcome/);
 const reopened=create(),again=await reopened.review({sourceBundle:source,resumeDigest:ticket.digest,accepted:true});await assert.rejects(reopened.run(again),{code:'recovery/outcome-unproven'});assert.equal(writes,1);
 // Independent proof arrives through the authoritative repository, never a reset of the checkpoint.
 row=h.merge.mergeOperation(null,op,{acceptedAt:11}).value;assert.equal((await reopened.run(again)).status,'verified');assert.equal(writes,1);
});

test('cancel during an already-started restore write leaves a durable checkpoint and reconciles without another write',async()=>{
 const h=await harness(),source=await h.make().collect(),op=(await h.model.createOperation({ownerUid:h.uid,entityType:'tradeEntry',entityId:h.entity.entityId,identity:h.entity.identity,kind:'add',baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},patch:{priority:'H'},clientAt:10,operationId:'op_canceled_recovery_commit_12345'})).value;
 let row=null,writes=0,release,entered;const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),meta=new Map(),args={enabled:true,repository:{ownerUid:h.uid,readAccount:async()=>({meta:{ownerUid:h.uid,initialized:true},tradeEntries:row?{[op.entityId]:row}:{}}),applyOperation:async operation=>{writes++;entered();await wait;row=h.merge.mergeOperation(null,operation,{acceptedAt:11}).value;return{ok:true};}},journal:{getMeta:async key=>meta.get(key),setMeta:async(key,value)=>meta.set(key,JSON.parse(JSON.stringify(value)))},bundleModel:h.bundle,batchPlanner:h.w.PogoDev.accountRecoveryBatchPlan.create(),verifyTradeIdentity:identity=>identity,getSession:()=>({uid:h.uid,lifecycleId:'life',accountReady:true})};
 const first=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),ticket=await first.review({sourceBundle:source,operations:[op],accepted:true}),pending=first.run(ticket);await started;assert.equal(first.cancel().status,'stopping-after-current-write');release();await assert.rejects(pending,{code:'recovery/session-changed'});
 const reopened=h.w.PogoDev.accountRecoveryOwnerConsumer.create(args),review=await reopened.review({sourceBundle:source,resumeDigest:ticket.digest,accepted:true});assert.equal((await reopened.run(review)).status,'verified');assert.equal(writes,1);
});
