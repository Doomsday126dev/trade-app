const {test,expect}=require('@playwright/test');

test.describe('signed-out critical path',()=>{
  test.beforeEach(async({page})=>{
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
  });

  test('meaningful pre-auth status paints while the classic script graph is still blocked',async({page})=>{
    let releaseData;
    const blockedData=new Promise(resolve=>{releaseData=resolve;});
    await page.route(/\/data\.js\?v=/,async route=>{
      await blockedData;
      await route.continue();
    });

    const navigation=page.goto(`./?early-shell=${Date.now()}`,{waitUntil:'domcontentloaded'});
    const preauth=page.locator('#preauth-pg');
    await expect(preauth).toBeVisible({timeout:2_000});
    await expect(preauth).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#preauth-title')).not.toHaveText('');
    await expect(page.locator('#preauth-detail')).not.toHaveText('');
    await expect(page.locator('#login-pg')).toBeVisible();
    await expect(page.locator('#login-user')).toBeDisabled();
    await expect(page.locator('#login-btn')).toBeDisabled();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(()=>typeof window.POGO_TRADE_DB)).toBe('undefined');

    releaseData();
    await navigation;
  });

  test('Auth-only bootstrap resolves while the initial login shell stays safely disabled',async({page})=>{
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
      contentType:'application/javascript',
      headers:{'access-control-allow-origin':'*'},
      body:"export function initializeApp(config,name){return {config,name}}"
    }));
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',route=>route.fulfill({
      contentType:'application/javascript',
      headers:{'access-control-allow-origin':'*'},
      body:"export function getAuth(app){return {app,currentUser:null}};export function onAuthStateChanged(auth,listener){queueMicrotask(()=>listener(null));return ()=>{}};export const signInWithEmailAndPassword=()=>{};export const createUserWithEmailAndPassword=()=>{};export const signOut=()=>{};export const updatePassword=()=>{};export const deleteUser=()=>{};"
    }));
    let releaseData;
    const blockedData=new Promise(resolve=>{releaseData=resolve;});
    await page.route(/\/data\.js\?v=/,async route=>{await blockedData;await route.continue();});

    const navigation=page.goto(`./?early-auth=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#login-pg')).toBeVisible({timeout:5_000});
    await expect(page.locator('#login-pg')).toHaveAttribute('data-bootstrap-pending','true');
    await expect(page.locator('#login-pg')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#login-user')).toBeDisabled();
    await expect(page.locator('#login-pin')).toBeDisabled();
    await expect(page.locator('#login-btn')).toBeDisabled();
    await expect(page.locator('#preauth-pg')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(()=>window.__pogoStartup.authStateKnownAt<window.__pogoStartup.firebaseStartupSettledAt||window.__pogoStartup.firebaseStartupSettledAt===null)).toBe(true);

    releaseData();
    await navigation;
  });

  test('failed optional Firebase startup transitions safely to login without exposing private UI',async({page})=>{
    await page.addInitScript(()=>{
      localStorage.setItem('pgu',JSON.stringify('StalePreviousAccount'));
      localStorage.setItem('pguts',JSON.stringify(Date.now()));
      window.__privateUiWasVisible=false;
      addEventListener('DOMContentLoaded',()=>{
        const app=document.getElementById('app');
        const inspect=()=>{
          if(app&&getComputedStyle(app).display!=='none')window.__privateUiWasVisible=true;
        };
        new MutationObserver(inspect).observe(app,{attributes:true,attributeFilter:['style','class']});
        inspect();
      },{once:true});
    });

    await page.goto(`./?failed-firebase=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#login-pg')).toBeVisible({timeout:10_000});
    await expect(page.locator('#preauth-pg')).toBeHidden();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(()=>window.__privateUiWasVisible)).toBe(false);
    await expect(page.locator('#login-user')).toHaveAccessibleName(/username/i);
    await expect(page.locator('#login-pin')).toHaveAccessibleName(/pin/i);
  });

  test('App Check failure keeps the database client and listeners fail closed',async({page})=>{
    await page.goto(`./?app-check-failure=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof ensureFirebaseDataProtection==='function'&&typeof startListener==='function');
    const result=await page.evaluate(async()=>{
      firebaseDataProtectionPromise=null;
      firebaseDataProtectionReady=false;
      firebaseDatabaseHandle={};
      fbApp={};
      db=null;
      fbOn=false;
      const original=startFirebaseAppCheck;
      startFirebaseAppCheck=()=>Promise.resolve({ok:false,code:'app-check/test-failure'});
      let rejected=false;
      try{await ensureFirebaseDataProtection();}catch{rejected=true;}
      const snapshot={rejected,dbActive:db!==null,fbOn,protectionReady:firebaseDataProtectionReady,listenerStarted:startListener()};
      startFirebaseAppCheck=original;
      return snapshot;
    });
    expect(result).toEqual({rejected:true,dbActive:false,fbOn:false,protectionReady:false,listenerStarted:false});
  });

  test('localized pre-auth copy resolves before the signed-in catalog path runs',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('pogoUiLocale:v1','de'));
    await page.goto(`./?localized-preauth=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.PogoI18n?.core?.getLocale==='function');
    expect(await page.evaluate(()=>window.PogoI18n.core.getLocale())).toBe('de');
    await expect(page.locator('#preauth-title')).toHaveText('Deine Tauschliste wird vorbereitet');
    expect(await page.evaluate(()=>window.__pogoStartup.catalogsReadyAt)).toBeNull();
  });
});
