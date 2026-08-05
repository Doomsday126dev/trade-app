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
async function seed(){
  await succeeds(db('PUT','',{
    admins:{[IDS.admin]:true},
    shareVisibilityConfig:{writesEnabled:false,legacyCompatEnabled:true},
    trainerPreferenceConfig:{writesEnabled:false},
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
async function enablePreferences(){await succeeds(db('PUT','trainerPreferenceConfig/writesEnabled',true,TOKENS.admin),'admin enables emulator-only preference writes');}

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

test('legacy public link works only while mapped owner mode is public',async()=>{
  await succeeds(db('GET','publicShares/OwnerTrainer',undefined),'legacy public link');
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'approved_viewers','emulator-owner'),'restrict link');
  await fails(db('GET','publicShares/OwnerTrainer',undefined),'anonymous legacy approved-viewer link');
  await succeeds(db('PUT',`shareVisibility/${IDS.owner}/mode`,'public','emulator-owner'),'restore public mode');
  await succeeds(db('GET','publicShares/OwnerTrainer',undefined),'restored legacy link');
});

test('legacy compatibility does not expose unmapped or restricted records',async()=>{
  await succeeds(db('PUT','publicShares/Unmapped',{username:'Unmapped'},'emulator-owner'),'seed unmapped legacy record');
  await fails(db('GET','publicShares/Unmapped',undefined),'unmapped legacy record');
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

test('future group paths are reserved and inactive',async()=>{
  await fails(db('GET',`groups/group-a`,undefined,TOKENS.owner),'group read');
  await fails(db('PUT',`shareGroupAccess/${IDS.owner}/group-a`,true,TOKENS.owner),'group grant write');
});

test('viewer owns private preferences; other users cannot read or enumerate them',async()=>{
  await enablePreferences();
  const favorite={trainerName:'ApprovedTrainer',addedAt:100,note:'Private note'};
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.approved}`,favorite,TOKENS.owner),'owner creates favorite');
  await succeeds(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.owner),'owner reads preferences');
  await fails(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.other),'other reads preferences');
  await fails(db('GET','userPreferences',undefined,TOKENS.other),'other enumerates preferences');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favorite,TOKENS.other),'other writes preferences');
});

test('protected admin can read and manage private preferences',async()=>{
  await enablePreferences();
  const favorite={trainerName:'OtherTrainer',addedAt:100};
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,favorite,TOKENS.admin),'admin writes preference');
  await succeeds(db('GET',`userPreferences/${IDS.owner}`,undefined,TOKENS.admin),'admin reads preference');
});

test('personal favorites and Approved Viewer grants remain independent',async()=>{
  await enablePreferences();await enableWrites();
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,{trainerName:'OtherTrainer',addedAt:100},TOKENS.owner),'personal favorite');
  const noGrant=await succeeds(db('GET',`shareAccess/${IDS.owner}/${IDS.other}`,undefined,TOKENS.owner),'owner reads absent grant');
  assert.equal(noGrant.body,'null');
  await succeeds(db('PUT',`shareAccess/${IDS.owner}/${IDS.other}`,true,TOKENS.owner),'approved viewer grant');
  const noReverseFavorite=await succeeds(db('GET',`userPreferences/${IDS.other}/favoriteTrainers/${IDS.owner}`,undefined,TOKENS.other),'viewer reads absent favorite');
  assert.equal(noReverseFavorite.body,'null');
});

test('tag create, rename, assignment, removal, and soft deletion remain owner-private',async()=>{
  await enablePreferences();
  const tagId='tag-a',firstKey='tag_00006c-000075-000063-00006b-000079',nextKey='tag_000072-000061-000069-000064';
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${firstKey}`,tagId,TOKENS.owner),'claim label');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTags/${tagId}`,{label:'Lucky',normalizedLabel:'lucky',labelKey:firstKey,active:true,createdAt:100,updatedAt:100},TOKENS.owner),'create tag');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,{trainerName:'OtherTrainer',addedAt:100,tagIds:{[tagId]:true}},TOKENS.owner),'assign tag');
  await succeeds(db('DELETE',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}/tagIds/${tagId}`,undefined,TOKENS.owner),'remove assignment');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${nextKey}`,tagId,TOKENS.owner),'claim renamed label');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTags/${tagId}`,{label:'Raid',normalizedLabel:'raid',labelKey:nextKey,active:true,createdAt:100,updatedAt:200},TOKENS.owner),'rename tag');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTags/${tagId}`,{label:'Raid',normalizedLabel:'raid',labelKey:nextKey,active:false,createdAt:100,updatedAt:300},TOKENS.owner),'soft delete tag');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,{trainerName:'OtherTrainer',addedAt:100,tagIds:{[tagId]:true}},TOKENS.owner),'assign inactive tag');
});

test('duplicate normalized tag claims and foreign-namespace assignments are denied',async()=>{
  await enablePreferences();
  const key='tag_00006c-00006f-000063-000061-00006c';
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${key}`,'tag-a',TOKENS.owner),'first claim');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerTagLabels/${key}`,'tag-b',TOKENS.owner),'duplicate normalized claim');
  await succeeds(db('PUT',`userPreferences/${IDS.approved}/trainerTagLabels/${key}`,'tag-foreign',TOKENS.approved),'foreign label claim');
  await succeeds(db('PUT',`userPreferences/${IDS.approved}/trainerTags/tag-foreign`,{label:'Local',normalizedLabel:'local',labelKey:key,active:true,createdAt:100,updatedAt:100},TOKENS.approved),'foreign tag');
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,{trainerName:'OtherTrainer',addedAt:100,tagIds:{'tag-foreign':true}},TOKENS.owner),'foreign namespace assignment');
});

test('recent trainer slots are structurally capped at thirty',async()=>{
  await enablePreferences();
  const valid={ownerUid:IDS.other,trainerName:'OtherTrainer',lastOpenedAt:100};
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/00`,valid,TOKENS.owner),'valid recent slot');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/29`,{ownerUid:IDS.approved,trainerName:'ApprovedTrainer',lastOpenedAt:200},TOKENS.owner),'last valid recent slot');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/30`,valid,TOKENS.owner),'overflow recent slot');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/arbitrary`,valid,TOKENS.owner),'arbitrary recent key');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/0`,valid,TOKENS.owner),'malformed recent key');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/01`,{...valid,overflow:{nested:true}},TOKENS.owner),'nested recent overflow');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots`,{'00':valid,'30':valid},TOKENS.owner),'parent write cannot bypass slot keys');
});

