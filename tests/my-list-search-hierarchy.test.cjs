const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const sandbox={window:{}};sandbox.window.window=sandbox.window;
vm.runInNewContext(readFileSync(path.join(root,'js/domain/pokemonGoSearchSyntax.js'),'utf8'),sandbox);
vm.runInNewContext(readFileSync(path.join(root,'js/domain/searchStrings.js'),'utf8'),sandbox);
const domain=sandbox.window.PogoDomain.searchStrings;
vm.runInNewContext(readFileSync(path.join(root,'js/utils/textSafety.js'),'utf8'),sandbox);
vm.runInNewContext(readFileSync(path.join(root,'js/ui/stringHtml.js'),'utf8'),sandbox);
const stringHtml=sandbox.window.PogoUi.stringHtml;
const t=(key,values={})=>key+JSON.stringify(values);
const searchMarkup=(parts=['25,133'],manual=[],compact=true)=>stringHtml.contextualSearchHtml({parts,manual,total:parts.length+manual.length},{t,title:'Synthetic search',compact});
// The old priority-search renderer was replaced by shared contextual search HTML.
// Execute that renderer rather than checking dead legacy class names.

function priorityString(start,count,locale='en'){
  return domain.dexStringFromNumbers(Array.from({length:count},(_,index)=>start+index),{locale});
}

test('visible wants sections have scoped contextual copy and collapsed search details',()=>{
  const render=html.slice(html.indexOf('function renderCombinedList('),html.indexOf('function toggleWantsSection('));
  assert.match(render,/updateWantsSearch\(search,entries,label\)/);assert.match(render,/wants-section-search/);
  const markup=searchMarkup();assert.match(markup,/data-contextual-copy="25,133"/);assert.match(markup,/<details class="contextual-details wants-search-details" hidden>/);
  assert.match(markup,/aria-label="Synthetic search"/);
});

test('copy contains the exact escaped value and raw syntax is read-only inside disclosure',()=>{
  const markup=searchMarkup(['25&shiny']);assert.match(markup,/data-contextual-copy="25&amp;shiny"/);
  assert.match(markup,/<textarea class="strbox" readonly rows="1"[^>]*>25&amp;shiny<\/textarea>/);
  const copy=readFileSync(path.join(root,'js/ui/stringHtml.js'),'utf8');assert.match(copy,/navigator\.clipboard\.writeText\(value\)/);
  assert.match(copy,/value\.length>POGO_STR_LIMIT/);assert.match(copy,/details\.hidden=false;details\.open=true/);
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

test('special wants use the same scoped copy renderer without assuming exact game individuals',()=>{
  const plan=domain.myListSearchPlan({H:'h',LUCKY:'lucky',SHINY:'shiny',XXL:'xxl',XXS:'xxs'},{locale:'en'});
  assert.equal(JSON.stringify(plan.specials.map(option=>option.key)),JSON.stringify(['LUCKY','SHINY','XXL','XXS']));
  const combined=html.slice(html.indexOf('function refreshCombinedSearch('),html.indexOf('function closeWantsListTools('));
  assert.match(combined,/\['H','M','L','LUCKY','SHINY','XXL','XXS'\]/);assert.match(combined,/updateWantsSearch\(result,entries/);
});

test('search-language locale is supplied to every generated combined search',()=>{
  const en=domain.myListSearchPlan({H:priorityString(1,2,'en'),M:priorityString(3,2,'en')},{locale:'en'}).all.value;
  const ja=domain.myListSearchPlan({H:priorityString(1,2,'ja'),M:priorityString(3,2,'ja')},{locale:'ja'}).all.value;
  assert.notEqual(en,ja);
  assert.match(html,/contextualSearchPlan\(entries\.filter\(e=>e\.intent!=='ft'\),\{locale:pokemonGoSearchLocale\(\)\}\)/);
  assert.match(html,/JSON\.stringify\(\[i18nCore\.getLocale\(\),pokemonGoSearchLocale\(\),entries\]\)/);
});

test('advanced combined scopes are explicit pressed controls and remain collapsed initially',()=>{
  assert.match(html,/<details id="wants-combine" ontoggle="refreshCombinedSearch\(\)">/);
  assert.match(html,/class="wants-custom-toggles" role="group"/);assert.match(html,/data-wants-scope="\$\{key\}" aria-pressed=/);
  assert.match(html,/if\(!document\.getElementById\('wants-combine'\)\?\.open\)\{advanced\.replaceChildren\(\);return;\}/);
  assert.match(html,/else result\.innerHTML=.*workflow\.chooseScopes/);
});

test('split and omitted searches explain exceptions without exposing raw syntax by default',()=>{
  const split=searchMarkup(['25','133']);assert.match(split,/<details class="contextual-details wants-search-details">/);assert.doesNotMatch(split,/<details[^>]* open/);
  assert.match(split,/workflow\.splitSearch/);assert.equal((split.match(/data-contextual-copy=/g)||[]).length,2);
  const omitted=searchMarkup([], [{unresolved:true,name:'Synthetic Unknown'}]);assert.match(omitted,/workflow\.notIncluded/);assert.match(omitted,/Synthetic Unknown/);assert.doesNotMatch(omitted,/data-contextual-copy=/);
});
