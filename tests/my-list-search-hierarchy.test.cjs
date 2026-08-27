const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const sandbox={window:{}};sandbox.window.window=sandbox.window;
vm.runInNewContext(readFileSync(path.join(root,'js/domain/pokemonGoSearchSyntax.js'),'utf8'),sandbox);
vm.runInNewContext(readFileSync(path.join(root,'js/domain/searchStrings.js'),'utf8'),sandbox);
const domain=sandbox.window.PogoDomain.searchStrings;

function priorityString(start,count,locale='en'){
  return domain.dexStringFromNumbers(Array.from({length:count},(_,index)=>start+index),{locale});
}

test('My List renders priority Pokémon immediately with scoped collapsed search actions',()=>{
  assert.match(html,/function myListPrioritySectionHtml\(priority,entries,renderedEntries=entries\)/);
  assert.match(html,/data-priority-search="\$\{priority\}"/);
  assert.match(html,/myListSearchActionHtml\(strs\[priority\]/);
  assert.match(html,/class="strbox mylist-search-raw"[^>]+hidden/);
  assert.match(html,/aria-expanded="false"/);
});

test('view disclosure changes only raw visibility and copy uses the exact generated value',()=>{
  const toggle=html.slice(html.indexOf('function toggleMyListSearchString('),html.indexOf('function toggleMyListMoreCombinations('));
  assert.match(toggle,/raw\.hidden=!open/);
  assert.doesNotMatch(toggle,/myListType\s*=|writeList|renderMyList/);
  assert.match(html,/data-copy="\$\{escAttr\(value\)\}"/);
  assert.match(html,/copyStr\(this\.dataset\.copy,this\)/);
});

test('combined plan prioritizes All, then High plus Medium, with niche combinations separate',()=>{
  const strs={H:priorityString(1,5),M:priorityString(20,4),L:priorityString(40,3)};
  const plan=domain.myListSearchPlan(strs,{locale:'en'});
  assert.deepEqual([...plan.all.levels],['H','M','L']);
  assert.deepEqual([...plan.secondary.levels],['H','M']);
  assert.equal(JSON.stringify(plan.more.map(option=>[...option.levels])),JSON.stringify([['H','L'],['M','L']]));
});

test('empty priorities and duplicate effective searches are omitted',()=>{
  const h=priorityString(1,5),m=priorityString(1,5);
  const plan=domain.myListSearchPlan({H:h,M:m},{locale:'en'});
  assert.ok(plan.all);
  assert.equal(plan.secondary,null);
  assert.equal(plan.more.length,0);
  assert.deepEqual([...plan.populated],['H','M']);
});

test('a fitting All-priorities search remains copyable at the exact limit',()=>{
  const strs={H:priorityString(1,2),M:priorityString(3,2),L:priorityString(5,2)};
  const limit=domain.combineStrings(strs,['H','M','L'],{locale:'en'}).length;
  const plan=domain.myListSearchPlan(strs,{locale:'en',limit});
  assert.equal(plan.all.tooLong,false);
  assert.equal(plan.split.length,0);
});

test('an oversized All-priorities search suggests the smallest valid complete split',()=>{
  const strs={H:priorityString(1,170),M:priorityString(300,170),L:priorityString(600,170)};
  const all=domain.combineStrings(strs,['H','M','L'],{locale:'en'});
  const pair=domain.combineStrings(strs,['H','M'],{locale:'en'});
  const limit=Math.max(pair.length,strs.L.length);
  assert.ok(all.length>limit);
  const plan=domain.myListSearchPlan(strs,{locale:'en',limit});
  assert.equal(plan.all.tooLong,true);
  assert.equal(plan.split.length,2);
  assert.ok(plan.split.every(part=>part.length<=limit));
  assert.deepEqual([...new Set(plan.split.flatMap(part=>part.levels))].sort(),['H','L','M']);
});

test('Dex searches remain distinct and render beside their matching sections',()=>{
  const plan=domain.myListSearchPlan({H:'h',LUCKY:'lucky',SHINY:'shiny',XXL:'xxl',XXS:'xxs'},{locale:'en'});
  assert.equal(JSON.stringify(plan.specials.map(option=>option.key)),JSON.stringify(['LUCKY','SHINY','XXL','XXS']));
  assert.match(html,/data-dex-search="\$\{group\.key\}"/);
  assert.match(html,/const dexLabels=\{LUCKY:'strings\.luckyDexSearch',SHINY:'strings\.shinyDexSearch',XXL:'strings\.xxlDexSearch',XXS:'strings\.xxsDexSearch'\}/);
});

test('search-language locale is supplied to every generated combined search',()=>{
  const en=domain.myListSearchPlan({H:priorityString(1,2,'en'),M:priorityString(3,2,'en')},{locale:'en'}).all.value;
  const ja=domain.myListSearchPlan({H:priorityString(1,2,'ja'),M:priorityString(3,2,'ja')},{locale:'ja'}).all.value;
  assert.notEqual(en,ja);
  assert.match(html,/myListSearchPlan\(strs,\{locale:pokemonGoSearchLocale\(\)\}\)/);
});

test('advanced searches use grouped summary rows with predictable Copy and View placement',()=>{
  assert.match(html,/class="mylist-search-groups"/);
  assert.match(html,/class="mylist-search-section" aria-labelledby="combined-search-title"/);
  assert.match(html,/class="mylist-search-option-summary"/);
  assert.match(html,/class="mylist-search-actions"/);
  assert.match(html,/class="cpbtn mylist-search-action"/);
  assert.match(html,/class="mylist-search-view mylist-search-action"/);
  assert.match(html,/uiIconMarkup\('chevron-down'/);
  assert.match(html,/\.mylist-search-option-head\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(html,/\.mylist-search-groups\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('advanced search presentation never exposes raw syntax before explicit disclosure',()=>{
  assert.match(html,/class="strbox mylist-search-raw"[^>]+hidden/);
  assert.match(html,/\.mylist-search-raw\{[^}]*grid-column:1\/-1/);
  assert.match(html,/\.cpbtn\.mylist-search-action\{[^}]*background:var\(--surface-raised\)[^}]*box-shadow:none/);
  assert.doesNotMatch(html,/class="strbox mylist-search-raw"(?![^>]*hidden)/);
});
