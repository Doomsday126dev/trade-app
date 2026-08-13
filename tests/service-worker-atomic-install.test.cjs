const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

class MemoryCache{
  constructor(){this.values=new Map();}
  async put(key,response){this.values.set(String(key),response.clone());}
  async match(key){return this.values.get(String(key));}
  async keys(){return[...this.values.keys()].map(url=>({url}));}
  async delete(key){return this.values.delete(String(key));}
}

function response(status=200,body='ok'){
  return{ok:status>=200&&status<300,status,body,clone(){return response(status,body);}};
}

function harness({failUrl='',timeoutUrl='',pendingUrl='',seedOld=true,seedCurrent=false}={}){
  const stores=new Map(),listeners=new Map(),events=[];
  const oldName='shell-pogo-trades-2026-08-05.40';
  if(seedOld){const old=new MemoryCache();old.values.set('./index.html?v=2026-08-05.40',response());stores.set(oldName,old);}
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,new MemoryCache());return stores.get(name);},
    async delete(name){return stores.delete(name);},async keys(){return[...stores.keys()];}
  };
  let skipWaiting=0,claims=0;
  const self={location:{origin:'https://example.test',href:'https://example.test/trade-app/sw.js'},clients:{async claim(){claims++;}},
    async skipWaiting(){skipWaiting++;},addEventListener(type,listener){listeners.set(type,listener);}};
  let rejectPending;
  const context=vm.createContext({self,caches,URL,Promise,Map,Set,Error,Response:class{},Blob:class{},Uint8Array,atob:()=>'',
    fetch:async url=>{if(String(url)===pendingUrl)return new Promise((resolve,reject)=>{rejectPending=reject;});if(String(url)===timeoutUrl)throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});if(String(url)===failUrl)return response(404);return response();}});
  vm.runInContext(source,context,{filename:'sw.js'});
  const required=vm.runInContext('REQUIRED_SHELL_URLS',context),shellName=vm.runInContext('SHELL_CACHE',context),installName=vm.runInContext('INSTALL_CACHE',context);
  if(seedCurrent){const current=stores.get(shellName)||new MemoryCache();for(const url of required)current.values.set(url,response());stores.set(shellName,current);}
  async function dispatch(type,data){let pending;listeners.get(type)({data,waitUntil(value){pending=Promise.resolve(value);}});events.push(type);return pending;}
  return{context,required,shellName,installName,stores,oldName,dispatch,rejectPending:error=>rejectPending?.(error),counts:()=>({skipWaiting,claims}),events};
}

test('pre-fix failure path swallowed addAll rejection and still requested activation',async()=>{
  let skipWaiting=0;
  const oldInstall=async cache=>{try{await cache.addAll();}catch{}skipWaiting++;};
  await oldInstall({addAll:async()=>{throw new Error('one required asset failed');}});
  assert.equal(skipWaiting,1);
});

test('one required 404 rejects install, removes the incomplete new cache, and preserves the old release',async()=>{
  const probe=harness();const failed=harness({failUrl:probe.required[3]});
  await assert.rejects(failed.dispatch('install'),/Required shell asset failed/);
  assert.equal(failed.counts().skipWaiting,0);
  assert.equal(failed.stores.has(failed.shellName),false);
  assert.equal(failed.stores.has(failed.installName),false);
  assert.equal(failed.stores.has(failed.oldName),true);
});

test('required timeout rejects a fresh install without leaving an empty active cache',async()=>{
  const probe=harness({seedOld:false});const failed=harness({seedOld:false,timeoutUrl:probe.required[5]});
  await assert.rejects(failed.dispatch('install'),/timeout/);
  assert.equal(failed.counts().skipWaiting,0);
  assert.equal(failed.stores.has(failed.shellName),false);
  assert.equal(failed.stores.has(failed.installName),false);
});

test('required timeout during an update leaves the old release authoritative',async()=>{
  const probe=harness();const failed=harness({timeoutUrl:probe.required[5]});
  await assert.rejects(failed.dispatch('install'),/timeout/);
  assert.equal(failed.counts().skipWaiting,0);
  assert.equal(failed.stores.has(failed.oldName),true);
  assert.equal(failed.stores.has(failed.shellName),false);
  assert.equal(failed.stores.has(failed.installName),false);
});

