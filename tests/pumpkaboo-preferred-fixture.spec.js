const {test,expect}=require('@playwright/test');
const {normalFixture}=require('./helpers/usability-fixture.cjs');
const {ids,preferredArt,installPumpkabooArt}=require('./helpers/pumpkaboo-art-fixture.cjs');
const rows=Object.keys(ids).flatMap(name=>[false,true].flatMap(shiny=>['m','f'].map(gender=>({name,shiny,gender,no:710,url:preferredArt({name},shiny)}))));
async function render(page){await page.evaluate(rows=>{const host=document.createElement('section');host.id='pumpkaboo-proof';host.innerHTML=rows.map(r=>spriteImg(r.no,50,'',r.name,r.gender,r.name,{shiny:r.shiny})).join('');document.body.append(host);},rows);}
test('network-isolated fixture reproduces all16 Pumpkaboo placeholders without original HOME routes',async({page})=>{
 await normalFixture(page);await render(page);await expect(page.locator('#pumpkaboo-proof [role=img]')).toHaveCount(16);
});
test('verified original HOME fixture renders every exact Pumpkaboo size gender and Shiny identity',async({page})=>{
 await normalFixture(page);await installPumpkabooArt(page);await render(page);const imgs=page.locator('#pumpkaboo-proof img');await expect(imgs).toHaveCount(16);
 for(let i=0;i<rows.length;i++){await expect(imgs.nth(i)).toHaveAttribute('src',rows[i].url);expect(await imgs.nth(i).evaluate(async im=>{im.loading='eager';await im.decode();return im.naturalWidth})).toBeGreaterThan(32);}
 await expect(page.locator('#pumpkaboo-proof [role=img]')).toHaveCount(0);
});
