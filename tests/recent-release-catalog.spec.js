const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const fs=require('node:fs');
const {fixture,normalFixture,settled}=require('./helpers/usability-fixture.cjs');
const controls=require('./helpers/current-want-controls.cjs');
const evidence=require('../data/recent-release-coverage.json');
const normalSource=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8');
const install=eval('('+normalSource.slice(normalSource.indexOf('async function install('),normalSource.indexOf('\nasync function settled'))+')');
const hanbok='Pikachu (Orange Hanbok)';
const targets=evidence.records.map(r=>r.collection==='dynamax'?r.name+' (Dynamax)':r.name);

test('independent release inventory is selectable and public Max identities are allowlisted',async({page})=>{
 await fixture(page);
 const state=await page.evaluate(()=>({names:_specialAllItems().map(e=>e.name),max:DB.dynamax.map(e=>({name:e.name,base:window.PogoDomain.publicPokemonDex.dynamaxBase(e.name+' (Dynamax)',e.no)}))}));
 for(const name of targets)expect(state.names.filter(n=>n===name)).toHaveLength(1);
 for(const r of evidence.records.filter(r=>r.collection==='dynamax'))expect(state.max.find(e=>e.name===r.name)?.base).toBe(r.name);
 const queries={'dmax deino':'Deino (Dynamax)','d-max deino':'Deino (Dynamax)','dmax sizzlepede':'Sizzlipede (Dynamax)','Korean pika':hanbok,'Orange Hanbok':hanbok,'Korea':hanbok,'Autumn Picnic':hanbok};
 for(const [query,name]of Object.entries(queries)){await page.locator('#wants-add-name').fill(query);await expect(page.locator('#wants-add-name-suggestions').getByRole('option',{name,exact:true})).toBeVisible();}
});

for(const shiny of [false,true])test('released identities add, persist, reload and share with exact costume and Max state '+shiny,async({page},info)=>{
 test.setTimeout(180000);await normalFixture(page);
 // Replay original public PNG bytes, never substitute a generic fixture image.
 const cache=process.env.CATALOG_SPRITE_CACHE;expect(cache,'Set CATALOG_SPRITE_CACHE to the reviewed public-PNG cache').toBeTruthy();
 const assets=JSON.parse(fs.readFileSync(cache+'/manifest.json','utf8'));
 for(const asset of assets)expect(require('node:crypto').createHash('sha256').update(fs.readFileSync(asset.file)).digest('hex')).toBe(asset.sha256);
 await page.route(/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/home\/(?:shiny\/)?(?:female\/)?[0-9]+\.png$/,route=>{const asset=assets.find(a=>a.url===route.request().url());return asset?route.fulfill({path:asset.file,contentType:'image/png'}):route.abort();});
 await page.setViewportSize({width:390,height:844});
 for(const name of targets){
  await page.locator('#wants-add-name').fill(name.slice(0,-1));
  await page.locator('#wants-add-name-suggestions').getByRole('option',{name,exact:true}).click();
  await page.locator('.wants-add-form button').filter({hasText:'Flags & details'}).click();
  await controls.priority(page,'H');await page.locator('#combined-shiny').setChecked(shiny);
  if(['Uxie (Dynamax)','Mesprit (Dynamax)','Azelf (Dynamax)'].includes(name)){await controls.genderDetails(page);expect(await page.locator('#combined-gender option').evaluateAll(os=>os.map(o=>o.value))).toEqual(['']);}
  if(['Rhyhorn','Rhydon','Rhyperior','Sneasel','Weavile'].some(base=>name===base+' (Dynamax)')){await controls.genderDetails(page);await page.locator('#combined-gender').selectOption('f');}
  if(name===hanbok){await controls.genderDetails(page);expect(await page.locator('#combined-gender option').evaluateAll(os=>os.map(o=>o.value).sort())).toEqual(['','f']);await page.locator('#combined-gender').selectOption('f');}
  await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await settled(page);
 }
 const saved=await page.evaluate(()=>structuredClone(__normal.remote));await page.evaluate(()=>stopAccountSyncRuntime());await install(page,saved);await settled(page);
 const entries=await page.evaluate(()=>productDeclarations().entries);for(const name of targets){const e=entries.find(e=>e.name===name);expect(e,name).toBeTruthy();expect(!!e.shiny).toBe(shiny);if(name===hanbok||['Rhyhorn','Rhydon','Rhyperior','Sneasel','Weavile'].some(base=>name===base+' (Dynamax)'))expect(e.gender).toBe('f');}
 const exportEvidence=await page.evaluate(async names=>{
   const rows=productDeclarations().entries.filter(e=>names.includes(e.name));
   const chains=rows.map(e=>({name:e.name,urls:exportSpriteFallbackUrls(e)}));
   const blob=await renderProductShareImage(rows,'Synthetic catalog QA');
   const image=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)});
   return{chains,image};
 },targets);
 for(const r of evidence.records.filter(r=>r.collection==='dynamax'))expect(exportEvidence.chains.find(e=>e.name===r.name+' (Dynamax)').urls).toEqual(['https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(shiny?'shiny/':'')+([111,112,464,215,461].includes(r.no)?'female/':'')+r.no+'.png']);
 fs.writeFileSync('/tmp/trade-recent-catalog-evidence/export-'+info.project.name+'-'+shiny+'.png',Buffer.from(exportEvidence.image.split(',')[1],'base64'));
 await page.evaluate(()=>{document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');allData.users[cur].publicDeclarations=__normal.remote.publicShares.NormalProduct.declarations.filter(e=>e.name!=='Pikachu');renderShareView(cur,'wishlist');});

 const image=page.locator('.share-pcard img[title='+JSON.stringify(hanbok)+']');await expect(image).toHaveAttribute('src','assets/sprites/go/serebii-pikachu-orange-hanbok-female'+(shiny?'-shiny':'')+'.png');expect(await image.evaluate(async i=>{i.loading='eager';await Promise.race([i.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Image decode timed out')),8000))]);return i.naturalWidth})).toBe(120);
 await page.screenshot({path:'/tmp/trade-recent-catalog-evidence/hanbok-'+info.project.name+'-'+shiny+'.png',fullPage:true});
 await page.getByRole('button',{name:'Dynamax (13)',exact:true}).click();
 const sharedNames=await page.locator('.share-pcard-name').allTextContents();for(const r of evidence.records.filter(r=>r.collection==='dynamax'))expect(sharedNames.filter(n=>n===r.name)).toHaveLength(1);
 for(const r of evidence.records.filter(r=>r.collection==='dynamax')){const im=page.locator('.share-pcard img[title='+JSON.stringify(r.name+' (Dynamax)')+']');await expect(im).toHaveAttribute('src','https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+(shiny?'shiny/':'')+([111,112,464,215,461].includes(r.no)?'female/':'')+r.no+'.png');expect(await im.evaluate(async i=>{i.loading='eager';await Promise.race([i.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Image decode timed out')),8000))]);return i.naturalWidth})).toBeGreaterThan(32);}
 const rendered=await page.evaluate(()=>({cards:document.querySelectorAll('.share-pcard').length,html:[...document.querySelectorAll('.share-pcard')].map(e=>e.innerHTML)}));expect(rendered.cards).toBe(13);expect(entries.filter(e=>targets.includes(e.name)&&e.name!==hanbok).every(e=>e.dynamax===true||e.maxType==='dynamax'||e.name.endsWith('(Dynamax)'))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/trade-recent-catalog-evidence/shared-'+info.project.name+'-'+shiny+'.png',fullPage:true});await page.evaluate(()=>stopAccountSyncRuntime());
});
