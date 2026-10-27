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
  const eligibility=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-variant-status.json'),'utf8'));
  if(eligibility.schemaVersion!==1||!Array.isArray(eligibility.records))throw Error('Invalid reviewed variant eligibility');
  const seen=new Set();for(const row of eligibility.records){const name=normalize(row.name),entry=byName.get(name);if(seen.has(name)||!entry||entry.no!==row.no||!['released','announced','unverified'].includes(row.normal)||row.category&&!['costume','form','reviewed','variant-art'].includes(row.category)||!['released','unverified','announced'].includes(row.shiny)||!row.releaseEvidence?.length||(!Array.isArray(row.genders)||row.genders.some(g=>!['f','m'].includes(g))||new Set(row.genders).size!==row.genders.length))throw Error('Incomplete or conflicting variant eligibility: '+row.name);seen.add(name);}
  const artChecks=JSON.parse(fs.readFileSync(path.join(root,'data/catalogue-art-checks.json'),'utf8')).records;
  const reviewedCostumes=JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-catalog.json'),'utf8'));
  require('./sprites/costume-sprite-catalog-lib.cjs').validateCatalog(reviewedCostumes,root);
  const inventory=require('./sprites/catalogue-review.cjs').validateReviewedAssets(root);
  const staged=JSON.parse(fs.readFileSync(path.join(root,'data/catalogue-sources/staged-art.json'),'utf8')).records;
  for(const row of eligibility.records){
    if(row.category==='variant-art'){const art=require('./sprites/variant-art-review.cjs').proofRegister(root).find(r=>r.name===row.name&&r.no===row.no);if(!art||row.normal!==art.normal||row.shiny!==art.shiny||JSON.stringify(row.genders)!==JSON.stringify(art.artAllowedGenders))throw Error('Exact variant release/art evidence mismatch: '+row.name);
    }else if(row.category==='reviewed'){const art=inventory.find(r=>r.no===row.no&&r.names[0]===row.name);if(!art||JSON.stringify(row.genders)!==JSON.stringify(art.genders)||row.normal!==art.normalRelease||row.shiny!==art.shinyRelease)throw Error('Reviewed inventory status mismatch: '+row.name);row.assets=art.assets;
    }else if(row.category==='costume'){
      const exact=reviewedCostumes.entries.find(entry=>entry.no===row.no&&entry.names[0]===row.name&&entry.status==='exact');
      if(!exact||['default','shiny','female','femaleShiny'].some(key=>!exact.sha256[key]||!staged.some(proof=>proof.sha256===exact.sha256[key]&&proof.decoded?.status==='decoded')))throw Error('Reviewed costume lacks exact four-variant proof: '+row.name);
    }else {if(row.category==='form'&&!JSON.parse(fs.readFileSync(path.join(root,'data/public-form-sprite-identities.json'),'utf8')).records.some(proof=>proof.id===row.artId&&proof.speciesId===row.no&&[proof.name,...proof.aliases||[]].includes(row.name)))throw Error('Unreviewed exact form status: '+row.name);for(const shiny of [false,true])if(!artChecks.some(proof=>proof.no===(row.artId||row.no)&&proof.shiny===shiny&&!proof.gender&&proof.status==='verified-bytes'&&proof.decoded&&/^[0-9a-f]{64}$/.test(proof.sha256||'')))throw Error('Reviewed variant lacks exact decoded art proof: '+row.name);}
  }
  return{rows,dynamaxIndexes,eligibility:eligibility.records.map(({name,normal,shiny,genders,assets})=>({name,normal,shiny,genders,...(assets?{assets}:{})}))};
}

function runtimeSource({rows,dynamaxIndexes,eligibility}){
  if(rows.some(row=>row.name.includes('|')))throw new Error('Public sprite name contains compact delimiter');
  let previous='';const encodedNames=rows.map(row=>{let keep=0;while(keep<previous.length&&keep<row.name.length&&previous[keep]===row.name[keep])keep++;const encoded=keep.toString(36)+':'+row.name.slice(keep);previous=row.name;return encoded;}).join('|');
  return`(function(g){\n  'use strict';\n  const root=g.PogoDomain=g.PogoDomain||{};\n  let previous='';const names=${JSON.stringify(encodedNames)}.split('|').map(row=>{const at=row.indexOf(':');return previous=previous.slice(0,parseInt(row.slice(0,at),36))+row.slice(at+1);});\n  const nos=${JSON.stringify(rows.map(row=>row.no.toString(36)).join('.'))}.split('.').map(value=>parseInt(value,36));\n  const maxIds=${JSON.stringify(dynamaxIndexes)};\n  const eligibility=${JSON.stringify(eligibility.map(({name,normal,shiny,genders,assets})=>normal==='released'&&shiny==='released'&&genders.join('')==='mf'&&!assets?[rows.findIndex(row=>normalize(row.name)===normalize(name))]:[rows.findIndex(row=>normalize(row.name)===normalize(name)),normal[0]+shiny[0],genders.join(''),...(assets?[[assets.default.match(/catalogue-([a-f0-9]+)\.png$/)[1],assets.shiny?.match(/catalogue-([a-f0-9]+)\.png$/)[1]||'']]:[])]))};\n  function key(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\\s+/g,' ');}\n  const byName=new Map(names.map((name,i)=>[key(name),nos[i]]));\n  const dex=value=>byName.get(key(value))||0;\n  const maxByName=new Map(maxIds.map(index=>{const name=names[index],no=nos[index];return[key(name),{base:name.slice(0,-' (Dynamax)'.length),no}];}));\n  function dynamaxBase(value='',no=0){const item=maxByName.get(key(value));return item&&item.no===Number(no)?item.base:'';}\n  const states={r:'released',u:'unverified',a:'announced'};const artPath=hash=>hash?'assets/sprites/go/catalogue-'+hash+'.png':'';const eligibilityByName=new Map(eligibility.map(([index,status='rr',genders='mf',art])=>[key(names[index]),Object.freeze({name:names[index],normal:states[status[0]],shiny:states[status[1]],genders:Object.freeze(genders.split('')),...(art?{assets:Object.freeze({default:artPath(art[0]),shiny:artPath(art[1])})}:{})})]));\n  const variantStatus=value=>eligibilityByName.get(key(root.pokemonCatalog?.resolveLegacyKey(value)?.canonicalKey||root.costumeSpriteCatalog?.resolve({name:value})?.names[0]||value))||null;\n  root.publicPokemonDex=Object.freeze({schemaVersion:2,dex,dynamaxBase,variantStatus,entries:()=>names.map((name,i)=>[name,nos[i]]),size:byName.size,dynamaxSize:maxIds.length});\n})(window);\n`.replace(/\n  /g,'').replace(/\n/g,'');
}

function main(){
  const source=sourceRows(),expected=runtimeSource(source).replace(/\n  /g,'').replace(/\n/g,'');
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
