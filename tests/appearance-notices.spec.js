const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {install,seedDiscovery,settled}=require('./helpers/more-application.cjs');
const {install:installEditor}=require('./helpers/want-editor-application.cjs');
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
  const writes=await page.evaluate(()=>[...__editorFixture.writes]);
  await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('[data-settings-theme="dark"]').click();
  expect(await page.evaluate(()=>({wallpaper:allData.users[cur].wallpaper||null,background:getComputedStyle(document.body).backgroundColor,canvas:getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas').trim()}))).toMatchObject({wallpaper:null,background:'rgb(17, 19, 22)'});
  expect(await page.evaluate(async()=>({splash:(await(await fetch('manifest.json')).json()).background_color,chrome:document.querySelector('meta[name="theme-color"]').content}))).toEqual({splash:'#111316',chrome:'#111316'});
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#wp-picker .mono')).toHaveAttribute('aria-label','Neutral');
  await capture(page,'appearance-desktop-neutral');
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-neutral');
  await page.locator('.settings-modal-close').click();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
});

test('explicit wallpaper survives save, cancel, theme changes and a synthetic-account reload',async({page})=>{
  await install(page);await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
  await page.locator('[data-settings-theme="dark"]').click();await page.locator('#wp-picker .ocean').click();
  await page.locator('#settings-background-group .btn-primary').click();
  await settled(page);
  expect(await page.evaluate(()=>({stored:allData.users[cur].wallpaper,applied:document.body.classList.contains('wp-ocean')}))).toEqual({stored:'ocean',applied:true});
  await page.setViewportSize({width:390,height:900});await capture(page,'appearance-mobile-saved-ocean');
  await page.locator('#wp-picker .forest').click();
  await page.locator('.settings-modal-close').click();
  await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
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
  await page.locator('#more-settings').click();await page.locator('[data-settings-target="appearance"]').click();
  await expect(page.locator('#wp-picker .ocean')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>allData.users[cur].wallpaper)).toBe('ocean');
});

test('hydrated first-use guidance is inline, localized, and never mistaken for loading or filtered-empty',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#wants-empty-import')).toBeVisible();await expect(page.locator('#wants-share-guide')).toHaveCount(0);
    await expect(page.locator('#wants-empty-import strong')).toHaveText('Start with a Pokémon you want');
    expect(await noOverflow(page)).toBe(true);await capture(page,`first-use-${width}`);
  }
  await page.evaluate(async()=>{await stopAccountSyncRuntime();_firstSyncDone=false;__editorFixture.holdReads=true;window.__pendingAppearanceHydration=ensureAccountSyncRuntime();renderMyList();});
  await expect.poll(()=>page.evaluate(()=>__editorFixture.readWaiters.length)).toBeGreaterThan(0);
  await expect(page.locator('#wants-empty-import')).toBeHidden();await expect(page.locator('#wants-share-guide')).toHaveCount(0);
  await page.evaluate(async()=>{__editorFixture.holdReads=false;__editorFixture.readWaiters.splice(0).forEach(resolve=>resolve());await __pendingAppearanceHydration;renderMyList();});await settled(page);
  await expect(page.locator('#wants-empty-import')).toBeVisible();
  for(const [locale,title] of [['ja','欲しいポケモンから始めましょう'],['es','Empieza con un Pokémon que quieras'],['de','Beginne mit einem Pokémon, das du suchst']]){
    await localeThroughSettings(page,locale);await expect(page.locator('#wants-empty-import strong')).toHaveText(title);
    expect(await noOverflow(page)).toBe(true);
  }
  await page.setViewportSize({width:320,height:650});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await noOverflow(page)).toBe(true);await capture(page,'first-use-320-de-text-200');
  await page.locator('#wants-empty-import button').scrollIntoViewIfNeeded();await expect(page.locator('#wants-empty-import button')).toBeInViewport();
  await capture(page,'first-use-320-de-text-200-action');
  await page.evaluate(()=>{document.documentElement.style.fontSize='';applyTheme('dark')});await page.setViewportSize({width:390,height:900});await capture(page,'first-use-dark-390');
  await localeThroughSettings(page,'en');
  const writes=await page.evaluate(()=>[...__editorFixture.writes]);
  await page.locator('#wants-empty-import button').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#import-modal')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('#wants-empty-import button')).toBeFocused();
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
  await page.locator('#wants-add-name').fill('Bulbasaur');await page.locator('[data-wants-add-priority="H"]').click();
  await page.locator('.wants-add-form [type="submit"]').click();await settled(page);
  await expect(page.locator('#wants-empty-import')).toBeHidden();await expect(page.locator('#combined-list .wants-row')).toHaveCount(1);
  await page.evaluate(()=>setWantsFindOpen(true));await page.locator('#combined-filter').fill('NoMatchingSpecies');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
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

test('red bell is opt-in versioned history; established seen state and operational alert stay distinct',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();
  await page.evaluate(()=>checkWhatsNew());
  await expect(page.locator('#bell-badge')).toHaveClass(/show/);
  await expect(page.locator('#whatsnew-modal')).toBeHidden();
  await expect(page.locator('#sync-banner')).toBeHidden();
  const before=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:allData.users[cur].whatsNewSeen||null,local:localStorage.getItem('pogoWhatsNewSeen')}));
  await page.locator('#bell-btn').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#whatsnew-modal')).toBeVisible();
  await expect(page.locator('#whatsnew-list .whats-new-item').first()).toContainText('v4.6.31');
  await expect(page.locator('#whatsnew-list')).toContainText('v4.6.14');
  await expect(page.locator('#bell-badge')).not.toHaveClass(/show/);
  await capture(page,'notice-fresh-entry');
  await expect.poll(()=>page.evaluate(()=>allData.users[cur].whatsNewSeen)).toBe('4.6.31');
  await page.locator('#whatsnew-modal .mact button').click();await expect(page.locator('#bell-btn')).toBeFocused();
  await settled(page);
  const after=await page.evaluate(()=>({writes:[...__editorFixture.writes],seen:allData.users[cur].whatsNewSeen,local:localStorage.getItem('pogoWhatsNewSeen'),remote:structuredClone(__editorFixture.remote)}));
  expect(after.seen).toBe('4.6.31');expect(after.writes.length).toBeGreaterThanOrEqual(before.writes.length);
  expect(after.local).not.toBe(before.local);
  await page.evaluate(()=>localStorage.removeItem('pogoWhatsNewSeen'));
  after.remote.wishlist.LocalTrainer={Pikachu:'H'};
  await installEditor(page,after.remote);await page.evaluate(seedDiscovery);await page.evaluate(()=>checkWhatsNew());
  await expect(page.locator('#bell-badge')).not.toHaveClass(/show/);
  await expect(page.locator('#wants-empty-import')).toBeHidden();
  await page.locator('#bell-btn').click();await expect(page.locator('#whatsnew-modal')).toBeVisible();
  await expect(page.locator('#whatsnew-list .whats-new-item').first()).toContainText('v4.6.31');
  await capture(page,'notice-established-entry');
  await page.keyboard.press('Escape');await expect(page.locator('#bell-btn')).toBeFocused();
  await page.evaluate(()=>setSyncStatus('localOnly'));await expect(page.locator('#sync-banner')).toBeVisible();
  await expect(page.locator('#sync-banner-action')).toBeVisible();await expect(page.locator('#bell-badge')).not.toHaveClass(/show/);
});
