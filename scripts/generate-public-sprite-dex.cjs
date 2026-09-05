#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const output=path.join(root,'js/domain/publicPokemonDex.js');

function normalize(value=''){
  return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
}

function sourceRows(){
  const window={};
  const context=vm.createContext({window});
  vm.runInContext(fs.readFileSync(path.join(root,'data.js'),'utf8'),context,{filename:'data.js'});
  vm.runInContext(fs.readFileSync(path.join(root,'js/domain/pokemonKeys.js'),'utf8'),context,{filename:'pokemonKeys.js'});
  const byName=new Map();
  const add=entry=>{
    const no=Number.parseInt(entry?.no,10);
    if(!Number.isInteger(no)||no<=0)return;
    for(const label of [entry.name,entry.displayName]){
      const key=normalize(label);if(!key)continue;
      const prior=byName.get(key);
      if(prior&&prior.no!==no)throw new Error(`Conflicting public sprite dex for ${label}: ${prior.no} / ${no}`);
      byName.set(key,{name:String(label).normalize('NFKC').trim(),no});
    }
  };
  const database=window.POGO_TRADE_DB||{};
  for(const list of [database.wishlist,database.dynamax,database.gmax,database.costumes])for(const entry of Array.isArray(list)?list:[])add(entry);
  for(const entry of window.PogoDomain?.pokemonCatalog?.verifiedMissingEntries||[])add(entry);
  for(const entry of window.PogoDomain?.pokemonCatalog?.legendaryEntries||[])add(entry);
  return [...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.no-b.no);
}

function runtimeSource(rows){
  return`(function(global){\n  'use strict';\n  const root=global.PogoDomain=global.PogoDomain||{};\n  const rows=${JSON.stringify(rows.map(row=>[row.name,row.no]))};\n  function normalize(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\\s+/g,' ');}\n  const byName=new Map(rows.map(([name,no])=>[normalize(name),no]));\n  function dex(value=''){return byName.get(normalize(value))||0;}\n  root.publicPokemonDex=Object.freeze({schemaVersion:1,dex,size:byName.size});\n})(window);\n`;
}

function main(){
  const rows=sourceRows(),expected=runtimeSource(rows);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==expected)throw new Error('Public sprite dex runtime is stale; run npm run generate:costume-sprites');
    process.stdout.write(`Public sprite dex runtime is current (${rows.length} names).\n`);
    return;
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,expected);
  process.stdout.write(`Generated ${path.relative(root,output)} from ${rows.length} public catalog names.\n`);
}

try{main();}catch(error){console.error(error.message);process.exitCode=1;}
