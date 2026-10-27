const {test,expect}=require('@playwright/test');test.use({serviceWorkers:'block'});
const fs=require('node:fs'),{normalFixture,settled}=require('./helpers/usability-fixture.cjs');const records=require('../data/catalogue-reviewed-assets.json').records.filter(r=>!r.sourceId.startsWith('variant-followup:'));
for(const shiny of [false,true])test('finite67 exact catalogue identities persist and render every qualified variant '+shiny,async({page},info)=>{
 test.setTimeout(150000);await normalFixture(page);
 expect(await page.evaluate(()=>_specialAllItems().filter(e=>[494,649,801].includes(e.no)).length)).toBe(0);
 expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Genesect (Shock Drive)',p:'H',shiny:true}]))).toBe(false);
 const names=records.filter(r=>!r.tradeEligibility).map(r=>r.names[0]);const available=await page.evaluate(()=>_specialAllItems().map(e=>e.name));expect(names.filter(name=>!available.includes(name))).toEqual([]);
 expect(await page.evaluate(({names,shiny})=>addManagedIntentEntries('lf',names.map(name=>({name,p:'H',shiny}))),{names,shiny})).toBe(true);
 // Sixty real IndexedDB operations can outlast an expect.poll callback window.
 // Await their existing completion barrier first; retain the same saved-state assertion and timeouts.
 await page.evaluate(()=>managedAccountSyncRuntime.controller.drain());await settled(page);
 const result=await page.evaluate(async({names,shiny})=>{
  const entries=productDeclarations().entries.filter(e=>names.includes(e.name));const routes=entries.map(e=>({name:e.name,shiny:e.shiny,inline:entrySpriteUrl(e),public:Array.from(publicSpriteUrls(e.name,e.gender,e.no,e.shiny)),export:exportSpriteFallbackUrls(e),text:productShareImageDetails(e,{flags:[]})}));
  const decoded=await Promise.all(routes.map(async r=>{if(!r.public.length)return{name:r.name,missing:true};const image=new Image;image.src=r.public[0];try{await image.decode();return{name:r.name,ok:image.naturalWidth>0}}catch{return{name:r.name,ok:false}}}));
  const blob=await renderProductShareImage(entries,'Finite catalogue');return{routes,decoded,count:entries.length,flags:entries.every(e=>e.shiny===shiny),png:await new Promise(resolve=>{const reader=new FileReader;reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})};
 },{names,shiny});expect(result.count).toBe(60);expect(result.flags).toBe(true);
 for(const row of records.filter(r=>!r.tradeEligibility)){const actual=result.routes.find(r=>r.name===row.names[0]),asset=row.assets[shiny?'shiny':'default'];if(asset){expect(actual.public).toEqual([asset]);expect(actual.inline).toBe(asset);expect(actual.export).toHaveLength(1);expect(actual.export[0]).toContain(asset);expect(result.decoded.find(r=>r.name===row.names[0]).ok).toBe(true);}else{expect(actual.public).toEqual([]);expect(actual.inline).toBeNull();expect(actual.export).toEqual([]);expect(row.blockedVariants.shiny.state).toBe('owner-attention-required');}}
 fs.mkdirSync('/tmp/trade156-queue/evidence-browser',{recursive:true});fs.writeFileSync('/tmp/trade156-queue/evidence-browser/'+info.project.name+'-'+shiny+'.png',Buffer.from(result.png.split(',')[1],'base64'));const saved=await page.evaluate(()=>structuredClone(__normal.remote));const source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8');const install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');await install(page,saved);await settled(page);expect(await page.evaluate(names=>productDeclarations().entries.filter(e=>names.includes(e.name)).length,names)).toBe(60);await page.evaluate(()=>stopAccountSyncRuntime());
});

