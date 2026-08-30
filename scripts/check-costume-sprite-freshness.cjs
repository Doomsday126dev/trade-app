#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-upstream-snapshot.json'),'utf8'));

function decode(value){
  return String(value||'').replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'")
    .replace(/&quot;/g,'"').replace(/&eacute;/g,'é').replace(/&nbsp;/g,' ')
    .replace(/<[^>]+>/g,'').trim();
}
function parseFiles(html){
  const files=[];
  for(const match of html.matchAll(/<span class="sprites-table-card">([\s\S]*?)<\/span>/g)){
    const card=match[1];
    const file=card.match(/src="https:\/\/img\.pokemondb\.net\/sprites\/go\/normal\/1x\/([^"?]+\.png)"/)?.[1];
    if(!file)continue;
    const labels=[...card.matchAll(/<small[^>]*>([\s\S]*?)<\/small>/g)].map(label=>decode(label[1]));
    files.push({file,label:labels.join(' · ')});
  }
  return files.sort((a,b)=>a.file.localeCompare(b.file)||a.label.localeCompare(b.label));
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function run(){
  if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.pages))throw new Error('Invalid costume sprite upstream snapshot');
  const changed=[];
  for(let index=0;index<snapshot.pages.length;index++){
    const page=snapshot.pages[index];
    const response=await fetch(page.url,{headers:{'user-agent':'PoGo-Trades costume sprite freshness check (monthly, read-only; project contact in repository)'}});
    if(!response.ok)throw new Error(`Upstream check failed for ${page.url}: HTTP ${response.status}`);
    const actual=parseFiles(await response.text());
    const beforeNames=page.files.map(row=>row.file).sort(),afterNames=actual.map(row=>row.file).sort();
    const before=JSON.stringify(beforeNames),after=JSON.stringify(afterNames);
    if(before!==after){
      const oldNames=new Set(page.files.map(row=>row.file)),newNames=new Set(actual.map(row=>row.file));
      changed.push({dex:page.dex,species:page.species,url:page.url,added:actual.filter(row=>!oldNames.has(row.file)),removed:page.files.filter(row=>!newNames.has(row.file))});
    }
    if(index<snapshot.pages.length-1)await delay(250);
  }
  if(changed.length){
    process.stdout.write(`${JSON.stringify({status:'review-required',changed},null,2)}\n`);
    process.exitCode=1;
    return;
  }
  process.stdout.write(`${JSON.stringify({status:'current',pages:snapshot.pages.length,capturedAt:snapshot.capturedAt})}\n`);
}

run().catch(error=>{console.error(error.message);process.exitCode=1;});
