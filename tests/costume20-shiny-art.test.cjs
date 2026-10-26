'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');
const catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/reviewed-costume20-shiny-assets.json'),window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('20 reviewed costumes resolve 22 original Shiny PNGs and retain every normal byte',()=>{
 assert.equal(proof.records.length,20);assert.equal(proof.sourceManifest.sha256,'4e259cb44ee4ddcbd8c6dd37d3b4fa3d15166487d67302f50e3fff67bb87f3da');validateCatalog(catalog,process.cwd());const files=new Set();
 for(const r of proof.records){const row=catalog.entries.find(e=>e.names[0]===r.name);for(const [key,a]of Object.entries(r.assets)){files.add(a);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex'),r.sha256[key]);}for(const normal of Object.values(r.retainedNormal))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(normal.asset)).digest('hex'),normal.sha256);for(const name of row.names)for(const requested of ['',...r.sourceGenders])for(const shiny of [false,true]){const gender=requested||(r.sourceGenders.length===1?r.sourceGenders[0]:'');assert.deepEqual(Array.from(api.resolution({name,gender:requested,shiny}).urls),[shiny?r.assets[gender==='f'?'femaleShiny':'shiny']:r.retainedNormal[gender==='f'&&r.retainedNormal.female?'female':'default'].asset]);}}
 assert.equal(files.size,22);
});
test('Butterfree wings and Raticate whiskers use distinct female models; shared art is explicit',()=>{
 for(const r of proof.records){if([12,20].includes(r.no)){assert.notEqual(r.assets.shiny,r.assets.femaleShiny);assert.notEqual(r.sha256.shiny,r.sha256.femaleShiny);}else if(r.sourceGenders.includes('f'))assert.equal(r.assets.shiny,r.assets.femaleShiny);else assert.equal(r.assets.femaleShiny,undefined);}
});
test('four fixed-species genders reject invalid artwork without mutating saved input; prior holds remain',()=>{
 const single=proof.records.filter(r=>r.sourceGenders.length===1);assert.equal(single.length,4);
 for(const r of single)for(const shiny of [false,true]){const input={name:r.name,gender:r.sourceGenders[0]==='f'?'m':'f',shiny,p:'H'},before=JSON.stringify(input),result=api.resolution(input);assert.equal(result.reason,'invalid-gender');assert.equal(result.urls.length,0);assert.equal(JSON.stringify(input),before);}
 for(const name of ['Pikachu (Detective)','Raichu Detective','Spinda (Form 1)','Vivillon (Fancy)'])assert.notEqual(api.resolution({name,shiny:true}).status,'exact',name);
});
test('wrong identity, source, gender, normal reference or review drift cannot pass provenance validation',()=>{
 for(const mutate of [r=>delete r.costume20ShinyArtworkReview,r=>r.costume20ShinyArtworkReview.sourceId='0020-00-00-01',r=>r.costume20ShinyArtworkReview.sourceCommit='0'.repeat(40),r=>r.assets.femaleShiny=r.assets.shiny,r=>r.costume20ShinyArtworkReview.gitBlobShas.shiny='0'.repeat(40),r=>r.costume20ShinyArtworkReview.retainedNormal.default.asset=r.assets.shiny,r=>r.costume20ShinyArtworkReview.pixelReview='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Butterfree (Bow)'));assert.throws(()=>validateCatalog(c,process.cwd()),/Costume20 Shiny/);}
});
