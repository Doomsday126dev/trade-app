'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');
const catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/reviewed-form-shiny-assets.json'),window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('47 reviewed exact Shiny forms resolve without generic species or normal fallback',()=>{
 assert.equal(proof.records.length,47);assert.equal(proof.records.filter(r=>r.no===201).length,28);assert.equal(proof.records.filter(r=>r.no===666).length,18);validateCatalog(catalog,process.cwd());
 const assets=new Set();for(const r of proof.records){assets.add(r.asset);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(r.asset)).digest('hex'),r.sha256);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(r.retainedNormal.asset)).digest('hex'),r.retainedNormal.sha256);const row=catalog.entries.find(e=>e.names[0]===r.name);for(const name of row.names)for(const gender of r.no===201?['']:['','m','f']){assert.deepEqual(Array.from(api.resolution({name,gender,shiny:true}).urls),[r.asset]);assert.deepEqual(Array.from(api.resolution({name,gender}).urls),[r.retainedNormal.asset]);}assert.notEqual(r.asset,r.retainedNormal.asset);}
 assert.equal(assets.size,47);
});
test('held Spinda patterns and unreleased Vivillon are not promoted or misclassified',()=>{
 assert.equal(proof.holds.length,10);for(const name of ['Fancy','Poké Ball',...Array.from({length:8},(_,i)=>'Spinda (Form '+(i+1)+')')]){assert.equal(api.resolution({name,shiny:true}).status,'exact');const review=require('../data/reviewed-variant-art-assets.json').records.find(r=>r.name===api.resolve({name}).names[0]);assert.ok(review);assert.equal(review.shiny,name.startsWith('Spinda')?'released':'unverified');assert.equal(api.resolve({name}).formShinyArtworkReview,undefined);}
 assert.equal(proof.holds.filter(r=>r.releasedShiny===true).length,8);assert.equal(proof.holds.filter(r=>r.releasedNormal===false&&r.releasedShiny===false).length,2);
});
test('wrong form, variant, pinned source or copied review is rejected',()=>{
 for(const mutate of [r=>delete r.formShinyArtworkReview,r=>r.formShinyArtworkReview.sourceCommit='0'.repeat(40),r=>r.formShinyArtworkReview.sourceId='0201-00-02',r=>r.assets.shiny=r.assets.default,r=>r.formShinyArtworkReview.gitBlobSha='0'.repeat(40),r=>r.formShinyArtworkReview.pixelReview='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Unown (A)'));assert.throws(()=>validateCatalog(c,process.cwd()),/Form Shiny/);}
});
