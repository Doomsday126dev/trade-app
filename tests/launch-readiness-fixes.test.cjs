const test=require('node:test');
const assert=require('node:assert/strict');
const{readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const primaryTypeSource=readFileSync(path.join(root,'js/domain/pokemonPrimaryTypes.js'),'utf8');
const between=(start,end)=>{
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('UX-01 order metadata is explicit, account-partitioned, and Firebase-schema neutral',()=>{
  const order=between("const MY_LIST_ORDER_PREFIX='pogoMyListOrder_v1';",'function currentListEntries(');
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

// The wants-only release removed normal reorder and LF/FT Board editing UI.
// Keep their persisted-order isolation proof above, but qualify the current editing
// and Board presentation contracts here instead of unreachable renderer functions.
test('UX-01 wants rows offer named edit and remove actions without drag-only interaction',()=>{
  const rows=between('function renderCombinedList(','function toggleWantsSection(');
  assert.match(rows,/class="myrow-edit"[^>]+onclick="openCombinedEditor\(this\.dataset\.group,this\)"/);
  assert.match(rows,/class="myrow-remove"[^>]+onclick="removeWantsGroup\(this\.dataset\.group\)"/);
  assert.match(rows,/aria-label=.*myList\.openMoreFor/);
  assert.match(rows,/aria-label=.*myList\.removeEntry/);
  assert.doesNotMatch(rows,/draggable=|onpointerdown=|drag-handle/);
  const active=between('<!-- MY LIST -->','<!-- SCHEDULE -->');assert.doesNotMatch(active,/mylist-reorder-toggle|toggleReorderMode/);
});

test('A11Y-02 Board is a wants-only image selection and editing returns to the shared list',()=>{
  const markup=between('<div class="modal special-board-modal">','<div class="ov" id="event-detail-modal"');
  assert.match(markup,/id="special-lf-list"/);assert.match(markup,/onclick="exportSpecialBoardImage\(\)"/);
  assert.match(markup,/closeModal\('special-board-modal'\);switchTab\('mylist'\)/);
  assert.doesNotMatch(markup,/special-(?:lf|ft)-ac|special-ft-list|role="combobox"/);
  const editor=between('id="combined-editor-modal"','<!-- SETTINGS');
  assert.match(editor,/aria-modal="true"/);assert.match(editor,/id="combined-name"[^>]*list="combined-catalog"[^>]*required/);
  assert.match(editor,/id="combined-save"/);assert.match(editor,/id="combined-error"/);
});

function primaryTypeDomain(){
  const context=vm.createContext({window:{}});
  vm.runInContext(primaryTypeSource,context);
  return context.window.PogoDomain.pokemonPrimaryTypes;
}

test('PERF-01 primary-type accents use the complete repository-owned map with no cold network work',()=>{
  const domain=primaryTypeDomain();
  assert.equal(domain.schemaVersion,1);
  assert.equal(domain.count,1025);
  assert.equal(domain.types.length,1026);
  assert.equal(domain.primaryTypeForDex(1),'grass');
  assert.equal(domain.primaryTypeForDex(6),'fire');
  assert.equal(domain.primaryTypeForDex(25),'electric');
  assert.equal(domain.primaryTypeForDex(130),'water');
  assert.equal(domain.primaryTypeForDex(1025),'poison');
  for(const invalid of [0,-1,1.5,1026,'not-a-dex',null])assert.equal(domain.primaryTypeForDex(invalid),'');
  assert.equal(new Set(domain.types.slice(1)).size,18);

  const typeBlock=between('// ── POKEMON TYPE COLORS','// ── TRADE SCHEDULE');
  assert.match(typeBlock,/primaryTypeForDex\(dex\)/);
  assert.match(typeBlock,/\.myrow\[data-dex\],\.pgrid \.pc\[data-dex\]/);
  assert.doesNotMatch(typeBlock,/fetch\(|localStorage|IntersectionObserver|pokeapi/i);
});

function spriteHarness(){
  const instances=[];let active=0,peak=0;
  class FakeImage{
    set src(value){this._src=value;active++;peak=Math.max(peak,active);instances.push(this);}
    fail(){active--;this.onerror?.();}
  }
  const storage=new Map(),origin='https://app.example',document={baseURI:`${origin}/`,querySelectorAll:()=>[],createElement:()=>({getContext:()=>null})};
  const context=vm.createContext({
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    Image:FakeImage,document,location:{origin},URL,IMAGE_PROXY_BASE:'https://images.weserv.nl/?url=',setTimeout,clearTimeout,Date,Math,JSON,Promise,Map,Array,Object,Number,parseFloat
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
