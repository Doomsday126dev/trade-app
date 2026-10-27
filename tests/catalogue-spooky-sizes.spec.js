const {test,expect}=require('@playwright/test');test.use({serviceWorkers:'block'});
const fs=require('node:fs'),{normalFixture,settled}=require('./helpers/usability-fixture.cjs');const records=require('../data/catalogue-reviewed-assets.json').records.filter(r=>r.sourceId.startsWith('variant-followup:spooky-size:'));
for(const shiny of [false,true])test('Spooky Festival size identities persist and render every qualified variant '+shiny,async({page},info)=>{
 test.setTimeout(150000);await normalFixture(page);
 expect(await page.evaluate(()=>_specialAllItems().filter(e=>[494,649,801].includes(e.no)).length)).toBe(0);
 expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Genesect (Shock Drive)',p:'H',shiny:true}]))).toBe(false);
 const names=records.filter(r=>!r.tradeEligibility).map(r=>r.names[0]);const available=await page.evaluate(()=>_specialAllItems().map(e=>e.name));expect(names.filter(name=>!available.includes(name))).toEqual([]);expect(available.length).toBe(1753);expect(new Set(available).size).toBe(1753);
 expect(await page.evaluate(({names,shiny})=>addManagedIntentEntries('lf',names.map(name=>({name,p:'H',shiny}))),{names,shiny})).toBe(true);
 // Await the existing persistence completion barrier before reading saved state.
 // Await their existing completion barrier first; retain the same saved-state assertion and timeouts.
 await page.evaluate(()=>managedAccountSyncRuntime.controller.drain());await settled(page);
 const result=await page.evaluate(async({names,shiny})=>{
  const entries=productDeclarations().entries.filter(e=>names.includes(e.name));const routes=entries.map(e=>({name:e.name,shiny:e.shiny,inline:entrySpriteUrl(e),public:Array.from(publicSpriteUrls(e.name,e.gender,e.no,e.shiny)),export:exportSpriteFallbackUrls(e),text:productShareImageDetails(e,{flags:[]})}));
  const decoded=await Promise.all(routes.map(async r=>{if(!r.public.length)return{name:r.name,missing:true};const image=new Image;image.src=r.public[0];try{await image.decode();return{name:r.name,ok:image.naturalWidth>0}}catch{return{name:r.name,ok:false}}}));
  const blob=await renderProductShareImage(entries,'Finite catalogue');return{routes,decoded,count:entries.length,flags:entries.every(e=>e.shiny===shiny),png:await new Promise(resolve=>{const reader=new FileReader;reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})};
 },{names,shiny});expect(result.count).toBe(8);expect(result.flags).toBe(true);
 for(const row of records.filter(r=>!r.tradeEligibility)){const actual=result.routes.find(r=>r.name===row.names[0]),asset=row.assets[shiny?'shiny':'default'];if(asset){expect(actual.public).toEqual([asset]);expect(actual.inline).toBe(asset);expect(actual.export).toHaveLength(1);expect(actual.export[0]).toContain(asset);expect(result.decoded.find(r=>r.name===row.names[0]).ok).toBe(true);}else{expect(actual.public).toEqual([]);expect(actual.inline).toBeNull();expect(actual.export).toEqual([]);expect(row.blockedVariants.shiny.state).toBe('owner-attention-required');}}
 fs.mkdirSync('/tmp/trade161-spooky-browser',{recursive:true});fs.writeFileSync('/tmp/trade161-spooky-browser/'+info.project.name+'-'+shiny+'.png',Buffer.from(result.png.split(',')[1],'base64'));const saved=await page.evaluate(()=>structuredClone(__normal.remote));const source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8');const install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');await install(page,saved);await settled(page);expect(await page.evaluate(names=>productDeclarations().entries.filter(e=>names.includes(e.name)).length,names)).toBe(8);await page.evaluate(()=>stopAccountSyncRuntime());
});
