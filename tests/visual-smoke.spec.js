const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const editorFixture=require('./helpers/want-editor-application.cjs');
async function currentList(page,lists={wishlist:{Pikachu:'H',Eevee:'M',Bulbasaur:'L'}},profile={}){
  const username='LocalTrainer';
  const saved={authIndex:{'want-editor-local-uid':{username}},users:{[username]:{authUid:'want-editor-local-uid',...profile}}};
  for(const type of ['wishlist','dynamax','gmax','costumes','have'])saved[type]={[username]:lists[type]||{}};
  await editorFixture.install(page,saved);return saved;
}
async function currentFind(page){await page.locator('#wants-list-tools > summary').click();await page.locator('#wants-list-tools button[onclick*="setWantsFindOpen"]').click();}
async function currentSave(page){await page.locator('#combined-save').click();await expect(page.locator('#combined-editor-modal')).toBeHidden();await editorFixture.settled(page);}
async function currentShare(page,mode='text'){await page.locator('.wants-list-toolbar').getByRole('button',{name:'Share',exact:true}).click();await page.locator('#product-share-tab-'+mode).click();}
async function currentLocale(page,locale){await page.locator('#account-trigger').click();await page.locator('#account-settings-action').click();await page.locator('[data-settings-target="language"]').click();await page.locator('#settings-language').selectOption(locale);await page.locator('.settings-modal-close').click();}
async function openSyntheticPublic(page,username,lists){
  await page.evaluate(({username,lists})=>{
    __editorFixture.remote.publicShares||={};__editorFixture.remote.publicShares[username]={version:1,username,profile:{lastUpdated:1},lists:{wishlist:{},dynamax:{},gmax:{},costumes:{},...lists},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1};
    if(!__editorFixture.ownedSubscriptions){
      managedOwnedDataCoordinator?.reset();
      managedCurrentUserRepository=currentUserRepositoryData.createCurrentUserRepository(managedFirebaseClient);
      managedOwnedDataCoordinator=ownedDataCoordinatorData.createOwnedDataCoordinator({repository:managedCurrentUserRepository,lifecycle:managedListenerLifecycle,onSnapshot:_onOwnedDataSnapshot,onError:_onOwnedDataError});
      __editorFixture.ownedSubscriptions=true;
    }
    ensureOwnedExactSubscriptions();
  },{username,lists});
  await page.locator('#nav-find').click();await page.locator('[data-discovery-mode="trainers"]').click();
  await page.locator('#find-trainer-input').fill(username);await page.locator('#find-trainer-input').press('Enter');await expect(page.locator('#share-view')).toBeVisible();await expect(page.locator('.share-hdr-name')).toContainText(username);
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

const pass3ScreenshotDir=process.env.PASS3_SCREENSHOT_DIR||'';
const favoriteBrowseScreenshotDir=process.env.FAVORITE_BROWSE_SCREENSHOT_DIR||'';
const navScreenshotDir=process.env.NAV_SCREENSHOT_DIR||'';
const securityScreenshotDir=process.env.SECURITY_SCREENSHOT_DIR||'';
const p1ScreenshotDir=process.env.P1_SCREENSHOT_DIR||'';
const backgroundScreenshotDir=process.env.BACKGROUND_SCREENSHOT_DIR||'';
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
async function captureBackground(page,name){
  if(!backgroundScreenshotDir)return;
  mkdirSync(backgroundScreenshotDir,{recursive:true});
  await page.screenshot({path:path.join(backgroundScreenshotDir,`${name}.png`),fullPage:false});
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
  await page.waitForFunction(() => typeof window.__pogoEnsureFullApp === 'function');
  await page.evaluate(() => window.__pogoEnsureFullApp('visual-smoke-test'));
  await page.waitForFunction(() => typeof openTrainerOrganizer === 'function' && window.__pogoStartup?.authStateKnownAt !== null && window.__pogoStartup?.firebaseStartupSettledAt !== null);
  await page.evaluate(() => {
    resetTrainerOrganizerState();
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function isolateAuthenticatedMyListFixture(page,{username,uid}) {
  await page.waitForFunction(() => typeof window.__pogoEnsureFullApp === 'function');
  await page.evaluate(() => window.__pogoEnsureFullApp('visual-authenticated-fixture'));
  await page.waitForFunction(() => window.__pogoStartup?.authStateKnownAt !== null && window.__pogoStartup?.firebaseStartupSettledAt !== null && typeof managedSubscriptions?.unsubscribeByKey === 'function');
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

async function waitForFullAppScripts(page,reason='visual-full-app-fixture') {
  await page.waitForFunction(() => typeof window.__pogoEnsureFullApp === 'function');
  await page.evaluate(reasonValue => window.__pogoEnsureFullApp(reasonValue),reason);
  await page.waitForFunction(() => typeof openSettingsPanel === 'function' && typeof syncSettingsRoute === 'function');
}

async function waitForSettingsStartupReady(page) {
  await waitForFullAppScripts(page,'visual-settings-fixture');
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

  test('reviewed and unavailable costume art stays honest across signed-in surfaces',async({page})=>{

    const mappings=[['Pikachu (Worlds 2025)','pikachu-world-champs-2025.png'],['Pikachu (Fragment)','pikachu-thunderbolt-cap.png'],['Raichu Fragment Cap','raichu-thunderbolt-cap.png'],['Pikachu (Halloween 2022)','pikachu-halloween-mischief.png'],['Pikachu (Halloween 2024)','pikachu-witch.png'],['Pikachu (Holiday 2022)','pikachu-holiday.png'],['Pikachu (Holiday 2024)','pikachu-holiday.png'],['Gengar (Halloween 2024)','gengar-spooky-festival.png']];
    const costumes=Object.fromEntries([...mappings.map(([name])=>[name,'H']),['Pikachu (Worlds 2026)','M']]);
    await currentList(page,{costumes});
    const check=async(rows)=>{
      for(const[name,file]of mappings)await expect(rows.filter({hasText:name}).locator('img')).toHaveAttribute('src',new RegExp('assets/sprites/go/'+file.replaceAll('.','\\.')));
      const unavailable=rows.filter({hasText:'Pikachu (Worlds 2026)'});
      await expect(unavailable.locator('.known-unavailable')).toHaveAttribute('aria-label','Artwork not yet available for Pikachu (Worlds 2026)');
      await expect(unavailable.locator('.known-unavailable')).toHaveAttribute('title','Artwork not yet available for Pikachu (Worlds 2026)');
      await expect(unavailable.locator('img')).toHaveCount(0);
      expect(await rows.locator('img').evaluateAll(images=>images.some(image=>/\/pikachu(?:-female)?\.png$/.test(new URL(image.src).pathname)))).toBe(false);
    };
    await check(page.locator('.wants-row'));
    // The retired FT board is not reopened. The current full-list preview and
    // real export actions must retain every exact costume and honest placeholder.
    await currentShare(page,'link');await check(page.locator('.share-public-list li'));
    for(const theme of ['dark','light'])for(const width of [320,390,1440]){
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:900});
      const slot=page.locator('.share-public-list .known-unavailable');
      const geometry=await slot.evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,border:getComputedStyle(el).borderStyle}));
      expect(geometry).toEqual({w:34,h:34,border:'dashed'});await noOverflow(page);
    }
    await page.locator('#product-share-tab-text').click();await page.locator('#share-text-markdown').check();
    await page.evaluate(()=>{window.__costumeCopy='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>__costumeCopy=text}});});
    await page.locator('#product-share-primary').click();
    for(const name of Object.keys(costumes))expect(await page.evaluate(()=>__costumeCopy)).toContain(name);
    await page.locator('#share-text-csv').check();const csv=await page.locator('.share-text-preview').textContent();
    await page.evaluate(()=>{window.__costumeDownload='';downloadBlob=async blob=>{__costumeDownload=await blob.text();};});await page.locator('#product-share-primary').click();await expect.poll(()=>page.evaluate(()=>__costumeDownload)).toBe(csv);
    for(const name of Object.keys(costumes))expect(csv).toContain(name);
    await page.keyboard.press('Escape');
    await openSyntheticPublic(page,'CostumeViewer',{costumes});
    await page.locator('#share-list-tabs .ltab').filter({hasText:'Others'}).click();
    await check(page.locator('.share-pcard'));

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

  test('200% zoom keeps representative primary workflows operable',async({page})=>{

    await page.setViewportSize({width:720,height:900});await currentList(page);
    // Supplemental CSS enlargement only, not native browser zoom certification.
    await page.evaluate(()=>document.documentElement.style.zoom='2');
    await page.evaluate(()=>{_eventData={fetchedAt:Date.now(),raids:[],events:[]};_eventLoadState='ready';});
    const operable=async selector=>{const el=page.locator(selector);await expect(el).toBeVisible();await el.scrollIntoViewIfNeeded();await expect(el).toBeInViewport();const box=await el.boundingBox();expect(box.width).toBeGreaterThan(0);expect(box.height).toBeGreaterThan(0);};
    await operable('#wants-add-name');await page.locator('#nav-find').click();await operable('#find-trainer-input');
    await page.locator('[data-discovery-mode="pokemon"]').click();await operable('#favorite-browse-input');
    await page.locator('#nav-more').click();await page.locator('#more-events').click();await operable('.event-filter-row');
    await page.locator('#account-trigger').click();await page.locator('#account-settings-action').click();await page.locator('[data-settings-target="language"]').click();
    await operable('#settings-language');await operable('.settings-modal-close');await page.locator('.settings-modal-close').click();
    await openSyntheticPublic(page,'ZoomPublic',{wishlist:{Pikachu:'H'}});await operable('#share-list-out');
    // Protected admin navigation is covered by the existing owner-only tests;
    // this ordinary-user journey must not manufacture an admin surface.
    await expect(page.locator('#tab-admin')).toBeHidden();

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
    // Admin is a protected More destination, not a primary tab.

    for(const [width,height] of [[375,700],[390,700],[430,760],[768,800],[1440,900]]){
      await page.setViewportSize({width,height});
      const ids=await page.locator('.tabs .tab:visible').evaluateAll(nodes=>nodes.map(n=>n.id));
      expect(ids).toEqual(width<768?['nav-mylist','nav-find','nav-more']:['nav-mylist','nav-find','nav-events','nav-more']);
      const selectedMeasurements=[];
      for(const selectedId of ids){
        await page.locator('#'+selectedId).click();
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
            const label=!shortLabel||getComputedStyle(shortLabel).display==='none'?fullLabel:shortLabel;
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
    await expect(page.locator('#login-language-trigger')).toBeVisible();
    await expect(page.locator('#login-language-trigger')).toBeEnabled();
    await expect(page.locator('#account-trigger')).toBeHidden();
    await page.locator('#login-language-trigger').click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator('#settings-language')).toBeVisible();
    await expect(page.locator('#settings-language')).toBeFocused();
    await expect(page.locator('#settings-account-summary')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
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
    await page.evaluate(()=>selectSettingsSection('tools'));
    await expect(page).toHaveURL(/#settings\/tools$/);
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"]')).toBeHidden();
    await expect(page.locator('[data-settings-target="tools"]')).toHaveCount(0); // Compatibility deep link only; normal tools live in More.
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
    await expect(page.locator('[data-settings-target="tools"]')).toHaveCount(0); // Compatibility deep link only; normal tools live in More.

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
      await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
      await page.evaluate(()=>window.__pogoEnsureFullApp('visual-settings-boot-fixture'));
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
    await waitForFullAppScripts(page,'visual-anonymous-settings-fixture');
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
    for(const id of ['prof-av-open','settings-account-av','fc-inp','prof-bio','prof-discord'])await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator('#prof-discord-id,.discord-id-help,.discord-id-help-toggle')).toHaveCount(0);
    for(const key of ['settings.profileGroupTrainer','settings.profileGroupPokemonGo','settings.profileGroupAbout'])await expect(page.locator(`[data-i18n="${key}"]`)).toBeVisible();
    await expect(page.locator('[data-settings-section="profile"] #np1')).toHaveCount(0);await expect(page.locator('[data-settings-section="profile"] #wp-picker')).toHaveCount(0);
    await page.locator('[data-settings-target="security"]').click();
    await expect(page.locator('#settings-security-name')).toHaveText('AppearanceTrainer');await expect(page.locator('#settings-pin-form')).toBeHidden();
    await page.evaluate(()=>{auth={currentUser:{uid:'appearance-local',providerData:[{providerId:'password'}]}};allData.users[cur]={...allData.users[cur],authUid:'appearance-local',pin:'synthetic-hash'};renderConnectedAccounts();});
    await page.locator('#settings-pin-toggle').click();await expect(page.locator('#np1')).toBeVisible();await expect(page.locator('#np2')).toBeVisible();

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
    const viewports=[[320,568],[375,812],[390,844],[430,932],[768,800],[1024,800],[1440,900],[1728,1000],[390,420],[390,300]];
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

  test('language Settings keeps automatic and explicit search language aligned, responsive, and device-local',async({page})=>{
    const viewports=[[320,568],[375,812],[390,844],[430,932],[768,800],[1024,800],[1440,900],[1728,1000]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?language-settings=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForSettingsStartupReady(page);
      await page.evaluate(()=>{
        localStorage.removeItem('pogoPokemonGoSearchLocale:v1');
        localStorage.removeItem('pogoPokemonGoSearchLocaleOverride:v1');
        changeInterfaceLocale('ja');
        openSettingsPanel('public');
      });
      const row=page.locator('.language-search-row');
      const searchLanguage=page.locator('#settings-search-language');
      await expect(searchLanguage).toHaveValue('follow-app');
      await expect(row).toBeVisible();
      await expect(searchLanguage).toBeEnabled();
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('ja');

      await searchLanguage.selectOption('ja'); // Explicit equal choice remains distinct from automatic.
      await expect(row).toBeVisible();
      await expect(searchLanguage).toBeEnabled();
      await searchLanguage.selectOption('en');
      await page.locator('#settings-language').selectOption('de');
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('en');
      await searchLanguage.selectOption('follow-app');
      await expect(row).toBeVisible();
      expect(await page.evaluate(()=>pokemonGoSearchLocale())).toBe('de');

      const geometry=await page.evaluate(()=>{
        const panel=document.querySelector('.language-settings-panel');
        const layout=document.getElementById('settings-layout');
        const detail=document.getElementById('settings-detail');
        const primaryLabel=document.querySelector('.language-primary-row>span');
        const primarySelect=document.getElementById('settings-language');
        const label=document.querySelector('.language-search-row');
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
      expect(geometry.panelWidth).toBeGreaterThanOrEqual(geometry.detailWidth-76);
      expect(geometry.labelWidth).toBeGreaterThanOrEqual(Math.min(260,geometry.detailWidth-76));
      expect(geometry.selectWidth).toBeGreaterThanOrEqual(Math.min(260,geometry.detailWidth-76));
      expect(geometry.selectHeight).toBeGreaterThanOrEqual(48);
      await expect(page.locator('.settings-nav')).toBeHidden();
      await expect(page.locator('.settings-mobile-back')).toBeHidden();
      await page.keyboard.press('Escape');
    }

    await page.evaluate(()=>{
      localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify('en'));
      localStorage.removeItem('pogoPokemonGoSearchLocaleOverride:v1');
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>openSettingsPanel('public'));
    await expect(page.locator('#settings-search-language')).toHaveValue('follow-app');
    expect(await page.evaluate(()=>localStorage.getItem('pogoPokemonGoSearchLocale:v1'))).toBeNull();
    await page.evaluate(()=>{
      localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify('en'));
      localStorage.setItem('pogoPokemonGoSearchLocaleOverride:v1',JSON.stringify(true));
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>openSettingsPanel('public'));
    expect(await page.evaluate(()=>lsGet(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY,false))).toBe(true);
    await expect(page.locator('#settings-search-language')).toHaveValue('en');
  });

  test('anonymous share and signed-out Settings use the full-width local Language layout',async({page})=>{
    const surfaces=['share','login'];
    const locales=['en','ja','es','de'];
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const surface of surfaces){
      for(const locale of locales){
        // One startup per surface/locale, then exercise every responsive state.
        // Rebooting all application scripts 72 times exhausted the shared test
        // budget on CI; this keeps all 72 layout/action assertions unchanged.
        await page.goto(`./?public-settings=${surface}-${locale}-${Date.now()}`,{waitUntil:'domcontentloaded'});
        await waitForSettingsStartupReady(page);
        for(const [width,height] of viewports){
          await page.setViewportSize({width,height});
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
          expect(off.labelWidth).toBeGreaterThanOrEqual(Math.min(260,off.detailWidth-76));
          expect(off.selectWidth).toBeGreaterThanOrEqual(Math.min(260,off.detailWidth-76));
          expect(off.selectHeight).toBeGreaterThanOrEqual(48);
          expect(off.closeWidth).toBeGreaterThanOrEqual(48);
          expect(off.closeHeight).toBeGreaterThanOrEqual(48);
          await page.locator('#settings-search-language').selectOption('de');
          await expect(page.locator('.language-search-row')).toBeVisible();
          expect(await page.evaluate(()=>{
            const row=document.querySelector('.language-search-row');
            const select=document.getElementById('settings-search-language');
            return row.scrollWidth<=row.clientWidth&&select.getBoundingClientRect().width>=Math.min(260,document.getElementById('settings-detail').getBoundingClientRect().width-76)&&select.getBoundingClientRect().height>=48;
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
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);

    await page.goto(`./?reload-settings=${Date.now()}#settings`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.reload({waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
    await page.evaluate(()=>syncSettingsRoute({captureScroll:false}));
    await expect(page.locator('#settings-modal')).toBeVisible();
    await activeSettingsClose(page).click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);

    await page.goto(`./?legacy-settings=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForSettingsStartupReady(page);
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
        setTrainerDiscoveryMode('trainers');
        await renderTrainerQuickLists();
        window.__trainerSearchWidth=document.querySelector('.trainer-search-shell')?.getBoundingClientRect().width||0;
        setTrainerDiscoveryMode('favorites');
        await renderTrainerQuickLists();
      });
      const favoritesSearch=page.locator('.favorite-toolbar-search'),card=page.locator('.favorite-card-shell').first();
      await expect(card).toBeVisible();
      const trainerSearchWidth=await page.evaluate(()=>window.__trainerSearchWidth),favoriteSearchBox=await favoritesSearch.boundingBox();
      // The search row also owns an adjacent picker action/gap. The individual
      // input need not fill its parent's width; the contained shell must align.
      const shell=await page.locator('.trainer-discovery-content').boundingBox();
      expect(Math.abs(favoriteSearchBox.x-shell.x)).toBeLessThanOrEqual(1);expect(Math.abs(favoriteSearchBox.width-shell.width)).toBeLessThanOrEqual(1);
      expect(trainerSearchWidth).toBeGreaterThan(0);expect(trainerSearchWidth).toBeLessThanOrEqual(shell.width);
      await expect(card.locator('.favorite-card-add-tag')).toBeHidden();
      await expect(card.locator('.favorite-card-more')).toBeVisible();
      await expect(card).not.toContainText('Organize tags');
      const moreBox=await card.locator('.favorite-card-more').boundingBox();
      expect(moreBox?.width).toBeGreaterThanOrEqual(48);expect(moreBox?.height).toBeGreaterThanOrEqual(48);
      await card.locator('.favorite-card-more').click();
      await expect(card.locator('.favorite-card-menu')).toBeVisible();
      const organize=card.locator('[data-trainer-action="organize-menu"]');await expect(organize).toBeVisible();const addBox=await organize.boundingBox();expect(addBox.width).toBeGreaterThanOrEqual(48);expect(addBox.height).toBeGreaterThanOrEqual(48);
      await page.keyboard.press('Escape');
      await expect(card.locator('.favorite-card-menu')).toBeHidden();
      await expect(card.locator('.favorite-card-more')).toBeFocused();
      const longCard=page.locator('.favorite-card-shell[data-trainer="TrainerNameThatIsDeliberatelyLongForCompactLayouts"]');
      await expect(longCard).toBeVisible();
      const longNameBox=await longCard.locator('.trainer-quick-name').boundingBox();
      const longFooterBox=await longCard.locator('.favorite-card-footer').boundingBox();
      // The mobile footer is beside the name, not necessarily below it.
      expect(longNameBox&&longFooterBox).toBeTruthy();
      expect(longNameBox.x+longNameBox.width<=longFooterBox.x+1||longNameBox.y+longNameBox.height<=longFooterBox.y+1).toBe(true);
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
        setTrainerDiscoveryMode('favorites');
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
      setTrainerDiscoveryMode('favorites');
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
    await page.locator('[data-discovery-mode="pokemon"]').click();
    await expect(page.locator('#favorite-pokemon-browse')).toBeVisible();
    expect(await page.evaluate(()=>document.getElementById('favorite-trainers').contains(document.getElementById('favorite-pokemon-browse')))).toBe(false);
    await expect(page.locator('.trainer-discovery-modes')).toBeVisible();
    await expect(page.locator('#favorite-browse-panel')).toBeVisible();
    await captureFavoriteBrowse(page,'01-desktop-idle');
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
    await expect(page.locator('#favorite-browse-results')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('.favorite-browse-progress')).toContainText(/3/);
    await expect(page.locator('.favorite-browse-row')).toHaveCount(3); // Alpha has two distinct variants.
    const maxRow=page.locator('.favorite-browse-row').filter({hasText:'Dynamax'});await expect(maxRow).toContainText('TrainerAlpha');await expect(maxRow).toContainText('High');
    await expect(page.locator('.favorite-browse-row').first()).toContainText('NYC');
    await expect(page.locator('.favorite-browse-row').first().locator('[data-trainer-action="open"]')).toHaveText('TrainerAlpha');
    await expect(page.locator('.group-availability')).toContainText('TrainerGamma');
    const beforeRetry=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    await page.locator('[data-favorite-action="refresh-browse"]').click();
    await expect(page.locator('.favorite-browse-row')).toHaveCount(4);
    const afterRetry=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    expect(afterRetry.TrainerAlpha).toBe(beforeRetry.TrainerAlpha+1);
    expect(afterRetry.TrainerBeta).toBe(beforeRetry.TrainerBeta+1);
    expect(afterRetry.TrainerGamma).toBe(beforeRetry.TrainerGamma+1);
    await expect(page.locator('.group-availability li')).toHaveCount(0);
    await captureFavoriteBrowse(page,'05-desktop-expanded-results');

    const readsBeforeTag=await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads));
    await page.evaluate(()=>{window.__favoriteBrowseFixture.state.favorites[0].tagIds=['soon'];renderFavoriteBrowseResults();});
    for(const row of await page.locator('.favorite-browse-row').filter({hasText:'TrainerAlpha'}).all())await expect(row).toContainText('Trade soon');
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeTag);
    await page.locator('.favorite-browse-main [data-trainer-action="open"]').first().click();
    await expect.poll(()=>page.evaluate(()=>window.__favoriteBrowseFixture.opened)).not.toBe('');

    const readsBeforeKeystrokes=await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads));
    await page.locator('#favorite-browse-input').fill('Eevee');
    expect(await page.evaluate(()=>JSON.stringify(window.__favoriteBrowseFixture.reads))).toBe(readsBeforeKeystrokes);
    await expect(page.locator('#favorite-browse-suggestions.open .ac-item').first()).toBeVisible();
    await page.locator('#favorite-browse-input').press('Enter');
    await expect(page.locator('#favorite-browse-results')).toContainText('No current permitted wants match this selection.');
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
    await page.locator('[data-discovery-mode="pokemon"]').click();
    await captureFavoriteBrowse(page,'02-mobile-idle');
    await captureFavoriteBrowse(page,'03-mobile-before-selection');
    await page.evaluate(()=>{favoriteBrowseState.selected={name:'Palkia',dn:'Palkia',no:484};favoriteBrowseState.expanded=true;document.getElementById('favorite-browse-input').value='Palkia';renderFavoriteBrowseResults();});
    await expect(page.locator('.favorite-browse-row')).toHaveCount(4);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await captureFavoriteBrowse(page,'04-mobile-populated-results');

    const beforeRefresh=await page.evaluate(()=>({...window.__favoriteBrowseFixture.reads}));
    await page.getByRole('button',{name:/Refresh/i}).click();
    await expect.poll(()=>page.evaluate(()=>Object.values(window.__favoriteBrowseFixture.reads).reduce((sum,value)=>sum+value,0))).toBe(Object.values(beforeRefresh).reduce((sum,value)=>sum+value,0)+3);
    await expect(page.locator('.favorite-browse-row')).toHaveCount(4);
    for(const {locale,width} of [{locale:'ja',width:320},{locale:'de',width:390},{locale:'es',width:430},{locale:'en',width:1440}]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(locale=>changeInterfaceLocale(locale),locale);
      await expect(page.locator('[data-discovery-mode="pokemon"]')).toBeVisible();
      await expect(page.locator('.favorite-browse-row')).toHaveCount(4);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      const openBox=await page.locator('.favorite-browse-main [data-trainer-action="open"]').first().boundingBox();
      // Current species results use a compact inline trainer link (32px), not
      // the retired standalone 48px Open button. Retain actual hit/focus proof.
      expect(openBox?.height).toBeGreaterThanOrEqual(32);
      const open=page.locator('.favorite-browse-main [data-trainer-action="open"]').first();await open.scrollIntoViewIfNeeded();await open.focus();await expect(open).toBeFocused();
      expect(await open.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    }
    await page.evaluate(async()=>{window.__favoriteBrowseFixture.unpublished=true;ensureFavoriteShareSessionCache().invalidate();await hydrateFavoriteBrowse({force:true});});
    await expect(page.locator('#favorite-browse-results')).toContainText('No current permitted wants match this selection.');
    await expect(page.locator('.group-availability li')).toHaveCount(3);
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
      switchTab('find',{render:false});setTrainerDiscoveryMode('pokemon');document.getElementById('favorite-browse-input').value='Cascoon';syncFavoriteBrowseDisclosure();
      const pending=hydrateFavoriteBrowse();
      await new Promise(resolve=>setTimeout(resolve,0));
      const loading=document.getElementById('favorite-browse-results').textContent;
      await pending;
      return{reads,active,maxActive,loading,busy:favoriteBrowseState.busy,summary:favoriteShareSessionCache.summary(favorites)};
    });
    expect(result.reads).toBe(3);expect(result.active).toBe(3);expect(result.maxActive).toBe(3);expect(result.loading).toContain('0');expect(result.loading).toContain('3');expect(result.busy).toBe(false);expect(result.summary).toMatchObject({checked:3,failed:3});
    await expect(page.locator('#favorite-browse-results')).not.toHaveAttribute('aria-busy','true');
    await expect(page.locator('[data-favorite-action="refresh-browse"]')).toBeVisible();
    await expect(page.locator('.group-availability li')).toHaveCount(3);
  });

  test('Browse explicitly hydrates 21 and 100 Favorites with four-way bounded exact reads',async({page,browserName})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?favorite-browse-scale=${browserName}-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'BrowseScale',uid:'uid-browse-scale'});
    await page.locator('#nav-find').click();await page.locator('[data-discovery-mode="pokemon"]').click();
    await expect(page.locator('#tab-find')).toBeVisible();
    for(const count of [21,100]){
      const result=await page.evaluate(async count=>{
        const favorites=Array.from({length:count},(_,index)=>({key:`trainer-${index}`,displayName:`Trainer-${index}`,tagIds:[],createdAt:index,updatedAt:index}));
        const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-browse-scale',username:'BrowseScale'},favorites,recent:[],snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
        ensureTrainerHistoryStore=()=>({read:()=>state,filterFavorites:()=>favorites,snapshotFor:()=>null,updateCanonicalName:()=>false,favoriteFor:name=>favorites.find(item=>item.displayName===name)||null});
        let reads=0,active=0,maxActive=0;
        managedPublicShareRepository={read:async username=>{reads++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,count===100?20:1));active--;return{ok:true,value:{version:1,username,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1}};}};
        favoriteShareSessionCache=null;favoriteBrowseState.selected={name:'Pikachu',dn:'Pikachu',no:25};favoriteBrowseState.expanded=true;
        document.getElementById('favorite-browse-input').value='Pikachu';
        closeFavoriteBrowseSuggestions();
        const started=performance.now();await hydrateFavoriteBrowse();const firstDuration=performance.now()-started;
        const afterHydrate=reads;
        favoriteBrowseInput('Pika');favoriteBrowseInput('Pikachu');renderFavoriteBrowseResults();
        return{count,reads,afterHydrate,maxActive,firstDuration,results:document.querySelectorAll('.favorite-browse-row').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      },count);
      expect(result.reads).toBe(count);expect(result.afterHydrate).toBe(count);expect(result.maxActive).toBeLessThanOrEqual(4);expect(result.results).toBe(Math.min(60,count));expect(result.overflow).toBe(false);expect(result.firstDuration).toBeLessThan(2500);
      if(count===100){
        await page.locator('[data-lookup-more]').click();await expect(page.locator('.favorite-browse-row')).toHaveCount(100);
        await page.evaluate(()=>{ensureFavoriteShareSessionCache().invalidate();window.__p1BrowseHydration=hydrateFavoriteBrowse({force:true});closeFavoriteBrowseSuggestions();});
        await expect(page.locator('#favorite-browse-results')).toHaveAttribute('aria-busy','true');
        await expect(page.locator('.favorite-browse-progress')).toContainText(/100/);
        await captureP1(page,`browse-100-loading-${browserName}`);
        await page.evaluate(()=>window.__p1BrowseHydration);
        await captureP1(page,`browse-100-complete-${browserName}`);
      }
    }
  });

  test('Favorite cards remain local until an explicit Browse selection or trainer open',async({page,browserName,browser})=>{
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

    // Mutation qualification needs the real canonical authority, not the fake
    // local-only store above. Use a fresh isolated account/service fixture.
    for(const [name,active]of [['Trainer Active',true],['Trainer Inactive',false]]){
      const context=await browser.newContext({baseURL:test.info().project.use.baseURL,serviceWorkers:'block'});
      try{
      const actual=await context.newPage();await editorFixture.install(actual,null,{favoriteTransport:true});
      await actual.evaluate(()=>{window.__browseReads=[];window.__ownProjectionReads=[];managedPublicShareRepository={read:async name=>{
        if(name===cur){__ownProjectionReads.push(name);return{ok:true,value:structuredClone(__editorFixture.remote.publicShares?.[name]||null)};}
        __browseReads.push(name);return{ok:false,error:{code:'offline'}};
      }};});
        // This is query-state fixture preparation, not a replacement add handler.
        await actual.evaluate(active=>{favoriteBrowseState.selected=active?{name:'Pikachu',dn:'Pikachu',no:25}:null;},active);
        const before=await actual.evaluate(()=>__editorFixture.reads.filter(p=>p.startsWith('publicShares/')).length);
        await openSyntheticPublic(actual,name,{wishlist:{Pikachu:'H'}});
        expect(await actual.evaluate(()=>__editorFixture.reads.filter(p=>p.startsWith('publicShares/')).length)).toBe(before+1);
        await actual.locator('[data-share-action="favorite"]').click();
        await expect.poll(()=>actual.evaluate(async()=>(await managedFavoriteAdditions.snapshot()).rows.at(-1)?.state)).toBe('confirmed');
        await expect(actual.locator('[data-share-action="favorite-remove"]')).toBeVisible();
        expect(await actual.evaluate(()=>__browseReads)).toEqual([]);
        // The resolver path confirms the identity but no longer implicitly
        // hydrates a public wants projection on add (unlike the retired path).
        actual.once('dialog',dialog=>dialog.accept());await actual.locator('[data-share-action="favorite-remove"]').click();await editorFixture.settled(actual);
        await expect(actual.locator('[data-share-action="favorite"]')).toBeVisible();expect(await actual.evaluate(()=>__browseReads)).toEqual([]);
        const requests=await actual.evaluate(()=>__editorFixture.favoriteRequests);expect(requests.filter(r=>r.kind==='resolve')).toHaveLength(1);expect(requests.filter(r=>r.kind==='write')).toHaveLength(2);
      }finally{await context.close();}
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
      await page.evaluate(async locale=>{changeInterfaceLocale(locale);setTrainerDiscoveryMode('favorites');await renderTrainerQuickLists();},locale);
      await expect(page.locator('#favorite-trainers h2')).toBeVisible();
      await expect(page.locator('#recent-trainers h2')).toBeHidden();
      const firstCard=page.locator('.favorite-card-shell').first();
      const firstRecent=page.locator('.recent-trainer-row').first();
      await expect(firstCard).toBeVisible();
      const moreBox=await firstCard.locator('.favorite-card-more').boundingBox();
      let addBox;
      if(width<=600){await firstCard.locator('.favorite-card-more').click();const action=firstCard.locator('[data-trainer-action="organize-menu"]');await expect(action).toBeVisible();addBox=await action.boundingBox();await page.keyboard.press('Escape');}
      else addBox=await firstCard.locator('.favorite-card-add-tag').boundingBox();
      await expect(firstCard.locator('.favorite-card-add-tag')).toContainText(/\+/);
      expect(await firstCard.locator('.favorite-card-add-tag').evaluate(node=>node.parentElement?.classList.contains('favorite-card-footer'))).toBe(true);
      expect(await firstCard.locator('.favorite-card-tags .favorite-card-add-tag').count()).toBe(0);
      await page.locator('[data-discovery-mode="trainers"]').click();await expect(firstRecent).toBeVisible();
      const recentName=firstRecent.locator('.recent-trainer-name');
      const recentRecency=firstRecent.locator('.recent-trainer-recency');
      await expect(recentName).toBeVisible();await expect(recentRecency).toBeVisible();
      await expect(recentRecency).toContainText(/.+/);
      const nameBox=await recentName.boundingBox(),recencyTextBox=await recentRecency.boundingBox(),rowBox=await firstRecent.boundingBox();
      expect(recencyTextBox?.y).toBeGreaterThan(nameBox?.y||0);
      expect(rowBox?.height).toBeLessThan(84);

      const recentBox=await firstRecent.locator('.recent-trainer-chevron').boundingBox();
      for(const box of [addBox,moreBox,recentBox]){expect(box?.width).toBeGreaterThanOrEqual(48);expect(box?.height).toBeGreaterThanOrEqual(48);}

      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      if(width>=768){
        await page.evaluate(async()=>{setTrainerDiscoveryMode('trainers');await renderTrainerQuickLists();});
        const favoritesBox=await page.locator('#trainer-favorites-preview').boundingBox(),recentsBox=await page.locator('#recent-trainers').boundingBox();
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
      await page.locator('[data-discovery-mode="favorites"]').click();
      await expectOpens(()=>page.locator('.favorite-card-primary').click());
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe('FavoriteOne');
      await page.locator('[data-discovery-mode="trainers"]').click();
      expect(await row.locator('button,a,[role="button"]').count()).toBe(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    }

    const recentHeight=(await page.locator('.recent-trainer-row').boundingBox()).height;
    expect(recentHeight).toBeGreaterThan(0);expect(recentHeight).toBeLessThan(80);
    await page.keyboard.press('Escape');await page.locator('[data-discovery-mode="favorites"]').click();
    const density=await page.evaluate(async()=>{
      const favoriteHeight=document.querySelector('.favorite-card-shell').getBoundingClientRect().height;
      const state=ensureTrainerHistoryStore().read();state.favorites=[];await renderTrainerQuickLists();
      return{favoriteHeight};
    });
    expect(density.favoriteHeight).toBeLessThan(128);
    // The current empty state includes actionable guidance, not the retired
    // single-line placeholder. Check reachability and clipping, not its old height.
    await expect(page.locator('#favorite-trainers .empty-state')).toBeVisible();
    for(const action of await page.locator('#favorite-trainers .empty-state button').all()){
      await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport();
      expect(await action.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    }

    await page.locator('[data-discovery-mode="trainers"]').click();
    const status=page.locator('#find-trainer-status');
    await page.evaluate(()=>{document.getElementById('find-trainer-input').value='';renderFindTrainer();});
    await expect(status).toBeHidden();
    await page.locator('#find-trainer-input').fill('Rec');
    await expect(status).toContainText(/.+/);
    await expect(page.locator('.trainer-suggestion')).toHaveCount(1);
    await expect(status).not.toContainText(/Searching/i);
  });

  test('My List compact add controls stay responsive and keyboard reachable',async({page})=>{

    await currentList(page);
    for(const width of [320,390,1024,1440]){
      await page.setViewportSize({width,height:900});
      const input=page.locator('#wants-add-name'),details=page.locator('.wants-add-form .add-advanced-toggle'),tools=page.locator('#wants-list-tools > summary');
      await expect(input).toBeVisible();await expect(details).toHaveText(/Flags & details/);
      for(const target of [details,tools,page.locator('.myrow-edit').first(),page.locator('.myrow-remove').first()]){
        const box=await target.boundingBox();expect(box.width).toBeGreaterThanOrEqual(width<=600?44:40);expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await tools.evaluate(el=>!document.querySelector('.wants-add-form').contains(el)&&!!el.closest('.wants-list-toolbar'))).toBe(true);
      await details.focus();await page.keyboard.press('Enter');await expect(page.locator('#combined-editor-modal')).toBeVisible();
      await expect(page.locator('#combined-save')).toBeInViewport();await page.keyboard.press('Escape');await expect(details).toBeFocused();
      await tools.focus();await page.keyboard.press('Enter');await expect(page.locator('#wants-list-tools .wants-list-menu > button')).toHaveCount(3);
      await page.keyboard.press('Escape');await expect(tools).toBeFocused();await noOverflow(page);
    }

  });

  test('Add Pokemon flags and details preserve hierarchy, touch targets, and behavior',async({page})=>{
    await currentList(page,{wishlist:{}});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      if(width===390)await currentLocale(page,'de');
      await editorFixture.addDialog(page,'Pikachu');await editorFixture.priority(page,'M');
      const before=await editorFixture.entities(page);
      for(const flag of ['lucky','shiny','xxl'])await page.locator('#combined-'+flag).check();
      await page.locator('#combined-gender').selectOption('f');await page.locator('#combined-mod').fill('winter costume');
      await page.locator('#combined-note-details summary').click();await page.locator('#combined-note').fill('First public line\nSecond public line');
      for(const flag of ['lucky','shiny','xxl','xxs']){const b=await page.locator('label:has(#combined-'+flag+')').boundingBox();expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}
      await page.locator('#combined-lucky').focus();await page.keyboard.press('Space');await expect(page.locator('#combined-lucky')).not.toBeChecked();await page.keyboard.press('Space');
      expect(await editorFixture.entities(page)).toEqual(before);await noOverflow(page);await currentSave(page);
      const entries=await page.evaluate(()=>productDeclarations().entries);
      expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({name:'Pikachu',p:'M',gender:'f',mod:'winter costume',lucky:true,shiny:true,xxl:true,xxs:false,note:'First public line\nSecond public line'});
      await expect(page.locator('.wants-row')).toHaveCount(1);
      await page.locator('.wants-row .myrow-edit').click();await page.locator('#wants-remove').click();await editorFixture.settled(page);await expect(page.locator('.wants-row')).toHaveCount(0);
    }

  });

  test('My List dense rows preserve states without hover or tap tooltips',async({page})=>{

    await currentList(page,{wishlist:{Pikachu:'H', 'P-Tauros (Combat)':'H','Oricorio (Pom-Pom)':'H(winter ceremonial variant)',Eevee:'H[shiny][xxl](female)',Squirtle:'H[lucky][shiny][xxl]'}});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});const rows=page.locator('#combined-list .wants-row');await expect(rows).toHaveCount(5);
      const tauros=page.locator('.wants-row[data-name="P-Tauros (Combat)"]');await tauros.hover();await expect(tauros.locator('.wants-name')).not.toHaveAttribute('title');
      await expect(page.locator('#combined-editor-modal')).toBeHidden();
      await expect(page.locator('.wants-row[data-name="Squirtle"] .myrow-trait')).toHaveCount(3);
      const geometry=await rows.evaluateAll(nodes=>nodes.map(row=>{const name=row.querySelector('.myrow-copy').getBoundingClientRect(),actions=row.querySelector('.mctrl').getBoundingClientRect(),sprite=row.querySelector('.myrow-sprite-wrap').getBoundingClientRect();return{right:name.right,actions:actions.left,sprite:sprite.width,targets:[...row.querySelectorAll('.mctrl button')].map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))};}));
      for(const g of geometry){expect(g.right).toBeLessThanOrEqual(g.actions+1);expect(g.sprite).toBeGreaterThanOrEqual(32);expect(g.targets.every(t=>t.w>=(width<=600?44:40)&&t.h>=44)).toBe(true);}await noOverflow(page);
    }
    const row=page.locator('.wants-row[data-name="Oricorio (Pom-Pom)"]');await row.locator('.myrow-edit').click();await expect(page.locator('#combined-mod')).toHaveValue('winter ceremonial variant');
    await page.locator('#combined-mod').fill('winter ceremonial variant updated');await currentSave(page);await expect(row).toContainText('winter ceremonial variant updated');
    await currentFind(page);await page.locator('#combined-filter').fill('P-Tauros');await expect(page.locator('.wants-row')).toHaveCount(1);await page.keyboard.press('Escape');await expect(page.locator('.wants-row')).toHaveCount(5);

  });

  test('background qualifier picker, matching, product surfaces, and exports stay coherent',async({page})=>{

    // Background selection/display was retired before this branch. Retain the
    // meaningful contract: existing exact background data must survive edits.
    const background='location-gofestnewyorkcity';
    await currentList(page,{wishlist:{Rayquaza:'M[shiny][bg:'+background+']',Necrozma:'H[bg:location-nationaltrustfountainsabbeyestate]'}});
    const before=await editorFixture.entities(page);
    await page.locator('.wants-row[data-name="Rayquaza"] .myrow-edit').click();
    await expect(page.locator('#combined-editor-modal [data-background-id],#background-picker-modal:visible')).toHaveCount(0);
    await currentSave(page);expect(await editorFixture.entities(page)).toEqual(before);
    await page.locator('.wants-row[data-name="Rayquaza"] .myrow-edit').click();await editorFixture.priority(page,'H');await currentSave(page);
    const after=await editorFixture.entities(page),old=before.find(e=>e.values.backgroundId===background),changed=after.find(e=>e.entityId===old.entityId);
    expect(changed.values).toEqual({...old.values,priority:'H'});
    // Exact matching remains data-level behavior although no active picker is offered.
    expect(await page.evaluate(background=>({same:PogoDomain.priorityValues.matchesTradeIntent({shiny:true,backgroundId:background},{shiny:true,backgroundId:background}),different:PogoDomain.priorityValues.matchesTradeIntent({shiny:true,backgroundId:background},{shiny:true,backgroundId:'location-gofestosaka'})}),background)).toEqual({same:true,different:false});
    for(const width of [1440,430,390,320]){await page.setViewportSize({width,height:900});await noOverflow(page);}

  });

  test('My List priority groups preserve accessible collapse state across mobile rerenders',async({page})=>{
    await currentList(page);
    for(const width of [1440,430,390,375,320]){
      await page.setViewportSize({width,height:900});
      const high=page.locator('#combined-list > [data-wants-section="H"]'),medium=page.locator('#combined-list > [data-wants-section="M"]');
      await high.locator('.mylist-priority-toggle').focus();await page.keyboard.press('Space');await expect(high.locator('.mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');await expect(high.locator('.mylist-priority-body')).toBeHidden();
      await currentFind(page);await page.locator('#combined-filter').fill('Pikachu');await page.keyboard.press('Escape');await expect(high.locator('.mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');
      await medium.locator('.mylist-priority-toggle').click();await editorFixture.addDialog(page,'Squirtle');await editorFixture.priority(page,'M');await currentSave(page);
      await expect(medium.locator('.mylist-priority-toggle')).toHaveAttribute('aria-expanded','true');await expect(medium.locator('[data-name="Squirtle"]')).toBeVisible();await expect(high.locator('.mylist-priority-toggle')).toHaveAttribute('aria-expanded','false');await noOverflow(page);
      await high.locator('.mylist-priority-toggle').click();await medium.locator('[data-name="Squirtle"] .myrow-edit').click();await page.locator('#wants-remove').click();await editorFixture.settled(page);
    }

  });

  test('Special Trade Board keeps complete controls touch-safe on compact screens',async({page})=>{

    const board={lf:[{name:'Oricorio (Pom-Pom)',dn:'Oricorio (Pom-Pom)',no:741,shiny:true,mirror:true,note:'long-distance trade'}],ft:[{name:'Pikachu',dn:'Pikachu',no:25,shiny:true,note:'untouched offering',qty:12}]};
    await currentList(page,{wishlist:{Rotom:'H'}},{specialTradeBoard:board});const before=await editorFixture.entities(page);
    await currentShare(page,'image');await page.locator('#share-image-board').check();
    for(const [width,height]of [[1440,900],[430,932],[390,844],[375,812],[320,568]]){
      await page.setViewportSize({width,height});await expect(page.locator('#product-share-primary')).toBeInViewport();await expect(page.locator('#product-share-count')).toHaveText('2 wants');
      await expect(page.locator('#share-scope-full')).toBeChecked();await noOverflow(page);
      for(const selector of ['.share-close','#product-share-primary','#product-share-options .share-choice'])for(const el of await page.locator(selector).all()){const box=await el.boundingBox();if(box){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}}
    }
    await page.keyboard.press('Escape');expect(await editorFixture.entities(page)).toEqual(before);expect(await page.evaluate(()=>__editorFixture.remote.users.LocalTrainer.specialTradeBoard)).toEqual(board);

  });

  test('My List Variant details uses the canonical dark input treatment',async({page})=>{
    await currentList(page);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});await editorFixture.addDialog(page,'Rotom');await page.locator('#combined-close').focus();await page.mouse.move(0,0);
      const details=page.locator('#combined-mod'),reference=page.locator('#combined-name');await expect(details).toHaveClass(/field-control/);
      const styles=async locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return{background:s.backgroundColor,color:s.color,border:s.borderColor,radius:s.borderRadius,minHeight:s.minHeight};});
      // Compare both current states; freezing the reference during its blur
      // transition makes the expected color an unreachable intermediate value.
      await expect.poll(async()=>JSON.stringify(await styles(details))===JSON.stringify(await styles(reference))).toBe(true);await details.fill('winter costume');await expect(details).toHaveValue('winter costume');
      for(const input of [details,reference]){await input.focus();await expect(input).toBeFocused();await expect.poll(()=>input.evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');}
      await noOverflow(page);await page.keyboard.press('Escape');
    }

  });

  test('My List groups unprioritized collection goals into exact Dex sections',async({page})=>{
    await currentList(page,{wishlist:{Pikachu:'H[lucky]',Eevee:'[lucky]',Bulbasaur:'[shiny]',Charmander:'[xxl]',Squirtle:'[xxs]',Psyduck:'[lucky][shiny][xxl]',Rotom:'(legacy note)'}});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      const expected={H:'Pikachu',LUCKY:'Eevee',SHINY:'Bulbasaur',XXL:'Charmander',XXS:'Squirtle','LUCKY+SHINY+XXL':'Psyduck',NEEDS_PRIORITY:'Rotom'};
      for(const [key,name]of Object.entries(expected)){const section=page.locator('#combined-list > [data-wants-section="'+key+'"]');await expect(section.locator('.wants-row')).toHaveCount(1);await expect(section.locator('.wants-name')).toHaveText(name);}
      await expect(page.locator('.wants-row')).toHaveCount(7);
      await page.locator('.wants-row[data-name="Psyduck"] .myrow-edit').click();await page.locator('#combined-mod').fill('updated variant');await currentSave(page);
      const entries=await page.evaluate(()=>productDeclarations().entries);expect(entries).toHaveLength(7);expect(entries.find(e=>e.name==='Psyduck')).toMatchObject({p:'',lucky:true,shiny:true,xxl:true,mod:'updated variant'});
      await expect(page.locator('.wants-row[data-name="Psyduck"]')).toHaveCount(1);await noOverflow(page);
    }

  });

  test('My List category counts and empty context remain unmistakable and state-safe',async({page})=>{

    await currentList(page,{wishlist:{Pikachu:'H',Rotom:'M'},dynamax:{Bulbasaur:'H'},gmax:{Charizard:'L'},costumes:{'Pikachu (Worlds 2025)':'M'}});
    const before=await editorFixture.entities(page);
    for(const [width,height]of [[320,640],[375,700],[390,420],[390,300],[430,760],[768,800],[1024,800],[1440,900]]){
      await page.setViewportSize({width,height});await expect(page.locator('.wants-row')).toHaveCount(5);
      // The combined list has one section hierarchy; categories stay on entries.
      await expect(page.locator('.mylist-type-tabs:visible')).toHaveCount(0);
      await expect(page.locator('#combined-list > [data-wants-section="H"] .wants-row')).toHaveCount(2);
      await expect(page.locator('#combined-list > [data-wants-section="M"] .wants-row')).toHaveCount(2);
      await expect(page.locator('#combined-list > [data-wants-section="L"] .wants-row')).toHaveCount(1);
      await currentFind(page);await page.locator('#combined-filter').fill('No matching want');await expect(page.locator('.wants-row')).toHaveCount(0);
      await page.keyboard.press('Escape');await expect(page.locator('.wants-row')).toHaveCount(5);await noOverflow(page);
    }
    expect((await page.evaluate(()=>productDeclarations().entries.map(e=>e.category))).sort()).toEqual(['costumes','dynamax','gmax','wishlist','wishlist']);expect(await editorFixture.entities(page)).toEqual(before);

  });

  test('authenticated My List fixture preserves every category through CSV export',async({page})=>{

    await currentList(page,{wishlist:{Pikachu:'H',Rotom:'M'},dynamax:{Bulbasaur:'H'},gmax:{Charizard:'L'},costumes:{'Pikachu (Worlds 2025)':'M'}});
    const before=await editorFixture.entities(page),writes=await page.evaluate(()=>[...__editorFixture.writes]);
    await currentFind(page);await page.locator('#combined-filter').fill('No matching want');await expect(page.locator('.wants-row')).toHaveCount(0);
    await currentShare(page);await page.locator('#share-text-csv').check();await expect(page.locator('[name=share-scope]')).toHaveCount(0);
    const csv=await page.locator('.share-text-preview').textContent();
    for(const name of ['Pikachu','Rotom','Bulbasaur','Charizard','Worlds 2025'])expect(csv).toContain(name);
    await page.evaluate(()=>{window.__csvDownload=null;downloadBlob=async(blob,filename)=>{window.__csvDownload={text:await blob.text(),filename};};});
    await page.locator('#product-share-primary').click();await expect.poll(()=>page.evaluate(()=>__csvDownload)).toEqual({text:csv,filename:'pogo-localtrainer-wants.csv'});
    await page.keyboard.press('Escape');await expect(page.locator('#combined-filter')).toHaveValue('No matching want');expect(await editorFixture.entities(page)).toEqual(before);expect(await page.evaluate(()=>__editorFixture.writes)).toEqual(writes);
    await page.locator('#combined-filter').focus();await page.keyboard.press('Escape');await expect(page.locator('.wants-row')).toHaveCount(5);

  });

  test('My List priority searches remain adjacent, collapsed, localized, and responsive',async({page})=>{

    await currentList(page,{wishlist:{Pikachu:'H',Eevee:'M',Bulbasaur:'L',Charmander:'[lucky]',Squirtle:'[shiny]',Psyduck:'[xxl]',Rotom:'[xxs]'}});
    const before=await editorFixture.entities(page);
    await page.evaluate(()=>{window.__sectionCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>__sectionCopies.push(text)}});});
    for(const [width,height]of [[320,640],[375,700],[390,420],[390,300],[430,760],[768,800],[1024,800],[1440,900]]){
      await page.setViewportSize({width,height});
      for(const key of ['H','M','L','LUCKY','SHINY','XXL','XXS']){
        const section=page.locator('#combined-list > [data-wants-section="'+key+'"]'),copy=section.locator('[data-contextual-copy]');await expect(copy).toHaveCount(1);await expect(copy).toHaveText('Copy search string');
        await expect(section.locator('.contextual-details')).toBeHidden();const command=await copy.getAttribute('data-contextual-copy');expect(command).not.toBe('');
        await copy.click();expect(await page.evaluate(()=>__sectionCopies.at(-1))).toBe(command);
      }
      await noOverflow(page);
    }
    for(const locale of ['ja','de']){await currentLocale(page,locale);await expect(page.locator('#combined-list > section [data-contextual-copy]')).toHaveCount(7);await noOverflow(page);}
    expect(await editorFixture.entities(page)).toEqual(before);

  });

  test('translated active UI has no horizontal overflow at representative widths',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?locale-layout=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForSettingsStartupReady(page);
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
      await page.waitForFunction(() => typeof window.__pogoEnsureFullApp === 'function');
      await page.evaluate(() => window.__pogoEnsureFullApp('visual-trainer-suggestions-fixture'));
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

  test('trainer discovery search always settles and all discovery rows retain navigation ownership',async({page})=>{
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`./?trainer-terminal-navigation=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'DiscoveryViewer',uid:'uid-discovery-viewer'});
    await page.evaluate(async()=>{
      const favorites=[{key:'mazer',displayName:'Mazer',tagIds:[],createdAt:1,updatedAt:1},{key:'maze-runner',displayName:'MazeRunner',tagIds:[],createdAt:2,updatedAt:2}];
      const recent=[{key:'recent-one',displayName:'RecentOne',openedAt:Date.now()-60000}];
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-discovery-viewer',username:'DiscoveryViewer'},favorites,recent,snapshots:{},tags:{},syncState:'local-only',migration:{skippedFavorites:0,skippedRecents:0}};
      ensureTrainerHistoryStore=()=>({read:()=>state,filterFavorites:({query=''})=>favorites.filter(item=>item.displayName.toLowerCase().includes(query.toLowerCase())),snapshotFor:()=>null,updateCanonicalName:()=>false});
      allData=normalizeData({users:{DiscoveryViewer:{},Mazer:{},MazeRunner:{},RecentOne:{},BetaTrainer:{}},wishlist:{},dynamax:{},gmax:{},costumes:{}});
      allData.loginDirectory={Mazer:{},MazeRunner:{},RecentOne:{},BetaTrainer:{}};
      switchTab('find',{render:false});renderFindTrainer();await renderTrainerQuickLists();
      window.__openedTrainer='';openTrainerPublicShare=async value=>{window.__openedTrainer=value;};
    });
    const input=page.locator('#find-trainer-input'),status=page.locator('#find-trainer-status');
    await capturePass3(page,'trainer-discovery-idle-1440x900');
    await input.fill('Mazer');
    await expect(page.locator('.trainer-suggestion')).toHaveCount(2);
    await expect(page.locator('.trainer-suggestion-name').first()).toHaveText('Mazer');
    await expect(status).not.toContainText(/Searching/i);
    await expect(status).toContainText(/exact/i);
    await capturePass3(page,'trainer-discovery-exact-1440x900');
    await input.fill('Maze');
    await expect(page.locator('.trainer-suggestion')).toHaveCount(2);
    await expect(status).not.toContainText(/Searching/i);
    await capturePass3(page,'trainer-discovery-partial-1440x900');
    await input.fill('Nobody');
    await expect(page.locator('#find-trainer-recovery')).toBeVisible();
    await expect(status).not.toContainText(/Searching/i);
    await capturePass3(page,'trainer-discovery-empty-1440x900');
    await page.evaluate(()=>{window.__trainerSuggestionOptions=trainerSuggestionOptions;trainerSuggestionOptions=()=>{throw new Error('fixture_failure');};});
    await input.fill('Error');
    await expect(page.locator('#find-trainer-retry')).toBeVisible();
    await expect(status).not.toContainText(/Searching/i);
    await capturePass3(page,'trainer-discovery-error-1440x900');
    await page.evaluate(()=>{trainerSuggestionOptions=window.__trainerSuggestionOptions;const input=document.getElementById('find-trainer-input');input.value='Maze';queueTrainerSuggestions('Maze');input.value='Beta';queueTrainerSuggestions('Beta');});
    await expect(page.locator('.trainer-suggestion')).toHaveCount(1);
    await expect(page.locator('.trainer-suggestion-name')).toHaveText('BetaTrainer');
    await expect(status).not.toContainText(/Searching/i);

    const expectOpen=async(locator,name)=>{await page.evaluate(()=>{window.__openedTrainer='';});await locator.click();await expect.poll(()=>page.evaluate(()=>window.__openedTrainer)).toBe(name);};
    await input.fill('Mazer');await expect(page.locator('.trainer-suggestion')).toHaveCount(2);
    await expectOpen(page.locator('.trainer-suggestion').first(),'Mazer');
    await expectOpen(page.locator('.trainer-favorites-preview-row').first(),'Mazer');
    await expectOpen(page.locator('.recent-trainer-row').first(),'RecentOne');
    await page.locator('[data-discovery-mode="favorites"]').click();
    await expectOpen(page.locator('.favorite-card-primary').first(),'Mazer');
  });

  test('trainer profile shell appears before a delayed public read and stays within the interaction budget',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(`./?trainer-profile-shell=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'ProfileViewer',uid:'uid-profile-viewer'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{ProfileViewer:{}},wishlist:{},dynamax:{},gmax:{},costumes:{}});
      allData.loginDirectory={SlowTrainer:{ready:true}};
      requireCompatibleTrainerSearch=()=>true;
      loadPublicShareData=()=>new Promise(resolve=>{window.__resolveSlowTrainerProfile=resolve;});
      window.__slowTrainerOpen=openTrainerPublicShare('SlowTrainer');
    });
    await expect(page.locator('#share-view')).toHaveClass(/active/);
    await expect(page.locator('#share-hdr')).toContainText('SlowTrainer');
    await expect(page.locator('#share-list-out .ui-state-loading')).toBeVisible();
    const timing=await page.evaluate(()=>({
      shellAt:window.__pogoTrainerProfileShellAt,
      duration:performance.getEntriesByName('pogo:trainer-profile-shell').at(-1)?.duration??Infinity,
      pending:typeof window.__resolveSlowTrainerProfile==='function'
    }));
    expect(timing.pending).toBe(true);
    expect(timing.shellAt).toBeGreaterThan(0);
    expect(timing.duration).toBeLessThanOrEqual(150);
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    await page.evaluate(async()=>{window.__resolveSlowTrainerProfile({ok:false,status:'not_published'});await window.__slowTrainerOpen;});
    await expect(page.locator('#share-list-out')).toContainText(/not published|unavailable/i);
  });

  test('trainer discovery keeps exact intent first and shows reciprocal hierarchy on mobile',async({page})=>{
    await page.setViewportSize({width:320,height:568});
    await page.goto(`./?trainer-ranking-ui=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'Viewer',uid:'uid-viewer'});
    await page.evaluate(()=>{
      allData=normalizeData({
        users:{Viewer:{specialTradeBoard:{lf:[],ft:[{name:'Pikachu',dn:'Pikachu',no:25}]}},Alpha:{specialTradeBoard:{lf:[],ft:[]}},AlphaFriendWithAVeryLongHandle:{specialTradeBoard:{lf:[],ft:[]}}},loginDirectory:{Alpha:{},AlphaFriendWithAVeryLongHandle:{}},
        wishlist:{Viewer:{Mew:'H'},Alpha:{Pikachu:'H'},AlphaFriendWithAVeryLongHandle:{Pikachu:'H',Eevee:'M'}},dynamax:{},gmax:{},costumes:{}
      });
      switchTab('find',{render:false});renderFindTrainer();
    });
    const input=page.locator('#find-trainer-input');await input.fill('Alpha');
    await expect(page.locator('.trainer-suggestion')).toHaveCount(2);
    await expect(page.locator('.trainer-suggestion').first().locator('.trainer-suggestion-name')).toHaveText('Alpha');
    await capturePass3(page,'trainer-discovery-ranking-320x568');
    await page.evaluate(()=>{selectedTrainerRuntime={username:'Alpha',publicData:normalizeData({users:{Alpha:{specialTradeBoard:{lf:[],ft:[]}}},wishlist:{Alpha:{Pikachu:'H'}}})};document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');renderShareView('Alpha','wishlist');});
    await expect(page.locator('.share-match-overview')).toBeVisible();
    await expect(page.locator('.share-match-metric').nth(0)).toContainText('Both Want');
    await expect(page.locator('.share-match-metric').nth(0).locator('strong')).toHaveText('0');
    await expect(page.locator('.share-match-metric').nth(1)).toContainText('Only I Want');
    await expect(page.locator('.share-match-metric').nth(1).locator('strong')).toHaveText('1');
    await expect(page.locator('.share-match-metric').nth(2)).toContainText('Only Alpha Wants');
    await expect(page.locator('.share-match-metric').nth(2).locator('strong')).toHaveText('1');
    const scenarios=await page.evaluate(()=>{
      const target='TrainerWithAnExceptionallyLongHandle123',wants=names=>Object.fromEntries(names.map(name=>[name,'H']));
      const render=(theirWants,myWants)=>{
        allData=normalizeData({users:{Viewer:{specialTradeBoard:{lf:[],ft:[]}},[target]:{specialTradeBoard:{lf:[],ft:[]}}},wishlist:{Viewer:wants(myWants),[target]:wants(theirWants)},dynamax:{},gmax:{},costumes:{}});
        selectedTrainerRuntime={username:target,publicData:normalizeData({users:{[target]:{specialTradeBoard:{lf:[],ft:[]}}},wishlist:{[target]:wants(theirWants)}})};
        renderShareView(target,'wishlist');return[...document.querySelectorAll('.share-match-metric')].map(node=>({value:node.querySelector('strong')?.textContent||'',label:node.querySelector('span')?.textContent||'',status:node.querySelector('small')?.textContent||''}));
      };
      const shared=Array.from({length:14},(_,index)=>`Shared${index}`),mineOnly=Array.from({length:12},(_,index)=>`Mine${index}`),theirsOnly=Array.from({length:10},(_,index)=>`Theirs${index}`);
      return{none:render([],[]),mine:render([],['Mew']),theirs:render(['Pikachu'],[]),bothLarge:render([...shared,...theirsOnly],[...shared,...mineOnly])};
    });
    expect(scenarios.none).toEqual([]);
    expect(scenarios.mine).toEqual([{value:'0',label:'Both Want',status:''},{value:'1',label:'Only I Want',status:''},{value:'0',label:'Only TrainerWithAnExceptionallyLongHandle123 Wants',status:''}]);
    expect(scenarios.theirs).toEqual([{value:'0',label:'Both Want',status:''},{value:'0',label:'Only I Want',status:''},{value:'1',label:'Only TrainerWithAnExceptionallyLongHandle123 Wants',status:''}]);
    expect(scenarios.bothLarge).toEqual([{value:'14',label:'Both Want',status:''},{value:'12',label:'Only I Want',status:''},{value:'10',label:'Only TrainerWithAnExceptionallyLongHandle123 Wants',status:''}]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await capturePass3(page,'trainer-discovery-profile-320x568');
  });

  test('comparison copy activates each exact section once, preserves the dialog, and recovers clipboard denial',async({page,browserName})=>{
    await currentList(page,{wishlist:{Pikachu:'H',Eevee:'M'}});
    await openSyntheticPublic(page,'ComparisonPartner',{wishlist:{Pikachu:'L',Squirtle:'H'}});
    const trigger=page.getByRole('button',{name:/Compare with My List/i});
    await trigger.focus();await page.keyboard.press('Enter');
    const modal=page.locator('#trade-match-modal'),close=modal.locator('.diff-hdr-close');
    await expect(close).toBeFocused();
    const before=await page.evaluate(()=>({remote:structuredClone(__editorFixture.remote),writes:[...__editorFixture.writes],share:_activeShareView.username}));
    await page.evaluate(()=>{
      window.__comparisonProbe={calls:[],deny:false,backgroundClicks:0};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
        __comparisonProbe.calls.push(value);
        if(__comparisonProbe.deny)throw new DOMException('Synthetic clipboard denial','NotAllowedError');
      }}});
      for(const id of ['app','share-view'])document.getElementById(id).addEventListener('click',()=>__comparisonProbe.backgroundClicks++);
    });
    const protection='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&';
    // Match the existing cross-browser native button navigation convention;
    // WebKit's Option-Tab includes buttons without changing browser preferences.
    const keyboardTab=browserName==='webkit'?'Alt+Tab':'Tab';
    const expected=[];
    for(const [section,dex]of [['both','25'],['mine','133'],['theirs','7']]){
      const panel=modal.locator('.diff-match-box.'+section),button=panel.locator('[data-contextual-copy]');
      const command=protection+dex;
      await expect(button).toHaveAttribute('data-contextual-copy',command);
      for(const activation of ['button','icon','text','Enter','Space']){
        if(activation==='button')await button.click();
        else if(activation==='icon')await button.locator('svg').click();
        else if(activation==='text')await button.locator('.contextual-copy-label').click();
        else{
          // Reach the real native button through the modal's Tab order.
          const cycle=await modal.locator('button,summary,textarea').count();
          for(let i=0;i<=cycle&&!await button.evaluate(el=>el===document.activeElement);i++)await page.keyboard.press(keyboardTab);
          await expect(button).toBeFocused();await page.keyboard.press(activation);
        }
        expected.push(command);
        await expect(panel.locator('.contextual-copy-status')).toHaveClass(/is-success/);
        expect(await page.evaluate(()=>__comparisonProbe.calls)).toEqual(expected);
        await expect(modal).toBeVisible();await expect(page.locator('#combined-editor-modal')).toBeHidden();
      }
      // Denial is a real rejected clipboard promise: exact manual text and focus,
      // not a forged status or a direct invocation of the shared handler.
      await page.evaluate(()=>{__comparisonProbe.deny=true;});await button.locator('svg').click();expected.push(command);
      const field=panel.locator('textarea');
      await expect(panel.locator('.contextual-copy-status')).toHaveClass(/is-error/);
      await expect(panel.locator('.contextual-copy-status')).toHaveText('Copy failed. Select the text manually.');
      await expect(field).toBeVisible();await expect(field).toHaveValue(command);await expect(field).toBeFocused();
      expect(await field.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd}))).toEqual({start:0,end:command.length});
      expect(await page.evaluate(()=>__comparisonProbe.calls)).toEqual(expected);
      await page.evaluate(()=>{__comparisonProbe.deny=false;});await button.click();expected.push(command);
      await expect(panel.locator('.contextual-copy-status')).toHaveClass(/is-success/);
      expect(await page.evaluate(()=>__comparisonProbe.calls)).toEqual(expected);
      await expect(modal).toBeVisible();
    }
    await modal.locator('#trade-match-title').click();await expect(modal).toBeVisible();
    expect(await page.evaluate(()=>__comparisonProbe.backgroundClicks)).toBe(0);
    expect(await page.evaluate(()=>({remote:structuredClone(__editorFixture.remote),writes:[...__editorFixture.writes],share:_activeShareView.username}))).toEqual(before);
    // Wrapping Tab/Shift+Tab stays within this dialog.
    await close.click();await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');await expect(close).toBeFocused();await page.keyboard.press('Shift+Tab');
    await expect(modal.getByRole('button',{name:'Edit My List',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');await expect(close).toBeFocused();
    const backdropPoint={x:2,y:2};
    expect(await page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.id,backdropPoint)).toBe('trade-match-modal');
    await page.mouse.click(backdropPoint.x,backdropPoint.y);await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();
    expect(await page.evaluate(()=>__comparisonProbe.backgroundClicks)).toBe(2); // Only the two deliberate trigger reopens.
  });

  test('wanted-list comparison preserves qualifiers, rejects gender mismatch, and refreshes after My List edits',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const them='TrainerWithAnExceptionallyLongHandle123',nyc='location-gofestnewyorkcity',osaka='location-gofestosaka';
    const legacy={lf:[],ft:[{name:'Pikachu',dn:'Pikachu',no:25,shiny:true,backgroundId:osaka,mirror:false,qty:26}]};
    await currentList(page,{wishlist:{Mewtwo:'H[shiny][bg:'+nyc+']',Heracross:'M(F)'}},{specialTradeBoard:legacy});
    const theirs={Mewtwo:'L[shiny][bg:'+nyc+']',Heracross:'H(M)',Pikachu:'L[shiny][bg:'+osaka+']'};
    await openSyntheticPublic(page,them,{wishlist:theirs});
    await page.getByRole('button',{name:/Compare with My List/i}).click();
    const modal=page.locator('#trade-match-modal');await expect(modal).toBeVisible();await expect(modal).toHaveAttribute('aria-labelledby','trade-match-title');
    await expect(modal.locator('.diff-match-box.both .diff-match-chip')).toHaveCount(1);await expect(modal.locator('.diff-match-box.both')).toContainText('Mewtwo');await expect(modal.locator('.diff-match-box.both')).toContainText('Shiny');await expect(modal.locator('.diff-match-box.both')).not.toContainText('Heracross');
    await expect(modal.locator('.diff-match-box.theirs')).toContainText('Pikachu');await expect(modal.locator('.diff-match-box.theirs')).toContainText('Shiny');await expect(modal.locator('.diff-match-box.mine')).toContainText('Heracross');
    await expect(modal.locator('.diff-match-qty')).toHaveCount(0);
    for(const [group,count]of [['both','1'],['mine','1'],['theirs','2']])await expect(modal.locator('.diff-match-box.'+group+' .diff-match-count')).toHaveText(count);
    const copies=modal.locator('[data-contextual-copy]');await expect(copies).toHaveCount(3);
    const commands=await copies.evaluateAll(nodes=>nodes.map(n=>n.dataset.contextualCopy));
    expect(commands.every(value=>value&&value.includes('!background')&&!/New York|Osaka|location-gofest|bg:/i.test(value))).toBe(true);
    await page.evaluate(()=>{window.__comparisonCopy='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>__comparisonCopy=text}});});
    await page.evaluate(()=>{window.__comparisonEvents=[];document.addEventListener('click',e=>{if(e.target.closest('[data-contextual-copy]'))__comparisonEvents.push('document-capture');},true);document.addEventListener('click',e=>{if(e.target.closest('[data-contextual-copy]'))__comparisonEvents.push('document-bubble');});});
    await copies.first().click();
    await test.info().attach('comparison-copy-boundary',{body:Buffer.from(JSON.stringify(await page.evaluate(()=>({url:location.href,events:__comparisonEvents,clipboard:__comparisonCopy,dialogClick:document.querySelector('#trade-match-modal .diff-modal').getAttribute('onclick')})),null,2)),contentType:'application/json'});
    await expect.poll(()=>page.evaluate(()=>__comparisonCopy)).toBe(commands[0]);
    expect(await modal.locator('.diff-match-chip[title]').evaluateAll(nodes=>nodes.every(n=>!/[×x]\d+/i.test(n.title)))).toBe(true);
    // Retired background badges are not the current matching UI, but saved
    // legacy fields and FT offerings must survive an actual unrelated edit.
    await page.getByRole('button',{name:'Edit My List'}).click();await expect(page.locator('#trade-return-banner')).toBeVisible();
    await editorFixture.edit(page,'Heracross');await page.locator('#combined-gender').selectOption('m');await currentSave(page);
    await page.getByRole('button',{name:'Return to comparison'}).click();await expect(modal.locator('.diff-match-box.both')).toContainText('Heracross');await expect(modal.locator('.diff-match-box.both .diff-match-count')).toHaveText('2');
    expect(await page.evaluate(()=>__editorFixture.remote.users.LocalTrainer.specialTradeBoard)).toEqual(legacy);
    expect(await page.evaluate(()=>allData.wishlist.LocalTrainer.Mewtwo)).toContain('[bg:'+nyc+']');
    // Use selectable entries for expansion rather than assuming a complete
    // national-dex Add catalog (Kakuna correctly left validation open).
    const names=['Bulbasaur','Ivysaur','Venusaur','Charmander','Charmeleon','Charizard','Squirtle','Wartortle','Blastoise','Caterpie','Metapod','Butterfree','Weedle','Relicanth','Arrokuda','Pidgey'];
    await page.getByRole('button',{name:'Edit My List'}).click();
    for(const name of names){
      await page.locator('#wants-add-name').fill(name);
      if(await page.locator('[data-wants-add-priority=H]').getAttribute('aria-pressed')!=='true')await page.locator('[data-wants-add-priority=H]').click();
      await page.locator('.wants-add-form').getByRole('button',{name:'Add',exact:true}).click();
      await expect(page.locator('#combined-editor-modal')).toBeHidden();await expect(page.locator('#wants-add-name')).toHaveValue('');await editorFixture.settled(page);
    }
    // Add resolves these names to their actual catalog categories, including
    // Max entries. The other trainer's synthetic public lists must describe
    // those same identities, not silently recast every name as ordinary.
    const added=await page.evaluate(names=>productDeclarations().entries.filter(entry=>names.includes(entry.name)).map(({name,type,p})=>({name,type,p})),names);
    expect(added.map(entry=>entry.name).sort()).toEqual([...names].sort());expect(added.every(entry=>entry.p==='H')).toBe(true);
    const publicLists={wishlist:{...theirs},dynamax:{},gmax:{},costumes:{}};
    for(const entry of added)publicLists[entry.type][entry.name]='H';
    // Change only the synthetic public service, then reopen via actual search.
    await openSyntheticPublic(page,them,publicLists);await page.getByRole('button',{name:/Compare with My List/i}).click();
    await expect(modal.locator('.diff-match-box.both .diff-match-count')).toHaveText('18');await expect(modal.locator('.diff-match-box.both .diff-match-more')).toBeVisible();
    const more=modal.locator('.diff-match-box.both .diff-match-more');
    await expect(more).toHaveAttribute('aria-expanded','false');await more.click();await expect(more).toHaveAttribute('aria-expanded','true');
    await expect(modal.locator('.diff-match-box.both article.diff-match-chip:visible')).toHaveCount(18);await expect(modal).toBeVisible();
    for(const viewport of [{width:1440,height:900},{width:430,height:932},{width:375,height:812},{width:320,height:568}]){
      await page.setViewportSize(viewport);await expect(modal).toBeVisible();await noOverflow(page);
      for(const button of await modal.locator('button').all()){const box=await button.boundingBox();if(box)expect(box.height).toBeGreaterThanOrEqual(44);}
    }
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await noOverflow(page);
  });

  test('trainer discovery mode switching preserves the visible search shell and active mode',async({page})=>{
    await page.goto(`./?trainer-mode-scroll=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'DiscoveryScrollTester',uid:'uid-discovery-scroll'});
    await page.evaluate(()=>{
      allData=normalizeData({users:{DiscoveryScrollTester:{},TrainerAlpha:{},TrainerBeta:{}},wishlist:{TrainerAlpha:{Pikachu:'H'},TrainerBeta:{Eevee:'M'}},dynamax:{},gmax:{},costumes:{}});
      switchTab('find',{render:false});renderFindTrainer();
      document.querySelectorAll('[data-discovery-panel]').forEach(panel=>{panel.style.minHeight='1100px';});
    });
    const viewports=[{width:1728,height:1000},{width:1440,height:900},{width:430,height:932},{width:390,height:844},{width:375,height:812},{width:320,height:568}];
    for(const viewport of viewports){
      await page.setViewportSize(viewport);
      const searchGeometry=[];
      for(const [mode,keyboard] of [['favorites',true],['pokemon',false],['trainers',false]]){
        const button=page.locator(`[data-discovery-mode="${mode}"]`);
        await button.focus();
        await page.evaluate(()=>{const nav=document.querySelector('.trainer-discovery-modes');window.scrollTo(0,Math.max(0,scrollY+nav.getBoundingClientRect().top-Math.round(innerHeight*.2)));});
        const before=await page.evaluate(()=>scrollY);
        if(keyboard)await page.keyboard.press('Enter');else await button.click();
        await expect(button).toHaveAttribute('aria-selected','true');
        await expect(button).toHaveAttribute('aria-current','true');
        await expect(page.locator('.trainer-discovery-modes [aria-current="true"]')).toHaveCount(1);
        await page.waitForTimeout(80);
        const after=await page.evaluate(()=>scrollY);
        expect(Math.abs(after-before)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
        if(mode==='trainers')await expect(page.locator('#find-trainer-input')).toBeFocused();
        if(mode==='pokemon')await expect(page.locator('#favorite-browse-input')).toBeFocused();
        const selector=mode==='trainers'?'#find-trainer-input':mode==='favorites'?'#favorite-trainer-search':'#favorite-browse-input';
        searchGeometry.push({mode,box:await page.locator(selector).boundingBox()});
        await capturePass3(page,`trainer-discovery-${mode}-${viewport.width}x${viewport.height}`);
      }
      const reference=searchGeometry[0].box;
      for(const item of searchGeometry.slice(1)){
        const geometry=JSON.stringify(searchGeometry);
        expect(Math.abs(item.box.x-reference.x),geometry).toBeLessThanOrEqual(1);
        expect(item.box.width,geometry).toBeGreaterThan(200);expect(item.box.x+item.box.width,geometry).toBeLessThanOrEqual(reference.x+reference.width+1);
        expect(item.box.height,geometry).toBe(48);expect(item.box.y,geometry).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('trainer landing keeps search primary and shortcut sections balanced at every supported width',async({page})=>{
    await page.goto(`./?trainer-landing-layout=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await isolateAuthenticatedMyListFixture(page,{username:'DiscoveryLayoutTester',uid:'uid-discovery-layout'});
    await openMainTab(page,'find');
    await page.evaluate(async()=>{
      const now=Date.now();
      const favorites=['Ghyslaine','Irreneilable','ScoopskiPotat0','Zinniaxp'].map((displayName,index)=>({key:displayName.toLowerCase(),displayName,tagIds:[],createdAt:index+1,updatedAt:index+1}));
      const recent=['Mazer','TrainerWithAnExceptionallyLongHandle123','KantoFriend','RaidPlanner','TradeBuddy'].map((displayName,index)=>({key:displayName.toLowerCase(),displayName,openedAt:now-index*3600000}));
      const state={version:3,schemaVersion:3,migrationVersion:3,owner:{uid:'uid-discovery-layout',username:'DiscoveryLayoutTester'},favorites,recent,snapshots:{},tags:{},syncState:'synced',migration:{skippedFavorites:0,skippedRecents:0}};
      const store={read:()=>state,filterFavorites:()=>state.favorites,favoriteFor:value=>state.favorites.find(item=>item.displayName===value)||null,updateCanonicalName:()=>false,snapshotFor:()=>null};
      ensureTrainerHistoryStore=()=>store;
      setTrainerDiscoveryMode('trainers');
      await renderTrainerQuickLists();
    });
    const viewports=[{width:1728,height:1000},{width:1440,height:900},{width:1280,height:800},{width:1024,height:768},{width:768,height:900},{width:430,height:932},{width:390,height:844},{width:375,height:812},{width:320,height:568}];
    for(const viewport of viewports){
      await page.setViewportSize(viewport);
      await page.evaluate(theme=>applyTheme(theme),viewport.width<900?'dark':'light');
      await expect(page.locator('#find-trainer-input')).toBeVisible();
      await expect(page.locator('.trainer-favorites-preview-row')).toHaveCount(4);
      await expect(page.locator('.recent-trainer-row')).toHaveCount(5);
      const geometry=await page.evaluate(()=>{
        const rect=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return{x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
        const mode=rect('.trainer-discovery-modes'),search=rect('.trainer-search-shell'),favorites=rect('#trainer-favorites-preview'),recents=rect('#recent-trainers');
        return{mode,search,favorites,recents,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,modeLabels:[...document.querySelectorAll('.trainer-discovery-modes button')].map(button=>button.scrollWidth<=button.clientWidth)};
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.modeLabels.every(Boolean)).toBe(true);
      expect(Math.abs(geometry.search.x-geometry.mode.x)).toBeLessThanOrEqual(1);
      expect(geometry.search.width).toBeLessThanOrEqual(geometry.mode.width);
      expect(geometry.mode.width).toBeLessThanOrEqual(960.5);
      expect(geometry.search.width).toBeGreaterThan(200);
      expect(geometry.favorites.y).toBeGreaterThan(geometry.search.bottom);
      if(viewport.width>=768){
        expect(Math.abs(geometry.favorites.y-geometry.recents.y)).toBeLessThanOrEqual(1);
        expect(geometry.recents.x).toBeGreaterThan(geometry.favorites.right);
      }else{
        expect(geometry.recents.y).toBeGreaterThan(geometry.favorites.bottom);
      }
      for(const button of await page.locator('.trainer-discovery-modes button,.trainer-favorites-preview-row,.recent-trainer-row,.trainer-favorites-preview-action').all()){
        const box=await button.boundingBox();if(box)expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await capturePass3(page,`trainer-landing-${viewport.width}x${viewport.height}`);
    }
  });

  test('my list renders embedded search strings', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'mylist');
    await expect(page.locator('#my-strings-out')).toBeVisible();
    await expect(page.locator('#my-strings-out .str-level').first()).toBeVisible({ timeout: 20_000 });
  });

  test('public trainer search commands stay collapsed until explicitly requested',async({page})=>{

    await page.setViewportSize({width:390,height:844});await currentList(page);
    await openSyntheticPublic(page,'PublicFixture',{wishlist:{Pikachu:'H',Eevee:'M',Bulbasaur:'L'}});
    const copies=page.locator('#share-list-out [data-contextual-copy]');await expect(copies).toHaveCount(3);
    await expect(page.locator('#share-list-out .contextual-details:visible')).toHaveCount(0);
    await page.evaluate(()=>{window.__publicCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>__publicCopies.push(text)}});});
    for(const copy of await copies.all()){await expect(copy).toHaveText('Copy search string');const value=await copy.getAttribute('data-contextual-copy');await copy.click();expect(await page.evaluate(()=>__publicCopies.at(-1))).toBe(value);}
    // Current normal commands copy directly; only real clipboard failure reveals
    // manual recovery. The former ordinary disclosure/raw-view UI is retired.
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Synthetic clipboard rejection');}}}));
    await copies.first().click();await expect(page.locator('#share-list-out .contextual-details').first()).toBeVisible();
    await noOverflow(page);
    for(const target of await page.locator('.share-back-link,.share-profile-actions button,#share-list-out [data-contextual-copy]').all()){const box=await target.boundingBox();if(box)expect(box.height).toBeGreaterThanOrEqual(44);}

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
    await expect(page.locator('.admin-maintenance-row').filter({hasText:'AdminFixture'}).getByRole('button')).toHaveCount(2);
    await expect(page.locator('.admin-maintenance-row').filter({hasText:'AdminFixture'}).locator('[data-admin-user-action="reset-existing"]')).toHaveCount(1);
    await expect(page.locator('.admin-maintenance-row').filter({hasText:'AdminFixture'}).locator('[data-admin-user-action="reset"]')).toHaveCount(0);
  });

  test('EVENT-01 error recovery remains available and retired Admin community UI stays absent',async({page})=>{
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
    await expect(page.locator('[data-community-diagnostic-state], #community-migration-panel, .req-card-community, .approve-community-select')).toHaveCount(0);
    await expect(page.locator('[data-admin-section="diagnostics"]')).not.toContainText(/Preview community|Prepare NYC|Prepare NJ|New Jersey/i);
    await expect(page.locator('#security-panel')).toBeVisible();
    await captureP1(page,'45-admin-current-diagnostics');

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
      setTrainerDiscoveryMode('favorites');
      await renderTrainerQuickLists();
    },names);
    await expect(page.locator('.favorite-card-shell')).toHaveCount(names.length);
    await expect(page.locator('.recent-trainer-row')).toHaveCount(names.length);
    expect(await page.locator('.favorite-card-shell .trainer-quick-name').allTextContents()).toEqual(names);
    expect(await page.locator('.favorite-card-shell script, .recent-trainer-row script').count()).toBe(0);
    for(let index=0;index<names.length;index++){
      await page.locator('[data-discovery-mode="favorites"]').click();
      await page.locator('.favorite-card-primary').nth(index).click();
      expect(await page.evaluate(()=>window.__openedTrainer)).toBe(names[index]);
      await page.locator('[data-discovery-mode="trainers"]').click();
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

    // The archive page was retired before Settings; its saved inventory is not
    // authority for wants and must never be silently rewritten by this editor.
    const have={'Pikachu':{qty:2}};await currentList(page,{wishlist:{Rotom:'H'},have});const before=await editorFixture.entities(page);
    await expect(page.locator('#tab-have,#have-filter,#legacy-inventory-export,.tab[data-tab="have"]')).toHaveCount(0);
    await editorFixture.edit(page,'Rotom');await page.locator('#combined-mod').fill('Exact current want');await currentSave(page);
    expect(await page.evaluate(()=>__editorFixture.remote.have.LocalTrainer)).toEqual(have);
    await currentShare(page);await page.locator('#share-text-csv').check();await expect(page.locator('.share-text-preview')).toContainText('Rotom');await expect(page.locator('.share-text-preview')).not.toContainText('Pikachu');
    for(const [width,height]of [[1440,900],[390,420],[390,300]]){await page.setViewportSize({width,height});await expect(page.locator('#product-share-primary')).toBeInViewport();await noOverflow(page);}
    expect((await editorFixture.entities(page)).filter(e=>e.entityType==='tradeEntry')).toHaveLength(before.filter(e=>e.entityType==='tradeEntry').length);

  });

  test('events renders responsive grouped cards', async ({ page }) => {
    await signIn(page);
    await openMainTab(page, 'schedule');
    await expect(page.locator('.event-filter-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.event-card, #events-out .empty').first()).toBeVisible({ timeout: 20_000 });
    await expectAppNotBlank(page);
  });

  test('Events timeline keeps chronology compact and distinguishes loading empty filter and error states',async({page})=>{
    // The compact Raid Hour fixture is same-day, independent of runner time.
    // A wall-clock start near midnight changed it into a multi-day date range.
    const fixtureNow=new Date('2026-09-21T12:00:00Z');
    await page.clock.setFixedTime(fixtureNow);
    await page.goto(`./?events-timeline=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await isolateAuthenticatedMyListFixture(page,{username:'EventsFixtureTester',uid:'uid-events-fixture'});
    await page.evaluate(()=>switchTab('schedule'));
    await page.evaluate(()=>{
      const now=Date.now(),hour=3600000,day=24*hour;
      const base=[
        {eventID:'active',name:'Raid Hour',eventType:'raid',start:new Date(now-hour).toISOString(),end:new Date(now+2*hour).toISOString(),link:'https://example.com/active'},
        {eventID:'spotlight',name:'Pikachu Spotlight Hour',eventType:'pokemon-spotlight-hour',start:new Date(now+2*hour).toISOString(),end:new Date(now+3*hour).toISOString(),link:'https://example.com/spotlight'},
        {eventID:'max',name:'Dynamax Bulbasaur during Max Monday',eventType:'max-mondays',start:new Date(now+6*hour).toISOString(),end:new Date(now+7*hour).toISOString(),link:'https://example.com/max'},
        {eventID:'raid-day',name:'Rayquaza Raid Day',eventType:'raid-day',start:new Date(now+day).toISOString(),end:new Date(now+day+3*hour).toISOString(),link:'https://example.com/raid-day'},
        {eventID:'soon',name:'Eevee Community Day',eventType:'community-day',start:new Date(now+2*day).toISOString(),end:new Date(now+2*day+3*hour).toISOString(),link:'https://example.com/soon'},
        {eventID:'later',name:'A deliberately long seasonal event title that must wrap without widening the timeline',eventType:'event',start:new Date(now+6*day).toISOString(),end:new Date(now+8*day).toISOString(),link:'https://example.com/later'}
      ];
      const extras=Array.from({length:25},(_,index)=>({eventID:`scale-${index}`,name:`Research Event ${index}`,eventType:'research',start:new Date(now+(index+9)*day).toISOString(),end:new Date(now+(index+9)*day+hour).toISOString()}));
      window.__eventTimelineFixture={events:[...base,...extras],raids:[],fetchedAt:now};_eventData=window.__eventTimelineFixture;_eventLoadState='ready';eventTypeFilter='all';eventCalendarDate='';eventCalendarAnchor=new Date(new Date(now).getFullYear(),new Date(now).getMonth(),1);renderEventsOnly();
    });
    await page.setViewportSize({width:1440,height:900});
    await expect(page.locator('.event-group[data-group="now"]')).toBeVisible();await expect(page.locator('.event-group[data-group="soon"]')).toBeVisible();await expect(page.locator('.event-group[data-group="later"]')).toBeVisible();
    await expect(page.locator('.event-current-badge')).toBeVisible();await expect(page.locator('.event-card-relative').first()).toContainText(/.+/);
    await expect(page.locator('.event-card-date').first()).toContainText(String(fixtureNow.getUTCFullYear()));
    await expect(page.locator('.event-current-badge')).not.toContainText('●');
    await expect(page.locator('.event-filter[data-type="spotlight"]')).toBeVisible();
    await expect(page.locator('.events-context-rail')).toBeVisible();
    await expect(page.locator('.event-up-next-row')).toHaveCount(4);
    await expect(page.locator('.event-up-next-sprite')).toHaveCount(0);
    await expect(page.locator('.event-up-next-pokemon-names').first()).toBeVisible();
    await expect(page.locator('.event-calendar-day.has-events').first()).toBeVisible();
    await expect(page.locator('.event-calendar-day.has-events').first().locator('i')).toHaveText('');
    const cueRightEdges=await page.locator('a.event-card .event-card-cue').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().right)));
    expect(Math.max(...cueRightEdges)-Math.min(...cueRightEdges)).toBeLessThanOrEqual(2);
    await expect(page.locator('article.event-card .event-card-cue')).toHaveCount(0);
    await page.setViewportSize({width:1440,height:900});
    const desktopGeometry=await page.evaluate(()=>{
      const header=document.querySelector('#tab-schedule .sched-hdr').getBoundingClientRect();
      const container=document.getElementById('events-out').getBoundingClientRect();
      const timeline=document.querySelector('.events-timeline').getBoundingClientRect();
      const rail=document.querySelector('.events-context-rail').getBoundingClientRect();
      const style=getComputedStyle(document.querySelector('.events-context-rail'));
      return{headerLeft:header.left,containerLeft:container.left,containerRight:container.right,timelineLeft:timeline.left,timelineRight:timeline.right,timelineWidth:timeline.width,railLeft:rail.left,railRight:rail.right,railPosition:style.position,railOverflowY:style.overflowY};
    });
    expect(Math.abs(desktopGeometry.headerLeft-desktopGeometry.containerLeft)).toBeLessThanOrEqual(1);
    expect(desktopGeometry.timelineWidth).toBeLessThanOrEqual(861);
    expect(Math.abs(desktopGeometry.timelineLeft-desktopGeometry.containerLeft)).toBeLessThanOrEqual(1);
    expect(desktopGeometry.railLeft).toBeGreaterThan(desktopGeometry.timelineRight);
    expect(desktopGeometry.railRight).toBeLessThanOrEqual(desktopGeometry.containerRight+1);
    expect(desktopGeometry.railPosition).toBe('static');
    expect(desktopGeometry.railOverflowY).toBe('visible');
    await expect(page.locator('.event-calendar-desktop .event-calendar-legend')).toContainText(/.+/);
    await expect(page.locator('.event-calendar-disclosure')).toBeHidden();
    await capturePass3(page,`product-ui-events-${test.info().project.name}`);
    const calendarEventDay=page.locator('.event-calendar-desktop .event-calendar-day.has-events').first();await calendarEventDay.click();await expect(page.locator('.event-calendar-desktop .event-calendar-day.selected')).toHaveCount(1);await expect(page.locator('.event-calendar-desktop .event-selected-day')).toBeVisible();await expect(page.locator('.event-calendar-desktop .event-selected-day-row').first()).toBeVisible();await expect(page.locator('.event-calendar-desktop .event-calendar-clear')).toBeVisible();await capturePass3(page,'events-calendar-selected-event-1440x900');const emptyCalendarDay=page.locator('.event-calendar-desktop .event-calendar-day:not(.has-events)').first();await emptyCalendarDay.click();await expect(page.locator('.event-calendar-desktop .event-selected-day-empty')).toBeVisible();await capturePass3(page,'events-calendar-selected-empty-1440x900');await page.locator('.event-calendar-desktop .event-calendar-clear').click();await expect(page.locator('.event-calendar-day.selected')).toHaveCount(0);await expect(page.locator('.event-selected-day')).toHaveCount(0);
    await page.setViewportSize({width:390,height:420});
    const mobileOrder=await page.evaluate(()=>{const timeline=document.querySelector('.events-timeline').getBoundingClientRect(),rail=document.querySelector('.events-context-rail').getBoundingClientRect();return{timelineTop:timeline.top,railTop:rail.top};});
    expect(mobileOrder.timelineTop).toBeLessThan(mobileOrder.railTop);
    await expect(page.locator('.event-calendar-desktop')).toBeHidden();
    await expect(page.locator('.event-calendar-disclosure')).not.toHaveAttribute('open','');
    await expect(page.locator('.event-up-next')).toBeVisible();
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
    await page.locator('.event-filter[data-type="spotlight"]').click();await expect(page.locator('.event-card')).toHaveCount(1);await expect(page.locator('.event-card')).toContainText('Pikachu');
    await page.locator('.event-filter[data-type="raids"]').click();await expect(page.locator('.event-filter[data-type="raids"]')).toHaveAttribute('aria-pressed','true');
    await page.locator('.event-filter[data-type="gbl"]').click();await expect(page.locator('.events-state')).toContainText(/.+/);await expect(page.locator('.events-state-action')).toBeVisible();await page.locator('.events-state-action').click();await expect(page.locator('.event-filter[data-type="all"]')).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>{_eventData={events:[],raids:[],fetchedAt:Date.now()};_eventLoadState='ready';renderEventsOnly();});await expect(page.locator('.events-state')).toBeVisible();await expect(page.locator('.events-state-action')).toHaveCount(0);
    await page.evaluate(()=>{_eventData=null;_eventLoadState='loading';renderEventsOnly();});await expect(page.locator('#events-out')).toHaveAttribute('aria-busy','true');await expect(page.locator('.ui-state-loading')).toBeVisible();await capturePass3(page,'events-loading-mobile');
    await page.evaluate(()=>{_eventData={events:[],raids:[],fetchedAt:0};_eventLoadState='error';renderEventsOnly();});await expect(page.locator('.ui-state-unavailable')).toBeVisible();await expect(page.locator('.events-state-action')).toBeVisible();await capturePass3(page,'events-error-mobile');
    const viewports=[['en',320,640],['ja',375,700],['de',390,420],['es',430,760],['ja',390,300],['de',768,800],['es',1024,800],['en',1440,900],['en',1728,1000],['en',430,932],['ja',390,844],['de',375,812],['es',320,568]];
    const localizedChrome={en:['Events','Events'],ja:['イベント','イベント'],de:['Events','Events'],es:['Eventos','Eventos']};
    for(const [locale,width,height] of viewports){await page.setViewportSize({width,height});await page.evaluate(async locale=>{await changeInterfaceLocale(locale);_eventData=window.__eventTimelineFixture;_eventLoadState='ready';eventTypeFilter='all';eventCalendarDate='';renderEventsOnly();},locale);await expect(page.locator('.event-card').first()).toBeVisible();await expect(page.locator('.events-context-rail')).toBeVisible();await expect(page.locator('#events-title')).toHaveText(localizedChrome[locale][0]);await expect(page.locator('#nav-events .tab-label')).toHaveText(localizedChrome[locale][1]);const rowBox=await page.locator('.event-card').first().boundingBox();expect(rowBox?.height).toBeLessThan(width<=430?192:150);const summaryClamps=await page.locator('.event-card-summary').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).webkitLineClamp));expect(summaryClamps.every(value=>value==='1')).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);if([[1728,1000],[1440,900],[430,932],[390,844],[375,812],[320,568]].some(([w,h])=>w===width&&h===height))await capturePass3(page,`events-calendar-sparse-${width}x${height}`);}
  });

  test('main product tabs keep equivalent page headings on one left edge',async({page})=>{

    await currentList(page);await page.setViewportSize({width:1440,height:900});
    for(const [tab,heading]of [['mylist','#tab-mylist .my-hdr'],['find','#tab-find .have-hdr'],['schedule','#tab-schedule .sched-hdr']]){
      await openMainTab(page,tab);const box=await page.locator(heading).boundingBox();expect(box).not.toBeNull();
      expect(Math.abs(box.x-(1440-box.width)/2)).toBeLessThanOrEqual(1);await noOverflow(page);
      if(tab==='mylist'){expect(await page.locator('#tab-mylist').evaluate(el=>el.getBoundingClientRect().width)).toBe(1120);expect(box.width).toBe(1056);}
    }

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
