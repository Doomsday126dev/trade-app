const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {install,settled}=require('./helpers/more-application.cjs');
test.use({serviceWorkers:'block'});
const output=process.env.APPEARANCE_OUTPUT_DIR;
async function capture(page,name){if(!output)return;fs.mkdirSync(output,{recursive:true});await expect(page.locator('#toast')).toBeHidden();await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});}
async function localeThroughSettings(page,locale){
  await page.locator('#nav-more').click();await page.locator('#more-settings').click();
  await page.locator('[data-settings-target="language"]').click();
  await page.locator('#settings-language').selectOption(locale);
  await page.locator('.settings-modal-close').click();
  await page.locator('#nav-mylist').click();
}
function noOverflow(page){return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);}

test('neutral default is the coherent dark canvas and a clear Settings choice',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await install(page);
  await page.evaluate(()=>applyTheme('dark'));
  expect(await page.evaluate(()=>({wallpaper:allData.users[cur].wallpaper||null,background:getComputedStyle(document.body).backgroundColor,canvas:getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas').trim()}))).toMatchObject({wallpaper:null,background:'rgb(17, 19, 22)'});
  expect(await page.evaluate(async()=>({splash:(await(await fetch('manifest.json')).json()).background_color,chrome:document.querySelector('meta[name="theme-color"]').content}))).toEqual({splash:'#111316',chrome:'#111316'});
  await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-label','Neutral');
  await capture(page,'appearance-desktop-neutral');
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-neutral');
  await page.locator('.settings-modal-close').click();
});

test('explicit wallpaper survives light/dark theme transitions',async({page})=>{
  await install(page);await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('[data-settings-theme="dark"]').click();await page.locator('#wp-picker .ocean').click();
  await page.locator('#settings-background-group .btn-primary').click();
  expect(await page.evaluate(()=>({stored:allData.users[cur].wallpaper,applied:document.body.classList.contains('wp-ocean')}))).toEqual({stored:'ocean',applied:true});
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-saved-ocean');
  await page.evaluate(()=>applyTheme('light'));
  expect(await page.evaluate(()=>({stored:allData.users[cur].wallpaper,neutral:document.body.classList.contains('wp-mono')}))).toEqual({stored:'ocean',neutral:true});
  await page.evaluate(()=>applyTheme('dark'));
  await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('wp-ocean'))).toBe(true);
});

test('hydrated first-use guidance is inline, localized, and never mistaken for loading or filtered-empty',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#wants-empty-import')).toBeVisible();await expect(page.locator('#wants-share-guide')).toBeHidden();
    await expect(page.locator('#wants-empty-import strong')).toHaveText('Start with a Pokémon you want');
    expect(await noOverflow(page)).toBe(true);await capture(page,`first-use-${width}`);
  }
  await page.evaluate(async()=>{await stopAccountSyncRuntime();_firstSyncDone=false;__editorFixture.holdReads=true;window.__pendingAppearanceHydration=ensureAccountSyncRuntime();renderMyList();});
  await expect.poll(()=>page.evaluate(()=>__editorFixture.readWaiters.length)).toBeGreaterThan(0);
  await expect(page.locator('#wants-empty-import')).toBeHidden();await expect(page.locator('#wants-share-guide')).toBeHidden();
  await page.evaluate(async()=>{__editorFixture.holdReads=false;__editorFixture.readWaiters.splice(0).forEach(resolve=>resolve());await __pendingAppearanceHydration;renderMyList();});await settled(page);
  await expect(page.locator('#wants-empty-import')).toBeVisible();
  for(const locale of ['ja','es','de']){
    await localeThroughSettings(page,locale);await expect(page.locator('#wants-empty-import strong')).not.toBeEmpty();
    expect(await noOverflow(page)).toBe(true);
  }
  await page.setViewportSize({width:320,height:650});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await noOverflow(page)).toBe(true);await capture(page,'first-use-320-de-text-200');
  await page.locator('#wants-empty-import button').scrollIntoViewIfNeeded();await expect(page.locator('#wants-empty-import button')).toBeInViewport();
  await capture(page,'first-use-320-de-text-200-action');
  await page.evaluate(()=>{document.documentElement.style.fontSize='';applyTheme('dark')});await page.setViewportSize({width:390,height:900});await capture(page,'first-use-dark-390');
});

test('returning guidance uses owned hydration, preserves operational and history state, and dismisses locally',async({page})=>{
  await install(page);await page.locator('#nav-mylist').click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#wants-share-guide')).toBeVisible();await expect(page.locator('#wants-empty-import')).toBeHidden();
    expect(await noOverflow(page)).toBe(true);await capture(page,`returning-${width}`);
  }
  await page.evaluate(()=>applyTheme('dark'));await capture(page,'returning-dark-390');
  const before=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:localStorage.getItem('pogoWhatsNewSeen'),tour:localStorage.getItem('pogoTourSeen')}));
  await page.locator('#wants-share-guide .btn-secondary').click();await expect(page.locator('#product-share-modal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#wants-share-guide .btn-secondary')).toBeFocused();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(before.writes);
  await page.locator('#wants-share-guide .btn-ghost').click();await expect(page.locator('#wants-share-guide')).toBeHidden();
  await expect(page.locator('.wants-list-toolbar .btn').first()).toBeFocused();
  await page.locator('#nav-more').click();await page.locator('#nav-mylist').click();await expect(page.locator('#wants-share-guide')).toBeHidden();
  expect(await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:localStorage.getItem('pogoWhatsNewSeen'),tour:localStorage.getItem('pogoTourSeen')}))).toEqual(before);
  await page.evaluate(()=>setSyncStatus('localOnly'));await expect(page.locator('#sync-banner')).toBeVisible();
  await expect(page.locator('#wants-share-guide')).toBeHidden();await page.evaluate(()=>setSyncStatus('online'));
  await page.evaluate(()=>{setWantsFindOpen(true)});await page.locator('#combined-filter').fill('NoMatchingSpecies');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
});
