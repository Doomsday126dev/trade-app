const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');

const PROJECT_ID=process.env.POGO_RULES_PROJECT_ID||'demo-pogo-account-sync';
const DATABASE_HOST=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'127.0.0.1:9500';
const AUTH_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9599';
const NAMESPACE=`${PROJECT_ID}-default-rtdb`;
const TOKENS={},IDS={};
const HASH_A='a'.repeat(64),HASH_B='b'.repeat(64),HASH_C='c'.repeat(64);
const FIELD_PRIORITY='f_cHJpb3JpdHk';
const ENTRY_ID='te_WzEsInBvZ28tYWNjb3VudC10cmFkZS1lbnRyeSIsIm15LWxpc3QiLCJ3aXNobGlzdCIsInBva2Vtb246cGlrYWNodSJd';

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,body:await response.text()};
}
async function createUser(name){
  const response=await request(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name}@example.test`,password:`${name}-password-123`,returnSecureToken:true});
  assert.equal(response.status,200,response.body);const body=JSON.parse(response.body);TOKENS[name]=body.idToken;IDS[name]=body.localId;
}
function url(target='',token){
  const clean=String(target).replace(/^\/+|\/+$/g,'');const result=new URL(`http://${DATABASE_HOST}/${clean?`${clean}.json`:'.json'}`);
  result.searchParams.set('ns',NAMESPACE);if(token)result.searchParams.set('auth',token);return result;
}
function db(method,target,value,actor){
  const owner=actor==='emulator-owner';return request(url(target,owner?undefined:actor),method,value,owner?{authorization:'Bearer owner'}:{});
}
async function succeeds(promise,label){const result=await promise;assert.ok(result.status>=200&&result.status<300,`${label}: ${result.status} ${result.body}`);return result;}
async function denied(promise,label){const result=await promise;assert.ok([400,401,403].includes(result.status),`${label}: expected denial, got ${result.status} ${result.body}`);return result;}
function clone(value){return JSON.parse(JSON.stringify(value));}
function trade(uid,overrides={}){
  return{
    schemaVersion:1,ownerUid:uid,entityType:'tradeEntry',entityId:ENTRY_ID,
    identity:{surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},generation:1,revision:1,deleted:false,
    createdAt:100,updatedAt:100,values:{priority:'H'},fieldRevisions:{[FIELD_PRIORITY]:1},
    fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000001'},fieldMutationHashes:{[FIELD_PRIORITY]:HASH_A},
    lifecycleMutation:'op_0000000000000001',lifecycleMutationHash:HASH_A,...overrides
  };
}
function favorite(owner,target=IDS.other){
  return{schemaVersion:1,ownerUid:owner,entityType:'favorite',entityId:target,identity:{targetUid:target},generation:1,revision:1,deleted:false,createdAt:100,updatedAt:100,values:{displayName:'Other Trainer'},fieldRevisions:{f_ZGlzcGxheU5hbWU:1},fieldMutations:{f_ZGlzcGxheU5hbWU:'op_0000000000000001'},fieldMutationHashes:{f_ZGlzcGxheU5hbWU:HASH_A},lifecycleMutation:'op_0000000000000001',lifecycleMutationHash:HASH_A};
}
function tag(owner){
  const id='tag_example';return{id,record:{schemaVersion:1,ownerUid:owner,entityType:'tag',entityId:id,identity:{tagId:id},generation:1,revision:1,deleted:false,createdAt:100,updatedAt:100,values:{label:'Local'},fieldRevisions:{f_bGFiZWw:1},fieldMutations:{f_bGFiZWw:'op_0000000000000001'},fieldMutationHashes:{f_bGFiZWw:HASH_A},lifecycleMutation:'op_0000000000000001',lifecycleMutationHash:HASH_A}};
}
function profile(owner,overrides={}){
  return{schemaVersion:1,ownerUid:owner,friendCode:'0000 1111 2222',bio:'Available',discord:'trainer.126',avatarPokemon:'pokemon:150:base',revision:1,createdAt:100,lastUpdated:100,...overrides};
}

