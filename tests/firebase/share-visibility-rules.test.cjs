const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');

const PROJECT_ID='demo-pogo-share-visibility';
const DATABASE_HOST='127.0.0.1:9200';
const AUTH_HOST='127.0.0.1:9299';
const DATABASE_NAMESPACE=`${PROJECT_ID}-default-rtdb`;
const IDS={};
const TOKENS={};

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,body:await response.text()};
}
async function createUser(name){
  const response=await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name}@example.test`,password:`${name}-password-123`,returnSecureToken:true});
  assert.equal(response.status,200,response.body);
  const body=JSON.parse(response.body);IDS[name]=body.localId;TOKENS[name]=body.idToken;
}
function dbUrl(target='',token){
  const clean=String(target).replace(/^\/+|\/+$/g,'');
  const url=new URL(`http://${DATABASE_HOST}/${clean?`${clean}.json`:'.json'}`);
  url.searchParams.set('ns',DATABASE_NAMESPACE);if(token)url.searchParams.set('auth',token);return url;
}
function db(method,target,value,actor){
  const owner=actor==='emulator-owner';
  return request(dbUrl(target,owner?undefined:actor),method,value,owner?{authorization:'Bearer owner'}:{});
}
async function succeeds(promise,label){const response=await promise;assert.ok(response.status>=200&&response.status<300,`${label}: ${response.status} ${response.body}`);return response;}
async function fails(promise,label){const response=await promise;assert.ok(response.status===401||response.status===403,`${label}: expected denial, got ${response.status} ${response.body}`);return response;}
function projection(name='OwnerTrainer'){
  return{schemaVersion:1,shareVersion:1,trainerName:name,profile:{bio:'Published'},lists:{wishlist:{Pikachu:'H'}},publishedListTypes:{wishlist:true,dynamax:true,gmax:true,costumes:true},publishedAt:100,updatedAt:100};
}
function operationId(suffix){return`operation-${String(suffix).padStart(7,'0')}`;}
function favoriteRecord(name='OtherTrainer',revision=1,updatedAt=100){return{trainerName:name,addedAt:100,revision,updatedAt,operationId:operationId(revision),deleted:false};}
function tagRecord({label='Lucky',key='tag_lucky',revision=1,updatedAt=100,active=true}={}){return{label,normalizedLabel:label.toLowerCase(),labelKey:key,active,createdAt:100,updatedAt,revision,operationId:operationId(`tag${revision}`),deleted:!active,...(!active?{deletedAt:updatedAt}:{})};}
function recentRecord(revision=1,lastOpenedAt=100){return{ownerUid:IDS.other,trainerName:'OtherTrainer',lastOpenedAt,revision,operationId:operationId(`recent${revision}`)};}
function historyRecord(revision=1,version=5,updatedAt=500){return{lastSeenShareVersion:version,lastSeenUpdatedAt:updatedAt,lastSeenFingerprint:`version-${version}`,entryCount:1,lastSeenSnapshot:{Pikachu:{category:'wishlist',fingerprint:'a'}},revision,operationId:operationId(`history${revision}`)};}
async function seed(){
  await succeeds(db('PUT','',{
    admins:{[IDS.admin]:true},
    shareVisibilityConfig:{writesEnabled:false,legacyCompatEnabled:true},
    trainerPreferencesConfig:{writesEnabled:false,readsEnabled:false},
    accounts:{[IDS.owner]:{trainerName:'OwnerTrainer',normalizedTrainerName:'ownertrainer'}},
    loginDirectory:{OwnerTrainer:{authReady:true}},
    users:{OwnerTrainer:{authUid:IDS.owner,isOwner:true,isAdmin:true}},
    wishlist:{OwnerTrainer:{PrivatePokemon:'H'}},
    shareVisibility:{[IDS.owner]:{mode:'public',updatedAt:100}},
    shareAccess:{[IDS.owner]:{[IDS.approved]:true}},
    shareDirectory:{ownertrainer:{ownerUid:IDS.owner,trainerName:'OwnerTrainer',state:'published'}},
    trainerShares:{[IDS.owner]:projection()},
    legacyShareOwners:{OwnerTrainer:IDS.owner},
    publicShares:{OwnerTrainer:{version:1,username:'OwnerTrainer',profile:{bio:'Published'},lists:{wishlist:{Pikachu:'H'}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:100}}
  },'emulator-owner'),'seed fixture');
}
async function enableWrites(){await succeeds(db('PUT','shareVisibilityConfig/writesEnabled',true,TOKENS.admin),'admin enables emulator-only writes');}
async function enablePreferences(){
  await succeeds(db('PUT','trainerPreferencesConfig/writesEnabled',true,TOKENS.admin),'admin enables emulator-only preference writes');
  await succeeds(db('PUT','trainerPreferencesConfig/readsEnabled',true,TOKENS.admin),'admin enables emulator-only preference reads');
}

before(async()=>{for(const name of ['owner','approved','other','admin'])await createUser(name);});
beforeEach(async()=>{await succeeds(db('PUT','',null,'emulator-owner'),'clear fixture');await seed();});
after(async()=>{await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,'DELETE');});

