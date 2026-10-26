#!/usr/bin/env node
'use strict';
// The expectations are transcribed from release announcements, never generated
// from the application catalog. Missing whole entries must fail this check.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function missingReleasedEntries(database,evidence){
  if(!evidence.records?.length)throw new Error('Release evidence must not be empty');
  const ids=new Set();
  return evidence.records.filter(record=>{
    if(!record.id||ids.has(record.id))throw new Error('Release evidence IDs must be unique');
    ids.add(record.id);
    if(!['dynamax','costumes'].includes(record.collection)||!Number.isInteger(record.no)||!record.name||
       !/^\d{4}-\d{2}-\d{2}$/.test(record.releasedOn)||record.releasedOn>evidence.asOf||
       !record.sources?.length||record.sources.some(url=>!/^https:\/\//.test(url)))
      throw new Error(`Incomplete release evidence: ${record.id}`);
    const matches=(database[record.collection]||[]).filter(entry=>entry.name===record.name);
    if(matches.length>1||matches.some(entry=>entry.no!==record.no))throw Error(`Ambiguous released identity: ${record.id}`);
    return matches.length!==1;
  });
}
function loadCatalog(){
  const window={};
  const context=vm.createContext({window});
  for(const file of ['data.js','js/domain/pokemonKeys.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  const database=window.POGO_TRADE_DB;
  return {...database,costumes:[...database.costumes,...window.PogoDomain.pokemonCatalog.verifiedMissingEntries]};
}
function checkPublicEligibility(api,evidence){
  for(const record of evidence.records.filter(row=>row.collection==='dynamax')){
    if(api.dynamaxBase(record.name+' (Dynamax)',record.no)!==record.name)
      throw Error(`Released identity missing public Max allowlist: ${record.id}`);
  }
}
function loadPublicDex(){
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/publicPokemonDex.js'),'utf8'),{window});
  return window.PogoDomain.publicPokemonDex;
}
if(require.main===module){
  try{
    const evidence=JSON.parse(fs.readFileSync(path.join(root,'data/recent-release-coverage.json'),'utf8'));
    const missing=missingReleasedEntries(loadCatalog(),evidence);
    checkPublicEligibility(loadPublicDex(),evidence);
    if(missing.length)throw new Error(`Missing released catalog entries: ${missing.map(entry=>entry.id).join(', ')}`);
    const sprites=JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-catalog.json'),'utf8'));
    for(const record of evidence.records.filter(r=>r.requiredArtwork)){
      const art=sprites.entries.find(e=>e.no===record.no&&e.names.includes(record.name));
      if(!art||art.status!=='exact'||JSON.stringify(art.availableGenders)!==JSON.stringify(record.requiredArtwork.genders)||!art.assets.default||record.requiredArtwork.shiny&&!art.assets.shiny)
        throw Error(`Released identity lacks reviewed exact/gender/Shiny art: ${record.id}`);
    }
    console.log(`All ${evidence.records.length} independently reviewed releases are present (as of ${evidence.asOf}).`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={missingReleasedEntries,loadCatalog,checkPublicEligibility,loadPublicDex};
