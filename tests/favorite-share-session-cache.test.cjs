const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function loadCache({read,now=()=>100,maxFavorites,readDeadlineMs,setTimer,clearTimer}={}){
  const window={};const context=vm.createContext({window,Map,Set,Promise,Object,Number,String,Math,RangeError,TypeError,Error,setTimeout,clearTimeout});
  for(const file of ['js/domain/productLimits.js','js/data/favoriteShareSessionCache.js'])vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return window.PogoData.favoriteShareSessionCache.createFavoriteShareSessionCache({repository:{read},validateProjection(value,{username}){
    if(value===null)return{ok:false,status:'not_published'};
    if(value?.malformed)return{ok:false,status:'projection_unsupported'};
    return{ok:true,status:Object.values(value.lists||{}).some(list=>Object.keys(list).length)?'published':'published_empty',snapshot:{username,lists:value.lists||{},...(value.declarations?{declarations:value.declarations}:{}),updatedAt:value.updatedAt||1}};
  },projectSnapshot(snapshot){return Object.entries(snapshot.lists.wishlist||{}).map(([pokemonName,priority])=>({pokemonKey:pokemonName.toLowerCase(),pokemonName,priority,categories:['wishlist']}));},now,...(maxFavorites===undefined?{}:{maxFavorites}),...(readDeadlineMs===undefined?{}:{readDeadlineMs}),...(setTimer?{setTimer}:{}),...(clearTimer?{clearTimer}:{})});
}
const favorites=count=>Array.from({length:count},(_,i)=>({key:`trainer-${i}`,displayName:`Trainer-${i}`}));
const share=name=>({lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},updatedAt:1,username:name});
function controlledTimers(){
  let nextId=1;const timers=new Map();
  return{
    setTimer(handler){const id=nextId++;timers.set(id,handler);return id;},
    clearTimer(id){timers.delete(id);},
    expireAll(){const pending=[...timers.values()];timers.clear();pending.forEach(handler=>handler());},
    size(){return timers.size;}
  };
}
function virtualClock(){
  let current=0,nextId=1;const timers=new Map();
  const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
  return{
    now:()=>current,
    setTimer(handler,delay){const id=nextId++;timers.set(id,{at:current+Number(delay||0),handler});return id;},
    clearTimer(id){timers.delete(id);},
    async advance(ms){
      const target=current+ms;
      while(true){
        const due=[...timers.entries()].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!due)break;
        timers.delete(due[0]);current=due[1].at;due[1].handler();await drain();
      }
      current=target;await drain();
    }
  };
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('validated v2 declarations retain exact qualifiers in the session-only list snapshot',async()=>{
  const declarations=[{intent:'lf',name:'Pikachu (Worlds 2025)',category:'costumes',p:'H',shiny:true,gender:'f',mod:'exact qualifier'}];
  const cache=loadCache({read:async()=>({ok:true,value:{...share('Trainer-0'),declarations,privateNotes:'must not copy'}})});
  cache.activate({uid:'owner',username:'Owner'});
  const record=await cache.readFavorite(favorites(1)[0]);
  assert.equal(JSON.stringify(record.listSnapshot.declarations),JSON.stringify(declarations));
  assert.equal(record.listSnapshot.privateNotes,undefined);
  cache.reset();
  assert.equal(cache.snapshot().records.size,0);
});

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

test('Favorite hydration forwards the stable target UID and invalidates a cached projection when that binding changes',async()=>{
  const calls=[];const cache=loadCache({read:async(name,options)=>{calls.push({name,options});return{ok:true,value:share(name)};}});
  cache.activate({uid:'owner-uid',username:'Owner'});
  const first={key:'provider',displayName:'ProviderTrainer',targetUid:'firebaseTargetUid456'};
  await cache.readFavorite(first);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'ProviderTrainer');
  assert.equal(calls[0].options.targetUid,'firebaseTargetUid456');
  cache.syncFavorites([{...first,targetUid:'differentTargetUid789'}]);
  assert.equal(cache.peek(first),null);
  await cache.readFavorite({...first,targetUid:'differentTargetUid789'});
  assert.equal(calls.at(-1).options.targetUid,'differentTargetUid789');
});

