#!/usr/bin/env node
'use strict';
// Read-only discovery. Announcement != release authorization, and no assets or
// catalog records are imported by this job. Reviewed snapshots are manual inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalogue=require('./reconcile-catalogue.cjs');
const {observeInventories}=require('./catalogue-source-observation.cjs');
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
 const output={news:[],season:null,observations:[]};
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
  const html=await response.text();output.observations.push({url:source.url,status:response.status,observedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(html).digest('hex')});if(html.length>3000000)throw Error('Source exceeded bounded response size');
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
 const offline=process.argv.includes('--offline'),now=new Date();
 const holds=readHolds(JSON.parse(fs.readFileSync(path.join(root,'data/recent-release-review-holds.json'),'utf8')));
 let official={findings:holds.map(row=>({kind:'known-release-review-hold',...row})),observation:null};const officialIssues=[];
 if(!offline){try{const observation=await observe(snapshot);official={observation,findings:compareDiscovery(snapshot,observation,loadCatalog(),now,holds)};}catch(error){officialIssues.push({source:'official-go-announcements',kind:'live-source-failed',error:error.message});}}
 const sources=offline?catalogue.loadSources(now):await observeInventories(catalogue.loadSources(now),{now});
 sources.issues.push(...officialIssues);
 const report=catalogue.build(now,sources);report.queue.push(...sources.removed||[],...sources.assetChanges||[]);
 for(const finding of official.findings)report.queue.push({id:'announcement:'+(finding.url||finding.name||finding.kind),source:'official-go',sourceUrl:finding.url||finding.source||snapshot.season.url,discoveredAt:now.toISOString(),releaseState:finding.releaseStatus||'uncertain',artState:finding.artState||'needs-review',priority:'urgent',disposition:'announcement-review-required',...(finding.name?{name:finding.name}:{}),finding});
 for(const source of sources.discoveries||[])for(const url of source.links){
  const reviewed=snapshot.supplementalNews?.find(row=>row.url===source.sourceUrl);
  if(!reviewed?.links?.includes(url))report.queue.push({id:'news:'+url,source:source.sourceUrl,sourceUrl:url,discoveredAt:now.toISOString(),releaseState:'uncertain',artState:'needs-review',priority:'urgent',disposition:'news-or-event-review-required'});
 }
 const reviewPath=path.join(root,'data/catalogue-sources/identity-reviews.json');if(fs.existsSync(reviewPath))report.reviewSummary=catalogue.summarizeReview(report,JSON.parse(fs.readFileSync(reviewPath,'utf8')));
 report.queue.sort((a,b)=>a.id.localeCompare(b.id));report.status=report.sourceIssues.length?'source-failure':report.queue.length?'review-required':'reconciled';
 report.sourceStatus=[...sources.manifest.sources,...sources.manifest.secondarySources||[]].map(({id,observedAt,sourceUpdatedAt,commit,observedCommit,reviewedCommit,scope})=>({id,observedAt:observedAt||null,sourceUpdatedAt:sourceUpdatedAt||null,commit:observedCommit||commit||reviewedCommit||null,...(scope?{qualification:scope}:{})}));
 report.mode=offline?'offline-integrity-only':'live-source';report.observations=[...official.observation?.observations||[],...sources.observations||[]];
 report.sourceLimits=['PoGoAPI released/Shiny endpoints previously returned 403 and remain excluded; no retry or alternate route.','PokeMiners has a bounded head-change watch; its existing files are not thereby fully reconciled or approved.', 'Official English/Korean news and current season; Leek Duck event index and GO Hub feed; Serebii GO species/forms/Shiny/Max inventories; Pokemod mined icon tree. Not every website, locale, old article edit, or unmined asset.','Uncertain identities, optional gender and missing art remain open; a reviewed future/excluded disposition cannot close missing artwork.'];
 const actionRegister=path.join(root,'data/catalogue-sources/review-crosswalk.json');
 const actionReview=require('./catalogue-review-summary.cjs');
 if(fs.existsSync(actionRegister))report.actionSummary=actionReview.summarize(report,JSON.parse(fs.readFileSync(actionRegister,'utf8')),actionReview.loadContext(root));
 const ownerSummary=report.actionSummary?actionReview.markdown(report.actionSummary):report.reviewSummary?'\n\nLegacy review-register minimum (not a current catalogue completeness count): **'+report.reviewSummary.actionableMissing.length+'**. Known alias rows: '+report.reviewSummary.knownAliasRows+'. All '+report.reviewSummary.rawRows+' raw rows remain retained.\n\n'+report.reviewSummary.actionableMissing.map(r=>'- '+r.name+': '+r.releaseState+'; '+r.artState).join('\n')+'\n\n':'';
 const summary='## Catalogue and release reconciliation\n\nStatus: **'+report.status+'** ('+report.mode+'). **'+report.queue.length+' retained source/review leads; these are not a count of missing Pokémon or a complete-coverage result.**\n\n'+Object.entries(report.coverage).map(([id,row])=>'- '+id+': '+JSON.stringify(row)).join('\n')+'\n\n'+report.sourceLimits.map(s=>'- '+s).join('\n')+'\n\nSource observations (fetch time is not sprite publication time):\n'+report.sourceStatus.map(row=>'- '+row.id+': observed '+(row.observedAt||'not checked in this offline run')+'; source updated '+(row.sourceUpdatedAt||'not supplied')+(row.commit?'; commit '+row.commit:'')+(row.qualification?'; '+row.qualification:'')).join('\n')+ownerSummary+'\n\nSee catalogue-reconciliation.json for the deterministic queue, provenance, release/art states and explicit dispositions. Source failures: '+report.sourceIssues.length+'.\n';
 fs.writeFileSync(path.join(root,'catalogue-reconciliation.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(root,'release-discovery.json'),JSON.stringify({status:report.status,findings:official.findings,sourceIssues:report.sourceIssues,observations:report.observations},null,2)+'\n');
 fs.writeFileSync(path.join(root,'release-discovery.md'),summary);console.log(summary);
 if(report.status==='source-failure'||report.status!=='reconciled'&&!process.argv.includes('--report-only')){if(process.env.GITHUB_ACTIONS==='true')console.error(actionReview.annotation(report));process.exitCode=1;}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseNews,parseSeason,compareDiscovery,observe,readHolds};