test('root and protected parent reads cannot bypass child visibility',async()=>{
  await fails(db('GET','',undefined,TOKENS.other),'authenticated root read');
  for(const path of ['trainerShares','shareVisibility','shareAccess','legacyShareOwners','users','wishlist'])await fails(db('GET',path,undefined,TOKENS.other),`parent ${path}`);
  await fails(db('GET','shareDirectory',undefined),'anonymous directory enumeration');
  await succeeds(db('GET','shareDirectory/ownertrainer',undefined),'anonymous exact directory lookup');
});

test('anonymous user reads public share but not visibility metadata',async()=>{
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined),'anonymous public share');
  await fails(db('GET',`shareVisibility/${IDS.owner}/mode`,undefined),'anonymous mode metadata');
});

test('anonymous and unapproved users cannot read approved-viewer or private shares',async()=>{
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'approved_viewers','emulator-owner'),'seed approved-viewer mode');
  await fails(db('GET',`trainerShares/${IDS.owner}`,undefined),'anonymous approved-viewer share');
  await fails(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.other),'unapproved approved-viewer share');
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'private','emulator-owner'),'seed private mode');
  await fails(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.approved),'approved viewer private share');
});

test('approved viewer reads restricted share and revocation takes effect immediately',async()=>{
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'approved_viewers','emulator-owner'),'seed approved-viewer mode');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.approved),'approved viewer');
  await succeeds(db('DELETE',`shareAccess/${IDS.owner}/${IDS.approved}`,undefined,'emulator-owner'),'revoke viewer');
  await fails(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.approved),'revoked viewer');
});

test('owner and protected admin always read the share',async()=>{
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'private','emulator-owner'),'seed private mode');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.owner),'owner private read');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.admin),'admin private read');
});

test('owner manages own mode and grants; ordinary users cannot self-grant or modify another owner',async()=>{
  await enableWrites();
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}`,{mode:'approved_viewers',updatedAt:200},TOKENS.owner),'owner changes mode');
  await succeeds(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.owner),'owner grants viewer');
  await fails(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.other),'viewer self grant');
  await fails(db('PUT',`shareVisibility/${IDS.owner}`,{mode:'public',updatedAt:201},TOKENS.other),'other changes visibility');
});

test('protected admin manages visibility and grants',async()=>{
  await enableWrites();
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}`,{mode:'private',updatedAt:200},TOKENS.admin),'admin mode change');
  await succeeds(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.admin),'admin grant');
});

test('owner and admin publish only complete allowlisted projections',async()=>{
  await enableWrites();
  const ownerProjection={...projection(),shareVersion:2,updatedAt:200};
  await succeeds(db('PUT',`trainerShares/${IDS.owner}`,ownerProjection,TOKENS.owner),'owner complete projection');
  await succeeds(db('PUT',`trainerShares/${IDS.owner}`,{...ownerProjection,shareVersion:3,updatedAt:201},TOKENS.admin),'admin complete projection');
  const incomplete={...ownerProjection,shareVersion:4,updatedAt:202};delete incomplete.publishedListTypes;
  await fails(db('PUT',`trainerShares/${IDS.owner}`,incomplete,TOKENS.owner),'missing completeness marker');
  await fails(db('PUT',`trainerShares/${IDS.owner}`,{...ownerProjection,shareVersion:4,updatedAt:202,privateInventory:{Pikachu:4}},TOKENS.owner),'private field projection');
  await fails(db('PUT',`trainerShares/${IDS.owner}`,{...ownerProjection,shareVersion:4,updatedAt:202},TOKENS.other),'other user projection');
});

