const {test,expect}=require('@playwright/test');

const publicProjection=Object.freeze({
  version:1,
  username:'PublicTrainer',
  profile:Object.freeze({friendCode:'1234 5678 9012',bio:'Public trade notes only.',discord:'public-trainer',lastUpdated:1_788_000_000_000}),
  lists:Object.freeze({
    wishlist:Object.freeze({
      Pikachu:Object.freeze({p:'H',mod:'female',shiny:true,backgroundId:'location-gofest2026chicago'}),
      Eevee:Object.freeze({p:'M'})
    }),
    dynamax:Object.freeze({}),
    gmax:Object.freeze({}),
    costumes:Object.freeze({})
  }),
  publishedListTypes:Object.freeze(['wishlist','dynamax','gmax','costumes']),
  updatedAt:1_788_000_000_000
});

async function installPublicFirebase(page,{exists=true}={}){
  const requests=[];
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/sw.js*',route=>route.abort());
  await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
  await page.route('https://img.pokemondb.net/**',route=>route.fulfill({
    contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#8b7cf6"/></svg>'
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:"export function initializeApp(config,name){globalThis.__publicFirebaseApp={config,name};return globalThis.__publicFirebaseApp}"
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:`export class ReCaptchaEnterpriseProvider{constructor(siteKey){this.siteKey=siteKey}}
      export function initializeAppCheck(){globalThis.__publicShareOrder=['app-check-init'];return{kind:'public-app-check'}}
      export async function getToken(){globalThis.__publicShareOrder.push('app-check-token');globalThis.__publicShareTokenReady=true;return{token:'test-only'}}`
  }));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>route.fulfill({
    contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
    body:`const projection=${JSON.stringify(publicProjection)};
      export function getDatabase(){return{kind:'public-database'}}
      export function ref(_database,path){return{path}}
      export async function get(target){
        globalThis.__publicShareOrder.push('database-read');
        globalThis.__publicShareReads=(globalThis.__publicShareReads||[]).concat(target.path);
        if(!globalThis.__publicShareTokenReady)throw new Error('read-before-app-check');
        return{exists:()=>${exists?'true':'false'},val:()=>${exists?'projection':'null'}};
      }`
  }));
  return requests;
}

async function assertPublicPrivacy(page){
  await expect(page.locator('#share-view')).toBeVisible();
  await expect(page.locator('#login-pg')).toBeHidden();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#share-language-trigger')).toBeVisible();
  await expect(page.locator('#share-list-out')).not.toContainText(/sync|favorite|journal|recovery|admin/i);
  const evidence=await page.evaluate(()=>({
    diagnostics:window.__pogoPublicShareDiagnostics,
    reads:window.__publicShareReads,
    order:window.__publicShareOrder,
    authLoaded:performance.getEntriesByType('resource').some(entry=>/firebase-auth\.js/.test(entry.name)),
    privateModules:performance.getEntriesByType('resource').filter(entry=>/accountSync|trainerTagPanel|application\.js/.test(entry.name)).map(entry=>entry.name)
  }));
  expect(evidence.diagnostics.authSdkRequested).toBe(false);
  expect(evidence.diagnostics.privateReads).toBe(0);
  expect(evidence.reads).toEqual(['publicShares/PublicTrainer']);
  expect(evidence.order).toEqual(['app-check-init','app-check-token','database-read']);
  expect(evidence.authLoaded).toBe(false);
  expect(evidence.privateModules).toEqual([]);
}

test.describe('anonymous public share bootstrap',()=>{
  test('direct signed-out link renders only the public projection after App Check',async({page})=>{
    const requests=await installPublicFirebase(page);
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-hdr')).toContainText('PublicTrainer’s trade list');
    await expect(page.locator('#share-hdr')).toContainText('1234 5678 9012');
    await expect(page.locator('#share-hdr')).toContainText('Public trade notes only.');
    await expect(page.locator('#share-list-out')).toContainText('Pikachu');
    await expect(page.locator('#share-list-out')).toContainText('Chicago 2026');
    await expect(page.locator('#share-list-out')).toContainText('Create your trade list');
    await expect(page.locator('.public-share-pokemon-sprite')).toHaveCount(2);
    await expect(page.locator('.public-share-pokemon-sprite').first()).toHaveAttribute('src',/img\.pokemondb\.net\/sprites\/home\/normal\/pikachu-female\.png/);
    await expect(page.locator('.public-share-pokemon-mark')).toHaveCount(0);
    await assertPublicPrivacy(page);
    await page.locator('#app-legal-footer button').click();
    await expect(page.locator('#legal-dialog')).toBeVisible();
    await expect(page.locator('#legal-dialog')).toContainText('Data & asset acknowledgements');
    await expect(page.locator('#legal-dialog a')).toHaveCount(0);
    await expect(page.locator('#legal-dialog')).not.toContainText(/https?:\/\//);
    expect(requests.some(url=>/firebase-auth\.js/.test(url))).toBe(false);
  });

  test('fresh visitor context and mobile viewport keep the public route independent of login',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(()=>{
      localStorage.clear();sessionStorage.clear();
      localStorage.setItem('pgu','A previously signed-in browser must not affect this public route');
    });
    await installPublicFirebase(page);
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-view')).toBeVisible();
    await expect(page.locator('.share-pcard-name')).toContainText(['Pikachu','Eevee']);
    await expect(page.locator('.public-share-cta')).toBeVisible();
    await assertPublicPrivacy(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  });

  test('invalid links fail publicly without requesting Firebase',async({page})=>{
    const requests=[];page.on('request',request=>requests.push(request.url()));
    await page.route('**/sw.js*',route=>route.abort());
    await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
    await page.goto('./?view=bad.name&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-view')).toBeVisible();
    await expect(page.locator('#share-list-out')).toContainText('This shared-list link is not valid');
    await expect(page.locator('#login-pg')).toBeHidden();
    expect(requests.some(url=>/firebasejs/.test(url))).toBe(false);
  });

  test('nonexistent public projections show a clean public empty state',async({page})=>{
    await installPublicFirebase(page,{exists:false});
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-list-out')).toContainText('not published');
    await expect(page.locator('#login-pg')).toBeHidden();
    expect(await page.evaluate(()=>window.__publicShareReads)).toEqual(['publicShares/PublicTrainer']);
  });
});
