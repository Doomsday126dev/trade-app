const currentControls=require('./helpers/current-want-controls.cjs');
const{test,expect}=require('@playwright/test'),{normalFixture,settled}=require('./helpers/usability-fixture.cjs'),rows=require('../data/reviewed-pikachu-shiny-assets.json').records,fs=require('fs'),source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8'),install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');
test('every reviewed Shiny costume/gender renders its exact local bytes',async({page})=>{
 await normalFixture(page);
 const expected=rows.flatMap(r=>r.sourceGenders.map(g=>({name:r.name,gender:g,url:r.assets[g==='f'?'femaleShiny':'shiny']})));
 await page.evaluate(rows=>{const host=document.createElement('section');host.id='pinned-sprites';host.innerHTML=rows.map(r=>spriteImg(25,48,'',r.name,r.gender,r.name,{shiny:true})).join('');document.body.append(host);},expected);
 const imgs=page.locator('#pinned-sprites img');await expect(imgs).toHaveCount(expected.length);
 for(let i=0;i<expected.length;i++){await expect(imgs.nth(i)).toHaveAttribute('src',expected[i].url);expect(await imgs.nth(i).evaluate(async im=>{im.loading='eager';await im.decode();return im.naturalWidth})).toBeGreaterThan(32);}
 await expect(page.locator('#pinned-sprites .known-unavailable')).toHaveCount(0);await page.evaluate(()=>stopAccountSyncRuntime());
});
test('all reviewed names add, acknowledge, reload and render publicly with the saved Shiny/gender',async({page})=>{
 await normalFixture(page);
 const canonicalRows=await page.evaluate(rows=>{const found=new Map();for(const r of rows){const identity=accountSyncCatalogEntryForName('wishlist',r.name),item=_specialAllItems().find(e=>e.catalogId===identity?.catalogId);if(!item)throw Error('Not selectable: '+r.name);const previous=found.get(item.catalogId);if(previous&&previous.assets.shiny!==r.assets.shiny)throw Error('Conflicting alias mapping: '+r.name);found.set(item.catalogId,{...r,name:item.name});}return [...found.values()];},rows);
 for(const r of canonicalRows){await page.locator('#wants-add-name').fill(r.name);await page.locator('.wants-add-form button').filter({hasText:'Flags & details'}).click();await currentControls.priority(page,'H');await page.locator('#combined-shiny').check();await currentControls.genderDetails(page);await page.locator('#combined-gender').selectOption(r.sourceGenders.at(-1));await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await settled(page);}
 const saved=await page.evaluate(()=>structuredClone(__normal.remote));await page.evaluate(()=>stopAccountSyncRuntime());await install(page,saved);await settled(page);
 for(const r of canonicalRows){const entry=await page.evaluate(name=>productDeclarations().entries.find(e=>e.name===name),r.name);expect(entry).toMatchObject({shiny:true,gender:r.sourceGenders.at(-1)});}
 await page.evaluate(()=>{document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');allData.users[cur].publicDeclarations=__normal.remote.publicShares.NormalProduct.declarations.filter(e=>e.name!=='Pikachu');renderShareView(cur,'wishlist')});
 for(const r of canonicalRows){const img=page.locator('.share-pcard img[title='+JSON.stringify(r.name)+']');await expect(img).toHaveAttribute('src',r.assets[r.sourceGenders.at(-1)==='f'?'femaleShiny':'shiny']);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>stopAccountSyncRuntime());
});
test('unreleased Shiny and unspecified Detective year stay blocked while ordinary choices recover',async({page})=>{
 await normalFixture(page);
 for(const name of ['Pikachu (Clone)','Pikachu (Ph_D)','Pikachu (Detective)']){await page.locator('#wants-add-name').fill(name);await page.locator('.wants-add-form button').filter({hasText:'Flags & details'}).click();await expect(page.locator('#combined-shiny')).toBeDisabled();await expect(page.locator('#combined-shiny-hint')).toBeVisible();await page.keyboard.press('Escape');}
 await page.locator('#wants-add-name').fill('Pikachu (Detective 2023)');await page.locator('.wants-add-form button').filter({hasText:'Flags & details'}).click();await expect(page.locator('#combined-shiny')).toBeEnabled();await expect(page.locator('#combined-shiny-hint')).toBeHidden();await page.keyboard.press('Escape');await page.evaluate(()=>stopAccountSyncRuntime());
});
test('existing unsupported saved Shiny is preserved on priority edit and only corrected explicitly',async({page})=>{
 await normalFixture(page);expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Pikachu (Clone)',shiny:true,p:'H'}]))).toBe(true);await settled(page);
 await page.evaluate(()=>openCombinedEditor(combinedKey(productDeclarations().entries.find(e=>e.name==='Pikachu (Clone)'))));await expect(page.locator('#combined-shiny')).toBeChecked();await expect(page.locator('#combined-shiny')).toBeEnabled();await expect(page.locator('#combined-shiny-hint')).toBeVisible();await currentControls.priority(page,'L');await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await settled(page);expect(await page.evaluate(()=>productDeclarations().entries.find(e=>e.name==='Pikachu (Clone)').shiny)).toBe(true);
 await page.evaluate(()=>openCombinedEditor(combinedKey(productDeclarations().entries.find(e=>e.name==='Pikachu (Clone)'))));await page.locator('#combined-shiny').uncheck();await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await settled(page);expect(await page.evaluate(()=>productDeclarations().entries.find(e=>e.name==='Pikachu (Clone)').shiny)).toBe(false);await page.evaluate(()=>stopAccountSyncRuntime());
});
