const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const currentSource=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
const targetRelease='2026-08-05.45';
const rollbackSource=currentSource.replace("const RELEASE='2026-08-05.47';",`const RELEASE='${targetRelease}';`);
function key(value){return typeof value==='string'?value:String(value?.url||value);}
function response(status=200,body='ok'){return{ok:status>=200&&status<300,status,body,clone(){return response(status,body);}};}
class MemoryCache{
  constructor(){this.values=new Map();}
  async put(name,value){this.values.set(key(name),value.clone());}
  async match(name){return this.values.get(key(name));}
  async keys(){return[...this.values.keys()].map(url=>({url}));}
  async delete(name){return this.values.delete(key(name));}
}
function harness({failUrl=''}={}){
  const stores=new Map(),listeners=new Map();let offline=false,claims=0;
  const newer='shell-pogo-trades-2026-08-05.47',newerSprites='sprites-pogo-trades-2026-08-05.47';
  const newerCache=new MemoryCache();newerCache.values.set('./index.html?v=2026-08-05.47',response(200,'newer-shell'));
  stores.set(newer,newerCache);stores.set(newerSprites,new MemoryCache());stores.set('same-origin-unrelated-cache',new MemoryCache());
  const caches={async open(name){if(!stores.has(name))stores.set(name,new MemoryCache());return stores.get(name);},async delete(name){return stores.delete(name);},async keys(){return[...stores.keys()];}};
  const self={location:{origin:'https://example.test',href:'https://example.test/trade-app/sw.js'},clients:{async claim(){claims++;}},async skipWaiting(){},addEventListener(type,listener){listeners.set(type,listener);}};
  const fetch=async url=>{if(offline)throw new Error('offline');if(String(url)===failUrl)return response(404);return response(200,String(url).startsWith('./index.html')?'rollback-shell':'asset');};
  const context=vm.createContext({self,caches,fetch,URL,Promise,Map,Set,Error,Response,Blob,Uint8Array,atob,console});
  vm.runInContext(rollbackSource,context,{filename:'rollback-sw.js'});
  async function lifecycle(type){const waits=[];listeners.get(type)({waitUntil(value){waits.push(Promise.resolve(value));}});return Promise.all(waits);}
  async function navigate(){const waits=[];let result;listeners.get('fetch')({request:{method:'GET',url:'https://example.test/trade-app/settings',mode:'navigate'},respondWith(value){result=Promise.resolve(value);},waitUntil(value){waits.push(Promise.resolve(value));}});const value=await result;await Promise.all(waits);return value;}
  return{stores,newer,newerSprites,lifecycle,navigate,setOffline(){offline=true;},required:vm.runInContext('REQUIRED_SHELL_URLS',context),shell:vm.runInContext('SHELL_CACHE',context),isObsolete:name=>vm.runInContext(`isObsoleteTradeAppCache(${JSON.stringify(name)})`,context),claims:()=>claims};
}

test('rollback installs a complete older shell, activates atomically, preserves unrelated caches, and works offline',async()=>{
  const run=harness();
  assert.equal(run.isObsolete(run.newer),true,'newer cache is obsolete without release ordering assumptions');
  await run.lifecycle('install');
  assert.equal(run.stores.has(run.newer),true,'newer shell remains until target activation');
  const target=run.stores.get(run.shell);
  assert.equal((await Promise.all(run.required.map(url=>target.match(url)))).every(Boolean),true);
  await run.lifecycle('activate');
  assert.equal(run.stores.has(run.newer),false);assert.equal(run.stores.has(run.newerSprites),false);
  assert.equal(run.stores.has('same-origin-unrelated-cache'),true);assert.equal(run.claims(),1);
  run.setOffline();
  const offline=await run.navigate();
  assert.equal(offline.ok,true);assert.equal(offline.body,'rollback-shell');
});

test('failed rollback installation leaves the newer complete shell authoritative',async()=>{
  const probe=harness();const run=harness({failUrl:probe.required[4]});
  await assert.rejects(run.lifecycle('install'),/Required shell asset failed/);
  assert.equal(run.stores.has(run.newer),true);
  assert.equal(run.stores.has(run.shell),false);
  assert.equal(run.stores.has('same-origin-unrelated-cache'),true);
});