test('legacy profile flags and similar usernames confer no authority',async()=>{
  await succeeds(db('PUT',`users/OtherTrainer`,{authUid:IDS.other,isOwner:true,isAdmin:true},'emulator-owner'),'seed legacy flags');
  await enableWrites();
  await fails(db('PUT',`shareVisibility/${IDS.owner}`,{mode:'private',updatedAt:200},TOKENS.other),'legacy flags authority');
  await fails(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.other),'legacy flags self grant');
});

test('username changes do not alter UID-owned access',async()=>{
  await succeeds(db('PUT',`accounts/${IDS.owner}/trainerName`,'RenamedTrainer','emulator-owner'),'rename display handle in isolated fixture');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined,TOKENS.owner),'owner access after rename');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined),'public access after rename');
});

test('private share leaks no projection or list metadata',async()=>{
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'private','emulator-owner'),'seed private mode');
  for(const target of [`trainerShares/${IDS.owner}`,`trainerShares/${IDS.owner}/lists`,`trainerShares/${IDS.owner}/updatedAt`,`trainerShares/${IDS.owner}/publishedListTypes`]){
    await fails(db('GET',target,undefined,TOKENS.other),`private metadata ${target}`);
  }
  const mode=await succeeds(db('GET',`shareVisibility/${IDS.owner}/mode`,undefined,TOKENS.other),'authenticated mode lookup');
  assert.equal(JSON.parse(mode.body),'private');
});

test('legacy public link compatibility remains unchanged across future visibility modes',async()=>{
  await succeeds(db('GET','publicShares/OwnerTrainer',undefined),'legacy public link');
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'approved_viewers','emulator-owner'),'restrict link');
  await succeeds(db('GET','publicShares/OwnerTrainer',undefined),'anonymous legacy link remains compatible');
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'public','emulator-owner'),'restore public mode');
  await succeeds(db('GET','publicShares/OwnerTrainer',undefined),'restored legacy link');
});

test('legacy compatibility preserves exact links while parent enumeration stays denied',async()=>{
  await succeeds(db('PUT','publicShares/Unmapped',{username:'Unmapped'},'emulator-owner'),'seed unmapped legacy record');
  await succeeds(db('GET','publicShares/Unmapped',undefined),'unmapped exact legacy record');
  await fails(db('GET','publicShares',undefined),'legacy parent enumeration');
});

test('missing projection remains unpublished and private lists are never a fallback',async()=>{
  await succeeds(db('DELETE',`trainerShares/${IDS.owner}`,undefined,'emulator-owner'),'remove projection');
  await succeeds(db('GET',`trainerShares/${IDS.owner}`,undefined),'authorized empty exact node');
  await fails(db('GET','wishlist/OwnerTrainer',undefined,TOKENS.other),'other trainer private wishlist');
  await fails(db('GET','users/OwnerTrainer',undefined,TOKENS.other),'other trainer private profile');
});

test('writes are denied while the feature gate is false',async()=>{
  await fails(db('PUT',`shareVisibility/${IDS.owner}`,{mode:'private',updatedAt:200},TOKENS.owner),'disabled visibility write');
  await fails(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.owner),'disabled grant write');
  await fails(db('PUT',`trainerShares/${IDS.owner}`,projection(),TOKENS.owner),'disabled projection write');
});

test('disabled gates prevent ordinary account directory compatibility and preference seeding',async()=>{
  await fails(db('PUT',`accounts/${IDS.other}`,{trainerName:'OtherTrainer',normalizedTrainerName:'othertrainer'},TOKENS.other),'disabled account seed');
  await fails(db('PUT','shareDirectory/othertrainer',{ownerUid:IDS.other,trainerName:'OtherTrainer',state:'published'},TOKENS.other),'disabled directory seed');
  await fails(db('PUT','legacyShareOwners/OtherTrainer',IDS.other,TOKENS.other),'disabled compatibility seed');
  await fails(db('PUT',`userPreferences/${IDS.other}/favoriteTrainers/${IDS.owner}`,{trainerName:'OwnerTrainer',addedAt:100},TOKENS.other),'disabled preference seed');
  await fails(db('PUT','shareVisibilityConfig/writesEnabled',true,TOKENS.other),'ordinary visibility gate enable');
  await fails(db('PUT','trainerPreferencesConfig/writesEnabled',true,TOKENS.other),'ordinary preference gate enable');
});

