#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {validateCatalog,normalizeLookupKey,stableJson}=require('./sprites/costume-sprite-catalog-lib.cjs');
const root=path.resolve(__dirname,'..');
const IMAGE_PREFIX='https://img.pokemondb.net/sprites/go/normal/1x/';
const PAGE_PATTERN=/^https:\/\/pokemondb\.net\/sprites\/[a-z0-9-]+$/;

function decode(value){
  return String(value||'').replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'")
    .replace(/&quot;/g,'"').replace(/&eacute;/g,'\u00e9').replace(/&nbsp;/g,' ')
    .replace(/<[^>]+>/g,'').trim();
}
function parseFiles(html){
  const files=[];
  for(const match of html.matchAll(/<span class="sprites-table-card">([\s\S]*?)<\/span>/g)){
    const card=match[1];
    const file=card.match(/src="https:\/\/img\.pokemondb\.net\/sprites\/go\/normal\/1x\/([a-z0-9-]+\.png)"/)?.[1];
    if(!file)continue;
    const labels=[...card.matchAll(/<small[^>]*>([\s\S]*?)<\/small>/g)].map(label=>decode(label[1]));
    // Unadorned base sprites use img alt text instead of a small caption.
    if(!labels.length){
      const alt=card.match(/alt="([^"<>]+) sprite from GO"/)?.[1];
      if(!alt)throw new Error(`Missing source label: ${file}`);
      labels.push(decode(alt));
    }
    files.push({file,label:labels.join(' \u00b7 ')});
  }
  if(!files.length)throw new Error('No GO sprite cards parsed; source layout or response needs review');
  if(new Set(files.map(row=>row.file)).size!==files.length)throw new Error('Duplicate GO sprite filenames');
  return files.sort((a,b)=>a.file.localeCompare(b.file)||a.label.localeCompare(b.label));
}
function validateSnapshot(snapshot){
  if(snapshot?.schemaVersion!==1||!snapshot.pages?.length)throw new Error('Invalid upstream snapshot');
  const seen=new Set();
  for(const page of snapshot.pages){
    if(!Number.isInteger(page.dex)||page.dex<=0||!PAGE_PATTERN.test(page.url)||seen.has(page.dex)||!page.files?.length)throw new Error(`Invalid/duplicate source page: ${page.url}`);
    seen.add(page.dex);
    const files=new Set();
    for(const row of page.files){
      if(!/^[a-z0-9-]+\.png$/.test(row.file)||!row.label||files.has(row.file))throw new Error(`Invalid/duplicate source file: ${row.file}`);
      files.add(row.file);
    }
  }
}
function comparePages(before,after){
  const changed=[];
  for(const page of before.filter(row=>!after.some(current=>current.dex===row.dex)))changed.push({dex:page.dex,url:page.url,added:[],removed:page.files,relabeled:[]});
  for(const page of after){
    const previous=before.find(row=>row.dex===page.dex);
    const old=new Map((previous?.files||[]).map(row=>[row.file,row.label]));
    const current=new Map(page.files.map(row=>[row.file,row.label]));
    const added=page.files.filter(row=>!old.has(row.file));
    const removed=(previous?.files||[]).filter(row=>!current.has(row.file));
    const relabeled=page.files.filter(row=>old.has(row.file)&&old.get(row.file)!==row.label).map(row=>({...row,previousLabel:old.get(row.file)}));
    if(added.length||removed.length||relabeled.length)changed.push({dex:page.dex,url:page.url,added,removed,relabeled});
  }
  return changed;
}
function ageDays(value,now){
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp)||timestamp>now.getTime())throw new Error(`Invalid/future review date: ${value}`);
  return Math.floor((now-timestamp)/86400000);
}
function candidateMatches(entry,files){
  return files.filter(row=>entry.searchTerms.some(terms=>terms.every(term=>normalizeLookupKey(`${row.file} ${row.label}`).includes(normalizeLookupKey(term)))));
}
function buildReport({catalog,pending,releases,snapshot,observed=snapshot,now=new Date(),assetRoot,online=false}){
  validateSnapshot(snapshot);
  validateSnapshot(observed);
  if(pending?.schemaVersion!==1||releases?.schemaVersion!==1||!Array.isArray(pending.entries)||!Array.isArray(releases.entries))throw new Error('Invalid review registers');
  const problems=[];
  try{validateCatalog(catalog,assetRoot);}catch(error){problems.push({kind:'local-integrity',message:error.message});}
  const staleReviews=[];
  const checkAge=(scope,date,maxDays)=>{const days=ageDays(date,now);if(days>maxDays)staleReviews.push({scope,date,ageDays:days,maxDays});};
  checkAge('accepted-source snapshot',snapshot.capturedAt,14);
  checkAge('release discovery review',releases.lastReviewedDate,7);
  checkAge('pending inventory',pending.lastReviewedDate,14);
  const findEntry=(name,dex)=>catalog.entries.find(row=>row.no===dex&&row.names.some(alias=>normalizeLookupKey(alias)===normalizeLookupKey(name)));
  const pendingIds=new Set();
  const candidates=[];
  for(const entry of pending.entries){
    if(!entry.canonicalCostumeId||pendingIds.has(entry.canonicalCostumeId)||!entry.searchTerms?.length||entry.searchTerms.some(terms=>!Array.isArray(terms)||!terms.length||terms.some(term=>typeof term!=='string'||!term.trim())))throw new Error(`Invalid pending identity/search terms: ${entry.displayIdentity}`);
    pendingIds.add(entry.canonicalCostumeId);
    checkAge(entry.displayIdentity,entry.lastReviewedDate,14);
    const record=findEntry(entry.displayIdentity,entry.species.dex);
    if(!record||record.status!=='unavailable')problems.push({kind:'pending-catalog-drift',identity:entry.displayIdentity});
    if(!entry.candidate?.reason||!entry.nextReviewAction)problems.push({kind:'missing-blocker',identity:entry.displayIdentity});
    const page=observed.pages.find(row=>row.dex===entry.species.dex);
    if(!page)problems.push({kind:'missing-source-page',identity:entry.displayIdentity,dex:entry.species.dex});
    const matches=candidateMatches(entry,page?.files||[]);
    const reviewed=new Set(entry.reviewedCandidateFiles||[]);
    candidates.push({identity:entry.displayIdentity,canonicalCostumeId:entry.canonicalCostumeId,url:page?.url,blocker:entry.candidate.reason,matches,unreviewed:matches.filter(row=>!reviewed.has(row.file))});
  }
  for(const record of catalog.entries){
    if(record.status==='unavailable'&&!pending.entries.some(entry=>findEntry(entry.displayIdentity,entry.species.dex)===record))problems.push({kind:'untracked-unavailable',identity:record.names[0]});
    if(record.status!=='exact')continue;
    const page=snapshot.pages.find(row=>row.url===record.sourcePage&&row.dex===record.no);
    if(!page||!page.files.some(row=>row.file===record.sourceFile)||record.sourceUrl!==IMAGE_PREFIX+record.sourceFile||path.posix.basename(record.assets?.default||'')!==record.sourceFile)problems.push({kind:'source-provenance',identity:record.names[0]});
    for(const asset of Object.values(record.assets||{})){
      if(!page?.files.some(row=>row.file===path.posix.basename(asset)))problems.push({kind:'asset-source-mapping',identity:record.names[0],asset});
    }
  }
  const releaseIds=new Set();
  const missingIdentities=[],upcomingIdentities=[];
  for(const release of releases.entries){
    if(!release.id||releaseIds.has(release.id)||!Number.isInteger(release.dex)||!release.catalogName||!/^https:\/\/(?:pokemongo\.com|www\.pokemon\.com)\//.test(release.evidenceUrl)||!Number.isFinite(Date.parse(release.releaseDate)))throw new Error(`Invalid release evidence: ${release.id}`);
    releaseIds.add(release.id);
    if(!findEntry(release.catalogName,release.dex)){
      if(Date.parse(release.releaseDate)<=now.getTime())missingIdentities.push(release);
      else upcomingIdentities.push(release);
    }
  }
  const changed=comparePages(snapshot.pages,observed.pages);
  const needsReview=problems.length||staleReviews.length||missingIdentities.length||changed.length||candidates.some(row=>row.unreviewed.length);
  return {status:needsReview?'review-required':online?'no-new-findings':'offline-check-passed',checkedAt:now.toISOString(),mode:online?'live-source':'offline',counts:{canonical:catalog.entries.length,exact:catalog.entries.filter(row=>row.status==='exact').length,unsupported:catalog.entries.filter(row=>row.status==='unavailable').length},coverage:{pages:observed.pages.length,releaseEvidenceEntries:releases.entries.length,releaseDiscovery:'Semi-automated: manually reviewed official announcements, not an exhaustive release feed',snapshotCapturedAt:snapshot.capturedAt},problems,missingIdentities,upcomingIdentities,staleReviews,changed,candidates};
}
async function observe(snapshot,{fetchImpl=fetch,delayMs=250,timeoutMs=10000,deadlineMs=600000}={}){
  validateSnapshot(snapshot);
  const pages=[],errors=[];
  const deadline=Date.now()+deadlineMs;
  for(const page of snapshot.pages){
    if(Date.now()>=deadline){errors.push({url:page.url,error:'Overall source-check deadline exceeded'});break;}
    try{
      const response=await fetchImpl(page.url,{redirect:'error',signal:AbortSignal.timeout(Math.min(timeoutMs,Math.max(1,deadline-Date.now()))),headers:{'user-agent':'PoGo-Trades weekly read-only costume review'}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      pages.push({...page,files:parseFiles(await response.text())});
    }catch(error){errors.push({url:page.url,error:error.message});}
    if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
  }
  return {snapshot:{...snapshot,capturedAt:new Date().toISOString(),pages},errors};
}
async function main(args=process.argv.slice(2)){
  const allowed=new Set(['--offline','--report','--capture','--summary']);
  const options={};
  for(let i=0;i<args.length;i++){
    if(!allowed.has(args[i]))throw new Error(`Unknown argument: ${args[i]}`);
    const key=args[i];options[key]=key==='--offline'?true:args[++i];
    if(!options[key]||String(options[key]).startsWith('--'))throw new Error(`Missing value: ${key}`);
  }
  if(options['--offline']&&options['--capture'])throw new Error('--capture requires a complete live observation');
  const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
  const snapshot=read('costume-sprite-upstream-snapshot.json');
  const inputs={catalog:read('costume-sprite-catalog.json'),pending:read('pending-costume-artwork.json'),releases:read('costume-release-evidence.json'),snapshot,assetRoot:root};
  const baseline=buildReport(inputs);
  let report=baseline;
  if(!options['--offline']){
    const result=await observe(snapshot);
    if(result.errors.length)report={...baseline,status:'source-check-failed',mode:'live-source',sourceErrors:result.errors,completedPages:result.snapshot.pages.length};
    else{
      report=buildReport({...inputs,observed:result.snapshot,online:true});
      if(options['--capture']){
        const target=path.resolve(options['--capture']);
        if(target===path.join(root,'data/costume-sprite-upstream-snapshot.json'))throw new Error('Capture to a candidate file; never overwrite the reviewed baseline automatically');
        fs.writeFileSync(target,stableJson(result.snapshot));
      }
    }
  }
  if(options['--report'])fs.writeFileSync(options['--report'],stableJson(report));
  if(options['--summary'])fs.writeFileSync(options['--summary'],renderSummary(report));
  process.stdout.write(stableJson(report));
  if(!['no-new-findings','offline-check-passed'].includes(report.status))process.exitCode=1;
}
function renderSummary(report){
  const safe=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/`/g,'&#96;').replace(/[\r\n]/g,' ');
  const lines=['## Costume Freshness',`Status: **${safe(report.status)}** (${safe(report.mode)})`,`${report.counts.exact} exact; ${report.counts.unsupported} unsupported. No automatic asset import.`,
    `Coverage: ${report.coverage.pages} source pages; ${report.coverage.releaseEvidenceEntries} manually reviewed announcement identities. Not an exhaustive release feed.`,
    `Findings: ${report.problems.length} integrity/register problems; ${report.missingIdentities.length} released missing identities; ${report.upcomingIdentities.length} upcoming identities; ${report.staleReviews.length} stale reviews; ${report.changed.length} changed source pages.`,
    '', '| Unsupported Identity | Candidate Files | Blocker |','| --- | --- | --- |'];
  for(const row of report.candidates)lines.push(`| ${safe(row.identity)} | ${row.matches.length} (${row.unreviewed.length} unreviewed) | ${safe(row.blocker)} |`);
  const findings={problems:report.problems,missingIdentities:report.missingIdentities,upcomingIdentities:report.upcomingIdentities,staleReviews:report.staleReviews,changed:report.changed,unreviewedCandidates:report.candidates.filter(row=>row.unreviewed.length),sourceErrors:report.sourceErrors||[]};
  lines.push('','### Actionable Details','', '```json',JSON.stringify(findings,null,2).replace(/`/g,'\\u0060').replace(/</g,'\\u003c'), '```','');
  return lines.join('\n');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={parseFiles,validateSnapshot,comparePages,ageDays,candidateMatches,buildReport,observe,renderSummary};