before(async()=>{await createUser('owner');await createUser('other');});
beforeEach(async()=>{await succeeds(db('PUT','',null,'emulator-owner'),'clear fixture');});
after(async()=>{await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,'DELETE');});

test('only the exact authenticated owner may read an account and collection enumeration stays denied',async()=>{
  await succeeds(db('PUT',`accountSync/${IDS.owner}/tradeEntries/${ENTRY_ID}`,trade(IDS.owner),TOKENS.owner),'owner create');
  await succeeds(db('GET',`accountSync/${IDS.owner}`,undefined,TOKENS.owner),'owner read');
  await denied(db('GET',`accountSync/${IDS.owner}`,undefined,TOKENS.other),'cross-owner read');
  await denied(db('GET','accountSync',undefined,TOKENS.owner),'parent enumeration');
  await denied(db('GET',`accountSync/${IDS.owner}`,undefined),'anonymous read');
});

test('provider profile is exact-owner only bounded and revision-monotonic',async()=>{
  const path=`accountSync/${IDS.owner}/profile`,created=profile(IDS.owner);
  await succeeds(db('PUT',path,created,TOKENS.owner),'owner profile create');
  await succeeds(db('GET',path,undefined,TOKENS.owner),'owner profile read');
  await denied(db('GET',path,undefined,TOKENS.other),'cross-owner profile read');
  await denied(db('PUT',path,profile(IDS.owner,{revision:2,lastUpdated:101}),TOKENS.other),'cross-owner profile write');
  await denied(db('PUT',path,{...created,privateNote:'secret'},TOKENS.owner),'unknown private profile field');
  await denied(db('PUT',path,{...created,bio:'x'.repeat(121)},TOKENS.owner),'oversized profile field');
  await denied(db('PUT',path,{...created,ownerUid:IDS.other},TOKENS.owner),'forged profile owner');
  const updated={...created,bio:'Available evenings',revision:2,lastUpdated:101};
  await succeeds(db('PUT',path,updated,TOKENS.owner),'monotonic profile update');
  await denied(db('PUT',path,{...updated,bio:'same revision replacement'},TOKENS.owner),'profile same revision replacement');
  await denied(db('PUT',path,{...updated,bio:'revision jump',revision:4,lastUpdated:102},TOKENS.owner),'profile revision jump');
  await denied(db('DELETE',path,undefined,TOKENS.owner),'profile physical deletion');
});

