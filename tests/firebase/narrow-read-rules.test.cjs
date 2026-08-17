const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');

const PROJECT_ID=process.env.POGO_RULES_PROJECT_ID||'demo-pogo-narrow-read';
const DATABASE_HOST=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'127.0.0.1:9300';
const AUTH_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9399';
const DATABASE_NAMESPACE=`${PROJECT_ID}-default-rtdb`;
const IDS={};
const TOKENS={};
const NAMES={ordinary:'OrdinaryTrainer',other:'OtherTrainer',admin:'ProtectedAdmin'};

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,body:await response.text()};
}
async function createUser(name){
  const response=await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name}@example.test`,password:`${name}-password-123`,returnSecureToken:true});
  assert.equal(response.status,200,response.body);
  const body=JSON.parse(response.body);IDS[name]=body.localId;TOKENS[name]=body.idToken;
}
function dbUrl(target='',token,query={}){
  const clean=String(target).replace(/^\/+|\/+$/g,'');
  const url=new URL(`http://${DATABASE_HOST}/${clean?`${clean}.json`:'.json'}`);
  url.searchParams.set('ns',DATABASE_NAMESPACE);
  if(token)url.searchParams.set('auth',token);
  for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  return url;
}
function db(method,target,value,actor,query){
  const owner=actor==='emulator-owner';
  return request(dbUrl(target,owner?undefined:actor,query),method,value,owner?{authorization:'Bearer owner'}:{});
}
async function succeeds(promise,label){const response=await promise;assert.ok(response.status>=200&&response.status<300,`${label}: ${response.status} ${response.body}`);return response;}
async function fails(promise,label){const response=await promise;assert.ok(response.status===401||response.status===403,`${label}: expected denial, got ${response.status} ${response.body}`);return response;}
function parse(response){return response.body?JSON.parse(response.body):null;}
function user(uid,extra={}){return{authUid:uid,authEmail:'private@example.test',authVersion:1,isOwner:false,isAdmin:false,bio:'private',...extra};}
function publicShare(username,lists={wishlist:{Pikachu:'H'}}){return{version:1,username,profile:{bio:'public'},lists,publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:100};}

async function seed(){
  const ordinary=NAMES.ordinary,other=NAMES.other,admin=NAMES.admin;
  await succeeds(db('PUT','',{
    admins:{[IDS.admin]:true},
    loginDirectory:{[ordinary]:{authReady:true,authVersion:1},[other]:{authReady:true,authVersion:1},[admin]:{authReady:true,authVersion:1}},
    users:{[ordinary]:user(IDS.ordinary),[other]:user(IDS.other,{isOwner:true,isAdmin:true}),[admin]:user(IDS.admin,{isOwner:true,isAdmin:true}),UnboundTrainer:{authUid:'different-uid',isOwner:false,isAdmin:false}},
    authIndex:{[IDS.ordinary]:{username:ordinary,lastSeen:100},[IDS.other]:{username:other,lastSeen:100},[IDS.admin]:{username:admin,lastSeen:100}},
    wishlist:{[ordinary]:{Pikachu:'H'},[other]:{Eevee:'M'},[admin]:{Mewtwo:'L'}},
    dynamax:{[ordinary]:{Bulbasaur:'H'},[other]:{Charmander:'M'}},
    gmax:{[ordinary]:{Charizard:'L'},[other]:{Gengar:'H'}},
    costumes:{[ordinary]:{PartyPikachu:'M'},[other]:{HatEevee:'L'}},
    have:{[ordinary]:{Pikachu:{qty:2}},[other]:{Eevee:{qty:3}}},
    pendingDecrements:{[ordinary]:{decExisting:{from:other,qty:-1,key:'Pikachu'}}},
    publicShares:{[ordinary]:publicShare(ordinary),IncompleteTrainer:{version:1,username:'IncompleteTrainer',profile:{bio:'public'}}},
    requests:{req1:{username:'PendingTrainer',status:'pending',requestedAt:100}},
    offers:{[ordinary]:{offer1:{from:other,status:'pending'}}},
    trades:{trade1:{organizer:ordinary,participants:{[other]:true}}},
    communities:{nyc:{name:'NYC',memberUsernames:{[ordinary]:true,[other]:true},members:{[IDS.ordinary]:true,[IDS.other]:true}}},
    userCommunities:{[IDS.ordinary]:{nyc:{role:'member'}},[IDS.other]:{nyc:{role:'member'}},[IDS.admin]:{nyc:{role:'owner'}}},
    communityRequests:{nyc:{join1:{uid:IDS.other,status:'pending'}}},
    shareDirectory:{ordinarytrainer:{ownerUid:IDS.ordinary}},
    shareVisibility:{[IDS.ordinary]:{mode:'public'}},
    shareAccess:{[IDS.ordinary]:{[IDS.other]:true}},
    trainerShares:{[IDS.ordinary]:{schemaVersion:1,trainerName:ordinary}},
    trainerPreferencesConfig:{readsEnabled:true,writesEnabled:false},
    userPreferences:{[IDS.ordinary]:{favoriteTrainers:{[IDS.other]:{trainerName:other,addedAt:100}}}},
    accounts:{[IDS.ordinary]:{trainerName:ordinary}},
    privateProfiles:{[IDS.ordinary]:{email:'private@example.test'}},
    publicProfiles:{[IDS.ordinary]:{trainerName:ordinary}},
    publicLists:{[IDS.ordinary]:{wishlist:{Pikachu:'H'}}},
    unlistedShares:{share1:{ownerUid:IDS.ordinary}},
    groups:{group1:{members:{[IDS.ordinary]:true}}},
    shareGroupAccess:{[IDS.ordinary]:{group1:true}}
  },'emulator-owner'),'seed fixture');
}

