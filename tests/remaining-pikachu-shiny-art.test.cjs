'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');
const catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/reviewed-pikachu-shiny-assets.json');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('76 reviewed names retain exact released Shiny models for every supported gender',()=>{
 assert.equal(proof.records.length,76);validateCatalog(catalog,process.cwd());
 for(const r of proof.records)for(const g of r.sourceGenders){const key=g==='f'?'femaleShiny':'shiny';const result=api.resolution({name:r.name,gender:g,shiny:true});assert.equal(result.status,'exact',r.name);assert.deepEqual(Array.from(result.urls),[r.assets[key]],r.name);}
});
test('single-gender forms never cross to impossible gender or normal art',()=>{
 for(const [name,g]of [['Kurta','m'],['Mimikyu','m'],['Saree','f']])for(const shiny of [false,true]){const n='Pikachu ('+name+')';assert.deepEqual(Array.from(api.resolve({name:n}).availableGenders),[g]);assert.deepEqual(Array.from(api.resolution({name:n,shiny}).urls),Array.from(api.resolution({name:n,gender:g,shiny}).urls));assert.equal(api.resolution({name:n,gender:g==='m'?'f':'m',shiny}).reason,'invalid-gender');}
});
test('unknown Detective year and unreleased Shiny variants cannot borrow 2023 artwork',()=>{
 for(const [name,reason]of [['Detective','needs-identification'],['Clone','unreleased'],['Ph_D','unreleased']]){const result=api.resolution({name:'Pikachu ('+name+')',shiny:true});assert.equal(result.reason,reason);assert.deepEqual(Array.from(result.urls),[]);}
 for(const g of ['m','f'])for(const shiny of [false,true])assert.equal(api.resolution({name:'Pikachu (Detective 2023)',gender:g,shiny}).status,'exact');
});
test('pinned proof rejects changed costume, variant, commit, source bytes and copied proof',()=>{
 for(const mutate of [r=>r.pinnedArtworkReview.sourceCommit='0'.repeat(40),r=>r.pinnedArtworkReview.sourceFiles.shiny='0025-00-00-026+S.png',r=>r.assets.shiny=r.assets.default,r=>r.pinnedArtworkReview.gitBlobShas.shiny='0'.repeat(40),r=>r.pinnedArtworkReview.notes='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Pikachu (5th Anniversary)'));assert.throws(()=>validateCatalog(c,process.cwd()),/Pinned/);}
});

test('full-source models cannot lose their review or misstate provenance',()=>{for(const mutate of [r=>delete r.pinnedArtworkReview,r=>r.sourceCommit='0'.repeat(40),r=>r.sourceFiles.default='wrong.png']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Pikachu (Detective 2023)'));assert.throws(()=>validateCatalog(c,process.cwd()),/Pinned/);}});
