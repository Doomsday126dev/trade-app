'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');
const catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/reviewed-evolution-shiny-assets.json'),window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('28 reviewed costumes resolve 47 exact Shiny assets without changing normal artwork',()=>{
 assert.equal(proof.records.length,28);assert.equal(proof.records.filter(r=>r.no===26).length,12);assert.equal(proof.records.filter(r=>r.no===172).length,9);assert.equal(proof.records.filter(r=>r.no===133).length,7);validateCatalog(catalog,process.cwd());const files=new Set();
 for(const r of proof.records){const row=catalog.entries.find(e=>e.names[0]===r.name);for(const [key,a]of Object.entries(r.assets)){files.add(a);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex'),r.sha256[key]);}for(const normal of Object.values(r.retainedNormal))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(normal.asset)).digest('hex'),normal.sha256);for(const name of row.names)for(const gender of ['','m','f'])for(const shiny of [false,true])assert.deepEqual(Array.from(api.resolution({name,gender,shiny}).urls),[shiny?r.assets[gender==='f'?'femaleShiny':'shiny']:r.retainedNormal[gender==='f'&&r.retainedNormal.female?'female':'default'].asset]);}
 assert.equal(files.size,47);
});
test('distinct Raichu/Eevee tails and shared Pichu models are explicit, Detective remains held',()=>{
 for(const r of proof.records)if(r.no===172){assert.equal(r.assets.shiny,r.assets.femaleShiny);assert.equal(r.sha256.shiny,r.sha256.femaleShiny);}else{assert.notEqual(r.assets.shiny,r.assets.femaleShiny);assert.notEqual(r.sha256.shiny,r.sha256.femaleShiny);}
 assert.equal(api.resolution({name:'Raichu Detective',shiny:true}).status,'unavailable');assert.equal(proof.holds[0].status,'requires-identity-selection');assert.equal(api.resolve({name:'Raichu Detective'}).evolutionShinyArtworkReview,undefined);
});
test('wrong costume, pinned source, gender or review drift cannot pass validation',()=>{
 for(const mutate of [r=>delete r.evolutionShinyArtworkReview,r=>r.evolutionShinyArtworkReview.sourceId='0026-00-00-01',r=>r.evolutionShinyArtworkReview.sourceCommit='0'.repeat(40),r=>r.assets.femaleShiny=r.assets.shiny,r=>r.evolutionShinyArtworkReview.gitBlobShas.shiny='0'.repeat(40),r=>r.evolutionShinyArtworkReview.pixelReview='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Raichu Beanie'));assert.throws(()=>validateCatalog(c,process.cwd()),/Evolution Shiny/);}
});
