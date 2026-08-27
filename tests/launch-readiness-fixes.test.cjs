const test=require('node:test');
const assert=require('node:assert/strict');
const{readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const between=(start,end)=>{
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('UX-01 order metadata is explicit, account-partitioned, and Firebase-schema neutral',()=>{
  const order=between("const MY_LIST_ORDER_PREFIX='pogoMyListOrder_v1';",'function myListEditorHtml');
  assert.match(order,/auth\?\.currentUser\?\.uid\|\|currentAuthUid/);
  assert.match(order,/owner\?\.uid!==uid\|\|value\.owner\?\.username!==user/);
  assert.match(order,/applyExplicitMyListOrder/);
  assert.match(order,/currentListEntries\(type\)\.forEach/);
  assert.match(order,/\['H','M','L','U'\]/);
  assert.doesNotMatch(order,/writeList|queueSync|Firebase|ref\(db/);
  const priority=between('function movePriority','function dragEnd');
  assert.match(priority,/model\.priorities\[sourceKey\].*filter/);
  assert.match(priority,/model\.priorities\[targetKey\]\.push\(name\)/);
});

test('UX-01 exposes pointer and keyboard controls only in reorder mode',()=>{
  const rows=between('function myListRowHtml','function myListPrioritySectionHtml');
  assert.match(rows,/reorderMode\?`<button type="button" class="drag-handle"/);
  assert.match(rows,/onpointerdown="myListPointerStart\(event\)"/);
  assert.match(rows,/data-reorder-move="up"/);assert.match(rows,/data-reorder-move="down"/);
  assert.match(rows,/priorityIndex<=0\?'disabled'/);assert.match(rows,/priorityIndex>=priorityCount-1\?'disabled'/);
  const movement=between('function dragDrop','function announceMyListAction');
  assert.match(movement,/sourcePriority!==targetPriority/);
  assert.doesNotMatch(movement,/pointerType==='mouse'/);
  assert.match(movement,/document\.elementFromPoint/);
  assert.match(movement,/querySelector\('\.drag-handle'\)\?\.focus/);
});

test('A11Y-02 Special Trade Board uses deep stable combobox focus',()=>{
  const markup=between('<div class="modal special-board-modal">','<div class="ov" id="shortcuts-modal"');
  for(const side of['lf','ft']){
    assert.match(markup,new RegExp(`id="special-${side}-ac"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="false"[^>]*aria-controls="special-${side}-dd"`));
    assert.match(markup,new RegExp(`id="special-${side}-dd" role="listbox"`));
  }
  const special=between('let _specialAcFocus','function openSpecialTradeBoard');
  assert.match(special,/\(_specialAcFocus\[side\]\?\?-1\)\+1/);
  assert.doesNotMatch(special,/\(_specialAcFocus\[side\]\|\|-1\)/);
  assert.match(special,/id="special-\$\{side\}-option-\$\{i\}" role="option" aria-selected="false"/);
  assert.match(special,/aria-activedescendant/);assert.match(special,/scrollIntoView\(\{block:'nearest'\}\)/);
  assert.match(special,/onpointerdown="event\.preventDefault\(\);specialAcSelect/);
  assert.match(special,/ev\.stopPropagation\(\);_closeSpecialAc\(side\)/);
});

function typeHarness(fetchImpl){
  const storage=new Map(),context=vm.createContext({
    pokemonTypes:{},fetch:fetchImpl,AbortController,setTimeout,clearTimeout,Promise,Map,Array,Object,Number,parseInt,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    TYPE_COLORS:{grass:'#0f0'},document:{querySelectorAll:()=>[]},IntersectionObserver:undefined
  });
  vm.runInContext(between("const TYPE_CACHE_KEY='pogoTypeCache_v1';",'// ── TRADE SCHEDULE'),context);
  return context;
}

test('PERF-01 dedupes unresolved same-dex work and releases failed keys',async()=>{
  let calls=0,release;
  const context=typeHarness(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  const promises=vm.runInContext('Array.from({length:100},()=>fetchPokemonType(25))',context);
  await tick();assert.equal(calls,1);assert.ok(promises.every(promise=>promise===promises[0]));
  release({ok:true,json:async()=>({types:[{type:{name:'electric'}}]})});
  assert.deepEqual(await Promise.all(promises),Array(100).fill('electric'));

  let failures=0;
  const failed=typeHarness(async()=>{failures++;throw new Error('offline');});
  assert.equal(await vm.runInContext('fetchPokemonType(7)',failed),null);
  assert.equal(await vm.runInContext('fetchPokemonType(7)',failed),null);
  assert.equal(failures,2);
});

test('PERF-01 bounds 1,000 distinct requests to four active fetches',async()=>{
  let active=0,peak=0,started=0;
  const controls=[];
  const context=typeHarness(()=>{started++;active++;peak=Math.max(peak,active);return new Promise(resolve=>controls.push(()=>{active--;resolve({ok:true,json:async()=>({types:[{type:{name:'grass'}}]})});}));});
  const all=vm.runInContext('Promise.all(Array.from({length:1000},(_,index)=>fetchPokemonType(index+1)))',context);
  await tick();assert.equal(started,4);assert.equal(peak,4);
  while(started<1000||active){const batch=controls.splice(0);batch.forEach(resolve=>resolve());await tick();}
  const values=await all;
  assert.equal(values.length,1000);assert.equal(started,1000);assert.equal(peak,4);
});

function spriteHarness(){
  const instances=[];let active=0,peak=0;
  class FakeImage{
    set src(value){this._src=value;active++;peak=Math.max(peak,active);instances.push(this);}
    fail(){active--;this.onerror?.();}
  }
  const storage=new Map(),document={querySelectorAll:()=>[],createElement:()=>({getContext:()=>null})};
  const context=vm.createContext({
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    Image:FakeImage,document,IMAGE_PROXY_BASE:'https://images.weserv.nl/?url=',setTimeout,clearTimeout,Date,Math,JSON,Promise,Map,Array,Object,Number,parseFloat
  });
  vm.runInContext(between("const SPRITE_SCALE_CACHE_KEY='pogoSpriteScales_v4';",'// ── SESSION PERSISTENCE'),context);
  return{context,instances,get peak(){return peak;},get active(){return active;}};
}

test('PERF-02 markup creation performs zero probes and loaded sprites share bounded work',async()=>{
  const sprite=between('function spriteImg','// ── SESSION PERSISTENCE');
  const markup=sprite.slice(0,sprite.indexOf('function validateSpriteLoad'));
  const fallback=sprite.slice(sprite.indexOf('function trySpriteFallback'));
  assert.doesNotMatch(markup,/detectSpriteScale\(/);
  assert.doesNotMatch(fallback,/detectSpriteScale\(/);
  assert.match(sprite,/function validateSpriteLoad[\s\S]*detectSpriteScale\(img\.dataset\.srcKey\)/);

  const harness=spriteHarness();
  vm.runInContext("globalThis.pending=Array.from({length:1000},(_,index)=>detectSpriteScale('https://img.example/'+index+'.png'))",harness.context);
  await tick();assert.equal(harness.instances.length,4);assert.equal(harness.peak,4);
  let failed=0;
  while(failed<1000){const batch=harness.instances.slice(failed);if(!batch.length){await tick();continue;}batch.forEach(image=>image.fail());failed+=batch.length;await tick();}
  await vm.runInContext('Promise.all(pending)',harness.context);
  assert.equal(harness.instances.length,1000);assert.equal(harness.peak,4);assert.equal(harness.active,0);
});

test('PERF-02 same canonical sprite reuses one unresolved optical probe',async()=>{
  const harness=spriteHarness();
  const pending=vm.runInContext("Array.from({length:100},()=>detectSpriteScale('https://img.example/pikachu.png'))",harness.context);
  await tick();assert.equal(harness.instances.length,1);assert.ok(pending.every(promise=>promise===pending[0]));
  harness.instances[0].fail();await Promise.all(pending);
});
