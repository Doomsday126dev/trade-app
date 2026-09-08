const {test,expect}=require('@playwright/test');
const candidates=/\/(?:data\/firebaseReadRegistry|domain\/trainerPreferenceSync|data\/trainerPreferencesRepository|data\/trainerPreferenceSyncQueue|ui\/trainerTagPanel|app\/publicShareApp)\.js(?:\?|$)/;
const identity={uid:'boot-qualification-uid',username:'BootQualification'};

// Fake only Firebase SDK/transport, never the application login or session code.
// Every credential and record here is synthetic; no production endpoint is used.
async function installLoginTransport(page){
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
    return route.abort();
  });
  await page.route('**/sw.js*',route=>route.abort());
  await page.addInitScript(()=>{
    localStorage.setItem('pogoTourSeen',JSON.stringify(Date.now()));
    localStorage.setItem('pogoWhatsNewSeen',JSON.stringify(Date.now()));
  });
  const fulfill=(route,body)=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body});
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>fulfill(route,'export function initializeApp(){return {name:"boot-qualification"}}'));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',route=>fulfill(route,`
    const user={uid:${JSON.stringify(identity.uid)},providerData:[{providerId:'password'}]};
    const auth={currentUser:localStorage.getItem('__bootMockAuthenticated')?user:null},listeners=new Set();
    function emit(value){auth.currentUser=value;for(const listener of listeners)listener(value)}
    export function getAuth(){return auth}
    export function onAuthStateChanged(_auth,listener){listeners.add(listener);queueMicrotask(()=>listener(auth.currentUser));return()=>listeners.delete(listener)}
    export async function signInWithEmailAndPassword(_auth,email,pin){
      if(pin!=='123456')throw Object.assign(new Error('wrong synthetic PIN'),{code:'auth/wrong-password'});
      globalThis.__bootSignIns=(globalThis.__bootSignIns||0)+1;
      localStorage.setItem('__bootMockAuthenticated','true');user.email=email;emit(user);return{user};
    }
    export async function createUserWithEmailAndPassword(){throw new Error('Account creation is outside this fixture')}
    export async function signOut(){localStorage.removeItem('__bootMockAuthenticated');emit(null)}
    export async function updatePassword(){}export async function deleteUser(){}
  `));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',route=>fulfill(route,'export class ReCaptchaEnterpriseProvider{}export function initializeAppCheck(){return {}}'));
  const remote={
    loginDirectory:{[identity.username]:{authReady:true,authVersion:1}},
    authIndex:{[identity.uid]:{username:identity.username}},
    users:{[identity.username]:{authUid:identity.uid,authVersion:1,pinHashed:true}},
    wishlist:{[identity.username]:{Pikachu:'H'}},dynamax:{[identity.username]:{}},gmax:{[identity.username]:{}},costumes:{[identity.username]:{}}
  };
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>fulfill(route,`
    const remote=JSON.parse(localStorage.getItem('__bootMockRemote')||${JSON.stringify(JSON.stringify(remote))}),listeners=new Set();
    const clone=value=>value==null?null:structuredClone(value);
    const read=path=>path?path.split('/').reduce((node,key)=>node?.[key],remote)??null:remote;
    const snapshot=path=>({exists:()=>read(path)!=null,val:()=>clone(read(path))});
    const put=(path,value)=>{const parts=path.split('/'),last=parts.pop();let node=remote;for(const part of parts)node=node[part]??={};node[last]=clone(value)};
    const notify=()=>{localStorage.setItem('__bootMockRemote',JSON.stringify(remote));for(const item of listeners)queueMicrotask(()=>item.listener(snapshot(item.path)))};
    globalThis.__bootReads=[];globalThis.__bootWrites=[];
    export function getDatabase(){return {}}export function ref(_db,path=''){return {path}}
    export async function get({path}){__bootReads.push(path);return snapshot(path)}
    export function onValue({path},listener){const item={path,listener};listeners.add(item);queueMicrotask(()=>listener(snapshot(path)));return()=>listeners.delete(item)}
    export async function set({path},value){__bootWrites.push(path);put(path,value);notify()}
    export async function update({path},value){__bootWrites.push(path);for(const [key,item] of Object.entries(value))put([path,key].filter(Boolean).join('/'),item);notify()}
    export async function runTransaction({path},updater){const next=updater(clone(read(path)));if(next===undefined)return {committed:false,snapshot:snapshot(path)};__bootWrites.push(path);put(path,next);notify();return {committed:true,snapshot:snapshot(path)}}
    export function serverTimestamp(){return Date.now()}
  `));
  // Exercise the real readiness boundary instead of relying on local SDK speed.
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',async route=>{
    await new Promise(resolve=>setTimeout(resolve,150));
    await route.fallback();
  });
}
async function assertReducedRuntime(page,expected){
  const scripts=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.initiatorType==='script'&&new URL(entry.name).origin===location.origin).map(entry=>entry.name));
  expect(scripts.filter(url=>candidates.test(url))).toEqual([]);
  expect(scripts.length).toBe(expected);
  expect(await page.evaluate(()=>({registry:typeof PogoData.firebaseReadRegistry,sync:typeof PogoDomain.trainerPreferenceSync,repository:typeof PogoData.trainerPreferencesRepository,queue:typeof PogoData.trainerPreferenceSyncQueue,tagPanel:typeof window.PogoUI?.trainerTagPanel,publicApp:typeof __pogoStartPublicShare}))).toEqual({registry:'undefined',sync:'undefined',repository:'undefined',queue:'undefined',tagPanel:'undefined',publicApp:'undefined'});
}

test('fresh Username/PIN login and restored authenticated session use the reduced graph',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installLoginTransport(page);
  await page.goto('./?boot-login-qualification');
  await expect(page.locator('#login-user')).toBeEnabled();
  await page.locator('#login-user').fill(identity.username);
  await page.locator('#login-pin').fill('123456');
  await page.waitForFunction(()=>typeof managedLoginDirectory!=='undefined'&&firebaseDataProtectionReady&&managedLoginDirectory.snapshot().status==='loaded');
  await page.locator('#login-btn').click();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(()=>__bootSignIns)).toBe(1);
  expect(await page.evaluate(()=>({user:cur,uid:auth.currentUser.uid,ready:firebaseDataProtectionReady}))).toEqual({user:identity.username,uid:identity.uid,ready:true});
  await assertReducedRuntime(page,67);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(()=>cur)).toBe(identity.username);
  expect(await page.evaluate(()=>window.__bootSignIns||0)).toBe(0);
  await assertReducedRuntime(page,67);
  expect(errors).toEqual([]);
});

test('non-English feature loading retains translations without disabled modules',async({page})=>{
  await installLoginTransport(page);
  await page.addInitScript(()=>localStorage.setItem('pogoUiLocale:v1','de'));
  await page.goto('./?boot-german-qualification');
  await page.evaluate(()=>__pogoEnsureFullApp('boot-german-qualification'));
  await page.waitForFunction(()=>window.__pogoStartup.firebaseStartupSettledAt!==null);
  expect(await page.evaluate(()=>PogoI18n.core.getLocale())).toBe('de');
  await assertReducedRuntime(page,68);
});

test('installed offline shell retains the independent public-route code without private application loading',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,serviceWorkers:'allow'});
  try{
    const page=await context.newPage();
    await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    await page.goto('./?boot-offline-shell');
    await page.evaluate(async()=>{await navigator.serviceWorker.register(`./sw.js?v=${__POGO_RELEASE_ID}`);await navigator.serviceWorker.ready});
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    const cached=await page.evaluate(async()=>{
      const cache=await caches.open(`shell-pogo-trades-${__POGO_RELEASE_ID}`);
      return (await cache.keys()).map(request=>new URL(request.url).pathname);
    });
    expect(cached.some(path=>path.endsWith('/js/app/publicShareApp.js'))).toBe(true);
    expect(cached.some(path=>path.endsWith('/js/data/firebaseReadRegistry.js'))).toBe(false);
    await context.setOffline(true);
    await page.goto('./?view=BootQualification&list=wishlist', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof __pogoStartPublicShare==='function');
    expect(await page.evaluate(()=>typeof window.PogoDomain?.accountSyncModel)).toBe('undefined');
    expect(await page.evaluate(()=>typeof window.renderMyList)).toBe('undefined');
    await expect(page.locator('#app')).toBeHidden();
    // Offline support preserves route code, not a cached private/public payload.
    await expect(page.locator('#share-view')).toBeVisible();
  }finally{await context.close()}
});
