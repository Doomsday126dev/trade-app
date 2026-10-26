'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {snapshot,partition,validateSource}=require('./sprites/costume-gap-deltas.cjs');
function compareCatalogs(local,live){
 const index=x=>new Map(x.entries.flatMap(e=>e.names.map(n=>[n,{status:e.status,identityStatus:e.identityStatus||'',assets:{default:e.assets?.default||e.defaultUrl||'',female:e.assets?.female||e.femaleUrl||''}}])));
 const a=index(local),b=index(live);return [...a].filter(([n,e])=>!b.has(n)||JSON.stringify(e)!==JSON.stringify(b.get(n))).map(([identity])=>identity);
}
function parseRuntime(source){const match=String(source).match(/const rows=(\[.*\]);\n/);if(!match)throw Error('Deployed sprite runtime format is unrecognized');return {entries:JSON.parse(match[1])};}
function reviewCandidate(catalog,releases,now=new Date()){
 const existing=new Set(catalog.entries.flatMap(e=>e.names));
 return releases.entries.filter(e=>e.lifecycleStatus==='released'&&Date.parse(e.releaseDate)<=now&&/^https:\/\/(?:pokemongo\.com|pokemongolive\.com|www\.pokemon\.com)\//.test(e.evidenceUrl)&&!existing.has(e.catalogName)).map(e=>({no:e.dex,names:[e.catalogName],status:'unavailable',identityStatus:'released',source:e.evidenceUrl,action:'Review identity and add to selectable catalog; exact artwork still required. No inferred asset URL.'}));
}
function requiresReview(result,{candidateOnly=false}={}){
 if(result.inputError||!result.coverage||result.coverage.requiresReview||!Array.isArray(result.candidate)||result.candidate.length)return true;
 return !candidateOnly&&(!result.deployment||result.deployment.error||!Array.isArray(result.deployment.differentIdentities)||result.deployment.differentIdentities.length>0);
}
async function main(){
 const root=path.resolve(__dirname,'..');
 let catalog,releases,pending,baseline,coverage,inputError,sourceReview;
 try{catalog=JSON.parse(fs.readFileSync(path.join(root,'data/costume-sprite-catalog.json'))),releases=JSON.parse(fs.readFileSync(path.join(root,'data/costume-release-evidence.json')));
 if(!Array.isArray(releases?.entries)||!releases.entries.length)throw Error('Reviewed release inventory unavailable/invalid');
 pending=JSON.parse(fs.readFileSync(path.join(root,'data/pending-costume-artwork.json')));baseline=JSON.parse(fs.readFileSync(path.join(root,'scripts/sprites/costume-gap-baseline.json')));const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/pokemonKeys.js'),'utf8'),{window});coverage=partition(snapshot(catalog,pending,window.PogoDomain.pokemonCatalog.resolveLegacyKey),baseline);sourceReview=validateSource(JSON.parse(fs.readFileSync(process.argv.includes('--source-report')?process.argv[process.argv.indexOf('--source-report')+1]:'costume-freshness.json')),new Date(),{allowOffline:process.argv.includes('--candidate-only')});
 }catch(e){inputError=e.message;}

 const result={checkedAt:new Date().toISOString(),inputError:inputError||null,coverage:coverage||null,sourceReview:sourceReview||null,candidate:inputError?[]:reviewCandidate(catalog,releases),missingExact:Array.isArray(catalog?.entries)?catalog.entries.filter(e=>e.status==='unavailable').map(e=>e.names[0]):[],shinyCoverage:'Partial: eleven recent Pikachu identities, nine additional released costumes and twelve classic Shiny Pikachu identities have reviewed exact art for valid genders. Seven ambiguous legacy identities remain unresolved; other normal-only Shiny mappings are not yet classified.',deployment:null};
 if(!process.argv.includes('--candidate-only')&&!inputError){
  try{const response=await fetch('https://doomsday126dev.github.io/trade-app/js/domain/costumeSpriteCatalog.js',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!response.ok)throw Error('Deployed catalog HTTP '+response.status);result.deployment={differentIdentities:compareCatalogs(catalog,parseRuntime(await response.text()))};}catch(e){result.deployment={error:e.message}};
 }
 fs.writeFileSync('costume-maintenance.json',JSON.stringify(result,null,2)+'\n');
 const summary='## Deployed costume coverage\n\n'+(coverage?`**NEW ${coverage.new.length} · CHANGED ${coverage.changed.length} · KNOWN ${coverage.known.length} · RESOLVED ${coverage.resolved.length} · TOTAL UNRESOLVED ${coverage.unresolvedTotal} · MAPPING CHANGES ${coverage.mappingChanges.length} · REMOVED ${coverage.removedIdentities.length}**\n\nBaseline expires ${coverage.expiresAt}${coverage.expired?' — EXPIRED':''}. Acknowledgement is not verified artwork.\n\n`:'**Coverage unavailable: '+inputError+'**\n\n')+'```json\n'+JSON.stringify(result,null,2)+'\n```'+'\n\nReview candidate records; no automatic artwork approval or production publication.\n';fs.writeFileSync('costume-maintenance.md',summary);
 if(requiresReview(result,{candidateOnly:process.argv.includes('--candidate-only')}))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={compareCatalogs,reviewCandidate,parseRuntime,requiresReview};
