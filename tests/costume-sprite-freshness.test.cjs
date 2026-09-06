'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {parseFiles,validateSnapshot,comparePages,ageDays,buildReport,observe,renderSummary}=require('../scripts/check-costume-sprite-freshness.cjs');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
function inputs(){
  const data={catalog:read('costume-sprite-catalog.json'),pending:read('pending-costume-artwork.json'),releases:read('costume-release-evidence.json'),snapshot:read('costume-sprite-upstream-snapshot.json'),now:new Date('2026-09-06T23:59:59Z'),assetRoot:root};
  // Freeze fixture review dates so routine real-world review updates do not age tests.
  data.snapshot.capturedAt='2026-09-06T00:00:00Z';data.pending.lastReviewedDate='2026-09-06';data.releases.lastReviewedDate='2026-09-06';
  for(const entry of data.pending.entries)entry.lastReviewedDate='2026-09-06';
  return data;
}
function card(file='pikachu.png',label='Male'){return `<span class="sprites-table-card"><img src="https://img.pokemondb.net/sprites/go/normal/1x/${file}"><small>${label}</small></span>`;}
function onePage(){return {schemaVersion:1,capturedAt:'2026-09-06T00:00:00Z',pages:[{dex:25,species:'Pikachu',url:'https://pokemondb.net/sprites/pikachu',files:[{file:'pikachu.png',label:'Male'}]}]};}