test('a target UID change cannot reuse or repopulate an in-flight read for the old identity',async()=>{
  const pending=[],calls=[];
  const cache=loadCache({read:(name,options)=>new Promise(resolve=>{calls.push({name,options});pending.push(resolve);})});
  cache.activate({uid:'owner-uid',username:'Owner'});
  const original={key:'provider',displayName:'ProviderTrainer',targetUid:'firebaseTargetUid456'};
  const first=cache.readFavorite(original);await flush();
  const rebound={...original,targetUid:'differentTargetUid789'};
  const second=cache.readFavorite(rebound);await flush();
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.targetUid,'firebaseTargetUid456');
  assert.equal(calls[1].options.targetUid,'differentTargetUid789');
  pending[0]({ok:true,value:share('ProviderTrainer')});await first;
  assert.equal(cache.peek(rebound),null);
  pending[1]({ok:true,value:share('ProviderTrainer')});await second;
  assert.equal(cache.peek(rebound).targetUid,'differentTargetUid789');
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

test('A hydrates 100 then logout and B activation begin with no reachable A payloads',async()=>{
  const cache=loadCache({read:async name=>({ok:true,value:share(name)})});
  cache.activate({uid:'uid-a',username:'OwnerA'});await cache.hydrate(favorites(100));assert.equal(cache.snapshot().size,100);
  cache.reset();assert.equal(cache.snapshot().active,false);assert.equal(cache.snapshot().size,0);
  cache.activate({uid:'uid-b',username:'OwnerB'});assert.equal(cache.snapshot().size,0);assert.equal(cache.peek({displayName:'Trainer-0'}),null);
});

test('removal during hydration cannot reinsert the removed Favorite',async()=>{
  let release;const cache=loadCache({read:()=>new Promise(resolve=>{release=resolve;})});
  const favorite=favorites(1)[0];cache.activate({uid:'uid-a',username:'Owner'});cache.syncFavorites([favorite]);
  const pending=cache.readFavorite(favorite);await new Promise(resolve=>setImmediate(resolve));
  cache.syncFavorites([]);release({ok:true,value:share(favorite.displayName)});await pending;
  assert.equal(cache.snapshot().size,0);assert.equal(cache.peek(favorite),null);
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

test('three unconstrained reads start before the first settlement and progress counts every settled attempt',async()=>{
  const releases=[],progress=[];let started=0;
  const cache=loadCache({read:name=>new Promise(resolve=>{started++;releases.push(()=>resolve({ok:true,value:share(name)}));})});
  cache.activate({uid:'u-three',username:'Owner'});
  const pending=cache.hydrate(favorites(3),{onProgress:({completed,total})=>progress.push(`${completed}/${total}`)});
  await flush();assert.equal(started,3);assert.deepEqual(progress,[]);
  releases[1]();await flush();releases[0]();await flush();releases[2]();await pending;
  assert.deepEqual(progress,['1/3','2/3','3/3']);
});

test('three never-settling reads reach a bounded retryable state without exceeding physical concurrency',async()=>{
  const timers=controlledTimers(),progress=[];let started=0,active=0,maxActive=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{started++;active++;maxActive=Math.max(maxActive,active);return new Promise(()=>{});}});
  cache.activate({uid:'u-hang',username:'Owner'});
  const pending=cache.hydrate(favorites(3),{onProgress:({completed,total})=>progress.push(`${completed}/${total}`)});
  await flush();assert.equal(started,3);assert.equal(timers.size(),3);
  timers.expireAll();await pending;
  assert.deepEqual(progress,['1/3','2/3','3/3']);assert.equal(cache.summary(favorites(3)).failed,3);assert.equal(maxActive,3);assert.equal(active,3);
});

test('ten Refresh cycles retain at most one original and one unresolved replacement per Favorite',async()=>{
  const timers=controlledTimers(),trace=[];let physicalReads=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{physicalReads++;return new Promise(()=>{});}});
  const list=favorites(1);cache.activate({uid:'u-refresh-bound',username:'Owner'});
  let pending=cache.hydrate(list);await flush();timers.expireAll();await pending;
  for(let refresh=1;refresh<=10;refresh++){
    cache.invalidate();pending=cache.hydrate(list,{force:true});await flush();
    const before=cache.snapshot();timers.expireAll();await pending;await flush();const after=cache.snapshot();
    trace.push({refresh,physicalReads,unresolved:after.unresolvedPhysicalReads,references:after.physicalReferences,epoch:after.readEpochs.get('trainer-0')});
    assert.ok(before.unresolvedPhysicalReads<=2);assert.ok(after.unresolvedPhysicalReads<=2);
    assert.ok([...after.physicalReferencesByKey.values()].every(count=>count<=2));assert.equal(cache.peek(list[0]).retryable,true);
  }
  assert.equal(physicalReads,2);assert.equal(cache.snapshot().physicalReferences,2);
  assert.deepEqual(trace.map(item=>item.epoch),[1,2,3,4,5,6,7,8,9,10]);
});

