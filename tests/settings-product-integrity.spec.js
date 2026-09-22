const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const path=require('node:path');
const reviewDir=process.env.SETTINGS_REVIEW_DIR||'';

async function captureReview(page,name){
  if(!reviewDir)return;
  mkdirSync(reviewDir,{recursive:true});
  await page.screenshot({path:path.join(reviewDir,`${name}.png`),fullPage:false});
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
  await page.locator('[data-settings-target="profile"]').click();
  await captureReview(page,'settings-mobile-profile');
  await page.locator('#prof-bio').fill('A changed local fixture bio');
  await expect(page.locator('#profile-save')).toBeEnabled();
  await expect(page.locator('#profile-discard')).toBeEnabled();
  await expect(page.locator('#profile-err')).toHaveText('Unsaved changes');
  await page.locator('#settings-detail').hover();
  await page.mouse.wheel(0,1200);
  await expect(page.locator('#profile-save')).toBeInViewport();
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
  await page.locator('#prof-av-search').fill('pika');
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
