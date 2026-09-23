const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const path=require('node:path');
const reviewDir=process.env.SETTINGS_REVIEW_DIR||'';

async function captureReview(page,name){
  if(!reviewDir)return;
  mkdirSync(reviewDir,{recursive:true});
  await page.screenshot({path:path.join(reviewDir,`${name}.png`),fullPage:false,animations:'disabled'});
}

async function waitForApp(page){
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('settings-product-integrity'));
  await page.waitForFunction(()=>typeof openSettingsPanel==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
}

async function establishAccount(page){
  await page.evaluate(()=>{
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedListenerLifecycle?.deactivateSession?.('settings-product-integrity');
    managedListenerLifecycle?.clearSelectedTrainer?.('settings-product-integrity');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;cur='SettingsTester';_authStateKnown=true;
    allData.users=allData.users||{};
    allData.users.SettingsTester={friendCode:'1234 5678 9012',bio:'Local fixture',discord:'settings-tester',avatarPokemon:''};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    updateFcDisplay();
  });
}

test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='localhost'||url.hostname==='127.0.0.1')return route.continue();
    return route.abort();
  });
});

test('mobile Profile scroll reaches Save and draft actions remain operable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`./?settings-mobile=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await waitForApp(page);await establishAccount(page);
  await page.evaluate(()=>openSettingsPanel('account'));
  await captureReview(page,'settings-mobile-index');
  await page.locator('[data-settings-target="profile"]').click();
  await captureReview(page,'settings-mobile-profile');
  await page.locator('#prof-bio').fill('A changed local fixture bio');
  await page.evaluate(()=>{selectSettingsSection('appearance',{focus:false});selectSettingsSection('profile',{focus:false});});
  await expect(page.locator('#prof-bio')).toHaveValue('A changed local fixture bio');
  await expect(page.locator('#profile-save')).toBeEnabled();
  await expect(page.locator('#profile-discard')).toBeEnabled();
  await expect(page.locator('#profile-err')).toHaveText('Unsaved changes');
  await page.locator('#settings-detail').hover();
  await page.mouse.wheel(0,1200);
  await expect(page.locator('#profile-save')).toBeInViewport();
  await captureReview(page,'settings-mobile-profile-save');
  await page.locator('#profile-discard').click();
  await expect(page.locator('#prof-bio')).toHaveValue('Local fixture');
  await expect(page.locator('#profile-save')).toBeDisabled();
});

test('desktop focus stays in Settings while the covered app is inert',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`./?settings-focus=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await waitForApp(page);await establishAccount(page);
  await page.evaluate(()=>openSettingsPanel('account'));
  await captureReview(page,'settings-desktop-profile');
  await page.locator('.settings-modal-close').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>document.getElementById('settings-modal').contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(()=>!!document.getElementById('account-trigger')?.closest('[inert]'))).toBe(true);
});

test('avatar picker owns Escape and consecutive arrow navigation',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`./?settings-avatar=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await waitForApp(page);await establishAccount(page);
  await page.evaluate(()=>openSettingsPanel('account'));
  await page.locator('#prof-av-open').click();
  await page.locator('#prof-av-search').fill('nidoran');
  await expect(page.locator('.profile-avatar-option')).toHaveCount(2);
  await page.locator('#prof-av-search').press('ArrowDown');
  const first=await page.locator('.profile-avatar-option:focus').getAttribute('data-catalog-id');
  await page.keyboard.press('ArrowDown');
  const second=await page.locator('.profile-avatar-option:focus').getAttribute('data-catalog-id');
  expect(second).not.toBe(first);
  await page.keyboard.press('Escape');
  await expect(page.locator('#prof-av-dialog')).toBeHidden();
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect(page).toHaveURL(/#settings\/profile$/);
});