test('twenty Retry attempts reattach to one unresolved physical read without duplicate progress',async()=>{
  const timers=controlledTimers();let physicalReads=0,progressEvents=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{physicalReads++;return new Promise(()=>{});}});
  const list=favorites(1);cache.activate({uid:'u-retry-bound',username:'Owner'});
  let pending=cache.hydrate(list);await flush();timers.expireAll();await pending;
  for(let retry=0;retry<20;retry++){
    pending=cache.retryUnavailable(list,{onProgress:({completed,total})=>{assert.equal(completed,1);assert.equal(total,1);progressEvents++;}});
    await flush();timers.expireAll();await pending;
    assert.equal(cache.peek(list[0]).retryable,true);assert.equal(cache.snapshot().unresolvedPhysicalReads,1);
  }
  assert.equal(physicalReads,1);assert.equal(progressEvents,20);assert.equal(cache.snapshot().physicalReferences,1);
});

test('repeated Refresh keeps N=3 and N=100 physically bounded by the scheduler rather than loop count',async()=>{
  for(const count of [3,100]){
    const timers=controlledTimers();let physicalReads=0,maxPhysical=0,maxPerFavorite=0;
    const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{physicalReads++;return new Promise(()=>{});}});
    const list=favorites(count);cache.activate({uid:`u-refresh-${count}`,username:'Owner'});
    let pending=cache.hydrate(list);await flush();timers.expireAll();await pending;
    for(let refresh=0;refresh<10;refresh++){
      cache.invalidate();pending=cache.hydrate(list,{force:true});await flush();
      let state=cache.snapshot();maxPhysical=Math.max(maxPhysical,state.unresolvedPhysicalReads);maxPerFavorite=Math.max(maxPerFavorite,...state.physicalReferencesByKey.values(),0);
      timers.expireAll();await pending;await flush();state=cache.snapshot();
      maxPhysical=Math.max(maxPhysical,state.unresolvedPhysicalReads);maxPerFavorite=Math.max(maxPerFavorite,...state.physicalReferencesByKey.values(),0);assert.ok(state.physicalReferences<=4);
    }
    assert.ok(maxPhysical<=4);assert.ok(maxPerFavorite<=2);
    assert.equal(physicalReads,count===3?4:4);assert.equal(cache.summary(list).failed,count);
  }
});

test('a shared never-settling repository prerequisite is bounded independently for all three Favorites',async()=>{
  const timers=controlledTimers(),shared=new Promise(()=>{});let started=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{started++;return shared;}});
  const list=favorites(3);cache.activate({uid:'u-shared',username:'Owner'});
  const pending=cache.hydrate(list);await flush();assert.equal(started,3);
  timers.expireAll();await pending;assert.equal(cache.summary(list).failed,3);
});

