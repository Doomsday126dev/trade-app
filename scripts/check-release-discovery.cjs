#!/usr/bin/env node
'use strict';
// Read-only discovery. Announcement != release authorization, and no assets or
// catalog records are imported by this job. Reviewed snapshots are manual inputs.
const fs=require('node:fs'),path=require('node:path');
const {loadCatalog}=require('./check-released-catalog.cjs');
const root=path.resolve(__dirname,'..');
function parseNews(html,url){
 const found=[];
 for(const match of html.matchAll(/href=["']([^"']+)["']/g)){
  const parsed=new URL(match[1],url);
  if(parsed.origin==='https://pokemongo.com'&&/^\/(?:[a-z]{2}\/)?news\/[a-z0-9-]+$/.test(parsed.pathname))found.push(parsed.origin+parsed.pathname);
 }
 const links=[...new Set(found)].sort();
 if(links.length<5||links.length>200)throw Error('News index schema/count changed; release coverage is unknown');
 return links;
}
function parseSeason(html){
 if(!html.includes('Max Pokémon Debuts'))throw Error('Season Max section missing; coverage is unknown');
 const cards=[...html.matchAll(/>\s*(Dynamax|Gigantamax) ([A-Za-zé’' -]{2,50})\s*</g)]
  .map(m=>({type:m[1]==='Dynamax'?'dynamax':'gmax',name:m[2].trim()}));
 const entries=[...new Map(cards.map(row=>[row.type+':'+row.name,row])).values()];
 if(!entries.length||entries.length>100)throw Error('No bounded Max cards parsed; coverage is unknown');
 return entries;
}
function compareDiscovery(snapshot,observed,database,now=new Date(),holds=[]){
 const findings=holds.map(row=>({kind:'known-release-review-hold',...row}));
 if(snapshot.schemaVersion!==1||snapshot.news?.length!==2||!snapshot.season?.entries?.length)throw Error('Invalid discovery snapshot');
 const age=(now-Date.parse(snapshot.observedAt))/86400000;
 if(!Number.isFinite(age)||age<0||age>7)findings.push({kind:'discovery-review-stale',observedAt:snapshot.observedAt,action:'Review current announcements and reconcile the bounded inventory; do not automatically accept the snapshot.'});
 for(const before of snapshot.news){
  const current=observed.news.find(n=>n.url===before.url);if(!current)throw Error('News source observation missing');
  if(current.links.length<before.links.length/2)throw Error('News index unexpectedly contracted; coverage is unknown');
  for(const url of current.links.filter(url=>!before.links.includes(url)))findings.push({kind:'new-announcement-needs-review',url,releaseStatus:'unknown',action:'Check costume, form, Max and Shiny changes, actual debut date/time and catalog eligibility. Future announcements must not be imported early.'});
 }
 for(const entry of observed.season.entries){
  const found=(database[entry.type]||[]).some(row=>row.name===(entry.type==='gmax'?entry.name+' (Gigantamax)':entry.name));
  if(!found)findings.push({kind:'announced-max-missing-catalog',...entry,source:observed.season.url,releaseStatus:'unknown',action:'Verify encounter/evolution eligibility and debut date. Record released gaps or future holds explicitly; never infer release from an announcement alone.'});
 }
 return findings;
}
async function observe(snapshot,fetchImpl=fetch){
 const output={news:[],season:null};
 for(const source of [...snapshot.news,snapshot.season]){
  const options={signal:AbortSignal.timeout(15000),redirect:'manual',headers:{'user-agent':'PoGo-Trades read-only release discovery'}};
  let response;
  try{
    response=await fetchImpl(source.url,options);
    if([301,302,307,308].includes(response.status)){
      const next=new URL(response.headers.get('location')||'',source.url);
      if(source!==snapshot.season||next.origin!=='https://pokemongo.com'||!/^\/seasons\/[a-z0-9-]+$/.test(next.pathname)||next.search||next.hash)throw Error('Unreviewed source redirect');
      response=await fetchImpl(next.href,{...options,signal:AbortSignal.timeout(15000)});
    }
  }catch(error){throw Error(`${source.url}: ${error.message}${error.cause?.code?' ('+error.cause.code+')':''}; coverage is unknown`);}
  if(!response.ok)throw Error(`${source.url}: HTTP ${response.status}; coverage is unknown`);
  if(!/text\/html/i.test(response.headers.get('content-type')||''))throw Error(`${source.url}: unexpected content type`);
  const html=await response.text();if(html.length>3000000)throw Error('Source exceeded bounded response size');
  if(source===snapshot.season)output.season={url:source.url,entries:parseSeason(html)};
  else output.news.push({url:source.url,links:parseNews(html,source.url)});
 }
 return output;
}
function readHolds(document){
 if(document.schemaVersion!==1||!Array.isArray(document.entries))throw Error('Invalid release-review holds; coverage is unknown');
 const ids=new Set();
 for(const row of document.entries){
  if(!row.id||ids.has(row.id)||!row.name||!row.releaseStatus||!row.action||!/^https:\/\//.test(row.source||''))throw Error('Incomplete release-review hold; coverage is unknown');
  ids.add(row.id);
 }
 return document.entries;
}
async function main(){
 const snapshot=JSON.parse(fs.readFileSync(path.join(root,'data/release-discovery-snapshot.json'),'utf8'));
 let report;
 try{const observation=await observe(snapshot);const findings=compareDiscovery(snapshot,observation,loadCatalog(),new Date(),readHolds(JSON.parse(fs.readFileSync(path.join(root,'data/recent-release-review-holds.json'),'utf8'))));report={status:findings.length?'review-required':'no-new-discovery',findings,observation};}
 catch(error){report={status:'source-check-failed',error:error.message};}
 report.coverage='English and Korean official news index additions, current official season Max cards, seven-day manual-review expiry. Not a complete worldwide release feed. Does not detect every edit to existing articles, older articles falling outside indexes, or other locale-only announcements. Release dates, evolutions and exact art require human verification.';
 fs.writeFileSync(path.join(root,'release-discovery.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(root,'release-discovery.md'),'## Release discovery\n\nStatus: **'+report.status+'**\n\n'+report.coverage+'\n\n```json\n'+JSON.stringify(report,null,2).replace(/`/g,'\\u0060').replace(/</g,'\\u003c')+'\n```\n');
 console.log(JSON.stringify(report,null,2));if(report.status!=='no-new-discovery')process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseNews,parseSeason,compareDiscovery,observe,readHolds};