for(const theme of ['light','dark'])for(const width of [320,390,1440]){
  test(`final Settings ${theme} at ${width}px preserves Save and keyboard behavior`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.goto('./?settings-final-qualification',{waitUntil:'domcontentloaded'});
    await waitForApp(page);await establishAccount(page);
    await page.evaluate(theme=>{
      const fixture=structuredClone(allData);const uid='settings-local-save';
      auth={currentUser:{uid,providerData:[{providerId:'password'}]}};currentAuthUid=uid;
      fixture.users.SettingsTester.authUid=uid;activateOwnedSession(uid,'SettingsTester');
      db={};firebaseDataProtectionReady=true;
      ref=(_db,path)=>path;get=async path=>{
        const values={[`authIndex/${uid}`]:{username:'SettingsTester'},'users/SettingsTester/authUid':uid,[`accountSync/${uid}`]:null};
        if(!Object.prototype.hasOwnProperty.call(values,path))throw new Error(`Unexpected fixture read: ${path}`);
        return{val:()=>values[path]};
      };
      allData=normalizeData(fixture);saveLocal(allData);applyTheme(theme);openAccountSettingsSection('profile');
    },theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#prof-bio').fill(`Saved ${theme} ${width}`);
    await expect(page.locator('#profile-err')).toHaveText('Unsaved changes');
    await page.locator('#settings-detail').hover();await page.mouse.wheel(0,1800);
    await expect(page.locator('#profile-save')).toBeInViewport();
    await captureReview(page,`settings-final-${theme}-${width}-save`);
    await page.locator('#profile-save').click();
    await expect(page.locator('#profile-save')).toBeDisabled();
    expect(await page.evaluate(()=>allData.users.SettingsTester.bio)).toBe(`Saved ${theme} ${width}`);
    await expect(page.locator('#toast')).toBeHidden({timeout:5000});
    await captureReview(page,`settings-final-${theme}-${width}-saved`);
    await page.locator('.settings-modal-close').focus();await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(()=>document.getElementById('settings-modal').contains(document.activeElement))).toBe(true);
    await page.locator('#prof-av-open').click();
    await page.locator('#prof-av-search').fill('nidoran');
    await expect(page.locator('.profile-avatar-option')).toHaveCount(2);
    await page.locator('#prof-av-search').press('ArrowDown');
    const first=await page.locator('.profile-avatar-option:focus').getAttribute('data-catalog-id');
    await page.keyboard.press('ArrowDown');
    expect(await page.locator('.profile-avatar-option:focus').getAttribute('data-catalog-id')).not.toBe(first);
    await page.keyboard.press('Escape');
    await expect(page.locator('#prof-av-dialog')).toBeHidden();await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('.settings-modal-close').click();
    expect(await page.evaluate(()=>!!document.getElementById('account-trigger')?.closest('[inert]'))).toBe(false);
  });
}

test('dirty Profile status survives reopening and interface translation',async({page})=>{
  await page.goto('./?settings-dirty-translation');await waitForApp(page);await establishAccount(page);
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await page.locator('#prof-bio').fill('A draft that is still unsaved');
  await page.locator('.settings-modal-close').click();
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await expect(page.locator('#profile-err')).toHaveText('Unsaved changes');
  await page.evaluate(()=>changeInterfaceLocale('ja'));
  await expect(page.locator('#profile-err')).toHaveText('未保存の変更があります');
  await expect(page.locator('#prof-bio')).toHaveValue('A draft that is still unsaved');
  await expect(page.locator('#profile-save')).toBeEnabled();
});

test('invalid Friend Code remains identified while other Profile fields change',async({page})=>{
  await page.goto('./?settings-validation-state');await waitForApp(page);await establishAccount(page);
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await page.locator('#fc-inp').fill('123');await page.locator('#profile-save').click();
  await expect(page.locator('#fc-inp')).toHaveAttribute('aria-invalid','true');
  await page.locator('#prof-bio').fill('Other field changed');
  await expect(page.locator('#fc-inp')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#profile-err')).toHaveText('Friend Code must contain 12 digits.');
  await page.evaluate(()=>changeInterfaceLocale('ja'));
  await expect(page.locator('#profile-err')).toHaveText('フレンドコードは12桁の数字で入力してください。');
  await page.locator('#fc-inp').fill('123456789012');
  await expect(page.locator('#fc-inp')).not.toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#profile-err')).toHaveText('未保存の変更があります');
});
