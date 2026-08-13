const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadCache({read,now=()=>100,maxFavorites}={}){
  const window={};const context=vm.createContext({window,Map,Set,Promise,Object,Number,String,Math,RangeError,TypeError,Error});
  for(const file of ['js/domain/productLimits.js','js/data/favoriteShareSessionCache.js'])vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return window.PogoData.favoriteShareSessionCache.createFavoriteShareSessionCache({repository:{read},validateProjection(value,{username}){
    if(value===null)return{ok:false,status:'not_published'};
    if(value?.malformed)return{ok:false,status:'projection_unsupported'};
    return{ok:true,status:Object.values(value.lists||{}).some(list=>Object.keys(list).length)?'published':'published_empty',snapshot:{username,lists:value.lists||{},updatedAt:value.updatedAt||1}};
  },projectSnapshot(snapshot){return Object.entries(snapshot.lists.wishlist||{}).map(([pokemonName,priority])=>({pokemonKey:pokemonName.toLowerCase(),pokemonName,priority,categories:['wishlist']}));},now,...(maxFavorites===undefined?{}:{maxFavorites})});
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

test('20, 21, 50, and 100 Favorites stay within the product limit and concurrency never exceeds four',async()=>{
  for(const count of [20,21,50,100]){
  let active=0,maxActive=0,reads=0;const releases=[];
  const cache=loadCache({read:name=>new Promise(resolve=>{reads++;active++;maxActive=Math.max(maxActive,active);releases.push(()=>{active--;resolve({ok:true,value:share(name)});});})});cache.activate({uid:'u',username:'Owner'});
  const pending=cache.hydrate(favorites(count));
  while(reads<count||active){await new Promise(resolve=>setTimeout(resolve,0));while(releases.length)releases.shift()();}
  await pending;assert.equal(reads,count);assert.ok(maxActive<=4);
  }
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

test('partial hydration at 100 keeps successes searchable and retries only 25 or 50 transient failures',async()=>{
  for(const unavailable of [25,50]){
    const counts=new Map();
    const cache=loadCache({read:async name=>{
      const index=Number(name.split('-')[1]),count=(counts.get(name)||0)+1;counts.set(name,count);
      if(index<unavailable&&count===1)return{ok:false,error:{code:'network/unavailable'}};
      return{ok:true,value:share(name)};
    }});
    const list=favorites(100);cache.activate({uid:`u-${unavailable}`,username:'Owner'});
    await cache.hydrate(list);
    assert.equal(cache.summary(list).checked,100);assert.equal(cache.summary(list).failed,unavailable);
    assert.equal(cache.snapshot().records.size,100);
    await cache.retryUnavailable(list);
    assert.equal([...counts.values()].reduce((sum,value)=>sum+value,0),100+unavailable);
    assert.equal(cache.summary(list).failed,0);
    assert.equal([...counts.entries()].filter(([,count])=>count===2).length,unavailable);
  }
});

test('100-record cache retains projections only and remains compact for realistic list sizes',async()=>{
  const largerShare=name=>({username:name,profile:{bio:'must not be retained',discord:'private-noise'},lists:{wishlist:Object.fromEntries(Array.from({length:120},(_,i)=>[`Pokemon-${i}`,i%3===0?'H':i%3===1?'M':'L'])),dynamax:{},gmax:{},costumes:{}},updatedAt:1});
  const cache=loadCache({read:async name=>({ok:true,value:largerShare(name)})});cache.activate({uid:'u-memory',username:'Owner'});
  const started=process.hrtime.bigint();await cache.hydrate(favorites(100));const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
  const records=[...cache.snapshot().records.values()];
  assert.equal(records.length,100);assert.ok(elapsedMs<1500,`hydration took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(records.some(record=>Object.hasOwn(record,'profile')),false);
  assert.ok(JSON.stringify(records).length<2_500_000);
});

test('account changes clear cached records and the 100-Favorite product ceiling fails closed at 101',async()=>{
  let reads=0;const cache=loadCache({read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:'u1',username:'Owner'});
  await cache.hydrate(favorites(1));cache.activate({uid:'u2',username:'Other'});assert.equal(cache.snapshot().size,0);
  await cache.hydrate(favorites(1));assert.equal(reads,2);
  assert.doesNotThrow(()=>cache.syncFavorites(favorites(100)));
  assert.throws(()=>cache.syncFavorites(favorites(101)),/at most 100/);
});

test('in-flight results from an old account are rejected and never enter the next session',async()=>{
  let release;const cache=loadCache({read:()=>new Promise(resolve=>{release=resolve;})});cache.activate({uid:'u1',username:'Owner'});
  const pending=cache.readFavorite({displayName:'Trainer-0'});await new Promise(resolve=>setTimeout(resolve,0));
  cache.activate({uid:'u2',username:'Other'});release({ok:true,value:share('Trainer-0')});
  await assert.rejects(pending,error=>error.code==='favorite-cache/session-changed');assert.equal(cache.snapshot().size,0);
});

test('supported large fixture simulations remain linear',async()=>{
  for(const count of [50,100]){
    let reads=0;const cache=loadCache({maxFavorites:count,read:async name=>{reads++;return{ok:true,value:share(name)};}});cache.activate({uid:`u${count}`,username:'Owner'});
    await cache.hydrate(favorites(count));assert.equal(reads,count);
    await cache.hydrate(favorites(count));assert.equal(reads,count);
  }
});

test('production defaults reject fan-out only beyond the 100-Favorite product cap',()=>{
  const cache=loadCache({read:async name=>({ok:true,value:share(name)})});cache.activate({uid:'u',username:'Owner'});
  assert.doesNotThrow(()=>cache.syncFavorites(favorites(100)));
  assert.throws(()=>cache.syncFavorites(favorites(101)),/at most 100/);
});
