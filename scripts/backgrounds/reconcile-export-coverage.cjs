'use strict';
// Research-to-release coverage check. It never converts source observations into
// eligibility decisions: every pair needs an explicit, evidenced disposition.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const key=p=>JSON.stringify([p.background_id,p.source_variant_id,p.dex]);
function reconcile(inventory,review,{assetRoot,now=Date.now(),maxAgeDays=1}={}){
 const problems=[],counts={observed:0,accepted:0,excluded:0,unresolved:0,sourceOnly:0,sourceOnlyUnresolved:0};
 const date=Date.parse(inventory?.as_of||'');
 if(!Number.isFinite(date)||date>now||now-date>maxAgeDays*86400000)problems.push('Source inventory timestamp is missing, future-dated or stale.');
 if(!Array.isArray(inventory?.pairs)||!inventory.pairs.length)problems.push('Source inventory has no pairs or an unexpected schema.');
 if(!Array.isArray(review?.decisions))problems.push('Reviewed decisions are missing or have an unexpected schema.');
 if(!Array.isArray(inventory?.source_only)||!Array.isArray(review?.source_only_decisions))problems.push('Source-only identity inventory or review is missing.');
 if(!Array.isArray(inventory?.picker_ids)||!inventory.picker_ids.length||inventory.picker_ids.some(x=>typeof x!=='string'||!x)||new Set(inventory.picker_ids).size!==inventory.picker_ids.length)problems.push('Actual selectable picker inventory is missing, empty or ambiguous.');
 const picker=new Set(inventory?.picker_ids||[]);
 const source=new Map(),decisions=new Map();
 for(const pair of inventory?.pairs||[]){const k=key(pair);if(!pair.background_id||!pair.source_variant_id||!Number.isInteger(pair.dex)||typeof pair.normal_claim!=='boolean'||!Array.isArray(pair.shiny_positive_event_ids)||source.has(k))problems.push(`Invalid or duplicate source pair: ${k}`);else source.set(k,pair);}
 for(const d of review?.decisions||[]){const k=key(d);if(decisions.has(k))problems.push(`Duplicate decision: ${k}`);else decisions.set(k,d);}
 counts.observed=source.size;
 for(const[k,pair]of source){
  const d=decisions.get(k);
  if(!d||d.disposition==='unresolved'){counts.unresolved++;continue;}
  if(!Array.isArray(d.evidence)||!d.evidence.length||d.evidence.some(x=>!/^https:\/\//.test(x))){problems.push(`Evidence required: ${k}`);counts.unresolved++;continue;}
  if(d.disposition==='exclude'){if(!d.reason){problems.push(`Exclusion reason required: ${k}`);counts.unresolved++;}else counts.excluded++;continue;}
  if(d.disposition!=='include'||!picker.has(d.catalog_id)||!d.artwork||d.artwork.visual_identity_reviewed!==true){problems.push(`Exact identity and visually reviewed artwork required: ${k}`);counts.unresolved++;continue;}
  const variants=new Set(d.variants||[]);
  if(!variants.size||[...variants].some(x=>!['normal','shiny'].includes(x))){problems.push(`Invalid variant coverage: ${k}`);counts.unresolved++;continue;}
  if(pair.normal_claim&&!variants.has('normal')||pair.shiny_positive_event_ids?.length&&!variants.has('shiny')){problems.push(`Claimed normal/Shiny combination lacks a decision: ${k}`);counts.unresolved++;continue;}
  const rel=d.artwork.path,expected=d.artwork.sha256;
  const root=path.resolve(assetRoot||'.'),resolved=path.resolve(root,rel||'');
  const safePath=rel&&resolved.startsWith(root+path.sep)&&fs.existsSync(resolved)&&fs.realpathSync(resolved).startsWith(fs.realpathSync(root)+path.sep);
  if(!safePath||!/^[0-9a-f]{64}$/.test(expected||'')||crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex')!==expected){problems.push(`Missing or mismatched exact artwork: ${k}`);counts.unresolved++;continue;}
  counts.accepted++;
 }
 const orphanReview=new Map();for(const d of review?.source_only_decisions||[]){if(!d.id||orphanReview.has(d.id))problems.push(`Invalid or duplicate source-only decision: ${d.id}`);else orphanReview.set(d.id,d);}
 const orphanIds=new Set();for(const item of inventory?.source_only||[]){if(!item.id||orphanIds.has(item.id)){problems.push(`Invalid or duplicate source-only identity: ${item.id}`);continue;}orphanIds.add(item.id);counts.sourceOnly++;const d=orphanReview.get(item.id);if(!d||d.disposition!=='exclude'||!d.reason||!Array.isArray(d.evidence)||!d.evidence.length||d.evidence.some(x=>!/^https:\/\//.test(x))){counts.sourceOnlyUnresolved++;}}
 for(const id of orphanReview.keys())if(!orphanIds.has(id))problems.push(`Source-only decision has no current source identity: ${id}`);
 if(counts.sourceOnlyUnresolved)problems.push(`${counts.sourceOnlyUnresolved} source-only identities still require review or explicit eligible pair observations.`);
 for(const k of decisions.keys())if(!source.has(k))problems.push(`Decision has no current source observation: ${k}`);
 if(counts.unresolved)problems.push(`${counts.unresolved} observed pairs still require review.`);
 return{ok:problems.length===0,counts,problems};
}
if(require.main===module){
 try{const[inventoryFile,reviewFile,assetRoot]=process.argv.slice(2);if(!inventoryFile||!reviewFile||!assetRoot)throw Error('Usage: node reconcile-export-coverage.cjs INVENTORY REVIEW ASSET_ROOT');const report=reconcile(JSON.parse(fs.readFileSync(inventoryFile)),JSON.parse(fs.readFileSync(reviewFile)),{assetRoot});console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={reconcile};
