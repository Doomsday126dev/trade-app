const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

function cacheKey(value){return typeof value==='string'?value:String(value?.url||value);}

class MemoryCache{
  constructor({putBarrier=null,failPut=false}={}){this.values=new Map();this.putBarrier=putBarrier;this.failPut=failPut;}
  async put(key,value){
    if(this.putBarrier)await this.putBarrier();
    if(this.failPut)throw new Error('simulated cache write failure');
    this.values.set(cacheKey(key),value.clone());
  }
  async match(key){return this.values.get(cacheKey(key));}
  async keys(){return[...this.values.keys()].map(url=>({url}));}
  async delete(key){return this.values.delete(cacheKey(key));}
}

function response(status=200,body='ok'){
  return{ok:status>=200&&status<300,status,body,clone(){return response(status,body);}};
}

function createHarness({fetchImpl=async()=>response(),cacheFactory=()=>new MemoryCache()}={}){
  const stores=new Map(),listeners=new Map(),warnings=[];
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,cacheFactory(name));return stores.get(name);},
    async delete(name){return stores.delete(name);},
    async keys(){return[...stores.keys()];}
  };
  let claims=0,skipWaiting=0;
  const self={
    location:{origin:'https://example.test',href:'https://example.test/trade-app/sw.js'},
    clients:{async claim(){claims++;}},
    async skipWaiting(){skipWaiting++;},
    addEventListener(type,listener){listeners.set(type,listener);}
  };
  const context=vm.createContext({
    self,caches,fetch:fetchImpl,URL,Promise,Map,Set,Error,Response,Blob,Uint8Array,atob,
    console:{warn(...args){warnings.push(args);}}
  });
  vm.runInContext(source,context,{filename:'sw.js'});

  function dispatchLifecycle(type,data){
    const waits=[];
    listeners.get(type)({data,waitUntil(value){waits.push(Promise.resolve(value));}});
    return Promise.all(waits);
  }
  function dispatchFetch(request){
    const waits=[];let responsePromise;
    listeners.get('fetch')({
      request,
      respondWith(value){responsePromise=Promise.resolve(value);},
      waitUntil(value){waits.push(Promise.resolve(value));}
    });
    return{response:responsePromise,waits,complete:Promise.all(waits)};
  }
  return{
    context,stores,warnings,dispatchLifecycle,dispatchFetch,
    required:vm.runInContext('REQUIRED_SHELL_URLS',context),
    release:vm.runInContext('RELEASE',context),
    shellName:vm.runInContext('SHELL_CACHE',context),
    spriteName:vm.runInContext('SPRITE_CACHE',context),
    spriteLimit:vm.runInContext('SPRITE_CACHE_LIMIT',context),
    counts:()=>({claims,skipWaiting})
  };
}

function request(url,mode='cors'){return{method:'GET',url,mode};}

test('PWA-02 cache ownership recognizes only reviewed release and legacy names',()=>{
  const run=createHarness();
  const cases={
    'shell-pogo-trades-2026-08-05.40':true,
    'shell-pogo-trades-2026-08-05.42-installing':true,
    'sprites-pogo-trades-2026-08-05.43':true,
    'shell-pogo-trades-v12':true,
    'sprites-pogo-trades-v9':true,
    'trade-app-shell-v40':false,
    'shell-pogo-trades-backup':false,
    'shell-pogo-trades-v12-copy':false,
    'sprites-pogo-trades-v9-other':false,
    'unrelated-other-app-cache':false,
    'arbitrary-third-party-name':false
  };
  for(const[name,owned]of Object.entries(cases)){
    assert.equal(vm.runInContext(`isTradeAppCacheName(${JSON.stringify(name)})`,run.context),owned,name);
  }
});

test('PWA-02 activation removes only obsolete Trade App caches and preserves unrelated caches',async()=>{
  const run=createHarness();
  for(const name of [
    'shell-pogo-trades-2026-08-05.40',
    'sprites-pogo-trades-2026-08-05.41',
    'shell-pogo-trades-2026-08-05.42-installing',
    'shell-pogo-trades-v12',
    'sprites-pogo-trades-v9',
    'unrelated-other-app-cache',
    'unrelated-tool-cache',
    'arbitrary-third-party-name',
    'shell-pogo-trades-backup'
  ])run.stores.set(name,new MemoryCache());
  run.stores.set(run.spriteName,new MemoryCache());

  await run.dispatchLifecycle('install');
  await run.dispatchLifecycle('activate');

  assert.deepEqual([...run.stores.keys()].sort(),[
    run.shellName,run.spriteName,
    'unrelated-other-app-cache','unrelated-tool-cache','arbitrary-third-party-name','shell-pogo-trades-backup'
  ].sort());
  assert.equal(run.counts().claims,1);
});