test('private preference reads remain disabled until the exact read gate is enabled',async()=>{
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favoriteRecord(),'emulator-owner'),'trusted disabled preference fixture');
  await fails(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.owner),'disabled owner preference read');
  await succeeds(db('PUT','trainerPreferencesConfig/readsEnabled',true,TOKENS.admin),'admin enables emulator-only preference reads');
  await succeeds(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.owner),'enabled exact owner preference read');
  await fails(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.other),'enabled cross-owner preference read');
});

test('parent and query reads cannot bypass exact future visibility rules',async()=>{
  for(const target of ['shareDirectory','trainerShares','shareVisibility','shareAccess','userPreferences']){
    await fails(db('GET',target,undefined,TOKENS.other),`parent enumeration ${target}`);
    const url=dbUrl(target,TOKENS.other);url.searchParams.set('orderBy','"$key"');url.searchParams.set('limitToFirst','1');
    await fails(request(url),'queried parent enumeration');
  }
});

test('future group paths are reserved and inactive',async()=>{
  await fails(db('GET',`groups/group-a`,undefined,TOKENS.owner),'group read');
  await fails(db('PUT',`shareGroupAccess/${IDS.owner}/group-a`,true,TOKENS.owner),'group grant write');
});

test('viewer alone owns private preferences; other users and admins cannot read or enumerate them',async()=>{
  await enablePreferences();
  const favorite=favoriteRecord('ApprovedTrainer');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.approved}`,favorite,TOKENS.owner),'direct owner favorite write');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.approved}`,favorite,'emulator-owner'),'trusted fixture creates favorite');
  await succeeds(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.owner),'owner reads preferences');
  await fails(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.other),'other reads preferences');
  await fails(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.admin),'admin reads preferences');
  await fails(db('GET','userPreferences',undefined,TOKENS.other),'other enumerates preferences');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favorite,TOKENS.other),'other writes preferences');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favorite,TOKENS.admin),'admin writes preferences');
});

test('preference metadata requires schema one, bounded declared counts, and monotonic revisions',async()=>{
  await enablePreferences();
  const metadata={schemaVersion:1,revision:1,updatedAt:100,favoriteCount:1,tagCount:0,lastSuccessfulSyncAt:0,migrationState:'not-started',migrationFingerprint:''};
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/metadata`,metadata,TOKENS.owner),'valid metadata');
  await fails(db('DELETE',`userPreferences/${IDS.owner}/metadata`,undefined,TOKENS.owner),'physical metadata delete');
  await fails(db('PUT',`userPreferences/${IDS.owner}/metadata`,{...metadata,schemaVersion:2,revision:2,updatedAt:200},TOKENS.owner),'unsupported server schema');
  await fails(db('PUT',`userPreferences/${IDS.owner}/metadata`,{...metadata,revision:2,updatedAt:200,favoriteCount:101},TOKENS.owner),'favorite count bound');
  await fails(db('PUT',`userPreferences/${IDS.owner}/metadata`,{...metadata,revision:2,updatedAt:200,tagCount:25},TOKENS.owner),'tag count bound');
  await fails(db('PUT',`userPreferences/${IDS.owner}/metadata`,{...metadata,revision:3,updatedAt:300},TOKENS.owner),'skipped metadata revision');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/metadata`,{...metadata,revision:2,updatedAt:200,migrationState:'verified',migrationFingerprint:'prefs_12345678'},TOKENS.owner),'verified metadata');
});

