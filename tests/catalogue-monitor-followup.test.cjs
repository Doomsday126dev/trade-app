const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadIdentities}=require('../scripts/reconcile-catalogue.cjs'),record=require('../data/pokeminers-thailand-costume-assets.json').records[0];
test('Max additions exist as distinct picker identities and retain ordinary-form exact normal/Shiny routes',()=>{
 const all=loadIdentities().all,window={URL};for(const file of ['pokemonKeys.js','costumeSpriteCatalog.js','publicPokemonDex.js','spriteSlugs.js'])vm.runInNewContext(fs.readFileSync('js/domain/'+file,'utf8'),{window,URL});
 for(const [no,name]of [[126,'Magmar'],[303,'Mawile'],[467,'Magmortar']]){assert.equal(all.filter(r=>r.name===name+' (Dynamax)'&&r.no===no).length,1);assert(all.some(r=>r.name===name));for(const shiny of [false,true])for(const gender of ['','m','f'])assert.deepEqual(Array.from(window.PogoDomain.spriteSlugs.publicSpriteUrls(name+' (Dynamax)',gender,no,shiny)),['https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(shiny?'shiny/':'')+no+'.png']);}
 assert.equal(window.PogoDomain.publicPokemonDex.variantStatus('Mawile (Dynamax)').normal,'unverified');assert.equal(window.PogoDomain.publicPokemonDex.variantStatus(record.names[0]).normal,'announced');
});
test('Thailand keeps all four pinned original hashes and exact gender/Shiny routes without costume fallback',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('js/domain/costumeSpriteCatalog.js','utf8'),{window});const catalog=window.PogoDomain.costumeSpriteCatalog;
 for(const shiny of [false,true])for(const gender of ['','m','f']){const key=gender==='f'?(shiny?'femaleShiny':'female'):(shiny?'shiny':'default'),bytes=fs.readFileSync(record.assets[key]);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256[key]);assert.deepEqual(Array.from(catalog.resolution({name:record.names[0],shiny,gender}).urls),[record.assets[key]]);}
 assert.equal(new Set(Object.values(record.sha256)).size,4);assert.deepEqual(Array.from(catalog.resolution({name:record.names[0],shiny:true,gender:'invalid'}).urls),[]);
});
test('offline test Max originals are the already-qualified source bytes, not substituted fixture artwork',()=>{
 const checks=require('../data/catalogue-art-checks.json').records;
 for(const no of [126,303,467])for(const shiny of [false,true]){const url='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(shiny?'shiny/':'')+no+'.png',proof=checks.find(r=>r.url===url&&r.status==='verified-bytes'&&r.decoded),bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/catalogue-monitor-followup',no+(shiny?'-shiny':'')+'.png'));assert(proof);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),proof.sha256);}
});