test('declared history bounds, stale versions, and conflicting fingerprints are rejected',async()=>{
  await enablePreferences();
  const history={lastSeenShareVersion:5,lastSeenUpdatedAt:500,lastSeenFingerprint:'version-5',entryCount:1,lastSeenSnapshot:{Pikachu:{category:'wishlist',fingerprint:'a'}}};
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,history,TOKENS.owner),'initial seen state');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenShareVersion:4,lastSeenUpdatedAt:600},TOKENS.owner),'stale seen version');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenUpdatedAt:600,lastSeenFingerprint:'conflicting-version-5'},TOKENS.owner),'same-version fingerprint conflict');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'version-6',entryCount:-1},TOKENS.owner),'negative declared history count');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'version-6',entryCount:1501},TOKENS.owner),'oversized declared history count');
  await fails(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'version-6',entryCount:'1'},TOKENS.owner),'malformed declared history count');
  await succeeds(db('PUT',`userPreferences/${IDS.owner}/trainerHistory/${IDS.other}`,{...history,lastSeenShareVersion:6,lastSeenUpdatedAt:600,lastSeenFingerprint:'version-6'},TOKENS.owner),'advance seen state');
  const otherState=await succeeds(db('GET',`userPreferences/${IDS.other}/trainerHistory/${IDS.owner}`,undefined,TOKENS.other),'other viewer unaffected');
  assert.equal(otherState.body,'null');
});

test('preference writes are denied while synced-preference gate is false',async()=>{
  await fails(db('PUT',`userPreferences/${IDS.owner}/favoriteTrainers/${IDS.other}`,{trainerName:'OtherTrainer',addedAt:100},TOKENS.owner),'disabled favorite write');
  await fails(db('PUT',`userPreferences/${IDS.owner}/recentTrainerSlots/00`,{ownerUid:IDS.other,trainerName:'OtherTrainer',lastOpenedAt:100},TOKENS.owner),'disabled recent write');
});