before(async()=>{for(const name of ['ordinary','other','admin'])await createUser(name);});
beforeEach(async()=>{await succeeds(db('PUT','',null,'emulator-owner'),'clear fixture');await seed();});
after(async()=>{await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,'DELETE');});

test('anonymous directory and exact public shares remain readable without collection share enumeration',async()=>{
  await succeeds(db('GET','loginDirectory',undefined),'anonymous directory');
  await succeeds(db('GET',`publicShares/${NAMES.ordinary}`,undefined),'anonymous exact share');
  await fails(db('GET','publicShares',undefined),'anonymous share collection');
  await fails(db('GET','publicShares',undefined,undefined,{orderBy:'"$key"',limitToFirst:'1'}),'anonymous queried share collection');
});

test('public share compatibility covers authenticated reads, missing and incomplete projections, and realtime-equivalent access',async()=>{
  await succeeds(db('GET',`publicShares/${NAMES.ordinary}`,undefined,TOKENS.other),'authenticated exact share');
  const missing=await succeeds(db('GET','publicShares/MissingTrainer',undefined),'missing exact share');assert.equal(parse(missing),null);
  const incomplete=await succeeds(db('GET','publicShares/IncompleteTrainer',undefined),'incomplete exact share');assert.equal(parse(incomplete).lists,undefined);
  await succeeds(db('PUT',`publicShares/${NAMES.ordinary}/updatedAt`,200,'emulator-owner'),'simulate realtime update');
  const updated=await succeeds(db('GET',`publicShares/${NAMES.ordinary}`,undefined),'updated exact share');assert.equal(parse(updated).updatedAt,200);
  await fails(db('GET',`wishlist/${NAMES.ordinary}`,undefined,TOKENS.other),'no private fallback');
});

test('correct UID reads every exact username-owned active record',async()=>{
  for(const path of ['users','wishlist','dynamax','gmax','costumes','have'])await succeeds(db('GET',`${path}/${NAMES.ordinary}`,undefined,TOKENS.ordinary),`own ${path}`);
  await fails(db('GET',`users/${NAMES.ordinary}`,undefined),'logged-out profile');
});

test('wrong UID and legacy privileged profile flags cannot read another trainer records',async()=>{
  for(const path of ['users','wishlist','dynamax','gmax','costumes','have'])await fails(db('GET',`${path}/${NAMES.ordinary}`,undefined,TOKENS.other),`cross-owner ${path}`);
  await fails(db('GET',`wishlist/${NAMES.admin}`,undefined,TOKENS.other),'legacy owner and admin flags');
});

test('auth index reads are exact to the authenticated UID and cannot be enumerated',async()=>{
  await succeeds(db('GET',`authIndex/${IDS.ordinary}`,undefined,TOKENS.ordinary),'own auth index');
  await fails(db('GET',`authIndex/${IDS.other}`,undefined,TOKENS.ordinary),'foreign auth index');
  await fails(db('GET','authIndex',undefined,TOKENS.ordinary),'auth index parent');
  await fails(db('GET','authIndex',undefined,TOKENS.ordinary,{orderBy:'"$key"',limitToFirst:'1'}),'auth index query');
});

