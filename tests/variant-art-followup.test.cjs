'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),review=require('../scripts/sprites/variant-art-review.cjs'),catalog=require('../data/costume-sprite-catalog.json'),proof=review.proofRegister(root),routes=require('../data/catalogue-variant-route-review.json');
function entry(name){return structuredClone(catalog.entries.find(r=>r.names[0]===name));}
test('exact variant review rejects changed normals, aliases, bytes and release gates',()=>{
 for(const mutate of [r=>r.assets.default=r.assets.shiny,r=>r.names.push('Unreviewed alias'),r=>r.assets.shiny=r.assets.default,r=>r.shinyAvailability='released',r=>r.shinyAvailability='unreleased']){const e=entry('Pikachu (Clone)');mutate(e);assert.throws(()=>review.validateVariantArtworkReview(e,root),/Exact variant artwork review mismatch/);}
 for(const r of proof){const e=entry(r.name);review.validateVariantArtworkReview(e,root);assert.deepEqual(review.retainedEntry(e,r),r.originalRecord);assert.notEqual(r.variants.shiny.decoded.pixelHash,r.normalComparison.decoded.pixelHash);}
});
test('mined Shiny art permits early wants while keeping historical gender/release evidence',()=>{
 for(const name of ['Pikachu (Clone)','Pikachu (Ph_D)','Mewtwo (Armored)']){const p=proof.find(r=>r.name===name),e=entry(name);assert.equal(p.shiny,'unverified');assert.ok(e.assets.shiny);assert.equal(e.shinyAvailability,undefined);}
 assert.deepEqual(entry('Pikachu (Clone)').availableGenders,['m']);assert.deepEqual(entry('Pikachu (Ph_D)').availableGenders,['f']);
});
test('source-model review does not clear generic Spinda through species equality',()=>{
 assert.equal(routes.home.originalRows,649);assert.equal(routes.homeRows.length,649);assert.equal(routes.homeRows.filter(r=>r.state==='qualified-exact-source-model').length,648);const held=routes.homeRows.filter(r=>r.state==='owner-attention-required');assert.deepEqual(held.map(r=>r.name),['Spinda']);assert.equal(routes.unresolved[0].state,'owner-attention-required');assert.equal(routes.home.imagesDecoded,1232);assert.equal(routes.source.status,'verified-current-directory');assert.ok(routes.source.priorObservationIssue,'stale/truncated prior observation remains visible');
});
test('canonical Gigantamax model IDs and Sunshine alias route both normal and Shiny exactly',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/spriteSlugs.js'),'utf8'),{window,URL});const s=window.PogoDomain.spriteSlugs;
 for(const [name,no,id]of [['Venusaur (Gigantamax)',3,10195],['Toxtricity (Gigantamax)',849,10219],['Duraludon (Gigantamax)',884,10225]])for(const shiny of [false,true])assert.equal(s.publicSpriteUrls(name,'',no,shiny)[0],`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny?'shiny/':''}${id}.png`);
 for(const shiny of [false,true]){assert.match(s.publicSpriteUrls('Cherrim (Sunny)','',421,shiny)[0],new RegExp('/'+(shiny?'shiny':'normal')+'/cherrim-sunshine.png$'));assert.deepEqual(Array.from(s.publicSpriteUrls('Urshifu (Gigantamax)','',892,shiny)),[]);}
});
