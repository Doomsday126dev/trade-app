const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const window={};
vm.runInNewContext(readFileSync(path.join(root,'js/domain/publicSharePublication.js'),'utf8'),{window});
const publication=window.PogoDomain.publicSharePublication;
const source=readFileSync(path.join(root,'index.html'),'utf8');

function between(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.notEqual(from,-1,`Missing ${start}`);
  assert.notEqual(to,-1,`Missing ${end}`);
  return source.slice(from,to);
}
function hydratedHarness(identity={uid:'uid-a',username:'TrainerA'}){
  const gate=publication.createPublicSharePublicationGate();
  const activated=gate.activate(identity);
  return{gate,token:activated.token,identity};
}
function complete(gate,token){
  for(const surface of publication.REQUIRED_SOURCE_SURFACES)assert.equal(gate.markLoaded(token,surface).ok,true);
}
function shareSource(username='TrainerA'){
  return{
    users:{[username]:{friendCode:'0000 0000 0000',bio:'safe',discord:'safe',avatarPokemon:'Pikachu',lastUpdated:10,email:'private@example.test',authUid:'private'}},
    wishlist:{[username]:{Pikachu:{p:'H'}}},dynamax:{[username]:{}},gmax:{[username]:{}},costumes:{[username]:{}}
  };
}

test('cold hydration preserves a populated existing share until every source loads',()=>{
  const h=hydratedHarness();
  const existing={version:1,lists:{wishlist:{Pikachu:{p:'H'}}}};
  const before=structuredClone(existing);
  const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:shareSource()});
  assert.equal(built.ok,false);
  assert.equal(built.error.code,'share-publication/not-ready');
  assert.deepEqual(existing,before);
});

test('missing cache sections are not treated as empty published lists',()=>{
  const h=hydratedHarness();complete(h.gate,h.token);
  const incomplete=shareSource();delete incomplete.gmax;
  const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:incomplete});
  assert.equal(built.error.code,'share-publication/source-invalid');
  assert.equal(built.error.surface,'gmax');
});

test('profile hydration is required because profile fields are part of the projection',()=>{
  const h=hydratedHarness();
  for(const surface of publication.REQUIRED_LIST_SURFACES)h.gate.markLoaded(h.token,surface);
  const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:shareSource()});
  assert.equal(built.error.code,'share-publication/not-ready');
  assert.deepEqual(Array.from(built.error.surfaces),['profile']);
});

test('genuinely empty lists publish after their exact reads complete',()=>{
  const h=hydratedHarness();complete(h.gate,h.token);
  const empty={users:{TrainerA:{}},wishlist:{},dynamax:{},gmax:{},costumes:{}};
  const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:empty,now:20});
  assert.equal(built.ok,true);
  assert.deepEqual(Object.fromEntries(Object.entries(built.snapshot.lists).map(([key,value])=>[key,Object.keys(value).length])),{wishlist:0,dynamax:0,gmax:0,costumes:0});
});

test('explicit publication emits the complete allowlisted hydrated projection',()=>{
  const h=hydratedHarness();complete(h.gate,h.token);
  const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:shareSource(),now:30});
  assert.equal(built.ok,true);
  assert.equal(Object.keys(built.snapshot.lists.wishlist).length,1);
  assert.equal(built.snapshot.updatedAt,30);
  assert.deepEqual(Object.keys(built.snapshot.profile).sort(),['avatarPokemon','bio','discord','friendCode','lastUpdated']);
  assert.equal(JSON.stringify(built.snapshot).includes('private@example.test'),false);
  assert.equal(JSON.stringify(built.snapshot).includes('authUid'),false);
});

test('owned list edits and profile updates are the only non-explicit triggers',()=>{
  const h=hydratedHarness();complete(h.gate,h.token);
  for(const trigger of ['owned_list_edit','share_profile_update'])assert.equal(h.gate.request(h.token,trigger).status,'ready');
  assert.equal(h.gate.request(h.token,'login').error.code,'share-publication/trigger-denied');
  assert.equal(h.gate.request(h.token,'last_seen').error.code,'share-publication/trigger-denied');
});

test('add, removal, priority, detail, and category move snapshots use the latest hydrated source',()=>{
  const h=hydratedHarness();complete(h.gate,h.token);
  const states=[
    {wishlist:{Pikachu:{p:'H'}},dynamax:{},gmax:{},costumes:{}},
    {wishlist:{Pikachu:{p:'M',mod:'detail'}},dynamax:{},gmax:{},costumes:{}},
    {wishlist:{},dynamax:{Pikachu:{p:'M',mod:'detail'}},gmax:{},costumes:{}},
    {wishlist:{},dynamax:{},gmax:{},costumes:{}}
  ];
  for(const lists of states){
    const data={users:{TrainerA:{}},...Object.fromEntries(Object.entries(lists).map(([type,list])=>[type,{TrainerA:list}]))};
    const built=publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'owned_list_edit',username:'TrainerA',source:data});
    assert.equal(built.ok,true);
    assert.deepEqual(JSON.parse(JSON.stringify(built.snapshot.lists)),lists);
  }
});

