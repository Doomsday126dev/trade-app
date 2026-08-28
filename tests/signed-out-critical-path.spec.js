const {test,expect}=require('@playwright/test');

const restoredIdentity=Object.freeze({uid:'uid-restored-startup',username:'RestoredStartup'});

async function installRestoredFirebaseScenario(page,{appCheck='success'}={}){
  await page.addInitScript(identity=>{
    localStorage.setItem('pgu',identity.username);
    localStorage.setItem('pguts',String(Date.now()));
    localStorage.setItem('pogoSessionCache_v2',JSON.stringify({
      schemaVersion:2,
      public:{loginDirectory:{}},
      protected:{
        owner:identity,
        data:{users:{[identity.username]:{authUid:identity.uid}},wishlist:{[identity.username]:{}},dynamax:{[identity.username]:{}},gmax:{[identity.username]:{}},costumes:{[identity.username]:{}}}
      }
    }));
    window.__privateUiWasVisible=false;
    window.__privateUiFirstVisibleAt=null;
    addEventListener('DOMContentLoaded',()=>{
      const app=document.getElementById('app');
      const inspect=()=>{
        if(app&&getComputedStyle(app).display!=='none'){
          window.__privateUiWasVisible=true;
          window.__privateUiFirstVisibleAt??=performance.now();
        }
      };
      new MutationObserver(inspect).observe(app,{attributes:true,attributeFilter:['style','class']});
      inspect();
    },{once:true});
  },restoredIdentity);
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:"const app={name:'pogo'};export function initializeApp(){return app}"
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:`const listeners=new Set();const initial={uid:${JSON.stringify(restoredIdentity.uid)}};const auth={currentUser:initial};
      globalThis.__emitPogoMockAuth=user=>{auth.currentUser=user;listeners.forEach(listener=>listener(user));};
      export function getAuth(){return auth}export function onAuthStateChanged(_auth,listener){listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener)}
      export async function signInWithEmailAndPassword(){return{user:auth.currentUser}}export async function createUserWithEmailAndPassword(){return{user:auth.currentUser}}
      export async function signOut(){globalThis.__emitPogoMockAuth(null)}export async function updatePassword(){}export async function deleteUser(){}`
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:`globalThis.__pogoMockDatabaseCalls=[];export function getDatabase(){return{kind:'mock-db'}}export function ref(_db,path){return{path}}
      export async function set(target){globalThis.__pogoMockDatabaseCalls.push('set:'+target.path)}export async function update(target){globalThis.__pogoMockDatabaseCalls.push('update:'+target.path)}
      export async function get(target){globalThis.__pogoMockDatabaseCalls.push('get:'+target.path);return{exists:()=>false,val:()=>null}}
      export function onValue(target,listener){globalThis.__pogoMockDatabaseCalls.push('listen:'+target.path);queueMicrotask(()=>listener({exists:()=>false,val:()=>null}));return()=>{}}`
  }));
  let releaseAppCheck=()=>{};
  let markRequested;
  const requested=new Promise(resolve=>{markRequested=resolve;});
  const blocked=new Promise(resolve=>{releaseAppCheck=resolve;});
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',async route=>{
    markRequested();
    if(appCheck==='delayed')await blocked;
    const initialization=appCheck==='failure'
      ?"export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key}}export function initializeAppCheck(){throw new Error('mock-app-check-failure')}"
      :"export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key}}export function initializeAppCheck(){return{kind:'mock-app-check'}}";
    await route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:initialization});
  });
  return{releaseAppCheck,appCheckRequested:requested};
}