test('PWA-02 multi-release upgrade cleans successful and failed generations without crossing ownership boundary',async()=>{
  const run=createHarness();
  for(const name of [
    'shell-pogo-trades-2026-08-05.40','sprites-pogo-trades-2026-08-05.40',
    'shell-pogo-trades-2026-08-05.41','sprites-pogo-trades-2026-08-05.41',
    'shell-pogo-trades-2026-08-05.42-installing',
    'shell-pogo-trades-2026-08-05.43','sprites-pogo-trades-2026-08-05.43',
    'other-origin-app-cache-v1'
  ])run.stores.set(name,new MemoryCache());
  run.stores.set(run.spriteName,new MemoryCache());

  await run.dispatchLifecycle('install');
  await run.dispatchLifecycle('activate');

  assert.deepEqual([...run.stores.keys()].sort(),[run.shellName,run.spriteName,'other-origin-app-cache-v1'].sort());
});

test('PWA-03 optional shell write is event-owned without delaying response delivery',async()=>{
  let releasePut;
  const run=createHarness({cacheFactory:name=>new MemoryCache({
    putBarrier:name.includes('shell-')?()=>new Promise(resolve=>{releasePut=resolve;}):null
  })});
  const event=run.dispatchFetch(request('https://example.test/trade-app/manifest.json?cachebust=1'));
  const delivered=await event.response;
  assert.equal(delivered.ok,true);
  assert.equal(event.waits.length,1);
  let maintenanceDone=false;event.complete.then(()=>{maintenanceDone=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(maintenanceDone,false);
  releasePut();await event.complete;
  assert.equal(maintenanceDone,true);
  assert.ok(await run.stores.get(run.shellName).match('https://example.test/trade-app/manifest.json'));
});

test('PWA-03 release-asset write is event-owned and keeps exact release response semantics',async()=>{
  let releasePut;
  const run=createHarness({cacheFactory:name=>new MemoryCache({
    putBarrier:name.includes('shell-')?()=>new Promise(resolve=>{releasePut=resolve;}):null
  })});
  const url=`https://example.test/trade-app/data.js?v=${run.release}`;
  const event=run.dispatchFetch(request(url));
  assert.equal((await event.response).ok,true);
  assert.equal(event.waits.length,1);
  releasePut();await event.complete;
  assert.ok(await run.stores.get(run.shellName).match(url));
});

test('PWA-03 sprite writes and trimming are event-owned, serialized, and bounded under concurrency',async()=>{
  for(const count of [1,5,20]){
    const run=createHarness();
    const sprites=await vm.runInContext('caches.open(SPRITE_CACHE)',run.context);
    const seed=Math.max(0,run.spriteLimit-5);
    for(let i=0;i<seed;i++)sprites.values.set(`https://img.pokemondb.net/sprites/seed-${i}.png`,response());
    const events=Array.from({length:count},(_,i)=>run.dispatchFetch(request(`https://img.pokemondb.net/sprites/new-${i}.png`)));
    const delivered=await Promise.all(events.map(event=>event.response));
    assert.equal(delivered.every(item=>item.ok),true,`${count} responses`);
    assert.equal(events.every(event=>event.waits.length===1),true,`${count} waitUntil registrations`);
    await Promise.all(events.map(event=>event.complete));
    assert.equal(sprites.values.size,Math.min(run.spriteLimit,seed+count),`${count} bounded writes`);
    assert.equal(run.warnings.length,0);
    assert.deepEqual([...run.stores.keys()],[run.spriteName]);
  }
});

test('PWA-03 cache-maintenance rejection is handled without rejecting the response or event lifetime',async()=>{
  const run=createHarness({cacheFactory:()=>new MemoryCache({failPut:true})});
  const event=run.dispatchFetch(request('https://img.pokemondb.net/sprites/failure.png'));
  assert.equal((await event.response).ok,true);
  await assert.doesNotReject(event.complete);
  assert.equal(run.warnings.length,1);
});

test('offline navigation and supported deep links fall back to the complete versioned shell',async()=>{
  let offline=false;
  const run=createHarness({fetchImpl:async()=>{
    if(offline)throw new Error('offline');
    return response();
  }});
  await run.dispatchLifecycle('install');
  await run.dispatchLifecycle('activate');
  offline=true;
  for(const url of [
    'https://example.test/trade-app/',
    'https://example.test/trade-app/#settings/appearance',
    'https://example.test/trade-app/?trainer=ExampleTrainer'
  ]){
    const event=run.dispatchFetch(request(url,'navigate'));
    assert.equal((await event.response).ok,true,url);
    await event.complete;
  }
});
