const {test,expect}=require('@playwright/test');
const {install,settled,seedDiscovery}=require('./helpers/more-application.cjs');
const {install:installEditor}=require('./helpers/want-editor-application.cjs');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
test.use({serviceWorkers:'block'});
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
});
async function open(page,section){await page.locator('#more-settings').click();await page.locator(`[data-settings-target="${section}"]`).click();}
async function pinAccount(page){await page.evaluate(()=>{auth.currentUser.providerData=[{providerId:'password'}];allData.users[cur].pin='synthetic-hash';allData.users[cur].pinHashed=true;});}
const prefs=page=>page.evaluate(()=>({preference:pokemonGoSearchLanguagePreference(),resolved:pokemonGoSearchLocale(),override:lsGet(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY,false),locale:lsGet(POGO_SEARCH_LANGUAGE_KEY,null)}));
async function capture(page,name){if(!process.env.SETTINGS_REVIEW_DIR)return;mkdirSync(process.env.SETTINGS_REVIEW_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SETTINGS_REVIEW_DIR,name+'.png'),animations:'disabled'});}

test('language controls retain automatic and explicit equal choices across app changes and reload',async({page})=>{
  await install(page);await open(page,'language');
  await expect(page.locator('#settings-search-language')).toHaveValue('follow-app');
  await page.locator('#settings-language').selectOption('de');await expect.poll(()=>page.evaluate(()=>i18nCore.getLocale())).toBe('de');
  await page.locator('#settings-search-language').selectOption('de');
  expect(await prefs(page)).toEqual({preference:'de',resolved:'de',override:true,locale:'de'});
  const remote=await page.evaluate(()=>structuredClone(__editorFixture.remote));await installEditor(page,remote);await page.evaluate(seedDiscovery);const writes=await page.evaluate(()=>[...__editorFixture.writes]);await open(page,'language');
  await expect(page.locator('#settings-search-language')).toHaveValue('de');
  await page.locator('#settings-language').selectOption('ja');await expect.poll(()=>page.evaluate(()=>i18nCore.getLocale())).toBe('ja');
  expect((await prefs(page)).resolved).toBe('de');
  await page.locator('#settings-search-language').selectOption('follow-app');
  expect(await prefs(page)).toEqual({preference:'follow-app',resolved:'ja',override:false,locale:null});
  await page.locator('#settings-language').selectOption('es');await expect.poll(()=>page.evaluate(()=>pokemonGoSearchLocale())).toBe('es');
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
});

test('PIN reveal, validation, reauthentication failure and cancellation use actual handlers without credential retention',async({page})=>{
  await install(page);const writes=await page.evaluate(()=>[...__editorFixture.writes]);await pinAccount(page);await open(page,'security');
  await expect(page.locator('#settings-pin-form')).toBeHidden();
  await page.locator('#settings-pin-toggle').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#np1')).toBeFocused();await page.locator('#np1').fill('123');await page.locator('#settings-pin-form [type=submit]').click();
  await expect(page.locator('#pin-err')).toContainText('6');
  await page.locator('#np1').fill('123456');await page.locator('#np2').fill('654321');await page.locator('#settings-pin-form [type=submit]').click();
  await expect(page.locator('#pin-err')).toHaveText(/match/i);
  await page.evaluate(()=>{window.__passwordCalls=0;updatePassword=async()=>{__passwordCalls++;throw Object.assign(Error('Synthetic recent-login requirement'),{code:'auth/requires-recent-login'});};});
  await page.locator('#np2').fill('123456');await page.locator('#settings-pin-form [type=submit]').click();
  await expect(page.locator('#pin-err')).toHaveText('Sign out and sign back in before changing your PIN.');expect(await page.evaluate(()=>__passwordCalls)).toBe(1);
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
  await capture(page,'pin-reauth');
  await page.locator('#settings-pin-form [type=button]').click();await expect(page.locator('#settings-pin-toggle')).toBeFocused();
  await expect(page.locator('#np1')).toHaveValue('');await expect(page.locator('#np2')).toHaveValue('');
  await page.locator('#settings-pin-toggle').click();await page.locator('#np1').fill('123456');
  await page.locator('.settings-modal-close').click();await expect(page.locator('#more-settings')).toBeFocused();
  await expect(page.locator('#np1')).toHaveValue('');
});

test('provider-only account cannot reveal PIN; capability and collision presentation stay authoritative',async({page})=>{
  await install(page);const writes=await page.evaluate(()=>[...__editorFixture.writes]);await page.evaluate(()=>{auth.currentUser.providerData=[{providerId:'google.com'}];});await open(page,'security');
  await expect(page.locator('#settings-pin-toggle')).toBeHidden();await expect(page.locator('#settings-pin-form')).toBeHidden();
  expect(await page.evaluate(()=>{toggleSettingsPinForm(true);return document.getElementById('settings-pin-form').hidden;})).toBe(true);
  const collision=await page.evaluate(()=>googleProviderPresentation({state:'not-connected',linked:false},{providerKey:'google',code:'provider-link/collision',status:'needs-attention'}));
  expect(collision.disabled).toBe(true);expect(collision.state).toBe('needs-attention');
  expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
});