test('missing inconsistent spoofed and case-variant identity bindings fail closed',async()=>{
  await fails(db('GET','users/UnboundTrainer',undefined,TOKENS.ordinary),'inconsistent user binding');
  await fails(db('GET',`users/${NAMES.ordinary.toLowerCase()}`,undefined,TOKENS.ordinary),'case variant');
  await succeeds(db('PUT',`authIndex/${IDS.other}/username`,NAMES.ordinary,'emulator-owner'),'spoof stale index');
  await fails(db('GET',`wishlist/${NAMES.ordinary}`,undefined,TOKENS.other),'spoofed index grants nothing');
  await succeeds(db('DELETE',`users/${NAMES.ordinary}/authUid`,undefined,'emulator-owner'),'remove binding');
  await fails(db('GET',`users/${NAMES.ordinary}`,undefined,TOKENS.ordinary),'missing binding');
});

test('ordinary direct parent and query enumeration of private collections is denied',async()=>{
  const paths=['users','wishlist','dynamax','gmax','costumes','have','authIndex','userCommunities','pendingDecrements','requests','communities','communityRequests','offers','trades','admins'];
  await fails(db('GET','',undefined,TOKENS.ordinary),'root');
  for(const path of paths){
    await fails(db('GET',path,undefined,TOKENS.ordinary),`parent ${path}`);
    await fails(db('GET',path,undefined,TOKENS.ordinary,{orderBy:'"$key"',limitToFirst:'1'}),`query ${path}`);
  }
});

test('parent and shallow reads cannot infer private child existence',async()=>{
  for(const path of ['users','wishlist','have','authIndex','userCommunities','pendingDecrements'])await fails(db('GET',path,undefined,TOKENS.ordinary,{shallow:'true'}),`shallow ${path}`);
});

test('protected admin reads every explicitly registered Admin collection and removed admin loses access',async()=>{
  const paths=['users','authIndex','requests','communities','userCommunities','communityRequests','wishlist','dynamax','gmax','costumes','have','offers','trades'];
  for(const path of paths)await succeeds(db('GET',path,undefined,TOKENS.admin),`admin ${path}`);
  await succeeds(db('DELETE',`admins/${IDS.admin}`,undefined,'emulator-owner'),'remove admin');
  for(const path of paths)await fails(db('GET',path,undefined,TOKENS.admin),`removed admin ${path}`);
});

test('health-check access is public directory before login and exact owner or Admin users after login',async()=>{
  await succeeds(db('GET','loginDirectory',undefined),'anonymous health directory');
  await succeeds(db('GET',`users/${NAMES.ordinary}`,undefined,TOKENS.ordinary),'owner health record');
  await succeeds(db('GET','users',undefined,TOKENS.admin),'admin health collection');
  await fails(db('GET','users',undefined,TOKENS.ordinary),'ordinary health collection');
});

test('membership reads are exact to the authenticated UID and grant no trainer data access',async()=>{
  await succeeds(db('GET',`userCommunities/${IDS.ordinary}`,undefined,TOKENS.ordinary),'own memberships');
  await fails(db('GET',`userCommunities/${IDS.other}`,undefined,TOKENS.ordinary),'foreign memberships');
  await fails(db('GET','communities/nyc',undefined,TOKENS.ordinary),'community detail');
  await fails(db('GET',`wishlist/${NAMES.other}`,undefined,TOKENS.ordinary),'membership grants no list');
});

test('community records are Admin-only while own reverse memberships remain exact',async()=>{
  await succeeds(db('GET','communities/nyc',undefined,TOKENS.admin),'admin community');
  await succeeds(db('GET',`userCommunities/${IDS.ordinary}/nyc`,undefined,TOKENS.ordinary),'own exact membership');
  await fails(db('GET','communityRequests/nyc',undefined,TOKENS.ordinary),'ordinary community requests');
});

test('pending decrement reads and retained writes remain exact and identity bound',async()=>{
  await succeeds(db('GET',`pendingDecrements/${NAMES.ordinary}`,undefined,TOKENS.ordinary),'own queue');
  await fails(db('GET',`pendingDecrements/${NAMES.other}`,undefined,TOKENS.ordinary),'foreign queue');
  await succeeds(db('PUT',`pendingDecrements/${NAMES.ordinary}/fromOther`,{from:NAMES.other,qty:-1,key:'Pikachu'},TOKENS.other),'counterparty decrement');
  await fails(db('PUT',`pendingDecrements/${NAMES.ordinary}/spoofed`,{from:NAMES.ordinary,qty:-1,key:'Pikachu'},TOKENS.other),'spoofed decrement');
  await succeeds(db('DELETE',`pendingDecrements/${NAMES.ordinary}/decExisting`,undefined,TOKENS.ordinary),'owner consumes decrement');
});

