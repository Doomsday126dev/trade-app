'use strict';

// Constructed account data only. Do not load data.js, a Firebase export, a browser
// profile, environment credentials, or any real user's local storage here.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {sha256}=require('../format.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const ROOT=path.resolve(__dirname,'../../..');
const OWNER='synthetic_archive_owner';
const HANDLE='SyntheticArchiveTrainer';
const AT=1788825600000;
const CAPTURED_AT='2026-09-08T00:00:01.000Z';
const SOURCE_COMMIT='c3fd690a2a2c46dab448873b244e496199283694';
const SECRET_MARKERS=['SYNTHETIC_EXCLUDED_PIN_9274','SYNTHETIC_EXCLUDED_PASSWORD','SYNTHETIC_EXCLUDED_REFRESH_TOKEN','SYNTHETIC_EXCLUDED_ID_TOKEN','SYNTHETIC_EXCLUDED_PRIVATE_KEY','SYNTHETIC_EXCLUDED_PIN_HASH'];
function loadCurrentContracts(){
  const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'source-contracts.json'),'utf8'));
  const window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  const context=vm.createContext({window,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});
  for(const file of ['js/domain/productLimits.js','js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/domain/accountSyncProduct.js','js/domain/accountSyncMigration.js','js/domain/pokemonKeys.js','js/domain/publicSharePublication.js','js/data/trainerHistoryStore.js']){
    const bytes=fs.readFileSync(path.join(ROOT,file),'utf8');
    if(expected.sourceCommit!==SOURCE_COMMIT||sha256(bytes)!==expected.files[file])throw new Error('Archive fixture source contract changed; revalidate its adapter and provenance before regenerating');
    vm.runInContext(bytes,context,{filename:file,timeout:2000});
  }
  return{model:window.PogoDomain.accountSyncModel,merge:window.PogoDomain.accountSyncMerge,product:window.PogoDomain.accountSyncProduct,migration:window.PogoDomain.accountSyncMigration,catalog:window.PogoDomain.pokemonCatalog,publication:window.PogoDomain.publicSharePublication,history:window.PogoData.trainerHistoryStore};
}
async function makeSource(){
  const api=loadCurrentContracts();let sequence=0;
  const catalogInputs=[
    {no:25,name:'Pikachu'},
    {no:25,name:'Pikachu (Moon)'},
    {no:25,name:'Pikachu (Sun)'},
    {no:26,name:'A-Raichu'},
    {no:6,name:'Charizard Dynamax',maxType:'dynamax'},
    {no:6,name:'Charizard Gigantamax',maxType:'gmax'},
    {no:201,name:'Unown (A)',goFormId:'UNOWN_A'},
    {no:201,name:'Unown (B)',goFormId:'UNOWN_B'}
  ];
  const catalogEntries=catalogInputs.map(raw=>{
    const entry=api.catalog.decorateCatalogEntry(raw);
    return{catalogId:entry.catalogId,speciesId:entry.speciesId,name:entry.name,formId:entry.goFormId,costumeId:entry.goCostumeId,regionalForm:entry.regionalFormCode,maxState:entry.representedMaxState,allowedGenders:entry.speciesId===201?['']:['','m','f']};
  });
  async function op({entityType='tradeEntry',entityId,identity,patch,kind='add',baseGeneration=0,generation=1,baseFieldRevisions}){
    const operationId=`op_${String(++sequence).padStart(32,'0')}`;
    const result=await api.model.createOperation({ownerUid:OWNER,entityType,entityId,identity,patch,kind,baseGeneration,generation,baseFieldRevisions:baseFieldRevisions||Object.fromEntries(Object.keys(patch).map(key=>[key,0])),operationId,clientAt:AT+sequence},{crypto:webcrypto});
    if(!result.ok)throw new Error(result.error.code);return clone(result.value);
  }
  async function entity(catalogIndex,lane,fields={},surface='my-list'){
    const identity={surface,lane,catalogId:catalogEntries[catalogIndex].catalogId};
    const operation=await op({entityId:api.model.tradeEntryId(identity),identity,patch:{...api.product.TRADE_DEFAULTS,sortOrder:sequence,...fields}});
    const result=api.merge.mergeOperation(null,operation,{acceptedAt:AT+sequence});
    if(!result.ok)throw new Error(result.error.code);return clone(result.value);
  }
  const wants=[
    await entity(0,'wishlist',{priority:'H',note:'Keep this exact base species want',sortOrder:7,gender:'f',variant:'f',backgroundId:'synthetic-retired-background-choice'}),
    await entity(0,'looking-for',{priority:'',lucky:true,note:'Lucky only; no priority',sortOrder:1}),
    await entity(1,'costumes',{priority:'',xxl:true,note:'Moon costume, XXL only',sortOrder:3}),
    await entity(2,'costumes',{priority:'',xxs:true,shiny:true,note:'Sun costume, XXS + shiny only',sortOrder:4}),
    await entity(3,'wishlist',{priority:'M',note:'Alolan form',sortOrder:2}),
    await entity(4,'dynamax',{priority:'L',sortOrder:5}),
    await entity(5,'gmax',{priority:'H',note:'Exact Gigantamax; keep distinct',sortOrder:6}),
    await entity(6,'looking-for',{priority:'M',note:'Letter A',sortOrder:8}),
    await entity(7,'looking-for',{priority:'L',note:'Letter B',sortOrder:9}),
    await entity(0,'looking-for',{priority:'',lucky:true,note:'A second source lane; do not collapse duplicate semantics',sortOrder:10},'special-board')
  ];
  const ft=await entity(0,'for-trade',{priority:'H',quantity:7,mirror:true,backgroundId:'synthetic-old-city-background',note:'Historical FT; never activate'},'special-board');
  let tombstone=await entity(3,'looking-for',{priority:'L',note:'User deliberately deleted this want'});
  const deletion=await op({entityId:tombstone.entityId,patch:{},kind:'delete',baseGeneration:1,generation:2});
  tombstone=clone(api.merge.mergeOperation(tombstone,deletion,{acceptedAt:AT+30}).value);
  const tags=[];
  for(const [tagId,label] of [['tag_synthetic_friends','Friends'],['tag_synthetic_event','September meetup']]){
    const operation=await op({entityType:'tag',entityId:tagId,identity:{tagId},patch:{label}});
    tags.push(clone(api.merge.mergeOperation(null,operation).value));
  }
  const favoriteOperation=await op({entityType:'favorite',entityId:'synthetic_friend_uid',identity:{targetUid:'synthetic_friend_uid'},patch:{displayName:'SyntheticFriend','tagIds/tag_synthetic_friends':true,'tagIds/tag_synthetic_event':true}});
  const favorite=clone(api.merge.mergeOperation(null,favoriteOperation).value);
  const pendingOperation=await op({entityId:wants[1].entityId,patch:{note:'Device-only note waiting for connection'},kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{note:1}});
  const optimistic=clone(api.merge.mergeOperation(wants[1],pendingOperation,{acceptedAt:AT+100}).value);
  const conflictOperation=await op({entityId:wants[4].entityId,patch:{priority:'H'},kind:'patch',baseGeneration:1,generation:1,baseFieldRevisions:{priority:0}});
  const conflictResult=api.merge.mergeOperation(wants[4],conflictOperation,{acceptedAt:AT+101});
  if(!conflictResult.conflicts?.length)throw new Error('Fixture did not create a real current-model conflict');
  const queueRecord=(operation,status)=>({key:`${OWNER}|${operation.operationId}`,ownerUid:OWNER,operationId:operation.operationId,status,attempts:status==='blocked'?12:1,nextAttemptAt:AT+200,lastErrorCode:status==='conflict'?'account-sync/conflict':status==='blocked'?'account-sync/network-failed':'',createdAt:AT+100,updatedAt:AT+100,operation});
  const memory=new Map();
  const store=api.history.createTrainerHistoryStore({storage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)},identity:{uid:OWNER,username:HANDLE},now:()=>AT});
  const organization=api.product.organizerProjection([...tags,favorite]);
  store.replaceSyncedOrganization(organization);
  const lists={wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}};
  store.rememberChecked('SyntheticFriend',{lists,declarations:[{intent:'lf',category:'wishlist',name:'Pikachu',p:'H',mod:'',gender:'',backgroundId:'',note:'Baseline before new wants',lucky:false,shiny:false,xxl:false,xxs:false}],updatedAt:AT-5000},{seenAt:AT-5000,targetUid:'synthetic_friend_uid'});
  store.rememberOpened('SyntheticRecent',{version:1,username:'SyntheticRecent',profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:AT-1000},lists:{...lists,wishlist:{'A-Raichu':'M'}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:AT-1000},AT-1000);
  const profile={friendCode:'1234 5678 9012',bio:'Synthetic account; no real trainer',discord:'synthetic-example',avatarPokemon:'Pikachu',wallpaper:'mono'};
  const declared=wants.map(item=>{
    const entry=catalogEntries.find(value=>value.catalogId===item.identity.catalogId),v=item.values;
    return{intent:'lf',category:CATEGORIES_FOR_FIXTURE(item.identity.lane),name:entry.name,p:v.priority,mod:v.variant,gender:v.gender,backgroundId:'',note:v.note,lucky:v.lucky,shiny:v.shiny,xxl:v.xxl,xxs:v.xxs};
  });
  const gate=api.publication.createPublicSharePublicationGate(),token=gate.activate({uid:OWNER,username:HANDLE}).token;
  for(const surface of api.publication.REQUIRED_SOURCE_SURFACES)gate.markLoaded(token,surface);
  const published=api.publication.buildPublicShareSnapshot({gate,token,trigger:'explicit_share',username:HANDLE,source:{users:{[HANDLE]:profile},wishlist:{},dynamax:{},gmax:{},costumes:{}},declarations:declared,now:AT});
  if(!published.ok)throw new Error(published.error.code);
  const proof=(evidenceId,kind)=>({evidenceId,ownerUid:OWNER,kind,observedAt:AT});
  const evidence=[proof('synthetic-meta-proof','canonical-meta'),proof('synthetic-index-proof','auth-index-pair'),proof('synthetic-current-alias','alias-proof'),proof('synthetic-prior-alias','alias-proof'),proof('synthetic-pin-link','access-link'),proof('synthetic-google-link','access-link'),proof('synthetic-retired-fence','retired-uid-fence')];
  const provenance={accountId:OWNER,ownerUid:OWNER,currentHandle:HANDLE,authority:'accountSync-v1',evidence,aliases:[{handle:HANDLE,ownerUid:OWNER,validFrom:AT-1000,validUntil:null,evidenceId:'synthetic-current-alias'},{handle:'SyntheticPriorHandle',ownerUid:OWNER,validFrom:AT-5000,validUntil:AT-1001,evidenceId:'synthetic-prior-alias'}],accessMethods:[{kind:'legacy-pin',ownerUid:OWNER,state:'linked',providerSubjectKey:null,credentialEpoch:2,observedAt:AT,evidenceId:'synthetic-pin-link'},{kind:'google',ownerUid:OWNER,state:'linked',providerSubjectKey:sha256('synthetic-google-subject'),credentialEpoch:0,observedAt:AT,evidenceId:'synthetic-google-link'}],retiredUids:[{uid:'synthetic_retired_uid',replacementUid:OWNER,retiredAt:AT-1000,evidenceId:'synthetic-retired-fence'}]};
  const migrationPlan=await api.migration.buildMigrationPlan({ownerUid:OWNER,username:HANDLE,deviceInstallId:'device_'+ '1'.repeat(32),favorites:[{displayName:'SyntheticDormantFriend',tagIds:[]}],tags:{},remoteCanonical:[...wants,favorite,...tags],canonicalInitialized:true},{resolveFavoriteUid:async()=>null});
  if(!migrationPlan.ok||migrationPlan.recoveryCandidates.length!==1)throw new Error('Expected a real unresolved Favorite recovery candidate');
  const unresolved=clone(migrationPlan.recoveryCandidates[0]);
  const migrationRecord={schemaVersion:1,ownerUid:OWNER,deviceMigrationId:migrationPlan.deviceMigrationId,sourceFingerprint:migrationPlan.sourceFingerprint,deviceInstallHash:sha256('synthetic-device-install'),createdAt:AT-500,completedAt:AT-400,seedCount:0,candidateCount:1,verified:true,legacyRetained:true};
  const review={schemaVersion:1,kind:'recovery-review-acceptance',ownerUid:OWNER,trainerUsername:HANDLE,evidenceFingerprint:sha256('synthetic-prior-evidence-set'),candidateCount:1,acceptedAt:AT-100};
  const journal={entities:[{key:`${OWNER}|tradeEntry|${optimistic.entityId}`,ownerUid:OWNER,entityType:'tradeEntry',entityId:optimistic.entityId,entity:optimistic}],operations:[queueRecord(pendingOperation,'pending'),queueRecord(conflictOperation,'conflict')],conflicts:conflictResult.conflicts.map(item=>({...clone(item),key:`${OWNER}|${item.conflictId}`})),recoveryCandidates:[{...unresolved,key:`${OWNER}|${unresolved.candidateId}`} ],meta:[{key:`${OWNER}|provider-profile-pending-v1`,ownerUid:OWNER,name:'provider-profile-pending-v1',value:{schemaVersion:1,ownerUid:OWNER,values:{friendCode:profile.friendCode,bio:'Device-only profile choice',discord:profile.discord,avatarPokemon:profile.avatarPokemon},baseRevision:2,queuedAt:AT+100}}]};
  journal.meta.push({key:`${OWNER}|migration-complete`,ownerUid:OWNER,name:'migration-complete',value:migrationRecord});
  journal.meta.push({key:`${OWNER}|legacy-source:${migrationRecord.deviceMigrationId}`,ownerUid:OWNER,name:`legacy-source:${migrationRecord.deviceMigrationId}`,value:{capturedAt:AT-600,legacyRemoteLists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},legacyLocalLists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},legacyRemoteBoard:{lf:[],ft:[]},legacyLocalBoard:{lf:[],ft:[]},legacyQueue:{},orders:{},favorites:[{key:'syntheticdormantfriend',displayName:'SyntheticDormantFriend',tagIds:[],createdAt:AT-1000,updatedAt:AT-1000}],tags:{}}});
  return{
    synthetic:true,capturedAt:CAPTURED_AT,snapshotId:'synthetic-capture-001',sourceCommit:SOURCE_COMMIT,
    identity:{provenance,authIndex:{[OWNER]:{username:HANDLE,accountSyncRecoveryReviews:{[review.evidenceFingerprint]:review}}},userRecord:{authUid:OWNER,authVersion:2,authEmail:'synthetic-derived-address@example.invalid',pin:SECRET_MARKERS[0],pinHashed:false,...profile,lastUpdated:AT},credentials:{password:SECRET_MARKERS[1],refreshToken:SECRET_MARKERS[2],idToken:SECRET_MARKERS[3],privateKey:SECRET_MARKERS[4],pinHash:SECRET_MARKERS[5]}},
    catalog:{version:'synthetic-reviewed-v1',entries:catalogEntries},
    accountSync:{migrations:{[migrationRecord.deviceMigrationId]:migrationRecord},recoveryCandidates:{[unresolved.candidateId]:unresolved},meta:{schemaVersion:1,ownerUid:OWNER,featureVersion:1,initialized:true,initializedAt:AT-2000,updatedAt:AT},tradeEntries:Object.fromEntries([...wants,ft,tombstone].map(item=>[item.entityId,item])),favorites:{[favorite.entityId]:favorite},tags:Object.fromEntries(tags.map(item=>[item.entityId,item]))},
    publicShare:clone(published.snapshot),
    devices:[{deviceId:'synthetic-known-device-1',ownerUid:OWNER,capturedAt:CAPTURED_AT,sourceVersions:{journal:1,history:3,sessionCache:2,legacyQueue:2,order:1},history:clone(store.read()),journal,legacyQueue:{entries:[{kind:'my-list-update',path:`wishlist/${HANDLE}`,data:{Pikachu:'L','A-Raichu':null},ts:AT+150}],quarantined:[{kind:'set',path:`wishlist/${HANDLE}`,data:{Pikachu:'M'},ts:AT-100}]},cachedOwnedLists:{wishlist:{Pikachu:'L'},dynamax:{},gmax:{},costumes:{}},orders:[{lane:'wishlist',version:1,owner:{uid:OWNER,username:HANDLE},priorities:{H:['Pikachu'],M:['A-Raichu'],L:[],U:[]}}],viewedSnapshots:[{lane:'wishlist',trainerName:'SyntheticFriend',keys:['Pikachu'],values:{Pikachu:'H'},savedAt:AT-5000}],preferences:{language:'de',theme:'dark',searchLocale:'de',exportStyle:'compact',safeTransferDefault:true},browserCredentials:{firebaseAuth:SECRET_MARKERS[2],sessionHint:HANDLE}}],
    historical:[{recordId:'synthetic-old-inventory',ownerUid:OWNER,kind:'inventory',sourcePath:`have/${HANDLE}/Pikachu::f`,disposition:'inert-only',value:{name:'Pikachu',gender:'f',qty:9,mirrorOnly:false,dontNeedBack:true,giveaway:false,note:'Retired inventory note',backgroundId:'synthetic-old-city-background',shiny:true,lucky:false,xxl:false,xxs:false}},{recordId:'synthetic-old-trade',ownerUid:OWNER,kind:'trade',sourcePath:'trades/synthetic-trade-1',disposition:'inert-only',value:{tradeId:'synthetic-trade-1',partnerHandle:'SyntheticFriend',pokemonName:'Pikachu',quantity:2,status:'completed',note:'Historical trade agreement',scheduledAt:AT-50000}},{recordId:'synthetic-old-background',ownerUid:OWNER,kind:'background',sourcePath:`backgrounds/${HANDLE}/synthetic-old`,disposition:'inert-only',value:{name:'Pikachu',backgroundId:'synthetic-old-city-background',note:'Preserve without enabling a background product'}}]
  };
}
function CATEGORIES_FOR_FIXTURE(lane){return['wishlist','dynamax','gmax','costumes'].includes(lane)?lane:'wishlist';}
module.exports={makeSource,loadCurrentContracts,OWNER,HANDLE,AT,CAPTURED_AT,SOURCE_COMMIT,SECRET_MARKERS};
