'use strict';
// Reporting only: no source row is removed and no identity/art/release is approved.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
function observationHash(row){return hash({id:row.id,no:row.no??null,name:row.name??null,source:row.source,sourceSprite:row.sourceSprite??null,sourceUrl:row.sourceUrl??null,releaseState:row.releaseState??null,files:(row.files||[]).map(({path,gitBlobSha})=>({path,gitBlobSha})).sort((a,b)=>a.path.localeCompare(b.path))});}
function loadContext(root){
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
 const identities=require('./reconcile-catalogue.cjs').loadIdentities(),proofs=new Map();
 const checks=read('data/catalogue-art-checks.json').records,route=read('data/catalogue-variant-route-review.json');
 function add(name,no,variant,proof){
  const item=identities.all.find(r=>r.name===name&&r.no===no);
  if(!item||!proof?.sha256||!/^[a-f0-9]{64}$/.test(proof.sha256)||!proof.url)return;
  const list=proofs.get(item.catalogId)||[];
  const pin={variant,url:proof.url,sha256:proof.sha256,...(proof.gitBlobSha?{gitBlobSha:proof.gitBlobSha}:{}),...(proof.asset?{asset:proof.asset}:{}),...(proof.assetKey?{assetKey:proof.assetKey}:{})};
  if(!list.some(r=>JSON.stringify(r)===JSON.stringify(pin)))list.push(pin);proofs.set(item.catalogId,list);
 }
 const checked=(name,no,variant,url)=>{const p=checks.find(r=>r.no===no&&r.url===url&&r.shiny===(variant==='shiny')&&r.status==='verified-bytes'&&r.decoded&&!r.gender);if(p)add(name,no,variant,p);};
 for(const r of route.homeRows||[]){if(r.state!=='qualified-exact-source-model')continue;checked(r.name,r.no,'shiny',r.url);checked(r.name,r.no,'normal',r.url.replace('/home/shiny/','/home/'));}
 for(const r of read('data/catalogue-selectable-repair.json').records){if(r.normalArt?.status==='verified-bytes'&&r.normalArt.decoded)add(r.name,r.no,'normal',r.normalArt);if(r.shinyArt?.status==='verified-bytes'&&r.shinyArt.decoded)add(r.name,r.no,'shiny',r.shinyArt);}
 for(const r of route.otherForms||[])for(const variant of ['normal','shiny'])checked(r.name,r.no,variant,r[variant]);
 for(const r of read('data/catalogue-normal-preferred-review.json').rows)if(r.state==='qualified-exact-preferred-art'&&r.decoded?.status==='decoded'&&r.sourceFetchState==='verified-bytes')add(r.name,r.no,'normal',r);
 const art=[...read('data/costume-sprite-catalog.json').entries,...read('data/catalogue-reviewed-assets.json').records];
 for(const r of art){if(r.status!=='exact')continue;for(const [key,asset]of Object.entries(r.assets||{})){
  const variant=/shiny/i.test(key)?'shiny':'normal';if(r.blockedVariants?.[variant]||!r.sha256?.[key])continue;
  const bytes=fs.readFileSync(path.join(root,asset));if(hash(bytes)!==r.sha256[key])throw Error('Reviewed artwork bytes changed: '+asset);
  const p={assetKey:key,url:r.artProof?.[key]?.url||r.sourceUrl||asset,asset,sha256:r.sha256[key],gitBlobSha:crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')};
  for(const name of r.names)add(name,r.no,variant,p);
 }}
 const resolverHash=hash(['js/app/application.js','js/domain/spriteSlugs.js','js/domain/publicPokemonDex.js','js/domain/costumeSpriteCatalog.js','data.js'].map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
 const fingerprint=id=>hash({resolverHash,catalogId:id,proofs:(proofs.get(id)||[]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
 return{identities,proofs,resolverHash,fingerprint};
}
function summarize(report,register,context){
 if(register.schemaVersion!==1||!Array.isArray(register.rows)||!Array.isArray(register.knownIssues))throw Error('Invalid monitor review crosswalk');
 const pins=new Map();for(const row of register.rows){if(!row.id||pins.has(row.id)||!row.category||!/^[a-f0-9]{64}$/.test(row.observationHash))throw Error('Invalid or duplicate monitor row pin');pins.set(row.id,row);}
 const selector=new Map(context.identities.all.map(row=>[row.catalogId,row]));const counts={},rows=[],used=new Set();
 for(const raw of report.queue){
  const pin=pins.get(raw.id);if(pin)used.add(raw.id);
  const sourceUnchanged=Boolean(pin&&pin.observationHash===observationHash(raw));
  const target=sourceUnchanged&&pin.catalogId?selector.get(pin.catalogId):null;
  const runtimeUnchanged=Boolean(target&&pin.runtimeFingerprint===context.fingerprint(pin.catalogId));
  const art=target?context.proofs.get(target.catalogId)||[]:[];
  const variants=Object.fromEntries(['normal','shiny'].map(variant=>{const qualified=art.filter(p=>p.variant===variant);return[variant,{runtimeArtQualified:runtimeUnchanged&&qualified.length>0,proofs:qualified,sourceOriginalMatches:sourceUnchanged&&runtimeUnchanged&&(raw.files||[]).filter(f=>(/\.s(?:\.|$)|_shiny\.png$/.test(f.path)?'shiny':'normal')===variant).some(f=>qualified.some(p=>p.gitBlobSha&&p.gitBlobSha===f.gitBlobSha))}];}));
  let category=!sourceUnchanged?'new-or-changed-source':pin.catalogId&&!target?'selectable-identity-changed':target&&!runtimeUnchanged?'runtime-route-or-proof-changed':pin.category;
  const bucket=/^(policy|temporary|battle|owner-clarification|news-other-product)/.test(category)?'retained-policy-or-input':category==='known-art-gap'?'confirmed-art-gap':category==='known-identity-gap'?'known-identity-gap':category==='upcoming-release'?'upcoming-release':category==='news-review'?'news-review':!sourceUnchanged||category.endsWith('-changed')?'changed-review':target?'evidence-join-backlog':'identity-or-scope-review';
  counts[bucket]=(counts[bucket]||0)+1;
  rows.push({id:raw.id,category,bucket,sourceUnchanged,identityPresent:Boolean(target),selectableCatalogId:target?.catalogId||null,runtimeUnchanged,variants});
 }
 const knownIssues=register.knownIssues.map(issue=>({...issue,currentlySelectable:context.identities.all.some(r=>r.no===issue.no&&r.name===issue.name)}));
 return{schemaVersion:1,rawRows:report.queue.length,rawObservationsRetained:true,counts,rows,knownIssues,reviewRowsNotObservedInRun:[...pins.keys()].filter(id=>!used.has(id)),qualification:'Classification is not artwork approval or release eligibility. Per-variant original hashes and separate current runtime proof are retained; different source artwork remains an evidence join. Nothing is suppressed, baseline-renewed or silently promoted. Missing selector, changed route/proof and changed source re-enter review.'};
}
function markdown(summary){
 return '\n\n### Actionable catalogue review\n\nNew or changed source/runtime evidence: '+(summary.counts['changed-review']||0)+'. Known work below remains open; it is not newly discovered on every run.\n\n'+summary.knownIssues.map(r=>'- '+r.name+': '+r.kind+'; '+r.state+(r.currentlySelectable?' (already selectable)':' (not selectable)')+'. '+r.action).join('\n')+'\n\nRetained raw leads: '+summary.rawRows+'. Work buckets: '+JSON.stringify(summary.counts)+'. These are leads, not a count of missing Pokémon.\n\nSource classification never approves artwork or release. Exact source variants and current runtime proof remain separate. See actionSummary in catalogue-reconciliation.json for every retained row and pin state.\n';
}
module.exports={hash,observationHash,loadContext,summarize,markdown};