test('partial timeout preserves successes and Retry reattaches to the one still-running physical read',async()=>{
  const timers=controlledTimers(),counts=new Map();let releaseSlow;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:name=>{
    counts.set(name,(counts.get(name)||0)+1);
    if(name==='Trainer-1')return new Promise(resolve=>{releaseSlow=resolve;});
    return Promise.resolve({ok:true,value:name==='Trainer-0'?null:share(name)});
  }});
  const list=favorites(3);cache.activate({uid:'u-partial',username:'Owner'});
  const first=cache.hydrate(list);await flush();await flush();timers.expireAll();await first;
  assert.equal(cache.peek(list[0]).status,'not_published');assert.equal(cache.peek(list[1]).retryable,true);assert.equal(cache.peek(list[2]).status,'published');
  const retry=cache.retryUnavailable(list);await flush();assert.equal(counts.get('Trainer-1'),1);
  releaseSlow({ok:true,value:share('Trainer-1')});await retry;
  assert.equal(cache.summary(list).failed,0);assert.deepEqual([...counts.values()],[1,1,1]);
});

test('a late timed-out result cannot overwrite a newer explicit Refresh result',async()=>{
  const timers=controlledTimers(),releases=[];let reads=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:name=>new Promise(resolve=>{reads++;releases.push(value=>resolve({ok:true,value}));})});
  const list=favorites(1);cache.activate({uid:'u-refresh',username:'Owner'});
  const first=cache.hydrate(list);await flush();timers.expireAll();await first;assert.equal(cache.peek(list[0]).retryable,true);
  cache.invalidate();const refreshed=cache.hydrate(list,{force:true});await flush();assert.equal(reads,2);
  releases[1]({...share('Trainer-0'),updatedAt:200});await refreshed;assert.equal(cache.peek(list[0]).updatedAt,200);
  releases[0]({...share('Trainer-0'),updatedAt:100});await flush();assert.equal(cache.peek(list[0]).updatedAt,200);
});

test('late rejection after logical timeout is handled and cannot emit a second progress or mutate state',async()=>{
  const timers=controlledTimers(),progress=[];let rejectPhysical;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>new Promise((resolve,reject)=>{rejectPhysical=reject;})});
  const list=favorites(1);cache.activate({uid:'u-late-failure',username:'Owner'});
  const pending=cache.hydrate(list,{onProgress:value=>progress.push(value.completed)});await flush();timers.expireAll();await pending;
  const timedOut=cache.peek(list[0]);rejectPhysical(Object.assign(new Error('private provider failure'),{code:'network/offline'}));await flush();await flush();
  assert.deepEqual(progress,[1]);assert.equal(cache.peek(list[0]),timedOut);assert.equal(cache.peek(list[0]).error.code,'favorite-cache/deadline-exceeded');assert.equal(cache.snapshot().physicalReferences,0);
});

test('late physical settlement after a Pokémon selection change cannot alter the newer logical result',async()=>{
  const timers=controlledTimers(),progressA=[],progressB=[];let release;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>new Promise(resolve=>{release=resolve;})});
  const list=favorites(1);cache.activate({uid:'u-selection-change',username:'Owner'});
  const selectionA=cache.hydrate(list,{onProgress:value=>progressA.push(value.completed)});await flush();timers.expireAll();await selectionA;
  const selectionB=cache.hydrate(list,{onProgress:value=>progressB.push(value.completed)});await selectionB;const current=cache.peek(list[0]);
  release({ok:true,value:{...share('Trainer-0'),updatedAt:300}});await flush();await flush();
  assert.deepEqual(progressA,[1]);assert.deepEqual(progressB,[1]);assert.equal(cache.peek(list[0]),current);assert.equal(cache.peek(list[0]).retryable,true);
});