test('sync status follows real runtime pending, offline and recovered saved states; tools remain on their owning paths',async({page})=>{
  await install(page);await open(page,'data');await expect(page.locator('#trainer-sync-local-status')).toContainText('Saved');
  await page.evaluate(()=>{__editorFixture.offline=true;return addManagedIntentEntries('lf',[{name:'Bulbasaur',p:'H'}]);});
  await expect.poll(()=>page.evaluate(()=>accountSyncUiState.state)).not.toBe('saved');
  await expect(page.locator('#trainer-sync-local-status')).not.toContainText('No changes waiting');
  await capture(page,'sync-pending');
  await page.evaluate(async()=>{__editorFixture.offline=false;await requestAccountSyncRecovery();});await settled(page);
  await expect(page.locator('#trainer-sync-local-status')).toContainText('Saved');
  await expect(page.locator('[data-settings-target="tools"]')).toHaveCount(0);
  await expect(page.locator('#settings-health')).toBeVisible();await page.locator('#settings-health').click();await expect(page.locator('#login-health-modal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#settings-health')).toBeFocused();
  await expect(page.locator('#settings-backup')).toBeHidden();expect(await page.evaluate(()=>openSettingsTool('backup'))).toBe(false);
});

test('Help installation reflects unavailable, browser-offered and standalone capabilities; cancellation does not claim success',async({page})=>{
  await install(page);await page.locator('#more-help').click();await page.locator('#help-install summary').click();
  await expect(page.locator('#settings-install')).toBeHidden();await expect(page.locator('#help-install-status')).toContainText('hasn’t offered');
  await page.evaluate(()=>{window.__promptCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{__promptCalls++;};event.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(event);});
  await expect(page.locator('#settings-install')).toBeVisible();await page.locator('#settings-install').click();expect(await page.evaluate(()=>__promptCalls)).toBe(1);
  await expect(page.locator('#settings-install')).toBeHidden();await expect(page.locator('#toast')).not.toContainText('Installing');
  await page.evaluate(()=>{const original=matchMedia;window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true}:original(query);renderHelpAppInformation();});
  await expect(page.locator('#help-install-status')).toContainText('standalone');await expect(page.locator('#settings-install')).toBeHidden();
  await page.locator('#help-about summary').click();await expect(page.locator('#settings-release-id')).toContainText('2026-09-23.123');
  await expect(page.locator('#help-about a')).toHaveAttribute('href','?legal=privacy');
  const legal=page.locator('#help-about button');await legal.click();await expect(page.locator('#legal-dialog')).toBeVisible();
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#legal-dialog'))).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator('#legal-dialog')).toBeHidden();await expect(page.locator('#shortcuts-modal')).toBeVisible();await expect(legal).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#more-help')).toBeFocused();
});

for(const width of [1440,390,320])for(const locale of ['en','ja','es','de'])test(`Settings actual controls ${locale} ${width}px reflow and keyboard`,async({page})=>{
  await page.setViewportSize({width,height:900});await install(page);await pinAccount(page);await open(page,'language');
  await page.locator('#settings-language').selectOption(locale);await expect.poll(()=>page.evaluate(()=>i18nCore.getLocale())).toBe(locale);
  for(const section of ['language','security','data']){
    if(width<768&&section!=='language')await page.locator('.settings-mobile-back').click();
    if(section!=='language')await page.locator(`[data-settings-target="${section}"]`).click();
    const measurements=await page.locator(`[data-settings-section="${section}"]`).evaluate(panel=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...panel.querySelectorAll('button,select,input')].filter(el=>el.getClientRects().length&&!el.hidden).map(el=>({id:el.id,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,inside:el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth+1,contentFits:el.scrollWidth<=el.clientWidth+1}))}));
    expect(measurements.overflow).toBe(false);expect(measurements.controls.every(c=>c.inside&&c.contentFits&&c.height>=44)).toBe(true);
    await capture(page,`${section}-${locale}-${width}`);
    if(process.env.SETTINGS_REVIEW_DIR)writeFileSync(path.join(process.env.SETTINGS_REVIEW_DIR,`${section}-${locale}-${width}.json`),JSON.stringify(measurements,null,2));
  }
  await page.locator('.settings-modal-close').focus();await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#settings-modal'))).toBe(true);
});

test('German enlarged text and short mobile viewport retain PIN actions and one scrolling detail',async({page})=>{
  await page.setViewportSize({width:320,height:500});await install(page);await pinAccount(page);await open(page,'language');await page.locator('#settings-language').selectOption('de');
  await page.addStyleTag({content:'#settings-modal{font-size:200%}#settings-modal button,#settings-modal input,#settings-modal select,#settings-modal label,#settings-modal p,#settings-modal strong,#settings-modal span{font-size:inherit}'});
  await page.locator('.settings-mobile-back').click();await page.locator('[data-settings-target="security"]').click();await page.locator('#settings-pin-toggle').click();
  await page.locator('#np1').press('Tab');await expect(page.locator('#np2')).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  await expect(page.locator('#settings-pin-form [type=submit]')).toBeFocused();await expect(page.locator('#settings-pin-form [type=submit]')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(page,'security-de-320-enlarged-short');
});
