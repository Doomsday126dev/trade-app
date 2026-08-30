#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateCatalog,runtimeSource}=require('./sprites/costume-sprite-catalog-lib.cjs');

const root=path.resolve(__dirname,'..');
const input=path.join(root,'data/costume-sprite-catalog.json');
const output=path.join(root,'js/domain/costumeSpriteCatalog.js');

function main(){
  const catalog=validateCatalog(JSON.parse(fs.readFileSync(input,'utf8')),root);
  const expected=runtimeSource(catalog);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==expected)throw new Error('Costume sprite runtime is stale; run npm run generate:costume-sprites');
    process.stdout.write(`Costume sprite runtime is current (${catalog.entries.length} reviewed records).\n`);
    return;
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,expected);
  process.stdout.write(`Generated ${path.relative(root,output)} from ${catalog.entries.length} reviewed records.\n`);
}

try{main();}catch(error){console.error(error.message);process.exitCode=1;}