test('a failed owned read blocks partial publication and preserves pending intent',()=>{
  const h=hydratedHarness();
  assert.equal(h.gate.request(h.token,'explicit_share').status,'pending');
  h.gate.markLoaded(h.token,'wishlist');
  h.gate.markFailed(h.token,'dynamax');
  assert.equal(h.gate.authorize(h.token,'explicit_share').error.code,'share-publication/hydration-failed');
  assert.equal(h.gate.consumePending(h.token).error.code,'share-publication/hydration-failed');
});

test('logout invalidates pending publication and stale hydration callbacks',()=>{
  const h=hydratedHarness();
  assert.equal(h.gate.request(h.token,'owned_list_edit').status,'pending');
  h.gate.invalidate('logout');
  assert.equal(h.gate.markLoaded(h.token,'wishlist').error.code,'share-publication/session-inactive');
  assert.equal(h.gate.snapshot().pendingTriggers.length,0);
});

test('account switching prevents User A generation from publishing as User B',()=>{
  const h=hydratedHarness();
  h.gate.request(h.token,'explicit_share');
  const next=h.gate.activate({uid:'uid-b',username:'TrainerB'});
  assert.equal(h.gate.markLoaded(h.token,'wishlist').error.code,'share-publication/stale-generation');
  assert.equal(publication.buildPublicShareSnapshot({gate:h.gate,token:h.token,trigger:'explicit_share',username:'TrainerA',source:shareSource()}).error.code,'share-publication/stale-generation');
  assert.equal(next.token.username,'TrainerB');
});

test('a newer same-user hydration generation invalidates the previous token after auth loss',()=>{
  const h=hydratedHarness();
  h.gate.invalidate('auth_loss');
  const next=h.gate.activate(h.identity);
  assert.notEqual(next.token.generation,h.token.generation);
  assert.equal(h.gate.markLoaded(h.token,'wishlist').error.code,'share-publication/stale-generation');
});

test('pending explicit publication becomes consumable only after all four lists load',()=>{
  const h=hydratedHarness();
  assert.equal(h.gate.request(h.token,'explicit_share').status,'pending');
  for(const surface of publication.REQUIRED_SOURCE_SURFACES.slice(0,-1))h.gate.markLoaded(h.token,surface);
  assert.equal(h.gate.consumePending(h.token).error.code,'share-publication/not-ready');
  h.gate.markLoaded(h.token,'costumes');
  assert.deepEqual(JSON.parse(JSON.stringify(h.gate.consumePending(h.token))),{ok:true,status:'pending_ready',trigger:'explicit_share'});
  assert.equal(h.gate.consumePending(h.token).status,'none');
});

test('actual login ordering never republishes from writeUserNow before exact hydration',()=>{
  const login=between('async function doLogin(){','function logout(){');
  const writeNow=between('async function writeUserNow','async function writeUserStrict');
  const exact=between('function ensureOwnedExactSubscriptions','function ensureListSubscribed');
  assert.ok(login.indexOf('activateOwnedSession(ident.uid,u);')<login.indexOf('await writeUserNow(u,loginUpdate);'));
  assert.ok(login.indexOf('await writeUserNow(u,loginUpdate);')<login.indexOf('showApp();'));
  assert.doesNotMatch(writeNow,/publicShares|publicShareSnapshotForUser|requestPublicSharePublication/);
  assert.match(exact,/for\(const type of PUBLIC_SHARE_TYPES\)/);
  assert.match(exact,/managedOwnedDataCoordinator\.subscribeList\(type\)/);
});

test('only confirmed list and profile changes request automatic publication',()=>{
  const writeUser=between('async function writeUser(u,data)','function canWriteLoginDirectoryNow');
  const writeList=between('async function writeList(type,u,list)','function refreshAddPokemonChoices');
  const profile=between('async function saveProfile(){','// ── UI HELPERS');
  assert.doesNotMatch(writeUser,/publicShare|requestPublicSharePublication/);
  assert.equal((writeList.match(/requestPublicSharePublication\('owned_list_edit'/g)||[]).length,2);
  assert.match(profile,/requestPublicSharePublication\('share_profile_update'/);
});

test('publication is constrained to the active trainer public-share path',()=>{
  const sessionMatch=between('function publicShareSessionMatches','function publicShareSnapshotForUser');
  const queue=between('function queueHydratedPublicShareSnapshot','function requestPublicSharePublication');
  const publish=between('async function publishPublicShareNow','async function writeUser(u,data)');
  assert.match(sessionMatch,/cur===username/);
  assert.match(sessionMatch,/activePublicShareHydrationToken\.uid===auth\.currentUser\.uid/);
  assert.match(sessionMatch,/activePublicShareHydrationToken\.username===username/);
  assert.match(queue,/queueSync\(`publicShares\/\$\{username\}`/);
  assert.match(publish,/set\(ref\(db,`publicShares\/\$\{username\}`\)/);
  assert.doesNotMatch(`${queue}\n${publish}`,/wishlist\/\$\{username\}|have\/\$\{username\}|users\/\$\{username\}/);
});
