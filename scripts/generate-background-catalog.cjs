#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateCatalog}=require('./backgrounds/background-catalog-lib.cjs');

const ROOT=path.resolve(__dirname,'..');
const INPUT=path.join(ROOT,'data','backgrounds.json');
const OUTPUT=path.join(ROOT,'js','domain','backgroundCatalog.js');

function generatedSource(catalog){
  const records=JSON.stringify(catalog.backgrounds);
  return `// Generated from data/backgrounds.json by scripts/generate-background-catalog.cjs.\n(function(global){\n  const root=global.PogoDomain=global.PogoDomain||{};\n  const catalog=Object.freeze(${records}.map(record=>Object.freeze({...record,aliases:Object.freeze(record.aliases),pokemon:Object.freeze(record.pokemon),source:Object.freeze(record.source)})));\n  const byId=new Map(catalog.map(record=>[record.id,record]));\n  const released=Object.freeze(catalog.filter(record=>record.status==='released'));\n  const ID_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;\n  function normalizeId(value){const id=String(value||'').trim().toLowerCase();return ID_RE.test(id)?id:'';}\n  function normalizeText(value){return String(value||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}\n  function get(id){return byId.get(normalizeId(id))||null;}\n  function display(id){const record=get(id);return record?record.displayName:normalizeId(id)||'';}\n  function shortLabel(id){const record=get(id);return record?record.shortName:normalizeId(id)||'';}\n  function isRelevant(record,pokemonName){if(!pokemonName)return false;const query=normalizeText(pokemonName);return record.pokemon.some(name=>{const normalized=normalizeText(name);return normalized===query||normalized.startsWith(query+' ')||query.startsWith(normalized+' ');});}\n  function search(query='',options={}){\n    const q=normalizeText(query),pokemonName=String(options.pokemonName||'');\n    const source=options.includeCandidates?catalog:released;\n    return source.map(record=>{\n      const text=normalizeText([record.displayName,record.shortName,record.event,record.location,record.year,...record.aliases].filter(Boolean).join(' '));\n      if(q&&!q.split(/\\s+/).every(token=>text.includes(token)))return null;\n      const relevant=isRelevant(record,pokemonName);\n      return{record,relevant};\n    }).filter(Boolean).sort((a,b)=>(b.relevant?1:0)-(a.relevant?1:0)||(b.record.year||0)-(a.record.year||0)||a.record.type.localeCompare(b.record.type)||a.record.displayName.localeCompare(b.record.displayName,'en',{sensitivity:'base'})).slice(0,Math.max(1,Math.min(500,Number(options.limit)||80))).map(item=>item.record);\n  }\n  root.backgroundCatalog=Object.freeze({schemaVersion:${catalog.schemaVersion},catalogVersion:${JSON.stringify(catalog.catalogVersion)},asOf:${JSON.stringify(catalog.asOf)},catalog,released,normalizeId,normalizeText,get,display,shortLabel,isRelevant,search});\n})(window);\n`;
}

const catalog=JSON.parse(fs.readFileSync(INPUT,'utf8'));
const validation=validateCatalog(catalog);if(!validation.ok)throw new Error(validation.errors.join('\n'));
const source=generatedSource(catalog);
if(process.argv.includes('--check')){
  if(!fs.existsSync(OUTPUT)||fs.readFileSync(OUTPUT,'utf8')!==source){console.error('Generated background catalog is stale');process.exit(1);}
  console.log(`Background catalog generated module is current (${validation.released} released, ${validation.candidates} candidate).`);
}else{
  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,source);console.log(`Generated ${OUTPUT}`);
}
