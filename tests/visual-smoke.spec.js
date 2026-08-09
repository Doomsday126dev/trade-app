const { test, expect } = require('@playwright/test');

function isLocalAuthBaseURL() {
  const raw = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4174';
  try {
    const url = new URL(raw);
    return url.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function signIn(page) {
  const user = process.env.POGO_TEST_USER;
  const pin = process.env.POGO_TEST_PIN;
  test.skip(
    isLocalAuthBaseURL(),
    'Authenticated Firebase smoke tests run against deployed GitHub Pages. Use PLAYWRIGHT_BASE_URL=https://doomsday126dev.github.io/trade-app/.'
  );
  test.skip(!user || !pin, 'Set POGO_TEST_USER and POGO_TEST_PIN to run authenticated visual smoke tests.');

  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('pogoTourSeen', JSON.stringify(now));
    localStorage.setItem('pogoWhatsNewSeen', JSON.stringify(now));
  });
  await page.goto(`./?pw=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-user, #app', { state: 'visible', timeout: 25_000 });
  if (await page.locator('#app').isVisible().catch(() => false)) return;

  await page.waitForFunction(
    username => {
      const options = Array.from(document.querySelectorAll('#login-user-list option'));
      return options.some(option => option.value === username);
    },
    user,
    { timeout: 25_000 }
  );
  await page.locator('#login-user').fill(user);
  await page.locator('#login-pin').fill(pin);
  await page.locator('#login-btn').click();
  try {
    await expect(page.locator('#app')).toBeVisible({ timeout: 25_000 });
  } catch (err) {
    const loginError = await page.locator('#login-err').innerText().catch(() => '');
    throw new Error(`Login did not reach the app. login-err="${loginError.trim()}"`);
  }
}

async function openInventoryBrowse(page) {
  await page.getByText('Inventory', { exact: false }).first().click();
  await expect(page.locator('#have-mine-view')).toBeVisible();
  await page.locator('.have-toggle-btn[data-view="browse"]').click();
  await expect(page.locator('#have-browse-out')).toBeVisible();
}

async function openMainTab(page, tab) {
  await page.locator(`.tab[data-tab="${tab}"]`).click();
  await expect(page.locator(`#tab-${tab}`)).toBeVisible();
}

async function expectAppNotBlank(page) {
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.tab.active')).toBeVisible();
  await expect(page.locator('.page.active')).toBeVisible();
}

async function expectAutocompleteResult(page, inputSelector, dropdownSelector, query, expected) {
  await page.locator(inputSelector).fill(query);
  await expect(page.locator(`${dropdownSelector}.open`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`${dropdownSelector}.open .ac-item, ${dropdownSelector}.open .ac-item-muted`).first()).toBeVisible();
  await expect(page.locator(dropdownSelector)).toContainText(expected);
}

async function expectAutocompleteClears(page, inputSelector, dropdownSelector) {
  await page.locator(inputSelector).fill('');
  await expect(page.locator(`${dropdownSelector}.open`)).toHaveCount(0);
}

async function waitForStableLocalOrganizerStartup(page) {
  await page.waitForFunction(() => typeof openTrainerOrganizer === 'function' && _authStateKnown === true);
  await page.evaluate(() => {
    resetTrainerOrganizerState();
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function handleOneDialogDuring(page, action, accept) {
  let handled = 0;
  const handler = async dialog => {
    handled += 1;
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  };
  page.on('dialog', handler);
  try {
    await action();
    await expect.poll(() => handled).toBe(1);
  } finally {
    page.off('dialog', handler);
  }
}

async function installLocalOrganizerFixture(page) {
  await page.evaluate(() => {
    cur='LocalTester';auth={currentUser:{uid:'uid-local-tester'}};
    const store=PogoData.trainerHistoryStore.createTrainerHistoryStore({storage:localStorage,identity:{uid:'uid-local-tester',username:'LocalTester'}});
    store.clear();
    for(const trainer of ['TrainerAlpha','TrainerBeta','TrainerNameThatIsDeliberatelyLongForCompactLayouts'])store.toggleFavorite(trainer);
    const japanese=store.createTag('交換候補とレイドの予定'),german=store.createTag('Besonders lange private Tauschplanung');
    store.setFavoriteTags('TrainerNameThatIsDeliberatelyLongForCompactLayouts',[japanese.id,german.id]);
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    const trigger=document.createElement('button');trigger.id='organizer-test-trigger';trigger.className='trainer-icon-btn';trigger.textContent='⚙';trigger.setAttribute('aria-label','Organize favorite');document.body.appendChild(trigger);trigger.focus();
  });
}

async function waitForSettingsStartupReady(page) {
  await page.waitForFunction(() => (
    document.readyState === 'complete' &&
    typeof openSettingsPanel === 'function' &&
    typeof syncSettingsRoute === 'function' &&
    typeof _authStateKnown === 'boolean' &&
    _authStateKnown === true
  ));
}

async function installSettingsScrollFixture(page, surface='share', offset=900) {
  await waitForSettingsStartupReady(page);
  await page.evaluate(async({surface,offset}) => {
    const settings=document.getElementById('settings-modal');
    if(settings?.classList.contains('open'))closeModal('settings-modal',{route:false});
    _settingsScrollSnapshot=null;
    closeAccountMenu(false);
    const login=document.getElementById('login-pg'),app=document.getElementById('app'),share=document.getElementById('share-view');
    login.style.display=surface==='login'?'flex':'none';
    app.style.display=surface==='account'?'flex':'none';
    share.classList.toggle('active',surface==='share');
    share.style.display=surface==='share'?'block':'none';
    if(surface==='account'){
      cur='LocalSettingsFixture';
      document.getElementById('top-un').textContent=cur;
      document.getElementById('account-menu-name').textContent=cur;
      document.getElementById('account-trigger').focus({preventScroll:true});
    }else cur=null;
    document.getElementById('settings-scroll-fixture')?.remove();
    const filler=document.createElement('div');
    filler.id='settings-scroll-fixture';filler.style.height='2800px';filler.setAttribute('aria-hidden','true');
    document.body.appendChild(filler);
    history.replaceState({},'',`${location.pathname}?settings-scroll-surface=${surface}`);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.scrollTo(0,offset);
  },{surface,offset});
  await page.waitForFunction(() => (
    location.hash !== '#settings' &&
    !document.getElementById('settings-modal')?.classList.contains('open') &&
    _modalActiveId !== 'settings-modal'
  ));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThanOrEqual(offset-2);
}

function activeSettingsClose(page) {
  return page.locator('#settings-modal.open button.settings-modal-close');
}

async function expectSettingsScrollNear(page, expected) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThanOrEqual(expected-2);
  expect(await page.evaluate(value=>Math.abs(window.scrollY-value),expected)).toBeLessThanOrEqual(2);
}

test.describe('visual smoke', () => {
  test('signed-out language control opens local Settings without a profile menu',async({page})=>{
    await page.goto(`./?signed-out-settings=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await expect(page.locator('#login-language-trigger')).toBeVisible();
    await expect(page.locator('#account-trigger')).toBeHidden();
    await page.locator('#login-language-trigger').click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator('#settings-language')).toBeVisible();
    await expect(page.locator('#settings-account-summary')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(page.locator('#login-language-trigger')).toBeFocused();
  });

  test('signed-in account menu opens Settings and restores focus on Escape',async({page})=>{
    await page.goto(`./?account-menu=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>{
      cur='TrainerNameThatIsDeliberatelyLongForTheHeader';
      document.getElementById('login-pg').style.display='none';
      document.getElementById('app').style.display='flex';
      document.getElementById('top-un').textContent=cur;
      document.getElementById('account-menu-name').textContent=cur;
    });
    await page.locator('#account-trigger').click();
    await expect(page.locator('#account-trigger')).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('#account-popover')).toBeVisible();
    await expect(page.locator('#account-settings-action')).toBeFocused();
    await page.locator('#account-settings-action').click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page).toHaveURL(/#settings$/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(page.locator('#account-trigger')).toBeFocused();
  });

  test('Settings hierarchy uses desktop navigation and a mobile section drill-in',async({page})=>{
    await page.goto(`./?settings-hierarchy=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>{
      cur='TrainerNameThatIsDeliberatelyLongForSettings';
      document.getElementById('login-pg').style.display='none';
      document.getElementById('app').style.display='flex';
      document.getElementById('top-un').textContent=cur;
      openSettingsPanel('account');
    });

    await page.setViewportSize({width:1024,height:800});
    await expect(page.locator('.settings-nav')).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await page.locator('[data-settings-target="tools"]').click();
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"]')).toBeHidden();
    await expect(page.locator('[data-settings-target="tools"]')).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('button',{name:'Export backup'})).toBeHidden();
    await expect(page.getByRole('button',{name:'Restore backup'})).toBeHidden();

    await page.setViewportSize({width:390,height:420});
    await page.evaluate(()=>{configureSettingsPanel('account');showSettingsSectionList();});
    await expect(page.locator('.settings-nav')).toBeVisible();
    await expect(page.locator('.settings-detail')).toBeHidden();
    await page.locator('[data-settings-target="language"]').click();
    await expect(page.locator('.settings-nav')).toBeHidden();
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();
    await page.locator('#settings-language').selectOption('de');
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-nav')).toBeVisible();
    await expect(page.locator('[data-settings-target="language"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
  });

  test('language Settings keeps the search-language override subordinate, responsive, and device-local',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?language-settings=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForSettingsStartupReady(page);
      await page.evaluate(()=>{
        localStorage.removeItem('pogoPokemonGoSearchLocale:v1');
        changeInterfaceLocale('ja');
        openSettingsPanel('public');
      });
      const override=page.locator('#settings-search-language-override');
      const row=page.locator('#settings-search-language-override-row');
      const searchLanguage=page.locator('#settings-search-language');
      await expect(override).not.toBeChecked();
      await expect(row).toBeHidden();
      await expect(searchLanguage).toBeDisabled();
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('ja');

      await override.check();
      await expect(row).toBeVisible();
      await expect(searchLanguage).toBeEnabled();
      await searchLanguage.selectOption('en');
      await page.locator('#settings-language').selectOption('de');
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('en');
      await override.uncheck();
      await expect(row).toBeHidden();
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('de');

      const geometry=await page.evaluate(()=>{
        const panel=document.querySelector('.language-settings-panel');
        const layout=document.getElementById('settings-layout');
        const detail=document.getElementById('settings-detail');
        const primaryLabel=document.querySelector('.language-primary-row>span');
        const primarySelect=document.getElementById('settings-language');
        const checkbox=document.getElementById('settings-search-language-override');
        const label=checkbox.closest('label');
        const detailRect=detail.getBoundingClientRect();
        const panelRect=panel.getBoundingClientRect();
        const labelRect=primaryLabel.getBoundingClientRect();
        const selectRect=primarySelect.getBoundingClientRect();
        return{
          noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth&&panel.scrollWidth<=panel.clientWidth,
          touchHeight:label.getBoundingClientRect().height,
          panelRight:panel.getBoundingClientRect().right,
          viewport:innerWidth,
          publicMode:layout.classList.contains('settings-public'),
          detailWidth:detailRect.width,
          panelWidth:panelRect.width,
          labelWidth:labelRect.width,
          selectWidth:selectRect.width,
          selectHeight:selectRect.height
        };
      });
      expect(geometry.noOverflow).toBe(true);
      expect(geometry.touchHeight).toBeGreaterThanOrEqual(48);
      expect(geometry.panelRight).toBeLessThanOrEqual(geometry.viewport+1);
      expect(geometry.publicMode).toBe(true);
      expect(geometry.panelWidth).toBeGreaterThanOrEqual(geometry.detailWidth-42);
      expect(geometry.labelWidth).toBeGreaterThanOrEqual(Math.min(260,geometry.detailWidth-42));
      expect(geometry.selectWidth).toBeGreaterThanOrEqual(Math.min(260,geometry.detailWidth-42));
      expect(geometry.selectHeight).toBeGreaterThanOrEqual(48);
      await expect(page.locator('.settings-nav')).toBeHidden();
      await expect(page.locator('.settings-mobile-back')).toBeHidden();
      await page.keyboard.press('Escape');
    }

    await page.evaluate(()=>localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify('en')));
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>openSettingsPanel('public'));
    await expect(page.locator('#settings-search-language-override')).toBeChecked();
    await expect(page.locator('#settings-search-language')).toHaveValue('en');
    await page.evaluate(()=>localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify('follow-app')));
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>openSettingsPanel('public'));
    await expect(page.locator('#settings-search-language-override')).not.toBeChecked();
    expect(await page.evaluate(()=>localStorage.getItem('pogoPokemonGoSearchLocale:v1'))).toBeNull();
  });

  test('anonymous share and signed-out Settings use the full-width local Language layout',async({page})=>{
    const surfaces=['share','login'];
    const locales=['en','ja','es','de'];
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const surface of surfaces){
      for(const locale of locales){
        for(const [width,height] of viewports){
          await page.setViewportSize({width,height});
          await page.goto(`./?public-settings=${surface}-${locale}-${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
          await waitForSettingsStartupReady(page);
          await page.evaluate(({surface,locale})=>{
            cur='';
            changeInterfaceLocale(locale);
            document.getElementById('share-view').classList.toggle('active',surface==='share');
            document.getElementById('login-pg').style.display=surface==='login'?'flex':'none';
            openSettingsPanel('public');
          },{surface,locale});
          await expect(page.locator('#settings-modal')).toBeVisible();
          await expect(page.locator('.settings-nav')).toBeHidden();
          await expect(page.locator('[data-settings-section="profile"]')).toBeHidden();
          await expect(page.locator('[data-settings-section="security"]')).toBeHidden();
          await expect(page.locator('[data-settings-section="tools"]')).toBeHidden();
          await expect(page.locator('[data-settings-section="data"]')).toBeHidden();
          await expect(page.locator('[data-settings-section="language"]')).toBeVisible();
          const off=await page.evaluate(()=>{
            const modal=document.querySelector('.settings-modal');
            const detail=document.getElementById('settings-detail');
            const panel=document.querySelector('.language-settings-panel');
            const label=document.querySelector('.language-primary-row>span');
            const select=document.getElementById('settings-language');
            const close=document.querySelector('.settings-modal-close');
            return{
              noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth&&modal.scrollWidth<=modal.clientWidth&&detail.scrollWidth<=detail.clientWidth&&panel.scrollWidth<=panel.clientWidth,
              detailWidth:detail.getBoundingClientRect().width,
              modalWidth:modal.getBoundingClientRect().width,
              labelWidth:label.getBoundingClientRect().width,
              selectWidth:select.getBoundingClientRect().width,
              selectHeight:select.getBoundingClientRect().height,
              closeWidth:close.getBoundingClientRect().width,
              closeHeight:close.getBoundingClientRect().height
            };
          });
          expect(off.noOverflow).toBe(true);
          expect(off.detailWidth).toBeGreaterThanOrEqual(off.modalWidth-2);
          expect(off.labelWidth).toBeGreaterThanOrEqual(Math.min(260,off.detailWidth-42));
          expect(off.selectWidth).toBeGreaterThanOrEqual(Math.min(260,off.detailWidth-42));
          expect(off.selectHeight).toBeGreaterThanOrEqual(48);
          expect(off.closeWidth).toBeGreaterThanOrEqual(48);
          expect(off.closeHeight).toBeGreaterThanOrEqual(48);
          await page.locator('#settings-search-language-override').check();
          await expect(page.locator('#settings-search-language-override-row')).toBeVisible();
          expect(await page.evaluate(()=>{
            const row=document.getElementById('settings-search-language-override-row');
            const select=document.getElementById('settings-search-language');
            return row.scrollWidth<=row.clientWidth&&select.getBoundingClientRect().width>=Math.min(260,document.getElementById('settings-detail').getBoundingClientRect().width-42)&&select.getBoundingClientRect().height>=48;
          })).toBe(true);
          await page.keyboard.press('Escape');
          await expect(page.locator('#settings-modal')).toBeHidden();
        }
      }
    }
  });

  test('Settings route restores the latest same-session scroll across close, Escape, Back, Forward, locale, and surfaces',async({page})=>{
    await page.goto(`./?settings-scroll-lifecycle=${Date.now()}`,{waitUntil:'domcontentloaded'});
    for(const surface of ['share','login','account']){
      await installSettingsScrollFixture(page,surface,900);
      await page.evaluate(context=>openSettingsPanel(context),surface==='account'?'account':'public');
      await expect(page.locator('#settings-modal')).toBeVisible();
      await expectSettingsScrollNear(page,900);
      await activeSettingsClose(page).click();
      await expect(page.locator('#settings-modal')).toBeHidden();
      await expectSettingsScrollNear(page,900);
    }

    await installSettingsScrollFixture(page,'share',1050);
    await page.evaluate(()=>openSettingsPanel('public'));
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expectSettingsScrollNear(page,1050);

    await page.evaluate(()=>window.scrollTo(0,1250));
    await page.evaluate(()=>openSettingsPanel('public'));
    await page.goBack();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expectSettingsScrollNear(page,1250);
    await page.goForward();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expectSettingsScrollNear(page,1250);
    await page.goBack();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expectSettingsScrollNear(page,1250);

    await page.goto(`./?settings-scroll-locale=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await installSettingsScrollFixture(page,'share',700);
    await page.evaluate(()=>openSettingsPanel('public'));
    for(const locale of ['ja','de','es'])await page.locator('#settings-language').selectOption(locale);
    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expectSettingsScrollNear(page,700);
  });

  test('direct and reloaded Settings routes deliberately have no prior scroll snapshot',async({page})=>{
    await page.goto(`./?direct-settings=${Date.now()}#settings`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof syncSettingsRoute==='function');
    await page.waitForFunction(()=>_authStateKnown===true);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);

    await page.goto(`./?reload-settings=${Date.now()}#settings`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof syncSettingsRoute==='function');
    await page.waitForFunction(()=>_authStateKnown===true);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof syncSettingsRoute==='function');
    await page.waitForFunction(()=>_authStateKnown===true);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);

    await page.goto(`./?legacy-settings=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof syncSettingsRoute==='function');
    await page.waitForFunction(()=>_authStateKnown===true);
    await page.evaluate(()=>{
      history.replaceState({},'',`${location.pathname}?action=settings`);
      history.replaceState({},'',settingsRouteUrl(true));
      syncSettingsRoute({captureScroll:false});
    });
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page).toHaveURL(/#settings$/);
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  });

  test('Settings scroll restoration remains stable across desktop dialogs and mobile sheets',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?settings-scroll-responsive=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await installSettingsScrollFixture(page,'share',900);
      await page.evaluate(()=>openSettingsPanel('public'));
      await expect(page.locator('#settings-modal')).toBeVisible();
      await expectSettingsScrollNear(page,900);
      await expect(activeSettingsClose(page)).toHaveCount(1);
      const closeBox=await activeSettingsClose(page).boundingBox();
      expect(closeBox?.width).toBeGreaterThanOrEqual(48);expect(closeBox?.height).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(()=>{
        const detail=document.getElementById('settings-detail'),modal=document.querySelector('.settings-modal');
        const rect=modal.getBoundingClientRect();
        return document.documentElement.scrollWidth<=document.documentElement.clientWidth&&rect.left>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1&&getComputedStyle(detail).overflowY==='auto';
      })).toBe(true);
      await activeSettingsClose(page).click();
      await expect(page.locator('#settings-modal')).toBeHidden();
      await expectSettingsScrollNear(page,900);
    }
  });

  test('Settings keeps one reachable close control across live desktop and mobile breakpoint changes',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?settings-live-breakpoint=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await installSettingsScrollFixture(page,'share',900);
    await page.evaluate(()=>openSettingsPanel('public'));
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(activeSettingsClose(page)).toHaveCount(1);

    for(const viewport of [{width:390,height:420},{width:390,height:300},{width:1440,height:900}]){
      await page.setViewportSize(viewport);
      await expect(page.locator('#settings-modal')).toBeVisible();
      await expect(activeSettingsClose(page)).toBeVisible();
      const box=await activeSettingsClose(page).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }

    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expectSettingsScrollNear(page,900);
  });

  test('account and Settings controls keep accessible mobile touch geometry',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?account-touch-targets=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForSettingsStartupReady(page);
      await page.evaluate(()=>{
        cur='TrainerNameThatIsDeliberatelyLongForTheHeader';
        document.getElementById('login-pg').style.display='none';
        document.getElementById('app').style.display='flex';
        document.getElementById('top-un').textContent=cur;
        document.getElementById('account-menu-name').textContent=cur;
      });

      const trigger=page.locator('#account-trigger');
      const triggerBox=await trigger.boundingBox();
      expect(triggerBox?.width).toBeGreaterThanOrEqual(48);
      expect(triggerBox?.height).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(()=>{
        const name=document.getElementById('top-un');
        const style=getComputedStyle(name);
        const deliberatelyHandled=style.display==='none'||style.textOverflow==='ellipsis';
        return deliberatelyHandled&&document.documentElement.scrollWidth<=document.documentElement.clientWidth;
      })).toBe(true);

      await trigger.click();
      const popoverBox=await page.locator('#account-popover').boundingBox();
      expect(popoverBox?.x).toBeGreaterThanOrEqual(0);
      expect((popoverBox?.x||0)+(popoverBox?.width||0)).toBeLessThanOrEqual(width);
      await page.locator('#account-settings-action').click();

      const close=activeSettingsClose(page);
      const closeBox=await close.boundingBox();
      expect(closeBox?.width).toBeGreaterThanOrEqual(48);
      expect(closeBox?.height).toBeGreaterThanOrEqual(48);
      expect(closeBox?.x).toBeGreaterThanOrEqual(0);
      expect(closeBox?.y).toBeGreaterThanOrEqual(0);
      expect((closeBox?.x||0)+(closeBox?.width||0)).toBeLessThanOrEqual(width);
      expect((closeBox?.y||0)+(closeBox?.height||0)).toBeLessThanOrEqual(height);
      expect(await page.evaluate(()=>{
        const detail=document.getElementById('settings-detail');
        return document.documentElement.scrollWidth<=document.documentElement.clientWidth&&
          getComputedStyle(detail).overflowY==='auto'&&detail.scrollHeight>=detail.clientHeight;
      })).toBe(true);
    }
  });

  test('local trainer organizer remains contained and reachable on compact viewports',async({page})=>{
    for(const [width,height] of [[320,640],[375,700],[390,420],[390,300],[430,760],[768,800],[1024,800],[1440,900]]){
      await page.setViewportSize({width,height});
      await page.goto(`./?local-organizer=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await installLocalOrganizerFixture(page);
      await page.evaluate(()=>openTrainerOrganizer('TrainerNameThatIsDeliberatelyLongForCompactLayouts'));
      const modal=page.locator('#trainer-organizer-modal'),close=page.locator('.organizer-close');
      await expect(modal).toBeVisible();
      const organizerTrigger=page.locator('.trainer-icon-btn').filter({hasText:'⚙'}).first();
      await organizerTrigger.evaluate(button=>{button.style.position='fixed';button.style.left='0';button.style.top='0';button.style.display='inline-flex';});
      const triggerBox=await organizerTrigger.boundingBox();expect(triggerBox?.width).toBeGreaterThanOrEqual(48);expect(triggerBox?.height).toBeGreaterThanOrEqual(48);
      const closeBox=await close.boundingBox();expect(closeBox?.width).toBeGreaterThanOrEqual(48);expect(closeBox?.height).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(()=>{
        const body=document.querySelector('.organizer-body'),panel=document.querySelector('.organizer-modal');
        const rect=panel.getBoundingClientRect();
        return document.documentElement.scrollWidth<=document.documentElement.clientWidth&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight+1&&getComputedStyle(body).overflowY==='auto';
      })).toBe(true);
      await page.locator('#organizer-new-tag-toggle').click();
      await page.locator('#organizer-new-tag').fill('Compact tag draft');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    }
  });

  test('local trainer organizer dialog lifecycle is isolated across actions and sessions',async({page})=>{
    await page.goto(`./?local-organizer-lifecycle=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await installLocalOrganizerFixture(page);
    const modal=page.locator('#trainer-organizer-modal');

    for(let cycle=0;cycle<3;cycle++){
      await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
      await expect(modal).toBeVisible();
      await page.evaluate(()=>closeTrainerOrganizer(true));
      await expect(modal).toBeHidden();
    }

    await page.evaluate(()=>{openTrainerOrganizer('TrainerAlpha');openTrainerOrganizer('TrainerAlpha');openTrainerOrganizer('TrainerAlpha');});
    const escapeCalls=await page.evaluate(async()=>{
      const original=closeTrainerOrganizer;let calls=0;
      closeTrainerOrganizer=function(...args){calls+=1;return original(...args);};
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await Promise.resolve();
      closeTrainerOrganizer=original;
      return calls;
    });
    expect(escapeCalls).toBe(1);
    await expect(modal).toBeHidden();

    await page.evaluate(()=>{openTrainerOrganizer('TrainerAlpha');closeTrainerOrganizer(true);openTrainerOrganizer('TrainerBeta');});
    await expect(page.locator('#organizer-trainer-name')).toHaveText('TrainerBeta');
    await page.evaluate(()=>closeTrainerOrganizer(true));

    await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
    await page.locator('#organizer-new-tag-toggle').click();
    await page.locator('#organizer-new-tag').fill('Inline draft');
    await page.keyboard.press('Escape');
    await expect(page.locator('#organizer-add-tag-row')).toBeHidden();
    await expect(modal).toBeVisible();
    await page.locator('.organizer-actions .bpri').click();
    await expect(modal).toBeHidden();

    await page.evaluate(()=>{openTrainerOrganizer('TrainerAlpha');openTrainerOrganizer('TrainerBeta');});
    await expect(page.locator('#organizer-trainer-name')).toHaveText('TrainerBeta');
    await page.evaluate(()=>closeTrainerOrganizer(true));

    await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
    await page.locator('#trainer-organizer-modal').click({position:{x:2,y:2}});
    await expect(modal).toBeHidden();

    await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
    await page.evaluate(()=>changeInterfaceLocale('de'));
    await expect(modal).toBeVisible();
    expect(await page.evaluate(()=>trainerOrganizerState.username)).toBe('TrainerAlpha');
    await page.setViewportSize({width:390,height:300});
    await expect(modal).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(()=>closeTrainerOrganizer(true));
    await expect(page.locator('#organizer-test-trigger')).toBeFocused();

    await page.evaluate(()=>{openTrainerOrganizer('TrainerAlpha');resetTrainerOrganizerState();cur='OtherLocalTester';auth={currentUser:{uid:'uid-other-local-tester'}};trainerHistoryStore=null;});
    await expect(modal).toBeHidden();
    expect(await page.evaluate(()=>trainerOrganizerState.username)).toBe('');
    await page.evaluate(()=>{
      const store=PogoData.trainerHistoryStore.createTrainerHistoryStore({storage:localStorage,identity:{uid:'uid-other-local-tester',username:'OtherLocalTester'}});
      store.clear();store.toggleFavorite('TrainerBeta');openTrainerOrganizer('TrainerBeta');
    });
    await expect(page.locator('#organizer-trainer-name')).toHaveText('TrainerBeta');
    expect(await page.evaluate(()=>trainerOrganizerState.username)).toBe('TrainerBeta');
    await page.evaluate(()=>{document.getElementById('organizer-test-trigger').remove();closeTrainerOrganizer(true);});
    await expect(modal).toBeHidden();
  });

  test('Favorite cards keep swipe optional and align with trainer search at compact widths',async({page})=>{
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:700});
      await page.goto(`./?favorite-card-prototype=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await installLocalOrganizerFixture(page);
      await page.evaluate(async()=>{
        document.querySelectorAll('.page').forEach(page=>page.classList.remove('active'));
        document.getElementById('tab-find').classList.add('active');
        managedPublicShareRepository=null;
        await renderTrainerQuickLists();
      });
      const search=page.locator('.trainer-search-shell'),favoritesSearch=page.locator('.favorite-toolbar-search'),card=page.locator('.favorite-card-shell').first();
      await expect(card).toBeVisible();
      const searchBox=await search.boundingBox(),favoriteSearchBox=await favoritesSearch.boundingBox();
      expect(Math.abs((searchBox?.width||0)-(favoriteSearchBox?.width||0))).toBeLessThanOrEqual(1);
      await expect(card.locator('.favorite-card-add-tag')).toBeVisible();
      await expect(card.locator('.favorite-card-more')).toBeVisible();
      await expect(card).not.toContainText('Organize tags');
      const addBox=await card.locator('.favorite-card-add-tag').boundingBox(),moreBox=await card.locator('.favorite-card-more').boundingBox();
      expect(addBox?.width).toBeGreaterThanOrEqual(48);expect(addBox?.height).toBeGreaterThanOrEqual(48);
      expect(moreBox?.width).toBeGreaterThanOrEqual(48);expect(moreBox?.height).toBeGreaterThanOrEqual(48);
      await card.locator('.favorite-card-more').click();
      await expect(card.locator('.favorite-card-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(card.locator('.favorite-card-menu')).toBeHidden();
      await expect(card.locator('.favorite-card-more')).toBeFocused();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
  });

  test('My List compact add controls stay responsive and keyboard reachable',async({page})=>{
    await page.setViewportSize({width:390,height:420});
    await page.goto(`./?my-list-creation=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await page.evaluate(()=>{cur='LocalTester';auth={currentUser:{uid:'uid-local-tester'}};document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';});
    const measurement=await page.evaluate(()=>{
      const started=performance.now();toggleAddAdvanced();toggleAddAdvanced();
      document.getElementById('export-menu-btn').click();closeExportMenu();
      return performance.now()-started;
    });
    expect(measurement).toBeLessThan(100);
    await expect(page.locator('#ac-input')).toBeVisible();
    await expect(page.locator('#voice-btn')).toHaveAttribute('aria-label',/.+/);
    await expect(page.locator('#export-menu-btn')).toHaveAttribute('aria-haspopup','menu');
    await page.locator('#export-menu-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await expect(page.locator('#export-menu [role^="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#export-menu')).toBeHidden();
    await expect(page.locator('#export-menu-btn')).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });

  test('translated active UI has no horizontal overflow at representative widths',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?locale-layout=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof changeInterfaceLocale==='function');
      await page.waitForTimeout(350);
      for(const locale of ['ja','de']){
        await page.evaluate(value=>{
          document.getElementById('login-pg').style.display='none';
          document.getElementById('config-pg').style.display='none';
          document.getElementById('app').style.display='flex';
          document.getElementById('settings-modal').classList.add('open');
          configureSettingsPanel('public');
          changeInterfaceLocale(value);
        },locale);
        await expect(page.locator('#settings-language')).toHaveValue(locale);
        await expect(page.locator('#settings-language-heading')).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      }
    }
  });

  for (const width of [320, 375, 390, 430]) {
    test(`find trainer suggestions stay visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto(`./?autocomplete-layout=${width}-${Date.now()}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof renderTrainerSuggestions === 'function');
      await page.evaluate(() => {
        document.getElementById('login-pg').style.display='none';
        document.getElementById('app').style.display='block';
        document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
        document.getElementById('tab-find').classList.add('active');
        allData.loginDirectory={LongTrainerNameForMobileTesting:{ready:true},TrainerAlpha:{ready:true},TrainerBeta:{ready:true}};
        const input=document.getElementById('find-trainer-input');
        input.value='Tr';
        renderTrainerSuggestions('Tr');
      });
      const dropdown=page.locator('#find-trainer-suggestions.open');
      await expect(dropdown).toBeVisible();
      const box=await dropdown.boundingBox();
      const bodyWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(width+1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeLessThan(640);
      expect(bodyWidth).toBeLessThanOrEqual(width);
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.trainer-suggestion.active')).toBeVisible();
    });
  }

  test('find trainer autocomplete suggests public directory names', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'find');
    await page.locator('#find-trainer-input').fill('Tes');
    await expect(page.locator('#find-trainer-suggestions.open')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.trainer-suggestion').first()).toContainText(/TestUser/i);
  });

  test('my list renders embedded search strings', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#my-strings-out')).toBeVisible();
    await expect(page.locator('#my-strings-out .str-level').first()).toBeVisible({ timeout: 20_000 });
  });

  test('my list add pokemon autocomplete shows normalized and dex results', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#ac-input')).toBeVisible();

    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', 'pika', /Pikachu/i);
    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', 'Unown ?', /Unown\s*\(\?\)|Unown.*Question/i);
    await expectAutocompleteResult(page, '#ac-input', '#ac-dropdown', '25', /Pikachu/i);
    await expect(page.locator('#ac-dropdown')).toContainText('#25');

    await expectAutocompleteClears(page, '#ac-input', '#ac-dropdown');
    await expect(page.locator('#add-pmon-sel')).toHaveValue('');
  });

  test('legacy inventory is read-only and export remains available', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'have');
    await expect(page.locator('#have-mine-view')).toBeVisible();
    await expect(page.locator('#have-mine-out')).toBeVisible();
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
    await expect(page.locator('.have-toggle-row')).toBeHidden();
  });

  test('legacy inventory editing controls stay retired', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'have');
    await expect(page.locator('#have-ac-input')).toBeHidden();
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
  });

  test('events renders responsive grouped cards', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'schedule');
    await expect(page.locator('.event-filter-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.event-card, #events-out .empty').first()).toBeVisible({ timeout: 20_000 });
    await expectAppNotBlank(page);
  });

  test('main tab switching keeps the app rendered', async ({ page }) => {
    await signIn(page);
    for (const tab of ['mylist', 'find', 'have', 'schedule']) {
      await openMainTab(page, tab);
      await expectAppNotBlank(page);
    }
    await page.locator('#account-trigger').click();
    await expect(page.locator('#account-popover')).toBeVisible();
    await page.locator('#account-settings-action').click();
    await expect(page.locator('#settings-modal')).toBeVisible();
  });

  test('find trainer touch targets remain usable on mobile', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'find');
    await page.locator('#find-trainer-input').fill('Tes');
    await expect(page.locator('.trainer-suggestion').first()).toBeVisible();
    const box=await page.locator('.trainer-suggestion').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40);
  });

  test('retired top-level surfaces are absent', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('.tab[data-tab="browse"], .tab[data-tab="strings"]')).toHaveCount(0);
    await expect(page.locator('.tabs')).not.toContainText(/Offers|Schedule/);
  });
});
