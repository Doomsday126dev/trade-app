const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const pass3ScreenshotDir=process.env.PASS3_SCREENSHOT_DIR||'';
const favoriteBrowseScreenshotDir=process.env.FAVORITE_BROWSE_SCREENSHOT_DIR||'';
const navScreenshotDir=process.env.NAV_SCREENSHOT_DIR||'';
const securityScreenshotDir=process.env.SECURITY_SCREENSHOT_DIR||'';
const p1ScreenshotDir=process.env.P1_SCREENSHOT_DIR||'';
async function capturePass3(page,name){
  if(!pass3ScreenshotDir)return;
  mkdirSync(pass3ScreenshotDir,{recursive:true});
  await page.screenshot({path:path.join(pass3ScreenshotDir,`${name}.png`),fullPage:false});
}
async function captureFavoriteBrowse(page,name){
  if(!favoriteBrowseScreenshotDir)return;
  mkdirSync(favoriteBrowseScreenshotDir,{recursive:true});
  const autocomplete=name.includes('autocomplete');
  if(autocomplete){await page.screenshot({path:path.join(favoriteBrowseScreenshotDir,`${name}.png`),fullPage:false});return;}
  await page.evaluate(()=>{window.scrollTo(0,0);for(const id of ['toast','undo-toast','favorite-saved-prompt']){const node=document.getElementById(id);if(node){node.classList.remove('show');node.hidden=true;node.style.setProperty('display','none','important');}}});
  await page.waitForTimeout(50);
  await page.screenshot({path:path.join(favoriteBrowseScreenshotDir,`${name}.png`),fullPage:true});
}
async function capturePrimaryNav(page,name){
  if(!navScreenshotDir)return;
  mkdirSync(navScreenshotDir,{recursive:true});
  await page.locator('.tabs').screenshot({path:path.join(navScreenshotDir,`${name}.png`)});
}
async function captureSecurity(page,name){
  if(!securityScreenshotDir)return;
  mkdirSync(securityScreenshotDir,{recursive:true});
  await page.screenshot({path:path.join(securityScreenshotDir,`${name}.png`),fullPage:true});
}
async function captureP1(page,name){
  if(!p1ScreenshotDir)return;
  mkdirSync(p1ScreenshotDir,{recursive:true});
  await page.screenshot({path:path.join(p1ScreenshotDir,`${name}.png`),fullPage:false});
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
  await page.waitForFunction(() => typeof openTrainerOrganizer === 'function' && _authStateKnown === true && window.__pogoStartup?.firebaseStartupSettledAt !== null);
  await page.evaluate(() => {
    resetTrainerOrganizerState();
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function isolateAuthenticatedMyListFixture(page,{username,uid}) {
  await page.waitForFunction(() => _authStateKnown === true && window.__pogoStartup?.firebaseStartupSettledAt !== null && typeof managedSubscriptions?.unsubscribeByKey === 'function');
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
    _authStateKnown === true &&
    window.__pogoStartup?.firebaseStartupSettledAt !== null
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

  test('200% zoom keeps representative primary workflows operable',async({page,browserName})=>{
    await page.setViewportSize({width:720,height:900});
    await page.goto(`./?a11y-zoom=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'ZoomTester',uid:'uid-zoom-tester'});
    await page.evaluate(()=>{
      document.documentElement.style.zoom='2';
      document.getElementById('admin-tab').style.display='flex';
      document.getElementById('top-un').textContent=cur;
      allData.users.ZoomTester={role:'admin',friendCode:'',bio:'',discord:'',wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}};
      const now=Date.now();
      _eventData={fetchedAt:now,raids:[],events:[{eventID:'zoom-event',name:'Zoom Event',eventType:'event',start:new Date(now-3600000).toISOString(),end:new Date(now+3600000).toISOString()}]};
      _eventLoadState='ready';
      eventTypeFilter='all';
      renderMyList('');
    });
    const assertOperable=async selector=>{
      await expect(page.locator(selector)).toBeVisible();
      const box=await page.locator(selector).boundingBox();expect(box?.width).toBeGreaterThan(0);expect(box?.height).toBeGreaterThan(0);
    };
    await assertOperable('#ac-input');
    await openMainTab(page,'find');await assertOperable('#find-trainer-input');
    await page.locator('#favorite-browse-toggle').click();await assertOperable('#favorite-browse-input');
    await openMainTab(page,'schedule');await assertOperable('.event-filter-row');
    await page.evaluate(()=>openSettingsPanel('language',{route:false}));await assertOperable('#settings-modal .settings-modal-close');
    await page.evaluate(()=>closeModal('settings-modal',{route:false}));
    await page.evaluate(()=>{document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));document.getElementById('share-view').classList.add('active');document.getElementById('share-view').style.display='block';document.getElementById('share-hdr').textContent='PublicTrainer';});
    await assertOperable('#share-view');
    await page.evaluate(()=>{document.getElementById('share-view').classList.remove('active');document.getElementById('share-view').style.display='none';document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));document.getElementById('tab-admin').classList.add('active');});
    await assertOperable('#tab-admin .admin-nav');
    const adminButtons=page.locator('#tab-admin .admin-nav-button');
    await expect(adminButtons).toHaveCount(5);
    await adminButtons.last().scrollIntoViewIfNeeded();
    await adminButtons.last().focus();
    await expect(adminButtons.last()).toBeFocused();
    const lastAdminBox=await adminButtons.last().boundingBox();
    expect(lastAdminBox?.width).toBeGreaterThan(0);
    expect(lastAdminBox?.height).toBeGreaterThan(0);
    await captureP1(page,`200-percent-${browserName}`);
  });

  test('installed shell serves Settings and public-profile deep links offline',async({page,context,browserName})=>{
    test.skip(browserName!=='chromium','This local offline-control proof is Chromium-only; worker logic is covered by the engine-neutral harness.');
    await page.goto(`./?pwa-offline-prime=${Date.now()}`,{waitUntil:'networkidle'});
    await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
    if(!await page.evaluate(()=>!!navigator.serviceWorker.controller))await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await context.setOffline(true);
    try{
      await page.goto('./#settings/language',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#login-pg')).toBeVisible();
      await page.goto('./?share=OfflineTrainer',{waitUntil:'domcontentloaded'});
      expect(await page.locator('#share-view, #login-pg').evaluateAll(nodes=>nodes.some(node=>getComputedStyle(node).display!=='none'))).toBe(true);
    }finally{
      await context.setOffline(false);
    }
  });

  test('owner primary navigation keeps shared optical geometry in every selected state',async({page})=>{
    await page.goto(`./?primary-nav-geometry=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'OwnerNavFixture',uid:'uid-owner-nav-fixture'});
    await page.evaluate(()=>{
      const admin=document.getElementById('admin-tab');
      admin.style.display='inline-flex';
      const badge=document.getElementById('admin-notif');
      badge.style.display='inline-flex';
      badge.textContent='2';
    });
    const ids=['nav-mylist','nav-find','nav-events','admin-tab'];
    for(const [width,height] of [[375,700],[390,700],[430,760],[768,800],[1440,900]]){
      await page.setViewportSize({width,height});
      const selectedMeasurements=[];
      for(const selectedId of ids){
        const measurements=await page.evaluate(({ids,selectedId})=>{
          const rounded=value=>Math.round(value*100)/100;
          for(const id of ids){
            const tab=document.getElementById(id);
            const selected=id===selectedId;
            tab.classList.toggle('active',selected);
            tab.setAttribute('aria-selected',String(selected));
          }
          return ids.map(id=>{
            const item=document.getElementById(id);
            const slot=item.querySelector('.tab-icon-slot');
            const svg=item.querySelector('.tab-icon');
            const use=svg.querySelector('use');
            const shortLabel=item.querySelector('.tab-short-label');
            const fullLabel=item.querySelector('.tab-label');
            const label=getComputedStyle(shortLabel).display==='none'?fullLabel:shortLabel;
            const itemBox=item.getBoundingClientRect();
            const slotBox=slot.getBoundingClientRect();
            const svgBox=svg.getBoundingClientRect();
            const labelBox=label.getBoundingClientRect();
            const art=use.getBBox();
            return{
              id,selected:id===selectedId,
              item:{x:rounded(itemBox.x),y:rounded(itemBox.y),width:rounded(itemBox.width),height:rounded(itemBox.height),bottom:rounded(itemBox.bottom)},
              slot:{x:rounded(slotBox.x),y:rounded(slotBox.y),width:rounded(slotBox.width),height:rounded(slotBox.height),centerY:rounded(slotBox.y+slotBox.height/2)},
              svg:{x:rounded(svgBox.x),y:rounded(svgBox.y),width:rounded(svgBox.width),height:rounded(svgBox.height)},
              label:{x:rounded(labelBox.x),y:rounded(labelBox.y),width:rounded(labelBox.width),height:rounded(labelBox.height),centerY:rounded(labelBox.y+labelBox.height/2)},
              artwork:{width:rounded(art.width),height:rounded(art.height),centerY:rounded(svgBox.y+art.y+art.height/2)},
              verticalGap:rounded(labelBox.y-slotBox.bottom),
              activeTreatment:getComputedStyle(item).boxShadow
            };
          });
        },{ids,selectedId});
        const spread=(values)=>Math.max(...values)-Math.min(...values);
        expect(spread(measurements.map(item=>item.slot.width))).toBeLessThanOrEqual(.5);
        expect(spread(measurements.map(item=>item.slot.height))).toBeLessThanOrEqual(.5);
        expect(spread(measurements.map(item=>item.slot.centerY))).toBeLessThanOrEqual(1);
        expect(spread(measurements.map(item=>item.artwork.width))).toBeLessThanOrEqual(.5);
        expect(spread(measurements.map(item=>item.artwork.height))).toBeLessThanOrEqual(.5);
        expect(spread(measurements.map(item=>item.artwork.centerY))).toBeLessThanOrEqual(1);
        expect(spread(measurements.map(item=>item.item.height))).toBeLessThanOrEqual(1);
        expect(spread(measurements.map(item=>item.item.bottom))).toBeLessThanOrEqual(1);
        if(width<768){
          expect(spread(measurements.map(item=>item.verticalGap))).toBeLessThanOrEqual(1);
          expect(spread(measurements.map(item=>item.label.y))).toBeLessThanOrEqual(1);
          expect(spread(measurements.map(item=>item.label.height))).toBeLessThanOrEqual(1);
        }else{
          expect(spread(measurements.map(item=>item.label.centerY))).toBeLessThanOrEqual(1);
        }
        expect(measurements.find(item=>item.selected).activeTreatment).not.toBe('none');
        selectedMeasurements.push(measurements);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      if([375,390,430,1440].includes(width))await capturePrimaryNav(page,`after-${width}-admin`);
      test.info().attach(`primary-nav-${width}-geometry`,{body:Buffer.from(JSON.stringify(selectedMeasurements[0],null,2)),contentType:'application/json'});
    }
  });

  test('shared Login fields retain themed autofill, focus, and invalid layers',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Chromium CDP is required to force the autofill pseudo-state.');
    await page.goto(`./?autofill-theme=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#login-user')).toBeVisible();
    await expect(page.locator('#login-user')).toBeEnabled();
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
    await expect(page).toHaveURL(/#settings\/profile$/);
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await page.goForward();
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
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
    await expect(page.locator('#prof-av-input')).toBeHidden();
    for(const id of ['prof-av-open','prof-av-preview','fc-inp','prof-bio','prof-discord'])await expect(page.locator(`#${id}`)).toBeVisible();
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
    for(const surface of ['share','login','account']){
      await page.goto(`./?settings-scroll-lifecycle=${surface}-${Date.now()}`,{waitUntil:'domcontentloaded'});
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

  test('Favorites search keeps focus, caret, filtering, and composition on one stable input',async({page})=>{
    for(const [width,theme] of [[390,'dark'],[1440,'light']]){
      await page.setViewportSize({width,height:800});
      await page.goto(`./?favorite-search-focus=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await installLocalOrganizerFixture(page);
      await page.evaluate(async theme=>{
        const store=ensureTrainerHistoryStore();store.toggleFavorite('交換トレーナー');
        document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
        document.getElementById('tab-find').classList.add('active');
        applyTheme(theme);await renderTrainerQuickLists();
        window.__favoriteSearchInput=document.querySelector('.favorite-toolbar-search input');
        window.__favoriteSearchRenderCount=0;
        const render=renderTrainerQuickLists;
        renderTrainerQuickLists=options=>{window.__favoriteSearchRenderCount++;return render(options);};
      },theme);
      const input=page.locator('.favorite-toolbar-search input');
      await input.focus();
      let expected='';
      for(const char of 'Alpha'){
        expected+=char;await page.keyboard.type(char);
        await expect(input).toHaveValue(expected);await expect(input).toBeFocused();
        expect(await input.evaluate(element=>({same:element===window.__favoriteSearchInput,start:element.selectionStart,end:element.selectionEnd}))).toEqual({same:true,start:expected.length,end:expected.length});
        await expect(page.locator('.favorite-card-shell')).toHaveCount(expected==='A'?3:1);
      }
      await page.keyboard.press('Backspace');await expect(input).toHaveValue('Alph');await expect(input).toBeFocused();
      await input.evaluate(element=>{element.setSelectionRange(0,element.value.length);element.setRangeText('Beta',0,element.value.length,'end');element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:'Beta'}));});
      await expect(input).toHaveValue('Beta');await expect(input).toBeFocused();await expect(page.locator('.favorite-card-shell')).toHaveCount(1);
      await input.evaluate(element=>{element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));element.value='交換';element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'交換',isComposing:true}));element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'交換'}));});
      await expect(input).toHaveValue('交換');await expect(input).toBeFocused();await expect(page.locator('.favorite-card-shell')).toHaveCount(2);
      await input.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.press('Backspace');
      await expect(input).toHaveValue('');await expect(input).toBeFocused();await expect(page.locator('.favorite-card-shell')).toHaveCount(4);
      expect(await page.evaluate(()=>({same:document.querySelector('.favorite-toolbar-search input')===window.__favoriteSearchInput,renders:window.__favoriteSearchRenderCount}))).toEqual({same:true,renders:9});
      await expect(page.locator('[data-favorite-clear]')).toBeHidden();
    }
  });

  test('last Favorite overflow menu escapes card clipping and remains hit-testable',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?favorite-card-overflow=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await installLocalOrganizerFixture(page);
    await page.evaluate(async()=>{
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-find').classList.add('active');
      managedPublicShareRepository=null;
      await renderTrainerQuickLists();
    });

    const cards=page.locator('.favorite-card-shell');
    const card=cards.last();
    await card.scrollIntoViewIfNeeded();
    await card.locator('.favorite-card-more').click();
    const menu=card.locator('.favorite-card-menu');
    const action=menu.getByRole('menuitem').first();
    await expect(menu).toBeVisible();

    const geometry=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('.favorite-card-shell')];
      const card=cards.at(-1),previous=cards.at(-2),menu=card.querySelector('.favorite-card-menu');
      const action=menu.querySelector('[role="menuitem"]');
      const rect=value=>{const box=value.getBoundingClientRect();return{top:box.top,right:box.right,bottom:box.bottom,left:box.left,width:box.width,height:box.height};};
      const menuRect=rect(menu),cardRect=rect(card),previousRect=rect(previous),actionRect=rect(action);
      const point={x:actionRect.left+(actionRect.width/2),y:actionRect.top+(actionRect.height/2)};
      const hit=document.elementFromPoint(point.x,point.y);
      const clippingAncestors=[];
      for(let node=menu.parentElement;node;node=node.parentElement){
        const style=getComputedStyle(node);
        if(['hidden','clip','auto','scroll'].includes(style.overflowX)||['hidden','clip','auto','scroll'].includes(style.overflowY)){
          const ancestorRect=rect(node);
          if(menuRect.left<ancestorRect.left||menuRect.right>ancestorRect.right||menuRect.top<ancestorRect.top||menuRect.bottom>ancestorRect.bottom){
            clippingAncestors.push({className:node.className,overflowX:style.overflowX,overflowY:style.overflowY});
          }
        }
      }
      return{
        menuRect,cardRect,previousRect,actionRect,clippingAncestors,
        overlapsPrevious:point.y>=previousRect.top&&point.y<=previousRect.bottom,
        actionHit:hit===action||action.contains(hit),
        insideViewport:menuRect.left>=0&&menuRect.top>=0&&menuRect.right<=innerWidth&&menuRect.bottom<=innerHeight
      };
    });
    expect(geometry.menuRect.top).toBeLessThan(geometry.cardRect.top);
    expect(geometry.overlapsPrevious).toBe(true);
    expect(geometry.clippingAncestors).toEqual([]);
    expect(geometry.insideViewport).toBe(true);
    expect(geometry.actionHit).toBe(true);
    await action.click();
    await expect(page.locator('#trainer-organizer-modal')).toBeVisible();
  });

  test('Browse Favorites stays Favorite-only across canonical search, bounded hydration, retry, refresh, and responsive states',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?favorite-pokemon-browse=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'BrowseTester',uid:'uid-browse-tester'});
    await page.evaluate(async()=>{
      const now=Date.now();
      const state={
        version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-browse-tester',username:'BrowseTester'},
        favorites:[
          {key:'traineralpha',displayName:'TrainerAlpha',tagIds:['nyc'],createdAt:1,updatedAt:1},
          {key:'trainerbeta',displayName:'TrainerBeta',tagIds:['soon'],createdAt:2,updatedAt:2},
          {key:'trainergamma',displayName:'TrainerGamma',tagIds:[],createdAt:3,updatedAt:3}
        ],
        recent:[{key:'trainerbeta',displayName:'TrainerBeta',openedAt:now},{key:'traineralpha',displayName:'TrainerAlpha',openedAt:now-1000}],
        snapshots:{},tags:{nyc:{id:'nyc',label:'NYC'},soon:{id:'soon',label:'Trade soon'}},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}
      };
      const store={
        read:()=>state,filterFavorites:()=>state.favorites,snapshotFor:()=>null,updateCanonicalName:()=>false,
        favoriteFor:value=>state.favorites.find(item=>item.displayName.toLowerCase()===String(value).toLowerCase())||null
      };
      ensureTrainerHistoryStore=()=>store;
      window.__favoriteBrowseFixture={state,reads:{},opened:'',unpublished:false};
      const share=(username,lists)=>({version:1,username,profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:now},lists,publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:now});
      managedPublicShareRepository={read:async username=>{
        const reads=window.__favoriteBrowseFixture.reads;
        reads[username]=(reads[username]||0)+1;
        await new Promise(resolve=>setTimeout(resolve,250));
        if(window.__favoriteBrowseFixture.unpublished)return{ok:true,value:null};
        if(username==='TrainerGamma'&&reads[username]===1)return{ok:false,error:{code:'offline'}};
        const lists=username==='TrainerAlpha'
          ?{wishlist:{Palkia:'L'},dynamax:{Palkia:'H'},gmax:{},costumes:{}}
          :username==='TrainerBeta'
            ?{wishlist:{Palkia:'M'},dynamax:{},gmax:{},costumes:{}}
            :{wishlist:{Palkia:'L'},dynamax:{},gmax:{},costumes:{}};
        return{ok:true,value:share(username,lists)};
      }};
      favoriteShareSessionCache=null;favoriteBrowseState={selected:null,suggestions:[],focusIndex:-1,busy:false,error:false,generation:0,expanded:false};
      allData.loginDirectory={};
      switchTab('find',{render:false});
      openTrainerPublicShare=async username=>{window.__favoriteBrowseFixture.opened=username;};
      renderInterimProductLabels();renderFavoriteBrowseResults();await renderTrainerQuickLists();resetSessionTransientUi('fixture_ready');
    });

    await page.evaluate(()=>applyTheme('dark'));
    await expect(page.locator('#favorite-pokemon-browse')).toBeVisible();
    expect(await page.evaluate(()=>document.getElementById('favorite-trainers').contains(document.getElementById('favorite-pokemon-browse')))).toBe(false);
    await expect(page.locator('.trainer-discovery-modes')).toBeVisible();
    await expect(page.locator('#favorite-browse-toggle')).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('#favorite-browse-panel')).toBeHidden();
    await captureFavoriteBrowse(page,'01-desktop-idle-collapsed');
    await page.locator('#favorite-browse-toggle').click();
    await expect(page.locator('#favorite-browse-panel')).toBeVisible();
    await page.evaluate(()=>ensureFavoriteShareSessionCache().invalidate());
    await page.locator('#favorite-browse-input').fill('Palkia');
    await expect(page.locator('#favorite-browse-suggestions.open .ac-item').first()).toBeVisible();
    const darkAutocomplete=await page.evaluate(()=>{
      const dropdown=document.getElementById('favorite-browse-suggestions'),active=dropdown.querySelector('.ac-item[aria-selected="true"]');
      const probe=document.createElement('span');document.body.appendChild(probe);
      const token=property=>{probe.style.backgroundColor=`var(${property})`;const value=getComputedStyle(probe).backgroundColor;probe.style.backgroundColor='';return value;};
      const result={dropdown:getComputedStyle(dropdown).backgroundColor,active:getComputedStyle(active).backgroundColor,raised:token('--surface-raised'),hover:token('--surface-hover'),text:getComputedStyle(active).color};
      probe.remove();return result;
    });
    expect(darkAutocomplete.dropdown).toBe(darkAutocomplete.raised);
    expect(darkAutocomplete.active).toBe(darkAutocomplete.hover);
    expect(darkAutocomplete.dropdown).not.toBe('rgb(255, 255, 255)');
    await captureFavoriteBrowse(page,'06-dark-autocomplete-open');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(()=>favoriteBrowseState.selected?.name)).toBe('Palkia');
    await expect(page.locator('#favorite-browse-toggle')).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('#favorite-browse-results')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('.favorite-browse-progress')).toContainText(/3/);
    await expect(page.locator('.favorite-browse-row')).toHaveCount(2);
    await expect(page.locator('.favorite-browse-row').first()).toContainText('High');
    await expect(page.locator('.favorite-browse-row').first()).toContainText('Dynamax');
    await expect(page.locator('.favorite-browse-row').first()).toContainText('NYC');
    await expect(page.locator('.favorite-browse-row').first().locator('.favorite-browse-match')).toContainText('I Have Their Wants');
    await expect(page.locator('.favorite-browse-partial')).toBeVisible();
    const beforeRetry=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    await page.getByRole('button',{name:/Retry unavailable/i}).click();
    await expect(page.locator('.favorite-browse-row')).toHaveCount(3);
    const afterRetry=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    expect(afterRetry.TrainerAlpha).toBe(beforeRetry.TrainerAlpha);
    expect(afterRetry.TrainerBeta).toBe(beforeRetry.TrainerBeta);
    expect(afterRetry.TrainerGamma).toBe(beforeRetry.TrainerGamma+1);
    await expect(page.locator('.favorite-browse-partial')).toHaveCount(0);
    await captureFavoriteBrowse(page,'05-desktop-expanded-results');

    const readsBeforeCollapse=await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads));
    await page.locator('#favorite-browse-toggle').click();
    await expect(page.locator('#favorite-browse-panel')).toBeHidden();
    await page.locator('#favorite-browse-toggle').click();
    await expect(page.locator('.favorite-browse-row')).toHaveCount(3);
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeCollapse);

    const readsBeforeTag=await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads));
    await page.evaluate(()=>{window.__favoriteBrowseFixture.state.favorites[0].tagIds=['soon'];renderFavoriteBrowseResults();});
    await expect(page.locator('.favorite-browse-row').filter({hasText:'TrainerAlpha'})).toContainText('Trade soon');
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeTag);
    await page.locator('.favorite-browse-open').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__favoriteBrowseFixture.opened)).not.toBe('');

    const readsBeforeKeystrokes=await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads));
    await page.locator('#favorite-browse-input').fill('Eevee');
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeKeystrokes);
    await expect(page.locator('#favorite-browse-suggestions.open .ac-item').first()).toBeVisible();
    await page.locator('#favorite-browse-input').press('Enter');
    await expect(page.locator('#favorite-browse-results')).toContainText(/None|Keine|Ninguno|いません/);
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeKeystrokes);
    await page.evaluate(()=>{const input=document.getElementById('find-trainer-input');if(input)input.value='';});

    await page.evaluate(()=>applyTheme('light'));
    await page.waitForTimeout(240);
    await page.locator('#favorite-browse-input').fill('Palkia');
    await expect(page.locator('#favorite-browse-suggestions.open .ac-item').first()).toBeVisible();
    const lightAutocomplete=await page.evaluate(()=>{
      const dropdown=document.getElementById('favorite-browse-suggestions'),active=dropdown.querySelector('.ac-item[aria-selected="true"]');
      const probe=document.createElement('span');document.body.appendChild(probe);
      const token=property=>{probe.style.backgroundColor=`var(${property})`;const value=getComputedStyle(probe).backgroundColor;probe.style.backgroundColor='';return value;};
      const result={dropdown:getComputedStyle(dropdown).backgroundColor,active:getComputedStyle(active).backgroundColor,raised:token('--surface-raised'),hover:token('--surface-hover')};
      probe.remove();return result;
    });
    expect(lightAutocomplete.dropdown).toBe(lightAutocomplete.raised);
    expect(lightAutocomplete.active).toBe(lightAutocomplete.hover);
    await captureFavoriteBrowse(page,'07-light-autocomplete-open');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>applyTheme('dark'));

    await page.evaluate(()=>{favoriteBrowseState.selected=null;favoriteBrowseState.expanded=false;document.getElementById('favorite-browse-input').value='';const trainerInput=document.getElementById('find-trainer-input');if(trainerInput)trainerInput.value='';resetSessionTransientUi('fixture_capture');renderFavoriteBrowseResults();});
    await page.setViewportSize({width:390,height:844});
    await captureFavoriteBrowse(page,'02-mobile-idle-collapsed');
    await page.locator('#favorite-browse-toggle').click();
    await captureFavoriteBrowse(page,'03-mobile-expanded-before-selection');
    await page.evaluate(()=>{favoriteBrowseState.selected={name:'Palkia',dn:'Palkia',no:484};favoriteBrowseState.expanded=true;document.getElementById('favorite-browse-input').value='Palkia';renderFavoriteBrowseResults();});
    await expect(page.locator('.favorite-browse-row')).toHaveCount(3);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await captureFavoriteBrowse(page,'04-mobile-populated-results');

    const beforeRefresh=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    await page.getByRole('button',{name:/Refresh/i}).click();
    await expect.poll(()=>page.evaluate(()=>Object.values(window.__favoriteBrowseFixture.reads).reduce((sum,value)=>sum+value,0))).toBe(Object.values(beforeRefresh).reduce((sum,value)=>sum+value,0)+3);
    await expect(page.locator('.favorite-browse-row')).toHaveCount(3);
    for(const {locale,width} of [{locale:'ja',width:320},{locale:'de',width:390},{locale:'es',width:430},{locale:'en',width:1440}]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(locale=>changeInterfaceLocale(locale),locale);
      await expect(page.locator('#favorite-browse-title')).toBeVisible();
      await expect(page.locator('.favorite-browse-row')).toHaveCount(3);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      const openBox=await page.locator('.favorite-browse-open').first().boundingBox();
      expect(openBox?.height).toBeGreaterThanOrEqual(48);
    }
    await page.evaluate(async()=>{window.__favoriteBrowseFixture.unpublished=true;ensureFavoriteShareSessionCache().invalidate();await hydrateFavoriteBrowse({force:true});});
    await expect(page.locator('#favorite-browse-results')).toContainText('None of your Favorites currently have a shared list.');
    await page.evaluate(()=>{window.__favoriteBrowseFixture.state.favorites=[];renderFavoriteBrowseResults();});
    await expect(page.locator('#favorite-browse-results')).toContainText(/No Favorites|Keine Favoriten|Sin favoritos|お気に入り/);
  });

  test('Browse exits Checking 0 of 3 when every exact Favorite read stops settling',async({page,browserName})=>{
    test.skip(browserName!=='chromium');
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?favorite-browse-deadline=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'BrowseDeadline',uid:'uid-browse-deadline'});
    const result=await page.evaluate(async()=>{
      const favorites=['Alpha','Beta','Gamma'].map((displayName,index)=>({key:displayName.toLowerCase(),displayName,tagIds:[],createdAt:index,updatedAt:index}));
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-browse-deadline',username:'BrowseDeadline'},favorites,recent:[],snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
      ensureTrainerHistoryStore=()=>({read:()=>state,filterFavorites:()=>favorites,snapshotFor:()=>null,updateCanonicalName:()=>false,favoriteFor:name=>favorites.find(item=>item.displayName===name)||null});
      let reads=0,active=0,maxActive=0;
      managedPublicShareRepository={read:()=>{reads++;active++;maxActive=Math.max(maxActive,active);return new Promise(()=>{});}};
      favoriteShareSessionCache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({
        repository:managedPublicShareRepository,
        validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,
        projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot,
        concurrency:4,maxFavorites:favoriteShareSessionCacheData.DEFAULT_MAX_FAVORITES,readDeadlineMs:25
      });
      favoriteBrowseState={selected:{name:'Cascoon',dn:'Cascoon',no:268},suggestions:[],focusIndex:-1,busy:false,error:false,generation:0,expanded:true};
      switchTab('find',{render:false});document.getElementById('favorite-browse-input').value='Cascoon';syncFavoriteBrowseDisclosure();
      const pending=hydrateFavoriteBrowse();
      await new Promise(resolve=>setTimeout(resolve,0));
      const loading=document.getElementById('favorite-browse-results').textContent;
      await pending;
      return{reads,active,maxActive,loading,busy:favoriteBrowseState.busy,summary:favoriteShareSessionCache.summary(favorites)};
    });
    expect(result.reads).toBe(3);expect(result.active).toBe(3);expect(result.maxActive).toBe(3);expect(result.loading).toContain('0');expect(result.loading).toContain('3');expect(result.busy).toBe(false);expect(result.summary).toMatchObject({checked:3,failed:3});
    await expect(page.locator('#favorite-browse-results')).not.toHaveAttribute('aria-busy','true');
    await expect(page.getByRole('button',{name:/Retry unavailable/i})).toBeVisible();
  });

  test('Browse explicitly hydrates 21 and 100 Favorites with four-way bounded exact reads',async({page,browserName})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?favorite-browse-scale=${browserName}-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'BrowseScale',uid:'uid-browse-scale'});
    await page.evaluate(()=>switchTab('find',{render:false}));
    await expect(page.locator('#tab-find')).toBeVisible();
    for(const count of [21,100]){
      const result=await page.evaluate(async count=>{
        const favorites=Array.from({length:count},(_,index)=>({key:`trainer-${index}`,displayName:`Trainer-${index}`,tagIds:[],createdAt:index,updatedAt:index}));
        const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-browse-scale',username:'BrowseScale'},favorites,recent:[],snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
        ensureTrainerHistoryStore=()=>({read:()=>state,filterFavorites:()=>favorites,snapshotFor:()=>null,updateCanonicalName:()=>false,favoriteFor:name=>favorites.find(item=>item.displayName===name)||null});
        let reads=0,active=0,maxActive=0;
        managedPublicShareRepository={read:async username=>{reads++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,count===100?20:1));active--;return{ok:true,value:{version:1,username,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1}};}};
        favoriteShareSessionCache=null;favoriteBrowseState.selected={name:'Pikachu',dn:'Pikachu',no:25};favoriteBrowseState.expanded=true;
        document.getElementById('favorite-browse-input').value='Pikachu';document.getElementById('favorite-browse-panel').hidden=false;
        closeFavoriteBrowseSuggestions();
        const started=performance.now();await hydrateFavoriteBrowse();const firstDuration=performance.now()-started;
        const afterHydrate=reads;
        favoriteBrowseInput('Pika');favoriteBrowseInput('Pikachu');renderFavoriteBrowseResults();
        return{count,reads,afterHydrate,maxActive,firstDuration,results:document.querySelectorAll('.favorite-browse-row').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      },count);
      expect(result.reads).toBe(count);expect(result.afterHydrate).toBe(count);expect(result.maxActive).toBeLessThanOrEqual(4);expect(result.results).toBe(count);expect(result.overflow).toBe(false);expect(result.firstDuration).toBeLessThan(2500);
      if(count===100){
        await page.evaluate(()=>{ensureFavoriteShareSessionCache().invalidate();window.__p1BrowseHydration=hydrateFavoriteBrowse({force:true});closeFavoriteBrowseSuggestions();});
        await expect(page.locator('#favorite-browse-results')).toHaveAttribute('aria-busy','true');
        await expect(page.locator('.favorite-browse-progress')).toContainText(/100/);
        await captureP1(page,`browse-100-loading-${browserName}`);
        await page.evaluate(()=>window.__p1BrowseHydration);
        await captureP1(page,`browse-100-complete-${browserName}`);
      }
    }
  });

  test('Favorite cards remain local until an explicit Browse selection or trainer open',async({page,browserName})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?favorite-read-boundary=${browserName}-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'ReadBoundary',uid:'uid-read-boundary'});
    const initial=await page.evaluate(async()=>{
      const allFavorites=Array.from({length:100},(_,index)=>({
        key:`trainer-${index}`,displayName:`Trainer ${String(index).padStart(3,'0')}`,
        tagIds:index%2===0?['even']:[],createdAt:index+1,updatedAt:index+1
      }));
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-read-boundary',username:'ReadBoundary'},favorites:[],recent:[],snapshots:{},tags:{even:{id:'even',label:'Even'}},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
      const key=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
      const store={
        read:()=>state,
        filterFavorites:({query='',tagIds=[]}={})=>state.favorites.filter(item=>(!query||key(item.displayName).includes(key(query)))&&tagIds.every(id=>item.tagIds.includes(id))),
        favoriteFor:value=>state.favorites.find(item=>key(item.displayName)===key(value))||null,
        isFavorite:value=>!!store.favoriteFor(value),
        updateCanonicalName:()=>false,
        saveFavoriteOrganization:value=>{
          if(store.isFavorite(value))return{ok:true,created:false,state};
          if(state.favorites.length>=100)return{ok:false,code:'favorite-limit'};
          const item={key:key(value),displayName:String(value),tagIds:[],createdAt:Date.now(),updatedAt:Date.now()};state.favorites.push(item);return{ok:true,created:true,state};
        },
        toggleFavorite:value=>{const index=state.favorites.findIndex(item=>key(item.displayName)===key(value));if(index>=0)state.favorites.splice(index,1);else store.saveFavoriteOrganization(value);return state;}
      };
      ensureTrainerHistoryStore=()=>store;
      let reads=0,active=0,maxActive=0;
      const perTrainer={};
      managedPublicShareRepository={read:async username=>{
        reads++;active++;maxActive=Math.max(maxActive,active);perTrainer[username]=(perTrainer[username]||0)+1;
        await new Promise(resolve=>setTimeout(resolve,5));active--;
        if(username==='Trainer 000'&&perTrainer[username]===1)return{ok:false,error:{code:'offline'}};
        if(username==='Trainer 001')return{ok:false,error:{code:'permission-denied'}};
        return{ok:true,value:{version:1,username,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1}};
      }};
      favoriteShareSessionCache=null;favoriteBrowseState={selected:null,suggestions:[],focusIndex:-1,busy:false,error:false,generation:0,expanded:false};
      window.__favoriteReadBoundary={state,store,allFavorites,metrics:()=>({reads,active,maxActive,perTrainer:{...perTrainer}}),profileReads:[]};
      switchTab('find',{render:false});
      const counts={};
      for(const count of [0,1,20,21,100]){
        state.favorites=allFavorites.slice(0,count);favoriteShareSessionCache=null;
        const before=reads,started=performance.now();await renderTrainerQuickLists();
        counts[count]={reads:reads-before,duration:performance.now()-started,cards:document.querySelectorAll('.favorite-card-shell').length};
      }
      return counts;
    });
    for(const count of [0,1,20,21,100]){expect(initial[count].reads).toBe(0);expect(initial[count].cards).toBe(count);}
    await captureP1(page,`favorites-100-desktop-idle-${browserName}`);
    await page.setViewportSize({width:390,height:844});
    await captureP1(page,`favorites-100-mobile-idle-${browserName}`);

    const localInteractions=await page.evaluate(async()=>{
      const fixture=window.__favoriteReadBoundary,before=fixture.metrics().reads;
      trainerOrganizerState.query='trainer 09';await renderTrainerQuickLists();
      trainerOrganizerState.query='';trainerOrganizerState.tagIds=['even'];await renderTrainerQuickLists();
      trainerOrganizerState.tagIds=[];await renderTrainerQuickLists();
      toggleFavoriteBrowse();favoriteBrowseInput('Pika');favoriteBrowseInput('Pikachu');
      queueTrainerSuggestions('Tra',true);await new Promise(resolve=>setTimeout(resolve,20));
      return{reads:fixture.metrics().reads-before,cards:document.querySelectorAll('.favorite-card-shell').length};
    });
    expect(localInteractions).toEqual({reads:0,cards:100});

    const browse=await page.evaluate(async()=>{
      const fixture=window.__favoriteReadBoundary;
      favoriteBrowseState.suggestions=[{name:'Pikachu',dn:'Pikachu',no:25}];favoriteBrowseState.focusIndex=0;
      const before=fixture.metrics().reads;selectFavoriteBrowsePokemon(0);
      while(favoriteBrowseState.busy)await new Promise(resolve=>setTimeout(resolve,5));
      const selectedReads=fixture.metrics().reads-before;
      const beforeRepeated=fixture.metrics().reads;await hydrateFavoriteBrowse();const repeatedReads=fixture.metrics().reads-beforeRepeated;
      const beforeRetry=fixture.metrics().reads;await hydrateFavoriteBrowse({retry:true});const retryReads=fixture.metrics().reads-beforeRetry;
      const beforeRefresh=fixture.metrics().reads;ensureFavoriteShareSessionCache().invalidate();await hydrateFavoriteBrowse({force:true});const refreshReads=fixture.metrics().reads-beforeRefresh;
      const beforeSecondRetry=fixture.metrics().reads;await hydrateFavoriteBrowse({retry:true});const secondRetryReads=fixture.metrics().reads-beforeSecondRetry;
      return{selectedReads,repeatedReads,retryReads,refreshReads,secondRetryReads,...fixture.metrics(),rows:document.querySelectorAll('.favorite-browse-row').length};
    });
    expect(browse.selectedReads).toBe(100);expect(browse.repeatedReads).toBe(0);expect(browse.retryReads).toBe(1);expect(browse.refreshReads).toBe(100);expect(browse.secondRetryReads).toBe(0);expect(browse.maxActive).toBeLessThanOrEqual(4);expect(browse.rows).toBeGreaterThan(0);

    const mutations=await page.evaluate(async()=>{
      const fixture=window.__favoriteReadBoundary;
      fixture.state.favorites=fixture.allFavorites.slice(0,2);favoriteShareSessionCache.syncFavorites(fixture.state.favorites);
      const beforeActiveAdd=fixture.metrics().reads;await toggleTrainerFavorite('Trainer Added Active');const activeAdd=fixture.metrics().reads-beforeActiveAdd;
      favoriteBrowseState.selected=null;
      const beforeInactiveAdd=fixture.metrics().reads;await toggleTrainerFavorite('Trainer Added Inactive');const inactiveAdd=fixture.metrics().reads-beforeInactiveAdd;
      window.confirm=()=>true;
      const beforeRemove=fixture.metrics().reads;removeTrainerFavorite('Trainer Added Active');const remove=fixture.metrics().reads-beforeRemove;
      let profileReads=0;
      loadPublicShareData=async username=>{profileReads++;fixture.profileReads.push(username);allData.users[username]={username};return{ok:true};};
      ensureShareViewSubscriptions=()=>{};rememberTrainerOpened=()=>{};enterShareView=()=>{};
      const beforeOpen=fixture.metrics().reads;openTrainerByName('Trainer 000');while(!profileReads)await new Promise(resolve=>setTimeout(resolve,0));
      return{activeAdd,inactiveAdd,remove,profileReads,browseReadsOnOpen:fixture.metrics().reads-beforeOpen,opened:fixture.profileReads};
    });
    expect(mutations).toEqual({activeAdd:1,inactiveAdd:0,remove:0,profileReads:1,browseReadsOnOpen:0,opened:['Trainer 000']});
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
    await expect(page.locator('#add-adv-toggle')).toHaveText(/Flags & details/);
    await expect(page.locator('#export-menu-btn')).toHaveText(/List tools/);
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
    await page.locator('#add-adv-toggle').click();
    for(const id of ['add-pmon-lucky','add-pmon-shiny','add-pmon-xxl','add-pmon-xxs','add-pmon-notes'])await expect(page.locator(`#${id}`)).toBeVisible();
    const scopes=await page.evaluate(()=>{
      const add=document.querySelector('.add-form'),toolbar=document.querySelector('.mylist-list-toolbar');
      const details=document.getElementById('add-adv-toggle').getBoundingClientRect();
      const tools=document.getElementById('export-menu-btn').getBoundingClientRect();
      const reorder=document.getElementById('mylist-reorder-toggle').getBoundingClientRect();
      return{
        addContainsTools:add.contains(document.getElementById('export-menu-btn')),
        toolbarContainsTools:toolbar.contains(document.getElementById('export-menu-btn')),
        sameListActionGroup:document.getElementById('export-menu-btn').closest('.mylist-list-actions')?.contains(document.getElementById('mylist-reorder-toggle'))===true,
        detailsOverlapsTools:!(details.right<=tools.left||tools.right<=details.left||details.bottom<=tools.top||tools.bottom<=details.top),
        reorderToolsGap:Math.max(0,tools.left-reorder.right)
      };
    });
    const{reorderToolsGap,...scopeFlags}=scopes;
    expect(scopeFlags).toEqual({addContainsTools:false,toolbarContainsTools:true,sameListActionGroup:true,detailsOverlapsTools:false});
    expect(reorderToolsGap).toBeGreaterThanOrEqual(8);
    await page.locator('#export-menu-btn').click();
    await expect(page.locator('#export-menu')).toBeVisible();
    await expect(page.locator('#export-menu [role^="menuitem"]').first()).toBeFocused();
    await expect(page.locator('#export-menu [role^="menuitem"]')).toHaveCount(9);
    await expect(page.locator('#export-menu [role^="menuitem"]').last()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#export-menu')).toBeHidden();
    await expect(page.locator('#export-menu-btn')).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({width:1024,height:800});
    const desktopScopes=await page.evaluate(()=>{
      const add=document.querySelector('.add-form').getBoundingClientRect();
      const actions=document.querySelector('.mylist-list-actions').getBoundingClientRect();
      const toolbar=document.querySelector('.mylist-list-toolbar').getBoundingClientRect();
      return{
        listToolsOutsideAdd:!document.querySelector('.add-form').contains(document.getElementById('export-menu-btn')),
        actionsInsideToolbar:actions.left>=toolbar.left&&actions.right<=toolbar.right,
        scopesSeparated:add.bottom<=actions.top,
        noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth
      };
    });
    expect(desktopScopes).toEqual({listToolsOutsideAdd:true,actionsInsideToolbar:true,scopesSeparated:true,noOverflow:true});
  });

  test('Add Pokemon flags and details preserve hierarchy, touch targets, and behavior',async({page})=>{
    for(const [width,height] of [[1440,900],[390,844]]){
      await page.setViewportSize({width,height});
      await page.goto(`./?add-flags-layout=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'AddLayoutTester',uid:'uid-add-layout-tester'});
      await page.evaluate(width=>{
        const local=normalizeData({users:{AddLayoutTester:{}},wishlist:{AddLayoutTester:{}},dynamax:{},gmax:{},costumes:{}});
        saveLocal(local);allData=normalizeData(local);buildAcItems();renderMyList();
        document.documentElement.dataset.theme=width===390?'light':'dark';
        if(width===390){
          document.querySelector('label:has(#add-pmon-lucky) span').textContent='Glücks-Pokémon';
          document.querySelector('label:has(#add-pmon-shiny) span').textContent='Schillernd';
        }
        window.__addFlagRenderCount=0;
        const originalRenderAddTray=renderAddTray;
        renderAddTray=function(...args){window.__addFlagRenderCount++;return originalRenderAddTray(...args);};
        window.__addListWriteCount=0;
        window.__addCapturedWrite=null;
        writeList=function(type,username,list){
          window.__addListWriteCount++;
          window.__addCapturedWrite={type,username,list:structuredClone(list)};
          allData[type][username]=structuredClone(list);
          renderMyList();
          return true;
        };
      },width);

      await page.locator('#ac-input').fill('Pikachu');
      const pikachu=page.locator('#ac-dropdown .ac-item').filter({has:page.locator('.ac-item-name').filter({hasText:/^Pikachu$/})}).first();
      await expect(pikachu).toBeVisible();
      await pikachu.dispatchEvent('mousedown');
      await expect(page.locator('#add-pmon-sel')).toHaveValue('Pikachu');
      await page.locator('.add-pri-btn[data-pri="M"]').click();
      await page.locator('#add-adv-toggle').click();

      const geometry=await page.evaluate(()=>{
        const rect=selector=>{
          const r=document.querySelector(selector).getBoundingClientRect();
          return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
        };
        const flagLabels=[...document.querySelectorAll('.add-flag-grid .lucky-add')];
        const targets=flagLabels.map(label=>{
          const r=label.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return label.contains(hit);
        });
        const controls=[...document.querySelector('.add-form').querySelectorAll('input:not([type="hidden"]),button')].filter(node=>!node.disabled);
        const indexOf=selector=>controls.indexOf(document.querySelector(selector));
        return{
          search:rect('#ac-input'),priority:rect('.add-pri-group'),add:rect('.add-actions .bsave'),toggle:rect('#add-adv-toggle'),
          advanced:rect('#add-advanced'),notes:rect('#add-pmon-notes'),
          labelRects:flagLabels.map(label=>{const r=label.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}),
          targets,
          focusOrder:{search:indexOf('#ac-input'),priority:indexOf('.add-pri-btn[data-pri="H"]'),add:indexOf('.add-actions .bsave'),toggle:indexOf('#add-adv-toggle'),lucky:indexOf('#add-pmon-lucky'),notes:indexOf('#add-pmon-notes')},
          toolsOutsideForm:!document.querySelector('.add-form').contains(document.getElementById('export-menu-btn')),
          noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth
        };
      });
      expect(geometry.targets.every(Boolean)).toBe(true);
      expect(geometry.labelRects.every(box=>box.width>=48&&box.height>=48)).toBe(true);
      expect(geometry.noOverflow).toBe(true);
      expect(geometry.toolsOutsideForm).toBe(true);
      expect(geometry.focusOrder.search).toBeLessThan(geometry.focusOrder.priority);
      expect(geometry.focusOrder.priority).toBeLessThan(geometry.focusOrder.add);
      expect(geometry.focusOrder.add).toBeLessThan(geometry.focusOrder.toggle);
      expect(geometry.focusOrder.toggle).toBeLessThan(geometry.focusOrder.lucky);
      expect(geometry.focusOrder.lucky).toBeLessThan(geometry.focusOrder.notes);

      if(width>600){
        for(const control of [geometry.priority,geometry.add,geometry.toggle])expect(Math.abs(control.y-geometry.search.y)).toBeLessThanOrEqual(2);
        for(const box of geometry.labelRects)expect(Math.abs(box.y-geometry.notes.y)).toBeLessThanOrEqual(2);
      }else{
        expect(Math.abs(geometry.search.y-geometry.add.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.priority.y-geometry.toggle.y)).toBeLessThanOrEqual(2);
        expect(new Set(geometry.labelRects.map(box=>Math.round(box.x))).size).toBe(2);
        expect(new Set(geometry.labelRects.map(box=>Math.round(box.y))).size).toBe(2);
        expect(Math.abs(geometry.notes.x-geometry.advanced.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.notes.width-geometry.advanced.width)).toBeLessThanOrEqual(1);
      }

      for(const id of ['add-pmon-lucky','add-pmon-shiny','add-pmon-xxs','add-pmon-xxl']){
        const before=await page.evaluate(()=>window.__addFlagRenderCount);
        await page.locator(`label:has(#${id})`).click();
        expect(await page.evaluate(()=>window.__addFlagRenderCount)).toBe(before+1);
      }
      await expect(page.locator('#add-pmon-xxl')).toBeChecked();
      await expect(page.locator('#add-pmon-xxs')).not.toBeChecked();

      const notes=page.locator('#add-pmon-notes');
      const beforeNotes=await page.evaluate(()=>window.__addFlagRenderCount);
      await notes.fill('female shadow');
      expect(await page.evaluate(()=>window.__addFlagRenderCount)).toBe(beforeNotes+1);
      const lucky=page.locator('#add-pmon-lucky');
      await lucky.focus();
      const beforeKeyboard=await page.evaluate(()=>window.__addFlagRenderCount);
      await page.keyboard.press('Space');
      expect(await page.evaluate(()=>window.__addFlagRenderCount)).toBe(beforeKeyboard+1);
      await page.keyboard.press('Space');
      expect(await page.evaluate(()=>window.__addFlagRenderCount)).toBe(beforeKeyboard+2);
      await expect(lucky).toBeChecked();
      const focusStyle=await lucky.locator('..').evaluate(label=>getComputedStyle(label).boxShadow);
      expect(focusStyle).not.toBe('none');

      await page.locator('#add-adv-toggle').click();
      await expect(page.locator('#add-advanced')).not.toHaveClass(/open/);
      await page.locator('#add-adv-toggle').click();
      await expect(page.locator('#add-pmon-lucky')).toBeChecked();
      await expect(page.locator('#add-pmon-shiny')).toBeChecked();
      await expect(page.locator('#add-pmon-xxl')).toBeChecked();
      await expect(notes).toHaveValue('female shadow');

      await page.locator('.add-actions .bsave').click();
      expect(await page.evaluate(()=>window.__addListWriteCount)).toBe(1);
      const saved=await page.evaluate(()=>{
        const captured=window.__addCapturedWrite;
        const parsed=parsePri(allData.wishlist.AddLayoutTester.Pikachu);
        return{type:captured.type,username:captured.username,p:parsed.p,mod:parsed.mod,lucky:parsed.lucky,shiny:parsed.shiny,xxl:parsed.xxl,xxs:parsed.xxs};
      });
      expect(saved).toEqual({type:'wishlist',username:'AddLayoutTester',p:'M',mod:'F',lucky:true,shiny:true,xxl:true,xxs:false});
      await expect(page.locator('#ac-input')).toHaveValue('');
      await expect(page.locator('#add-pmon-sel')).toHaveValue('');
      await expect(page.locator('.myrow-name',{hasText:'Pikachu'})).toBeVisible();
    }
  });

  test('My List dense rows preserve states without hover or tap tooltips',async({page})=>{
    const mobile=test.info().project.name==='mobile';
    await page.setViewportSize({width:mobile?390:1440,height:900});
    await page.goto(`./?my-list-dense-rows=${mobile?'mobile':'desktop'}-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'DenseRowTester',uid:'uid-dense-row-tester'});
    await page.evaluate(()=>{
      allData=normalizeData({
        users:{DenseRowTester:{}},
        wishlist:{DenseRowTester:{
          Mew:'H',
          'P-Tauros (Combat)':'H',
          'Darmanitan (Galarian Standard Mode)':'H(winter ceremonial variant)',
          Pikachu:'H[lucky]',
          Eevee:'H[shiny][xxl][xxs](female shadow)',
          Squirtle:'H[lucky][shiny][xxl][xxs]',
          'Oricorio (Sensu)':'H'
        }},
        dynamax:{},gmax:{},costumes:{}
      });
      writeList=async(type,username,list)=>{allData[type][username]={...list};renderMyList();return true;};
      renderMyList();
    });

    const rows=page.locator('.myrow');
    await expect(rows).toHaveCount(7);
    const tauros=rows.filter({has:page.locator('.myrow-name', {hasText:'P-Tauros (Combat)'})});
    await expect(tauros).toHaveCount(1);
    await expect(tauros.locator('.myrow-name')).not.toHaveAttribute('title');
    await expect(tauros).not.toHaveAttribute('title');
    await tauros.scrollIntoViewIfNeeded();
    if(mobile)await tauros.locator('.myrow-name').tap();
    else await tauros.locator('.myrow-name').hover();
    const interaction=await tauros.evaluate(row=>({
      before:getComputedStyle(row,'::before').content,
      after:getComputedStyle(row,'::after').content,
      editorOpen:row.querySelector('.myrow-editor')?.open===true,
      swiping:row.classList.contains('swiping'),
      transform:getComputedStyle(row).transform
    }));
    expect(['none','""']).toContain(interaction.before);
    expect(['none','""']).toContain(interaction.after);
    expect(`${interaction.before}${interaction.after}`).not.toContain('P-Tauros');
    expect({editorOpen:interaction.editorOpen,swiping:interaction.swiping,transform:interaction.transform}).toEqual({editorOpen:false,swiping:false,transform:'none'});
    if(mobile){
      const verticalGesture=await tauros.evaluate(row=>{
        const name=row.querySelector('.myrow-name');
        swipeStart({target:name,touches:[{clientX:120,clientY:200}]});
        swipeMove({touches:[{clientX:122,clientY:246}],preventDefault(){throw new Error('vertical scroll was prevented');}});
        swipeEnd({});
        return{
          editorOpen:row.querySelector('.myrow-editor')?.open===true,
          swiping:row.classList.contains('swiping'),
          transform:getComputedStyle(row).transform,
          swipeStateCleared:_swipeState===null
        };
      });
      expect(verticalGesture).toEqual({editorOpen:false,swiping:false,transform:'none',swipeStateCleared:true});
    }

    const layout=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('.myrow')];
      const find=name=>all.find(row=>row.dataset.name===name);
      const boxes=all.map(row=>row.getBoundingClientRect());
      const squirtle=find('Squirtle'),eevee=find('Eevee'),mew=find('Mew'),long=find('Darmanitan (Galarian Standard Mode)');
      const edit=squirtle.querySelector('.myrow-edit').getBoundingClientRect();
      const sprite=squirtle.querySelector('.myrow-sprite-wrap').getBoundingClientRect();
      const traits=[...squirtle.querySelectorAll('.myrow-trait')];
      return{
        rowHeights:boxes.map(box=>box.height),
        rowXs:boxes.map(box=>box.x),
        sprite:{width:sprite.width,height:sprite.height},
        edit:{width:edit.width,height:edit.height,left:edit.left},
        traitCount:traits.length,
        traitRight:Math.max(...traits.map(trait=>trait.getBoundingClientRect().right)),
        emptyTraitCount:mew.querySelectorAll('.myrow-active-traits').length,
        eeveeDetail:eevee.querySelector('.myrow-trait.detail')?.textContent||'',
        eeveeDetailVisible:getComputedStyle(eevee.querySelector('.myrow-trait.detail')).display!=='none',
        eeveeCopyContainsTraits:eevee.querySelector('.myrow-copy>.myrow-active-traits')!==null,
        eeveeTraitTop:eevee.querySelector('.myrow-active-traits').getBoundingClientRect().top,
        eeveeNameBottom:eevee.querySelector('.myrow-name').getBoundingClientRect().bottom,
        priorityCenter:(squirtle.querySelector('.myrow-priority-chip')?.getBoundingClientRect().top||0)+(squirtle.querySelector('.myrow-priority-chip')?.getBoundingClientRect().height||0)/2,
        rowCenter:squirtle.getBoundingClientRect().top+squirtle.getBoundingClientRect().height/2,
        longNameContained:long.querySelector('.myrow-name').getBoundingClientRect().right<=long.querySelector('.myrow-copy').getBoundingClientRect().right+1,
        priorityQuickVisible:getComputedStyle(squirtle.querySelector('.myrow-priority-quick')).display!=='none',
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        openEditors:document.querySelectorAll('.myrow-editor[open]').length,
        luckyMarker:getComputedStyle(squirtle.querySelector('.myrow-trait.lucky'),'::before').content,
        shinyMarker:getComputedStyle(squirtle.querySelector('.myrow-trait.shiny'),'::before').content
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.openEditors).toBe(0);
    expect(layout.emptyTraitCount).toBe(0);
    expect(layout.traitCount).toBe(4);
    expect(layout.eeveeDetail).toBe('F');
    expect(layout.eeveeDetailVisible).toBe(true);
    expect(layout.eeveeCopyContainsTraits).toBe(true);
    expect(layout.eeveeTraitTop).toBeGreaterThanOrEqual(layout.eeveeNameBottom-1);
    if(mobile){
      expect(Math.max(...layout.rowHeights)).toBeLessThanOrEqual(56);
      expect(Math.min(...layout.rowHeights)).toBeGreaterThanOrEqual(54);
      expect(layout.sprite).toEqual({width:32,height:32});
      expect(layout.edit.width).toBeGreaterThanOrEqual(48);
      expect(layout.edit.height).toBeGreaterThanOrEqual(48);
      expect(layout.traitRight).toBeLessThanOrEqual(layout.edit.left);
      expect(layout.longNameContained).toBe(true);
      expect(layout.priorityQuickVisible).toBe(false);
      expect(layout.luckyMarker).toBe('"⚡"');
      expect(layout.shinyMarker).toBe('"✨"');
      expect(new Set(layout.rowXs).size).toBe(1);
    }else{
      expect(Math.min(...layout.rowHeights)).toBeGreaterThanOrEqual(58);
      expect(new Set(layout.rowXs).size).toBeGreaterThan(1);
      expect(layout.priorityQuickVisible).toBe(true);
      expect(Math.abs(layout.priorityCenter-layout.rowCenter)).toBeLessThanOrEqual(1);
    }
    await capturePass3(page,`product-ui-mylist-rows-${mobile?'mobile':'desktop'}`);

    const longRow=rows.filter({has:page.locator('.myrow-name',{hasText:'Darmanitan (Galarian Standard Mode)'})});
    await expect(longRow.locator('.myrow-trait.detail')).not.toHaveAttribute('title');
    await expect(longRow.locator('.myrow-edit')).toHaveAttribute('aria-label',/Darmanitan \(Galarian Standard Mode\)/);
    await longRow.locator('.myrow-edit').click();
    await expect(longRow.locator('.myrow-editor-title')).toHaveText('Darmanitan (Galarian Standard Mode)');
    await expect(longRow.locator('.myrow-editor-fields .ni')).toHaveValue('winter ceremonial variant');
    await longRow.locator('.myrow-editor-fields .ni').fill('winter ceremonial variant updated');
    await expect(longRow.locator('.myrow-editor-fields .ni')).toHaveValue('winter ceremonial variant updated');
    await page.keyboard.press('Escape');
    await expect(longRow.locator('.myrow-editor-popover')).toBeHidden();
    await page.locator('#mylist-filter').fill('P-Tauros');
    await expect(page.locator('.myrow')).toHaveCount(1);
    await expect(page.locator('.myrow-name')).toHaveText('P-Tauros (Combat)');
    await page.locator('#mylist-filter').fill('');
    await expect(page.locator('.myrow')).toHaveCount(7);
    expect(await page.evaluate(()=>document.querySelectorAll('.myrow.swiping,.myrow-editor[open]').length)).toBe(0);
  });

  test('My List priority groups preserve accessible collapse state across mobile rerenders',async({page})=>{
    const viewports=[[1440,900],[430,932],[390,844],[375,812],[320,568]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?my-list-priority-collapse=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'CollapseTester',uid:'uid-collapse-tester'});
      await page.evaluate(()=>{
        myListCollapsedPrioritySections.clear();
        allData=normalizeData({users:{CollapseTester:{}},wishlist:{CollapseTester:{Mew:'H',Eevee:'M',Squirtle:'L'}},dynamax:{CollapseTester:{Pikachu:'H'}},gmax:{},costumes:{}});
        writeList=(type,username,list)=>{
          const previous={...(allData[type]?.[username]||{})};
          expandMyListPrioritiesReceivingEntries(type,username,previous,list||{});
          allData[type][username]={...(list||{})};renderMyList();return true;
        };
        document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';setMyList('wishlist');
        const banner=document.getElementById('sync-banner');if(banner)banner.hidden=false;
      });

      for(const priority of ['H','M','L']){
        await expect(page.locator(`[data-priority-section="${priority}"] .mylist-priority-toggle`)).toHaveAttribute('aria-expanded','true');
        await expect(page.locator(`#mylist-priority-body-${priority}`)).toBeVisible();
      }
      const highToggle=page.locator('[data-priority-section="H"] .mylist-priority-toggle');
      await highToggle.focus();await page.keyboard.press('Space');
      await expect(highToggle).toHaveAttribute('aria-expanded','false');
      await expect(page.locator('#mylist-priority-body-H')).toBeHidden();
      await expect(page.locator('#mylist-priority-body-M')).toBeVisible();

      await page.evaluate(()=>renderMyList());
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');
      await page.locator('#mylist-filter').fill('Mew');
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');
      await page.locator('#mylist-filter').fill('');
      await page.evaluate(()=>setNotes('Mew','mobile trade note'));
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');

      const mediumToggle=page.locator('[data-priority-section="M"] .mylist-priority-toggle');
      await mediumToggle.click();await expect(mediumToggle).toHaveAttribute('aria-expanded','false');
      await page.evaluate(()=>{
        const list={...allData.wishlist.CollapseTester,Pikachu:'M'};
        writeList('wishlist','CollapseTester',list);
      });
      await expect(page.locator('[data-priority-section="M"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','true');
      await expect(page.locator('[data-priority-section="M"] .myrow[data-name="Pikachu"]')).toBeVisible();
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');

      await page.evaluate(()=>setMyList('dynamax'));
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','true');
      await page.evaluate(()=>setMyList('wishlist'));
      await expect(page.locator('[data-priority-section="H"] .mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');

      const geometry=await page.evaluate(()=>{
        const banner=document.getElementById('sync-banner'),button=banner?.querySelector('.sync-banner-btn'),dismiss=banner?.querySelector('.sync-banner-dismiss');
        const box=node=>{const r=node?.getBoundingClientRect();return r?{left:r.left,right:r.right,width:r.width,height:r.height}:null;};
        return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,banner:box(banner),action:box(button),dismiss:box(dismiss),display:banner?getComputedStyle(banner).display:''};
      });
      expect(geometry.overflow).toBe(false);
      if(width<=600){
        expect(geometry.display).toBe('grid');
        expect(geometry.action.height).toBeGreaterThanOrEqual(44);
        expect(geometry.dismiss.height).toBeGreaterThanOrEqual(48);
        expect(geometry.action.width).toBeLessThan(geometry.banner.width-40);
      }
      for(const tab of await page.locator('.tabs .tab:visible').all()){
        const box=await tab.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(48);
      }
      await capturePass3(page,`mobile-polish-mylist-${width}x${height}`);
    }
  });

  test('Special Trade Board keeps complete controls touch-safe on compact screens',async({page})=>{
    for(const [width,height] of [[1440,900],[430,932],[390,844],[375,812],[320,568]]){
      await page.setViewportSize({width,height});
      await page.goto(`./?special-board-mobile=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'BoardTester',uid:'uid-board-tester'});
      await page.evaluate(()=>{
        allData.users.BoardTester={specialTradeBoard:{
          lf:[{name:'Darmanitan (Galarian Standard Mode)',dn:'Darmanitan (Galarian Standard Mode)',no:555,shiny:true,mirror:true,note:'long-distance trade'}],
          ft:[{name:'Pikachu',dn:'Pikachu',no:25,shiny:true,mirror:false,note:'costume details',qty:12}]
        }};
        openSpecialTradeBoard();
      });
      const modal=page.locator('#special-board-modal .special-board-modal');await expect(modal).toBeVisible();
      await expect(page.locator('#special-lf-list .sb-row')).toHaveCount(1);await expect(page.locator('#special-ft-list .sb-row')).toHaveCount(1);
      const geometry=await page.evaluate(()=>{
        const modal=document.querySelector('#special-board-modal .special-board-modal'),r=modal.getBoundingClientRect();
        const targets=[...modal.querySelectorAll('.special-board-add-row button,.sb-row button,.special-board-modal .mact button')].filter(node=>getComputedStyle(node).display!=='none').map(node=>{const box=node.getBoundingClientRect();return{width:box.width,height:box.height};});
        const notes=[...modal.querySelectorAll('.sb-row-note')].map(node=>node.getBoundingClientRect().height);
        return{modal:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},targets,notes,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.modal.left).toBeGreaterThanOrEqual(0);expect(geometry.modal.right).toBeLessThanOrEqual(width+1);
      expect(geometry.modal.top).toBeGreaterThanOrEqual(0);expect(geometry.modal.bottom).toBeLessThanOrEqual(height+1);
      expect(geometry.targets.every(target=>target.height>=44&&target.width>=44)).toBe(true);
      expect(geometry.notes.every(value=>value>=44)).toBe(true);
      await capturePass3(page,`mobile-polish-special-board-${width}x${height}`);
      await page.locator('#special-lf-ac').focus();await expect(page.locator('#special-lf-ac')).toBeFocused();
      await page.keyboard.press('Escape');await expect(page.locator('#special-board-modal')).not.toHaveClass(/open/);
    }
  });

  test('My List Variant details uses the canonical dark input treatment',async({page})=>{
    for(const [width,height] of [[1440,900],[390,844]]){
      await page.setViewportSize({width,height});
      await page.goto(`./?variant-details-style=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'VariantStyleTester',uid:'uid-variant-style-tester'});
      await page.locator('#add-adv-toggle').click();

      const details=page.locator('#add-pmon-notes'),reference=page.locator('#ac-input');
      await expect(details).toBeVisible();
      await expect(details).toHaveClass(/field-control/);
      const styles=await page.evaluate(()=>{
        const read=element=>{
          const style=getComputedStyle(element),placeholder=getComputedStyle(element,'::placeholder');
          return{
            background:style.backgroundColor,color:style.color,caret:style.caretColor,
            borderColor:style.borderColor,borderStyle:style.borderStyle,borderWidth:style.borderWidth,
            borderRadius:style.borderRadius,minHeight:style.minHeight,placeholder:placeholder.color
          };
        };
        return{details:read(document.getElementById('add-pmon-notes')),reference:read(document.getElementById('ac-input'))};
      });
      expect(styles.details).toEqual(styles.reference);

      await details.fill('winter costume');
      await expect(details).toHaveValue('winter costume');
      await details.focus();
      await page.waitForTimeout(180);
      const detailsFocus=await details.evaluate(element=>({borderColor:getComputedStyle(element).borderColor,boxShadow:getComputedStyle(element).boxShadow}));
      await reference.focus();
      await page.waitForTimeout(180);
      const referenceFocus=await reference.evaluate(element=>({borderColor:getComputedStyle(element).borderColor,boxShadow:getComputedStyle(element).boxShadow}));
      expect(detailsFocus).toEqual(referenceFocus);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
  });

  test('My List groups unprioritized collection goals into exact Dex sections',async({page})=>{
    for(const [width,height] of [[1440,900],[390,844]]){
      await page.setViewportSize({width,height});
      await page.goto(`./?my-list-dex-sections=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForStableLocalOrganizerStartup(page);
      await isolateAuthenticatedMyListFixture(page,{username:'DexSectionTester',uid:'uid-dex-section-tester'});
      const fixture=await page.evaluate(()=>{
        const entries=DB.wishlist.filter(entry=>entry.no).slice(0,7);
        const [priority,lucky,shiny,xxl,xxs,multi,other]=entries;
        allData=normalizeData({users:{DexSectionTester:{}},wishlist:{DexSectionTester:{}},dynamax:{},gmax:{},costumes:{}});
        Object.assign(allData.wishlist.DexSectionTester,{
          [priority.name]:priValue('H','',true),
          [lucky.name]:priValue('','',true),
          [shiny.name]:priValue('','',false,false,false,true),
          [xxl.name]:priValue('','',false,true),
          [xxs.name]:priValue('','',false,false,true),
          [multi.name]:priValue('','',true,true,false,true),
          [other.name]:priValue('','legacy note')
        });
        writeList=async(type,username,list)=>{allData[type][username]={...list};renderMyList();};
        document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';setMyList('wishlist');
        return Object.fromEntries(Object.entries({priority,lucky,shiny,xxl,xxs,multi,other}).map(([key,entry])=>[key,{name:entry.name,no:entry.no}]));
      });

      if(width===1440){
        await expect(page.locator('#mylist-guidance-title')).toHaveText('Build your trade list');
        await expect(page.locator('.journey-guidance')).toContainText('Add Pokémon, set priorities, and share your list when you’re ready. Favorites and private tags stay on this device.');
      }
      for(const [key,label] of Object.entries({LUCKY:'Lucky Dex',SHINY:'Shiny Dex',XXL:'XXL Dex',XXS:'XXS Dex',OTHER:'Other Pokémon'})){
        const section=page.locator(`[data-dex-section="${key}"]`);
        await expect(section).toBeVisible();await expect(section.locator('.mylist-priority-heading')).toContainText(label);
      }
      for(const [key,name] of [['LUCKY',fixture.lucky.name],['SHINY',fixture.shiny.name],['XXL',fixture.xxl.name],['XXS',fixture.xxs.name],['OTHER',fixture.other.name]]){
        await expect(page.locator(`[data-dex-section="${key}"] .myrow[data-name="${name}"]`)).toHaveCount(1);
      }
      for(const key of ['LUCKY','SHINY','XXL'])await expect(page.locator(`[data-dex-section="${key}"] .myrow[data-name="${fixture.multi.name}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-priority-section="H"] .myrow[data-name="${fixture.priority.name}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-dex-section] .myrow[data-name="${fixture.priority.name}"]`)).toHaveCount(0);
      expect(await page.evaluate(()=>Object.keys(allData.wishlist.DexSectionTester).length)).toBe(7);

      const expectedLabels={LUCKY:'Lucky Dex Search String',SHINY:'Shiny Dex Search String',XXL:'XXL Dex Search String',XXS:'XXS Dex Search String'};
      for(const [key,label] of Object.entries(expectedLabels)){
        const footer=page.locator(`[data-dex-search="${key}"]`),raw=footer.locator('.mylist-search-raw'),copy=footer.locator('.cpbtn');
        await expect(footer.locator('.mylist-search-option-label')).toHaveText(label);
        await expect(raw).toBeHidden();
        expect(await copy.getAttribute('data-copy')).toBe(await raw.textContent());
      }
      const dexMembership=await page.evaluate(()=>Object.fromEntries(['LUCKY','SHINY','XXL','XXS'].map(key=>[key,stringParts(buildStrings('wishlist','DexSectionTester')[key]).map(Number)])));
      expect(dexMembership).toEqual({
        LUCKY:[fixture.lucky.no,fixture.multi.no].sort((a,b)=>a-b),
        SHINY:[fixture.shiny.no,fixture.multi.no].sort((a,b)=>a-b),
        XXL:[fixture.xxl.no,fixture.multi.no].sort((a,b)=>a-b),
        XXS:[fixture.xxs.no]
      });
      for(const members of Object.values(dexMembership))expect(members).not.toContain(fixture.priority.no);
      for(const [priority,label] of Object.entries({H:'High Priority Search String'}))await expect(page.locator(`[data-priority-search="${priority}"] .mylist-search-option-label`)).toHaveText(label);
      await expect(page.locator('.my-string-heading')).toBeHidden();

      const multiRow=page.locator(`[data-dex-section="LUCKY"] .myrow[data-name="${fixture.multi.name}"]`);
      await multiRow.locator('.myrow-edit').click();
      const notes=multiRow.locator('.myrow-editor-popover .ni');await notes.fill('updated variant');await notes.blur();
      await expect(page.locator(`.myrow[data-name="${fixture.multi.name}"] .myrow-trait.detail`)).toHaveCount(3);
      for(const trait of await page.locator(`.myrow[data-name="${fixture.multi.name}"] .myrow-trait.detail`).all())await expect(trait).toHaveText('updated variant');
      expect(await page.evaluate(name=>({count:Object.keys(allData.wishlist.DexSectionTester).length,value:allData.wishlist.DexSectionTester[name]}),fixture.multi.name)).toEqual({count:7,value:'[lucky][shiny][xxl](updated variant)'});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }
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

  for (const [width,height] of [[320,568],[375,812],[390,844],[430,932]]) {
    test(`find trainer suggestions stay visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`./?autocomplete-layout=${width}-${Date.now()}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof renderTrainerSuggestions === 'function' && window.__pogoStartup?.firebaseStartupSettledAt !== null);
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
      expect(box.y).toBeLessThan(height);
      expect(bodyWidth).toBeLessThanOrEqual(width);
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.trainer-suggestion.active')).toBeVisible();
      await capturePass3(page,`trainer-discovery-suggestions-${width}x${height}`);
    });
  }

  test('find trainer autocomplete suggests public directory names', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'find');
    await page.locator('#find-trainer-input').fill('Tes');
    await expect(page.locator('#find-trainer-suggestions.open')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.trainer-suggestion').first()).toContainText(/TestUser/i);
    await page.evaluate(()=>{
      allData.loginDirectory={AlphaTrainer:{ready:true},BetaTrainer:{ready:true}};
      const input=document.getElementById('find-trainer-input');
      input.value='Alpha';queueTrainerSuggestions('Alpha');
      input.value='Beta';queueTrainerSuggestions('Beta');
    });
    await expect(page.locator('.trainer-suggestion')).toHaveCount(1);
    await expect(page.locator('.trainer-suggestion').first()).toContainText('BetaTrainer');
    await expect(page.locator('.trainer-suggestion').first()).not.toContainText('AlphaTrainer');
  });

  test('trainer discovery keeps exact intent first and shows reciprocal hierarchy on mobile',async({page})=>{
    await page.setViewportSize({width:320,height:568});
    await page.goto(`./?trainer-ranking-ui=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'Viewer',uid:'uid-viewer'});
    await page.evaluate(()=>{
      allData=normalizeData({
        users:{Alpha:{},AlphaFriendWithAVeryLongHandle:{}},loginDirectory:{Alpha:{},AlphaFriendWithAVeryLongHandle:{}},
        have:{Viewer:{Pikachu:{qty:1},Eevee:{qty:1}},Alpha:{Mew:{qty:1}},AlphaFriendWithAVeryLongHandle:{Bulbasaur:{qty:1}}},
        wishlist:{Viewer:{Mew:'H'},Alpha:{Pikachu:'H'},AlphaFriendWithAVeryLongHandle:{Pikachu:'H',Eevee:'M'}},dynamax:{},gmax:{},costumes:{}
      });
      switchTab('find',{render:false});renderFindTrainer();
    });
    const input=page.locator('#find-trainer-input');await input.fill('Alpha');
    await expect(page.locator('.trainer-suggestion')).toHaveCount(2);
    await expect(page.locator('.trainer-suggestion').first().locator('.trainer-suggestion-name')).toHaveText('Alpha');
    await capturePass3(page,'trainer-discovery-ranking-320x568');
    await page.evaluate(()=>{selectedTrainerRuntime={username:'Alpha',publicData:normalizeData({users:{Alpha:{}},wishlist:{Alpha:{Pikachu:'H'}}})};document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');renderShareView('Alpha','wishlist');});
    await expect(page.locator('.share-match-overview')).toBeVisible();
    await expect(page.locator('.share-match-metric').nth(0)).toContainText('They Have My Wants');
    await expect(page.locator('.share-match-metric').nth(0)).toContainText('Not shared');
    await expect(page.locator('.share-match-metric').nth(1)).toContainText('I Have Their Wants');
    await expect(page.locator('.share-match-metric').nth(1).locator('strong')).toHaveText('1');
    const scenarios=await page.evaluate(()=>{
      const target='TrainerWithAnExceptionallyLongHandle123',inventory=names=>Object.fromEntries(names.map(name=>[name,{qty:1}])),wants=names=>Object.fromEntries(names.map(name=>[name,'H']));
      const render=(theirHave,theirWants,myHave,myWants)=>{
        allData=normalizeData({users:{Viewer:{},[target]:{}},have:{Viewer:inventory(myHave),[target]:inventory(theirHave)},wishlist:{Viewer:wants(myWants),[target]:wants(theirWants)},dynamax:{},gmax:{},costumes:{}});
        selectedTrainerRuntime={username:target,publicData:normalizeData({users:{[target]:{}},wishlist:{[target]:wants(theirWants)}})};
        renderShareView(target,'wishlist');return[...document.querySelectorAll('.share-match-metric')].map(node=>({value:node.querySelector('strong')?.textContent||'',label:node.querySelector('span')?.textContent||'',status:node.querySelector('small')?.textContent||''}));
      };
      const many=Array.from({length:14},(_,index)=>`Wanted${index}`),owned=Array.from({length:12},(_,index)=>`Owned${index}`);
      return{none:render([],[],[],[]),they:render(['Mew'],[],[],['Mew']),mine:render([],['Pikachu'],['Pikachu'],[]),bothLarge:render(many,owned,owned,many)};
    });
    expect(scenarios.none).toEqual([]);
    expect(scenarios.they).toEqual([]);
    expect(scenarios.mine).toEqual([{value:'—',label:'They Have My Wants',status:'Not shared'},{value:'1',label:'I Have Their Wants',status:''}]);
    expect(scenarios.bothLarge).toEqual([{value:'—',label:'They Have My Wants',status:'Not shared'},{value:'12',label:'I Have Their Wants',status:''}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await capturePass3(page,'trainer-discovery-profile-320x568');
  });

  test('reciprocal trade details preserve qualifiers, reject gender mismatch, and refresh after My List edits',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?trade-match-ux=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'Doomsday126',uid:'uid-owner'});
    await page.evaluate(()=>{
      const them='TrainerWithAnExceptionallyLongHandle123';
      allData=normalizeData({
        users:{Doomsday126:{authUid:'uid-owner',isOwner:true},[them]:{}},
        have:{Doomsday126:{'Pikachu::m':{qty:2},'Heracross::m':{qty:1}},[them]:{Mew:{qty:1},'Heracross::m':{qty:1}}},
        wishlist:{Doomsday126:{Mew:'H[lucky][shiny][xxl](winter costume)',Heracross:'M(F)'},[them]:{Pikachu:'L[xxs](male)'}},
        dynamax:{},gmax:{},costumes:{}
      });
      _pathLoadState={have:'loaded',wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
      selectedTrainerRuntime={username:them,publicData:normalizeData({users:{[them]:{}},wishlist:{[them]:{Pikachu:'L[xxs](male)'}}})};
      document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');renderShareView(them,'wishlist');
    });
    await page.getByRole('button',{name:/Compare with My List/i}).click();
    const modal=page.locator('#trade-match-modal');await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-labelledby','trade-match-title');
    await expect(modal.locator('.diff-match-box.want .diff-match-chip')).toHaveCount(1);
    await expect(modal.locator('.diff-match-box.want')).toContainText('Mew');
    await expect(modal.locator('.diff-match-box.want')).toContainText('My priority: High');
    await expect(modal.locator('.diff-match-box.want')).toContainText('Shiny');
    await expect(modal.locator('.diff-match-box.want')).toContainText('winter costume');
    await expect(modal.locator('.diff-match-box.want')).not.toContainText('Heracross');
    await expect(modal.locator('.diff-match-box.give')).toContainText('Pikachu');
    await expect(modal.locator('.diff-match-box.give')).toContainText('Their priority: Low');
    await expect(modal.locator('.diff-match-box.give')).toContainText('Extra Small');
    await expect(modal.locator('.diff-match-box.give')).toContainText('Male');
    await page.getByRole('button',{name:'Edit My List'}).click();
    await expect(page.locator('#trade-return-banner')).toBeVisible();
    await page.evaluate(()=>{allData.wishlist.Doomsday126.Heracross='M(M)';renderMyList();});
    await page.getByRole('button',{name:'Return to matches'}).click();
    await expect(page.locator('#trade-match-modal .diff-match-box.want')).toContainText('Heracross');
    await capturePass3(page,'trade-match-detail-390x844');
    await page.evaluate(()=>{
      const them='TrainerWithAnExceptionallyLongHandle123';
      const names=['Bulbasaur','Ivysaur','Venusaur','Charmander','Charmeleon','Charizard','Squirtle','Wartortle','Blastoise','Caterpie','Metapod','Butterfree','Weedle','Kakuna','Beedrill','Pidgey'];
      names.forEach((name,index)=>{allData.have[them][name]={qty:index%3+1};allData.wishlist.Doomsday126[name]=index%3===0?'H[shiny]':index%3===1?'M[xxl]':'L[xxs]';});
      renderTradeMatchModal();
    });
    await expect(page.locator('#trade-match-modal .diff-match-box.want .diff-match-more')).toBeVisible();
    for(const viewport of [{width:1440,height:900},{width:430,height:932},{width:375,height:812},{width:320,height:568}]){
      await page.setViewportSize(viewport);
      await expect(page.locator('#trade-match-modal')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      for(const button of await page.locator('#trade-match-modal button').all()){
        const box=await button.boundingBox();if(box)expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await capturePass3(page,`trade-match-${viewport.width}x${viewport.height}`);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#trade-match-modal')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });

  test('my list renders embedded search strings', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#my-strings-out')).toBeVisible();
    await expect(page.locator('#my-strings-out .str-level').first()).toBeVisible({ timeout: 20_000 });
  });

  test('public trainer search commands stay collapsed until explicitly requested',async({page})=>{
    await page.setViewportSize({width:390,height:844});
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
    for(const target of await page.locator('.share-back-link,.share-profile-actions button,.share-list-tabs .ltab,#share-list-out .cpbtn').all()){
      const box=await target.boundingBox();if(box)expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await capturePass3(page,'mobile-polish-public-trainer-390x844');
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

  test('EVENT-01 and ADMIN-01 states render from the corrected runtime contracts',async({page})=>{
    await page.goto(`./?event-admin-corrections=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'Doomsday126',uid:'uid-event-admin-fixture'});
    await page.evaluate(()=>{
      const now=Date.now();
      allData=normalizeData({
        users:{Doomsday126:{isOwner:true,isAdmin:true,authUid:'uid-event-admin-fixture',authEmail:'owner@example.invalid'}},
        loginDirectory:{Doomsday126:{authReady:true}},authIndex:{},wishlist:{},dynamax:{},gmax:{},costumes:{},requests:{},
        communities:{nyc:{name:'NYC',preparedAt:now,memberUsernames:{Doomsday126:true},members:{'uid-event-admin-fixture':true},admins:{'uid-event-admin-fixture':true}}},
        userCommunities:{'uid-event-admin-fixture':{nyc:{role:'owner',username:'Doomsday126'}}}
      });
      cur='Doomsday126';auth={currentUser:{uid:'uid-event-admin-fixture'}};
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-admin').classList.add('active');
      renderAdmin();setAdminSection('diagnostics');
    });
    const diagnostic=page.locator('[data-community-diagnostic-state]');
    await expect(diagnostic).toHaveAttribute('data-community-diagnostic-state','enabled-interim');
    await expect(diagnostic).toContainText('Community filtering is enabled');
    await diagnostic.scrollIntoViewIfNeeded();
    await captureP1(page,'45-admin-diagnostic');

    await page.evaluate(()=>{
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-schedule').classList.add('active');
      _eventData={events:[],raids:[],fetchedAt:0};_eventLoadState='error';renderEventsOnly();
    });
    await expect(page.locator('.ui-state-unavailable')).toBeVisible();
    await expect(page.locator('.events-state-action')).toBeVisible();
    await captureP1(page,'45-events-timeout-error');

    await page.evaluate(()=>{
      const now=Date.now(),hour=3600000;
      _eventData={events:[{eventID:'retry-success',name:'Recovered Event',eventType:'event',start:new Date(now-hour).toISOString(),end:new Date(now+hour).toISOString()}],raids:[],fetchedAt:now};
      _eventLoadState='ready';eventTypeFilter='all';renderEventsOnly();
    });
    await expect(page.locator('.event-card')).toHaveCount(1);
    await expect(page.locator('.event-card')).toContainText('Recovered Event');
    await captureP1(page,'45-events-retry-success');
  });

  test('SEC-01 hostile anonymous requests remain inert in the Admin DOM',async({page})=>{
    await page.goto(`./?security-request-render=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'SecurityAdmin',uid:'uid-security-admin'});
    const payloads=[
      '<img src=x onerror="window.__securityExecuted++">',
      '<svg onload="window.__securityExecuted++"></svg>',
      '</script><script>window.__securityExecuted++</script>',
      'O\'Brien',
      'D\'Angelo "quoted" back\\slash `template`',
      '&lt;img src=x onerror=alert(1)&gt;',
      'ユニコード訓練家é',
      `Long${'x'.repeat(4096)}`
    ];
    await page.evaluate(payloads=>{
      window.__securityExecuted=0;
      allData=normalizeData({
        users:{SecurityAdmin:{isAdmin:true,authUid:'uid-security-admin'}},
        requests:Object.fromEntries(payloads.map((value,index)=>[`req_${index}`,{username:value,note:value,requestedAt:Date.now(),status:'pending'}])),
        communities:{},memberships:{},wishlist:{},dynamax:{},gmax:{},costumes:{}
      });
      cur='SecurityAdmin';auth={currentUser:{uid:'uid-security-admin'}};
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-admin').classList.add('active');
      renderPendingRequests();
    },payloads);
    await expect(page.locator('#pending-requests-list .req-card')).toHaveCount(payloads.length);
    expect(await page.locator('#pending-requests-list .req-card-name').allTextContents()).toEqual(payloads.map(value=>`🎮 ${value}`));
    expect(await page.locator('#pending-requests-list img, #pending-requests-list svg, #pending-requests-list script').count()).toBe(0);
    expect(await page.evaluate(()=>window.__securityExecuted)).toBe(0);
  });

  test('SEC-03 hostile trainer names survive rendered Favorite and Recent actions',async({page})=>{
    await page.goto(`./?security-trainer-actions=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'SecurityViewer',uid:'uid-security-viewer'});
    const names=["O'Brien",'D\'Angelo','"quoted"','back\\slash','`template`','<script>window.__securityExecuted++</script>','ユニコード訓練家'];
    await page.evaluate(async names=>{
      window.__securityExecuted=0;window.__openedTrainer='';
      const entries=names.map((displayName,index)=>({key:`trainer-${index}`,displayName,tagIds:[],createdAt:index+1,updatedAt:index+1}));
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-security-viewer',username:'SecurityViewer'},favorites:entries,recent:entries.map((item,index)=>({key:item.key,displayName:item.displayName,openedAt:Date.now()-index*1000})),snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
      const store={read:()=>state,filterFavorites:()=>state.favorites,favoriteFor:value=>state.favorites.find(item=>item.displayName===value)||null,updateCanonicalName:()=>false,snapshotFor:()=>null};
      ensureTrainerHistoryStore=()=>store;
      ensureFavoriteShareSessionCache=()=>({syncFavorites(){},readFavorite:async()=>({status:'missing'})});
      openTrainerByName=username=>{window.__openedTrainer=username;};
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-find').classList.add('active');
      await renderTrainerQuickLists();
    },names);
    await expect(page.locator('.favorite-card-shell')).toHaveCount(names.length);
    await expect(page.locator('.recent-trainer-row')).toHaveCount(names.length);
    expect(await page.locator('.favorite-card-shell .trainer-quick-name').allTextContents()).toEqual(names);
    expect(await page.locator('.favorite-card-shell script, .recent-trainer-row script').count()).toBe(0);
    for(let index=0;index<names.length;index++){
      await page.locator('.favorite-card-open').nth(index).click();
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe(names[index]);
      await page.locator('.recent-trainer-row').nth(index).click();
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe(names[index]);
    }
    expect(await page.evaluate(()=>window.__securityExecuted)).toBe(0);
  });

  test('SEC-04 unsafe Event destinations render as non-clickable rows',async({page})=>{
    await page.goto(`./?security-event-links=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'SecurityEvents',uid:'uid-security-events'});
    await page.evaluate(()=>{
      const now=Date.now(),hour=3600000;
      _eventData={fetchedAt:now,events:[
        {eventID:'safe',name:'Safe',eventType:'event',start:new Date(now-hour).toISOString(),end:new Date(now+hour).toISOString(),link:'https://example.com/details'},
        {eventID:'javascript',name:'JavaScript',eventType:'event',start:new Date(now+2*hour).toISOString(),end:new Date(now+3*hour).toISOString(),link:'javascript:window.__securityExecuted=1'},
        {eventID:'data',name:'Data',eventType:'event',start:new Date(now+4*hour).toISOString(),end:new Date(now+5*hour).toISOString(),link:'data:text/html,x'},
        {eventID:'http',name:'HTTP',eventType:'event',start:new Date(now+6*hour).toISOString(),end:new Date(now+7*hour).toISOString(),link:'http://example.com/details'},
        {eventID:'obfuscated',name:'Obfuscated',eventType:'event',start:new Date(now+8*hour).toISOString(),end:new Date(now+9*hour).toISOString(),link:' https://example.com/details'}
      ]};
      _eventLoadState='ready';eventTypeFilter='all';window.__securityExecuted=0;
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-schedule').classList.add('active');renderEventsOnly();
    });
    await expect(page.locator('.event-card')).toHaveCount(5);
    await expect(page.locator('a.event-card')).toHaveCount(1);
    await expect(page.locator('a.event-card')).toHaveAttribute('href','https://example.com/details');
    await expect(page.locator('article.event-card')).toHaveCount(4);
    const opened=await page.evaluate(()=>{
      window.__openedEventDestinations=[];
      window.open=(...args)=>{window.__openedEventDestinations.push(args);return null;};
      openEventDetails('https://sub.example.com/?q=x');
      for(const unsafe of ['javascript:window.__securityExecuted=1','data:text/html,x','http://example.com','//example.com','/relative','https://user@example.com','https://example.com/path ','https:\\example.com','https://example.com/\nnext'])openEventDetails(unsafe);
      return window.__openedEventDestinations;
    });
    expect(opened).toEqual([['https://sub.example.com/?q=x','_blank','noopener,noreferrer']]);
    expect(await page.evaluate(()=>window.__securityExecuted)).toBe(0);
  });

  test('DATA-01 Admin maintenance keeps export and exposes no restore affordance',async({page})=>{
    await page.goto(`./?security-restore-containment=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'SecurityOwner',uid:'uid-security-owner'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{SecurityOwner:{isOwner:true,isAdmin:true,authUid:'uid-security-owner'}},wishlist:{},dynamax:{},gmax:{},costumes:{},requests:{}});
      cur='SecurityOwner';auth={currentUser:{uid:'uid-security-owner'}};
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-admin').classList.add('active');renderAdmin();setAdminSection('maintenance');
    });
    await page.setViewportSize({width:1440,height:900});
    await expect(page.locator('[data-admin-section="maintenance"]')).toBeVisible();
    const exportButton=page.locator('[data-admin-section="maintenance"] button').filter({hasText:/Export|Exportieren|Exportar|書き出す/});
    await expect(exportButton).toBeVisible();
    await expect(page.locator('#restore-file, [onclick*="triggerRestore"], [onclick*="restoreData"]')).toHaveCount(0);
    const runtimeBoundary=await page.evaluate(()=>{
      window.__securitySetCalls=[];
      set=async(target,data)=>{window.__securitySetCalls.push({target:String(target),data});};
      document.getElementById('toast')?.classList.remove('show');
      return{
        restoreData:typeof restoreData,
        triggerRestore:typeof triggerRestore,
        rootRestoreEnabled:PRODUCTION_ROOT_RESTORE_ENABLED
      };
    });
    expect(runtimeBoundary).toEqual({restoreData:'undefined',triggerRestore:'undefined',rootRestoreEnabled:false});
    await captureSecurity(page,'data-01-maintenance-desktop');
    await page.setViewportSize({width:390,height:420});
    await captureSecurity(page,'data-01-maintenance-mobile');
    const downloadPromise=page.waitForEvent('download');
    await exportButton.click();
    await expect.poll(async()=>(await downloadPromise).suggestedFilename()).toMatch(/^pogo-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await page.evaluate(()=>window.__securitySetCalls)).toEqual([]);
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
    await expect(page.locator('.event-card-date').first()).toContainText(String(new Date().getFullYear()));
    await expect(page.locator('.event-current-badge')).not.toContainText('●');
    await expect(page.locator('.event-filter[data-type="spotlight"]')).toBeVisible();
    const cueRightEdges=await page.locator('a.event-card .event-card-cue').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().right)));
    expect(Math.max(...cueRightEdges)-Math.min(...cueRightEdges)).toBeLessThanOrEqual(2);
    await expect(page.locator('article.event-card .event-card-cue')).toHaveCount(0);
    await capturePass3(page,`product-ui-events-${test.info().project.name}`);
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
    for(const [locale,width,height] of viewports){await page.setViewportSize({width,height});await page.evaluate(locale=>{changeInterfaceLocale(locale);_eventData=window.__eventTimelineFixture;_eventLoadState='ready';eventTypeFilter='all';renderEventsOnly();},locale);await expect(page.locator('.event-card').first()).toBeVisible();const rowBox=await page.locator('.event-card').first().boundingBox();expect(rowBox?.height).toBeLessThan(width<=430?172:150);const summaryClamps=await page.locator('.event-card-summary').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).webkitLineClamp));expect(summaryClamps.every(value=>value==='1')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);}
  });

  test('main product tabs keep equivalent page headings on one left edge',async({page})=>{
    await page.goto(`./?main-page-alignment=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'PageAlignmentTester',uid:'uid-page-alignment-tester'});
    const lefts=[];
    for(const [tab,heading] of [['mylist','#tab-mylist .my-hdr'],['find','#tab-find .have-hdr'],['schedule','#tab-schedule .sched-hdr']]){
      await openMainTab(page,tab);
      const box=await page.locator(heading).boundingBox();
      expect(box).not.toBeNull();
      lefts.push(box.x);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await capturePass3(page,`product-ui-${tab}-${test.info().project.name}`);
    }
    expect(Math.max(...lefts)-Math.min(...lefts)).toBeLessThanOrEqual(1);
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
