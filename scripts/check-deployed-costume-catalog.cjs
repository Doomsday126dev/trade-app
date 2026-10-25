'use strict';
const fs=require('node:fs'),path=require('node:path');
function compareCatalogs(local,live){
 const index=x=>new Map(x.entries.flatMap(e=>e.names.map(n=>[n,{status:e.status,identityStatus:e.identityStatus||'',assets:{default:e.assets?.default||e.defaultUrl||'',female:e.assets?.female||e.femaleUrl||''}}])));
 const a=index(local),b=index(live);return [...a].filter(([n,e])=>!b.has(n)||JSON.stringify(e)!==JSON.stringify(b.get(n))).map(([identity])=>identity);
}
function parseRuntime(source){const match=String(source).match(/const rows=(\[.*\]);\n/);if(!match)throw Error('Deployed sprite runtime format is unrecognized');return {entries:JSON.parse(match[1])};}
function reviewCandidate(catalog,releases,now=new Date()){
 const existing=new Set(catalog.entries.flatMap(e=>e.names));
 return releases.entries.filter(e=>e.lifecycleStatus==='released'&&Date.parse(e.releaseDate)<=now&&/^https:\/\/(?:pokemongo\.com|pokemongolive\.com|www\.pokemon\.com)\//.test(e.evidenceUrl)&&!existing.has(e.catalogName)).map(e=>({no:e.dex,names:[e.catalogName],status:'unavailable',identityStatus:'released',source:e.evidenceUrl,action:'Review identity and add to selectable catalog; exact artwork still required. No inferred asset URL.'}));
}
async function main(){
 const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-catalog.json'))),releases=JSON.parse(fs.readFileSync(path.join(root,'data/costume-release-evidence.json')));
 const result={checkedAt:new Date().toISOString(),candidate:reviewCandidate(catalog,releases),missingExact:catalog.entries.filter(e=>e.status==='unavailable').map(e=>e.names[0]),shinyCoverage:'Not certified: reviewed catalog contains no separate Shiny asset evidence. Do not substitute normal art.',deployment:null};
 if(!process.argv.includes('--candidate-only')){
  try{const response=await fetch('https://doomsday126dev.github.io/trade-app/js/domain/costumeSpriteCatalog.js',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!response.ok)throw Error('Deployed catalog HTTP '+response.status);result.deployment={differentIdentities:compareCatalogs(catalog,parseRuntime(await response.text()))};}catch(e){result.deployment={error:e.message}};
 }
 fs.writeFileSync('costume-maintenance.json',JSON.stringify(result,null,2)+'\n');
 const summary='## Deployed costume coverage\n\n'+JSON.stringify(result,null,2)+'\n\nReview candidate records; no automatic artwork approval or production publication.\n';fs.writeFileSync('costume-maintenance.md',summary);
 if(!process.argv.includes('--candidate-only')&&(result.deployment?.error||result.deployment?.differentIdentities?.length||result.missingExact.length||result.candidate.length))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={compareCatalogs,reviewCandidate,parseRuntime};