test('catalogue full picker normal and Shiny resolver audit retains all unresolved variants',async({page})=>{
 await normalFixture(page);const rows=await page.evaluate(()=>_specialAllItems().map(entry=>{const variants={};for(const shiny of [false,true]){const e={...entry,shiny},pub=Array.from(publicSpriteUrls(e.name,e.gender||'',e.no,shiny)),chain=spriteFallbackChain(e.no,e.name,e.gender||'',e.displayName||e.name,e.catalogId,shiny),html=spriteImg(e.no,34,'audit',e.name,e.gender||'',e.displayName||e.name,{shiny,urlOverride:entrySpriteUrl(entry)}),doc=new DOMParser().parseFromString(html,'text/html');variants[shiny?'shiny':'normal']={preferred:entrySpriteUrl(e),public:pub,list:doc.querySelector('img')?.getAttribute('src')||'',fallback:Array.from(chain),export:exportSpriteFallbackUrls(e)};}return{name:entry.name,no:entry.no,catalogId:entry.catalogId,variants};}));
 const report={qualification:'Routing audit of every selectable default normal/Shiny identity, not live fetch or new visual approval of every old asset. Prior proof matches are reported separately. Missing and ambiguous artwork remains open.',identities:rows.length,variantRequests:rows.length*2,normalCandidates:rows.filter(r=>r.variants.normal.public.length).length,shinyCandidates:rows.filter(r=>r.variants.shiny.public.length).length,normalMissing:rows.filter(r=>!r.variants.normal.public.length).map(r=>r.name),shinyMissing:rows.filter(r=>!r.variants.shiny.public.length).map(r=>r.name),preferredShinyUsingNormal:rows.filter(r=>r.variants.shiny.preferred&&r.variants.shiny.preferred===r.variants.normal.preferred).map(r=>r.name),rows};
 fs.mkdirSync('/tmp/trade156-queue',{recursive:true});fs.writeFileSync('/tmp/trade156-queue/full-resolver-audit.json',JSON.stringify(report,null,2));expect(report.preferredShinyUsingNormal).toEqual([]);for(const row of rows){if(row.variants.shiny.public.length)expect(row.variants.shiny.preferred).toBe(row.variants.shiny.public[0]);else expect(row.variants.shiny.preferred).toBeNull();}await page.evaluate(()=>stopAccountSyncRuntime());
});

test('all reviewed semantic duplicates display once and preserve every former saved identity',async({page})=>{
 await normalFixture(page);
 const groups=require('../data/catalogue-picker-aliases.json').groups;
 const result=await page.evaluate(groups=>{
  const pool=_specialAllItems();
  return{count:pool.length,groups:groups.map(g=>({primary:g.primary,options:pool.filter(e=>g.recordNames.includes(e.name)).map(e=>e.name),names:g.names.map(name=>({name,resolved:pokemonCatalogDomain.resolveLegacyKey(name)?.catalogId,legacy:accountSyncLegacyCatalogIdentity('costumes',name)?.catalogId})),ids:g.catalogIds.map(id=>({id,resolved:accountSyncCatalogEntryForId(id)?.catalogId,name:accountSyncCatalogEntryForId(id)?.name}))})),search:["Hoothoot (New Year)",'Hoothoot New Years',"New Year's Hoothoot"].map(q=>pool.filter(e=>e.no===163&&acMatchScore(e,q)>=0).map(e=>e.name)),distinct:['Gengar (Halloween 2020)','Gengar (Halloween 2022)','Gengar (Halloween 2023)','Polteageist (Bow, Antique)','Polteageist (Bow, Phony)'].map(name=>pokemonCatalogDomain.catalogKey(name)),semantic:pokemonCatalogDomain.resolveLegacyKey("New Year's Hoothoot")};
 },groups);
 const semantic=await page.evaluate(()=>{
  const groups=new Map();for(const entry of _specialAllItems()){
   const key=entry.no+'|'+entry.name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/\bnew years?\b/g,'new year').replace(/[^a-z0-9!?]+/g,' ').trim().split(/\s+/).sort().join(' ');
   const rows=groups.get(key)||[];rows.push(entry);groups.set(key,rows);
  }return [...groups.values()].filter(rows=>new Set(rows.map(r=>r.catalogId)).size>1).map(rows=>rows.map(r=>r.name));
 });expect(semantic).toEqual([]);
 const approvedArt=[...require('../data/costume-sprite-catalog.json').entries,...records];const actualPool=await page.evaluate(()=>_specialAllItems().map(r=>({name:r.name,no:r.no,catalogId:r.catalogId})));
 for(const art of approvedArt){const aliases=new Set(art.names||[]);expect(new Set(actualPool.filter(r=>r.no===art.no&&aliases.has(r.name)).map(r=>r.catalogId)).size,art.names[0]).toBeLessThanOrEqual(1);}
 expect(result.count).toBe(1749);
 for(let i=0;i<groups.length;i++){const g=groups[i],actual=result.groups[i];expect(actual.options).toEqual([g.primary]);for(const row of actual.names){expect(row.resolved).toBe(g.canonicalCatalogId);expect(row.legacy).toBe(g.legacyIdsByName[row.name]);}for(const row of actual.ids){expect(row.resolved).toBe(row.id);expect(row.name).toBe(g.names[g.catalogIds.indexOf(row.id)]);}}
 for(const matches of result.search)expect(matches).toEqual(['Hoothoot (New Year)']);expect(new Set(result.distinct).size).toBe(5);expect(result.semantic.canonicalKey).toBe('Hoothoot (New Year)');
 const saved=await page.evaluate(()=>{
  const rows=accountSyncProduct.listRows({lists:{costumes:{'Hoothoot (New Year)':'H','Hoothoot New Years':priValue('M','',false,false,false,true)}},orders:{},parsePriority:parsePri,catalogIdForListEntry:({lane,name,encoded})=>accountSyncLegacyCatalogIdentity(lane,name,encoded)?.catalogId||'',genderForVariant:entryGender});
  return JSON.parse(JSON.stringify(rows));
 });
 expect(saved.unresolved).toEqual([]);expect(saved.rows).toHaveLength(2);expect(new Set(saved.rows.map(r=>r.identity.catalogId)).size).toBe(2);expect(saved.rows.map(r=>r.values.shiny).sort()).toEqual([false,true]);
 await page.evaluate(()=>stopAccountSyncRuntime());
});

