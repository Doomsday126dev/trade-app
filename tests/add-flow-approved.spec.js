const{test,expect}=require('@playwright/test');const{normalFixture,settled}=require('./helpers/usability-fixture.cjs');const fs=require('fs');
const dir=process.env.ADD_FLOW_SCREENSHOTS;
async function capture(page,name){if(dir){await expect(page.locator('#toast')).toBeHidden({timeout:7000});fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+name+'.png'});}}
test('ordinary add reviews High without writing, cancels safely, saves exact size',async({page})=>{
 await normalFixture(page);await page.setViewportSize({width:390,height:844});
 const before=await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities));
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('.wants-add-form [type=submit]').click();
 await expect(page.locator('#combined-priority')).toHaveValue('H');expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
 await capture(page,'mobile-review');await page.locator('#combined-close').click();expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
 await page.locator('.wants-add-form [type=submit]').click();await page.locator('[name=combined-size][value=xxl]').check();await page.locator('[name=combined-size][value=xxs]').check();
 await expect(page.locator('#combined-xxl')).not.toBeChecked();await expect(page.locator('#combined-xxs')).toBeChecked();
 await page.locator('#combined-save').click();await settled(page);await expect(page.locator('#combined-editor-modal')).not.toHaveClass(/open/);
 const saved=await page.evaluate(()=>productDeclarations().entries.find(e=>e.name==='Squirtle'));expect(saved.p).toBe('H');expect(saved.xxs).toBe(true);expect(saved.xxl).toBe(false);
 await page.locator('.myrow[data-name="Squirtle"] .myrow-edit').click();await expect(page.locator('#combined-priority')).toHaveValue('H');await expect(page.locator('[name=combined-size][value=xxs]')).toBeChecked();
 await page.locator('#combined-preferences>summary').click();await capture(page,'mobile-details');await page.locator('#combined-close').click();
});
test('special no-rank default and legacy edit preserve values; desktop and narrow layouts',async({page})=>{
 await normalFixture(page);await page.setViewportSize({width:1440,height:1024});
 await page.locator('#wants-add-name').fill('Mewtwo');await page.locator('.wants-add-form [type=submit]').click();await expect(page.locator('#combined-priority')).toHaveValue('');await page.locator('#combined-close').click();
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('.wants-add-form [type=submit]').click();await capture(page,'desktop-review');
 await page.locator('#combined-preferences>summary').click();await capture(page,'desktop-details');
 await page.setViewportSize({width:320,height:568});await capture(page,'small-details');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#combined-close').click();
 await page.evaluate(async()=>{await addManagedIntentEntries('lf',[{name:'Squirtle',p:'',shiny:true,xxl:true,gender:'f',mod:'F',note:'keep me'}]);});await settled(page);
 await page.locator('.myrow[data-name="Squirtle"] .myrow-edit').click();await expect(page.locator('#combined-priority')).toHaveValue('');await expect(page.locator('#combined-shiny')).toBeChecked();await expect(page.locator('#combined-xxl')).toBeChecked();await expect(page.locator('#combined-gender')).toHaveValue('f');await expect(page.locator('#combined-note')).toHaveValue('keep me');
});
test('duplicate and keyboard cancellation keep data intact and focus actionable feedback',async({page})=>{
 await normalFixture(page);await page.setViewportSize({width:390,height:844});
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('.wants-add-form [type=submit]').click();await page.locator('#combined-save').click();await settled(page);
 const before=await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities));
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('.wants-add-form [type=submit]').click();await page.locator('#combined-save').click();await expect(page.locator('#combined-error')).toContainText('already on your list');await expect(page.locator('#combined-error')).toBeFocused();expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
 await page.keyboard.press('Escape');await expect(page.locator('.wants-add-form [type=submit]')).toBeFocused();
 await page.locator('#wants-add-name').fill('Bulbasaur');await page.locator('.wants-add-form [type=submit]').click();
 for(let i=0;i<16;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#combined-editor-modal').contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
});
test('localized dark mobile review keeps footer reachable and scrolls optional details',async({page})=>{
 await normalFixture(page);await page.setViewportSize({width:320,height:568});
 await page.evaluate(async()=>{await changeInterfaceLocale('de');applyTheme('dark');});
 await page.locator('#wants-add-name').fill('Squirtle');await page.locator('.wants-add-form [type=submit]').click();await expect(page.locator('#combined-save')).toBeInViewport();
 await page.locator('#combined-preferences>summary').click();await page.locator('#combined-note').scrollIntoViewIfNeeded();await expect(page.locator('#combined-note')).toBeInViewport();await expect(page.locator('#combined-save')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'small-dark-details-scrolled');
});
