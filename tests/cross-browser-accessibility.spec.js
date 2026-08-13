const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const path=require('node:path');
const reviewDir=process.env.CROSS_BROWSER_REVIEW_DIR||'';

async function captureReview(page,name){
  mkdirSync(reviewDir,{recursive:true});
  await page.screenshot({path:path.join(reviewDir,`${name}.png`),fullPage:false});
}

async function waitForApp(page){
  await page.waitForFunction(()=>typeof openSettingsPanel==='function'&&typeof syncSettingsRoute==='function');
}

async function establishAccount(page,name='CrossBrowserTrainer'){
  await page.waitForFunction(()=>_authStateKnown===true);
  await page.evaluate(username=>{
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedListenerLifecycle?.deactivateSession?.('cross_browser_fixture');
    managedListenerLifecycle?.clearSelectedTrainer?.('cross_browser_fixture');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;
    cur=username;
    _authStateKnown=true;
    allData.users=allData.users||{};
    allData.users[username]=allData.users[username]||{};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    document.getElementById('top-un').textContent=username;
    document.getElementById('top-av').textContent='CB';
    syncPendingSettingsRouteAfterAuth();
  },name);
}

async function establishAccountDuringBoot(page,name='CrossBrowserTrainer'){
  await page.waitForFunction(()=>typeof syncSettingsRoute==='function'&&typeof syncPendingSettingsRouteAfterAuth==='function');
  await page.evaluate(username=>{
    cur=username;
    _authStateKnown=true;
    allData.users=allData.users||{};
    allData.users[username]=allData.users[username]||{};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    syncPendingSettingsRouteAfterAuth();
  },name);
}

