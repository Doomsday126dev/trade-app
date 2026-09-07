const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Permanent entry point used by immutable Pages control ddcfcdd. Atomic install,
// ownership/eviction and rollback have separate suites; this exercises fetch
// behavior across release keys (the asset-versioning suite checks source wiring).
function harness(){
  const base='https://example.test/trade-app/';
  const listeners=new Map(),stores=new Map(),fetches=[];
  let offline=false;
  const key=value=>new URL(typeof value==='string'?value:value.url,base).href;
  const caches={async open(name){
    if(!stores.has(name))stores.set(name,new Map());
    const values=stores.get(name);
    return{async match(request){return values.get(key(request));},async put(request,response){values.set(key(request),response.clone());}};
  }};
  const self={location:{href:`${base}sw.js`,origin:new URL(base).origin},addEventListener(type,listener){listeners.set(type,listener);}};
  const context=vm.createContext({self,caches,URL,Response,console,
    fetch:async(request,options)=>{
      fetches.push({url:key(request),options});
      if(offline)throw new Error('offline');
      return new Response(`network:${key(request)}`);
    }});
  vm.runInContext(readFileSync(path.join(__dirname,'..','sw.js'),'utf8'),context,{filename:'sw.js'});
  const release=vm.runInContext('RELEASE',context),shell=vm.runInContext('SHELL_CACHE',context);
  async function seed(url,body,name=shell){await(await caches.open(name)).put(url,new Response(body));}
  function fetchEvent(url,method='GET'){
    let response;const waits=[];
    listeners.get('fetch')({request:{url:new URL(url,base).href,method,mode:'cors'},respondWith(value){response=Promise.resolve(value);},waitUntil(value){waits.push(value);}});
    return{response,done:Promise.all(waits)};
  }
  return{release,shell,stores,fetches,seed,fetchEvent,offline(){offline=true;}};
}

test('current release cache hit serves exact bytes without a network refresh',async()=>{
  const run=harness(),url=`data.js?v=${run.release}`;
  await run.seed(url,'reviewed-current-bytes');
  const event=run.fetchEvent(url);
  assert.equal(await(await event.response).text(),'reviewed-current-bytes');
  await event.done;assert.equal(run.fetches.length,0);
});

test('other release and unversioned requests use network without poisoning current release bytes',async()=>{
  const run=harness(),url=`data.js?v=${run.release}`;
  await run.seed(url,'reviewed-current-bytes');
  for(const other of ['data.js?v=2000-01-01.1','data.js']){
    const event=run.fetchEvent(other);
    assert.match(await(await event.response).text(),/^network:/);await event.done;
  }
  const current=run.fetchEvent(url);
  assert.equal(await(await current.response).text(),'reviewed-current-bytes');await current.done;
  assert.equal(run.stores.get(run.shell).size,1);
  assert.equal(run.fetches.length,2);
});

test('current release cache miss reloads and stores the exact requested key',async()=>{
  const run=harness(),url=`js/domain/specialTradeBoardExport.js?v=${run.release}`;
  const first=run.fetchEvent(url);const bytes=await(await first.response).text();await first.done;
  assert.equal(run.fetches[0].options.cache,'reload');
  run.offline();const second=run.fetchEvent(url);
  assert.equal(await(await second.response).text(),bytes);await second.done;
  assert.equal(run.fetches.length,1);
});

test('offline release miss never substitutes an older or unversioned cached module',async()=>{
  const run=harness();
  await run.seed('data.js?v=2000-01-01.1','old-bytes');
  await run.seed('data.js','unversioned-bytes');
  await run.seed(`data.js?v=${run.release}`,'other-cache-bytes','shell-pogo-trades-2000-01-01.1');
  run.offline();const event=run.fetchEvent(`data.js?v=${run.release}`);
  await assert.rejects(event.response,/offline/);await event.done;
});

test('Firebase traffic and mutation requests bypass service-worker interception',async()=>{
  const run=harness();
  for(const url of ['https://example.firebaseio.com/private.json','https://example.firebasedatabase.app/private.json','https://identitytoolkit.googleapis.com/v1/accounts:lookup']){
    const event=run.fetchEvent(`${url}?v=${run.release}`);
    assert.equal(event.response,undefined);await event.done;
  }
  assert.equal(run.fetchEvent(`data.js?v=${run.release}`,'POST').response,undefined);
  assert.equal(run.fetches.length,0);assert.equal(run.stores.size,0);
});
