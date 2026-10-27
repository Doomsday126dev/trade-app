#!/usr/bin/env node
'use strict';
// Independent source inventories drive this queue, never a list copied from the app.
// Discovery is read-only: a mined image or announcement cannot authorize trading.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'data/catalogue-sources');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function identityKey(s){return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bnidoran[-_ ]f\b/g,'nidoran female').replace(/\bnidoran[-_ ]m\b/g,'nidoran male').replace(/♀/g,' female ').replace(/♂/g,' male ').replace(/\b([aghp])-/g,(_,r)=>({a:'alolan ',g:'galarian ',h:'hisuian ',p:'paldean '}[r])).replace(/\b(alola|galar|hisui|paldea)\b/g,(_,r)=>({alola:'alolan',galar:'galarian',hisui:'hisuian',paldea:'paldean'}[r])).replace(/\bforme?\b|\bcloak\b|\bpattern\b|\bstyle\b|\bplumage\b/g,'').replace(/striped/g,'stripe').replace(/[^a-z0-9!?]+/g,' ').trim().split(/\s+/).sort().join(' ');}
function loadSources(now=new Date(),readFile=fs.readFileSync){
 const manifest=JSON.parse(readFile(path.join(directory,'manifest.json'))),data={},issues=[];
 const floors={'normal-inventory':1000,'shiny-inventory':1000,'max-inventory':100,pokemod:3000};
 for(const source of manifest.sources){
  try{const bytes=readFile(path.join(directory,source.file));if(digest(bytes)!==source.sha256)throw Error('Inventory content hash changed');
   const parsed=JSON.parse(bytes),rows=source.id==='pokemod'?parsed.tree:parsed;
   if(!Array.isArray(rows)||rows.length<floors[source.id]||parsed.truncated)throw Error('Source empty, unexpectedly contracted, or truncated');
   const age=(now-Date.parse(source.observedAt))/86400000;
   if(source.status!=='ok'||!Number.isFinite(age)||age<0||age>7)issues.push({source:source.id,kind:'stale-or-failed-source',observedAt:source.observedAt});
   data[source.id]=parsed;
  }catch(error){issues.push({source:source.id,kind:'source-integrity-failed',error:error.message});}
 }
 for(const id of Object.keys(floors))if(!manifest.sources.some(s=>s.id===id))issues.push({source:id,kind:'missing-source'});
 return{manifest,data,issues};
}
function loadIdentities(){
 const window={},ctx=vm.createContext({window});for(const file of ['data.js','js/domain/pokemonKeys.js','js/domain/publicPokemonDex.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 const publicText=fs.readFileSync(path.join(root,'js/domain/publicPokemonDex.js'),'utf8');
 const names=JSON.parse(publicText.match(/const names=(\[.*?\]);/s)[1]);const rows=names.map(name=>[name,window.PogoDomain.publicPokemonDex.dex(name)]);
 const all=window.PogoDomain.pokemonCatalog.canonicalizeEntries(rows.map(([name,no])=>({name,no})));
 return{all,catalog:window.PogoDomain.pokemonCatalog,database:window.POGO_TRADE_DB};
}
function reconcile({sources,identities,art,forms,verifiedArt=[],dispositions=[],now=new Date()}){
 const queue=[],coverage={},keys=new Map(),byName=new Map(),knownArt=new Map();
 const add=(key,item)=>{const list=keys.get(key)||new Map();list.set(item.catalogId,item);keys.set(key,list);};
 for(const item of identities.all){byName.set(item.name,item);for(const label of [item.name,...item.legacyAliases||[],...item.searchAliases||[]])add(item.no+'|'+identityKey(label),item);}
 for(const item of art.entries)for(const label of item.names){const key=item.no+'|'+identityKey(label),rows=knownArt.get(key)||new Set();rows.add(item);knownArt.set(key,rows);}
 const verified=new Set(verifiedArt.filter(r=>r.status==='verified-bytes'&&r.decoded).map(r=>r.no+'|'+(r.shiny?'shiny':'normal')+'|'+(r.gender||'')));
 const defaults=new Map(forms.records.filter(r=>r.id===r.speciesId).map(r=>[r.speciesId,r.name]));
 const dispositionsById=new Map();for(const d of dispositions){if(!d.id||dispositionsById.has(d.id)||!d.reason||!d.sources?.length)throw Error('Incomplete or duplicate reviewed disposition');dispositionsById.set(d.id,d);}
 const sourceDate=id=>sources.manifest.sources.find(r=>r.id===id)?.firstObservedAt||sources.manifest.sources.find(r=>r.id===id)?.observedAt||null;
 function push(row){const d=dispositionsById.get(row.id);if(d){row.review={...d};if(d.releaseState)row.releaseState=d.releaseState;}queue.push(row);}
 for(const [source,kind] of [['normal-inventory','normal'],['shiny-inventory','shiny']]){
  let matched=0,ambiguous=0;const rows=sources.data[source]||[],sourceLabels=new Map();
  for(const row of rows){const key=row.no+'|'+identityKey(row.name),files=sourceLabels.get(key)||new Set();files.add(row.sourceSprite);sourceLabels.set(key,files);}
  for(const row of rows){
   const sourceId=row.no+'|'+row.sourceSprite+'|'+row.name;const id=kind+':'+sourceId;
   let matches=[...(keys.get(row.no+'|'+identityKey(row.name))||new Map()).values()];
   // Numeric GO base image may denote the explicitly reviewed default form.
   if(!matches.length&&new RegExp('/0*'+row.no+'\\.png$').test(row.sourceSprite)&&defaults.has(row.no)){
    const entry=byName.get(defaults.get(row.no));if(entry)matches=[entry];
   }
   const releaseState=row.availabilityClaim==='explicitly-unavailable'?'uncertain':row.availabilityClaim==='form-of-unavailable-species-needs-release-evidence'?'uncertain':kind==='shiny'&&row.statusText==='Available when encountered'?'released-source-claim':kind==='normal'&&row.availabilityClaim==='listed-without-unavailable-marker'?'released-source-claim':'uncertain';
   const localRows=matches.length===1?[...knownArt.get(row.no+'|'+identityKey(matches[0].name))||[]]:[];
   const sourceAmbiguous=sourceLabels.get(row.no+'|'+identityKey(row.name)).size>1;
   const artAmbiguous=localRows.length>1;
   const local=localRows.length===1&&!sourceAmbiguous?localRows[0]:null;
   const exact=local?.status==='exact'&&local.assets?.[kind==='shiny'?'shiny':'default'];
   const numeric=new RegExp('/0*'+row.no+'\\.png$').test(row.sourceSprite);
   const formIds=[...new Set(forms.records.filter(r=>r.speciesId===row.no&&matches.length===1&&[r.name,...r.aliases||[]].some(name=>identityKey(name)===identityKey(matches[0].name))).map(r=>r.id))];
   const checked=!sourceAmbiguous&&!artAmbiguous&&matches.length===1&&(numeric&&verified.has(row.no+'|'+kind+'|')||formIds.length===1&&verified.has(formIds[0]+'|'+kind+'|'));
   if(sourceAmbiguous||artAmbiguous||matches.length>1)ambiguous++;else if(matches.length===1)matched++;
   if(sourceAmbiguous||artAmbiguous||matches.length!==1||!exact&&!checked)push({id,source,sourceUrl:row.source,sourceSprite:row.sourceSprite,discoveredAt:row.discoveredAt||sourceDate(source),no:row.no,name:row.name,releaseState,artState:exact?'reviewed-local':checked?'verified-remote':'available-at-source-needs-exact-review',matches:matches.map(r=>({name:r.name,catalogId:r.catalogId})),priority:releaseState==='released-source-claim'?'urgent':'review',disposition:sourceAmbiguous?'ambiguous-source-label':artAmbiguous?'ambiguous-art-identity':matches.length>1?'ambiguous-identity':matches.length===0?'unmatched-identity':'exact-art-verification-required'});
  }
  coverage[source]={denominator:rows.length,identityMatched:matched,ambiguous,unmatched:rows.length-matched-ambiguous};
 }
 const max=sources.data['max-inventory']||[];let maxMatched=0;
 for(const row of max){const family=dispositionsById.get('dynamax:'+row.no);if(family?.targets?.length&&family.targets.every(name=>identities.database.dynamax.some(r=>r.no===row.no&&r.name===name))){maxMatched++;continue;}const matches=identities.database.dynamax.filter(r=>r.no===row.no&&identityKey(r.name)===identityKey(row.name));
  if(matches.length===1){maxMatched++;continue;}
  push({id:'dynamax:'+row.no,source:'max-inventory',sourceUrl:row.source,discoveredAt:row.discoveredAt||sourceDate('max-inventory'),no:row.no,name:row.name,releaseState:'uncertain',artState:'base-art-is-not-release-proof',matches:matches.map(r=>({name:r.name})),priority:'urgent',disposition:matches.length?'ambiguous-identity':'release-and-identity-review-required'});
 }
 coverage['max-inventory']={denominator:max.length,identityMatched:maxMatched,unmatched:max.length-maxMatched};
 const tree=sources.data.pokemod;const groups=new Map();
 for(const file of tree?.tree||[]){const m=file.path.match(/^Addressable Assets\/pm(\d+)(.*?)\.(?:icon|portrait)\.png$/);if(!m)continue;
  const token=m[2].replace(/\.g\d+|\.s(?=\.|$)/g,''),id='mined:'+m[1]+token;
  if(!groups.has(id))groups.set(id,{id,no:Number(m[1]),token,files:[]});groups.get(id).files.push({path:file.path,gitBlobSha:file.sha,...(file.discoveredAt?{discoveredAt:file.discoveredAt}:{})});
 }
 const reviewedFiles=new Set(art.entries.flatMap(r=>[r.sourceFile,...Object.values(r.sourceFiles||{})].filter(Boolean)));
 let minedMatched=0;
 for(const group of groups.values()){
  const normal=group.files.some(r=>!/\.s\.(?:icon|portrait)\.png$/.test(r.path)),shiny=group.files.some(r=>/\.s\.(?:icon|portrait)\.png$/.test(r.path));
  const reviewed=group.files.some(r=>reviewedFiles.has(path.basename(r.path)));
  if(reviewed){minedMatched++;continue;}
  // Base assets can be related to a species without guessing any form token.
  if(!group.token&&identities.all.some(r=>r.no===group.no&&!/[()]/.test(r.name))){minedMatched++;continue;}
  push({...group,source:'pokemod',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets/tree/'+sources.manifest.sources.find(r=>r.id==='pokemod')?.commit+'/Images/Pokemon',discoveredAt:group.files.map(f=>f.discoveredAt).filter(Boolean).sort()[0]||sourceDate('pokemod'),releaseState:'uncertain',artState:'available-at-source',normal,shiny,priority:/2026|HALLOWEEN/.test(group.token)?'urgent':'review',disposition:'exact-game-form-alias-review-required'});
 }
 const legacy=new Map(),unparsed=[];
 for(const file of tree?.tree||[]){if(!file.path.endsWith('.png'))continue;if(file.path.startsWith('Addressable Assets/')){if(!/^Addressable Assets\/pm\d+.*\.(?:icon|portrait)\.png$/.test(file.path))unparsed.push(file);continue;}const m=file.path.match(/^pokemon_icon_(?:pm)?(\d+)_(.*?)(?:_shiny)?\.png$/);if(!m){unparsed.push(file);continue;}const id='legacy-mined:'+Number(m[1])+':'+m[2];if(!legacy.has(id))legacy.set(id,{id,no:Number(m[1]),token:m[2],files:[]});legacy.get(id).files.push({path:file.path,gitBlobSha:file.sha,...(file.discoveredAt?{discoveredAt:file.discoveredAt}:{})});}
 let legacyMapped=0;
 for(const group of legacy.values()){
  const mapped=group.files.some(f=>reviewedFiles.has(f.path))||group.token==='00'&&identities.all.some(r=>r.no===group.no&&!/[()]/.test(r.name));
  if(mapped){legacyMapped++;continue;}
  push({...group,source:'pokemod-legacy',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets',discoveredAt:group.files.map(f=>f.discoveredAt).filter(Boolean).sort()[0]||sourceDate('pokemod'),releaseState:'uncertain',artState:'available-at-source',priority:'review',disposition:'legacy-form-costume-number-review-required'});
 }
 for(const file of unparsed)push({id:'unparsed-mined:'+file.path,source:'pokemod',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets',discoveredAt:group.files.map(f=>f.discoveredAt).filter(Boolean).sort()[0]||sourceDate('pokemod'),releaseState:'uncertain',artState:'available-at-source',priority:'urgent',disposition:'unparsed-art-filename',file});
 coverage.pokemod={denominator:groups.size,unit:'addressable-icon-or-portrait-file-groups',iconFiles:[...groups.values()].reduce((n,g)=>n+g.files.filter(f=>f.path.endsWith('.icon.png')).length,0),portraitFiles:[...groups.values()].reduce((n,g)=>n+g.files.filter(f=>f.path.endsWith('.portrait.png')).length,0),mapped:minedMatched,unmatched:groups.size-minedMatched,legacyGroups:legacy.size,legacyFiles:[...legacy.values()].reduce((n,g)=>n+g.files.length,0),legacyMapped,legacyUnmapped:legacy.size-legacyMapped,unparsedImages:unparsed.length};
 // Missing art is always an open item, even if older metadata called it unavailable.
 for(const row of art.entries.filter(r=>r.status==='unavailable'))push({id:'missing-art:'+row.no+':'+row.names[0],source:'local-review',no:row.no,name:row.names[0],discoveredAt:sources.manifest.importedAt,releaseState:row.identityStatus||'uncertain',artState:'missing-exact-art',priority:'urgent',disposition:'owner-attention-required',reason:row.unavailableReason,nextAction:'Recheck active sprite inventory and exact costume aliases; report identity and source blocker to owner. Never substitute or close as unavailable.'});
 queue.sort((a,b)=>a.id.localeCompare(b.id));
 return{schemaVersion:1,checkedAt:now.toISOString(),status:sources.issues.length?'source-failure':queue.length?'review-required':'reconciled',qualification:'Explicit source denominators, not a promise of every possible identity. Identity matching does not prove exact art, release, tradeability or optional gender. Unmatched rows and missing art remain open. Reviewed future/excluded dispositions annotate rather than erase queue items.',coverage,sourceIssues:sources.issues,queue};
}
function build(now=new Date(),sources=loadSources(now)){
 const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
 return reconcile({sources,identities:loadIdentities(),art:read('data/costume-sprite-catalog.json'),forms:read('data/public-form-sprite-identities.json'),verifiedArt:fs.existsSync(path.join(root,'data/catalogue-art-checks.json'))?read('data/catalogue-art-checks.json').records:[],dispositions:fs.existsSync(path.join(directory,'dispositions.json'))?read('data/catalogue-sources/dispositions.json').records:[],now});
}
if(require.main===module){const report=build();fs.writeFileSync(path.join(root,'catalogue-reconciliation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,coverage:report.coverage,open:report.queue.length,sourceIssues:report.sourceIssues},null,2));if(report.status!=='reconciled'&&!process.argv.includes('--report-only'))process.exitCode=1;}
module.exports={identityKey,loadSources,loadIdentities,reconcile,build};