test('inactive future identity sharing and preference paths remain denied to every actor',async()=>{
  const deniedPaths=[
    'shareDirectory/ordinarytrainer',`trainerShares/${IDS.ordinary}`,
    'shareDirectory','trainerShares',`shareVisibility/${IDS.ordinary}`,
    `shareAccess/${IDS.ordinary}`,`userPreferences/${IDS.ordinary}`,
    `accounts/${IDS.ordinary}`,`shareGroupAccess/${IDS.ordinary}`,
    `privateProfiles/${IDS.ordinary}`,`publicProfiles/${IDS.ordinary}`,
    `publicLists/${IDS.ordinary}`,'unlistedShares/share1','groups/group1'
  ];
  for(const actor of [undefined,TOKENS.ordinary,TOKENS.other,TOKENS.admin]){
    for(const path of deniedPaths)await fails(db('GET',path,undefined,actor),`denied ${path}`);
  }
  await fails(db('PUT',`userPreferences/${IDS.ordinary}/favoriteTrainers/${IDS.other}`,{trainerName:NAMES.other},TOKENS.ordinary),'disabled preference write');
  await fails(db('PUT',`shareAccess/${IDS.ordinary}/${IDS.other}`,true,TOKENS.ordinary),'disabled access write');
  await fails(db('PUT',`trainerShares/${IDS.ordinary}`,{schemaVersion:1},TOKENS.admin),'disabled admin share write');
  await fails(db('PUT',`userPreferences/${IDS.ordinary}`,{favoriteTrainers:{}},TOKENS.admin),'disabled admin preference write');
});

test('retained owner list profile share auth-index request and Admin writes still succeed',async()=>{
  const profile={...user(IDS.ordinary),bio:'updated'};
  await succeeds(db('PUT',`users/${NAMES.ordinary}`,profile,TOKENS.ordinary),'own profile');
  await succeeds(db('PUT',`wishlist/${NAMES.ordinary}`,{Pikachu:'M'},TOKENS.ordinary),'own list');
  await succeeds(db('PUT',`publicShares/${NAMES.ordinary}`,publicShare(NAMES.ordinary,{wishlist:{Pikachu:'M'}}),TOKENS.ordinary),'own public share');
  await succeeds(db('PATCH',`authIndex/${IDS.ordinary}`,{lastSeen:200},TOKENS.ordinary),'own auth index refresh');
  await succeeds(db('PUT','requests/req_1700000000000_test1',{username:'NewTrainer',note:'',requestedAt:1700000000000,status:'pending'},undefined),'canonical anonymous request create');
  await succeeds(db('PUT','communities/new-community',{name:'New Community'},TOKENS.admin),'admin community maintenance');
  await succeeds(db('PUT',`userCommunities/${IDS.other}/new-community`,{role:'member'},TOKENS.admin),'admin membership maintenance');
  await succeeds(db('PUT',`communityRequests/new-community/request2`,{uid:IDS.other,status:'pending'},TOKENS.admin),'admin community request maintenance');
});

test('ordinary writes cannot use narrow reads to modify another account or privileged profile fields',async()=>{
  await fails(db('PUT',`wishlist/${NAMES.other}`,{Eevee:'H'},TOKENS.ordinary),'foreign list write');
  const escalated={...user(IDS.ordinary),isOwner:true,isAdmin:true};
  await fails(db('PUT',`users/${NAMES.ordinary}`,escalated,TOKENS.ordinary),'privileged profile write');
  await fails(db('PUT',`authIndex/${IDS.ordinary}`,{username:NAMES.other,lastSeen:200},TOKENS.ordinary),'auth index reassignment');
});

test('legacy Offers Trades and root restore stay unreadable to ordinary users without loosening their existing writes',async()=>{
  await fails(db('GET',`offers/${NAMES.ordinary}`,undefined,TOKENS.ordinary),'ordinary offers read');
  await fails(db('GET','trades/trade1',undefined,TOKENS.ordinary),'ordinary trade read');
  await succeeds(db('PUT',`offers/${NAMES.ordinary}/newOffer`,{from:NAMES.other,status:'pending'},TOKENS.other),'retained offer creation');
  await succeeds(db('PUT','trades/newTrade',{organizer:NAMES.ordinary,participants:{}},TOKENS.ordinary),'retained trade creation');
  await fails(db('PUT','',{users:{}},TOKENS.admin),'root restore remains blocked');
});
