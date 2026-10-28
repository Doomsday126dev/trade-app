'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function load(){const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')},context=vm.createContext({window,TextEncoder,Uint8Array,unescape,encodeURIComponent,decodeURIComponent,JSON,Object,Number,Error,TypeError,URL});for(const file of['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/dev/accountRecoveryBundle.js','js/dev/accountRecoveryCollector.js','js/dev/accountRecoveryDryRun.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);return window;}
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