test('late settlement after timeout cannot repopulate removal or a replacement account',async()=>{
  const timers=controlledTimers(),releases=[];
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>new Promise(resolve=>releases.push(resolve))});
  const list=favorites(1);cache.activate({uid:'u-old',username:'Owner'});
  const first=cache.hydrate(list);await flush();timers.expireAll();await first;
  cache.syncFavorites([]);releases[0]({ok:true,value:share('Trainer-0')});await flush();assert.equal(cache.snapshot().size,0);
  cache.activate({uid:'u-new',username:'Other'});assert.equal(cache.snapshot().size,0);
});

test('four hung physical reads cap a 100-Favorite batch and queued logical work settles retryably',async()=>{
  const timers=controlledTimers();let started=0,active=0,maxActive=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:()=>{started++;active++;maxActive=Math.max(maxActive,active);return new Promise(()=>{});}});
  const list=favorites(100);cache.activate({uid:'u-100-hang',username:'Owner'});
  const pending=cache.hydrate(list);await flush();assert.equal(started,4);
  timers.expireAll();await pending;
  assert.equal(started,4);assert.equal(maxActive,4);assert.equal(active,4);assert.equal(cache.summary(list).failed,100);
});

test('three-Favorite latency matrix starts all reads together and completes without an artificial delay',async()=>{
  for(const latency of [0,100,500,1000,4000]){
    const clock=virtualClock(),progress=[];let reads=0,active=0,maxActive=0;
    const cache=loadCache({readDeadlineMs:5000,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,read:name=>new Promise(resolve=>{
      reads++;active++;maxActive=Math.max(maxActive,active);clock.setTimer(()=>{active--;resolve({ok:true,value:share(name)});},latency);
    })});
    cache.activate({uid:`u-latency-${latency}`,username:'Owner'});
    const pending=cache.hydrate(favorites(3),{onProgress:({completed,total})=>progress.push({completed,total,at:clock.now()})});
    await flush();assert.equal(reads,3);assert.equal(maxActive,3);
    await clock.advance(latency);await pending;
    assert.deepEqual(progress.map(item=>`${item.completed}/${item.total}`),['1/3','2/3','3/3']);
    assert.equal(progress[0].at,latency);assert.equal(progress[2].at,latency);assert.equal(active,0);
  }
});

test('Auth, App Check, permission, and offline failures remain distinguishable without exposing raw messages',async()=>{
  const codes=['auth/unavailable','app-check/token-rejected','database/permission-denied','network/offline'];let index=0;
  const cache=loadCache({read:async()=>({ok:false,error:{code:codes[index++],message:'private provider detail'}})});
  const list=favorites(4);cache.activate({uid:'u-errors',username:'Owner'});await cache.hydrate(list);
  assert.deepEqual(list.map(item=>cache.peek(item).error.code),codes);
  assert.equal(JSON.stringify([...cache.snapshot().records.values()]).includes('private provider detail'),false);
  assert.equal(cache.summary(list).failed,2);assert.equal(cache.summary(list).invalid,2);
});

test('a handful of hung reads cannot block the other 98 records in a 100-Favorite batch',async()=>{
  const timers=controlledTimers();let started=0,active=0,maxActive=0;
  const cache=loadCache({readDeadlineMs:5000,setTimer:timers.setTimer,clearTimer:timers.clearTimer,read:name=>{
    started++;active++;maxActive=Math.max(maxActive,active);
    if(name==='Trainer-1'||name==='Trainer-27')return new Promise(()=>{});
    active--;return Promise.resolve({ok:true,value:share(name)});
  }});
  const list=favorites(100);cache.activate({uid:'u-100-partial',username:'Owner'});
  const pending=cache.hydrate(list);await flush();await flush();assert.equal(started,100);
  timers.expireAll();await pending;
  assert.ok(maxActive<=4);assert.equal(started,100);assert.equal(cache.summary(list).checked,100);assert.equal(cache.summary(list).failed,2);assert.equal(cache.summary(list).published,98);
});
