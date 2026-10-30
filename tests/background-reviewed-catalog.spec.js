const{test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const{install}=require('./helpers/want-editor-application.cjs');
test('disabled startup makes no background request; reviewed records resolve against actual app IDs without enabling choices',async({page})=>{
 let loads=0;page.on('request',r=>{if(r.url().includes('/data/background-runtime-catalog.json'))loads++;});
 await install(page,null,{backgroundRollout:false});expect(await page.evaluate(async()=>{await loadReviewedBackgroundCatalogue();return{enabled:BACKGROUND_ROLLOUT.enabled,complete:backgroundExportCatalog.coverageComplete,reads:__editorFixture.reads.filter(p=>p.startsWith('background')).length};})).toEqual({enabled:false,complete:false,reads:0});expect(loads).toBe(0);
 const result=await page.evaluate(async()=>{const response=await fetch('data/background-runtime-catalog.json'),payload=await response.json();backgroundExportCatalog=BackgroundEditorAdapter.readCatalogue(payload,{resolveEntry:accountSyncCatalogEntryForId});return{records:backgroundExportCatalog.records.length,complete:backgroundExportCatalog.coverageComplete,choices:productShareBackgroundChoices({name:'Pikachu',catalogId:'pokemon:25:standard:legacy:Pikachu',category:'wishlist',shiny:false}).length};});
 expect(result.records).toBeGreaterThan(2000);expect(result.complete).toBe(false);expect(result.choices).toBe(0);
});
test('all packaged approved static artwork decodes in the browser without synthetic image substitution',async({page})=>{
 await page.goto('/?reviewed-art-decode');
 const decoded=await page.evaluate(async()=>{const manifest=await(await fetch('data/background-art-manifest.json')).json(),pending=manifest.assets.slice(),results=[];await Promise.all(Array.from({length:4},async()=>{while(pending.length){const a=pending.shift(),img=new Image();try{img.src=a.url;await img.decode();results.push({url:a.url,width:img.naturalWidth,height:img.naturalHeight});}catch{results.push({url:a.url,error:'decode-failed'});}finally{img.src='';}}}));return{expected:manifest.assetCount,results};});
 expect(decoded.results).toHaveLength(decoded.expected);expect(decoded.results.filter(r=>r.error)).toEqual([]);expect(decoded.results.every(r=>r.width>=128&&r.height>=128)).toBe(true);
});
test('verified subset is usable only after explicit rollout while completeness remains false',async({page})=>{
 await install(page,null,{backgroundRollout:false});
 const result=await page.evaluate(async()=>{const response=await fetch('data/background-runtime-catalog.json');backgroundExportCatalog=BackgroundEditorAdapter.readCatalogue(await response.json(),{resolveEntry:accountSyncCatalogEntryForId});const before=backgroundCatalogueReady();BACKGROUND_ROLLOUT.enabled=true;try{const after=backgroundCatalogueReady(),choices=productShareBackgroundChoices({name:'Pikachu',catalogId:'pokemon:25:standard:legacy:Pikachu',category:'wishlist',shiny:false}).length;backgroundExportCatalog={...backgroundExportCatalog,releaseScope:null};return{before,after,choices,complete:backgroundExportCatalog.coverageComplete,missingScope:backgroundCatalogueReady()};}finally{BACKGROUND_ROLLOUT.enabled=true;}});
 expect(result.before).toBe(false);expect(result.after).toBe(true);expect(result.choices).toBeGreaterThan(0);expect(result.complete).toBe(false);expect(result.missingScope).toBe(false);
});
