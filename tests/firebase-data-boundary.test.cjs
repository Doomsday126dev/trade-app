const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(files){
  const window={};
  const context=vm.createContext({window});
  files.forEach(file=>vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context));
  return window;
}

function fakeSdk(){
  const calls={ref:[],get:[],listen:[],stop:0};
  const values=new Map();
  const sdk={
    database:{},
    ref(_database,target){calls.ref.push(target);return target;},
    async get(target){calls.get.push(target);const value=values.get(target);return{exists:()=>value!==undefined,val:()=>value};},
    onValue(target,next,error){calls.listen.push({target,next,error});return()=>{calls.stop++;};}
  };
  return{sdk,calls,values};
}

test('Firebase client exposes predictable exact read/listen results',async()=>{
  const window=load(['js/services/firebaseClient.js']);
  const {sdk,calls,values}=fakeSdk();
  values.set('users/Trainer',{bio:'safe'});
  const client=window.PogoServices.firebaseClient.createFirebaseClient(sdk);
  const read=await client.read('users/Trainer');
  assert.equal(read.ok,true);
  assert.deepEqual(read.value,{bio:'safe'});
  const seen=[];
  const listening=client.listen('users/Trainer',{onData:value=>seen.push(value)});
  assert.equal(listening.ok,true);
  calls.listen[0].next({exists:()=>true,val:()=>({bio:'updated'})});
  assert.deepEqual(seen,[{bio:'updated'}]);
  listening.unsubscribe();
  assert.equal(calls.stop,1);
});

test('Firebase client converts read and listener failures to stable error shapes',async()=>{
  const window=load(['js/services/firebaseClient.js']);
  const sdk={database:{},ref:()=>{throw Object.assign(new Error('blocked'),{code:'database/blocked'});},get:async()=>{},onValue:()=>{}};
  const client=window.PogoServices.firebaseClient.createFirebaseClient(sdk);
  const read=await client.read('users/x');
  assert.deepEqual({ok:read.ok,code:read.error.code,message:read.error.message},{ok:false,code:'database/blocked',message:'blocked'});
  assert.equal(client.listen('users/x',{onData(){}}).error.code,'database/blocked');
});

test('current-user repository constructs owner-exact paths only',async()=>{
  const window=load(['js/data/currentUserRepository.js']);
  const calls=[];
  const client={read:async target=>{calls.push(['read',target]);return{ok:true};},listen:(target)=>{calls.push(['listen',target]);return{ok:true,unsubscribe(){}};}};
  const repo=window.PogoData.currentUserRepository.createCurrentUserRepository(client);
  await repo.readProfile('Trainer');
  await repo.readList('wishlist','Trainer');
  repo.listenList('gmax','Trainer',{});
  await repo.readInventory('Trainer');
  await repo.readAuthIndex('uid-1');
  repo.listenAuthIndex('uid-1',{});
  repo.listenMemberships('uid-1',{});
  repo.listenPendingDecrements('Trainer',{});
  assert.deepEqual(calls,[
    ['read','users/Trainer'],['read','wishlist/Trainer'],['listen','gmax/Trainer'],
    ['read','have/Trainer'],['read','authIndex/uid-1'],['listen','authIndex/uid-1'],['listen','userCommunities/uid-1'],
    ['listen','pendingDecrements/Trainer']
  ]);
  assert.throws(()=>repo.readProfile('bad/name'),/valid Firebase key/);
  assert.throws(()=>repo.readList('offers','Trainer'),/not registered/);
});

test('public-share repository uses one exact public projection path',async()=>{
  const window=load(['js/data/publicShareRepository.js']);
  const calls=[];
  const repo=window.PogoData.publicShareRepository.createPublicShareRepository({
    read:async target=>{calls.push(target);return{ok:true};},
    listen:target=>{calls.push(target);return{ok:true,unsubscribe(){}};}
  });
  await repo.read('Trainer');
  repo.listen('Trainer',{});
  assert.deepEqual(calls,['publicShares/Trainer','publicShares/Trainer']);
  assert.throws(()=>repo.read('bad/name'),/valid Firebase key/);
});

test('cache adapters update exact records without mutating the source cache',()=>{
  const window=load(['js/domain/cacheAdapters.js']);
  const {applyExactRecord,replaceTopLevel}=window.PogoDomain.cacheAdapters;
  const source={users:{A:{bio:'old'}},wishlist:{A:[1]}};
  const updated=applyExactRecord(source,'users/A',{bio:'new'});
  assert.equal(source.users.A.bio,'old');
  assert.equal(updated.users.A.bio,'new');
  assert.equal(updated.wishlist,source.wishlist);
  const removed=applyExactRecord(updated,'users/A',null);
  assert.equal(Object.hasOwn(removed.users,'A'),false);
  const replaced=replaceTopLevel(source,'wishlist',{B:[2]});
  assert.deepEqual(replaced.wishlist,{B:[2]});
  assert.deepEqual(source.wishlist,{A:[1]});
});

test('owned exact snapshots preserve the legacy cache shape across app surfaces',()=>{
  const window=load(['js/domain/cacheAdapters.js']);
  const {applyExactRecord}=window.PogoDomain.cacheAdapters;
  const snapshots=[
    ['users/Trainer',{bio:'safe'}],
    ['wishlist/Trainer',{Pikachu:{p:'H'}}],
    ['dynamax/Trainer',{Electabuzz:{p:'M'}}],
    ['gmax/Trainer',{Lapras:{p:'L'}}],
    ['costumes/Trainer',{'Pikachu (Hat)':{p:'H'}}],
    ['have/Trainer',{Pikachu:2}],
    ['authIndex/uid-1',{username:'Trainer',lastSeen:1}],
    ['userCommunities/uid-1',{nyc:{role:'member'}}],
    ['pendingDecrements/Trainer',{dec1:{key:'Pikachu',qty:-1}}]
  ];
  const result=snapshots.reduce((cache,[target,value])=>applyExactRecord(cache,target,value),{});
  assert.deepEqual(result.users.Trainer,{bio:'safe'});
  assert.equal(result.wishlist.Trainer.Pikachu.p,'H');
  assert.equal(result.dynamax.Trainer.Electabuzz.p,'M');
  assert.equal(result.gmax.Trainer.Lapras.p,'L');
  assert.equal(result.costumes.Trainer['Pikachu (Hat)'].p,'H');
  assert.equal(result.have.Trainer.Pikachu,2);
  assert.equal(result.authIndex['uid-1'].username,'Trainer');
  assert.equal(result.userCommunities['uid-1'].nyc.role,'member');
  assert.equal(result.pendingDecrements.Trainer.dec1.qty,-1);
});
