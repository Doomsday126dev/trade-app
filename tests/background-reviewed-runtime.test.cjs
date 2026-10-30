'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{readCatalogue}=require('../js/domain/backgroundPersistence.js');
const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(path.join(root,'data/background-runtime-catalog.json'))),manifest=JSON.parse(fs.readFileSync(path.join(root,'data/background-art-manifest.json'))),holds=JSON.parse(fs.readFileSync(path.join(root,'data/background-review-holds.json')));
const ids=new Set(catalog.records.map(r=>r.catalogId)),resolveEntry=id=>ids.has(id)?{catalogId:id}:null;
test('compiled reviewed inventory remains incomplete and holds never become picker records',()=>{
 const value=readCatalogue(catalog,{resolveEntry});assert.equal(value.coverageComplete,false);assert.equal(value.loaded,true);assert.ok(value.records.length>2000);assert.ok(holds.holds.length>0);assert.equal(holds.sourcePairCount,1927);
 for(const[backgroundId,catalogId,shiny]of holds.withdrawnShiny)assert.equal(value.records.some(r=>r.id===backgroundId&&r.catalogId===catalogId&&r.shiny===shiny),false);
 assert.equal(value.records.some(r=>r.id==='sb-9th-anniversary'&&r.catalogId==='pokemon:999:standard:legacy:Gimmighoul%209th%20Anniversary%20Coin'&&r.shiny),true);
 assert.equal(value.records.find(r=>r.id==='sb-9th-anniversary').sha256,'3cbf052dd80baf8fe106ea26f8b165801c1da392ccb8733e05b6f5a9c5d04ca5');
 assert.equal(value.records.find(r=>r.id==='sb-gowildarea-2024-global').sha256,'c2ad491dc934ef48d3aac08a48db31b3937bf6eb8cd84aaf7a1a65c40b970823');
});
test('every referenced real artwork is packaged once with exact approved hash and bytes',()=>{
 assert.equal(manifest.coverageComplete,false);assert.equal(manifest.recordCount,catalog.records.length);assert.equal(new Set(manifest.assets.map(r=>r.url)).size,manifest.assetCount);
 const assets=new Map(manifest.assets.map(a=>[a.url,a]));for(const r of catalog.records){const a=assets.get(r.url);assert.ok(a);assert.equal(r.sha256,a.sha256);}
 for(const a of manifest.assets){const b=fs.readFileSync(path.join(root,a.url));assert.equal(b.length,a.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),a.sha256);}
 assert.equal(fs.readdirSync(path.join(root,'assets/backgrounds')).length,manifest.assetCount);
});
test('catalogue rejects unknown identities, duplicated qualifiers, lane mismatch and URL escape',()=>{
 for(const change of [r=>r.catalogId='pokemon:unknown',r=>r.category='gmax',r=>r.url='assets/backgrounds/../wrong.png',r=>r.sha256='0'.repeat(64)]){
  const c=structuredClone(catalog);change(c.records.find(r=>r.category==='wishlist'));assert.throws(()=>readCatalogue(c,{resolveEntry}));
 }
 const duplicate=structuredClone(catalog);duplicate.records.push(duplicate.records[0]);assert.throws(()=>readCatalogue(duplicate,{resolveEntry}),/record-invalid/);
});

test("explicit verified subset remains incomplete and unknown scope fails closed",()=>{const value=readCatalogue(catalog,{resolveEntry});assert.equal(value.coverageComplete,false);assert.equal(value.releaseScope,"verified-subset");const wrong=structuredClone(catalog);wrong.releaseScope="all";assert.throws(()=>readCatalogue(wrong,{resolveEntry}),/catalogue-invalid/);delete wrong.releaseScope;assert.equal(readCatalogue(wrong,{resolveEntry}).releaseScope,null);});
