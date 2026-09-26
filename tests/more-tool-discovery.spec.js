const {test,expect}=require('@playwright/test');
const {install,settled}=require('./helpers/more-application.cjs');
test.use({serviceWorkers:'block'});
const oneModal=async page=>expect(page.locator('.ov.open')).toHaveCount(1);
const snapshot=page=>page.evaluate(()=>({entities:structuredClone(accountSyncCanonicalEntities),writes:[...__editorFixture.writes],data:structuredClone(allData),seen:[localStorage.getItem('pogoTourSeen'),localStorage.getItem('pogoWhatsNewSeen')]}));
async function closeSettings(page){await page.locator('#settings-modal .settings-modal-close').click();await expect(page.locator('#settings-modal')).toBeHidden();}
async function selectImportBases(page,names){
  // Dex searches intentionally include catalog form/costume variants. Select
  // only the exact base names for this bounded journal mutation.
  await page.locator('#import-preview-list #select-all-chk').uncheck();
  for(const name of names)await page.locator('.import-preview-row').filter({has:page.locator('.import-name',{hasText:new RegExp(`^${name}$`)})}).locator('input').check();
}

test('More actual pointer and keyboard paths reach Share, import and Help with exact return focus and no mutations',async({page})=>{
  await install(page);const before=await snapshot(page),history=await page.evaluate(()=>history.length);
  for(const keyboard of [false,true])for(const [trigger,modal]of [['more-share','product-share-modal'],['more-import','import-modal'],['more-help','shortcuts-modal']]){
    const button=page.locator('#'+trigger);
    if(keyboard){await button.focus();await page.keyboard.press('Enter');}else await button.click();
    await expect(page.locator('#'+modal)).toBeVisible();await oneModal(page);
    if(trigger==='more-share'){await expect(page.locator('#product-share-tab-link')).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>productShareScope)).toBe('full');}
    await page.keyboard.press('Escape');await expect(page.locator('#'+modal)).toBeHidden();await expect(button).toBeFocused();
    expect(await page.evaluate(()=>document.getElementById('app').inert)).toBe(false);
  }
  expect(await snapshot(page)).toEqual(before);expect(await page.evaluate(()=>history.length)).toBe(history);
  expect(await page.evaluate(()=>__discovery.reads)).toEqual([]);expect(await page.evaluate(()=>__discovery.adminReads)).toEqual([]);
  await page.keyboard.press('n');await expect(page.locator('#wants-add-name')).toBeFocused();
  await page.locator('#nav-more').click();await page.keyboard.press('s');await expect(page.locator('#combined-list [data-wants-copy]').first()).toBeFocused();
});

