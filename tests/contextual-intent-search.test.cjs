const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function load(){
  const window={};window.window=window;
  const context=vm.createContext({window});
  for(const file of ['js/i18n/locales/en.js','js/i18n/locales/ja.js','js/i18n/locales/es.js','js/i18n/locales/de.js','js/i18n/pokemonNames/catalog.js','js/i18n/pokemonNames/core.js','js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js','js/utils/textSafety.js','js/ui/stringHtml.js','js/domain/tradeListComparison.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  return window;
}
const json=value=>JSON.parse(JSON.stringify(value));
test('known species and exact variants never render a manual-check interface',()=>{
  const w=load(),t=(key,params={})=>w.PogoLocales.en[key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
  for(const entry of [{name:'Pikachu',no:25},{name:'Eevee',no:133,gender:'f'},
    {name:'Sinistea',no:854,mod:'Antique'},{name:'Pikachu (Worlds 2025)',no:25,lucky:true,shiny:true,note:'Exact requirement'}]){
    const html=w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan([entry]),{t,title:'Scope',compact:true});
    assert.match(html,/data-contextual-copy=/);assert.match(html,/<details[^>]* hidden>/);
    assert.doesNotMatch(html,/manual-check|contextual-manual|not included|Exact requirement/);
  }
});
test('split and unresolved guidance localize without known-variant checklists',()=>{
  const w=load();
  for(const locale of ['en','ja','es','de']){
    const t=(key,params={})=>w.PogoLocales[locale][key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
    const render=entries=>w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan(entries,{limit:32,locale}),{t,title:'Scope',compact:true});
    assert.ok(render(Array.from({length:30},(_,i)=>({no:i+1}))).includes(t('workflow.splitSearch')));
    const partial=render([{no:25,name:'Pikachu',lucky:true},{name:'Unmapped',no:null}]);
    assert.ok(partial.includes(t('workflow.notIncluded',{count:1})));assert.ok(partial.includes('Unmapped'));
    assert.ok(partial.includes(t('workflow.omittedHelp')));assert.doesNotMatch(partial,/contextual-manual/);
  }
});
test('lightweight public shell accepts every catalog species and variant without checklists',()=>{
  const w=load();
  for(const file of ['publicPokemonDex','spriteSlugs'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain',file+'.js'),'utf8'),{window:w});
  delete w.PogoI18n.pokemonNames;
  const rows=JSON.parse(fs.readFileSync(path.join(root,'js/domain/publicPokemonDex.js'),'utf8').match(/const rows=(.*);/)[1]);
  const t=(key,params={})=>w.PogoLocales.en[key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
  for(const [name,no]of rows){
    const html=w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan([{name,no}]),{t,title:name,compact:true});
    assert.match(html,/<details[^>]* hidden>/,name);assert.doesNotMatch(html,/contextual-manual|data-manual-check/,name);
  }
});
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
test('localized panels expose unresolved omissions, escape content and use identical displayed/copied bytes',()=>{
  const w=load();
  for(const locale of ['en','ja','es','de']){
    const t=(key,params={})=>w.PogoLocales[locale][key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
    const plan=w.PogoDomain.searchStrings.contextualSearchPlan([{name:'Pikachu',no:25},{name:'<img onerror=bad>',no:null},{name:'Unmapped',no:null}],{locale});
    const html=w.PogoUi.stringHtml.contextualSearchHtml(plan,{t,title:'Scope'});
    assert(html.includes(w.PogoLocales[locale]['contextSearch.species']));
    assert(html.includes('Unmapped'));assert(html.includes('&lt;img onerror=bad&gt;'));assert(!html.includes('<img onerror'));
    assert(html.includes('data-contextual-copy="'+plan.parts[0].replaceAll('&','&amp;')+'"'));
  }
});
test('public search resolves only provided projection entries with no private viewer reads',()=>{
  const source=fs.readFileSync(path.join(root,'js/app/publicShareApp.js'),'utf8');
  const block=source.slice(source.indexOf('function renderList('),source.indexOf('async function copySearch('));
  assert.match(block,/intentEntries\(snapshot,'lf',state\.type\)\.map/);
  assert.match(block,/wantSections\(list\)/);assert.match(block,/contextualSearchPlan\(entries/);
  assert.match(block,/searchHtml\(entries,label\)/);assert.match(block,/compact:true/);
  assert.doesNotMatch(block,/allData|auth|currentUser|fetch\(|get\(|productDeclarations|readProjection/);
});
