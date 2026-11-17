const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../js/app/application.js'),'utf8');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function section(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test('CSV and Markdown preserve category and reuse localized preview category labels',async()=>{
  let copied='';
  const entries=['wishlist','dynamax','gmax'].map(category=>({name:'Bulbasaur',dn:'Bulbasaur',category,no:1,p:'H'}));
  const ctx=vm.createContext({productDeclarations:()=>({entries}),i18nCore:{t:key=>({'list.dynamax':'Dynamax','list.gigantamax':'Gigantamax','wants.title':'Wants'}[key]||key)},allData:{users:{}},cur:'Tester',copyText:async text=>{copied=text;},toast(){}});
  vm.runInContext(section(app,'function productShareCategoryLabel(','function productShareDescription('),ctx);
  vm.runInContext(section(app,'function productTextRows(){','function exportMyListCSV(){'),ctx);
  const rows=ctx.productTextRows();assert.deepEqual(Array.from(rows,x=>x.category),['wishlist','dynamax','gmax']);
  assert.deepEqual(Array.from(rows,x=>x.name),['Bulbasaur','Bulbasaur · Dynamax','Bulbasaur · Gigantamax']);
  await ctx.exportMyListMarkdown();assert.match(copied,/Bulbasaur · Dynamax/);assert.match(copied,/Bulbasaur · Gigantamax/);
  entries[1].dn='Dynamax Bulbasaur';assert.equal(ctx.productTextRows()[1].name,'Dynamax Bulbasaur');
});
function imageHarness(){
  const images=[],timers=new Map();let id=0;
  class Image{constructor(){images.push(this);}set src(v){this.url=v;}removeAttribute(){this.url='';}}
  const ctx=vm.createContext({Image,setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i)});
  vm.runInContext(section(app,'const canvasImageCache=new Map();','const canvasImageUsableCache='),ctx);
  vm.runInContext(section(app,'function drainCanvasImageQueue(){','// Load with cascading fallback'),ctx);
  return {ctx,images,timers};
}
test('artwork failed requests can retry, concurrent requests deduplicate, success caches',async()=>{
  const {ctx,images}=imageHarness();const p=ctx.loadCanvasImage('a');assert.equal(ctx.loadCanvasImage('a'),p);assert.equal(images.length,1);
  images[0].onerror();assert.equal(await p,null);const retry=ctx.loadCanvasImage('a');assert.equal(images.length,2);images[1].onload();assert.equal(await retry,images[1]);assert.equal(await ctx.loadCanvasImage('a'),images[1]);assert.equal(images.length,2);
});
test('artwork concurrency is bounded and stalled requests release slots and can retry',async()=>{
  const {ctx,images,timers}=imageHarness();const tasks=Array.from({length:8},(_,i)=>ctx.loadCanvasImage('i'+i));assert.equal(images.length,6);
  [...timers.values()][0]();assert.equal(await tasks[0],null);assert.equal(images.length,7);
  images[1].onerror();assert.equal(images.length,8);for(const image of images.slice(2)){image.onload?.();}await Promise.all(tasks);
  const retry=ctx.loadCanvasImage('i0');assert.equal(images.length,9);images[8].onload();await retry;assert.equal(timers.size,0);
});
function scriptHarness(){const scripts=[];const doc={baseURI:'https://example.test/',head:{appendChild:s=>scripts.push(s)},createElement(){return {dataset:{},events:{},addEventListener(k,v){this.events[k]=v;},remove(){scripts.splice(scripts.indexOf(this),1);}};}};
  const ctx=vm.createContext({document:doc,URL});vm.runInContext('const loadedScripts=new Set();const loadingScripts=new Map();'+section(html,'  function absoluteScriptUrl(','  async function ensureLocale'),ctx);return {ctx,scripts};}
test('script concurrent callers await actual execution and failed loads retry',async()=>{
  const {ctx,scripts}=scriptHarness();const first=ctx.loadScript('a.js',{ordered:true});let completed=false;first.then(()=>completed=true,()=>{});
  assert.equal(ctx.loadScript('a.js'),first);await Promise.resolve();assert.equal(completed,false);assert.equal(scripts.length,1);assert.equal(scripts[0].async,false);
  scripts[0].events.error();await assert.rejects(first,/Failed to load/);assert.equal(scripts.length,0);
  const retry=ctx.loadScript('a.js');assert.equal(scripts.length,1);scripts[0].events.load();await retry;await ctx.loadScript('a.js');assert.equal(scripts.length,1);
});
test('feature loader uses same ordered in-flight loader as public and locale paths',async()=>{
  const {ctx,scripts}=scriptHarness();ctx.featureAssetSources=()=>['one.js','two.js'];vm.runInContext(section(html,'  async function loadFeatureScripts(){','  async function loadPublicShareScripts()'),ctx);
  const first=ctx.loadFeatureScripts(),second=ctx.loadFeatureScripts();assert.equal(scripts.length,2);assert.ok(scripts.every(s=>s.async===false));for(const s of scripts)s.events.load();await Promise.all([first,second]);
});