test.describe('signed-out critical path',()=>{
  test.beforeEach(async({page})=>{
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    await page.route('https://www.gstatic.com/firebasejs/**',route=>route.abort());
  });

  test('meaningful pre-auth status paints while Auth state is still pending',async({page})=>{
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
      contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
      body:"export function initializeApp(config,name){return {config,name}}"
    }));
    let releaseAuth;
    const blockedAuth=new Promise(resolve=>{releaseAuth=resolve;});
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',async route=>{
      await blockedAuth;
      await route.fulfill({
        contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
        body:"export function getAuth(app){return {app,currentUser:null}};export function onAuthStateChanged(auth,listener){queueMicrotask(()=>listener(null));return ()=>{}};"
      });
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

    releaseAuth();
    await navigation;
  });

  test('Auth-only bootstrap reveals an interactive shell without loading protected features',async({page})=>{
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
    await page.waitForFunction(()=>window.__pogoShellReady===true);
    await expect(page.locator('#login-pg')).not.toHaveAttribute('data-bootstrap-pending','true');
    await expect(page.locator('#login-pg')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('#login-user')).toBeEnabled();
    await expect(page.locator('#login-pin')).toBeEnabled();
    await expect(page.locator('#login-btn')).toBeEnabled();
    await expect(page.locator('#preauth-pg')).toBeHidden();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(()=>({
      db:typeof window.POGO_TRADE_DB,
      featureStart:window.__pogoStartup.featureLoadStartedAt,
      appCheckStart:window.__pogoStartup.appCheckStartedAt,
      recaptcha:performance.getEntriesByType('resource').some(entry=>/recaptcha|firebase-app-check/.test(entry.name))
    }))).toEqual({db:'undefined',featureStart:null,appCheckStart:null,recaptcha:false});

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
    await page.evaluate(()=>window.__pogoEnsureFullApp('app-check-contract-test'));
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

  test('a restored session remains private until App Check succeeds',async({page})=>{
    const scenario=await installRestoredFirebaseScenario(page,{appCheck:'delayed'});
    await page.goto(`./?restored-app-check-delay=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await scenario.appCheckRequested;
    await expect(page.locator('#preauth-pg')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.evaluate(()=>window.__privateUiWasVisible)).toBe(false);

    scenario.releaseAppCheck();
    await page.waitForFunction(()=>window.__pogoStartup.firebaseStartupSettledAt!==null);
    await expect(page.locator('#app')).toBeVisible();
    const timing=await page.evaluate(()=>({firstVisible:window.__privateUiFirstVisibleAt,appCheckReady:window.__pogoStartup.appCheckReadyAt}));
    expect(timing.firstVisible).toBeGreaterThanOrEqual(timing.appCheckReady);
  });

  test('App Check failure for a restored session exposes recovery without private UI',async({page})=>{
    await installRestoredFirebaseScenario(page,{appCheck:'failure'});
    await page.goto(`./?restored-app-check-failure=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__pogoStartup.firebaseStartupSettledAt!==null);
    await expect(page.locator('#preauth-pg')).toBeHidden();
    await expect(page.locator('#login-pg')).toBeVisible();
    await expect(page.locator('#login-user')).toBeEnabled();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#login-err')).not.toHaveText('');
    expect(await page.evaluate(()=>({privateUiWasVisible:window.__privateUiWasVisible,dbActive:db!==null,fbOn,protectionReady:firebaseDataProtectionReady,databaseCalls:window.__pogoMockDatabaseCalls}))).toEqual({
      privateUiWasVisible:false,dbActive:false,fbOn:false,protectionReady:false,databaseCalls:[]
    });
  });

  test('late App Check completion cannot reactivate a session after Auth is lost',async({page})=>{
    const scenario=await installRestoredFirebaseScenario(page,{appCheck:'delayed'});
    await page.goto(`./?restored-auth-loss=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await scenario.appCheckRequested;
    await expect(page.locator('#app')).toBeHidden();
    await page.evaluate(()=>window.__emitPogoMockAuth(null));
    await expect(page.locator('#login-pg')).toBeVisible();

    scenario.releaseAppCheck();
    await page.waitForFunction(()=>window.__pogoStartup.firebaseStartupSettledAt!==null);
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#login-pg')).toBeVisible();
    expect(await page.evaluate(()=>({privateUiWasVisible:window.__privateUiWasVisible,currentAuthUid,authUid:auth?.currentUser?.uid||'',protectedListens:window.__pogoMockDatabaseCalls.filter(value=>/^listen:(users|authIndex|wishlist|dynamax|gmax|costumes)\//.test(value))}))).toEqual({
      privateUiWasVisible:false,currentAuthUid:'',authUid:'',protectedListens:[]
    });
  });

  test('localized pre-auth copy resolves before the signed-in catalog path runs',async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('pogoUiLocale:v1','de'));
    await page.goto(`./?localized-preauth=${Date.now()}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__pogoShellReady===true);
    expect(await page.evaluate(()=>document.documentElement.lang)).toBe('de');
    await expect(page.locator('#login-user')).toHaveAttribute('placeholder','Trainername eingeben oder auswählen…');
    expect(await page.evaluate(()=>window.__pogoStartup.catalogsReadyAt)).toBeNull();
    expect(await page.evaluate(()=>typeof window.PogoI18n?.core)).toBe('undefined');
  });
});