test('favorite entities are trusted-only and parent writes cannot bypass the boundary',async()=>{
  await enablePreferences();
  const target=`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favorite=favoriteRecord();
  await fails(db('PUT',target,favorite,TOKENS.owner),'direct favorite create');
  await succeeds(db('PUT',target,favorite,'emulator-owner'),'trusted fixture favorite create');
  await fails(db('DELETE',target,undefined,TOKENS.owner),'direct physical favorite delete');
  await fails(db('PUT',target,{...favorite,revision:3,updatedAt:300,operationId:operationId(3)},TOKENS.owner),'direct favorite revision change');
  const tombstone={...favorite,revision:2,updatedAt:200,operationId:operationId(2),deleted:true,deletedAt:200};
  await succeeds(db('PUT',target,tombstone,'emulator-owner'),'trusted fixture favorite tombstone');
  await fails(db('PUT',target,{...favorite,revision:2,updatedAt:250,operationId:operationId('stale')},TOKENS.owner),'direct stale edit after deletion');
  await enableWrites();
  const ownFavorite=`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.approved}`;
  const attacks=[
    {[ownFavorite]:favoriteRecord('ApprovedTrainer'),[`userPreferences/${IDS.other}/favoriteTrainers/${IDS.owner}`]:favoriteRecord('OwnerTrainer')},
    {[ownFavorite]:favoriteRecord('ApprovedTrainer'),[`publicShares/OtherTrainer/updatedAt`]:999},
    {[ownFavorite]:favoriteRecord('ApprovedTrainer'),[`authIndex/${IDS.other}/username`]:'OwnerTrainer'},
    {[ownFavorite]:favoriteRecord('ApprovedTrainer'),[`shareAccess/${IDS.other}/${IDS.owner}`]:true},
    {[`userPreferences/${IDS.owner}/trainerTagLabels/tag_attack`]:'tag-attack',[`unexpectedRoot/child`]:true},
    {[`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`]:historyRecord(),[`unexpectedRoot/child`]:true}
  ];
  for(const [index,attack] of attacks.entries()){
    await fails(db('PATCH','',attack,TOKENS.owner),`atomic multi-location attack ${index+1}`);
    const state=await succeeds(db('GET',ownFavorite,undefined,TOKENS.owner),`atomic rollback ${index+1}`);assert.equal(state.body,'null');
  }
  await fails(db('PUT',`userPreferences/${IDS.owner}`,{favoriteTrainers:{[IDS.approved]:favoriteRecord()},unknown:{nested:true}},TOKENS.owner),'higher-level validation bypass');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers`,{[IDS.approved]:favoriteRecord(),unexpected:{nested:true}},TOKENS.owner),'favorite parent validation bypass');
});

test('personal favorites and Approved Viewer grants remain independent',async()=>{
  await enablePreferences();await enableWrites();
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favoriteRecord(),'emulator-owner'),'trusted personal favorite fixture');
  const noGrant=await succeeds(db('GET',`shareAccess/${IDS.owner}/${IDS.other}`,undefined,TOKENS.owner),'owner reads absent grant');
  assert.equal(noGrant.body,'null');
  await succeeds(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.owner),'approved viewer grant');
  const noReverseFavorite=await succeeds(db('GET',`userPreferences/${IDS.other}/favoriteTrainers/${IDS.owner}`,undefined,TOKENS.other),'viewer reads absent favorite');
  assert.equal(noReverseFavorite.body,'null');
});

test('tag claims are trusted-only while owner metadata assignments remain private and exact',async()=>{
  await enablePreferences();
  const tagId='tag-a',firstKey='tag_lucky',nextKey='tag_raid',root=`userPreferences/${IDS.owner}`;
  await fails(db('PUT',`${root}/trainerTagLabels/${firstKey}`,tagId,TOKENS.owner),'client cannot claim tag label');
  await fails(db('PUT',`${root}/trainerTags/${tagId}`,tagRecord({key:firstKey}),TOKENS.owner),'client cannot create tag');
  await succeeds(db('PUT',`${root}/trainerTagLabels/${firstKey}`,tagId,'emulator-owner'),'trusted fixture claims tag label');
  await succeeds(db('PUT',`${root}/trainerTags/${tagId}`,tagRecord({key:firstKey}),'emulator-owner'),'trusted fixture creates tag');
  const metadata={tagIds:{[tagId]:true},revision:1,updatedAt:100,operationId:operationId('meta1'),deleted:false};
  await succeeds(db('PUT',`${root}/trainerMetadata/${IDS.other}`,metadata,TOKENS.owner),'assign tag');
  await fails(db('DELETE',`${root}/trainerMetadata/${IDS.other}`,undefined,TOKENS.owner),'physical trainer metadata delete');
  await succeeds(db('PUT',`${root}/trainerMetadata/${IDS.other}`,{...metadata,tagIds:{},revision:2,updatedAt:200,operationId:operationId('meta2')},TOKENS.owner),'remove assignment');
  await fails(db('PUT',`${root}/trainerTags/${tagId}`,tagRecord({label:'Raid',key:nextKey,revision:2,updatedAt:200}),TOKENS.owner),'client cannot rename tag');
  await succeeds(db('PUT',`${root}/trainerTagLabels/${nextKey}`,tagId,'emulator-owner'),'trusted fixture claims renamed label');
  await succeeds(db('PUT',`${root}/trainerTags/${tagId}`,tagRecord({label:'Raid',key:nextKey,revision:2,updatedAt:200}),'emulator-owner'),'trusted fixture renames tag');
  await succeeds(db('DELETE',`${root}/trainerTagLabels/${firstKey}`,undefined,'emulator-owner'),'trusted fixture releases old label');
  await succeeds(db('DELETE',`${root}/trainerTagLabels/${nextKey}`,undefined,'emulator-owner'),'trusted fixture releases deleted label');
  await succeeds(db('PUT',`${root}/trainerTags/${tagId}`,tagRecord({label:'Raid',key:nextKey,revision:3,updatedAt:300,active:false}),'emulator-owner'),'trusted fixture soft deletes tag');
  await fails(db('PUT',`${root}/trainerMetadata/${IDS.other}`,{...metadata,revision:3,updatedAt:300,operationId:operationId('meta3')},TOKENS.owner),'assign inactive tag');
  await fails(db('DELETE',`${root}/trainerTags/${tagId}`,undefined,TOKENS.owner),'physical tag delete');
});