test('reloads during a pending update keep the old release authoritative',async()=>{
  const probe=harness(),run=harness({pendingUrl:probe.required[7]});
  const installing=run.dispatch('install');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(run.stores.has(run.oldName),true);
  assert.equal(run.counts().skipWaiting,0);
  run.rejectPending(new Error('network dropped while updating'));
  await assert.rejects(installing,/network dropped/);
  assert.equal(run.stores.has(run.oldName),true);
  assert.equal(run.stores.has(run.shellName),false);
  assert.equal(run.stores.has(run.installName),false);
});

test('successful install creates a complete required shell before skipWaiting',async()=>{
  const run=harness();await run.dispatch('install');
  const cache=run.stores.get(run.shellName);
  assert.ok(cache);
  assert.equal(run.counts().skipWaiting,1);
  assert.equal((await Promise.all(run.required.map(url=>cache.match(url)))).every(Boolean),true);
  assert.equal(run.stores.has(run.installName),false);
  assert.equal(run.stores.has(run.oldName),true);
});

test('activation verifies completeness before deleting old caches or claiming clients',async()=>{
  const broken=harness();await assert.rejects(broken.dispatch('activate'),/complete required shell/);
  assert.equal(broken.stores.has(broken.oldName),true);assert.equal(broken.counts().claims,0);
  const ready=harness();await ready.dispatch('install');await ready.dispatch('activate');
  assert.equal(ready.stores.has(ready.oldName),false);assert.equal(ready.counts().claims,1);
});

test('a same-release reinstall reuses an already complete shell without rewriting it',async()=>{
  const probe=harness();const run=harness({seedCurrent:true,failUrl:probe.required[2]});
  await run.dispatch('install');
  const cache=run.stores.get(run.shellName);
  assert.ok(cache);assert.equal((await Promise.all(run.required.map(url=>cache.match(url)))).every(Boolean),true);
  assert.equal(run.counts().skipWaiting,1);
});

test('a skip-waiting message cannot bypass required-shell validation',async()=>{
  const broken=harness();await broken.dispatch('message','SKIP_WAITING');assert.equal(broken.counts().skipWaiting,0);
  const ready=harness();await ready.dispatch('install');const before=ready.counts().skipWaiting;
  await ready.dispatch('message','SKIP_WAITING');assert.equal(ready.counts().skipWaiting,before+1);
});

test('navigation fallback keeps the cached versioned index for offline deep links',()=>{
  assert.match(source,/req\.mode==='navigate'/);
  assert.match(source,/cache\.match\(`\.\/index\.html\?v=\$\{RELEASE\}`\)/);
  assert.match(source,/if\(isFirebase\(url\)\)return/);
});

test('runtime shell writes are limited to canonical optional assets, never arbitrary navigation/query URLs',()=>{
  const run=harness();
  const canonical=vm.runInContext("runtimeShellCacheKey({url:'https://example.test/trade-app/manifest.json?cachebust=1',mode:'cors'})",run.context);
  assert.equal(canonical,'https://example.test/trade-app/manifest.json');
  for(const expression of [
    "runtimeShellCacheKey({url:'https://example.test/trade-app/?search=private',mode:'navigate'})",
    "runtimeShellCacheKey({url:'https://example.test/trade-app/arbitrary.json?x=1',mode:'cors'})",
    "runtimeShellCacheKey({url:'https://other.test/trade-app/manifest.json',mode:'cors'})"
  ])assert.equal(vm.runInContext(expression,run.context),null);
});

test('activation removes multiple obsolete and failed staging caches while preserving only current bounded caches',async()=>{
  const run=harness();await run.dispatch('install');
  run.stores.set('shell-pogo-trades-2026-08-05.38',new MemoryCache());
  run.stores.set('shell-pogo-trades-2026-08-05.42-installing',new MemoryCache());
  await run.dispatch('activate');
  assert.deepEqual([...run.stores.keys()].sort(),[run.shellName].sort());
});