test('offline report verifies the production inventory without claiming live freshness',()=>{
  const report=buildReport(inputs());
  assert.equal(report.status,'offline-check-passed');
  assert.deepEqual(report.counts,{canonical:376,exact:355,unsupported:21});
  assert.equal(report.candidates.length,21);
  assert.equal(report.coverage.releaseEvidenceEntries,13);
  assert.equal(report.upcomingIdentities.length,4);
  assert.match(report.coverage.releaseDiscovery,/manually reviewed/);
  assert.equal(buildReport({...inputs(),online:true}).status,'no-new-findings');
});
test('parser handles source labels, gender and entities without accepting other image hosts',()=>{
  assert.deepEqual(parseFiles(card('pikachu-world-champs-2026.png','Worlds &amp; Friends')+card('pikachu-f.png','Female')), [{file:'pikachu-f.png',label:'Female'},{file:'pikachu-world-champs-2026.png',label:'Worlds & Friends'}]);
  assert.throws(()=>parseFiles(card().replace('img.pokemondb.net','example.com')),/No GO sprite cards/);
  assert.throws(()=>parseFiles('<html>Temporary challenge</html>'),/No GO sprite cards/);
  assert.throws(()=>parseFiles(card()+card()),/Duplicate/);
  assert.throws(()=>parseFiles(card().replace('<small>Male</small>','')),/Missing source label/);
  assert.deepEqual(parseFiles('<span class="sprites-table-card"><a class="sprite-share-link"><img src="https://img.pokemondb.net/sprites/go/normal/1x/teddiursa.png" alt="Teddiursa sprite from GO" loading="lazy"></a></span>'),[{file:'teddiursa.png',label:'Teddiursa'}]);
});
test('inventory diff includes additions, removals, relabels and removed species pages',()=>{
  const before=onePage().pages;
  const after=structuredClone(before);
  after[0].files[0].label='Changed';after[0].files.push({file:'pikachu-new.png',label:'New'});
  const delta=comparePages(before,after)[0];
  assert.equal(delta.added[0].file,'pikachu-new.png');assert.equal(delta.relabeled[0].previousLabel,'Male');
  assert.equal(comparePages(after,before)[0].removed[0].file,'pikachu-new.png');
  assert.equal(comparePages(before,[])[0].removed[0].file,'pikachu.png');
});
test('new source Worlds artwork is linked to the pending identity but never promoted',()=>{
  const data=inputs();const original=JSON.stringify(data.catalog);
  const observed=structuredClone(data.snapshot);
  observed.pages.find(page=>page.dex===25).files.push({file:'pikachu-world-champs-2026.png',label:'World Championships 2026'});
  const report=buildReport({...data,observed,online:true});
  const candidate=report.candidates.find(row=>row.identity==='Pikachu (Worlds 2026)');
  assert.equal(candidate.unreviewed[0].file,'pikachu-world-champs-2026.png');
  assert.equal(report.status,'review-required');assert.equal(report.changed.length,1);
  assert.equal(JSON.stringify(data.catalog),original);
});
test('unrecognized new filename still flags its source page even without alias matches',()=>{
  const data=inputs();const observed=structuredClone(data.snapshot);
  observed.pages[0].files.push({file:'bulbasaur-new-costume.png',label:'Unrecognized event'});
  assert.equal(buildReport({...data,observed}).changed.length,1);
});
test('already present candidate files are found even without an upstream delta',()=>{
  const data=inputs();const row=data.pending.entries.find(entry=>entry.displayIdentity==='Slakoth (Night Cap)');
  row.reviewedCandidateFiles=[];
  const report=buildReport(data);
  assert.equal(report.changed.length,0);assert.equal(report.status,'review-required');
  assert.equal(report.candidates.find(entry=>entry.identity===row.displayIdentity).unreviewed[0].file,'slakoth-visor.png');
});
test('reviewed ambiguous candidates remain visible without repeated new-candidate alerts',()=>{
  const report=buildReport(inputs());
  const row=report.candidates.find(entry=>entry.identity==='Pikachu (GO Fest 2024)');
  assert.equal(row.matches.length,4);assert.equal(row.unreviewed.length,0);assert.match(row.blocker,/does not choose/);
});
test('newly released evidence identities missing from the catalog are flagged; future entries wait',()=>{
  const data=inputs();data.releases.entries.push({id:'review:new-costume',catalogName:'Pikachu (Fixture Costume)',dex:25,releaseDate:'2026-09-05',evidenceUrl:'https://pokemongo.com/news/fixture'});
  assert.equal(buildReport(data).missingIdentities[0].id,'review:new-costume');
  data.releases.entries.at(-1).releaseDate='2026-10-01';
  assert.equal(buildReport(data).missingIdentities.length,0);
});
test('announced September costumes become missing-identity findings on release day',()=>{
  const data=inputs();data.now=new Date('2026-09-17T00:00:00Z');
  const report=buildReport(data);
  assert.equal(report.upcomingIdentities.length,0);assert.equal(report.missingIdentities.length,4);
  assert.ok(report.missingIdentities.some(row=>row.catalogName==="Charmander (Friede's Goggles)"));
  assert.ok(report.missingIdentities.some(row=>row.catalogName==='Pikachu (PokeXciting Turquoise)'));
});
test('broken, tampered and wrong-source local asset mappings are reported',()=>{
  const missing=inputs();missing.catalog.entries[0].assets.default='assets/sprites/go/missing.png';
  assert.ok(buildReport(missing).problems.some(row=>row.kind==='local-integrity'&&/Missing/.test(row.message)));
  const digest=inputs();digest.catalog.entries[0].sha256.default='0'.repeat(64);
  assert.ok(buildReport(digest).problems.some(row=>row.kind==='local-integrity'&&/digest mismatch/.test(row.message)));
  const source=inputs();source.catalog.entries[0].sourceUrl='https://unapproved.invalid/a.png';
  assert.ok(buildReport(source).problems.some(row=>row.kind==='source-provenance'));
  const mapping=inputs();mapping.catalog.entries[0].sourceFile=mapping.catalog.entries[1].sourceFile;
  assert.ok(buildReport(mapping).problems.some(row=>row.kind==='source-provenance'));
});
test('untracked unavailable records and stale pending entries do not silently drift',()=>{
  const data=inputs();data.pending.entries.pop();
  assert.ok(buildReport(data).problems.some(row=>row.kind==='untracked-unavailable'));
  const promoted=inputs();promoted.pending.entries[0].displayIdentity=promoted.catalog.entries[0].names[0];
  assert.ok(buildReport(promoted).problems.some(row=>row.kind==='pending-catalog-drift'));
});
test('source snapshots, release-discovery reviews and per-identity reviews expire independently',()=>{
  const data=inputs();data.now=new Date('2026-10-01T00:00:00Z');
  const report=buildReport(data);
  assert.ok(report.staleReviews.some(row=>row.scope==='accepted-source snapshot'));
  assert.ok(report.staleReviews.some(row=>row.scope==='release discovery review'));
  assert.ok(report.staleReviews.some(row=>row.scope==='Pikachu (Worlds 2026)'));
  assert.equal(ageDays('2026-09-06',new Date('2026-09-13T00:00:00Z')),7);
  assert.throws(()=>ageDays('not-a-date',data.now),/Invalid/);
  assert.throws(()=>ageDays('2030-01-01',data.now),/future/);
});
test('malformed or unsafe review registers fail closed',()=>{
  const data=inputs();data.pending.entries[0].searchTerms=[[]];assert.throws(()=>buildReport(data),/Invalid pending/);
  const release=inputs();release.releases.entries[0].evidenceUrl='https://pokemongo.com.evil.invalid/a';assert.throws(()=>buildReport(release),/Invalid release/);
  const snapshot=onePage();snapshot.pages[0].url='https://example.com/pikachu';assert.throws(()=>validateSnapshot(snapshot),/Invalid/);
  const duplicate=onePage();duplicate.pages.push(duplicate.pages[0]);assert.throws(()=>validateSnapshot(duplicate),/duplicate/);
});
test('bounded observer fetches only approved pages, captures data, and does not mutate baseline',async()=>{
  const snapshot=onePage(),before=JSON.stringify(snapshot);
  const result=await observe(snapshot,{delayMs:0,fetchImpl:async(url,options)=>{
    assert.equal(url,snapshot.pages[0].url);assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    return {ok:true,text:async()=>card()};
  }});
  assert.equal(result.errors.length,0);assert.equal(result.snapshot.pages.length,1);assert.equal(JSON.stringify(snapshot),before);
});
test('observer records HTTP, parse and transport failures instead of declaring current',async()=>{
  for(const fetchImpl of [async()=>({ok:false,status:503}),async()=>({ok:true,text:async()=>'<html>challenge</html>'}),async()=>{throw new Error('network timeout');}]){
    const result=await observe(onePage(),{fetchImpl,delayMs:0});assert.equal(result.errors.length,1);assert.equal(result.snapshot.pages.length,0);
  }
  const deadline=await observe(onePage(),{deadlineMs:0,delayMs:0,fetchImpl:async()=>{throw new Error('must not fetch');}});
  assert.match(deadline.errors[0].error,/deadline/);
});
test('observer timeout covers the response body and continues to report failure',async()=>{
  const keepAlive=setTimeout(()=>{},1000);
  try{
    const result=await observe(onePage(),{timeoutMs:5,delayMs:0,fetchImpl:async(url,{signal})=>({ok:true,text:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})});
    assert.equal(result.errors.length,1);assert.equal(result.snapshot.pages.length,0);
  }finally{clearTimeout(keepAlive);}
});
test('summary contains all unsupported blockers and escapes source-controlled markup',()=>{
  const report=buildReport(inputs());report.candidates[0].blocker='<script>|`bad`';
  const summary=renderSummary(report);assert.match(summary,/Worlds 2026/);assert.match(summary,/&#124;/);assert.doesNotMatch(summary,/<script>/);
});
test('CLI rejects accidental baseline capture and unknown flags without fetching',()=>{
  for(const args of [['--offline','--capture','/tmp/should-not-write.json'],['--unknown'],['--summary']]){
    const result=spawnSync(process.execPath,['scripts/check-costume-sprite-freshness.cjs',...args],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);
  }
});
test('offline CLI writes an actionable report and does not rewrite review inputs',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'costume-freshness-'));
  try{
    const before=fs.readFileSync(path.join(root,'data/costume-sprite-upstream-snapshot.json'),'utf8');
    const reportPath=path.join(temp,'report.json'),summaryPath=path.join(temp,'summary.md');
    const result=spawnSync(process.execPath,['scripts/check-costume-sprite-freshness.cjs','--offline','--report',reportPath,'--summary',summaryPath],{cwd:root,encoding:'utf8'});
    assert.ok([0,1].includes(result.status));
    assert.equal(JSON.parse(fs.readFileSync(reportPath,'utf8')).mode,'offline');
    assert.match(fs.readFileSync(summaryPath,'utf8'),/Costume Freshness/);
    assert.equal(fs.readFileSync(path.join(root,'data/costume-sprite-upstream-snapshot.json'),'utf8'),before);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
