'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const SCHEMA_VERSION=1;
const SOURCE_ID='pokemondb-go-reviewed';

function normalizeLookupKey(value=''){
  return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
}

function stableJson(value){return`${JSON.stringify(value,null,2)}\n`;}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fail(message){throw new Error(message);}

function validateCatalog(catalog,root){
  if(catalog?.schemaVersion!==SCHEMA_VERSION)fail(`Unsupported costume sprite catalog schema: ${catalog?.schemaVersion}`);
  if(catalog?.source?.id!==SOURCE_ID)fail(`Unexpected costume sprite source: ${catalog?.source?.id}`);
  if(!Array.isArray(catalog.entries)||!catalog.entries.length)fail('Costume sprite catalog must contain entries');
  const aliases=new Map();
  for(const entry of catalog.entries){
    if(!Number.isInteger(entry.no)||entry.no<=0)fail('Every costume sprite entry needs a positive integer dex number');
    if(!Array.isArray(entry.names)||!entry.names.length)fail(`Costume sprite entry ${entry.no} has no lookup names`);
    if(!['exact','unavailable'].includes(entry.status))fail(`Invalid costume sprite status for ${entry.names[0]}`);
    for(const name of entry.names){
      const key=normalizeLookupKey(name);
      if(!key)fail(`Blank costume sprite alias for ${entry.names[0]}`);
      const prior=aliases.get(key);
      if(prior&&prior!==entry)fail(`Duplicate costume sprite alias: ${name}`);
      aliases.set(key,entry);
    }
    if(entry.status==='unavailable'){
      if(entry.assets||entry.sourceFile||entry.sha256)fail(`Unavailable sprite entry contains an asset: ${entry.names[0]}`);
      continue;
    }
    if(!entry.sourceFile||!entry.sourceLabel)fail(`Exact sprite entry is missing reviewed source evidence: ${entry.names[0]}`);
    if(!entry.assets?.default||!entry.sha256?.default)fail(`Exact sprite entry is missing its default local asset: ${entry.names[0]}`);
    const variants=[['default',entry.assets.default,entry.sha256.default],['female',entry.assets.female,entry.sha256.female]];
    for(const[variant,relative,digest]of variants){
      if(!relative&&!digest)continue;
      if(!relative||!digest)fail(`Incomplete ${variant} asset metadata for ${entry.names[0]}`);
      if(!relative.startsWith('assets/sprites/go/')||path.posix.normalize(relative)!==relative)fail(`Unsafe costume sprite asset path: ${relative}`);
      if(!/^[0-9a-f]{64}$/.test(digest))fail(`Invalid costume sprite digest: ${relative}`);
      if(root){
        const absolute=path.join(root,relative);
        if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())fail(`Missing costume sprite asset: ${relative}`);
        const actual=sha256File(absolute);
        if(actual!==digest)fail(`Costume sprite digest mismatch: ${relative}`);
      }
    }
  }
  return catalog;
}

function runtimeSource(catalog){
  validateCatalog(catalog);
  const rows=catalog.entries.map(entry=>({
    no:entry.no,
    names:entry.names,
    status:entry.status,
    defaultUrl:entry.assets?.default||'',
    femaleUrl:entry.assets?.female||'',
    sourceLabel:entry.sourceLabel||'',
    unavailableReason:entry.unavailableReason||''
  }));
  return`(function(global){\n  'use strict';\n  const root=global.PogoDomain=global.PogoDomain||{};\n  const rows=${JSON.stringify(rows)};\n  function normalize(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\\s+/g,' ');}\n  const byName=new Map();\n  for(const row of rows)for(const name of row.names)byName.set(normalize(name),Object.freeze(row));\n  function resolve(input={}){\n    const names=Array.isArray(input.names)?input.names:[input.name];\n    for(const name of names){const row=byName.get(normalize(name));if(row)return row;}\n    return null;\n  }\n  function resolution(input={}){\n    const row=resolve(input);\n    if(!row)return Object.freeze({knownVariant:false,status:'unknown',urls:Object.freeze([]),record:null});\n    if(row.status!=='exact')return Object.freeze({knownVariant:true,status:'unavailable',urls:Object.freeze([]),record:row});\n    const urls=[];\n    if(String(input.gender||'').toLowerCase()==='f'&&row.femaleUrl)urls.push(row.femaleUrl);\n    if(row.defaultUrl&&!urls.includes(row.defaultUrl))urls.push(row.defaultUrl);\n    return Object.freeze({knownVariant:true,status:'exact',urls:Object.freeze(urls),record:row});\n  }\n  root.costumeSpriteCatalog=Object.freeze({schemaVersion:${SCHEMA_VERSION},sourceId:${JSON.stringify(SOURCE_ID)},normalize,resolve,resolution,records:Object.freeze(rows)});\n})(window);\n`;
}

module.exports={SCHEMA_VERSION,SOURCE_ID,normalizeLookupKey,stableJson,sha256File,validateCatalog,runtimeSource};
