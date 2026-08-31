const {test,expect}=require('@playwright/test');

async function mockSignedOutAuth(page){
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('https://fonts.gstatic.com/**',route=>route.abort());
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:'export function initializeApp(config,name){return{config,name}}'
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:'const auth={currentUser:null};export function getAuth(){return auth}export function onAuthStateChanged(_auth,listener){queueMicrotask(()=>listener(null));return()=>{}}'
  }));
}

test.describe('development-only Google entry point',()=>{
  test('public privacy notice loads without Firebase Auth or provider modules',async({page})=>{
    const requested=[];page.on('request',request=>requested.push(new URL(request.url()).pathname));
    await page.goto('/?legal=privacy');
    await expect(page.locator('#privacy-pg')).toBeVisible();
    await expect(page.locator('#privacy-title')).toHaveText('Privacy notice');
    await expect(page.locator('#login-pg')).toBeHidden();
    await expect(page.locator('#privacy-google')).toBeVisible();
    expect(requested.some(path=>path.includes('/firebase-auth.js'))).toBe(false);
    expect(requested.some(path=>path.endsWith('/js/services/googleAuthAdapter.js'))).toBe(false);
  });

  test('ordinary production shell keeps Google absent',async({page})=>{
    const requested=[];page.on('request',request=>requested.push(new URL(request.url()).pathname));
    await mockSignedOutAuth(page);await page.goto('/');
    await expect(page.locator('#login-pg')).toBeVisible();await expect(page.locator('#google-login-option')).toBeHidden();
    expect(requested.some(path=>path.endsWith('/js/services/googleAuthAdapter.js'))).toBe(false);
    expect(requested.some(path=>path.endsWith('/js/domain/providerOnboardingModel.js'))).toBe(false);
    const cachedPaths=await page.evaluate(async()=>{
      await navigator.serviceWorker.ready;
      const shellName=(await caches.keys()).find(name=>name.startsWith('shell-pogo-trades-'));
      if(!shellName)return[];
      return(await(await caches.open(shellName)).keys()).map(request=>new URL(request.url).pathname);
    });
    expect(cachedPaths.some(path=>path.endsWith('/js/services/googleAuthAdapter.js'))).toBe(false);
    expect(cachedPaths.some(path=>path.endsWith('/js/domain/providerOnboardingModel.js'))).toBe(false);
  });

  test('explicit configured development gate reveals a localized 48px Google action without overflow',async({page})=>{
    await page.addInitScript(()=>{
      window.__POGO_PROVIDER_LINKING_DEV__=true;
      window.__POGO_PROVIDER_LINKING_CONFIGURED__=['google'];
      localStorage.setItem('pogoUiLocale:v1','de');
    });
    await mockSignedOutAuth(page);await page.goto('/');
    const button=page.locator('#google-login-button');await expect(button).toBeVisible();await expect(button).toHaveText('Mit Google fortfahren');
    const geometry=await button.evaluate(node=>{const button=node.getBoundingClientRect(),card=node.closest('.lcard').getBoundingClientRect();return{height:button.height,left:button.left,right:button.right,cardLeft:card.left,cardRight:card.right,viewport:document.documentElement.scrollWidth<=innerWidth};});
    expect(geometry.height).toBeGreaterThanOrEqual(48);expect(geometry.left).toBeGreaterThanOrEqual(geometry.cardLeft);expect(geometry.right).toBeLessThanOrEqual(geometry.cardRight);expect(geometry.viewport).toBe(true);
  });
});
