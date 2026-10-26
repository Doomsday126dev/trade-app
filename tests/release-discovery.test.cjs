const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseNews,parseSeason,compareDiscovery,observe}=require('../scripts/check-release-discovery.cjs');
const baseline=require('../data/release-discovery-snapshot.json');
const {loadCatalog}=require('../scripts/check-released-catalog.cjs');
const now=new Date('2026-10-26T12:00:00Z');
test('discovery finds a newly announced identity never named in the reviewed catalog or release expectations',()=>{
 const observed=structuredClone(baseline);observed.season.entries.push({type:'dynamax',name:'Previously Unknown Species'});
 observed.news[0].links.push('https://pokemongo.com/news/new-costume-next-event');
 const report=compareDiscovery(baseline,observed,loadCatalog(),now);
 assert.ok(report.some(x=>x.kind==='announced-max-missing-catalog'&&x.name==='Previously Unknown Species'&&x.releaseStatus==='unknown'));
 assert.ok(report.some(x=>x.kind==='new-announcement-needs-review'&&x.releaseStatus==='unknown'));
});
test('season parsing extracts newly published cards independently of production inventory',()=>{
 assert.deepEqual(parseSeason('Max Pokémon Debuts<div>Dynamax New Species</div><p>Generic Dynamax Pokémon</p>'),[{type:'dynamax',name:'New Species'}]);
 for(const html of ['', '<div>Layout changed</div>','Max Pokémon Debuts'])assert.throws(()=>parseSeason(html),/unknown/);
});
test('news zero results, foreign links and layout changes cannot pass silently',()=>{
 assert.throws(()=>parseNews('<html>Captcha</html>','https://pokemongo.com/news'),/unknown/);
 const html=Array.from({length:5},(_,i)=>`<a href="/news/event-${i}">Event</a>`).join('')+'<a href="https://evil.example/news/fake">Fake</a>';
 assert.equal(parseNews(html,'https://pokemongo.com/news').length,5);
});
test('fetch failure or wrong content type reports unknown, never a successful empty observation',async()=>{
 await assert.rejects(()=>observe(baseline,async()=>({ok:false,status:403})),/HTTP 403.*unknown/);
 await assert.rejects(()=>observe(baseline,async()=>({ok:true,headers:{get:()=> 'application/json'}})),/content type/);
});
test('stale reviewed discovery and missing observed sources demand attention',()=>{
 assert.ok(compareDiscovery(baseline,baseline,loadCatalog(),new Date('2026-11-04')).some(f=>f.kind==='discovery-review-stale'));
 assert.throws(()=>compareDiscovery(baseline,{news:[],season:baseline.season},loadCatalog(),now),/missing/);
});

test('partial source outage is not accepted as a complete observation',async()=>{
 let calls=0;const html=Array.from({length:5},(_,i)=>`<a href="/news/event-${i}">Event</a>`).join('');
 await assert.rejects(()=>observe(baseline,async()=>++calls===1?{ok:true,headers:{get:()=> 'text/html'},text:async()=>html}:{ok:false,status:503}),/HTTP 503/);
 assert.equal(calls,2);
});
test('only one reviewed same-origin season redirect is followed',async()=>{
 let calls=0;const html=Array.from({length:5},(_,i)=>`<a href="/news/event-${i}">Event</a>`).join('');
 const result=await observe(baseline,async(url)=>{calls++;if(url.endsWith('/news'))return{ok:true,headers:{get:()=> 'text/html'},text:async()=>html};if(url.endsWith('/seasons'))return{status:302,headers:{get:()=>'/seasons/next-season'}};return{ok:true,headers:{get:()=> 'text/html'},text:async()=> 'Max Pokémon Debuts<div>Dynamax Future Species</div>'};});
 assert.equal(calls,4);assert.equal(result.season.entries[0].name,'Future Species');
 await assert.rejects(()=>observe(baseline,async()=>({status:302,headers:{get:()=> 'https://other.example/news'}})),/Unreviewed/);
});

test('known unresolved recent releases stay actionable even when no new announcement arrives',()=>{
 const holds=require('../data/recent-release-review-holds.json').entries;
 const findings=compareDiscovery(baseline,baseline,loadCatalog(),now,holds);
 assert.equal(findings.filter(row=>row.kind==='known-release-review-hold').length,2);
 for(const hold of holds)assert.ok(findings.some(row=>row.id===hold.id&&row.source&&row.action));
});

test('malformed review-hold input cannot silently erase unresolved gaps',()=>{
 const {readHolds}=require('../scripts/check-release-discovery.cjs');
 for(const value of [{},{schemaVersion:1},{schemaVersion:1,entries:[{}]}])assert.throws(()=>readHolds(value),/unknown/);
});
