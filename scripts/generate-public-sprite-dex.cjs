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
  for(const entry of Array.isArray(database.dynamax)?database.dynamax:[])add({no:entry.no,name:`${entry.displayName||entry.name} (Dynamax)`});
  for(const entry of window.PogoDomain?.pokemonCatalog?.verifiedMissingEntries||[])add(entry);
  for(const entry of window.PogoDomain?.pokemonCatalog?.legendaryEntries||[])add(entry);
  // These are runtime-selectable entries in application.js, outside data.js.
  // Extract the bounded declarations rather than executing the full app boot.
  const application=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
  const costumes=application.match(/const EXTRA_COSTUME_ENTRIES=(\[.*?\]);\n/s);
  const patterns=application.match(/const SCATTERBUG_PATTERNS=(\[[^;]+\]);/);
  const forms=application.match(/const EXTRA_FORM_ENTRIES=(\[[\s\S]*?\]);\nconst LEGENDARY_AVATAR_ENTRIES=/);
  if(!costumes||!patterns||!forms)throw new Error('Runtime supplemental catalog declarations were not found');
  for(const entry of JSON.parse(costumes[1]))add(entry);
  const supplemental={SCATTERBUG_PATTERNS:vm.runInNewContext(patterns[1]),SPRITE_BASE:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'};
  for(const entry of vm.runInNewContext(forms[1],supplemental))add(entry);
  for(const identity of window.PogoDomain?.pokemonCatalog?.VERIFIED_IDENTITIES||[]){
    const no=Number(identity.speciesId);
    if(!Number.isInteger(no)||no<=0)continue;
    for(const label of [identity.primary,...identity.aliases,...identity.searchAliases])add({no,name:label});
  }
  const rows=[...byName.values()].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.no-b.no);
  const indexByName=new Map(rows.map((entry,index)=>[normalize(entry.name),index]));
  const dynamaxIndexes=[...new Set((database.dynamax||[]).map(entry=>{
    const name=`${entry.displayName||entry.name} (Dynamax)`;
    const index=indexByName.get(normalize(name));
    if(index===undefined||rows[index].no!==Number(entry.no))throw new Error(`Missing public Dynamax identity: ${name}`);
    return index;
  }))];
  return{rows,dynamaxIndexes};
}

function runtimeSource({rows,dynamaxIndexes}){
  return`(function(global){\n  'use strict';\n  const root=global.PogoDomain=global.PogoDomain||{};\n  const rows=${JSON.stringify(rows.map(row=>[row.name,row.no]))};\n  const dynamaxIndexes=${JSON.stringify(dynamaxIndexes)};\n  function normalize(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\\s+/g,' ');}\n  const byName=new Map(rows.map(([name,no])=>[normalize(name),no]));\n  function dex(value=''){return byName.get(normalize(value))||0;}\n  const dynamaxBaseByName=new Map(dynamaxIndexes.map(index=>{const [name,no]=rows[index];return[normalize(name),{base:name.slice(0,-' (Dynamax)'.length),no}];}));\n  function dynamaxBase(value='',no=0){const reviewed=dynamaxBaseByName.get(normalize(value));return reviewed&&reviewed.no===Number(no)?reviewed.base:'';}\n  root.publicPokemonDex=Object.freeze({schemaVersion:2,dex,dynamaxBase,size:byName.size,dynamaxSize:dynamaxIndexes.length});\n})(window);\n`;
}

function main(){
  const source=sourceRows(),expected=runtimeSource(source);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==expected)throw new Error('Public sprite dex runtime is stale; run npm run generate:costume-sprites');
    process.stdout.write(`Public sprite dex runtime is current (${source.rows.length} names).\n`);
    return;
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,expected);
  process.stdout.write(`Generated ${path.relative(root,output)} from ${source.rows.length} public catalog names.\n`);
}

try{main();}catch(error){console.error(error.message);process.exitCode=1;}
