const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadCache({read,now=()=>100,maxFavorites=20}={}){
  const window={};vm.runInContext(readFileSync(path.join(__dirname,'..','js/data/favoriteShareSessionCache.js'),'utf8'),vm.createContext({window,Map,Set,Promise,Object,Number,String,Math,RangeError,TypeError,Error}));
  return window.PogoData.favoriteShareSessionCache.createFavoriteShareSessionCache({repository:{read},validateProjection(value,{username}){
    if(value===null)return{ok:false,status:'not_published'};
    if(value?.malformed)return{ok:false,status:'projection_unsupported'};
    return{ok:true,status:Object.values(value.lists||{}).some(list=>Object.keys(list).length)?'published':'published_empty',snapshot:{username,lists:value.lists||{},updatedAt:value.updatedAt||1}};
  },projectSnapshot(snapshot){return Object.entries(snapshot.lists.wishlist||{}).map(([pokemonName,priority])=>({pokemonKey:pokemonName.toLowerCase(),pokemonName,priority,categories:['wishlist']}));},now,maxFavorites});
}
const favorites=count=>Array.from({length:count},(_,i)=>({key:`trainer-${i}`,displayName:`Trainer-${i}`}));
const share=name=>({lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},updatedAt:1,username:name});

test('zero Favorites performs zero reads and cold hydration reads each exact Favorite once',async()=>{
  const calls=[];const cache=loadCache({read:async name=>{calls.push(`publicShares/${name}`);return{ok:true,value:share(name)};}});cache.activate({uid:'u',username:'Owner'});
  await cache.hydrate([]);assert.equal(calls.length,0);
  await cache.hydrate(favorites(5));assert.equal(calls.length,5);assert.ok(calls.every(path=>/^publicShares\/Trainer-\d+$/.test(path)));
  await cache.hydrate(favorites(5));assert.equal(calls.length,5);
});

test('autocomplete and repeated Pokémon selections are cache consumers and cannot cause share reads',async()=>{
  let reads=0;const cache=loadCache({read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:'u',username:'Owner'});
  const list=favorites(5);await cache.hydrate(list);assert.equal(reads,5);
  for(const query of ['p','pi','pik','pika'])assert.ok(query.length);
  for(const pokemon of ['Pikachu','Eevee','Pikachu']){
    const records=cache.snapshot().records;
    assert.equal(records.size,5);assert.ok(pokemon);
  }
  assert.equal(reads,5);
});

test('one newly added Favorite requires at most one additional exact read',async()=>{
  let reads=0;const cache=loadCache({read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:'u',username:'Owner'});
  const first=favorites(4),added=favorites(5);await cache.hydrate(first);assert.equal(reads,4);
  cache.syncFavorites(added);await cache.readFavorite(added[4]);assert.equal(reads,5);
  await cache.hydrate(added);assert.equal(reads,5);
});

test('20 Favorites stay within the product read ceiling and concurrency never exceeds four',async()=>{
  let active=0,maxActive=0,reads=0;const releases=[];
  const cache=loadCache({read:name=>new Promise(resolve=>{reads++;active++;maxActive=Math.max(maxActive,active);releases.push(()=>{active--;resolve({ok:true,value:share(name)});});})});cache.activate({uid:'u',username:'Owner'});
  const pending=cache.hydrate(favorites(20));
  while(reads<20||active){await new Promise(resolve=>setTimeout(resolve,0));while(releases.length)releases.shift()();}
  await pending;assert.equal(reads,20);assert.ok(maxActive<=4);
});

test('explicit refresh rereads at most N while retry rereads only transient failures',async()=>{
  const counts=new Map();const cache=loadCache({read:async name=>{counts.set(name,(counts.get(name)||0)+1);return name==='Trainer-1'&&counts.get(name)===1?{ok:false,error:{code:'offline'}}:{ok:true,value:share(name)};}});cache.activate({uid:'u',username:'Owner'});
  const list=favorites(3);await cache.hydrate(list);assert.deepEqual([...counts.values()],[1,1,1]);
  await cache.retryUnavailable(list);assert.deepEqual([...counts.values()],[1,2,1]);
  cache.invalidate();await cache.hydrate(list,{force:true});assert.deepEqual([...counts.values()],[2,3,2]);
});

test('not-published records are not hammered by retry and removing a Favorite drops it immediately',async()=>{
  let reads=0;const cache=loadCache({read:async name=>{reads++;return{ok:true,value:name==='Trainer-1'?null:share(name)};}});cache.activate({uid:'u',username:'Owner'});
  const list=favorites(2);await cache.hydrate(list);await cache.retryUnavailable(list);assert.equal(reads,2);
  cache.syncFavorites([list[0]]);assert.equal(cache.snapshot().records.has('trainer-1'),false);
});

test('retry excludes permission and validation failures',async()=>{
  const counts=new Map();const cache=loadCache({read:async name=>{counts.set(name,(counts.get(name)||0)+1);return name==='Trainer-0'?{ok:false,error:{code:'database/permission-denied'}}:{ok:true,value:{malformed:true}};}});cache.activate({uid:'u',username:'Owner'});
  const list=favorites(2);await cache.hydrate(list);await cache.retryUnavailable(list);
  assert.deepEqual([...counts.values()],[1,1]);assert.equal(cache.summary(list).failed,0);assert.equal(cache.summary(list).invalid,2);
});

test('account changes clear cached records and the product ceiling fails closed',async()=>{
  let reads=0;const cache=loadCache({read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:'u1',username:'Owner'});
  await cache.hydrate(favorites(1));cache.activate({uid:'u2',username:'Other'});assert.equal(cache.snapshot().size,0);
  await cache.hydrate(favorites(1));assert.equal(reads,2);
  assert.throws(()=>cache.syncFavorites(favorites(21)),/at most 20/);
});

test('in-flight results from an old account are rejected and never enter the next session',async()=>{
  let release;const cache=loadCache({read:()=>new Promise(resolve=>{release=resolve;})});cache.activate({uid:'u1',username:'Owner'});
  const pending=cache.readFavorite({displayName:'Trainer-0'});await new Promise(resolve=>setTimeout(resolve,0));
  cache.activate({uid:'u2',username:'Other'});release({ok:true,value:share('Trainer-0')});
  await assert.rejects(pending,error=>error.code==='favorite-cache/session-changed');assert.equal(cache.snapshot().size,0);
});

test('large fixture simulations remain linear without approving larger production fan-out',async()=>{
  for(const count of [50,100,250]){
    let reads=0;const cache=loadCache({maxFavorites:count,read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:`u${count}`,username:'Owner'});
    await cache.hydrate(favorites(count));assert.equal(reads,count);
    await cache.hydrate(favorites(count));assert.equal(reads,count);
  }
});

test('production defaults reject fan-out beyond the current 20-Favorite product cap',()=>{
  const cache=loadCache({read:async name=>({ok:true,value:share(name)})});cache.activate({uid:'u',username:'Owner'});
  assert.throws(()=>cache.syncFavorites(favorites(21)),/at most 20/);
});
