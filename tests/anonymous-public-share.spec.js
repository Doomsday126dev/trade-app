const {test,expect}=require('@playwright/test');
const path=require('node:path');

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

const paddedSpritePath=path.join(__dirname,'..','assets','sprites','go','pikachu-world-champs-2025.png');
const regularSprite='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#8b7cf6"/></svg>';

async function installPublicFirebase(page,{exists=true,projection=publicProjection}={}){
  const requests=[];
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/sw.js*',route=>route.abort());
  await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
  const spriteResponse=route=>{
    const padded=route.request().url().includes('snom.png')||route.request().url().includes('/872.png');
    if(padded)return route.fulfill({path:paddedSpritePath,contentType:'image/png',headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'}});
    return route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'},body:regularSprite});
  };
  await page.route('https://img.pokemondb.net/**',spriteResponse);
  await page.route('https://images.weserv.nl/**',spriteResponse);
  await page.route('https://raw.githubusercontent.com/PokeAPI/sprites/**',route=>route.fulfill({
    contentType:'image/svg+xml',
    headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'},
    body:regularSprite
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
    body:`const projection=${JSON.stringify(projection)};
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
    await expect(page.locator('.public-share-pokemon-sprite').first()).toHaveAttribute('src',/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/home\/female\/25\.png/);
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

  test('costume art stays exact and transparent-canvas sprites normalize without shifting cards',async({page})=>{
    const projection={...publicProjection,lists:{
      ...publicProjection.lists,
      wishlist:{
        Snom:{p:'H'},
        'Pikachu (Worlds 2025)':{p:'M'},
        'Pikachu (Worlds 2026)':{p:'L'}
      }
    }};
    const requests=await installPublicFirebase(page,{projection});
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});

    const snom=page.locator('.share-pcard').filter({hasText:'Snom'});
    const worlds2025=page.locator('.share-pcard').filter({hasText:'Pikachu (Worlds 2025)'});
    const worlds2026=page.locator('.share-pcard').filter({hasText:'Pikachu (Worlds 2026)'});
    await expect(snom.locator('img')).toHaveAttribute('data-optical-ready','true');
    const geometry=await snom.evaluate(card=>({
      cardHeight:card.getBoundingClientRect().height,
      column:card.querySelector('.share-pcard-sprite-wrap').getBoundingClientRect().width,
      scale:Number(card.querySelector('img').style.transform.match(/[\d.]+/)?.[0]||1)
    }));
    expect(geometry.cardHeight).toBeGreaterThanOrEqual(52);
    expect(geometry.column).toBeGreaterThanOrEqual(32);
    expect(geometry.column).toBeLessThanOrEqual(34);
    expect(geometry.scale).toBeGreaterThanOrEqual(1);
    expect(requests.some(url=>/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/home\/872\.png/.test(url))).toBe(true);

    await expect(worlds2025.locator('img')).toHaveAttribute('src',/assets\/sprites\/go\/pikachu-world-champs-2025\.png/);
    await expect(worlds2025.locator('img')).toHaveAttribute('data-optical-ready','true');
    expect(await worlds2025.locator('img').evaluate(image=>Number(image.style.transform.match(/[\d.]+/)?.[0]||1))).toBeGreaterThan(1.5);
    await expect(worlds2026.locator('.public-share-pokemon-mark.known-unavailable')).toHaveText('?');
    await expect(worlds2026.locator('img')).toHaveCount(0);
    expect(await page.locator('.public-share-pokemon-sprite').evaluateAll(images=>images.some(image=>/\/pikachu(?:-female)?\.png$/.test(new URL(image.src).pathname)))).toBe(false);
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