test('Profile is deterministic after Language/Security; Settings keeps drafts, native Back and its actual invoker',async({page})=>{
  await install(page);const before=await snapshot(page);
  for(const section of ['language','security']){
    await page.locator('#more-settings').click();await page.locator(`[data-settings-target="${section}"]`).click();await closeSettings(page);
    await expect(page.locator('#more-settings')).toBeFocused();
    await page.locator('#more-profile').click();await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await expect(page).toHaveURL(/#settings\/profile$/);await page.locator('#prof-bio').fill('Unsaved synthetic draft');
    await page.goBack();await expect(page.locator('#settings-modal')).toBeHidden();await expect(page.locator('#more-profile')).toBeFocused();
  }
  await page.locator('#more-profile').click();await expect(page.locator('#prof-bio')).toHaveValue('Unsaved synthetic draft');await closeSettings(page);
  expect(await snapshot(page)).toEqual(before);
});

test('Settings compatibility tools use one dialog and restore the originating tool without extra history',async({page})=>{
  await install(page);await page.locator('#more-settings').click();await page.locator('[data-settings-target="tools"]').click();
  const history=await page.evaluate(()=>history.length),before=await snapshot(page);
  for(const [id,modal]of [['settings-import','import-modal'],['settings-export','product-share-modal'],['settings-transfer','safe-transfer-modal'],['settings-shortcuts','shortcuts-modal']]){
    const invoker=page.locator('#'+id);await invoker.focus();await page.keyboard.press('Enter');await expect(page.locator('#'+modal)).toBeVisible();await oneModal(page);
    if(id==='settings-export')await expect(page.locator('#product-share-tab-image')).toHaveAttribute('aria-selected','true');
    await page.keyboard.press('Escape');await expect(page.locator('#settings-modal')).toBeVisible();await oneModal(page);await expect(invoker).toBeFocused();
    expect(await page.evaluate(()=>history.length)).toBe(history);
  }
  expect(await snapshot(page)).toEqual(before);
  await page.locator('#settings-import').click();await page.goBack();await expect(page.locator('#import-modal')).toBeHidden();
  await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();await oneModal(page);
  await closeSettings(page);expect(await page.evaluate(()=>document.getElementById('app').inert)).toBe(false);
});

test('actual import preview/cancel is inert and bounded confirmed import uses the real journal',async({page})=>{
  await install(page);await page.locator('#nav-mylist').click();await page.locator('#wants-list-tools summary').click();
  const before=await snapshot(page);await page.locator('#wants-import').click();await page.locator('#import-str-input').fill('1,7');
  await page.locator('#import-step1 .bpri').click();await expect(page.locator('#import-step2')).toBeVisible();await expect(page.locator('.import-preview-row')).toHaveCount(16);
  expect(await snapshot(page)).toEqual(before);await page.keyboard.press('Escape');await expect(page.locator('#wants-import')).toBeFocused();
  await page.locator('#wants-import').click();await page.locator('#import-str-input').fill('1,7');await page.locator('#import-step1 .bpri').click();
  await selectImportBases(page,['Bulbasaur','Squirtle']);
  await page.locator('#import-confirm-btn').click();await expect(page.locator('#import-modal')).toBeHidden();await settled(page);
  const added=await page.evaluate(()=>productDeclarations().entries.filter(e=>['Bulbasaur','Squirtle'].includes(e.name)).map(e=>({name:e.name,p:e.p})));
  expect(added).toEqual([{name:'Bulbasaur',p:'M'},{name:'Squirtle',p:'M'}]);await expect(page.locator('#wants-import')).toBeFocused();
});

test('empty import entry needs complete owned data, not an empty filter or pending hydration',async({page})=>{
  await install(page,{empty:true});await page.locator('#nav-mylist').click();await expect(page.locator('#wants-empty-import')).toBeVisible();
  await page.locator('#wants-empty-import button').click();await page.keyboard.press('Escape');await expect(page.locator('#wants-empty-import button')).toBeFocused();
  await page.evaluate(async()=>{await stopAccountSyncRuntime();_firstSyncDone=false;__editorFixture.holdReads=true;window.__pendingDiscoveryHydration=ensureAccountSyncRuntime();renderMyList();});
  await expect.poll(()=>page.evaluate(()=>__editorFixture.readWaiters.length)).toBeGreaterThan(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
  await page.evaluate(async()=>{__editorFixture.holdReads=false;__editorFixture.readWaiters.splice(0).forEach(resolve=>resolve());await __pendingDiscoveryHydration;renderMyList();});await settled(page);await expect(page.locator('#wants-empty-import')).toBeVisible();
  await page.locator('#wants-empty-import button').click();await page.locator('#import-str-input').fill('1');await page.locator('#import-step1 .bpri').click();await selectImportBases(page,['Bulbasaur']);await page.locator('#import-confirm-btn').click();await settled(page);
  await expect(page.locator('#wants-add-name')).toBeFocused();
  await page.evaluate(()=>{setWantsFindOpen(true);});await page.locator('#combined-filter').fill('NoMatchingSpecies');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);await expect(page.locator('#wants-empty-import')).toBeHidden();
});

test('More native Tab order, focus ring and repeated Help dismissal stay on the active surface',async({page})=>{
  await install(page);await page.locator('#more-events').focus();
  for(const id of ['more-transfer','more-share','more-import','more-profile','more-settings','more-help']){
    await page.keyboard.press('Tab');await expect(page.locator('#'+id)).toBeFocused();
    expect(await page.locator('#'+id).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  }
  for(let i=0;i<3;i++){
    await page.keyboard.press('Enter');await expect(page.locator('#shortcuts-modal')).toBeVisible();
    await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#shortcuts-modal'))).toBe(true);
    await page.keyboard.press('Escape');await expect(page.locator('#more-help')).toBeFocused();
  }
  expect(await page.evaluate(()=>managedSubscriptions.snapshot().filter(s=>s.scope==='legacyAdmin'))).toEqual([]);
});

test('transfer entry starts with no implicit scope; exact one/multiple selections and contextual origin are retained',async({page})=>{
  await install(page);await page.evaluate(()=>lsSet(safeTransferPreferenceKey(SAFE_TRANSFER_DEFAULT_KEY),['ada','bert']));
  await page.locator('#more-transfer').click();await oneModal(page);await expect(page.locator('.stb-trainer-chip')).toHaveCount(2);
  await expect(page.locator('.stb-trainer-chip.on')).toHaveCount(0);expect(await page.evaluate(()=>__discovery.reads)).toEqual([]);
  await page.locator('[data-safe-transfer-trainer="ada"]').click();await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.scope.selected.map(x=>x.label))).toEqual(['Ada']);
  expect(await page.evaluate(()=>__discovery.reads)).toEqual(['publicShares/Ada']);
  await page.locator('[data-safe-transfer-trainer="bert"]').click();await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.scope.selected.map(x=>x.label))).toEqual(['Ada','Bert']);
  await page.keyboard.press('Escape');await expect(page.locator('#more-transfer')).toBeFocused();
  await page.locator('#nav-find').click();await page.locator('#trainer-mode-favorites').click();await page.locator('#trainer-transfer-review').click();
  await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');await page.locator('[data-safe-transfer-trainer="ada"]').click();
  await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.scope.selected.map(x=>x.label))).toEqual(['Bert']);
  await page.keyboard.press('Escape');await expect(page.locator('#trainer-transfer-review')).toBeFocused();
});