test('saved duplicate Hoothoot IDs keep separate normal and Shiny requests across edits and reopen',async({page})=>{
 await normalFixture(page);
 const before=await page.evaluate(async()=>{
  const rows=accountSyncProduct.listRows({lists:{costumes:{'Hoothoot (New Year)':'H','Hoothoot New Years':priValue('M','',false,false,false,true)}},orders:{},parsePriority:parsePri,catalogIdForListEntry:({lane,name,encoded})=>accountSyncLegacyCatalogIdentity(lane,name,encoded)?.catalogId||'',genderForVariant:entryGender});
  const mutations=accountSyncProduct.planTradeMutations({currentEntities:[],desiredRows:rows.rows,scope:{surface:'my-list',lanes:['costumes']}});
  await applyAccountSyncTradeMutations(mutations,(await accountSyncMutationAuthority()).controller);
  return rows.rows.map(r=>({id:r.entityId,catalogId:r.identity.catalogId,shiny:r.values.shiny}));
 });await settled(page);
 const snapshot=()=>page.evaluate(()=>accountSyncCanonicalEntities.filter(e=>!e.deleted&&e.identity.lane==='costumes').map(e=>({id:e.entityId,catalogId:e.identity.catalogId,shiny:e.values.shiny,priority:e.values.priority})).sort((a,b)=>a.id.localeCompare(b.id)));
 let actual=await snapshot();expect(actual).toHaveLength(2);for(const row of before){expect(actual.find(e=>e.id===row.id)).toMatchObject(row);}
 expect(await page.evaluate(()=>Object.keys(allData.costumes[cur]).sort())).toEqual(['Hoothoot (New Year)','Hoothoot New Years']);
 await page.evaluate(async()=>{const entry=accountSyncCanonicalEntities.find(e=>!e.deleted&&e.identity.lane==='costumes'&&e.values.shiny);await applyAccountSyncTradeMutations([{kind:'patch',entityType:'tradeEntry',entityId:entry.entityId,patch:{priority:'L'}}],(await accountSyncMutationAuthority()).controller);});await settled(page);
 const expected=await snapshot(),saved=await page.evaluate(()=>structuredClone(__normal.remote)),source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8');const install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');await install(page,saved);await settled(page);expect(await snapshot()).toEqual(expected);expect(expected.find(e=>e.shiny).priority).toBe('L');expect(expected.find(e=>!e.shiny).priority).toBe('H');await page.evaluate(()=>stopAccountSyncRuntime());
});

test('costume labels agree across picker selected editor list and normal Shiny image exports',async({page})=>{
 await normalFixture(page);const picker=await page.evaluate(()=>_specialAllItems().filter(e=>e.no===163&&/Year/.test(e.name)).map(e=>e.dn));expect(picker).toEqual(['Hoothoot (New Year Hat)']);
 expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Hoothoot (New Year)',p:'H',shiny:true}]))).toBe(true);await settled(page);
 const result=await page.evaluate(async()=>{
  const entry=productDeclarations().entries.find(e=>e.no===163);openCombinedEditor(combinedKey(entry));const editor=document.getElementById('combined-identity-name').textContent;
  const labels=[],original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){labels.push(String(text));return original.call(this,text,...args)};
  try{for(const shiny of [false,true])await renderProductShareImage([{...entry,shiny}],'Costume qualification');}finally{CanvasRenderingContext2D.prototype.fillText=original;}
  return{dn:entry.dn,editor,list:document.getElementById('combined-list').textContent,description:productShareDescription(entry),labels};
 });expect(result.dn).toBe('Hoothoot (New Year Hat)');expect(result.editor).toBe(result.dn);expect(result.list).toContain(result.dn);expect(result.description).toContain(result.dn);expect(result.labels.join(' ')).toContain('New Year Hat');expect(await page.evaluate(()=>productTextRows().find(r=>r.no===163).name)).toBe(result.dn);await page.screenshot({path:'/tmp/trade156-queue/costume-editor-'+page.context().browser().browserType().name()+'.png'});await page.evaluate(()=>stopAccountSyncRuntime());
});
