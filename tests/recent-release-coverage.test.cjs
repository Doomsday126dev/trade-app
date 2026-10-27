const {test}=require('node:test');
const assert=require('node:assert/strict');
const evidence=require('../data/recent-release-coverage.json');
const {missingReleasedEntries,loadCatalog}=require('../scripts/check-released-catalog.cjs');

test('independently sourced released identities exist in the selectable source catalog',()=>{
  assert.deepEqual(missingReleasedEntries(loadCatalog(),evidence).map(entry=>entry.id),[]);
});

test('coverage detects removal of an entire entry, not just malformed existing art',()=>{
  const complete={};
  for(const entry of evidence.records)(complete[entry.collection]??=[]).push({no:entry.no,name:entry.name});
  assert.equal(missingReleasedEntries(complete,evidence).length,0);
  for(const removed of evidence.records){
    const changed={...complete,[removed.collection]:complete[removed.collection].filter(entry=>entry.name!==removed.name)};
    assert.deepEqual(missingReleasedEntries(changed,evidence).map(entry=>entry.id),[removed.id]);
  }
});

test('ordinary species or Gigantamax cannot satisfy a Dynamax release',()=>{
  const wrong={wishlist:[],gmax:[]};
  for(const entry of evidence.records){wrong.wishlist.push({no:entry.no,name:entry.name});wrong.gmax.push({no:entry.no,name:entry.name});}
  assert.equal(missingReleasedEntries(wrong,evidence).length,evidence.records.length);
});

test('empty, duplicate and future release expectations fail closed',()=>{
  assert.throws(()=>missingReleasedEntries({}, {...evidence,records:[]}),/must not be empty/);
  assert.throws(()=>missingReleasedEntries({}, {...evidence,records:[evidence.records[0],evidence.records[0]]}),/unique/);
  assert.throws(()=>missingReleasedEntries({}, {...evidence,asOf:'2026-01-01'}),/Incomplete/);
});

test('all repaired Max sprites preserve normal/Shiny and visible gender variants in anonymous output',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),window={URL};
 const context=vm.createContext({window,URL});for(const file of ['publicPokemonDex.js','spriteSlugs.js','costumeSpriteCatalog.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/domain',file),'utf8'),context);
 const api=window.PogoDomain.spriteSlugs;
 for(const entry of evidence.records.filter(r=>r.collection==='dynamax'))for(const shiny of [false,true])for(const gender of ['','m','f']){
  const female=gender==='f'&&[111,112,464,215,461].includes(entry.no);
  const expected=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny?'shiny/':''}${female?'female/':''}${entry.no}.png`;
  assert.deepEqual(Array.from(api.publicSpriteUrls(entry.name+' (Dynamax)',gender,entry.no,shiny)),[expected]);
 }
 const costume=window.PogoDomain.costumeSpriteCatalog;
 assert.deepEqual(Array.from(costume.resolve({name:'Pikachu (Orange Hanbok)'}).availableGenders),['f']);
 assert.deepEqual(Array.from(costume.resolution({name:'Pikachu (Orange Hanbok)',names:['Pikachu (Orange Hanbok)'],gender:'m',shiny:true}).urls),[]);
});

test('a same-label wrong species or duplicate identity fails reconciliation',()=>{
 const row=evidence.records[0];const only={...evidence,records:[row]};
 assert.throws(()=>missingReleasedEntries({[row.collection]:[{name:row.name,no:row.no+1}]},only),/Ambiguous/);
 assert.throws(()=>missingReleasedEntries({[row.collection]:[{name:row.name,no:row.no},{name:row.name,no:row.no}]},only),/Ambiguous/);
});


test('a missing public Max allowlist entry fails even when selectable source data is complete',()=>{
 const {checkPublicEligibility,loadPublicDex}=require('../scripts/check-released-catalog.cjs');
 const api=loadPublicDex();assert.doesNotThrow(()=>checkPublicEligibility(api,evidence));
 for(const missing of evidence.records.filter(r=>r.collection==='dynamax')){
   const incomplete={dynamaxBase:(name,no)=>no===missing.no?'':api.dynamaxBase(name,no)};
   assert.throws(()=>checkPublicEligibility(incomplete,evidence),/missing public Max allowlist/);
 }
});
