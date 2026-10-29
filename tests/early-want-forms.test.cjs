const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),evidence=require('../data/catalogue-sources/early-want-form-evidence.json'),rows=require('../data/catalogue-reviewed-assets.json').records.filter(r=>r.sourceId.startsWith('variant-followup:early-want-five:'));
const names=['Darmanitan (Zen Mode)','Darmanitan (Galarian Zen Mode)','Ash-Greninja','Ultra Necrozma','Eiscue (Noice Face)'];
test('exactly five early-want identities have distinct pinned original pairs, no release/gender inference or duplicate IDs',()=>{
 assert.equal(rows.length,5);assert.deepEqual(rows.map(r=>r.names[0]).sort(),names.slice().sort());const pool=require('../scripts/reconcile-catalogue.cjs').loadIdentities().all;assert.equal(pool.length,1762);
 const window={};for(const file of ['data.js','js/domain/pokemonKeys.js','js/domain/publicPokemonDex.js','js/domain/costumeSpriteCatalog.js','js/domain/spriteSlugs.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{window});
 for(const r of rows){const matches=pool.filter(p=>p.name===r.names[0]);assert.equal(matches.length,1);const state=window.PogoDomain.publicPokemonDex.variantStatus(r.names[0]);assert.equal(state.normal,'unverified');assert.equal(state.shiny,'unverified');assert.deepEqual(Array.from(state.genders),[]);assert.notEqual(r.sha256.default,r.sha256.shiny);
  const proof=evidence.records.find(p=>p.name===r.names[0]);for(const key of ['default','shiny']){const b=fs.readFileSync(path.join(root,r.assets[key]));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),proof.artProof[key].sha256);assert.equal(crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex'),proof.artProof[key].gitBlobSha);assert.deepEqual(Array.from(window.PogoDomain.spriteSlugs.publicSpriteUrls(r.names[0],'',r.no,key==='shiny')),[r.assets[key]]);}}
 assert.equal(evidence.records.find(r=>r.name==='Ultra Necrozma').HOMEModelId,10157);for(const r of rows)assert(!/10155\.png$/.test(r.artProof.default.url));
 assert(!pool.some(r=>['Mimikyu (Busted Form)','Mega Chandelure','Lugia (Apex Purified)','Ho-Oh (Apex Purified)'].includes(r.name)));
});
test('new exact sources reject crossed forms, normal/Shiny swaps and unsupported release promotion',()=>{
 const os=require('node:os'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'early-want-source-')),original=require('../data/catalogue-reviewed-assets.json');
 try{fs.mkdirSync(path.join(tmp,'data'));fs.symlinkSync(path.join(root,'assets'),path.join(tmp,'assets'));fs.copyFileSync(path.join(root,'data/stellar-same-appearance-evidence.json'),path.join(tmp,'data/stellar-same-appearance-evidence.json'));
  for(const mutate of [r=>r.artProof.default.url=r.artProof.shiny.url,r=>r.artProof.default.url=r.artProof.default.url.replace('fZEN','fGALARIAN_ZEN'),r=>r.normalRelease='released']){const copy=structuredClone(original);mutate(copy.records.find(r=>r.names[0]===names[0]));fs.writeFileSync(path.join(tmp,'data/catalogue-reviewed-assets.json'),JSON.stringify(copy));assert.throws(()=>require('../scripts/sprites/catalogue-review.cjs').validateReviewedAssets(tmp),/Wrong reviewed variant\/source/);}
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('all public numbers roundtrip the compact delta encoding and exact assets are packaged below the unchanged budget',()=>{
 const source=fs.readFileSync(path.join(root,'scripts/generate-public-sprite-dex.cjs'),'utf8'),helpers=source.slice(source.indexOf('function normalize('),source.indexOf('\nfunction main(')),data=vm.runInNewContext('(()=>{'+helpers+';return sourceRows()})()',{fs,path,vm,root,require:require('node:module').createRequire(path.join(root,'scripts/generate-public-sprite-dex.cjs'))});
 const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/publicPokemonDex.js'),'utf8'),{window});for(const row of data.rows)assert.equal(window.PogoDomain.publicPokemonDex.dex(row.name),row.no,row.name);
 assert(fs.statSync(path.join(root,'js/domain/publicPokemonDex.js')).size<35000);const allow=require('../scripts/pages/frontend-files.json').assetFiles;for(const r of rows)for(const a of Object.values(r.assets))assert(allow.includes(a),a);
});
