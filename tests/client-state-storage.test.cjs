const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

function memoryStorage(){
  const values=new Map();
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key),
    values
  };
}

function historyHarness(identity={uid:'uid-a',username:'TrainerA'}){
  const storage=memoryStorage(),window={};
  const context=vm.createContext({window,Map,Set,Object,Number,String,Math,RangeError,TypeError,Error});
  for(const file of ['js/domain/productLimits.js','js/data/trainerHistoryStore.js']){
    vm.runInContext(readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const api=window.PogoData.trainerHistoryStore;
  return{api,storage,store:api.createTrainerHistoryStore({storage,identity,now:(()=>{let value=100;return()=>++value;})()}),identity};
}

function between(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
}

test('TEST-01 trainer history fails safely across missing, invalid, partial, and future schemas',()=>{
  const {api,storage,store,identity}=historyHarness();
  for(const raw of ['', '{broken', '[]', '"wrong"', 'null']){
    storage.setItem(store.key,raw);assert.equal(store.read().favorites.length,0,raw);
  }
  storage.setItem(store.key,JSON.stringify({version:api.VERSION+1,schemaVersion:api.VERSION+1,migrationVersion:api.VERSION+1,owner:identity,favorites:[{trainerName:'MustNotAppear'}]}));
  assert.equal(store.read().favorites.length,0);
  storage.setItem(store.key,JSON.stringify({version:1,owner:identity,favorites:[null,{trainerName:' Valid Trainer '},{trainerName:'valid trainer'}],recent:'wrong',tags:[],snapshots:'wrong'}));
  const recovered=store.read();
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.favorites.map(item=>item.displayName))),['Valid Trainer']);
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.recent)),[]);
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.tags)),{});
});

test('TEST-01 trainer history bounds tags, references, timestamps, snapshots, duplicates, and Unicode stress data',()=>{
  const {api,storage,store,identity}=historyHarness();
  const tags=Object.fromEntries(Array.from({length:40},(_,index)=>[`tag_${index}`,{label:`交換 ${index} 🌟`,createdAt:index,updatedAt:index}]));
  const tagIds=[...Object.keys(tags),...Object.keys(tags),'missing'];
  const snapshot={lists:{wishlist:{Pikachu:'H'}}};
  storage.setItem(store.key,JSON.stringify({
    version:1,owner:identity,tags,
    favorites:Array.from({length:120},(_,index)=>({trainerName:`トレーナー ${index} 🌟`,tagIds,createdAt:index===0?-4:index,updatedAt:'bad'})),
    recent:[{trainerName:'トレーナー 0 🌟',openedAt:10},{trainerName:'Bad time',openedAt:'bad'}],
    snapshots:{'トレーナー 0 🌟':{seenAt:10,snapshot},orphan:{seenAt:12,snapshot}}
  }));
  const state=store.read();
  assert.equal(state.favorites.length,100);
  assert.equal(Object.keys(state.tags).length,api.MAX_TAGS);
  assert.ok(state.favorites.every(item=>item.tagIds.length<=api.MAX_TAGS_PER_FAVORITE));
  assert.ok(state.favorites.every(item=>item.createdAt>=0&&item.updatedAt>=0));
  assert.deepEqual(Object.keys(state.snapshots),['トレーナー 0 🌟']);
  const oversized='x'.repeat(api.MAX_SNAPSHOT_BYTES+1);
  store.rememberOpened('Oversized',{payload:oversized},20);
  assert.equal(store.snapshotFor('Oversized'),null);
  const oversizedUnicode='🌟'.repeat(Math.ceil(api.MAX_SNAPSHOT_BYTES/4));
  store.rememberOpened('Oversized Unicode',{payload:oversizedUnicode},21);
  assert.equal(store.snapshotFor('Oversized Unicode'),null);
});

test('account-partitioned local state survives A reload, remains absent for B, and returns for A',()=>{
  const storage=memoryStorage(),window={};
  const context=vm.createContext({window});
  for(const file of ['js/domain/productLimits.js','js/data/trainerHistoryStore.js'])vm.runInContext(readFileSync(path.join(root,file),'utf8'),context);
  const create=identity=>window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage,identity,now:()=>100});
  const a={uid:'uid-a',username:'TrainerA'},b={uid:'uid-b',username:'TrainerB'};
  let store=create(a);store.toggleFavorite('Private A');const tag=store.createTag('レイド');store.setFavoriteTags('Private A',[tag.id]);store.rememberOpened('Recent A',{lists:{wishlist:{Pikachu:'H'}}},50);
  store=create(a);assert.equal(store.read().favorites.length,1);assert.equal(store.read().recent.length,1);
  store=create(b);assert.equal(store.read().favorites.length,0);assert.equal(store.read().recent.length,0);assert.equal(Object.keys(store.read().tags).length,0);
  store=create(a);assert.equal(store.favoriteFor('Private A').tagIds.length,1);assert.ok(store.snapshotFor('Recent A'));
});

