const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {sanitizeProviderPublicProjection}=require('../functions/e1-authority-service/providerPublicProjection');

const root=path.join(__dirname,'..');

function load(){
  const window={};window.window=window;
  const context=vm.createContext({window,console});
  for(const file of ['js/domain/publicSharePublication.js','js/domain/providerPublicProjection.js']){
    vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  return window.PogoDomain.providerPublicProjection;
}

function publicSnapshot(overrides={}){
  return{
    version:1,username:'ProviderTrainer',
    profile:{friendCode:'0000 1111 2222',bio:'Public bio',discord:'trainer',avatarPokemon:'Pikachu',lastUpdated:100},
    lists:{wishlist:{Pikachu:{p:'H',shiny:true}},dynamax:{},gmax:{},costumes:{}},
    publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:100,
    ...overrides
  };
}

function snapshotWithDynamicKey(key){
  const lists=JSON.parse(`{"wishlist":{"${key}":{"p":"H"}},"dynamax":{},"gmax":{},"costumes":{}}`);
  return publicSnapshot({lists});
}

test('provider publication creates the strict UID-rooted stored projection without private identity metadata',()=>{
  const domain=load();
  const next=domain.nextProjection(publicSnapshot(),null,{trainerName:'ProviderTrainer',now:200});
  assert.deepEqual(Object.keys(next).sort(),[...domain.STORED_FIELDS].sort());
  assert.equal(next.schemaVersion,1);assert.equal(next.shareVersion,1);
  assert.equal(next.publishedAt,200);assert.equal(next.updatedAt,200);
  assert.deepEqual(JSON.parse(JSON.stringify(next.publishedListTypes)),{wishlist:true,dynamax:true,gmax:true,costumes:true});
  assert.doesNotMatch(JSON.stringify(next),/uid|email|authIndex|loginDirectory|providerData|token|credential/i);
});

test('RTDB-stripped empty list objects remain a complete empty provider projection',()=>{
  const domain=load();
  const stored=JSON.parse(JSON.stringify(domain.nextProjection(
    publicSnapshot({lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}}}),null,
    {trainerName:'ProviderTrainer',now:200}
  )));
  delete stored.lists;
  const browser=domain.storedProjectionStatus(stored,{trainerName:'ProviderTrainer'});
  const server=sanitizeProviderPublicProjection(stored,{trainerName:'ProviderTrainer'});
  assert.equal(browser.ok,true);assert.equal(browser.status,'published_empty');
  assert.deepEqual(JSON.parse(JSON.stringify(browser.snapshot.lists)),{wishlist:{},dynamax:{},gmax:{},costumes:{}});
  assert.deepEqual(JSON.parse(JSON.stringify(server.lists)),{wishlist:{},dynamax:{},gmax:{},costumes:{}});
});

test('provider updates increment one version preserve publishedAt and advance updatedAt monotonically',()=>{
  const domain=load();
  const first=domain.nextProjection(publicSnapshot(),null,{trainerName:'ProviderTrainer',now:200});
  const second=domain.nextProjection(publicSnapshot({updatedAt:201}),first,{trainerName:'ProviderTrainer',now:150});
  assert.equal(second.shareVersion,2);assert.equal(second.publishedAt,200);assert.equal(second.updatedAt,201);
});

test('strict stored and public projections reject private fields malformed entries and incomplete markers',()=>{
  const domain=load();
  const stored=domain.nextProjection(publicSnapshot(),null,{trainerName:'ProviderTrainer',now:200});
  assert.equal(domain.storedProjectionStatus({...stored,email:'private@example.test'}).ok,false);
  assert.equal(domain.storedProjectionStatus({...stored,publishedListTypes:{wishlist:true}}).ok,false);
  assert.equal(domain.storedProjectionStatus({...stored,lists:{...stored.lists,wishlist:{Pikachu:{p:'X'}}}}).ok,false);
  assert.equal(sanitizeProviderPublicProjection({...stored,ownerUid:'private'}),null);
  assert.equal(domain.publicSnapshotStatus({...publicSnapshot(),uid:'private'}).ok,false);
});