test('changed selection, unavailable/stale source and account boundary remain fail-closed in the real controller',async({page})=>{
  await install(page);await page.evaluate(()=>{__discovery.defer=true;});await page.locator('#more-transfer').click();
  await page.locator('[data-safe-transfer-trainer="ada"]').click();await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','loading');
  await page.locator('[data-safe-transfer-trainer="bert"]').click();await page.locator('[data-safe-transfer-trainer="ada"]').click();
  await page.evaluate(()=>{__discovery.defer=false;__discovery.waiters.splice(0).forEach(resolve=>resolve());});await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.scope.selected.map(x=>x.label))).toEqual(['Bert']);
  for(const code of ['permission-denied','cache-obsolete']){
    await page.locator('[data-safe-transfer-trainer="bert"]').click();await page.evaluate(code=>{__discovery.results.Bert={ok:false,error:{code}};},code);
    await page.locator('[data-safe-transfer-trainer="bert"]').click();await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase','blocked');
    expect(await page.evaluate(()=>_safeTransferController.snapshot().manualCommand)).toBe('');
  }
  await page.evaluate(()=>{__discovery.defer=true;});await page.locator('[data-safe-transfer-trainer="bert"]').click();await page.locator('[data-safe-transfer-trainer="bert"]').click();
  await page.evaluate(()=>{resetSessionTransientUi('discovery-account-change');auth.currentUser.uid='another-uid';cur='Other';__discovery.waiters.splice(0).forEach(resolve=>resolve());});
  await expect(page.locator('.ov.open')).toHaveCount(0);expect(await page.evaluate(()=>document.getElementById('app').inert)).toBe(false);
  expect(await page.evaluate(()=>_safeTransferController.snapshot().manualCommand)).toBe('');
});

test('ordinary/signed-out identities cannot run Admin or backup; protected owner navigation alone starts only existing admin reads',async({page})=>{
  await install(page);await expect(page.locator('#more-admin-group')).toBeHidden();
  const before=await snapshot(page);
  expect(await page.evaluate(()=>openMoreDestination('admin',document.getElementById('more-admin-link')))).toBe(false);
  expect(await page.evaluate(()=>exportData())).toBe(false);expect(await page.evaluate(()=>__discovery.adminReads)).toEqual([]);
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(()=>{auth.currentUser=null;cur=null;currentAuthUid=null;});
  expect(await page.evaluate(()=>['share','import','transfer','help'].map(tool=>openTaskTool(tool,document.getElementById('more-share'))))).toEqual([false,false,false,false]);
  expect(await page.evaluate(()=>openMoreDestination('profile',document.getElementById('more-profile')))).toBe(false);await expect(page.locator('.ov.open')).toHaveCount(0);
  await page.evaluate(async()=>{await stopAccountSyncRuntime();cur=OWNER;auth.currentUser={uid:'synthetic-protected-owner'};currentAuthUid=auth.currentUser.uid;allData.users[OWNER]={authUid:auth.currentUser.uid,isOwner:true};managedListenerLifecycle.activateSession({uid:auth.currentUser.uid,username:cur});switchTab('more');});
  await expect(page.locator('#more-admin-link')).toBeVisible();expect(await page.evaluate(()=>__discovery.adminReads)).toEqual([]);
  await page.locator('#more-admin-link').click();await expect(page.locator('#tab-admin')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>__discovery.adminReads.length)).toBeGreaterThan(0);
  await page.locator('#nav-more').click();expect(await page.evaluate(()=>managedSubscriptions.snapshot().filter(s=>s.scope==='legacyAdmin'))).toEqual([]);
  expect(await page.evaluate(()=>__discovery.adminStops)).toEqual(await page.evaluate(()=>__discovery.adminReads));
  await page.evaluate(()=>resetSessionTransientUi('owner-left'));await expect(page.locator('#more-admin-group')).toBeHidden();
});

test('mobile Events remains reachable and More scope/destination labels localize through actual Settings',async({page})=>{
  await install(page);await page.setViewportSize({width:390,height:900});await expect(page.locator('#nav-events')).toBeHidden();
  await page.locator('#more-events').click();await expect(page.locator('#tab-schedule')).toBeVisible();await expect(page.locator('#events-title')).toBeFocused();
  await page.locator('#nav-more').click();
  for(const locale of ['de','ja','es','en']){
    await page.locator('#more-settings').click();await page.locator('[data-settings-target="language"]').click();await page.locator('#settings-language').selectOption(locale);await closeSettings(page);
    await expect(page.locator('#more-transfer strong')).toHaveText(await page.evaluate(()=>i18nCore.t('discovery.transfer')));
    await page.locator('#more-profile').click();await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();await closeSettings(page);
  }
});
