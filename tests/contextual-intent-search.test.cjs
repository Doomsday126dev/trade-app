const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function load(){
  const window={};window.window=window;
  const context=vm.createContext({window});
  for(const file of ['js/i18n/locales/en.js','js/i18n/locales/ja.js','js/i18n/locales/es.js','js/i18n/locales/de.js','js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js','js/utils/textSafety.js','js/ui/stringHtml.js','js/domain/tradeListComparison.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  return window;
}
const json=value=>JSON.parse(JSON.stringify(value));
test('empty and unknown scopes never emit a match-all prefilter',()=>{
  const {contextualSearchPlan:plan}=load().PogoDomain.searchStrings;
  assert.deepEqual(json(plan([]).parts),[]);
  const unknown=plan([{name:'Worlds 2026 unknown',no:null},{name:'Invalid',no:true},{name:'Unsafe',no:'25 OR 150'}]);
  assert.equal(unknown.unresolved,3);assert.equal(unknown.manual.length,3);assert.equal(unknown.parts.length,0);
});
test('species-only searches keep every qualifier for manual review without excluding shiny BG or CP',()=>{
  const input=[{name:'Pikachu costume',no:25,shiny:true,backgroundId:'exact',gender:'f',mod:'unsupported',note:'private'},{name:'Unmapped',no:null},{name:'Pikachu',no:25}];
  const before=JSON.stringify(input),plan=load().PogoDomain.searchStrings.contextualSearchPlan(input);
  assert.deepEqual(json(plan.parts),['!traded&25']);assert.equal(plan.manual.length,3);assert.equal(plan.unresolved,1);
  assert.equal(plan.manual[0].mod,'unsupported');assert.equal(JSON.stringify(input),before);
});
test('all supported query locales use the canonical serializer and unchanged species identity',()=>{
  const domain=load().PogoDomain;
  for(const [locale,traded]of Object.entries({en:'traded',ja:'こうかん',es:'intercambiados',de:'getauscht'})){
    const plan=domain.searchStrings.contextualSearchPlan([{no:150},{no:25}],{locale});
    assert.equal(plan.parts[0],`!${traded}&25,150`);
  }
  assert.equal(domain.searchStrings.contextualSearchPlan([{no:25}],{locale:'fr'}).locale,'en');
});
test('oversized scopes split on species boundaries with every species represented once',()=>{
  const entries=Array.from({length:2000},(_,i)=>({name:`Fixture ${i+1}`,no:i+1}));
  for(const locale of ['en','ja','es','de']){
    const plan=load().PogoDomain.searchStrings.contextualSearchPlan(entries,{locale});
    assert(plan.parts.length>1);assert(plan.parts.every(part=>part.length<=1500));
    assert.deepEqual(json(plan.parts.flatMap(part=>part.split('&').at(-1).split(',').map(Number))),entries.map(e=>e.no));
  }
});
test('receive and give are distinct intersections of declared offers, never inventory or shared wants',()=>{
  const d=load().PogoDomain,entry=(name,no,intent)=>({name,no,intent,type:'wishlist'});
  const result=d.tradeListComparison.compareDeclarations({mine:[entry('Pikachu',25,'lf'),entry('Eevee',133,'ft')],theirs:[entry('Pikachu',25,'ft'),entry('Eevee',133,'lf')],offersAvailable:true});
  assert.equal(d.searchStrings.contextualSearchPlan(result.iOffer).parts[0],'!traded&133');
  assert.equal(d.searchStrings.contextualSearchPlan(result.theyOffer).parts[0],'!traded&25');
});
test('localized panels expose all manual checks, escape content and use identical displayed/copied bytes',()=>{
  const w=load();
  for(const locale of ['en','ja','es','de']){
    const t=(key,params={})=>w.PogoLocales[locale][key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
    const plan=w.PogoDomain.searchStrings.contextualSearchPlan([{name:'<img onerror=bad>',no:25,shiny:true},{name:'Unmapped',no:null}],{locale});
    const html=w.PogoUi.stringHtml.contextualSearchHtml(plan,{t,title:'Scope'});
    assert(html.includes(w.PogoLocales[locale]['contextSearch.species']));
    assert(html.includes('Unmapped'));assert(html.includes('&lt;img onerror=bad&gt;'));assert(!html.includes('<img onerror'));
    assert(html.includes('data-contextual-copy="'+plan.parts[0].replaceAll('&','&amp;')+'"'));
  }
});
test('public search resolves only provided projection entries with no private viewer reads',()=>{
  const source=fs.readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8');
  const block=source.slice(source.indexOf('function searchHtml('),source.indexOf('async function copySearch('));
  assert.match(block,/list\.map/);assert.match(block,/contextualSearchPlan/);
  assert.doesNotMatch(block,/allData|auth|currentUser|fetch\(|get\(|productDeclarations|readProjection/);
});