test('malformed existing state blocks overwrite instead of silently resetting publication history',()=>{
  const domain=load();
  assert.throws(()=>domain.nextProjection(publicSnapshot(),{shareVersion:9},{trainerName:'ProviderTrainer',now:200}),
    error=>error.code==='provider-public/existing-projection-invalid');
});

test('exact stored content reconciles without allocating another share version',()=>{
  const domain=load(),snapshot=publicSnapshot();
  const stored=domain.nextProjection(snapshot,null,{trainerName:'ProviderTrainer',now:200});
  assert.equal(domain.projectionContentMatches(snapshot,stored,{trainerName:'ProviderTrainer'}),true);
  assert.equal(domain.projectionContentMatches(publicSnapshot({lists:{...snapshot.lists,wishlist:{Pikachu:{p:'M'}}}}),stored,{trainerName:'ProviderTrainer'}),false);
});

test('dangerous dynamic property names fail closed in browser and authority sanitizers',()=>{
  const domain=load();
  for(const key of ['__proto__','prototype','constructor']){
    const snapshot=snapshotWithDynamicKey(key);
    assert.equal(domain.publicSnapshotStatus(snapshot,{trainerName:'ProviderTrainer'}).ok,false,key);
    const stored={...domain.nextProjection(publicSnapshot(),null,{trainerName:'ProviderTrainer',now:200}),lists:snapshot.lists};
    assert.equal(domain.storedProjectionStatus(stored,{trainerName:'ProviderTrainer'}).ok,false,key);
    assert.equal(sanitizeProviderPublicProjection(stored,{trainerName:'ProviderTrainer'}),null,key);
  }
  const valid=domain.publicSnapshotStatus(publicSnapshot(),{trainerName:'ProviderTrainer'});
  assert.equal(Object.getPrototypeOf(valid.snapshot.lists.wishlist),null);
  assert.equal({}.polluted,undefined);
});

test('browser and authority reject a projection above the shared 512 KiB boundary',()=>{
  const domain=load(),wishlist={};
  for(let index=0;index<1500;index++)wishlist[`${'x'.repeat(190)}${String(index).padStart(4,'0')}`]={p:'H',mod:'m'.repeat(200)};
  const snapshot=publicSnapshot({lists:{wishlist,dynamax:{},gmax:{},costumes:{}}});
  assert.equal(domain.publicSnapshotStatus(snapshot,{trainerName:'ProviderTrainer'}).ok,false);
  const stored={schemaVersion:1,shareVersion:1,trainerName:'ProviderTrainer',profile:snapshot.profile,
    lists:snapshot.lists,publishedListTypes:{wishlist:true,dynamax:true,gmax:true,costumes:true},publishedAt:100,updatedAt:100};
  assert.equal(domain.storedProjectionStatus(stored,{trainerName:'ProviderTrainer'}).ok,false);
  assert.equal(sanitizeProviderPublicProjection(stored,{trainerName:'ProviderTrainer'}),null);
});

test('browser and authority enforce the exact canonical profile text limits without truncation',()=>{
  const domain=load();
  assert.deepEqual(JSON.parse(JSON.stringify(domain.PROFILE_TEXT_LIMITS)),
    {friendCode:14,bio:120,discord:40,avatarPokemon:120});
  const exact=publicSnapshot({profile:{friendCode:'1'.repeat(14),bio:'b'.repeat(120),discord:'d'.repeat(40),
    avatarPokemon:'a'.repeat(120),lastUpdated:100}});
  assert.equal(domain.publicSnapshotStatus(exact).ok,true);
  const stored=domain.nextProjection(exact,null,{trainerName:'ProviderTrainer',now:200});
  assert.ok(sanitizeProviderPublicProjection(stored,{trainerName:'ProviderTrainer'}));
  for(const[field,max]of Object.entries(domain.PROFILE_TEXT_LIMITS)){
    const invalid=publicSnapshot({profile:{...exact.profile,[field]:'x'.repeat(max+1)}});
    assert.equal(domain.publicSnapshotStatus(invalid).ok,false,field);
    assert.throws(()=>domain.nextProjection(invalid,null,{trainerName:'ProviderTrainer',now:200}),
      error=>error.code==='provider-public/projection-invalid',field);
  }
});
