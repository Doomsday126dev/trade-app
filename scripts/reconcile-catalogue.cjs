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
 const floors={'normal-inventory':1000,'shiny-inventory':1000,'max-inventory':100,'gigantamax-inventory':10,pokemod:3000};
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
 const watch=manifest.secondarySources?.find(row=>row.id==='pokeminers-head');
 if(!watch||watch.url!=='https://api.github.com/repos/PokeMiners/pogo_assets/commits/master'||!/^([a-f0-9]{40})$/.test(watch.reviewedCommit||'')||!watch.scope)issues.push({source:'pokeminers-head',kind:'missing-or-invalid-secondary-watch'});
 return{manifest,data,issues};
}
function loadIdentities({database}={}){
 const window={},ctx=vm.createContext({window,structuredClone});for(const file of ['data.js','js/domain/pokemonKeys.js','js/domain/publicPokemonDex.js','js/domain/pokemonSearchTerms.js','js/domain/pokemonEntryRules.js','js/domain/costumeSpriteCatalog.js','js/domain/spriteSlugs.js','js/domain/backgroundPersistence.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 const rows=window.PogoDomain.publicPokemonDex.entries?.();if(!Array.isArray(rows)||!rows.length)throw Error('Public dex inventory unavailable; coverage is unknown');
 const catalog=window.PogoDomain.pokemonCatalog,publicAll=catalog.canonicalizeEntries(rows.map(([name,no])=>({name,no}))),domain=window.PogoDomain;
 // Execute the same pure picker-construction functions as the product. Never
 // infer selectability from a sprite dictionary or maintain a second seed list.
 const source=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8'),tree=require('acorn').parse(source,{ecmaVersion:'latest',sourceType:'script'}),wanted=new Set(['allCostumeEntries','maxTradeEntries','listSource','spriteCatalogContext','selectableSpriteEntry','_specialAllItems']),declarations=[];
 for(const node of tree.body){if(node.type==='FunctionDeclaration'&&wanted.has(node.id?.name)){declarations.push(source.slice(node.start,node.end));wanted.delete(node.id.name);}if(node.type==='VariableDeclaration')for(const decl of node.declarations)if(['SPRITE_BASE','SCATTERBUG_PATTERNS','EXTRA_COSTUME_ENTRIES','EXTRA_FORM_ENTRIES'].includes(decl.id?.name))declarations.push('const '+source.slice(decl.start,decl.end)+';');}
 if(wanted.size||declarations.filter(s=>s.startsWith('const ')).length!==4)throw Error('Selectable catalogue runtime extraction failed; coverage is unknown');
 Object.assign(ctx,{BackgroundEditorAdapter:ctx.BackgroundEditorAdapter,DB:database||window.POGO_TRADE_DB,pokemonCatalogDomain:catalog,costumeSpriteCatalogDomain:domain.costumeSpriteCatalog,spriteSlugsDomain:domain.spriteSlugs,LEGENDARY_AVATAR_ENTRIES:catalog.legendaryEntries,MAX_TYPE_LABELS:{dynamax:'Dynamax',gmax:'Gigantamax'},uniqueEntries:domain.pokemonEntryRules.uniqueEntries,isTradeableForWishlist:domain.pokemonEntryRules.isTradeableForWishlist,isUnresolvedSpriteKey:domain.spriteSlugs.isUnresolvedSpriteKey,canonicalSpriteOverride:domain.spriteSlugs.canonicalSpriteOverride,pokemonNamesI18n:{compareDisplay:(a,b)=>String(a.name).localeCompare(String(b.name))},i18nCore:{getLocale:()=> 'en'},pokemonDisplayName:entry=>entry.displayName||entry.name,entrySpriteUrl:()=>null,normalizeAcText:String,pokemonSearchLabels:entry=>[entry.name]});
 vm.runInContext(declarations.join('\n')+'\nwindow.__selectable=_specialAllItems();',ctx);
 const all=window.__selectable;if(!all.length)throw Error('Selectable catalogue is empty; coverage is unknown');
 return{all,publicAll,catalog,database:database||window.POGO_TRADE_DB,isTradeableForWishlist:domain.pokemonEntryRules.isTradeableForWishlist};
}

// A file is an identity lead, never proof of an entire normal/Shiny pair.
// Only a unique actual picker identity plus separately reviewed variants closes it.
function minedPairCoverage(group,{identities,art,verified,baseNames}){
 const fileName=value=>{try{return path.basename(decodeURIComponent(/^https:\/\//.test(value)?new URL(value).pathname:value));}catch{return'';}};
 const files=new Set(group.files.map(file=>path.basename(file.path)));
 const linked=art.entries.filter(row=>row.no===group.no&&[row.sourceFile,...Object.values(row.sourceFiles||{}),...Object.values(row.artProof||{}).map(proof=>proof.url)].filter(value=>typeof value==='string').some(value=>files.has(fileName(value))));
 const matches=row=>{
  const resolved=new Set((row.names||[]).map(name=>identities.catalog?.resolveLegacyKey?.(name)?.catalogId).filter(Boolean));
  return identities.all.filter(item=>item.no===group.no&&((row.names||[]).includes(item.name)||(item.legacyAliases||[]).some(name=>(row.names||[]).includes(name))||resolved.has(item.catalogId)));
 };
 const targets=new Map();for(const row of linked)for(const item of matches(row))targets.set(item.catalogId,item);
 const base=!group.token||group.token==='00';
 if(base&&!linked.length)for(const item of identities.all.filter(item=>item.no===group.no&&baseNames.get(group.no)?.has(identityKey(item.name))))targets.set(item.catalogId,item);
 const ids=[...targets.keys()].filter(Boolean),unique=ids.length===1;
 const exactRows=unique?linked.filter(row=>row.status==='exact'&&matches(row).some(item=>item.catalogId===ids[0])):[];
 const qualified=variant=>unique&&(exactRows.some(row=>{
  const asset=row.assets?.[variant==='normal'?'default':'shiny'];
  if(!asset||row.blockedVariants?.[variant])return false;
  const same=row.assets?.default===row.assets?.shiny||row.sha256?.default&&row.sha256.default===row.sha256?.shiny;
  return variant==='normal'||!same||row.no===1024&&JSON.stringify(row.names)==='["Terapagos (Stellar Form)"]'&&row.sameAppearanceEvidence==='stellar-palette-10277-v1';
 })||base&&!linked.length&&verified.has(group.no+'|'+variant+'|'));
 const shinyFile=file=>/\.s(?:\.|$)/.test(file.path)||/_shiny\.png$/.test(file.path);
 const variants={normal:{sourceAvailable:group.files.some(file=>!shinyFile(file)),artQualified:qualified('normal')},shiny:{sourceAvailable:group.files.some(shinyFile),artQualified:qualified('shiny')}};
 return{selectableCatalogIds:ids,reviewedNames:[...new Set(linked.flatMap(row=>row.names||[]))],variants,complete:unique&&variants.normal.artQualified&&variants.shiny.artQualified};
}

function reconcile({sources,identities,art,forms,verifiedArt=[],dispositions=[],pendingArt=[],eligibility=[],variantIssues=[],now=new Date()}){
 const queue=[],coverage={'selectable-catalogue':{denominator:identities.all.length,qualification:'Actual runtime picker identities, including supplemental forms and exact-art gates. Public sprite dictionary presence alone does not count as selectable coverage.'}},keys=new Map(),byName=new Map(),knownArt=new Map();
 const add=(key,item)=>{const list=keys.get(key)||new Map();list.set(item.catalogId,item);keys.set(key,list);};
 for(const item of identities.all){byName.set(item.name,item);for(const label of [item.name,...item.legacyAliases||[],...item.searchAliases||[]])add(item.no+'|'+identityKey(label),item);}
 for(const item of art.entries)for(const label of item.names){const key=item.no+'|'+identityKey(label),rows=knownArt.get(key)||new Set();rows.add(item);knownArt.set(key,rows);}
 // Reviewed art aliases can relate to an existing identity only when all
 // matched names select one canonical ID. Ambiguous legacy records stay open.
 for(const row of art.entries){const targets=identities.all.filter(item=>row.names.includes(item.name));const ids=new Set(targets.map(item=>item.catalogId));if(ids.size===1)for(const name of row.names)add(row.no+'|'+identityKey(name),targets[0]);}
 const verified=new Set(verifiedArt.filter(r=>r.status==='verified-bytes'&&r.decoded).map(r=>r.no+'|'+(r.shiny?'shiny':'normal')+'|'+(r.gender||'')));
 const defaults=new Map(forms.records.filter(r=>r.id===r.speciesId).map(r=>[r.speciesId,r.name]));
 const dispositionsById=new Map();for(const d of dispositions){if(!d.id||dispositionsById.has(d.id)||!d.reason||!d.sources?.length)throw Error('Incomplete or duplicate reviewed disposition');dispositionsById.set(d.id,d);}
 const sourceDate=id=>sources.manifest.sources.find(r=>r.id===id)?.firstObservedAt||sources.manifest.sources.find(r=>r.id===id)?.observedAt||null;
 function push(row){const d=dispositionsById.get(row.id);if(d){row.review={...d};if(d.releaseState)row.releaseState=d.releaseState;}queue.push(row);}
 for(const [source,kind] of [['normal-inventory','normal'],['shiny-inventory','shiny']]){
  let matched=0,ambiguous=0,policyExcluded=0;const rows=sources.data[source]||[],sourceLabels=new Map();
  for(const row of rows){const key=row.no+'|'+identityKey(row.name),files=sourceLabels.get(key)||new Set();files.add(row.sourceSprite);sourceLabels.set(key,files);}
  for(const row of rows){
   const sourceId=row.no+'|'+row.sourceSprite+'|'+row.name;const id=kind+':'+sourceId;
   let matches=[...(keys.get(row.no+'|'+identityKey(row.name))||new Map()).values()];
   // Numeric GO base image may denote the explicitly reviewed default form.
   if(!matches.length&&new RegExp('/0*'+row.no+'\\.png$').test(row.sourceSprite)&&defaults.has(row.no)){
    const entry=byName.get(defaults.get(row.no));if(entry)matches=[entry];
   }
   const releaseState=row.availabilityClaim==='explicitly-unavailable'?'uncertain':row.availabilityClaim==='form-of-unavailable-species-needs-release-evidence'?'uncertain':kind==='shiny'&&row.statusText==='Available when encountered'?'released-source-claim':kind==='normal'&&row.availabilityClaim==='listed-without-unavailable-marker'?'released-source-claim':'uncertain';
   if(identities.isTradeableForWishlist&&!identities.isTradeableForWishlist({no:row.no,name:row.name})){policyExcluded++;push({id,source,sourceUrl:row.source,sourceSprite:row.sourceSprite,discoveredAt:row.discoveredAt||sourceDate(source),no:row.no,name:row.name,releaseState,artState:'source-present-existing-trade-policy-exclusion',priority:'review',disposition:'excluded-existing-trade-policy',reason:'The product species-level nontradeable Mythical rule excludes this identity. Retain source/art evidence without proposing a trade picker entry.'});continue;}
   const localRows=matches.length===1?[...knownArt.get(row.no+'|'+identityKey(matches[0].name))||[]]:[];
   const sourceAmbiguous=sourceLabels.get(row.no+'|'+identityKey(row.name)).size>1;
   const artAmbiguous=localRows.length>1;
   const local=localRows.length===1&&!sourceAmbiguous?localRows[0]:null;
   const exact=local?.status==='exact'&&local.assets?.[kind==='shiny'?'shiny':'default'];
   const numeric=new RegExp('/0*'+row.no+'\\.png$').test(row.sourceSprite);
   const formIds=[...new Set(forms.records.filter(r=>r.speciesId===row.no&&matches.length===1&&[r.name,...r.aliases||[]].some(name=>identityKey(name)===identityKey(matches[0].name))).map(r=>r.id))];
   const checked=!sourceAmbiguous&&!artAmbiguous&&matches.length===1&&(numeric&&verified.has(row.no+'|'+kind+'|')||formIds.length===1&&verified.has(formIds[0]+'|'+kind+'|'));
   const guarded=eligibility.find(item=>item.no===row.no&&[item.name,...item.aliases||[]].some(name=>identityKey(name)===identityKey(row.name)||matches.length===1&&name===matches[0].name));
   if(kind==='shiny'&&releaseState==='released-source-claim'&&guarded&&guarded.shiny!=='released')push({id:'variant-release:'+sourceId,source,sourceUrl:row.source,sourceSprite:row.sourceSprite,discoveredAt:row.discoveredAt||sourceDate(source),no:row.no,name:row.name,releaseState,artState:exact?'reviewed-local':checked?'verified-remote':'needs-exact-review',priority:'urgent',disposition:'variant-release-evidence-review-required',reason:'Source now lists a Shiny encounter but the reviewed release evidence is still '+guarded.shiny,nextAction:'Verify the exact variant release, update reviewed status, then regenerate runtime. Art success alone cannot confirm release.'});
   if(sourceAmbiguous||artAmbiguous||matches.length>1)ambiguous++;else if(matches.length===1)matched++;
   if(sourceAmbiguous||artAmbiguous||matches.length!==1||!exact&&!checked)push({id,source,sourceUrl:row.source,sourceSprite:row.sourceSprite,discoveredAt:row.discoveredAt||sourceDate(source),no:row.no,name:row.name,releaseState,artState:exact?'reviewed-local':checked?'verified-remote':'available-at-source-needs-exact-review',matches:matches.map(r=>({name:r.name,catalogId:r.catalogId})),priority:releaseState==='released-source-claim'?'urgent':'review',disposition:sourceAmbiguous?'ambiguous-source-label':artAmbiguous?'ambiguous-art-identity':matches.length>1?'ambiguous-identity':matches.length===0?'unmatched-identity':'exact-art-verification-required'});
  }
  coverage[source]={denominator:rows.length,identityMatched:matched,ambiguous,...(policyExcluded?{policyExcluded}:{}),unmatched:rows.length-matched-ambiguous-policyExcluded};
 }
 const max=sources.data['max-inventory']||[];let maxMatched=0;
 for(const row of max){const family=dispositionsById.get('dynamax:'+row.no);if(family?.targets?.length&&family.targets.every(name=>identities.database.dynamax.some(r=>r.no===row.no&&r.name===name))){maxMatched++;continue;}const matches=identities.database.dynamax.filter(r=>r.no===row.no&&identityKey(r.name)===identityKey(row.name));
  if(matches.length===1){maxMatched++;continue;}
  push({id:'dynamax:'+row.no,source:'max-inventory',sourceUrl:row.source,discoveredAt:row.discoveredAt||sourceDate('max-inventory'),no:row.no,name:row.name,releaseState:'uncertain',artState:'base-art-is-not-release-proof',matches:matches.map(r=>({name:r.name})),priority:'urgent',disposition:matches.length?'ambiguous-identity':'release-and-identity-review-required'});
 }
 coverage['max-inventory']={denominator:max.length,identityMatched:maxMatched,unmatched:max.length-maxMatched};
 const gmax=sources.data['gigantamax-inventory']||[];const gmaxMapped=gmax.filter(row=>identities.database.gmax?.some(entry=>entry.no===row.no));
 for(const row of gmax.filter(row=>!gmaxMapped.includes(row)))push({id:'gigantamax:'+row.no,source:'gigantamax-inventory',sourceUrl:row.source,discoveredAt:sourceDate('gigantamax-inventory'),no:row.no,name:row.name+' (Gigantamax)',releaseState:'uncertain',artState:'exact-gigantamax-art-review-required',priority:'urgent',disposition:'release-and-identity-review-required'});
 coverage['gigantamax-inventory']={denominator:gmax.length,identityMatched:gmaxMapped.length,unmatched:gmax.length-gmaxMapped.length,appEntriesOutsideSource:(identities.database.gmax||[]).filter(row=>!gmax.some(source=>source.no===row.no)).map(row=>({no:row.no,name:row.name})),qualification:'Species-level identity presence only. Extra app entries and absent source rows require official release evidence; this secondary table may lag.'};
 const baseNames=new Map();
 const addBase=(no,name)=>{if(!baseNames.has(no))baseNames.set(no,new Set());baseNames.get(no).add(identityKey(name));};
 for(const row of sources.data['normal-inventory']||[])if(new RegExp('/0*'+row.no+'\\.png$').test(row.sourceSprite||''))addBase(row.no,row.name);
 for(const row of forms.records||[])if(row.id===row.speciesId)addBase(row.speciesId,row.name);
 const tree=sources.data.pokemod;const groups=new Map();
 for(const file of tree?.tree||[]){const m=file.path.match(/^Addressable Assets\/pm(\d+)(.*?)\.(?:icon|portrait)\.png$/);if(!m)continue;
  const token=m[2].replace(/\.g\d+|\.s(?=\.|$)/g,''),id='mined:'+m[1]+token;
  if(!groups.has(id))groups.set(id,{id,no:Number(m[1]),token,files:[]});groups.get(id).files.push({path:file.path,gitBlobSha:file.sha,...(file.discoveredAt?{discoveredAt:file.discoveredAt}:{})});
 }
 let minedMatched=0;const minedVariants={normal:0,shiny:0};
 for(const group of groups.values()){
  const pair=minedPairCoverage(group,{identities,art,verified,baseNames});
  for(const variant of ['normal','shiny'])if(pair.variants[variant].artQualified)minedVariants[variant]++;
  if(pair.complete){minedMatched++;continue;}
  push({...group,...pair,source:'pokemod',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets/tree/'+sources.manifest.sources.find(r=>r.id==='pokemod')?.commit+'/Images/Pokemon',discoveredAt:group.files.map(f=>f.discoveredAt).filter(Boolean).sort()[0]||sourceDate('pokemod'),releaseState:'uncertain',artState:'exact-pair-or-picker-review-required',normal:pair.variants.normal.sourceAvailable,shiny:pair.variants.shiny.sourceAvailable,priority:/2026|HALLOWEEN/.test(group.token)?'urgent':'review',disposition:'exact-game-form-alias-review-required'});
 }
 const legacy=new Map(),unparsed=[];
 for(const file of tree?.tree||[]){if(!file.path.endsWith('.png'))continue;if(file.path.startsWith('Addressable Assets/')){if(!/^Addressable Assets\/pm\d+.*\.(?:icon|portrait)\.png$/.test(file.path))unparsed.push(file);continue;}const m=file.path.match(/^pokemon_icon_(?:pm)?(\d+)_(.*?)(?:_shiny)?\.png$/);if(!m){unparsed.push(file);continue;}const id='legacy-mined:'+Number(m[1])+':'+m[2];if(!legacy.has(id))legacy.set(id,{id,no:Number(m[1]),token:m[2],files:[]});legacy.get(id).files.push({path:file.path,gitBlobSha:file.sha,...(file.discoveredAt?{discoveredAt:file.discoveredAt}:{})});}
 let legacyMapped=0;const legacyVariants={normal:0,shiny:0};
 for(const group of legacy.values()){
  const pair=minedPairCoverage(group,{identities,art,verified,baseNames});
  for(const variant of ['normal','shiny'])if(pair.variants[variant].artQualified)legacyVariants[variant]++;
  if(pair.complete){legacyMapped++;continue;}
  push({...group,...pair,source:'pokemod-legacy',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets',discoveredAt:group.files.map(f=>f.discoveredAt).filter(Boolean).sort()[0]||sourceDate('pokemod'),releaseState:'uncertain',artState:'available-at-source',priority:'review',disposition:'legacy-form-costume-number-review-required'});
 }
 for(const file of unparsed)push({id:'unparsed-mined:'+file.path,source:'pokemod',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets',discoveredAt:file.discoveredAt||sourceDate('pokemod'),releaseState:'uncertain',artState:'available-at-source',priority:'urgent',disposition:'unparsed-art-filename',file});
 coverage.pokemod={denominator:groups.size,unit:'addressable-icon-or-portrait-file-groups',iconFiles:[...groups.values()].reduce((n,g)=>n+g.files.filter(f=>f.path.endsWith('.icon.png')).length,0),portraitFiles:[...groups.values()].reduce((n,g)=>n+g.files.filter(f=>f.path.endsWith('.portrait.png')).length,0),mapped:minedMatched,unmatched:groups.size-minedMatched,variantDenominator:groups.size*2,qualifiedVariants:minedVariants,qualification:'Matched requires one actual selectable canonical identity and separately qualified default normal/Shiny artwork; optional gender and release remain separate.',legacyGroups:legacy.size,legacyFiles:[...legacy.values()].reduce((n,g)=>n+g.files.length,0),legacyMapped,legacyUnmapped:legacy.size-legacyMapped,legacyVariantDenominator:legacy.size*2,legacyQualifiedVariants:legacyVariants,unparsedImages:unparsed.length};
 // Missing art is always an open item, even if older metadata called it unavailable.
 for(const row of art.entries.filter(r=>r.status==='unavailable')){const review=pendingArt.find(r=>row.names.includes(r.displayIdentity));push({id:'missing-art:'+row.no+':'+row.names[0],source:'local-review',no:row.no,name:row.names[0],discoveredAt:sources.manifest.importedAt,releaseState:row.identityStatus||'uncertain',artState:review?.reasonCategory==='mapping-ambiguous'?'exact-identity-ambiguous':review?.reasonCategory==='identity-unverified'?'game-identity-unverified':'missing-exact-art',priority:'urgent',disposition:'owner-attention-required',reason:review?.candidate?.reason||row.unavailableReason,sources:review?.acceptedSourcePage?[review.acceptedSourcePage]:[],lastReviewedDate:review?.lastReviewedDate,nextAction:review?.nextReviewAction||'Recheck active sprite inventory and exact costume aliases; report identity and source blocker to owner. Never substitute or close as unavailable.'});}
 for(const issue of variantIssues){if(!issue.id||!Number.isInteger(issue.no)||!issue.name||!issue.reason||!issue.sources?.length||!issue.nextAction)throw Error('Incomplete exact variant owner issue');push({...issue,id:'exact-variant:'+issue.id,source:'exact-variant-review',sourceUrl:issue.sources[0],priority:'urgent',disposition:'owner-attention-required'});}
 queue.sort((a,b)=>a.id.localeCompare(b.id));
 return{schemaVersion:1,checkedAt:now.toISOString(),status:sources.issues.length?'source-failure':queue.length?'review-required':'reconciled',qualification:'Explicit source denominators, not a promise of every possible identity. Identity matching does not prove exact art, release, tradeability or optional gender. Unmatched rows and missing art remain open. Reviewed future/excluded dispositions annotate rather than erase queue items.',coverage,sourceIssues:sources.issues,queue};
}

// Compact owner view over the same retained raw queue. This never changes the
// reconciliation status, erases a source row, or authorizes a trade identity.
function summarizeReview(report,reviews){
 if(reviews.schemaVersion!==1||!Array.isArray(reviews.aliases)||!Array.isArray(reviews.missingIdentities))throw Error('Invalid identity review register');
 const aliases=new Map();for(const row of reviews.aliases){if(!row.rowId||aliases.has(row.rowId)||!row.catalogId||!row.evidence?.sourceSprite)throw Error('Incomplete or duplicate alias evidence');aliases.set(row.rowId,row);}
 const buckets={},groups=new Map(),used=new Set();
 for(const row of report.queue){
  const alias=aliases.get(row.id);if(alias){if(alias.no!==row.no||alias.sourceName!==row.name)throw Error('Reviewed alias no longer matches its source identity');used.add(row.id);}
  const missing=reviews.missingIdentities.find(r=>r.no===row.no&&r.sourceNames.includes(row.name));
  const category=row.disposition==='excluded-existing-trade-policy'?'excluded-existing-trade-policy':missing?'confirmed-missing-identity':alias?'known-identity-alias':row.source==='pokemod'||row.source==='pokemod-legacy'?'mined-identity-review':row.disposition==='news-or-event-review-required'?'news-discovery-lead':row.disposition==='owner-attention-required'?'legacy-identity-or-exact-art-blocker':row.releaseState==='announced'?'upcoming-release-review':row.disposition.includes('ambiguous')?'source-or-canonical-ambiguity':row.matches?.length===1?'existing-identity-exact-art-review':/^(Mega |Primal )|Eternamax/.test(row.name||'')?'battle-form-eligibility-review':'identity-or-release-evidence-review';
  buckets[category]=(buckets[category]||0)+1;
  const canonical=alias?.catalogId||(row.matches?.length===1?row.matches[0].catalogId:'');
  const id=missing?.id||canonical&&'catalog:'+canonical||row.no&&row.name&&'source-identity:'+row.no+':'+identityKey(row.name)||row.id;
  if(!groups.has(id))groups.set(id,{id,names:new Set(),categories:new Set(),rows:[]});const group=groups.get(id);if(row.name)group.names.add(row.name);group.categories.add(category);group.rows.push(row.id);
 }
 const staleAliases=[...aliases.keys()].filter(id=>!used.has(id));
 return{schemaVersion:1,rawRows:report.queue.length,groupCount:groups.size,rawRowsByCategory:buckets,knownAliasRows:used.size,staleAliasReviewRows:staleAliases,actionableMissing:reviews.missingIdentities,stagedCostumes:reviews.stagedCostumes||[],groups:[...groups.values()].map(r=>({...r,names:[...r.names].sort(),categories:[...r.categories].sort()})).sort((a,b)=>a.id.localeCompare(b.id)),qualification:'Grouping retains every original row ID and its variant/source evidence. Known aliases do not prove art, release or trade eligibility. The actionable list is a confirmed minimum; remaining identity/release candidates still require review. No missing asset is closed as unavailable.'};
}

function build(now=new Date(),sources=loadSources(now)){
 const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
 const variantReviews=require('./sprites/variant-art-review.cjs').proofRegister(root);
 const variantIssues=fs.existsSync(path.join(root,'data/catalogue-variant-route-review.json'))?read('data/catalogue-variant-route-review.json').unresolved:[];
 const result=reconcile({sources,variantIssues,identities:loadIdentities(),art:{entries:[...read('data/costume-sprite-catalog.json').entries.map(entry=>{const proof=variantReviews.find(r=>r.name===entry.names[0]);return proof?{...entry,sourceFiles:{...entry.sourceFiles,...Object.fromEntries([proof.normalComparison,...Object.values(proof.variants)].filter(p=>p.sourcePath).map((p,i)=>['exactVariant'+i,path.basename(p.sourcePath)]))}}:entry;}),...(fs.existsSync(path.join(root,'data/catalogue-reviewed-assets.json'))?require('./sprites/catalogue-review.cjs').validateReviewedAssets(root):[])]},pendingArt:read('data/pending-costume-artwork.json').entries,eligibility:fs.existsSync(path.join(root,'data/reviewed-variant-status.json'))?read('data/reviewed-variant-status.json').records:[],forms:read('data/public-form-sprite-identities.json'),verifiedArt:fs.existsSync(path.join(root,'data/catalogue-art-checks.json'))?read('data/catalogue-art-checks.json').records:[],dispositions:fs.existsSync(path.join(directory,'dispositions.json'))?read('data/catalogue-sources/dispositions.json').records:[],now});
 for(const row of fs.existsSync(path.join(root,'data/catalogue-reviewed-assets.json'))?read('data/catalogue-reviewed-assets.json').records:[])for(const [variant,issue]of Object.entries(row.blockedVariants||{}))result.queue.push({id:'variant-art:'+row.no+':'+row.names[0]+':'+variant,source:'reviewed-art',no:row.no,name:row.names[0],variant,releaseState:row[variant==='shiny'?'shinyRelease':'normalRelease'],artState:'exact-variant-art-unverified',priority:'urgent',disposition:'owner-attention-required',reason:issue.reason,sourceUrls:issue.sources,nextAction:issue.nextAction});
 result.status=result.sourceIssues.length?'source-failure':result.queue.length?'review-required':'reconciled';return result;
}
if(require.main===module){const report=build();fs.writeFileSync(path.join(root,'catalogue-reconciliation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,coverage:report.coverage,open:report.queue.length,sourceIssues:report.sourceIssues},null,2));if(report.status!=='reconciled'&&!process.argv.includes('--report-only'))process.exitCode=1;}
module.exports={identityKey,loadSources,loadIdentities,reconcile,build,summarizeReview};
