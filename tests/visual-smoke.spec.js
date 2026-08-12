const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const pass3ScreenshotDir=process.env.PASS3_SCREENSHOT_DIR||'';
async function capturePass3(page,name){
  if(!pass3ScreenshotDir)return;
  mkdirSync(pass3ScreenshotDir,{recursive:true});
  await page.screenshot({path:path.join(pass3ScreenshotDir,`${name}.png`),fullPage:false});
}

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

async function isolateAuthenticatedMyListFixture(page,{username,uid}) {
  await page.waitForFunction(() => _authStateKnown === true && typeof managedSubscriptions?.unsubscribeByKey === 'function');
  await page.evaluate(({username,uid}) => {
    managedSubscriptions.unsubscribeByKey('public:loginDirectory');
    managedListenerLifecycle.deactivateSession('playwright_fixture');
    managedListenerLifecycle.clearSelectedTrainer('playwright_fixture');
    managedOwnedDataCoordinator?.reset();
    db=null;fbOn=false;managedFirebaseClient=null;
    cur=username;auth={currentUser:{uid}};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
    document.getElementById('tab-mylist').classList.add('active');
    window.__authenticatedMyListFixture={active:true,generation:(window.__authenticatedMyListFixture?.generation||0)+1,username,uid};
  },{username,uid});
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
  await isolateAuthenticatedMyListFixture(page,{username:'LocalTester',uid:'uid-local-tester'});
  await page.evaluate(() => {
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
  test.beforeEach(async({page})=>{
    await page.route(url=>{
      const host=url.hostname;
      return host.endsWith('.firebaseio.com')||host.endsWith('.firebasedatabase.app')||
        ['identitytoolkit.googleapis.com','securetoken.googleapis.com','firebaseappcheck.googleapis.com'].includes(host)||
        host.endsWith('.cloudfunctions.net');
    },route=>route.abort());
  });

  test('consumer shell remains composed across themes and responsive widths',async({page})=>{
    await page.goto(`./?consumer-shell=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'FinishTester',uid:'uid-finish-tester'});
    await page.evaluate(()=>{
      document.getElementById('top-un').textContent=cur;
    });
    for(const theme of ['dark','light']){
      await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
      for(const [width,height] of [[375,700],[768,800],[1280,900]]){
        await page.setViewportSize({width,height});
        await expect(page.locator('.topbar')).toBeVisible();
        await expect(page.locator('.tabs')).toBeVisible();
        await expect(page.locator('.tab.active')).toBeVisible();
        const geometry=await page.evaluate(()=>({
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
          pageMax:getComputedStyle(document.querySelector('.page.active')).maxWidth,
          activeTreatment:getComputedStyle(document.querySelector('.tab.active')).boxShadow,
          canvas:getComputedStyle(document.body).backgroundColor,
          surface:getComputedStyle(document.querySelector('.topbar')).backgroundColor
        }));
        expect(geometry.overflow).toBe(false);
        expect(geometry.pageMax).toBe('1120px');
        expect(geometry.activeTreatment).not.toBe('none');
        expect(geometry.canvas).not.toBe('rgba(0, 0, 0, 0)');
        expect(geometry.surface).not.toBe('rgba(0, 0, 0, 0)');
      }
    }
  });

  test('shared Login fields retain themed autofill, focus, and invalid layers',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Chromium CDP is required to force the autofill pseudo-state.');
    await page.goto(`./?autofill-theme=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#login-user')).toBeVisible();
    expect(await page.evaluate(()=>CSS.supports('selector(input:-webkit-autofill)'))).toBe(true);
    expect(await page.evaluate(()=>CSS.supports('selector(input:autofill)'))).toBe(true);
    const session=await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const {root}=await session.send('DOM.getDocument');
    const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#login-user'});
    const force=forcedPseudoClasses=>session.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses});
    const settle=()=>page.waitForTimeout(220);
    const styles=(selector='#login-user')=>page.locator(selector).evaluate(node=>{
      const style=getComputedStyle(node),body=getComputedStyle(document.body);
      return{background:body.backgroundColor,border:style.borderColor,boxShadow:style.boxShadow,color:body.color,textFill:style.webkitTextFillColor,caret:style.caretColor,height:node.getBoundingClientRect().height};
    });
    for(const scenario of [
      {theme:'dark',colorScheme:'light'},
      {theme:'light',colorScheme:'dark'},
      {theme:null,colorScheme:'light'}
    ]){
      await page.emulateMedia({colorScheme:scenario.colorScheme});
      await page.evaluate(value=>{
        if(value)document.documentElement.dataset.theme=value;
        else document.documentElement.removeAttribute('data-theme');
      },scenario.theme);
      await page.locator('#login-user').focus();
      await settle();
      await force([]);
      await settle();
      const focused=await styles();
      await force(['autofill','focus']);
      await settle();
      const autofilled=await styles();
      expect(autofilled.textFill).toBe(autofilled.color);
      expect(autofilled.caret).toBe(autofilled.color);
      expect(autofilled.boxShadow).toContain('1000px');
      expect(autofilled.boxShadow.split(',').length).toBeGreaterThan(1);
      expect(autofilled.border).toBe(focused.border);
      expect(autofilled.height).toBeGreaterThanOrEqual(48);
      await force([]);
      await page.locator('#login-user').evaluate(node=>node.setAttribute('aria-invalid','true'));
      await settle();
      const invalid=await styles();
      await force(['autofill','focus']);
      await settle();
      const invalidAutofilled=await styles();
      expect(invalidAutofilled.border).toBe(invalid.border);
      expect(invalidAutofilled.boxShadow).toContain('1000px');
      expect(invalidAutofilled.boxShadow).toContain(invalid.boxShadow);
      await page.locator('#login-user').evaluate(node=>node.removeAttribute('aria-invalid'));
    }
    await page.locator('#login-user').evaluate(node=>node.disabled=true);
    await force(['autofill']);
    expect((await styles()).boxShadow).toContain('1000px');
    await page.locator('#login-user').evaluate(node=>{node.disabled=false;node.readOnly=true;});
    await force(['autofill']);
    expect((await styles()).boxShadow).toContain('1000px');
    await page.locator('#login-user').evaluate(node=>node.readOnly=false);
    await force([]);
    await session.detach();
    await expect(page.locator('#login-pin')).toHaveAttribute('type','password');
    await expect(page.locator('#login-pin')).toHaveAttribute('autocomplete','current-password');
    expect(await page.locator('#login-pin').evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  });

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
    await expect(page).toHaveURL((page.viewportSize()?.width||0)>=768?/#settings\/profile$/ : /#settings$/);
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
    await expect(page.locator('#settings-modal')).toHaveClass(/settings-page-mode/);
    await expect(page.locator('#settings-modal')).not.toHaveAttribute('role','dialog');
    await expect(page.locator('.settings-nav')).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await page.locator('[data-settings-target="tools"]').click();
    await expect(page).toHaveURL(/#settings\/tools$/);
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"]')).toBeHidden();
    await expect(page.locator('[data-settings-target="tools"]')).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('button',{name:'Export backup'})).toBeHidden();
    await expect(page.getByRole('button',{name:'Restore backup'})).toBeHidden();

    await page.setViewportSize({width:390,height:420});
    await page.evaluate(()=>{configureSettingsPanel('account');showSettingsSectionList();});
    await expect(page.locator('#settings-modal')).toHaveAttribute('role','dialog');
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

  test('Settings deep links, invalid fallback, history, and logout remain bounded',async({page})=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?settings-routing=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>{
      cur='SettingsRouteTrainer';
      document.getElementById('login-pg').style.display='none';
      document.getElementById('app').style.display='flex';
      history.replaceState({},'',`${location.pathname}${location.search}#settings/tools`);
      syncSettingsRoute({captureScroll:false});
    });
    await expect(page.locator('#settings-modal')).toHaveClass(/settings-page-mode/);
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await expect(page.locator('[data-settings-target="tools"]')).toHaveAttribute('aria-current','page');

    await page.evaluate(()=>{history.replaceState({},'',`${location.pathname}${location.search}#settings/not-a-section`);syncSettingsRoute({captureScroll:false});});
    await expect(page).toHaveURL(/#settings\/profile$/);
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();

    await page.locator('[data-settings-target="language"]').click();
    await expect(page).toHaveURL(/#settings\/language$/);
    await page.goBack();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await page.goForward();
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();

    await page.evaluate(()=>logout());
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(page).not.toHaveURL(/#settings/);
  });

  test('Settings section intent survives signed-in boot and refresh while anonymous routes stay bounded',async({page})=>{
    await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
    const sections=['profile','language','appearance','security','tools','data'];
    const establishSignedInBoot=async(username='SettingsBootTrainer')=>{
      await page.waitForFunction(()=>typeof syncSettingsRoute==='function'&&typeof syncPendingSettingsRouteAfterAuth==='function');
      await page.evaluate(name=>{
        cur=name;_authStateKnown=true;
        document.getElementById('login-pg').style.display='none';
        document.getElementById('app').style.display='flex';
        syncPendingSettingsRouteAfterAuth();
      },username);
    };
    const hardReload=async()=>{
      const session=await page.context().newCDPSession(page);
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        session.send('Page.reload',{ignoreCache:true})
      ]);
      await session.detach();
    };
    for(const section of sections){
      const route=`#settings/${section}`;
      await page.setViewportSize({width:1024,height:800});
      await page.goto(`./?settings-boot=${section}-${Date.now()}${route}`,{waitUntil:'domcontentloaded'});
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await establishSignedInBoot();
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      if(section==='appearance'||section==='security'){
        await hardReload();
        await establishSignedInBoot();
        await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${route}$`));
      }

      await page.reload({waitUntil:'domcontentloaded'});
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await establishSignedInBoot();
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }

    for(const section of ['appearance','security']){
      const route=`#settings/${section}`;
      await page.setViewportSize({width:390,height:420});
      await page.goto(`./?settings-mobile-boot=${section}-${Date.now()}${route}`,{waitUntil:'domcontentloaded'});
      await establishSignedInBoot('MobileSettingsBootTrainer');
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      await expect(page.locator('#settings-layout')).not.toHaveClass(/mobile-list/);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await page.reload({waitUntil:'domcontentloaded'});
      await establishSignedInBoot('MobileSettingsBootTrainer');
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await hardReload();
      await establishSignedInBoot('MobileSettingsBootTrainer');
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }

    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?settings-anonymous=${Date.now()}#settings/appearance`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof syncSettingsRoute==='function');
    await page.evaluate(()=>{cur=null;_authStateKnown=true;syncPendingSettingsRouteAfterAuth();});
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();
    await expect(page.locator('.settings-account-only:visible')).toHaveCount(0);

    await page.goto(`./?settings-root=${Date.now()}#settings`,{waitUntil:'domcontentloaded'});
    await establishSignedInBoot('SettingsRootTrainer');
    await expect(page).toHaveURL(/#settings(?:\/language)?$/);
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();

    await page.goto(`./?settings-invalid=${Date.now()}#settings/not-real`,{waitUntil:'domcontentloaded'});
    await establishSignedInBoot('SettingsInvalidTrainer');
    await expect(page).toHaveURL(/#settings(?:\/language)?$/);
    await expect(page.locator('[data-settings-section="language"]')).toBeVisible();

    await page.goto(`./?settings-logout=${Date.now()}#settings/security`,{waitUntil:'domcontentloaded'});
    await establishSignedInBoot('SettingsLogoutTrainer');
    await expect(page.locator('[data-settings-section="security"]')).toBeVisible();
    await page.evaluate(()=>{auth=null;logout();});
    await expect(page).not.toHaveURL(/#settings/);
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(page.locator('#login-pg')).toBeVisible();
  });

  test('Appearance preserves a dark background choice while light mode stays neutral',async({page})=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?settings-appearance=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>{
      cur='AppearanceTrainer';allData.users=allData.users||{};allData.users[cur]={...(allData.users[cur]||{}),wallpaper:'ocean'};
      document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
      history.replaceState({},'',`${location.pathname}${location.search}#settings/appearance`);syncSettingsRoute({captureScroll:false});setSettingsTheme('dark');
    });
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    await expect(page.locator('[data-settings-theme="dark"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.wp-swatch.ocean')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.settings-mobile-back')).toBeHidden();
    expect(await page.evaluate(()=>document.body.classList.contains('wp-ocean'))).toBe(true);
    for(const key of ['mono','aurora','ocean','forest','sunset','mist']){
      await page.locator(`.wp-swatch.${key}`).click();
      await expect(page.locator(`.wp-swatch.${key}`)).toHaveAttribute('aria-pressed','true');
      const swatchBox=await page.locator(`.wp-swatch.${key}`).boundingBox();expect(swatchBox?.height).toBeGreaterThanOrEqual(48);
      expect(await page.evaluate(selected=>document.body.classList.contains(`wp-${selected}`),key)).toBe(true);
    }
    await page.locator('.wp-swatch.ocean').click();

    await page.locator('[data-settings-theme="light"]').click();
    await expect(page.locator('#settings-background-group')).toHaveClass(/settings-background-inactive/);
    await expect(page.locator('.wp-swatch.ocean')).toBeDisabled();
    expect(await page.evaluate(()=>({stored:document.getElementById('prof-wallpaper').value,neutral:document.body.classList.contains('wp-mono')}))).toEqual({stored:'ocean',neutral:true});

    await page.emulateMedia({colorScheme:'dark'});await page.locator('[data-settings-theme="auto"]').click();
    expect(await page.evaluate(()=>document.body.classList.contains('wp-ocean'))).toBe(true);
    await page.emulateMedia({colorScheme:'light'});
    await expect.poll(()=>page.evaluate(()=>document.body.classList.contains('wp-mono'))).toBe(true);

    await page.locator('[data-settings-target="profile"]').click();
    for(const id of ['prof-av-input','fc-inp','prof-bio','prof-discord'])await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('#prof-discord-id,.discord-id-help,.discord-id-help-toggle')).toHaveCount(0);
    for(const key of ['settings.profileGroupTrainer','settings.profileGroupPokemonGo','settings.profileGroupAbout'])await expect(page.locator(`[data-i18n="${key}"]`)).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"] #np1')).toHaveCount(0);await expect(page.locator('[data-settings-section="profile"] #wp-picker')).toHaveCount(0);
    await page.locator('[data-settings-target="security"]').click();
    await expect(page.locator('#settings-security-name')).toHaveText('AppearanceTrainer');await expect(page.locator('#np1')).toBeVisible();await expect(page.locator('#np2')).toBeVisible();

    await page.setViewportSize({width:390,height:420});
    await page.evaluate(()=>{configureSettingsPanel('account');showSettingsSectionList();});
    await page.locator('[data-settings-target="appearance"]').click();
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    await expect(page.locator('.settings-mobile-back')).toBeVisible();
    await page.locator('.settings-mobile-back').click();
    await expect(page.locator('.settings-nav')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });

  test('signed-in Settings stays bounded across supported locales and viewports',async({page})=>{
    const locales=['en','ja','es','de'];
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const locale of locales){
      for(const [width,height] of viewports){
        await page.setViewportSize({width,height});
        await page.goto(`./?account-settings-geometry=${locale}-${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
        await waitForSettingsStartupReady(page);
        await page.evaluate(selectedLocale=>{
          cur='SettingsGeometryTrainer';
          document.getElementById('login-pg').style.display='none';
          document.getElementById('app').style.display='flex';
          changeInterfaceLocale(selectedLocale);
          openSettingsPanel('account');
          selectSettingsSection('security',{focus:false,updateHistory:false});
        },locale);
        const geometry=await page.evaluate(()=>{
          const overlay=document.getElementById('settings-modal');
          const nav=document.querySelector('.settings-nav');
          const detail=document.getElementById('settings-detail');
          const section=document.querySelector('[data-settings-section="security"]');
          return{
            pageMode:overlay.classList.contains('settings-page-mode'),
            noDocumentOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
            noNavOverflow:nav.scrollWidth<=nav.clientWidth,
            noDetailOverflow:detail.scrollWidth<=detail.clientWidth,
            noSectionOverflow:section.scrollWidth<=section.clientWidth
          };
        });
        expect(geometry.pageMode).toBe(width>=768);
        expect(geometry.noDocumentOverflow).toBe(true);
        expect(geometry.noNavOverflow).toBe(true);
        expect(geometry.noDetailOverflow).toBe(true);
        expect(geometry.noSectionOverflow).toBe(true);
        await expect(page.locator('.settings-modal-close')).toHaveCSS('min-height','48px');
      }
    }
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
    await expect(page.locator('#organizer-new-tag')).toBeFocused();
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
      const longCard=page.locator('.favorite-card-shell[data-trainer="TrainerNameThatIsDeliberatelyLongForCompactLayouts"]');
      await expect(longCard).toBeVisible();
      const longNameBox=await longCard.locator('.trainer-quick-name').boundingBox();
      const longFooterBox=await longCard.locator('.favorite-card-footer').boundingBox();
      expect((longNameBox?.y||0)+(longNameBox?.height||0)).toBeLessThanOrEqual((longFooterBox?.y||0)+1);
      expect(longNameBox?.height).toBeLessThanOrEqual(44);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
  });

  test('Favorites and Recents stay compact, accessible, and responsive at representative scale',async({page})=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?trainer-collections-scale=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'ScaleTester',uid:'uid-scale-tester'});
    const results=[];
    for(const count of [0,25,100]){
      const measurement=await page.evaluate(async count=>{
        const favorites=Array.from({length:count},(_,index)=>({key:`trainer-${index}`,displayName:`Trainer ${String(index).padStart(3,'0')}`,tagIds:[],createdAt:index+1,updatedAt:index+1}));
        const recent=Array.from({length:Math.min(count,12)},(_,index)=>({key:`recent-${index}`,displayName:`Recent ${String(index).padStart(2,'0')}`,openedAt:Date.now()-index*60000}));
        const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-scale-tester',username:'ScaleTester'},favorites,recent,snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
        const scaleStore={read:()=>state,filterFavorites:()=>favorites,snapshotFor:()=>null,updateCanonicalName:()=>false};
        ensureTrainerHistoryStore=()=>scaleStore;
        document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
        document.getElementById('tab-find').classList.add('active');
        managedPublicShareRepository=null;
        const started=performance.now();await renderTrainerQuickLists();
        return{count,duration:performance.now()-started,cards:document.querySelectorAll('.favorite-card-shell').length,recents:document.querySelectorAll('.recent-trainer-row').length};
      },count);
      results.push(measurement);
      expect(measurement.cards).toBe(count);
      expect(measurement.recents).toBe(Math.min(count,12));
      expect(measurement.duration).toBeLessThan(1500);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
    expect(results.map(result=>result.count)).toEqual([0,25,100]);

    const viewports=[
      ['en',320,640],['ja',375,700],['de',390,700],['es',430,760],
      ['ja',768,800],['de',1024,800],['es',1440,900],
      ['ja',390,420],['de',390,300]
    ];
    for(const [locale,width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.evaluate(async locale=>{changeInterfaceLocale(locale);await renderTrainerQuickLists();},locale);
      await expect(page.locator('#favorite-trainers h2')).toBeVisible();
      await expect(page.locator('#recent-trainers h2')).toBeVisible();
      const firstCard=page.locator('.favorite-card-shell').first();
      const firstRecent=page.locator('.recent-trainer-row').first();
      await expect(firstCard).toBeVisible();await expect(firstRecent).toBeVisible();
      const recentName=firstRecent.locator('.recent-trainer-name');
      const recentRecency=firstRecent.locator('.recent-trainer-recency');
      await expect(recentName).toBeVisible();await expect(recentRecency).toBeVisible();
      await expect(recentRecency).toContainText(/.+/);
      const nameBox=await recentName.boundingBox(),recencyTextBox=await recentRecency.boundingBox(),rowBox=await firstRecent.boundingBox();
      expect(recencyTextBox?.y).toBeGreaterThan(nameBox?.y||0);
      expect(rowBox?.height).toBeLessThan(84);
      const addBox=await firstCard.locator('.favorite-card-add-tag').boundingBox();
      const moreBox=await firstCard.locator('.favorite-card-more').boundingBox();
      const recentBox=await firstRecent.locator('.recent-trainer-chevron').boundingBox();
      for(const box of [addBox,moreBox,recentBox]){expect(box?.width).toBeGreaterThanOrEqual(48);expect(box?.height).toBeGreaterThanOrEqual(48);}
      await expect(firstCard.locator('.favorite-card-add-tag')).toContainText(/\+/);
      expect(await firstCard.locator('.favorite-card-add-tag').evaluate(node=>node.parentElement?.classList.contains('favorite-card-footer'))).toBe(true);
      expect(await firstCard.locator('.favorite-card-tags .favorite-card-add-tag').count()).toBe(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      if(width>=900){
        const favoritesBox=await page.locator('#favorite-trainers').boundingBox(),recentsBox=await page.locator('#recent-trainers').boundingBox();
        expect(recentsBox?.x).toBeGreaterThan((favoritesBox?.x||0)+(favoritesBox?.width||0));
        expect(Math.abs((favoritesBox?.y||0)-(recentsBox?.y||0))).toBeLessThanOrEqual(2);
      }
    }
  });

  test('mobile Recent rows navigate from body, name, chevron, and keyboard without blocking Favorite actions',async({page})=>{
    await page.setViewportSize({width:390,height:420});
    await page.goto(`./?trainer-row-navigation=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'NavigationTester',uid:'uid-navigation-tester'});
    await page.evaluate(async()=>{
      const favorite={key:'favorite-one',displayName:'FavoriteOne',tagIds:[],createdAt:1,updatedAt:1};
      const recent={key:'recent-one',displayName:'RecentOne',openedAt:Date.now()-720000};
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-navigation-tester',username:'NavigationTester'},favorites:[favorite],recent:[recent],snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
      const store={read:()=>state,filterFavorites:()=>state.favorites,snapshotFor:()=>null,updateCanonicalName:()=>false};
      ensureTrainerHistoryStore=()=>store;managedPublicShareRepository=null;
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-find').classList.add('active');
      window.__openedTrainer='';openTrainerPublicShare=async value=>{window.__openedTrainer=value;};
      allData.loginDirectory={RecentOne:{},FavoriteOne:{}};
      await renderTrainerQuickLists();
    });

    const expectOpens=async action=>{
      await page.evaluate(()=>{window.__openedTrainer='';});
      await action();
      await expect.poll(()=>page.evaluate(()=>window.__openedTrainer)).not.toBe('');
    };
    for(const [width,height] of [[375,700],[390,420],[390,300]]){
      await page.setViewportSize({width,height});
      const row=page.locator('.recent-trainer-row').first();
      await expect(row).toBeVisible();
      await expectOpens(()=>row.click({position:{x:18,y:18}}));
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe('RecentOne');
      await expectOpens(()=>row.locator('.recent-trainer-name').click());
      await expectOpens(()=>row.locator('.recent-trainer-chevron').click());
      await row.focus();await expectOpens(()=>page.keyboard.press('Enter'));
      await row.focus();await expectOpens(()=>page.keyboard.press('Space'));
      await expectOpens(()=>page.locator('.favorite-card-open').click());
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe('FavoriteOne');
      expect(await row.locator('button,a,[role="button"]').count()).toBe(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }

    const density=await page.evaluate(async()=>{
      const favoriteHeight=document.querySelector('.favorite-card-shell').getBoundingClientRect().height;
      const recentHeight=document.querySelector('.recent-trainer-row').getBoundingClientRect().height;
      const state=ensureTrainerHistoryStore().read();state.favorites=[];await renderTrainerQuickLists();
      return{favoriteHeight,recentHeight,emptyHeight:document.querySelector('#favorite-trainers .empty-state').getBoundingClientRect().height};
    });
    expect(density.favoriteHeight).toBeLessThan(128);
    expect(density.recentHeight).toBeLessThan(80);
    expect(density.emptyHeight).toBeLessThan(90);

    const status=page.locator('#find-trainer-status');
    await page.evaluate(()=>{document.getElementById('find-trainer-input').value='';renderFindTrainer();});
    await expect(status).toBeHidden();
    await page.locator('#find-trainer-input').fill('Rec');
    await expect(status).toContainText(/.+/);
    await expect(status).toBeHidden({timeout:2000});
  });

  test('My List compact add controls stay responsive and keyboard reachable',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?my-list-creation=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'LocalTester',uid:'uid-local-tester'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{LocalTester:{}},wishlist:{},dynamax:{},gmax:{},costumes:{}});
      allData.wishlist.LocalTester={Pikachu:'H',Eevee:'M',Bulbasaur:'L'};
      renderMyList();
    });
    const measurement=await page.evaluate(()=>{
      const started=performance.now();toggleAddAdvanced();toggleAddAdvanced();
      document.getElementById('export-menu-btn').click();closeExportMenu();
      return performance.now()-started;
    });
    expect(measurement).toBeLessThan(100);
    await expect(page.locator('#ac-input')).toBeVisible();
    await expect(page.locator('#voice-btn')).toHaveAttribute('aria-label',/.+/);
    await expect(page.locator('#export-menu-btn')).toHaveAttribute('aria-haspopup','menu');
    await expect(page.locator('#tab-mylist')).toHaveClass(/has-list-content/);
    await expect(page.locator('.journey-guidance')).toBeHidden();
    await expect(page.locator('.myrow').first().locator(':scope > .mctrl > .flag-btn')).toHaveCount(0);
    await expect(page.locator('.myrow-editor').first()).toBeVisible();
    await page.locator('.myrow-edit').first().click();
    await expect(page.locator('.myrow-editor-popover').first()).toBeVisible();
    await expect(page.locator('.myrow-editor-popover .flag-btn').first()).toBeVisible();
    await expect(page.locator('.myrow-editor-popover .ni').first()).toBeVisible();
    await expect(page.locator('.myrow-editor-popover .rm').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.myrow-editor-popover').first()).toBeHidden();
    const searchBox=await page.locator('#ac-input').boundingBox(),addBox=await page.locator('.add-actions .bsave').boundingBox(),firstRow=await page.locator('.myrow').first().boundingBox();
    expect(Math.abs((searchBox?.y||0)-(addBox?.y||0))).toBeLessThanOrEqual(2);
    expect(firstRow?.y).toBeLessThan(760);
    await page.locator('#export-menu-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await expect(page.locator('#export-menu [role^="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#export-menu')).toBeHidden();
    await expect(page.locator('#export-menu-btn')).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });

  test('My List category counts and empty context remain unmistakable and state-safe',async({page})=>{
    const viewports=[[320,640],[375,700],[390,420],[390,300],[430,760],[768,800],[1024,800],[1440,900]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?my-list-category=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'CategoryTester',uid:'uid-category-tester'});
      await page.evaluate(()=>{
        allData={users:{CategoryTester:{}},wishlist:{CategoryTester:{}},dynamax:{CategoryTester:{}},gmax:{CategoryTester:{}},costumes:{CategoryTester:{}}};
        for(let i=0;i<62;i++)allData.wishlist.CategoryTester[`Trade ${i}`]='H';
        for(let i=0;i<8;i++)allData.dynamax.CategoryTester[`Dmax ${i}`]='M';
        for(let i=0;i<3;i++)allData.gmax.CategoryTester[`Gmax ${i}`]='L';
        document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
        setMyList('costumes');
      });
      const tabs=page.locator('.mylist-type-tabs');
      await expect(tabs.locator('[data-mylist-type="wishlist"]')).toHaveAttribute('aria-label',/62/);
      await expect(tabs.locator('[data-mylist-type="dynamax"]')).toHaveAttribute('aria-label',/8/);
      await expect(tabs.locator('[data-mylist-type="gmax"]')).toHaveAttribute('aria-label',/3/);
      await expect(tabs.locator('[data-mylist-type="costumes"]')).toHaveAttribute('aria-selected','true');
      await expect(tabs.locator('[data-mylist-type="costumes"] .ltab-marker')).toBeVisible();
      expect(await tabs.evaluate(node=>getComputedStyle(node).display)).toBe('flex');
      expect(await tabs.locator('.ltab').first().evaluate(node=>getComputedStyle(node).borderRadius)).toBe('999px');
      await expect(page.locator('#mylist-category-heading')).toContainText('Others');
      await expect(page.locator('#mylist-category-heading')).toHaveClass(/sr-only/);
      const semanticHeadingBox=await page.locator('#mylist-category-heading').boundingBox();
      expect(semanticHeadingBox?.width).toBeLessThanOrEqual(1);expect(semanticHeadingBox?.height).toBeLessThanOrEqual(1);
      await expect(page.locator('#mylist-out')).toContainText('No Pokémon in Others');
      await expect(page.locator('#mylist-out')).toContainText('View Trades (62)');
      await expect(page.locator('#my-strings-out')).toBeEmpty();
      await page.locator('#export-menu-btn').click();await page.keyboard.press('Escape');
      expect(await page.evaluate(()=>myListType)).toBe('costumes');
      await page.evaluate(()=>changeInterfaceLocale('de'));
      expect(await page.evaluate(()=>myListType)).toBe('costumes');
      await expect(tabs.locator('[data-mylist-type="costumes"]')).toHaveAttribute('aria-selected','true');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await page.evaluate(()=>changeInterfaceLocale('en'));
    }

    await page.evaluate(()=>{
      const [first,second]=DB.wishlist.slice(0,2);
      allData.wishlist.CategoryTester={[first.name]:'H',[second.name]:'M'};
      window.__categoryFixtureFirst=first.name;setMyList('wishlist');
    });
    await expect(page.locator('[data-mylist-count="wishlist"]')).toHaveText('2');
    const exportState=await page.evaluate(()=>{
      const before=myListType,create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;
      let created=false;
      try{
        URL.createObjectURL=()=>{created=true;return"blob:fixture";};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};
        exportMyListCSV();
        return{before,after:myListType,created};
      }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;HTMLAnchorElement.prototype.click=click;}
    });
    expect(exportState).toEqual({before:'wishlist',after:'wishlist',created:true});
    await page.evaluate(()=>{delete allData.wishlist.CategoryTester[window.__categoryFixtureFirst];renderMyList();});
    await expect(page.locator('[data-mylist-count="wishlist"]')).toHaveText('1');
  });

  test('authenticated My List fixture preserves every category through CSV export',async({page})=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?my-list-csv-lifecycle=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'CsvFixtureTester',uid:'uid-csv-fixture'});
    const seeded=await page.evaluate(()=>{
      const username='CsvFixtureTester';
      allData={users:{[username]:{}},wishlist:{[username]:{}},dynamax:{[username]:{}},gmax:{[username]:{}},costumes:{[username]:{}}};
      const sources={wishlist:listSource('wishlist'),dynamax:listSource('dynamax'),gmax:listSource('gmax'),costumes:listSource('costumes')};
      for(const type of Object.keys(sources))sources[type].filter(entry=>entry?.name).slice(0,3).forEach((entry,index)=>{allData[type][username][entry.name]=priValue(['H','M','L'][index]);});
      window.__csvLifecycle={
        created:0,downloads:0,writes:[],toasts:[],
        originalCreate:URL.createObjectURL,originalRevoke:URL.revokeObjectURL,
        originalClick:HTMLAnchorElement.prototype.click,originalQueueSync:queueSync,originalToast:toast
      };
      URL.createObjectURL=()=>{window.__csvLifecycle.created++;return'blob:csv-fixture';};
      URL.revokeObjectURL=()=>{};
      HTMLAnchorElement.prototype.click=function(){window.__csvLifecycle.downloads++;};
      queueSync=(...args)=>{window.__csvLifecycle.writes.push(args);return false;};
      toast=message=>{window.__csvLifecycle.toasts.push(String(message));};
      return Object.fromEntries(Object.keys(sources).map(type=>[type,Object.keys(allData[type][username]).length]));
    });
    expect(seeded).toEqual({wishlist:3,dynamax:3,gmax:3,costumes:3});

    for(const type of ['wishlist','dynamax','gmax','costumes']){
      await page.evaluate(type=>setMyList(type),type);
      await page.locator('#mylist-filter').fill('fixture-filter');
      const before=await page.evaluate(type=>{
        const count=Object.keys(allData[type]?.CsvFixtureTester||{}).length;
        if(count<=0)throw new Error('authenticated fixture lost seeded owner data before CSV export');
        return{type:myListType,count,filter:document.getElementById('mylist-filter').value,fingerprint:JSON.stringify(allData),created:window.__csvLifecycle.created,writes:window.__csvLifecycle.writes.length,rendered:document.querySelector(`[data-mylist-count="${type}"]`)?.textContent};
      },type);
      await page.locator('#export-menu-btn').click();
      await page.getByRole('menuitem',{name:/CSV spreadsheet/i}).click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const after=await page.evaluate(type=>({type:myListType,count:Object.keys(allData[type]?.CsvFixtureTester||{}).length,filter:document.getElementById('mylist-filter').value,fingerprint:JSON.stringify(allData),created:window.__csvLifecycle.created,writes:window.__csvLifecycle.writes.length,rendered:document.querySelector(`[data-mylist-count="${type}"]`)?.textContent,menuOpen:document.getElementById('export-menu').classList.contains('open')}),type);
      expect(after).toEqual({...before,created:before.created+1,menuOpen:false});
    }

    await page.evaluate(()=>{allData.costumes.CsvFixtureTester={};setMyList('costumes');});
    const emptyBefore=await page.evaluate(()=>window.__csvLifecycle.created);
    await page.locator('#export-menu-btn').click();
    await page.getByRole('menuitem',{name:/CSV spreadsheet/i}).click();
    expect(await page.evaluate(()=>({created:window.__csvLifecycle.created,writes:window.__csvLifecycle.writes.length,emptyToast:window.__csvLifecycle.toasts.some(message=>message.includes('Add entries'))}))).toEqual({created:emptyBefore,writes:0,emptyToast:true});
    await page.evaluate(()=>{setMyList('costumes');resetMyListCategoryForAccountBoundary();});
    expect(await page.evaluate(()=>myListType)).toBe('wishlist');
    await page.evaluate(()=>{
      URL.createObjectURL=window.__csvLifecycle.originalCreate;URL.revokeObjectURL=window.__csvLifecycle.originalRevoke;
      HTMLAnchorElement.prototype.click=window.__csvLifecycle.originalClick;queueSync=window.__csvLifecycle.originalQueueSync;toast=window.__csvLifecycle.originalToast;
    });
  });

  test('My List priority searches remain adjacent, collapsed, localized, and responsive',async({page})=>{
    const viewports=[[320,640],[375,700],[390,420],[390,300],[430,760],[768,800],[1024,800],[1440,900]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?my-list-search-hierarchy=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'SearchHierarchyTester',uid:'uid-search-hierarchy'});
      await page.waitForTimeout(350);
      await page.evaluate(()=>{
        const entries=DB.wishlist.filter(entry=>entry.no).slice(0,9);
        allData={users:{SearchHierarchyTester:{}},wishlist:{SearchHierarchyTester:{}},dynamax:{SearchHierarchyTester:{}},gmax:{SearchHierarchyTester:{}},costumes:{SearchHierarchyTester:{}}};
        entries.forEach((entry,index)=>{allData.wishlist.SearchHierarchyTester[entry.name]=priValue(index<3?'H':index<6?'M':'L','',index===0,index===1,index===2,false);});
        document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';setMyList('wishlist');
        document.getElementById('top-un').textContent='SearchHierarchyTester';document.getElementById('top-av').textContent='ST';
        document.getElementById('my-un').textContent='SearchHierarchyTester';document.getElementById('my-av').textContent='ST';
      });
      for(const priority of ['H','M','L']){
        const section=page.locator(`[data-priority-section="${priority}"]`);
        await expect(section).toBeVisible();
        expect(await section.evaluate(node=>getComputedStyle(node).borderTopWidth)).toBe('0px');
        expect(await section.locator('.mylist-priority-heading').evaluate(node=>getComputedStyle(node).borderLeftWidth)).toBe('3px');
        const footer=section.locator(`[data-priority-search="${priority}"]`);
        await expect(footer.locator('.cpbtn')).toBeVisible();
        await expect(footer.locator('.mylist-search-raw')).toBeHidden();
        const copyBox=await footer.locator('.cpbtn').boundingBox(),viewBox=await footer.locator('.mylist-search-view').boundingBox();
        expect(copyBox?.height).toBeGreaterThanOrEqual(48);expect(viewBox?.height).toBeGreaterThanOrEqual(48);
      }
      await expect(page.locator('[data-search-option="all-priorities"]')).toBeVisible();
      await expect(page.locator('[data-search-option="high-medium"]')).toBeVisible();
      await expect(page.locator('#mylist-more-combinations')).toBeHidden();
      const searchGridColumns=await page.locator('.mylist-search-groups').evaluate(node=>getComputedStyle(node).gridTemplateColumns);
      if(width>900)expect(searchGridColumns.split(' ').length).toBeGreaterThanOrEqual(2);else expect(searchGridColumns.split(' ').length).toBe(1);
      await expect(page.locator('.mylist-search-raw:visible')).toHaveCount(0);
      if((width===390&&height===420)||(width===1440&&height===900)){
        const suffix=width===390?'mobile':'desktop';
        await page.locator('[data-priority-section="H"]').scrollIntoViewIfNeeded();
        await capturePass3(page,`my-list-populated-rows-${suffix}`);
        await page.locator('.my-string-heading').scrollIntoViewIfNeeded();
        await capturePass3(page,`my-list-advanced-tools-${suffix}`);
      }
      const before=await page.evaluate(()=>({type:myListType,count:Object.keys(allData.wishlist.SearchHierarchyTester).length}));
      const highView=page.locator('[data-priority-search="H"] .mylist-search-view');
      await highView.click();await expect(page.locator('#mylist-search-raw-priority-H')).toBeVisible();
      if(width===320){
        const exact=await page.locator('#mylist-search-raw-priority-H').textContent();
        await page.evaluate(()=>{window.__copiedSearch='';copyText=async value=>{window.__copiedSearch=value;};});
        await page.locator('[data-priority-search="H"] .cpbtn').click();
        expect(await page.evaluate(()=>window.__copiedSearch)).toBe(exact);
        const membership=await page.evaluate(()=>Object.keys(allData.wishlist.SearchHierarchyTester).sort());
        await page.evaluate(()=>changePokemonGoSearchLocale('ja'));
        expect(await page.evaluate(()=>Object.keys(allData.wishlist.SearchHierarchyTester).sort())).toEqual(membership);
        await expect(page.locator('[data-priority-search="H"] .mylist-search-raw')).toBeHidden();
        await page.evaluate(()=>changePokemonGoSearchLocale('en'));
      }else await highView.click();
      await expect(page.locator('#mylist-search-raw-priority-H')).toBeHidden();
      expect(await page.evaluate(()=>({type:myListType,count:Object.keys(allData.wishlist.SearchHierarchyTester).length}))).toEqual(before);
      for(const locale of ['ja','de']){
        await page.evaluate(value=>changeInterfaceLocale(value),locale);
        await expect(page.locator('[data-priority-search="H"] .cpbtn')).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      }
    }
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

  test('public trainer search commands stay collapsed until explicitly requested',async({page})=>{
    await page.goto(`./?public-search-disclosure=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'ViewerFixture',uid:'uid-viewer-fixture'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{PublicFixture:{lastUpdated:Date.now()}},wishlist:{PublicFixture:{Pikachu:'H',Eevee:'M',Bulbasaur:'L'}},dynamax:{},gmax:{},costumes:{}});
      document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');
      renderShareView('PublicFixture','wishlist');
    });
    const disclosures=page.locator('#share-list-out .share-search-disclosure');
    expect(await disclosures.count()).toBeGreaterThanOrEqual(3);
    for(const disclosure of await disclosures.all())await expect(disclosure).not.toHaveAttribute('open','');
    await expect(disclosures.first().locator('.strbox')).toBeHidden();
    await expect(page.locator('#share-list-out .cpbtn').first()).toBeVisible();
    await disclosures.first().locator('summary').click();
    await expect(disclosures.first().locator('.strbox')).toBeVisible();
    await expect(disclosures.first().locator('.share-search-hide-label')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
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
    await expect(page.locator('.legacy-archive-notice')).toBeVisible();
    await expect(page.locator('.have-toggle-row')).toHaveCount(0);
  });

  test('legacy inventory editing controls stay retired', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'have');
    await expect(page.locator('#have-ac-input, #have-bulk-bar, #have-browse-view')).toHaveCount(0);
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
  });

  test('Admin IA remains scannable across responsive widths and locales',async({page})=>{
    await page.goto(`./?admin-ia=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'Doomsday126',uid:'uid-admin-fixture'});
    await page.evaluate(()=>{
      const longName='TrainerNameThatIsDeliberatelyLongForAdministrativeScanning';
      allData=normalizeData({
        users:{
          Doomsday126:{isOwner:true,isAdmin:true,authUid:'uid-admin-fixture',authEmail:'owner@example.invalid',friendCode:'1111 2222 3333',lastUpdated:Date.now()-3600000,lastSeen:Date.now()-1800000},
          AdminFixture:{isAdmin:true,authUid:'uid-admin',authEmail:'admin@example.invalid',friendCode:'4444 5555 6666',lastUpdated:Date.now()-86400000,lastSeen:Date.now()-7200000},
          [longName]:{authUid:'uid-member',authEmail:'member@example.invalid',friendCode:'7777 8888 9999',lastUpdated:Date.now()-604800000,lastSeen:Date.now()-172800000},
          FirstUseFixture:{friendCode:'0000 1111 2222'}
        },
        loginDirectory:{
          Doomsday126:{authReady:true},AdminFixture:{authReady:true},[longName]:{authReady:true},FirstUseFixture:{authReady:false}
        },
        authIndex:{'uid-admin-fixture':{lastSeen:Date.now()-1800000},'uid-admin':{lastSeen:Date.now()-7200000},'uid-member':{lastSeen:Date.now()-172800000}},
        wishlist:{Doomsday126:{Pikachu:'H'},AdminFixture:{Eevee:'M'},[longName]:{Bulbasaur:'L',Charmander:'H'}},
        dynamax:{},gmax:{},costumes:{},requests:{},communities:{},memberships:{},healthChecks:{},securityEvents:{}
      });
      cur='Doomsday126';auth={currentUser:{uid:'uid-admin-fixture'}};
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-admin').classList.add('active');
      renderAdmin();
    });
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>setAdminSection('overview'));
    await capturePass3(page,'admin-overview-desktop');
    await page.evaluate(()=>setAdminSection('members'));
    await capturePass3(page,'admin-members-desktop');
    const widths=[320,375,390,430,768,1024,1440];
    const locales=['ja','de','es','en','de','ja','en'];
    for(let index=0;index<widths.length;index++){
      await page.setViewportSize({width:widths[index],height:Math.min(800,Math.max(420,widths[index]))});
      await page.evaluate(locale=>{changeInterfaceLocale(locale);renderAdmin();},locales[index]);
      for(const section of ['overview','members','access','maintenance','diagnostics']){
        await page.evaluate(section=>setAdminSection(section),section);
        await expect(page.locator(`[data-admin-section="${section}"]`)).toBeVisible();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      }
      const heights=await page.evaluate(()=>[...document.querySelectorAll('.admin-nav-button,.admin-role-actions button,.admin-maintenance-actions button,.admin-actions button')]
        .filter(control=>control.getClientRects().length)
        .map(control=>control.getBoundingClientRect().height));
      for(const height of heights)expect(height).toBeGreaterThanOrEqual(48);
      if(widths[index]===390){await page.evaluate(()=>{setAdminSection('members');document.getElementById('toast')?.classList.remove('show');});await capturePass3(page,'admin-members-mobile');}
    }
    await page.evaluate(()=>setAdminSection('members'));
    await expect(page.locator('.admin-member-row')).toHaveCount(4);
    await expect(page.locator('.admin-member-row').nth(2)).toContainText(/Updated|Aktualisiert|更新|Actualizado/);
    await page.evaluate(()=>setAdminSection('maintenance'));
    await expect(page.locator('.admin-maintenance-row').filter({hasText:'FirstUseFixture'}).getByRole('button')).toHaveCount(2);
    await expect(page.locator('.admin-maintenance-row').filter({hasText:'AdminFixture'}).getByRole('button')).toHaveCount(1);
  });

  test('Legacy Inventory fixture exposes only archive filtering and export',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?legacy-archive=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'ArchiveFixture',uid:'uid-archive-fixture'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{ArchiveFixture:{}},have:{ArchiveFixture:{Pikachu:{qty:2}}},wishlist:{ArchiveFixture:{}},dynamax:{},gmax:{},costumes:{}});
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-have').classList.add('active');
      renderInterimProductLabels();renderMyHave('');
    });
    await expect(page.locator('.legacy-archive-notice')).toBeVisible();
    await expect(page.locator('#have-filter')).toBeVisible();
    await expect(page.locator('#legacy-inventory-export')).toBeVisible();
    await expect(page.locator('#have-ac-input, #have-bulk-bar, #have-browse-view, .have-toggle-row')).toHaveCount(0);
    await expect(page.locator('#legacy-inventory-export .ui-icon')).toBeVisible();
    await capturePass3(page,'legacy-archive-desktop');
    await page.evaluate(()=>{allData.have.ArchiveFixture={};renderMyHave('');});
    await expect(page.locator('#have-mine-out .empty-state')).toBeVisible();
    await capturePass3(page,'legacy-archive-empty-desktop');
    for(const viewport of [{width:390,height:420},{width:390,height:300}]){
      await page.setViewportSize(viewport);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
  });

  test('events renders responsive grouped cards', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'schedule');
    await expect(page.locator('.event-filter-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.event-card, #events-out .empty').first()).toBeVisible({ timeout: 20_000 });
    await expectAppNotBlank(page);
  });

  test('Events timeline keeps chronology compact and distinguishes loading empty filter and error states',async({page})=>{
    await page.goto(`./?events-timeline=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'EventsFixtureTester',uid:'uid-events-fixture'});
    await page.evaluate(()=>switchTab('schedule'));
    await page.evaluate(()=>{
      const now=Date.now(),hour=3600000,day=24*hour;
      const base=[
        {eventID:'active',name:'Raid Hour',eventType:'raid',start:new Date(now-hour).toISOString(),end:new Date(now+2*hour).toISOString(),link:'https://example.com/active'},
        {eventID:'spotlight',name:'Structured Spotlight',eventType:'pokemon-spotlight-hour',start:new Date(now+2*hour).toISOString(),end:new Date(now+3*hour).toISOString(),link:'https://example.com/spotlight'},
        {eventID:'soon',name:'Community Day',eventType:'community-day',start:new Date(now+day).toISOString(),end:new Date(now+day+3*hour).toISOString(),link:'https://example.com/soon'},
        {eventID:'later',name:'A deliberately long seasonal event title that must wrap without widening the timeline',eventType:'event',start:new Date(now+6*day).toISOString(),end:new Date(now+8*day).toISOString(),link:'https://example.com/later'}
      ];
      const extras=Array.from({length:25},(_,index)=>({eventID:`scale-${index}`,name:`Research Event ${index}`,eventType:'research',start:new Date(now+(index+9)*day).toISOString(),end:new Date(now+(index+9)*day+hour).toISOString()}));
      window.__eventTimelineFixture={events:[...base,...extras],raids:[],fetchedAt:now};_eventData=window.__eventTimelineFixture;_eventLoadState='ready';eventTypeFilter='all';renderEventsOnly();
    });
    await expect(page.locator('.event-group[data-group="now"]')).toBeVisible();await expect(page.locator('.event-group[data-group="soon"]')).toBeVisible();await expect(page.locator('.event-group[data-group="later"]')).toBeVisible();
    await expect(page.locator('.event-current-badge')).toBeVisible();await expect(page.locator('.event-card-relative').first()).toContainText(/.+/);
    await expect(page.locator('.event-current-badge')).not.toContainText('●');
    await expect(page.locator('.event-filter[data-type="spotlight"]')).toBeVisible();
    const cueRightEdges=await page.locator('a.event-card .event-card-cue').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().right)));
    expect(Math.max(...cueRightEdges)-Math.min(...cueRightEdges)).toBeLessThanOrEqual(2);
    await expect(page.locator('article.event-card .event-card-cue')).toHaveCount(0);
    await page.setViewportSize({width:390,height:420});
    const filterGeometry=await page.locator('.event-filter-row').evaluate(node=>({clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,tabIndex:node.tabIndex,edge:getComputedStyle(node.parentElement,'::after').display}));
    expect(filterGeometry.scrollWidth).toBeGreaterThan(filterGeometry.clientWidth);
    expect(filterGeometry.tabIndex).toBe(0);
    expect(filterGeometry.edge).not.toBe('none');
    await page.locator('.event-filter-row').evaluate(node=>{node.scrollLeft=node.scrollWidth;node.dispatchEvent(new Event('scroll'));});
    await expect(page.locator('.event-filter-scroll')).toHaveClass(/is-at-end/);
    const sourceRow=page.locator('a.event-card').first();await expect(sourceRow).toHaveAttribute('href','https://example.com/active');await expect(sourceRow).toHaveAttribute('aria-label',/.+/);
    expect(await sourceRow.locator('a,button,[role="button"]').count()).toBe(0);
    await sourceRow.focus();await expect(sourceRow).toBeFocused();
    for(const filter of await page.locator('.event-filter').all()){const box=await filter.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(48);}
    await page.locator('.event-filter[data-type="spotlight"]').click();await expect(page.locator('.event-card')).toHaveCount(1);await expect(page.locator('.event-card')).toContainText('Structured Spotlight');
    await page.locator('.event-filter[data-type="raids"]').click();await expect(page.locator('.event-filter[data-type="raids"]')).toHaveAttribute('aria-pressed','true');
    await page.locator('.event-filter[data-type="gbl"]').click();await expect(page.locator('.events-state')).toContainText(/.+/);await expect(page.locator('.events-state-action')).toBeVisible();await page.locator('.events-state-action').click();await expect(page.locator('.event-filter[data-type="all"]')).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>{_eventData={events:[],raids:[],fetchedAt:Date.now()};_eventLoadState='ready';renderEventsOnly();});await expect(page.locator('.events-state')).toBeVisible();await expect(page.locator('.events-state-action')).toHaveCount(0);
    await page.evaluate(()=>{_eventData=null;_eventLoadState='loading';renderEventsOnly();});await expect(page.locator('#events-out')).toHaveAttribute('aria-busy','true');await expect(page.locator('.ui-state-loading')).toBeVisible();await capturePass3(page,'events-loading-mobile');
    await page.evaluate(()=>{_eventData={events:[],raids:[],fetchedAt:0};_eventLoadState='error';renderEventsOnly();});await expect(page.locator('.ui-state-unavailable')).toBeVisible();await expect(page.locator('.events-state-action')).toBeVisible();await capturePass3(page,'events-error-mobile');
    const viewports=[['en',320,640],['ja',375,700],['de',390,420],['es',430,760],['ja',390,300],['de',768,800],['es',1024,800],['en',1440,900]];
    for(const [locale,width,height] of viewports){await page.setViewportSize({width,height});await page.evaluate(locale=>{changeInterfaceLocale(locale);_eventData=window.__eventTimelineFixture;_eventLoadState='ready';eventTypeFilter='all';renderEventsOnly();},locale);await expect(page.locator('.event-card').first()).toBeVisible();const rowBox=await page.locator('.event-card').first().boundingBox();expect(rowBox?.height).toBeLessThan(150);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);}
  });

  test('main tab switching keeps the app rendered', async ({ page }) => {
    await signIn(page);
    for(const id of ['nav-mylist','nav-find','nav-events']){
      await expect(page.locator(`#${id} .tab-icon`)).toHaveCount(1);
      await expect(page.locator(`#${id} .tab-label`)).toHaveCount(1);
      await expect(page.locator(`#${id}`)).not.toContainText(/[📋🔍📅⚙️]/u);
    }
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
