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
test('compact panels hide normal details but count each exact or unresolved declaration once',()=>{
  const w=load(),t=(key,params={})=>w.PogoLocales.en[key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
  const html=entries=>w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan(entries),{t,title:'Scope',compact:true});
  for(const entry of [{name:'Pikachu',no:25,p:'H'},{name:'Dragonite',no:149},{name:'Pikachu',no:25,backgroundId:'retired',backgroundLabel:'Retired background'},{name:'NidoranF',no:29},{no:25}]){
    const rendered=html([entry]);assert.match(rendered,/data-manual-check-count="0" hidden/);
    assert.match(rendered,/data-contextual-copy=/);assert.doesNotMatch(rendered,/contextual-manual-review/);
  }
  const exceptions=[{name:'Unknown',no:null},{name:'Pikachu',no:25,shiny:true,lucky:true},
    {name:'Eevee',no:133,gender:'f'},{name:'Snorlax',no:143,xxl:true},{name:'Joltik',no:595,xxs:true},
    {name:'Sinistea',no:854,mod:'Antique'},{name:'Unown (!)',no:201},
    {name:'Charmander',no:4,category:'dynamax'},{name:'Charizard',no:6,maxType:'gmax'},
    {name:'Pikachu (Worlds 2025)',no:25},{name:'Pikachu',no:25,note:'Check eligibility'},
    {name:'A-Raichu',no:26},{name:'Fancy',no:666},{name:'Pikachu',no:133}];
  for(const entry of exceptions)assert.match(html([entry]),/data-manual-check-count="1"><summary>1 manual check/);
  const combined=html([{name:'Pikachu',no:25},...exceptions]);
  assert.match(combined,new RegExp(`data-manual-check-count="${exceptions.length}"><summary>${exceptions.length} manual checks`));
  assert.doesNotMatch(combined,/<li>/,'compact exception rows are hydrated only when opened');
});
test('clean split searches retain split guidance and compact exception labels localize',()=>{
  const w=load();
  for(const locale of ['en','ja','es','de']){
    const t=(key,params={})=>w.PogoLocales[locale][key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
    const plan=w.PogoDomain.searchStrings.contextualSearchPlan(Array.from({length:30},(_,index)=>({no:index+1})),{limit:32,locale});
    const rendered=w.PogoUi.stringHtml.contextualSearchHtml(plan,{t,title:'Scope',compact:true});
    assert.match(rendered,/data-manual-check-count="0"><summary>/);assert.ok(rendered.includes(t('workflow.splitSearch')));
    const special=w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan([{name:'Pikachu',no:25,lucky:true}]),{t,title:'Lucky',compact:true});
    assert.ok(special.includes(t('workflow.manualCheck',{count:1})));
  }
});
test('lightweight public shell distinguishes every admitted ordinary species from exact variants without loading private data',()=>{
  const w=load(),names=w.PogoI18n.pokemonNames;
  for(const file of ['publicPokemonDex','spriteSlugs'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain',file+'.js'),'utf8'),{window:w});
  delete w.PogoI18n.pokemonNames;
  const rows=JSON.parse(fs.readFileSync(path.join(root,'js/domain/publicPokemonDex.js'),'utf8').match(/const rows=(.*);/)[1]);
  const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[.'’]/g,'').replaceAll('_',' ').replace(/\s+/g,' ').trim();
  const t=(key,params={})=>w.PogoLocales.en[key].replace(/\{(\w+)\}/g,(_,k)=>params[k]);
  for(const [name,no]of rows){
    const ordinary=normalize(name)===normalize(names.speciesName({no},'en'))||no===29&&/^Nidoran[- ]?F$/i.test(name)||no===32&&/^Nidoran[- ]?M$/i.test(name);
    const html=w.PogoUi.stringHtml.contextualSearchHtml(w.PogoDomain.searchStrings.contextualSearchPlan([{name,no}]),{t,title:name,compact:true});
    assert.match(html,new RegExp(`data-manual-check-count="${ordinary?0:1}"${ordinary?' hidden':''}`),name);
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
  const block=source.slice(source.indexOf('function renderList('),source.indexOf('async function copySearch('));
  assert.match(block,/intentEntries\(snapshot,'lf',state\.type\)\.map/);
  assert.match(block,/wantSections\(list\)/);assert.match(block,/contextualSearchPlan\(entries/);
  assert.match(block,/searchHtml\(entries,label\)/);assert.match(block,/compact:true/);
  assert.doesNotMatch(block,/allData|auth|currentUser|fetch\(|get\(|productDeclarations|readProjection/);
});