test.describe('audit cross-browser contracts',()=>{
  test('BROWSER-01 Settings history traverses sections and closes consistently',async({page})=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?browser-01=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await establishAccount(page);
    await page.evaluate(()=>openSettingsPanel('account'));
    await expect(page).toHaveURL(/#settings\/profile$/);
    await page.locator('[data-settings-target="appearance"]').click();
    await expect(page).toHaveURL(/#settings\/appearance$/);
    await page.goBack();
    await expect(page).toHaveURL(/#settings\/profile$/);
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await page.goForward();
    await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
    await page.goForward();
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    for(const section of ['security','tools','data']){
      await page.locator(`[data-settings-target="${section}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#settings/${section}$`));
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
    }
    await page.goBack();
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await page.goForward();
    await expect(page.locator('[data-settings-section="data"]')).toBeVisible();
    await page.locator('.settings-modal-close').click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await page.evaluate(()=>openSettingsPanel('account'));
    await expect(page.locator('[data-settings-section="data"]')).toBeVisible();
    await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
    await page.reload({waitUntil:'domcontentloaded'});
    await establishAccountDuringBoot(page);
    await expect(page).toHaveURL(/#settings\/data$/);
    await expect(page.locator('[data-settings-section="data"]')).toBeVisible();
    await page.goto(`./?browser-01-direct-close=${Date.now()}#settings/tools`,{waitUntil:'domcontentloaded'});
    await establishAccountDuringBoot(page);
    await expect(page.locator('[data-settings-section="tools"]')).toBeVisible();
    await page.locator('[data-settings-target="language"]').click();
    await page.locator('.settings-modal-close').click();
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(page).not.toHaveURL(/#settings/);
  });

  test('BROWSER-01 mobile history returns to the Settings landing before leaving',async({page})=>{
    await page.setViewportSize({width:390,height:700});
    await page.goto(`./?browser-01-mobile=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await establishAccount(page);
    await page.evaluate(()=>openSettingsPanel('account'));
    await expect(page).toHaveURL(/#settings$/);
    await page.locator('[data-settings-target="appearance"]').click();
    await expect(page).toHaveURL(/#settings\/appearance$/);
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.locator('.settings-nav')).toBeVisible();
    await page.goForward();
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    await page.locator('.settings-mobile-back').click();
    await expect(page).toHaveURL(/#settings$/);
    await expect(page.locator('.settings-nav')).toBeVisible();
    await page.goForward();
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
    await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
    await page.reload({waitUntil:'domcontentloaded'});
    await establishAccountDuringBoot(page);
    await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
  });

  test('BROWSER-02 signed-out Settings restores the concrete opener on Escape',async({page})=>{
    await page.goto(`./?browser-02=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    const trigger=page.locator('#login-language-trigger');
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('A11Y-02 public Settings controls render 48px targets and visible keyboard focus',async({page})=>{
    for(const width of [375,390,430]){
      await page.setViewportSize({width,height:844});
      await page.goto(`./?a11y-02=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForApp(page);
      await page.locator('#login-language-trigger').click();
      const select=page.locator('#settings-language');
      await page.locator('.settings-modal-close').focus();
      await page.keyboard.press('Tab');
      const geometry=await select.evaluate(node=>{
        const rect=node.getBoundingClientRect();
        const style=getComputedStyle(node);
        return{width:rect.width,height:rect.height,outlineStyle:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),outlineOffset:parseFloat(style.outlineOffset)};
      });
      expect(geometry.height).toBeGreaterThanOrEqual(47.5);
      expect(geometry.outlineStyle).not.toBe('none');
      expect(geometry.outlineWidth).toBeGreaterThanOrEqual(2.5);
      expect(geometry.outlineOffset).toBeGreaterThanOrEqual(1.5);
      await page.locator('#settings-search-language-override').check();
      expect((await page.locator('#settings-search-language').boundingBox())?.height).toBeGreaterThanOrEqual(47.5);
      for(const selector of ['.settings-modal-close','.language-override-toggle','.settings-mobile-back']){
        const box=await page.locator(selector).boundingBox();
        if(box){expect(box.width,selector).toBeGreaterThanOrEqual(47.5);expect(box.height,selector).toBeGreaterThanOrEqual(47.5);}
      }
    }
  });

  test('BROWSER-02 keyboard focus order stays on visible shell and Settings controls',async({page})=>{
    await page.setViewportSize({width:390,height:760});
    await page.goto(`./?browser-02-order=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await establishAccount(page);
    await page.locator('#account-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#account-settings-action')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-settings-target="profile"]')).toBeFocused();
    await page.locator('[data-settings-target="language"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings-language-heading')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-settings-target="language"]')).toBeFocused();
  });

  test('BROWSER-02 representative navigation, autocomplete, and Admin focus stays visible',async({page},testInfo)=>{
    await page.setViewportSize({width:1024,height:800});
    await page.goto(`./?browser-02-surfaces=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await establishAccount(page);
    await page.evaluate(()=>{
      allData.admins={CrossBrowserTrainer:true};
      document.getElementById('admin-tab').style.display='';
      switchTab('find');
    });
    const transitions=[
      ['#nav-mylist','#nav-find'],
      ['#nav-find','#nav-events'],
      ['#nav-events','#admin-tab'],
      ['#admin-tab','#find-trainer-input']
    ];
    const keyboardTab=testInfo.project.name==='cross-webkit'?'Alt+Tab':'Tab';
    for(const [before,selector] of transitions){
      await page.locator(before).focus();
      await page.keyboard.press(keyboardTab);
      const control=page.locator(selector);
      await expect(control).toBeFocused();
      const focus=await control.evaluate(node=>{const style=getComputedStyle(node);return{visible:node.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth),boxShadow:style.boxShadow};});
      expect(focus.visible,selector).toBe(true);
      expect(focus.outline!=='none'&&focus.width>=2.5||focus.boxShadow!=='none',selector).toBe(true);
    }
  });

  test('MOBILE-01 compact top bar keeps long account access in bounds',async({page})=>{
    for(const width of [320,360,375,390,393,412,430]){
      await page.setViewportSize({width,height:844});
      await page.goto(`./?mobile-01=${width}-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForApp(page);
      await establishAccount(page,'SehrLangerTrainernameMitUnicode日本語');
      await page.evaluate(()=>{
        allData.admins={SehrLangerTrainernameMitUnicode日本語:true};
        document.getElementById('admin-tab').style.display='';
        document.getElementById('sync-pill').classList.add('local-only');
        document.getElementById('slbl').textContent='Local only';
        document.getElementById('sync-pill').setAttribute('aria-label','Local only. Open save status details');
        document.documentElement.dataset.theme=innerWidth===390?'dark':'light';
      });
      const geometry=await page.evaluate(()=>{
        const bar=document.querySelector('.topbar').getBoundingClientRect();
        const logo=document.querySelector('.logo').getBoundingClientRect();
        const trigger=document.getElementById('account-trigger').getBoundingClientRect();
        const controls=[...document.querySelectorAll('.topbar-r button:not([hidden]),.topbar-r [role="button"]')]
          .filter(node=>getComputedStyle(node).display!=='none')
          .map(node=>({id:node.id,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}));
        return{viewport:innerWidth,bar:{left:bar.left,right:bar.right},logo:{left:logo.left,right:logo.right},trigger:{left:trigger.left,right:trigger.right,width:trigger.width,height:trigger.height},controls};
      });
      expect(geometry.bar.left).toBeGreaterThanOrEqual(-.5);
      expect(geometry.bar.right).toBeLessThanOrEqual(width+.5);
      expect(geometry.logo.right).toBeLessThanOrEqual(geometry.trigger.left+.5);
      expect(geometry.trigger.left).toBeGreaterThanOrEqual(-.5);
      expect(geometry.trigger.right).toBeLessThanOrEqual(width+.5);
      expect(geometry.trigger.width).toBeGreaterThanOrEqual(47.5);
      expect(geometry.trigger.height).toBeGreaterThanOrEqual(47.5);
      for(const control of geometry.controls.filter(control=>['sync-pill','bell-btn','theme-toggle','account-trigger'].includes(control.id))){
        expect(control.left,control.id).toBeGreaterThanOrEqual(-.5);
        expect(control.right,control.id).toBeLessThanOrEqual(width+.5);
        expect(control.width,control.id).toBeGreaterThanOrEqual(47.5);
        expect(control.height,control.id).toBeGreaterThanOrEqual(47.5);
      }
      await page.evaluate(()=>openAccountMenu());
      await expect(page.locator('#account-popover')).toBeVisible();
      const menu=await page.locator('#account-popover').boundingBox();
      expect(menu).not.toBeNull();
      expect(menu.x).toBeGreaterThanOrEqual(-.5);
      expect(menu.x+menu.width).toBeLessThanOrEqual(width+.5);
      await expect(page.locator('#account-settings-action')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('#account-trigger')).toBeFocused();
      if(width===390){
        await page.evaluate(()=>{cur='SehrLangerTrainernameMitUnicode日本語';openAccountMenu();});
        await page.mouse.click(2,400);
        await expect(page.locator('#account-popover')).toBeHidden();
        await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
        await page.evaluate(()=>{cur='SehrLangerTrainernameMitUnicode日本語';openAccountMenu();});
        await expect(page.locator('#account-popover')).toBeVisible();
        const scrolledMenu=await page.locator('#account-popover').boundingBox();
        expect(scrolledMenu).not.toBeNull();
        expect(scrolledMenu.y).toBeGreaterThanOrEqual(-.5);
        expect(scrolledMenu.y+scrolledMenu.height).toBeLessThanOrEqual(844+.5);
        await page.keyboard.press('Escape');
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });

  test('A11Y-01 zoom-enabled effective narrow width keeps shell and Admin navigation operable',async({page})=>{
    await page.setViewportSize({width:360,height:900});
    await page.goto(`./?a11y-01-zoom=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await establishAccount(page,'ZoomedOwnerTrainerName');
    await page.evaluate(()=>{
      allData.admins={ZoomedOwnerTrainerName:true};
      document.getElementById('admin-tab').style.display='';
    });
    const shell=await page.evaluate(()=>({
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
      viewportMeta:document.querySelector('meta[name="viewport"]')?.content||'',
      trigger:document.getElementById('account-trigger').getBoundingClientRect().toJSON(),
      brand:document.querySelector('.logo').getBoundingClientRect().toJSON()
    }));
    expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
    expect(shell.viewportMeta).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
    expect(shell.trigger.right).toBeLessThanOrEqual(shell.clientWidth+.5);
    expect(shell.brand.right).toBeLessThanOrEqual(shell.trigger.left+.5);
    await page.locator('#account-trigger').click({force:true});
    await expect(page.locator('#account-settings-action')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
      document.getElementById('tab-admin').classList.add('active');
      setAdminSection('overview');
    });
    await expect(page.locator('[data-admin-section="overview"]')).toBeVisible();
    await page.locator('[data-admin-target="members"]').click();
    await expect(page.locator('[data-admin-section="members"]')).toBeVisible();
  });

  test('review screenshots capture only the high-value corrected states',async({page},testInfo)=>{
    test.skip(!reviewDir,'Set CROSS_BROWSER_REVIEW_DIR to capture review evidence.');
    if(testInfo.project.name==='cross-chromium'){
      for(const [width,name,theme,username] of [
        [320,'chromium-320-authenticated-topbar','light','CompactOwner'],
        [375,'chromium-375-admin-long-username','light','SehrLangerTrainernameMitUnicode日本語'],
        [390,'chromium-390-dark-shell','dark','DunklerLangerTrainername'],
        [360,'chromium-effective-200-percent-zoom-shell','light','ZoomedOwnerTrainerName']
      ]){
        await page.setViewportSize({width,height:760});
        await page.goto(`./?review=${name}-${Date.now()}`,{waitUntil:'domcontentloaded'});
        await waitForApp(page);
        await establishAccount(page,username);
        await page.evaluate(({theme,username})=>{
          allData.admins={[username]:true};
          document.getElementById('admin-tab').style.display='';
          document.documentElement.dataset.theme=theme;
          document.getElementById('sync-pill').classList.add('local-only');
          document.getElementById('slbl').textContent='Local only';
        },{theme,username});
        await captureReview(page,name);
      }
      return;
    }
    if(testInfo.project.name==='cross-firefox'){
      await page.setViewportSize({width:1024,height:760});
      await page.goto(`./?review=firefox-settings-${Date.now()}`,{waitUntil:'domcontentloaded'});
      await waitForApp(page);await establishAccount(page);
      await page.evaluate(()=>openSettingsPanel('account'));
      await page.locator('[data-settings-target="appearance"]').click();
      await page.goBack();await page.goForward();
      await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
      await captureReview(page,'firefox-settings-history-forward-restored');
      return;
    }
    await page.setViewportSize({width:390,height:760});
    await page.goto(`./?review=webkit-focus-${Date.now()}`,{waitUntil:'domcontentloaded'});
    await waitForApp(page);
    await page.locator('#login-language-trigger').click();
    await page.locator('.settings-modal-close').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#settings-language')).toBeFocused();
    await captureReview(page,'webkit-settings-select-focus-48px');
  });
});
