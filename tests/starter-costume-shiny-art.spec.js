const {test,expect}=require('@playwright/test'),{normalFixture,settled}=require('./helpers/usability-fixture.cjs'),rows=require('../data/starter-costume-shiny-assets.json').records;
const fs=require('fs'),source=fs.readFileSync(require.resolve('./normal-sync-product.spec.js'),'utf8'),install=eval('('+source.slice(source.indexOf('async function install('),source.indexOf('\nasync function settled'))+')');
for(const shiny of [false,true])test('all ten '+(shiny?'Shiny':'normal')+' costumes search/add/reload/public exact art',async({page},info)=>{
 await normalFixture(page);
 for(const r of rows){
  const input=page.locator('#wants-add-name');await input.fill(r.name.split(' (')[0]);await expect(page.locator('#wants-add-name-suggestions').getByRole('option',{name:r.name,exact:true})).toBeVisible();await page.locator('#wants-add-name-suggestions').getByRole('option',{name:r.name,exact:true}).click();
  await page.locator('.wants-add-form button').filter({hasText:'Flags & details'}).click();if(!await page.locator('#combined-editor-modal details').evaluate(e=>e.open))await page.locator('#combined-editor-modal details summary').click();await page.locator('#combined-priority').selectOption('H');await page.locator('#combined-shiny').setChecked(shiny);await page.locator('#combined-gender').selectOption(shiny?'f':'m');await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await settled(page);
 }
 const saved=await page.evaluate(()=>structuredClone(__normal.remote));await page.evaluate(()=>stopAccountSyncRuntime());await install(page,saved);await settled(page);
 for(const r of rows){
  const gender=shiny?'f':'m',entry=await page.evaluate(({name,shiny,gender})=>productDeclarations().entries.find(e=>e.name===name&&!!e.shiny===shiny&&e.gender===gender),{name:r.name,shiny,gender});expect(entry).toMatchObject({name:r.name,gender});expect(!!entry.shiny).toBe(shiny);
  await page.evaluate(e=>openCombinedEditor(combinedKey(e)),entry);await expect(page.locator('#combined-shiny')).toBeChecked({checked:shiny});await expect(page.locator('#combined-gender')).toHaveValue(gender);await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>{document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');allData.users[cur].publicDeclarations=__normal.remote.publicShares.NormalProduct.declarations.filter(e=>e.name!=='Pikachu');renderShareView(cur,'wishlist');});
 for(const r of rows){const imgs=page.locator('.share-pcard img[title='+JSON.stringify(r.name)+']');await expect(imgs).toHaveCount(1);const urls=await imgs.evaluateAll(async is=>Promise.all(is.map(async i=>{i.loading='eager';await i.decode();if(!i.naturalWidth)throw Error('No decoded image');return i.getAttribute('src');})));expect(urls).toEqual([shiny?r.asset:r.retainedNormal.asset]);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/starter-costume-shiny-local/public-'+(shiny?'shiny-':'normal-')+info.project.name+'.png',fullPage:true});await page.evaluate(()=>stopAccountSyncRuntime());
});
test('normal/Shiny renderer uses exact shared models for both genders, with no cross-costume fallback',async({page})=>{
 await normalFixture(page);await page.evaluate(rows=>{const host=document.createElement('section');host.id='starter-art-fixture';host.innerHTML=rows.map(r=>['m','f'].flatMap(g=>[false,true].map(shiny=>'<div data-name="'+r.name+'" data-shiny="'+shiny+'" data-gender="'+g+'">'+spriteImg(r.no,60,'',r.name,g,r.name,{shiny})+'</div>')).join('')).join('');document.body.append(host);},rows);
 await expect(page.locator('#starter-art-fixture img')).toHaveCount(40);await expect(page.locator('#starter-art-fixture [role=img]')).toHaveCount(0);
 for(const r of rows)for(const gender of ['m','f'])for(const shiny of [false,true]){const img=page.locator('#starter-art-fixture [data-name='+JSON.stringify(r.name)+'][data-gender="'+gender+'"][data-shiny="'+shiny+'"] img');await expect(img).toHaveAttribute('src',shiny?r.asset:r.retainedNormal.asset);expect(await img.evaluate(async i=>{i.loading='eager';await i.decode();return i.naturalWidth})).toBeGreaterThan(32);}
 await page.evaluate(()=>stopAccountSyncRuntime());
});
