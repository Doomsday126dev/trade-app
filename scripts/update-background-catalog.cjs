#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {
  CATALOG_AS_OF,SEREBII_URL,POKEMINERS_REPOSITORY,POKEMINERS_PATH,
  parseSerebiiCatalog,normalizeRows,validateCatalog,detectUpstreamChanges,mappingReviewCandidates,buildSnapshot
}=require('./backgrounds/background-catalog-lib.cjs');

const ROOT=path.resolve(__dirname,'..');
const CATALOG_PATH=path.join(ROOT,'data','backgrounds.json');
const SNAPSHOT_PATH=path.join(ROOT,'data','background-upstream-snapshot.json');

function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);}
async function fetchText(url){const response=await fetch(url,{headers:{'user-agent':'trade-app-background-maintenance/1'}});if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return response.text();}
function ghJson(args){return JSON.parse(execFileSync('gh',['api',...args],{encoding:'utf8'}));}
function upstreamState(ref='master'){
  const commit=ghJson([`repos/${POKEMINERS_REPOSITORY}/commits/${ref}`]).sha;
  const rows=ghJson([`repos/${POKEMINERS_REPOSITORY}/contents/${POKEMINERS_PATH}?ref=${commit}`]);
  return buildSnapshot({commit,files:rows.filter(row=>row.type==='file'&&/^(?:lc|sb)_/i.test(row.name)).map(row=>row.name),retrievedAt:CATALOG_AS_OF});
}
async function refreshCatalog(){
  const existing=readJson(CATALOG_PATH,null),html=await fetchText(SEREBII_URL);
  const catalog=normalizeRows(parseSerebiiCatalog(html),{existingCatalog:existing,asOf:CATALOG_AS_OF,retrievedAt:CATALOG_AS_OF});
  const result=validateCatalog(catalog);if(!result.ok)throw new Error(result.errors.join('\n'));
  writeJson(CATALOG_PATH,catalog);
  console.log(JSON.stringify({updated:CATALOG_PATH,total:result.total,released:result.released,candidates:result.candidates,digest:result.digest,mappingReview:mappingReviewCandidates(catalog)},null,2));
}
function checkUpstream(){
  const snapshot=readJson(SNAPSHOT_PATH);if(!snapshot)throw new Error('Missing accepted upstream snapshot');
  const catalog=readJson(CATALOG_PATH);if(!catalog)throw new Error('Missing canonical background catalog');
  const current=upstreamState(),changes=detectUpstreamChanges(snapshot,current.files);
  console.log(JSON.stringify({acceptedCommit:snapshot.sourceCommit,currentCommit:current.sourceCommit,...changes,mappingReview:mappingReviewCandidates(catalog)},null,2));
  if(changes.added.length||changes.removed.length)process.exitCode=2;
}
function acceptSnapshot(){const snapshot=upstreamState();writeJson(SNAPSHOT_PATH,snapshot);console.log(JSON.stringify({updated:SNAPSHOT_PATH,sourceCommit:snapshot.sourceCommit,files:snapshot.files.length},null,2));}

async function main(){
  const mode=process.argv[2];
  if(mode==='--refresh-catalog')return refreshCatalog();
  if(mode==='--check-upstream')return checkUpstream();
  if(mode==='--accept-upstream-snapshot')return acceptSnapshot();
  throw new Error('Use --refresh-catalog, --check-upstream, or --accept-upstream-snapshot');
}
main().catch(error=>{console.error(error.message);process.exit(1);});