test('direct normalized tag claims and foreign-namespace assignments are denied',async()=>{
  await enablePreferences();
  const key='tag_00006c-00006f-000063-000061-00006c';
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${key}`,'tag-a',TOKENS.owner),'direct first claim');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${key}`,'tag-a','emulator-owner'),'trusted fixture first claim');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${key}`,'tag-b',TOKENS.owner),'duplicate normalized claim');
  await succeeds(db('PUT',`userPreferences/${IDS.approved}/trainerTagLabels/${key}`,'tag-foreign','emulator-owner'),'trusted fixture foreign label claim');
  await succeeds(db('PUT',`userPreferences/${IDS.approved}/trainerTags/tag-foreign`,tagRecord({label:'Local',key}),'emulator-owner'),'trusted fixture foreign tag');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerMetadata/${IDS.other}`,{tagIds:{'tag-foreign':true},revision:1,updatedAt:100,operationId:operationId('foreign'),deleted:false},TOKENS.owner),'foreign namespace assignment');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerMetadata/${IDS.other}`,{note:'removed',tagIds:{},revision:1,updatedAt:100,operationId:operationId('note-field'),deleted:false},TOKENS.owner),'removed note field');
});

test('recent trainer slots are structurally capped at thirty',async()=>{
  await enablePreferences();
  const valid=recentRecord();
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/00`,valid,TOKENS.owner),'valid recent slot');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/29`,{...recentRecord(),ownerUid:IDS.approved,trainerName:'ApprovedTrainer',lastOpenedAt:200},TOKENS.owner),'last valid recent slot');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/00`,{...valid,lastOpenedAt:90,revision:2,operationId:operationId('recent2')},TOKENS.owner),'stale recent activity');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/30`,valid,TOKENS.owner),'overflow recent slot');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/arbitrary`,valid,TOKENS.owner),'arbitrary recent key');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/0`,valid,TOKENS.owner),'malformed recent key');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/01`,{...valid,overflow:{nested:true}},TOKENS.owner),'nested recent overflow');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots`,{'00':valid,'30':valid},TOKENS.owner),'parent write cannot bypass slot keys');
});

test('history writes remain trusted-only while exact owner reads stay private',async()=>{
  await enablePreferences();
  const history=historyRecord();
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,history,TOKENS.owner),'direct history write');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,history,'emulator-owner'),'trusted fixture history write');
  const next={...history,revision:2,operationId:operationId('history2'),lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'version-6'};
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,next,TOKENS.owner),'direct history advance');
  const ownState=await succeeds(db('GET',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,undefined,TOKENS.owner),'owner reads trusted history');
  assert.equal(JSON.parse(ownState.body).entryCount,history.entryCount);
  const otherState=await succeeds(db('GET',`userPreferences/${IDS.other}/trainerHistory/${IDS.owner}`,undefined,TOKENS.other),'other viewer unaffected');
  assert.equal(otherState.body,'null');
});

test('preference writes are denied while synced-preference gate is false',async()=>{
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favoriteRecord(),TOKENS.owner),'disabled favorite write');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/00`,recentRecord(),TOKENS.owner),'disabled recent write');
});
