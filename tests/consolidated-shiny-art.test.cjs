'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{validateCatalog}=require('../scripts/sprites/costume-sprite-catalog-lib.cjs');
const catalog=require('../data/costume-sprite-catalog.json'),proof=require('../data/reviewed-consolidated-shiny-assets.json'),window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const api=window.PogoDomain.costumeSpriteCatalog;
test('all 173 verified mappings resolve 183 exact Shiny source files and 664 valid normal/Shiny/gender models',()=>{
 assert.equal(proof.records.length,173);assert.equal(new Set(proof.records.map(r=>r.name)).size,173);assert.equal(proof.sourceManifest.sha256,'bc82ed55eeb85d4cd0ef2db942e11d040dd872611e9bfc3fce3fd350c1ab0009');validateCatalog(catalog,process.cwd());const files=new Set();let models=0;
 for(const r of proof.records){const row=catalog.entries.find(e=>e.names[0]===r.name);for(const [key,a]of Object.entries(r.assets)){files.add(a);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex'),r.sha256[key]);}for(const a of Object.values(r.retainedNormal))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(a.asset)).digest('hex'),a.sha256);
 for(const gender of r.sourceGenders)for(const shiny of [false,true]){models++;const expected=shiny?r.assets[gender==='f'?'femaleShiny':'shiny']:r.retainedNormal[gender==='f'&&r.retainedNormal.female?'female':'default'].asset;for(const name of row.names){assert.deepEqual(Array.from(api.resolution({name,gender,shiny}).urls),[expected],name);}}
 }assert.equal(files.size,183);assert.equal(models,664);
});
test('fixed-gender and genderless models reject incompatible art without mutating saved inputs',()=>{
 const fixed=proof.records.filter(r=>r.sourceGenders.length===1);assert.equal(fixed.length,14);assert.equal(fixed.filter(r=>r.genderModel==='genderless').length,4);
 for(const r of fixed)for(const gender of ['m','f'].filter(g=>!r.sourceGenders.includes(g)))for(const shiny of [false,true]){const input={name:r.name,gender,shiny},before=JSON.stringify(input);assert.equal(api.resolution(input).reason,'invalid-gender');assert.equal(JSON.stringify(input),before);}
});
test('exact form, size, gender and source references survive aliases without generic substitution',()=>{
 for(const no of [413,676,710,711,741]){const rows=proof.records.filter(r=>r.no===no);assert.equal(new Set(rows.map(r=>r.assets.shiny)).size,rows.length);assert(rows.length>=3);}
 const gengar=proof.records.filter(r=>r.no===94&&r.sourceId==='0094-00-00-03');assert.equal(gengar.length,2);assert.equal(gengar[0].assets.shiny,gengar[1].assets.shiny);assert.notEqual(gengar[0].name,gengar[1].name);
 const q=proof.records.find(r=>r.no===195);assert.notEqual(q.assets.shiny,q.assets.femaleShiny);assert.equal(q.sha256.shiny,q.sha256.femaleShiny);
});
test('five unreleased and previous held identities do not acquire invented Shiny art',()=>{
 assert.equal(proof.unreleasedRecords.length,5);
 for(const r of proof.unreleasedRecords)assert.notEqual(api.resolution({name:r.inventory.mappingKey,shiny:true}).status,'exact');
 for(const name of ['Pikachu (Detective)','Raichu Detective','Spinda (Form 1)','Vivillon (Fancy)'])assert.notEqual(api.resolution({name,shiny:true}).status,'exact',name);
});
test('review removal, identity, size, byte, gender and normal-art drift fail closed',()=>{
 for(const mutate of [r=>delete r.consolidatedShinyArtworkReview,r=>r.consolidatedShinyArtworkReview.sourceId='0710-00-04',r=>r.consolidatedShinyArtworkReview.sourceReferences.shiny.size=[1,1],r=>r.assets.shiny=r.assets.default,r=>r.sha256.shiny='0'.repeat(64),r=>r.consolidatedShinyArtworkReview.retainedNormal.default.asset=r.assets.shiny,r=>r.consolidatedShinyArtworkReview.pixelReview='unreviewed']){const c=structuredClone(catalog);mutate(c.entries.find(r=>r.names[0]==='Ivysaur Party Hat'));assert.throws(()=>validateCatalog(c,process.cwd()),/Consolidated Shiny/);}
 for(const genders of [['m'],['m','f']]){const c=structuredClone(catalog);c.entries.find(r=>r.names[0]==='Ditto Blue Party Hat').availableGenders=genders;assert.throws(()=>validateCatalog(c,process.cwd()),/gender|Consolidated/i);}
});
test('frozen inventory preserves every normal byte and all 219 held or unrelated catalog entries',()=>{
 const scope=require('../data/reviewed-consolidated-artwork-scope.json'),byname=new Map(catalog.entries.map(r=>[r.names[0],r]));
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(', ')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+': '+canonical(v[k])).join(', ')+'}':JSON.stringify(v);
 assert.equal(scope.records.length,178);assert.equal(scope.records.filter(r=>r.classification==='released-shiny').length,173);assert.equal(Object.keys(scope.outsideScopeEntryHashes).length,219);
 assert.deepEqual(new Set(byname.keys()),new Set([...Object.keys(scope.outsideScopeEntryHashes),...scope.records.map(r=>r.mappingKey),'Pikachu (Orange Hanbok)','Minior (Green Core)','Cinderace (Gigantamax)','Charizard (Gigantamax)','Pikachu (Hat and Capelet)','Zubat (Top Hat)','Sinistea (Bow)','Sinistea (Bow, Phony)','Sinistea (Bow, Antique)','Caterpie (Poke Ball Hat)']));
 for(const [name,hash]of Object.entries(scope.outsideScopeEntryHashes))assert.equal(crypto.createHash('sha256').update(canonical(byname.get(name)).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))).digest('hex'),hash,name);
 for(const r of scope.records){const e=byname.get(r.mappingKey);assert.equal(e.no,r.dex);for(const [key,a]of Object.entries(r.normalAssets)){assert.equal(e.assets[key],a.path);assert.equal(e.sha256[key],a.sha256);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex'),a.sha256);}if(r.classification==='released-shiny'){assert.equal(r.reviewStatus,'verified-consolidated-manifest');assert(e.assets.shiny);}}
});
