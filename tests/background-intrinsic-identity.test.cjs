'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const adapter=require('../js/domain/backgroundPersistence.js'),{compile}=require('../scripts/backgrounds/build-reviewed-runtime.cjs');
test('intrinsic forms have explicit persisted IDs, never generic-ID or gender-preference rewrites',()=>{
 for(const [base,constraint,form,name]of [['Floette',{flower_color:'red'},'red-flower','Floette (Red Flower)'],['Florges',{flower_color:'red'},'red-flower','Florges (Red Flower)'],['Oinkologne',{sex:'female'},'female','Oinkologne (Female Form)']]){
  const dex={Floette:670,Florges:671,Oinkologne:916}[base],id=`pokemon:${dex}:standard:legacy:${base}`,exact=adapter.intrinsicCatalogId(id,constraint);
  assert.equal(exact,`pokemon:${dex}:standard:background:${form}`);assert.equal(adapter.intrinsicCatalogId(id,{}),id);assert.equal(adapter.intrinsicBinding(id),null);assert.equal(adapter.intrinsicBinding(exact).baseCatalogId,id);assert.equal(adapter.intrinsicBindingForName(base),null);assert.equal(adapter.intrinsicBindingForName(name).catalogId,exact);
 }
 assert.throws(()=>adapter.intrinsicCatalogId('pokemon:670:standard:legacy:Floette',[]),/unsupported-intrinsic/);
 assert.throws(()=>adapter.intrinsicCatalogId('pokemon:916:standard:legacy:Oinkologne',{sex:'male'}),/unsupported-intrinsic/);assert.throws(()=>adapter.intrinsicCatalogId('pokemon:670:standard:legacy:Floette',{flower_color:'red',sex:'female'}),/unsupported-intrinsic/);
});
test('compiler preserves admission gate; explicit constraints change only the newly qualified exact identity',()=>{
 const fs=require('fs'),path=require('path'),runtime=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/background-runtime-catalog.json'))),first=runtime.records[0];
 const row={background_id:first.id,catalog_id:first.catalogId,shiny:false,eligibility_basis:'synthetic contract fixture, not an eligibility approval',art_path:path.join(__dirname,'../',first.url),art_sha256:first.sha256};
 const review={backgrounds:[{canonical_id:first.id,title:first.label}],qualified_requests:[row],source_pair_dispositions:[{normal:{status:'qualified_local'},shiny:{status:'qualified_local'}}],raw_event_observations:[],index_link_dispositions:[],source_only18_dispositions:[],new_evidence_withheld_requests:[]};
 const synthetic=structuredClone(review);synthetic.qualified_requests=[{...row,catalog_id:'pokemon:916:standard:legacy:Oinkologne',intrinsic_form_constraints:{sex:'female'}}];
 const result=compile(synthetic);assert.equal(result.catalog.coverageComplete,false);assert.equal(result.catalog.records[0].catalogId,'pokemon:916:standard:background:female');assert.equal(Object.hasOwn(result.catalog.records[0],'gender'),false);assert.equal(review.qualified_requests.some(r=>r.intrinsic_form_constraints),false);
});