test('activity history recovers from corruption and remains time/count bounded',()=>{
  const storage=memoryStorage(),context=vm.createContext({localStorage:storage,Date,Math,Array,Object,Number,JSON});
  vm.runInContext(between("const ACTIVITY_LOG_KEY='pogoActivityLog_v1';",'function sparklineHtml'),context);
  storage.setItem('pogoActivityLog_v1','[]');
  assert.equal(JSON.stringify(vm.runInContext('loadActivityLog()',context)),'{}');
  for(let user=0;user<205;user++)vm.runInContext(`recordActivityEvent('Trainer-${user}',1)`,context);
  for(let event=0;event<520;event++)vm.runInContext("recordActivityEvent('Trainer-204',1)",context);
  const saved=JSON.parse(storage.getItem('pogoActivityLog_v1'));
  assert.ok(Object.keys(saved).length<=200);
  assert.ok(saved['Trainer-204'].length<=500);
  assert.equal(vm.runInContext("buildSparkline('Trainer-204',30).length",context),30);
});

test('diff snapshots are UID partitioned, reject legacy/unowned state, and stay bounded',()=>{
  let now=100;const storage=memoryStorage();
  const context=vm.createContext({
    localStorage:storage,auth:{currentUser:{uid:'uid-a'}},cur:'TrainerA',allData:{wishlist:{}},
    Date:{now:()=>++now},Object,Number,JSON,Set,encodeURIComponent
  });
  vm.runInContext(between("const DIFF_SNAPSHOT_KEY='pogoListSnapshots_v1';",'let stringDiffCacheSeq'),context);
  vm.runInContext("saveSnapshot('wishlist','FavoriteA',{Pikachu:'H'})",context);
  assert.equal(vm.runInContext("computeSnapshotDiff('wishlist','FavoriteA').firstVisit",context),false);
  context.auth.currentUser.uid='uid-b';context.cur='TrainerB';
  assert.equal(vm.runInContext("computeSnapshotDiff('wishlist','FavoriteA').firstVisit",context),true);
  for(let index=0;index<110;index++)vm.runInContext(`saveSnapshot('wishlist','Trainer-${index}',{Pikachu:'H'})`,context);
  const saved=JSON.parse(storage.getItem('pogoListSnapshots_v1'));
  const viewer=Object.keys(saved.viewers).find(key=>key.startsWith('uid-b:'));
  assert.equal(Object.keys(saved.viewers[viewer].wishlist).length,100);
  const oversized=Object.fromEntries(Array.from({length:2001},(_,index)=>[`Pokemon-${index}`,'H']));context.oversized=oversized;
  assert.equal(vm.runInContext("saveSnapshot('wishlist','TooLarge',oversized)",context),false);
  context.auth.currentUser=null;context.cur=null;
  assert.equal(vm.runInContext("saveSnapshot('wishlist','Anonymous',{Pikachu:'H'})",context),false);
});

test('Safe Transfer defaults are UID partitioned and never adopt the former global preference',()=>{
  const values=new Map([
    ['pogoSafeTransferDefault',JSON.stringify(['LegacyA'])],
    ['pogoSafeTransferDefault:uid-a',JSON.stringify(['PrivateA'])]
  ]);
  const context=vm.createContext({
    auth:{currentUser:{uid:'uid-a'}},allData:{users:{},wishlist:{}},cur:'TrainerA',Set,Object,String,encodeURIComponent,
    lsGet:(key,fallback)=>values.has(key)?JSON.parse(values.get(key)):fallback
  });
  vm.runInContext(between("const SAFE_TRANSFER_DEFAULT_KEY='pogoSafeTransferDefault';",'function openSafeTransferModal'),context);
  assert.deepEqual([...vm.runInContext('_loadSafeTransferDefault()',context)],['PrivateA']);
  context.auth.currentUser.uid='uid-b';assert.equal(vm.runInContext('_loadSafeTransferDefault()',context),null);
  context.auth.currentUser=null;assert.equal(vm.runInContext('_loadSafeTransferDefault()',context),null);
});

