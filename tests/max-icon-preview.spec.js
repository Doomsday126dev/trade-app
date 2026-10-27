const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const fs=require('fs');const {normalFixture,settled}=require('./helpers/usability-fixture.cjs');const controls=require('./helpers/current-want-controls.cjs');
test('actual list and canvas Max comparison',async({page})=>{

 await normalFixture(page);await page.setViewportSize({width:390,height:844});
 const cache=JSON.parse(fs.readFileSync('/tmp/trade-recent-catalog-sprite-cache/manifest.json'));
 await page.route('https://raw.githubusercontent.com/PokeAPI/**',r=>{if(/\/shiny\/(?:female\/)?133.png$/.test(r.request().url()))return r.fulfill({path:'/tmp/max-originals/eevee-female-shiny.png',contentType:'image/png'});if(/\/25.png$/.test(r.request().url()))return r.fulfill({path:'/tmp/max-originals/pikachu.png',contentType:'image/png'});const a=cache.find(a=>a.url===r.request().url());return a?r.fulfill({path:a.file,contentType:'image/png'}):r.abort()});
 for(const [name,shiny,gender] of [['Deino (Dynamax)',true,'f'],['Sizzlipede (Dynamax)',false,'m'],['Charizard (Gigantamax)',true,'m'],['Cinderace (Gigantamax)',true,'f'],['Eevee',true,'f']]){
 await page.locator('#wants-add-name').fill(name.slice(0,-1));await page.getByRole('option',{name,exact:true}).click();await page.keyboard.press('Escape');await page.locator('.wants-add-form button').filter({hasText:'Options'}).click();await controls.priority(page,'H');if(await page.locator('#combined-shiny').isChecked()!==shiny){await page.locator('#combined-shiny').focus();await page.keyboard.press('Space');}await controls.genderDetails(page);await page.locator('#combined-gender').selectOption(gender);await page.locator('#combined-save').click();await settled(page);
 }
 await page.locator('#wants-add-name').fill('');await page.waitForTimeout(800);await page.locator('#wants-add-name').blur();await page.keyboard.press('Escape');
 await expect(page.locator('.myrow-trait.shiny')).toHaveCount(0);await expect(page.locator('.sprite-max-symbol')).toHaveCount(4);await expect(page.locator('.wants-row').filter({hasText:'Eevee'}).locator('.sr-only')).toContainText('Shiny');

 const offset=await page.locator('.sprite-sizzlipede-home img.myrow-sprite').evaluate(e=>getComputedStyle(e).translate);expect(offset).toMatch(/-14\.7/);
 const stage=process.env.MAX_STAGE||'new';
 if(stage==='old'){const source=fs.readFileSync('/tmp/max-originals/old-application.js','utf8');await page.evaluate(src=>{renderProductShareImage=eval('('+src+')');for(const row of document.querySelectorAll('.wants-row')){row.querySelector('.wants-name').textContent=row.dataset.name;row.querySelector('.sprite-max-symbol')?.remove();const type=/Gigantamax/.test(row.dataset.name)?'gmax':/Dynamax/.test(row.dataset.name)?'dynamax':'';row.querySelector('.myrow-sprite-wrap').insertAdjacentHTML('beforeend',maxCrownSvg(type));if(row.querySelector('.sr-only'))row.querySelector('.myrow-copy').insertAdjacentHTML('beforeend','<span class="myrow-trait shiny">✨</span>');}},source.slice(source.indexOf('async function renderProductShareImage('),source.indexOf('\nfunction refreshAll',source.indexOf('async function renderProductShareImage('))));}
 await page.locator('#wants-add-name').evaluate(e=>e.blur());await page.evaluate(async data=>{const slot=document.querySelector('.wants-row[data-name="Pikachu"] .myrow-sprite-wrap');slot.innerHTML='<img class="myrow-sprite" alt="Pikachu" src="'+data+'">';await slot.querySelector('img').decode();},'data:image/png;base64,'+fs.readFileSync('/tmp/max-originals/pikachu.png').toString('base64'));await page.waitForTimeout(4000);for(const img of await page.locator('.wants-row img.myrow-sprite').all())expect(await img.evaluate(async i=>{await i.decode();return i.naturalWidth})).toBeGreaterThan(0);
await page.screenshot({path:'/tmp/max-originals/'+stage+'-list.png',fullPage:true});

 await expect(page.locator('.wants-row').filter({hasText:'Eevee'}).locator('img.myrow-sprite')).toHaveAttribute('src','https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny/female/133.png');
 const out=await page.evaluate(async()=>{const rows=productDeclarations().entries;const blob=await renderProductShareImage(rows,'Max comparison');return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)})});fs.writeFileSync('/tmp/max-originals/'+stage+'-share.png',Buffer.from(out.split(',')[1],'base64'));
 expect(await page.evaluate(()=>exportSpriteFallbackUrls({name:'Cinderace (Gigantamax)',no:815,shiny:true,gender:'f'}) )).toEqual(['assets/sprites/go/reviewed-cinderace-shiny.png']);
 await page.evaluate(()=>stopAccountSyncRuntime());
});
