const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const window={};window.window=window;
for(const file of ['priorityValues','tradeListComparison','pokemonGoSearchSyntax','searchStrings'])vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain',file+'.js'),'utf8'),{window});
const {priorityValues:priority,tradeListComparison:declarations,searchStrings:search}=window.PogoDomain;
const plain=value=>JSON.parse(JSON.stringify(value));

test('stored H/M/L and each priority-free special want have distinct presentation without coercion',()=>{
  const entries=['H','M','L','[lucky]','[shiny]','[xxl]','[xxs]','[lucky][xxl]','', '(F)','(Antique)'].map((value,index)=>({name:'Want '+index,value,...priority.parsePri(value)}));
  const original=JSON.stringify(entries),sections=priority.wantSections(entries);
  assert.deepEqual(plain(sections.map(section=>section.key)),['H','M','L','LUCKY','LUCKY+XXL','SHINY','XXL','XXS','NEEDS_PRIORITY']);
  assert.equal(sections.find(section=>section.key==='NEEDS_PRIORITY').entries.length,3);
  assert.equal(sections.flatMap(section=>section.entries).length,entries.length);
  assert.equal(JSON.stringify(entries),original);
  assert.equal(sections.some(section=>/other|^U$/i.test(section.key)),false);
  assert.equal(priority.priValue('','',true),'[lucky]');
});

test('priority plus special qualifiers keeps both meanings, while special combinations stay intact',()=>{
  const special={name:'Pikachu',p:'',lucky:true,xxl:true,gender:'f'},normal={name:'Pikachu',p:'H',shiny:true};
  const sections=priority.wantSections([special,normal]);
  assert.equal(sections[0].key,'H');assert.equal(sections[0].entries[0].shiny,true);
  assert.equal(sections[1].key,'LUCKY+XXL');assert.equal(sections[1].entries[0].gender,'f');
  assert.equal(priority.wantSectionLabel(sections[1],key=>({'myList.lucky':'Lucky'}[key]||key)),'Lucky · XXL');
});

test('same species priority changes affect only the chosen declaration, preserving special references and aliases',()=>{
  const original=[{name:'Pikachu',intent:'lf',p:'H',type:'wishlist',ref:{surface:'my-list',type:'wishlist'}},
    {name:'Pikachu',intent:'lf',p:'',lucky:true,type:'wishlist',ref:{surface:'special-board',index:0}},
    {name:'Pikachu',intent:'lf',p:'H',type:'wishlist',ref:{surface:'my-list',managed:true}}];
  const unified=declarations.unifyDeclarations(original);
  assert.equal(unified.entries.length,2);assert.equal(unified.entries[0].aliases.length,1);
  const specialBefore=JSON.stringify(unified.entries[1]);
  const moved=unified.entries.map(entry=>entry.p==='H'?{...entry,p:'M'}:entry);
  assert.deepEqual(plain(priority.wantSections(moved).map(section=>section.key)),['M','LUCKY']);
  assert.equal(JSON.stringify(moved[1]),specialBefore);assert.equal(moved.length,2);
  assert.notEqual(declarations.wantedIntentKey(moved[0]),declarations.wantedIntentKey(moved[1]));
});

test('all section combinations retain exact manual checks and unknown variants in every query locale',()=>{
  const entries=[{name:'Pikachu',no:25,p:'H',shiny:true},{name:'Pikachu',no:25,p:'',lucky:true},
    {name:'Eevee',no:133,p:'M',gender:'f'},{name:'Exact unknown',no:null,p:'',xxs:true,mod:'Antique'}];
  for(const locale of ['en','ja','es','de']){
    const plan=search.contextualSearchPlan(entries,{locale});
    assert.equal(plan.total,4);assert.equal(plan.manual.length,4);assert.equal(plan.unresolved,1);
    assert.equal(plan.speciesOnly,true);assert.equal(plan.manual[3].mod,'Antique');
    const expected=search.contextualSearchPlan([{no:25},{no:133}],{locale});
    assert.deepEqual(plain(plan.parts),plain(expected.parts));
  }
});

test('a 1,000-want section splits safely and preserves every manual declaration',()=>{
  const entries=Array.from({length:1000},(_,index)=>({name:'Synthetic '+index,no:index+1,p:'H'}));
  const plan=search.contextualSearchPlan(entries,{locale:'ja'});
  assert.equal(plan.total,1000);assert.equal(plan.manual.length,1000);assert.ok(plan.parts.length>1);
  assert.ok(plan.parts.every(part=>part.length<=1500));
  assert.equal(priority.wantSections(entries)[0].entries.length,1000);
});