test('active storage growth controls and account boundaries remain explicit in source',()=>{
  const history=readFileSync(path.join(root,'js/data/trainerHistoryStore.js'),'utf8');
  assert.match(history,/MAX_FAVORITES/);assert.match(history,/MAX_TAGS=24/);assert.match(history,/MAX_SNAPSHOT_BYTES=512\*1024/);
  assert.match(html,/ACTIVITY_LOG_MAX_USERS=200/);assert.match(html,/ACTIVITY_LOG_MAX_EVENTS_PER_USER=500/);
  assert.match(html,/DIFF_SNAPSHOT_MAX_TRAINERS_PER_TYPE=100/);assert.match(html,/DIFF_SNAPSHOT_MAX_LIST_ENTRIES=2000/);
  assert.match(html,/snapshotViewerKey\(\)[\s\S]*auth\?\.currentUser\?\.uid/);
  assert.match(html,/function safeTransferPreferenceKey\(base\)[\s\S]*auth\?\.currentUser\?\.uid/);
  assert.match(html,/lsSet\(key,\[\.\.\._safeTransferSelected\]\)/);
  assert.doesNotMatch(html,/lsSet\(SAFE_TRANSFER_DEFAULT_KEY,\[\.\.\._safeTransferSelected\]\)/);
  assert.doesNotMatch(html,/const prev=bucket\?\.\[type\]\?\.\[username\]\|\|snaps\[type\]/);
});

test('representative empty, normal, 100-Favorite, large-list, and combined footprints remain measured and bounded',()=>{
  const bytes=value=>Buffer.byteLength(String(value||''),'utf8');
  const empty=historyHarness({uid:'uid-empty',username:'Empty'}),emptyBytes=bytes(JSON.stringify(empty.store.read()));
  const normal=historyHarness({uid:'uid-normal',username:'Normal'});
  const normalTags=['Raid','Travel','Best Friends'].map(label=>normal.store.createTag(label).id);
  for(let index=0;index<25;index++){normal.store.toggleFavorite(`Trainer ${index}`);normal.store.setFavoriteTags(`Trainer ${index}`,[normalTags[index%3]]);}
  for(let index=0;index<6;index++)normal.store.rememberOpened(`Recent ${index}`,{lists:{wishlist:Object.fromEntries(Array.from({length:30},(_,pokemon)=>[`Pokemon ${pokemon}`,'H']))}},1000+index);
  const normalBytes=bytes(normal.storage.getItem(normal.store.key));

  const maximum=historyHarness({uid:'uid-maximum',username:'Maximum'});
  const maxTags=Array.from({length:24},(_,index)=>maximum.store.createTag(`タグ ${index} 🌟`).id);
  for(let index=0;index<100;index++){maximum.store.toggleFavorite(`Long Trainer Name ${index} 🌟`);maximum.store.setFavoriteTags(`Long Trainer Name ${index} 🌟`,maxTags);}
  for(let index=0;index<6;index++)maximum.store.rememberOpened(`Recent ${index}`,{lists:{wishlist:Object.fromEntries(Array.from({length:100},(_,pokemon)=>[`Long Pokemon Variant ${pokemon} フォルム`,'H[lucky](variant)']))}},2000+index);
  const maximumBytes=bytes(maximum.storage.getItem(maximum.store.key));

  const window={};vm.runInNewContext(readFileSync(path.join(root,'js/data/sessionCacheBoundary.js'),'utf8'),{window});
  const sessionStorage=memoryStorage(),boundary=window.PogoData.sessionCacheBoundary.createSessionCacheBoundary({storage:sessionStorage});
  boundary.activate({uid:'uid-large',username:'LargeList'});
  boundary.writeData({loginDirectory:{},users:{LargeList:{bio:'local fixture'}},wishlist:{LargeList:Object.fromEntries(Array.from({length:1000},(_,index)=>[`Synthetic Pokemon ${index}`,'H[lucky](Long variant)']))}});
  const largeListBytes=bytes(sessionStorage.getItem('pogoSessionCache_v2'));
  const combinedBytes=maximumBytes+largeListBytes+bytes(sessionStorage.getItem('pogoSyncQueue_v2'));
  const footprint={emptyBytes,normalBytes,maximumHistoryBytes:maximumBytes,largeListBytes,combinedBytes};
  console.log(`CLIENT_STORAGE_FOOTPRINT ${JSON.stringify(footprint)}`);
  assert.ok(emptyBytes<2_000);assert.ok(normalBytes<250_000);assert.ok(maximumBytes<1_500_000);assert.ok(largeListBytes<1_000_000);assert.ok(combinedBytes<2_500_000);
});
