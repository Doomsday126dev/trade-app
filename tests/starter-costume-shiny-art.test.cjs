'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs'),catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/starter-costume-shiny-assets.json');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('ten released starter costumes resolve exact original Shiny models for either gender and aliases',()=>{
 assert.equal(proof.records.length,10);validateCatalog(catalog,process.cwd());const files=new Set();
 for(const r of proof.records){const row=catalog.entries.find(e=>e.names[0]===r.name);files.add(r.asset);assert.equal(fs.statSync(r.asset).size,r.sourceBytes);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(r.asset)).digest('hex'),r.sha256);
  for(const name of row.names)for(const gender of ['','m','f']){assert.deepEqual(Array.from(api.resolution({name,gender,shiny:true}).urls),[r.asset]);assert.deepEqual(Array.from(api.resolution({name,gender,shiny:false}).urls),[r.retainedNormal.asset]);}
 }
 assert.equal(files.size,10);
});
test('normal artwork remains byte-identical and Shiny never substitutes normal or another costume',()=>{
 for(const r of proof.records){assert.notEqual(r.sha256,r.retainedNormal.sha256);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(r.retainedNormal.asset)).digest('hex'),r.retainedNormal.sha256);assert.notEqual(api.resolution({name:r.name,shiny:true}).urls[0],api.resolution({name:r.name}).urls[0]);}
});
test('wrong costume source, released evidence, gender mapping or copied review fails validation',()=>{
 for(const mutate of [r=>delete r.starterShinyArtworkReview,r=>r.starterShinyArtworkReview.sourceUrl=r.starterShinyArtworkReview.normalReference.url,r=>r.assets.femaleShiny=r.assets.default,r=>r.starterShinyArtworkReview.releaseEvidence='https://example.com/',r=>r.starterShinyArtworkReview.stem='004-partyhat',r=>r.starterShinyArtworkReview.pixelReview='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(e=>e.names[0]==='Bulbasaur (Shedinja)'));assert.throws(()=>validateCatalog(c,process.cwd()),/Starter Shiny/);}
});
