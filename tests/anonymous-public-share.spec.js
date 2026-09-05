const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');

const publicProjection=Object.freeze({
  version:1,
  username:'PublicTrainer',
  profile:Object.freeze({friendCode:'1234 5678 9012',bio:'Public trade notes only.',discord:'public-trainer',avatarPokemon:'',lastUpdated:1_788_000_000_000}),
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
  test('legacy FT remains inert while public wants copy is localized and scoped',async({page})=>{
    const declaration=(intent,name,p='',extra={})=>({intent,name,category:'wishlist',p,mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...extra});
    const declarations=[declaration('lf','Pikachu','H'),declaration('lf','Eevee','', {gender:'f',note:'Public note'}),declaration('ft','Mewtwo','L'),declaration('ft','Mewtwo','M',{shiny:true}),declaration('ft','Charmander','H',{category:'dynamax'})];
    await installPublicFirebase(page,{projection:{...publicProjection,version:2,declarations,declarationCount:declarations.length}});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__unifiedCopy=text;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    for(const [width,locale] of [[320,'en'],[390,'ja'],[430,'es'],[1440,'de']]){
      await page.setViewportSize({width,height:900});
      await page.locator('#share-language-trigger').click();await page.locator('#settings-language').selectOption(locale);await page.keyboard.press('Escape');
      for(const intent of ['lf']){
        await expect(page.locator('[data-public-share-action="intent"]')).toHaveCount(0);
        await expect(page.locator('.share-pcard')).toHaveCount(2);
        const expected=await page.evaluate(({intent,locale})=>PogoDomain.searchStrings.contextualSearchPlan((intent==='lf'?[25,133]:[150]).map(no=>({no})),{locale}).parts[0],{intent,locale});
        await page.locator('[data-contextual-copy]').click();
        expect(await page.evaluate(()=>window.__unifiedCopy)).toBe(expected);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.evaluate(()=>{
          const button=document.querySelector('[data-public-share-action="copy-friend"]').getBoundingClientRect();
          const meta=document.querySelector('.share-hdr-meta').getBoundingClientRect();
          const header=document.querySelector('#share-hdr').getBoundingClientRect();
          return button.top>=meta.bottom&&button.right<=header.right&&meta.right<=header.right;
        })).toBe(true);
        if(process.env.TRUSTED_READINESS_SCREENSHOT_DIR){
          fs.mkdirSync(process.env.TRUSTED_READINESS_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.TRUSTED_READINESS_SCREENSHOT_DIR,`unified-public-${intent}-${width}-${locale}.png`)});
        }
      }
    }
    await expect(page.locator('[data-list-type="dynamax"]')).toHaveCount(0);
    await expect(page.locator('#share-list-out')).not.toContainText('Mewtwo');
    await assertPublicPrivacy(page);
  });
  test('unprioritized entries remain neutral and friend-code copy needs no account',async({page})=>{
    await installPublicFirebase(page,{projection:{...publicProjection,lists:{...publicProjection.lists,wishlist:{Pikachu:'L',Eevee:'[shiny]'}}}});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__friendCodeCopy=text;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const neutral=page.locator('.share-section').filter({hasText:'Other entries'});
    await expect(neutral).toContainText('Eevee');await expect(neutral).not.toContainText('Pikachu');
    await expect(page.locator('.share-section').filter({hasText:'Low'})).toContainText('Pikachu');
    await page.getByRole('button',{name:'Copy friend code'}).click();
    expect(await page.evaluate(()=>window.__friendCodeCopy)).toBe('123456789012');
    await assertPublicPrivacy(page);
  });
  test('viewer locale, category and clipboard behavior use the canonical search on the anonymous route',async({page})=>{
    await page.addInitScript(()=>{
      localStorage.setItem('pogoUiLocale:v1','ja');
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{
        if(window.__denyCopy)throw new Error('clipboard-denied');
        window.__copiedSearch=value;
      }}});
    });
    const projection={...publicProjection,language:'de',lists:{...publicProjection.lists,
      dynamax:{Charmander:{p:'H'}},costumes:{'Pikachu (Worlds 2025)':{p:'H'}}}};
    await installPublicFirebase(page,{projection});
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const copy=page.locator('[data-contextual-copy]');
    for(const locale of ['ja','en','es','de']){
      await page.locator('#share-language-trigger').click();
      await page.locator('#settings-language').selectOption(locale);
      await page.locator('#settings-modal button:visible').first().focus();
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(()=>document.getElementById('settings-modal').contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#settings-modal')).not.toHaveClass(/open/);
      await expect(page.locator('#share-language-trigger')).toBeFocused();
      const expected=await page.evaluate(locale=>PogoDomain.searchStrings.contextualSearchPlan([25,133].map(no=>({no})),{locale}).parts[0],locale);
      await expect(copy).toHaveAttribute('data-contextual-copy',expected);
      await copy.click();
      expect(await page.evaluate(()=>window.__copiedSearch)).toBe(expected);
      await expect(page.locator('.contextual-copy-status')).not.toBeEmpty();
      expect(await copy.innerText()).not.toContain('share.');
    }
    await page.locator('[data-list-type="dynamax"]').click();
    await expect(copy).toHaveAttribute('data-contextual-copy',await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan([4].map(no=>({no})),{locale:'de'}).parts[0]));
    await page.locator('[data-list-type="costumes"]').click();
    await expect(copy).toHaveAttribute('data-contextual-copy',await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan([25].map(no=>({no})),{locale:'de'}).parts[0]));
    await page.evaluate(()=>{window.__denyCopy=true;});
    await copy.click();
    await expect(page.locator('.contextual-search')).toHaveAttribute('open','');
    await expect(page.locator('.contextual-search textarea')).toBeFocused();
    expect(await page.locator('.contextual-search textarea').evaluate(node=>node.selectionEnd-node.selectionStart)).toBeGreaterThan(0);
    await assertPublicPrivacy(page);
  });

  test('locale fallback and four responsive sizes preserve a usable public action',async({browser})=>{
    for(const [saved,browserLocale,expected,width,height] of [
      ['', 'ja-JP','ja',320,568],['es','de-DE','es',390,844],
      ['fr','de-DE','de',430,932],['','fr-FR','en',1440,900]
    ]){
      const context=await browser.newContext({locale:browserLocale,viewport:{width,height}});
      const page=await context.newPage();
      await page.addInitScript(value=>{if(value)localStorage.setItem('pogoUiLocale:v1',value);},saved);
      await installPublicFirebase(page);
      await page.goto('./?view=PublicTrainer&list=wishlist');
      await expect(page.locator('[data-contextual-copy]')).toBeVisible();
      expect(await page.evaluate(()=>PogoI18n.core.getLocale())).toBe(expected);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const box=await page.locator('[data-contextual-copy]').boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      if(process.env.PRODUCT_AUDIT_SCREENSHOT_DIR){
        for(const sprite of await page.locator('.public-share-pokemon-sprite').all())await expect(sprite).toHaveAttribute('data-optical-ready','true');
        fs.mkdirSync(process.env.PRODUCT_AUDIT_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.PRODUCT_AUDIT_SCREENSHOT_DIR,`public-${width}-${expected}.png`),fullPage:true});
      }
      await context.close();
    }
  });

  test('empty categories offer no search and unknown entries never silently disappear from a query',async({page})=>{
    await installPublicFirebase(page,{projection:{...publicProjection,lists:{...publicProjection.lists,wishlist:{'Unmapped Event Form':{p:'H'}}}}});
    await page.goto('./?view=PublicTrainer&list=wishlist');
    await expect(page.locator('[data-contextual-copy]')).toHaveCount(0);
    await expect(page.locator('.contextual-search')).toContainText('cannot be included');
    await page.goto('./?view=PublicTrainer&list=gmax');
    await expect(page.locator('.public-share-empty')).toBeVisible();
    await expect(page.locator('[data-contextual-copy]')).toHaveCount(0);
  });
  test('direct signed-out link renders only the public projection after App Check',async({page})=>{
    const requests=await installPublicFirebase(page);
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-hdr')).toContainText('PublicTrainer’s trade list');
    await expect(page.locator('#share-hdr')).toContainText('1234 5678 9012');
    await expect(page.locator('#share-hdr')).toContainText('Public trade notes only.');
    await expect(page.locator('#share-list-out')).toContainText('Pikachu');
    await expect(page.locator('#share-list-out')).not.toContainText('Chicago 2026');
    await expect(page.locator('.background-badge-kind')).toHaveCount(0);
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

  test('provider-only public share resolves through the anonymous callable without Auth or RTDB fallback',async({page})=>{
    await page.addInitScript(()=>{window.__POGO_PROVIDER_CAPABILITIES__={providerPublicReadSupport:true};});
    const requests=await installPublicFirebase(page,{exists:false});
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js',route=>route.fulfill({
      contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},
      body:`const projection=${JSON.stringify(publicProjection)};
        export function getFunctions(app,region){return{app,region}}
        export function httpsCallable(_functions,name,options){return async body=>{
          globalThis.__providerPublicCall={name,options,body};return{data:{code:'SUCCESS',share:projection}};
        }}`
    }));
    await page.goto('./?view=PublicTrainer&list=wishlist',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#share-view')).toBeVisible();
    await expect(page.locator('#share-hdr')).toContainText('PublicTrainer');
    await expect(page.locator('#share-list-out')).toContainText('Pikachu');
    const evidence=await page.evaluate(()=>({
      call:window.__providerPublicCall,
      reads:window.__publicShareReads||[],
      diagnostics:window.__pogoPublicShareDiagnostics,
      authLoaded:performance.getEntriesByType('resource').some(entry=>/firebase-auth\.js/.test(entry.name))
    }));
    expect(evidence.call).toEqual({name:'readE1ProviderPublicShare',options:{limitedUseAppCheckTokens:true},
      body:{schemaVersion:1,trainerHandle:'PublicTrainer'}});
    expect(JSON.stringify(evidence.call)).not.toMatch(/uid|idToken|authorization|email|credential/i);
    expect(evidence.reads).toEqual([]);
    expect(evidence.diagnostics.readPaths).toEqual(['gateway:trainer-handle']);
    expect(evidence.authLoaded).toBe(false);
    expect(requests.some(url=>/firebase-auth\.js/.test(url))).toBe(false);
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
    await expect(worlds2026.locator('.public-share-pokemon-mark.known-unavailable')).toHaveAttribute('aria-label','Artwork not yet available for Pikachu (Worlds 2026)');
    await expect(worlds2026.locator('.public-share-pokemon-mark.known-unavailable')).toHaveAttribute('title','Artwork not yet available for Pikachu (Worlds 2026)');
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
