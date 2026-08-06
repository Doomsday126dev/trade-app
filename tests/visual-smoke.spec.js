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

test.describe('visual smoke', () => {
  test('signed-out language control opens local Settings without a profile menu',async({page})=>{
    await page.goto(`./?signed-out-settings=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof openSettingsPanel==='function');
    await page.waitForTimeout(350);
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
    await page.waitForFunction(()=>typeof toggleAccountMenu==='function');
    await page.waitForTimeout(250);
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

  test('account and Settings controls keep accessible mobile touch geometry',async({page})=>{
    const viewports=[[320,640],[375,700],[390,700],[430,760],[768,800],[1024,800],[1440,900],[390,420],[390,300]];
    for(const [width,height] of viewports){
      await page.setViewportSize({width,height});
      await page.goto(`./?account-touch-targets=${width}-${height}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>typeof toggleAccountMenu==='function');
      await page.waitForTimeout(250);
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

      const close=page.locator('.settings-modal-close');
      const closeBox=await close.boundingBox();
      expect(closeBox?.width).toBeGreaterThanOrEqual(48);
      expect(closeBox?.height).toBeGreaterThanOrEqual(48);
      expect(closeBox?.x).toBeGreaterThanOrEqual(0);
      expect(closeBox?.y).toBeGreaterThanOrEqual(0);
      expect((closeBox?.x||0)+(closeBox?.width||0)).toBeLessThanOrEqual(width);
      expect((closeBox?.y||0)+(closeBox?.height||0)).toBeLessThanOrEqual(height);
      expect(await page.evaluate(()=>{
        const body=document.querySelector('.settings-modal-body');
        return document.documentElement.scrollWidth<=document.documentElement.clientWidth&&
          getComputedStyle(body).overflowY==='auto'&&body.scrollHeight>=body.clientHeight;
      })).toBe(true);
    }
  });

  test('local trainer organizer remains contained and reachable on compact viewports',async({page})=>{
    for(const [width,height] of [[320,640],[375,700],[390,420],[390,300],[430,760],[1024,800]]){
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
      await page.locator('#organizer-note').fill('A private note draft');
      await handleOneDialogDuring(page,()=>page.keyboard.press('Escape'),true);
      await expect(modal).toBeHidden();
    }
  });

  test('local trainer organizer dialog lifecycle is isolated across actions and sessions',async({page})=>{
    await page.goto(`./?local-organizer-lifecycle=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForStableLocalOrganizerStartup(page);
    await installLocalOrganizerFixture(page);
    const modal=page.locator('#trainer-organizer-modal'),note=page.locator('#organizer-note');

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
    await note.fill('Keep this draft');
    await handleOneDialogDuring(page,()=>page.keyboard.press('Escape'),false);
    await expect(modal).toBeVisible();
    await page.locator('.organizer-actions .bpri').click();
    expect(await page.evaluate(()=>trainerOrganizerState.dirty)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
    await note.fill('Trainer switch draft');
    await handleOneDialogDuring(page,()=>page.evaluate(()=>openTrainerOrganizer('TrainerBeta')),false);
    await expect(page.locator('#organizer-trainer-name')).toHaveText('TrainerAlpha');
    await handleOneDialogDuring(page,()=>page.evaluate(()=>openTrainerOrganizer('TrainerBeta')),true);
    await expect(page.locator('#organizer-trainer-name')).toHaveText('TrainerBeta');
    await page.evaluate(()=>closeTrainerOrganizer(true));

    await page.evaluate(()=>openTrainerOrganizer('TrainerAlpha'));
    await note.fill('Discard this draft');
    await handleOneDialogDuring(page,()=>page.locator('#trainer-organizer-modal').click({position:{x:2,y:2}}),false);
    await expect(modal).toBeVisible();
    await handleOneDialogDuring(page,()=>page.locator('.organizer-actions .bghost').click(),true);
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
