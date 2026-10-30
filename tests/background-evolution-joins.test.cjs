'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const review=require('../data/background-evolution-joins.json'),catalog=require('../data/background-runtime-catalog.json'),holds=require('../data/background-review-holds.json');
const key=(bg,id,shiny)=>JSON.stringify([bg,id,shiny]);
const keys=new Set(catalog.records.map(r=>key(r.id,r.catalogId,r.shiny)));
test('all 28 demonstrated exact evolution lanes are present without changing generic identity semantics',()=>{
 let count=0;
 for(const color of ['blue','yellow','orange','white'])for(const [dex,name]of [[670,'Floette'],[671,'Florges']])for(const shiny of [false,true]){
  const id=`pokemon:${dex}:standard:legacy:${encodeURIComponent(name+' ('+color[0].toUpperCase()+color.slice(1)+' Flower)')}`;
  assert.ok(keys.has(key('sb-season-20-tales-of-transformation',id,shiny)));count++;
 }
 for(const shiny of [false,true]){assert.ok(keys.has(key('sb-community-days-2026','pokemon:916:standard:legacy:Oinkologne',shiny)));assert.ok(keys.has(key('sb-community-days-2026','pokemon:916:standard:background:female',shiny)));count++;}
 for(const bg of ['lc-esa-cite-de-espace','lc-esa-ciudaddelasartes','esa-euro-space-center','lc-esa-spaceexpo-nl','lc-esa-space-center-germany'])for(const [dex,name]of [[825,'Dottler'],[826,'Orbeetle']]){assert.ok(keys.has(key(bg,`pokemon:${dex}:standard:legacy:${name}`,false)));count++;}
 assert.equal(count,28);
});
test('each admitted evolution has an immutable-input exact same-lane progenitor, event and packaged art',()=>{
 const input=new Set(review.input_qualified_keys.map(k=>key(k[0],k[1],k[2])));
 assert.equal(review.input_requests,2440);assert.equal(catalog.records.length,2440+review.admitted.length+require('../data/background-cohort-qualifications.json').length+require('../data/background-terminal-qualifications.json').length+require('../data/background-zorua-qualifications.json').length+require('../data/background-gible-qualifications.json').length+require('../data/background-deino-machop-qualifications.json').length);
 for(const row of review.admitted){
  const [bg,id,shiny]=row.qualified_same_background_progenitor;assert.equal(bg,row.background_id);assert.equal(shiny,row.shiny);assert.ok(input.has(key(bg,id,shiny)));
  assert.equal(row.acquisition,'evolution_only');assert.equal(row.captured_event_dates[0].background_id,bg);assert.equal(row.captured_event_dates[0].derivation_claim,'evolution');assert.equal(row.captured_event_dates[0].date_state_internal,'past_or_current_claim');
  assert.ok(review.explicit_parent_map[row.reviewed_evolution_chain[1]].includes(row.reviewed_evolution_chain[0]));
  const records=catalog.records.filter(r=>r.id===bg&&r.catalogId===row.catalog_id&&r.shiny===shiny);assert.equal(records.length,1);assert.equal(records[0].sha256,row.art_sha256);
 }
});
test('disputed museum shiny and non-evolution form changes remain held under the approved subset',()=>{
 assert.equal(catalog.coverageComplete,false);
 for(const [bg,id,shiny]of holds.withdrawnShiny)assert.equal(keys.has(key(bg,id,shiny)),false);
 for(const slug of ['necrozma-dawn-wings','necrozma-dusk-mane','kyurem-black','kyurem-white','zacian-crowned-sword','zamazenta-crowned-shield','ivysaur-jan-2020'])assert.equal(review.admitted.some(r=>r.reviewed_evolution_chain[1]===slug),false);
 for(const h of holds.holds.filter(r=>r.sourceVariant==='blipbug'&&r.backgroundId.includes('esa')))assert.notEqual(h.shiny,'qualified_local');
 assert.equal(catalog.releaseScope,'verified-subset');assert.ok(require('node:fs').readFileSync(require('node:path').join(__dirname,'../js/app/application.js'),'utf8').includes('const BACKGROUND_ROLLOUT={enabled:true};'));
});
const {validate}=require('../scripts/backgrounds/review-evolution-joins.cjs');
const facts=new Map(review.input_pair_facts.map(p=>[p.background_id+'|'+p.source_variant_id,p]));
const proofFor=row=>row.reviewed_evolution_chain.map(s=>facts.get(row.background_id+'|'+s));
test('bounded review validates every admitted exact event, trait family and unchanged shiny lane',()=>{
 assert.equal(review.bounded_correctness_review.over_admissions_found,0);
 for(const row of review.admitted)assert.equal(validate(row,...proofFor(row),review.explicit_parent_map),true);
 const costume=review.admitted.filter(r=>proofFor(r)[0].costume);assert.equal(costume.length,12);
 for(const row of costume){assert.ok(row.evolution_obtainability_sources.length);assert.doesNotMatch(row.evolution_obtainability_basis,/Explorer-hat family evolution is independently documented/);}
});
test('ordinary species graph cannot admit a non-evolving costume, change forms or acquire a new shiny lane',()=>{
 const original=review.admitted.find(r=>r.reviewed_evolution_chain[0]==='pikachu'),[parent,child]=proofFor(original);
 const check=(row,p,c,map=review.explicit_parent_map)=>validate(row,p,c,map);
 assert.throws(()=>check(original,{...parent,costume:true},{...child,costume:true}),/unreviewed-costume/);
 assert.throws(()=>check(original,{...parent,costume:true},child),/costume-drift/);
 assert.throws(()=>check(original,{...parent,source_event_ids:[]},child),/event-proof/);
 const lane=original.shiny?'shiny':'normal';assert.throws(()=>check(original,{...parent,[lane]:{status:'secondary_exact_pair_claim_only'}},child),/unqualified-progenitor-lane/);
 assert.throws(()=>check({...original,shiny:!original.shiny},parent,child),/identity-or-shiny-drift|unqualified-progenitor-lane/);
 const fake={...original,reviewed_evolution_chain:['pikachu','raichu-alola']};assert.throws(()=>check(fake,parent,{...child,source_variant_id:'raichu-alola'},{'raichu-alola':['pikachu']}),/form-drift/);
 assert.throws(()=>check({...original,intrinsic_form_constraints:{sex:'female'}},parent,child),/unexpected-inherited-constraint/);
});
test('primary event rewards qualify the three GO Pass legends and Pikipek family in each exact lane',()=>{
 for(const [bg,dex,name] of [['sb-season-19-delightful-days',146,'Moltres'],['sb-season-20-tales-of-transformation',639,'Terrakion'],['sb-season-20-tales-of-transformation',640,'Virizion'],['sb-season-20-tales-of-transformation',731,'Pikipek'],['sb-season-20-tales-of-transformation',732,'Trumbeak'],['sb-season-20-tales-of-transformation',733,'Toucannon']])for(const shiny of [false,true])assert.ok(keys.has(key(bg,`pokemon:${dex}:standard:legacy:${name}`,shiny)));
});

