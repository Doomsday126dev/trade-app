const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(files){
  const window={};
  const context=vm.createContext({window,URL,AbortController,setTimeout,clearTimeout});
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

test('server-confirmed reader uses exact no-store REST with App Check and no URL credential',async()=>{
  const window=load(['js/services/firebaseClient.js']);
  const calls=[];
  const reader=window.PogoServices.firebaseClient.createServerConfirmedReader({
    databaseUrl:'https://example-default-rtdb.firebaseio.com',
    fetchImpl:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>({version:2,username:'Trainer'})};},
    appCheckReady:async()=>({ok:true,instance:{id:'app-check'}}),
    loadAppCheckSdk:async()=>({getToken:async()=>({token:'app-check-secret'})}),sessionCurrent:()=>true
  });
  const result=await reader.read('publicShares/Trainer Name',{operationId:'operation-1',isCurrent:()=>true});
  assert.equal(result.ok,true);assert.equal(result.value.username,'Trainer');
  assert.deepEqual(JSON.parse(JSON.stringify(result.evidence)),{kind:'server-confirmed-public-share',transport:'rtdb-rest',path:'publicShares/Trainer Name',scope:'whole-projection',completed:true,operationId:'operation-1',httpStatus:200});
  assert.equal(calls[0].url,'https://example-default-rtdb.firebaseio.com/publicShares/Trainer%20Name.json');
  assert.equal(calls[0].url.includes('auth='),false);assert.equal(calls[0].url.includes('app-check-secret'),false);
  assert.equal(calls[0].options.headers['X-Firebase-AppCheck'],'app-check-secret');
  assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'omit');
});

test('server-confirmed reader cancels before transport and never mints evidence',async()=>{
  const window=load(['js/services/firebaseClient.js']);let fetches=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const reader=window.PogoServices.firebaseClient.createServerConfirmedReader({
    databaseUrl:'http://127.0.0.1:9000/?ns=demo-safe-transfer',fetchImpl:async()=>{fetches++;return{ok:true,status:200,json:async()=>null};},
    appCheckReady:()=>pending,loadAppCheckSdk:async()=>({getToken:async()=>({token:'unused'})}),sessionCurrent:()=>true
  });
  const aborter=new AbortController(),read=reader.read('publicShares/Trainer',{operationId:'operation-2',signal:aborter.signal,isCurrent:()=>true});
  aborter.abort();release({ok:true,instance:{}});
  const result=await read;assert.equal(result.ok,false);assert.equal(result.error.code,'firebase/server-read-cancelled');assert.equal(fetches,0);assert.equal(result.evidence,undefined);
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

test('public-share fresh reads are additive and exact',async()=>{
  const window=load(['js/data/publicShareRepository.js']);const calls=[];
  const client={read:async()=>({ok:true}),readServer:async(target,options)=>{calls.push([target,options.operationId]);return{ok:true,value:{}};},listen:()=>({ok:true,unsubscribe(){}})};
  const repo=window.PogoData.publicShareRepository.createPublicShareRepository(client);
  await repo.readFresh('Trainer',{operationId:'fresh-1'});
  assert.deepEqual(calls,[['publicShares/Trainer','fresh-1']]);
  assert.throws(()=>repo.readFresh('bad/name',{operationId:'fresh-2'}),/valid Firebase key/);
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