test('entity writes reject forged ownership parent replacement unknown fields and malformed metadata',async()=>{
  const path=`accountSync/${IDS.owner}/tradeEntries/${ENTRY_ID}`,valid=trade(IDS.owner);
  await denied(db('PUT',path,{...valid,ownerUid:IDS.other},TOKENS.owner),'forged owner');
  await denied(db('PUT',path,{...valid,extra:true},TOKENS.owner),'unknown field');
  await denied(db('PUT',path,{...valid,schemaVersion:0},TOKENS.owner),'legacy schema');
  await denied(db('PUT',path,{...valid,lifecycleMutationHash:'bad'},TOKENS.owner),'bad hash');
  await denied(db('PUT',path,{...valid,fieldRevisions:{[FIELD_PRIORITY]:2}},TOKENS.owner),'initial field revision must start at one');
  await denied(db('PUT',path,{...valid,fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000002'}},TOKENS.owner),'initial field mutation must bind lifecycle');
  await denied(db('PUT',path,{...valid,fieldMutationHashes:{[FIELD_PRIORITY]:HASH_B}},TOKENS.owner),'initial field hash must bind lifecycle');
  const extraToken='f_dW5rbm93bg',extraMetadata={...clone(valid),fieldRevisions:{...valid.fieldRevisions,[extraToken]:1},fieldMutations:{...valid.fieldMutations,[extraToken]:'op_0000000000000002'},fieldMutationHashes:{...valid.fieldMutationHashes,[extraToken]:HASH_B}};
  await denied(db('PUT',path,extraMetadata,TOKENS.owner),'unknown field metadata');
  await denied(db('PUT',path,{...valid,createdAt:Date.now()+120000,updatedAt:Date.now()+120000},TOKENS.owner),'future timestamp');
  await denied(db('PUT',`accountSync/${IDS.owner}`,{tradeEntries:{[ENTRY_ID]:valid}},TOKENS.owner),'whole-account replacement');
});

test('revision and generation transitions fail closed while patch delete and explicit re-add remain valid',async()=>{
  const path=`accountSync/${IDS.owner}/tradeEntries/${ENTRY_ID}`;await succeeds(db('PUT',path,trade(IDS.owner),TOKENS.owner),'create');
  const valueWithoutMetadata=trade(IDS.owner,{revision:2,updatedAt:101,values:{priority:'M'}});
  await denied(db('PUT',path,valueWithoutMetadata,TOKENS.owner),'value change without matching field metadata');
  const metadataWithoutValue=trade(IDS.owner,{revision:2,updatedAt:101,fieldRevisions:{[FIELD_PRIORITY]:2},fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000002'},fieldMutationHashes:{[FIELD_PRIORITY]:HASH_B}});
  await denied(db('PUT',path,metadataWithoutValue,TOKENS.owner),'field metadata churn without a value change');
  const patch=trade(IDS.owner,{revision:2,updatedAt:101,values:{priority:'M'},fieldRevisions:{[FIELD_PRIORITY]:2},fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000002'},fieldMutationHashes:{[FIELD_PRIORITY]:HASH_B}});
  await succeeds(db('PUT',path,patch,TOKENS.owner),'patch');
  await denied(db('PUT',path,{...patch,revision:4,updatedAt:102},TOKENS.owner),'revision jump');
  await denied(db('PUT',path,{...patch,generation:2,revision:3,updatedAt:102},TOKENS.owner),'generation change without lifecycle');
  const tombstone={...clone(patch),generation:2,revision:3,deleted:true,updatedAt:102,deletedAt:102,lifecycleMutation:'op_0000000000000003',lifecycleMutationHash:HASH_C};
  await denied(db('PUT',path,{...clone(tombstone),values:{priority:'L'}},TOKENS.owner),'delete cannot rewrite values');
  await denied(db('PUT',path,{...clone(tombstone),fieldRevisions:{[FIELD_PRIORITY]:3}},TOKENS.owner),'delete cannot rewrite field revisions');
  await denied(db('PUT',path,{...clone(tombstone),fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000003'}},TOKENS.owner),'delete cannot rewrite field mutations');
  await denied(db('PUT',path,{...clone(tombstone),fieldMutationHashes:{[FIELD_PRIORITY]:HASH_C}},TOKENS.owner),'delete cannot rewrite field mutation hashes');
  await denied(db('PUT',path,{...clone(tombstone),lifecycleMutationHash:patch.lifecycleMutationHash},TOKENS.owner),'delete must advance lifecycle hash');
  await succeeds(db('PUT',path,tombstone,TOKENS.owner),'tombstone');
  await denied(db('DELETE',path,undefined,TOKENS.owner),'physical deletion');
  const readd={...clone(tombstone),generation:3,revision:4,deleted:false,updatedAt:103,fieldRevisions:{[FIELD_PRIORITY]:1},fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000004'},fieldMutationHashes:{[FIELD_PRIORITY]:HASH_A},lifecycleMutation:'op_0000000000000004',lifecycleMutationHash:HASH_A};delete readd.deletedAt;
  await denied(db('PUT',path,{...clone(readd),fieldRevisions:{[FIELD_PRIORITY]:2}},TOKENS.owner),'re-add field revision must restart at one');
  await denied(db('PUT',path,{...clone(readd),fieldMutations:{[FIELD_PRIORITY]:'op_0000000000000005'}},TOKENS.owner),'re-add field mutation must bind lifecycle');
  await denied(db('PUT',path,{...clone(readd),fieldMutationHashes:{[FIELD_PRIORITY]:HASH_B}},TOKENS.owner),'re-add field hash must bind lifecycle');
  await succeeds(db('PUT',path,readd,TOKENS.owner),'explicit re-add');
});

test('favorite and tag records are owner-bound and reject cross-account writes',async()=>{
  const tagged=tag(IDS.owner),favoritePath=`accountSync/${IDS.owner}/favorites/${IDS.other}`,created=favorite(IDS.owner);
  await succeeds(db('PUT',favoritePath,created,TOKENS.owner),'favorite create');
  const tagPath=`accountSync/${IDS.owner}/tags/${tagged.id}`;await succeeds(db('PUT',tagPath,tagged.record,TOKENS.owner),'tag create');
  await denied(db('PUT',favoritePath,{...clone(created),revision:2,updatedAt:101,values:{displayName:'Renamed Trainer'}},TOKENS.owner),'favorite display change without matching field metadata');
  await denied(db('PUT',tagPath,{...clone(tagged.record),revision:2,updatedAt:101,values:{label:'Renamed'}},TOKENS.owner),'tag label change without matching field metadata');
  const assigned={...clone(created),revision:2,updatedAt:101,values:{displayName:'Other Trainer',tagIds:{tag_example:true}},fieldRevisions:{...created.fieldRevisions,tagIds:{tag_example:1}},fieldMutations:{...created.fieldMutations,tagIds:{tag_example:'op_0000000000000002'}},fieldMutationHashes:{...created.fieldMutationHashes,tagIds:{tag_example:HASH_B}}};
  await succeeds(db('PUT',favoritePath,assigned,TOKENS.owner),'favorite tag assignment');
  const removed={...clone(assigned),revision:3,updatedAt:102,values:{displayName:'Other Trainer',tagIds:{tag_example:false}},fieldRevisions:{...assigned.fieldRevisions,tagIds:{tag_example:2}},fieldMutations:{...assigned.fieldMutations,tagIds:{tag_example:'op_0000000000000003'}},fieldMutationHashes:{...assigned.fieldMutationHashes,tagIds:{tag_example:HASH_C}}};
  await succeeds(db('PUT',favoritePath,removed,TOKENS.owner),'favorite tag removal tombstone');
  const poisoned={...clone(removed),revision:4,updatedAt:103,fieldRevisions:{...removed.fieldRevisions,tagIds:{...removed.fieldRevisions.tagIds,tag_unknown:1}},fieldMutations:{...removed.fieldMutations,tagIds:{...removed.fieldMutations.tagIds,tag_unknown:'op_0000000000000004'}},fieldMutationHashes:{...removed.fieldMutationHashes,tagIds:{...removed.fieldMutationHashes.tagIds,tag_unknown:HASH_A}}};
  await denied(db('PUT',favoritePath,poisoned,TOKENS.owner),'favorite metadata without matching tag value');
  await denied(db('PUT',`accountSync/${IDS.owner}/favorites/${IDS.other}`,favorite(IDS.owner),TOKENS.other),'favorite cross-write');
  await denied(db('PUT',`accountSync/${IDS.owner}/tags/${tagged.id}`,tagged.record,TOKENS.other),'tag cross-write');
});

test('migration and recovery evidence are create-only exact-owner records',async()=>{
  const migrationId=`migration_${HASH_A}`,migration={schemaVersion:1,ownerUid:IDS.owner,deviceMigrationId:migrationId,sourceFingerprint:HASH_B,deviceInstallHash:HASH_C,createdAt:100,completedAt:101,seedCount:1,candidateCount:0,verified:true,legacyRetained:true};
  await succeeds(db('PUT',`accountSync/${IDS.owner}/migrations/${migrationId}`,migration,TOKENS.owner),'migration create');
  await denied(db('PUT',`accountSync/${IDS.owner}/migrations/${migrationId}`,migration,TOKENS.owner),'migration overwrite');
  const candidateId=`candidate_${HASH_B}`,candidate={schemaVersion:1,ownerUid:IDS.owner,candidateId,reason:'stale-device-cache',entityType:'tradeEntry',entityId:ENTRY_ID,identity:{surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},values:{priority:'L'},source:'legacy-local',createdAt:100,resolved:false};
  await succeeds(db('PUT',`accountSync/${IDS.owner}/recoveryCandidates/${candidateId}`,candidate,TOKENS.owner),'candidate create');
  await denied(db('PATCH',`accountSync/${IDS.owner}/recoveryCandidates/${candidateId}`,{resolved:true},TOKENS.owner),'candidate overwrite');
});