test("official Mega Finale and Tampa additions preserve normal-only scope",()=>{const a=require("../data/background-terminal-qualifications.json");assert.equal(a.length,39);for(const r of a){assert.equal(r.shiny,false);assert.ok(keys.has(key(r.background_id,r.catalog_id,false)));}for(const bg of ["lc-mlb-tampabayrays2"])for(const n of ["Pikachu","Raichu"])assert.equal(keys.has(key(bg,`pokemon:${n==="Pikachu"?25:26}:standard:legacy:${n}`,true)),false);});

test("Tour Pass Zorua and its evolution retain exact Enigma background and shiny state",()=>{for(const [dex,name] of [[570,"Zorua"],[571,"Zoroark"]])for(const shiny of [false,true])assert.ok(keys.has(key("sb-go-tour-2025-enigma",`pokemon:${dex}:standard:legacy:${name}`,shiny)));});

test("Gible community day evolutions preserve exact same background and shiny progenitor",()=>{for(const [dex,name]of [[444,"Gabite"],[445,"Garchomp"]])for(const shiny of [false,true])assert.ok(keys.has(key("sb-community-days-2026",`pokemon:${dex}:standard:legacy:${name}`,shiny)));});

test("Deino and Machop event evolutions retain exact qualified state and background",()=>{for(const [bg,dex,name]of [["sb-community-days-2026",634,"Zweilous"],["sb-community-days-2026",635,"Hydreigon"],["sb-season-18-might-and-mastery",67,"Machoke"],["sb-season-18-might-and-mastery",68,"Machamp"]])for(const shiny of [false,true])assert.ok(keys.has(key(bg,`pokemon:${dex}:standard:legacy:${name}`,shiny)));});
