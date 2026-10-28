const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {install,seedDiscovery,settled}=require('./helpers/more-application.cjs');
const {install:installEditor}=require('./helpers/want-editor-application.cjs');
test.use({serviceWorkers:'block'});
const output=process.env.APPEARANCE_OUTPUT_DIR;
async function capture(page,name){if(!output)return;fs.mkdirSync(output,{recursive:true});await expect(page.locator('#toast')).toBeHidden();await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});}
async function localeThroughSettings(page,locale){
  await page.locator('#nav-more').click();await page.locator('.more-entry[onclick*="section:\'language\'"]').click();
  await page.locator('#settings-language').selectOption(locale);
  await page.locator('.settings-modal-close').click();
  await page.locator('#nav-mylist').click();
}
function noOverflow(page){return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);}

test('neutral default is the coherent dark canvas and a clear Settings choice',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await install(page);
  const writes=await page.evaluate(()=>[...__editorFixture.writes]);
  await page.locator('.more-entry[onclick*="section:\'appearance\'"]').click();
  await page.locator('[data-settings-theme="dark"]').click();
  expect(await page.evaluate(()=>({wallpaper:allData.users[cur].wallpaper||null,background:getComputedStyle(document.body).backgroundColor,canvas:getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas').trim()}))).toMatchObject({wallpaper:null,background:'rgb(25, 27, 32)',canvas:'#191b20'});
  expect(await page.evaluate(async()=>({splash:(await(await fetch('manifest.json')).json()).background_color,chrome:document.querySelector('meta[name="theme-color"]').content}))).toEqual({splash:'#111316',chrome:'#111316'});
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-label','Default');
  await capture(page,'appearance-desktop-neutral');
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-neutral');
  await page.locator('.settings-modal-close').click();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
});

test('explicit wallpaper survives save, cancel, theme changes and a synthetic-account reload',async({page})=>{
  await install(page);await page.locator('.more-entry[onclick*="section:\'appearance\'"]').click();
  await page.locator('[data-settings-theme="dark"]').click();await page.locator('#wp-picker .ocean').click();
  await page.locator('#settings-background-group .btn-primary').click();
  await settled(page);
  expect(await page.evaluate(()=>({stored:allData.users[cur].wallpaper,applied:document.body.classList.contains('wp-ocean')}))).toEqual({stored:'ocean',applied:true});
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-saved-ocean');
  await page.locator('#wp-picker .forest').click();
  await page.locator('.settings-modal-close').click();
  await page.locator('.more-entry[onclick*="section:\'appearance\'"]').click();
  await expect(page.locator('#wp-picker .ocean')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>allData.users[cur].wallpaper)).toBe('ocean');
  await page.locator('[data-settings-theme="light"]').click();
  expect(await page.evaluate(()=>({stored:allData.users[cur].wallpaper,neutral:document.body.classList.contains('wp-mono')}))).toEqual({stored:'ocean',neutral:true});
  await page.locator('[data-settings-theme="dark"]').click();
  await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('wp-ocean'))).toBe(true);
  await page.emulateMedia({colorScheme:'dark'});await page.locator('[data-settings-theme="auto"]').click();
  await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('wp-ocean'))).toBe(true);
  await page.locator('.settings-modal-close').click();
  const remote=await page.evaluate(()=>structuredClone(__editorFixture.remote));await installEditor(page,remote);await page.evaluate(seedDiscovery);
  await page.locator('.more-entry[onclick*="section:\'appearance\'"]').click();
  await expect(page.locator('#wp-picker .ocean')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>allData.users[cur].wallpaper)).toBe('ocean');
});

test('hydrated empty My List stays concise, localized and distinct from a filtered populated list',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();
  const empty=page.locator('#combined-list > .empty');
  const writes=await page.evaluate(()=>[...__editorFixture.writes]);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(empty).toBeVisible();await expect(empty).toHaveText(await page.evaluate(()=>i18nCore.t('contextSearch.empty')));
    await expect(page.locator('#wants-empty-import,#wants-share-guide')).toHaveCount(0);
    await expect(page.locator('#wants-add-name')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);await capture(page,`first-use-${width}`);
  }
  for(const locale of ['ja','es','de']){
    await localeThroughSettings(page,locale);await expect(empty).toHaveText(await page.evaluate(()=>i18nCore.t('contextSearch.empty')));
    expect(await noOverflow(page)).toBe(true);
  }
  await page.setViewportSize({width:320,height:650});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await noOverflow(page)).toBe(true);await capture(page,'first-use-320-de-text-200');
  await page.locator('#wants-add-name').scrollIntoViewIfNeeded();await expect(page.locator('#wants-add-name')).toBeInViewport();
  await page.evaluate(()=>{document.documentElement.style.fontSize='';applyTheme('dark')});await page.setViewportSize({width:390,height:900});
  await localeThroughSettings(page,'en');
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
  await page.locator('#wants-add-name').fill('Bulbasaur');await page.locator('#wants-add-name').press('Escape');
  await page.locator('[data-wants-add-priority="H"]').click();await page.locator('.wants-add-form [type="submit"]').click();await settled(page);
  await expect(empty).toHaveCount(0);await expect(page.locator('#combined-list .wants-row')).toHaveCount(1);
  await page.evaluate(()=>setWantsFindOpen(true));await page.locator('#combined-filter').fill('NoMatchingSpecies');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);await expect(empty).toHaveCount(0);
  await expect(page.locator('#wants-empty-import,#wants-share-guide')).toHaveCount(0);
});

test('populated My List leaves Share in the toolbar without a redundant reminder or viewing writes',async({page})=>{
  await install(page);await page.locator('#nav-mylist').click();
  const before=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:localStorage.getItem('pogoWhatsNewSeen'),tour:localStorage.getItem('pogoTourSeen')}));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#wants-share-guide')).toHaveCount(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
    await expect(page.locator('.wants-list-toolbar .btn').first()).toBeVisible();
    expect(await noOverflow(page)).toBe(true);await capture(page,`populated-no-reminder-${width}`);
  }
  for(const locale of ['ja','es','de']){
    await localeThroughSettings(page,locale);await expect(page.locator('#wants-share-guide')).toHaveCount(0);
    await expect(page.locator('.wants-list-toolbar .btn').first()).toHaveText(await page.evaluate(()=>i18nCore.t('product.share')));
    expect(await noOverflow(page)).toBe(true);
  }
  await localeThroughSettings(page,'en');
  await page.locator('.wants-list-toolbar .btn').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('#product-share-modal')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('.wants-list-toolbar .btn').first()).toBeFocused();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(before.writes);
  expect(await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:localStorage.getItem('pogoWhatsNewSeen'),tour:localStorage.getItem('pogoTourSeen')}))).toEqual(before);
  await page.evaluate(()=>setSyncStatus('localOnly'));await expect(page.locator('#sync-banner')).toBeVisible();
  await expect(page.locator('#sync-banner-action')).toBeVisible();await page.evaluate(()=>setSyncStatus('online'));
  await page.evaluate(()=>setWantsFindOpen(true));await page.locator('#combined-filter').fill('NoMatchingSpecies');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
});

test('Updates stays quiet and read-only while operational sync alerts remain visible',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();
  await expect(page.locator('#bell-btn,#bell-badge,#whatsnew-modal')).toHaveCount(0);
  await expect(page.locator('#sync-banner')).toBeHidden();
  const before=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:allData.users[cur].whatsNewSeen||null,local:localStorage.getItem('pogoWhatsNewSeen')}));
  await page.locator('#nav-more').click();await page.locator('#more-updates').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#tab-updates')).toBeVisible();await expect(page.locator('#updates-title')).toBeFocused();
  await expect(page.locator('#updates-list article')).toHaveCount(2);
  await expect(page.locator('#updates-list')).not.toContainText('v4.6.31');
  await capture(page,'quiet-updates');
  await page.locator('#updates-back').click();await expect(page.locator('#more-updates')).toBeFocused();
  await settled(page);
  const after=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:allData.users[cur].whatsNewSeen,local:localStorage.getItem('pogoWhatsNewSeen'),remote:structuredClone(__editorFixture.remote)}));
  expect(after.seen||null).toBe(before.seen);expect(after.writes).toEqual(before.writes);
  expect(after.local).toBe(before.local);
  after.remote.wishlist.LocalTrainer={Pikachu:'H'};
  await installEditor(page,after.remote);await page.evaluate(seedDiscovery);
  await expect(page.locator('#bell-btn,#bell-badge')).toHaveCount(0);
  await expect(page.locator('#wants-empty-import')).toBeHidden();
  await page.locator('#nav-more').click();await page.locator('#more-updates').click();
  await expect(page.locator('#tab-updates')).toBeVisible();
  await page.locator('#updates-back').click();
  await page.evaluate(()=>setSyncStatus('localOnly'));await expect(page.locator('#sync-banner')).toBeVisible();
  await expect(page.locator('#sync-banner-action')).toBeVisible();await expect(page.locator('#bell-btn,#bell-badge')).toHaveCount(0);
});
