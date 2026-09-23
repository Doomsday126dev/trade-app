const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');

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

// Literal policy oracles must retain the requirements in each fixture. Deriving
// an expected query from only {no} incorrectly treats special wants as ordinary.
const PUBLIC_POLICY_QUERIES=Object.freeze({
  en:{ordinaryPikachu:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25',specialPikachu:'!4*&!traded&CP-2500&!shadow&!purified&!background&25',specialEevee:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&133'},
  ja:{ordinaryPikachu:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25',specialPikachu:'!4*&!こうかん&cp-2500&!しゃどう&!らいと&!はいけい&25',specialEevee:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&133'},
  es:{ordinaryPikachu:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25',specialPikachu:'!4*&!intercambiados&PC-2500&!oscuro&!purificado&!fondo&25',specialEevee:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&133'},
  de:{ordinaryPikachu:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25',specialPikachu:'!4*&!getauscht&WP-2500&!Crypto&!Erlöst&!hintergrund&25',specialEevee:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&133'}
});

function representativePublicProjection(){
  const declaration=(name,p='',extra={})=>({intent:'lf',name,category:'wishlist',p,mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...extra});
  const declarations=[
    declaration('Pikachu','H',{gender:'f',shiny:true,note:'Female shiny wanted'}),
    declaration('Sinistea','M',{mod:'Antique'}),declaration('Bulbasaur','L'),
    declaration('Pikachu','',{lucky:true}),declaration('Snorlax','',{xxl:true}),
    declaration('Joltik','',{xxs:true}),declaration('Gengar','',{shiny:true}),
    declaration('Ralts','',{lucky:true,shiny:true}),declaration('Mewtwo','',{note:'Legacy request'})
  ];
  return{...publicProjection,version:2,declarations,declarationCount:declarations.length};
}

async function installPublicFirebase(page,{exists=true,projection=publicProjection,realSprites=false}={}){
  const requests=[];
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/sw.js*',route=>route.abort());
  await page.route('https://static.cloudflareinsights.com/**',route=>route.abort());
  const spriteResponse=route=>{
    if(realSprites)return route.continue();
    const padded=route.request().url().includes('snom.png')||route.request().url().includes('/872.png');
    if(padded)return route.fulfill({path:paddedSpritePath,contentType:'image/png',headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'}});
    return route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'},body:regularSprite});
  };
  await page.route('https://img.pokemondb.net/**',spriteResponse);
  await page.route('https://images.weserv.nl/**',spriteResponse);
  await page.route('https://raw.githubusercontent.com/PokeAPI/sprites/**',route=>realSprites?route.continue():route.fulfill({
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
  test('reviewed Max and Rockruff shared art works without private catalog data and never guesses a Gmax style',async({page})=>{
    const names=['Charmander (Dynamax)','Toxtricity (Amped) (Dynamax)','Toxtricity (Low Key) (Dynamax)','Urshifu (Single Strike) (Dynamax)','Urshifu (Rapid Strike) (Dynamax)','Rockruff (Dusk)','Urshifu (Gigantamax)'];
    const declarations=names.map(name=>({intent:'lf',name,category:name.includes('Gigantamax')?'gmax':name.includes('Dynamax')?'dynamax':'wishlist',p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false}));
    await installPublicFirebase(page,{projection:{...publicProjection,version:2,declarations,declarationCount:7},realSprites:true});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__maxSearch=value;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const cards=page.locator('#share-list-out .share-pcard');
    await expect(cards).toHaveCount(1);
    expect(await page.evaluate(()=>typeof POGO_TRADE_DB)).toBe('undefined');
    const expected={
      'Charmander (Dynamax)':'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/4.png',
      'Toxtricity (Amped) (Dynamax)':'https://img.pokemondb.net/sprites/home/normal/toxtricity-amped.png',
      'Toxtricity (Low Key) (Dynamax)':'https://img.pokemondb.net/sprites/home/normal/toxtricity-low-key.png',
      'Urshifu (Single Strike) (Dynamax)':'https://img.pokemondb.net/sprites/home/normal/urshifu-single-strike.png',
      'Urshifu (Rapid Strike) (Dynamax)':'https://img.pokemondb.net/sprites/home/normal/urshifu-rapid-strike.png',
      'Rockruff (Dusk)':'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/744.png',
      'Urshifu (Gigantamax)':null
    };
    const seen=[];
    for(const [category,count,query] of [
      ['wishlist',1,'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&744'],
      ['dynamax',5,'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&4,849,892'],
      ['gmax',1,'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&892']
    ]){
      await page.locator(`[data-list-type="${category}"]`).click();
      await expect(cards).toHaveCount(count);
      await cards.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
      const imageCount=category==='gmax'?0:count;
      await expect.poll(()=>cards.locator('img').evaluateAll(images=>images.filter(image=>image.complete&&image.naturalWidth>1).length),{timeout:30000}).toBe(imageCount);
      for(const row of await cards.evaluateAll(nodes=>nodes.map(node=>({name:node.querySelector('.share-pcard-name').textContent,src:node.querySelector('img')?.getAttribute('src')||null})))){
        expect(row.src,row.name).toBe(expected[row.name]);seen.push(row.name);
      }
      await expect(cards.locator('.public-share-pokemon-mark')).toHaveCount(category==='gmax'?1:0);
      const copy=page.locator('[data-want-section="H"] [data-contextual-copy]');
      await expect(copy).toHaveCount(1);await copy.click();
      expect(await page.evaluate(()=>__maxSearch)).toBe(query);
    }
    expect(new Set(seen)).toEqual(new Set(names));
    await assertPublicPrivacy(page);
  });

  test('all 27 pattern identities load through anonymous bootstrap and image failures cannot remove search species',async({page,browser})=>{
    const patterns=['Archipelago','Continental','Elegant','Garden','High Plains','Icy Snow','Jungle','Marine','Meadow','Modern','Monsoon','Ocean','Polar','River','Sandstorm','Savanna','Sun','Tundra'];
    const names=[...patterns.map(pattern=>`Scatterbug (${pattern})`),...Array.from({length:8},(_,index)=>`Spinda (Form ${index+1})`),'Spinda (Heart)'];
    const declarations=names.map(name=>({intent:'lf',name,category:'wishlist',p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false}));
    const projection={...publicProjection,version:2,declarations,declarationCount:27};
    await installPublicFirebase(page,{projection,realSprites:true});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__patternSearch=value;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const cards=page.locator('#share-list-out .share-pcard');
    await expect(cards).toHaveCount(27);
    await cards.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
    await expect.poll(()=>cards.locator('img').evaluateAll(images=>images.length===27&&images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:30000}).toBe(true);
    const rendered=await cards.evaluateAll(nodes=>nodes.map(node=>({name:node.querySelector('.share-pcard-name').textContent,src:node.querySelector('img')?.getAttribute('src')})));
    expect(new Set(rendered.map(row=>row.name)).size).toBe(27);
    for(const row of rendered){
      if(row.name.startsWith('Scatterbug'))expect(row.src,row.name).toBe('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/664.png');
      else{
        const number=row.name==='Spinda (Heart)'?'09':row.name.match(/Form (\d+)/)[1].padStart(2,'0');
        expect(row.src,row.name).toBe(`assets/sprites/go/spinda-${number}.png`);
      }
    }
    const expected='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&327,664';
    const copy=page.locator('[data-want-section="H"] [data-contextual-copy]');
    await expect(copy).toHaveCount(1);await copy.click();
    expect(await page.evaluate(()=>__patternSearch)).toBe(expected);
    await assertPublicPrivacy(page);
    // A fresh context prevents the already decoded successful images from
    // satisfying the forced-failure case out of the browser's memory cache.
    const failed=await browser.newPage();
    await installPublicFirebase(failed,{projection,realSprites:true});
    await failed.route('**/__pattern_art_unavailable__.png',route=>route.fulfill({status:404,body:'Forced fixture artwork failure'}));
    await failed.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__patternSearch=value;}}}));
    await failed.goto('./?view=PublicTrainer&list=wishlist');
    const failedCards=failed.locator('#share-list-out .share-pcard'),failedCopy=failed.locator('[data-want-section="H"] [data-contextual-copy]');
    await expect(failedCards).toHaveCount(27);
    await failedCards.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';image.src='/__pattern_art_unavailable__.png';}));
    await expect(failedCards.locator('.public-share-pokemon-mark')).toHaveCount(27);
    await expect(failedCopy).toHaveAttribute('data-contextual-copy',expected);await failedCopy.click();
    expect(await failed.evaluate(()=>__patternSearch)).toBe(expected);
    await expect(failed.locator('#share-list-out .contextual-omitted')).toHaveCount(0);
    expect(await failedCards.locator('.share-pcard-name').allTextContents()).toEqual(rendered.map(row=>row.name));
    await assertPublicPrivacy(failed);
    await failed.close();
  });

  test('public section copy preserves priority, standalone requirements and distinct same-species wants',async({page})=>{
    const projection=representativePublicProjection();
    await installPublicFirebase(page,{projection,realSprites:!!process.env.WANT_WORKFLOW_SCREENSHOT_DIR});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__sectionCopy=text;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    await expect(page.locator('.share-pcard')).toHaveCount(projection.declarationCount);
    await expect(page.locator('#share-list-out > .contextual-search')).toHaveCount(0);
    await expect(page.locator('#share-list-out select')).toHaveCount(0);
    await expect(page.locator('#share-list-out')).not.toContainText('Other entries');
    await expect(page.locator('[data-want-section="NEEDS_PRIORITY"] .share-section-title')).toContainText('Priority not set');
    await expect(page.locator('#share-list-out')).not.toContainText('Needs priority');
    await expect(page.locator('[data-want-section="L"] .contextual-details')).toBeHidden();
    await expect(page.locator('[data-want-section="LUCKY"] .contextual-details')).toBeHidden();
    for(const [key,expected] of [
      ['H','!4*&!traded&CP-2500&!shadow&!purified&!background&25'],
      ['M','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&854'],
      ['L','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&1'],
      ['LUCKY','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25'],
      ['XXL','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxl&143'],
      ['XXS','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxs&595'],
      ['SHINY','!4*&!traded&CP-2500&!shadow&!purified&!background&94'],
      ['LUCKY+SHINY','!4*&!traded&CP-2500&!shadow&!purified&!background&280'],
      ['NEEDS_PRIORITY','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&150']
    ]){
      const section=page.locator(`[data-want-section="${key}"]`);
      await expect(section.locator('.share-pcard')).toHaveCount(1);
      await expect(section.locator('.share-pcard .badge')).toHaveCount(0);
      await section.locator('[data-contextual-copy]').click();
      expect(await page.evaluate(()=>window.__sectionCopy)).toBe(expected);
      await expect(section.locator('textarea')).toBeHidden();
    }
    const high=page.locator('[data-want-section="H"]'),lucky=page.locator('[data-want-section="LUCKY"]');
    await expect(high.locator('.share-pcard-flag.shiny')).toHaveCount(1);
    await expect(lucky.locator('.share-pcard-flag.lucky')).toHaveCount(0);
    await expect(page.locator('[data-want-section="LUCKY+SHINY"] .share-pcard-flag')).toHaveCount(0);
    await expect(high).toContainText('Female shiny wanted');
    await expect(lucky).not.toContainText('Female shiny wanted');
    await high.locator('[data-public-share-action="toggle-section"]').click();
    await expect(high.locator('.share-pcard')).toHaveCount(0);
    await expect(lucky.locator('.share-pcard')).toHaveCount(1);
    await high.locator('[data-contextual-copy]').click();
    await high.locator('[data-public-share-action="toggle-section"]').click();
    await expect(high.locator('.share-pcard')).toHaveCount(1);
    await expect(high.locator('[data-public-share-action="toggle-section"]')).toBeFocused();
    for(const [width,theme] of [[1440,'dark'],[390,'dark'],[320,'dark'],[390,'light']]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      for(const button of await page.locator('[data-contextual-copy]').all())expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
      if(process.env.WANT_WORKFLOW_SCREENSHOT_DIR&&(!process.env.WANT_WORKFLOW_CAPTURE_ONLY_390||width===390&&theme==='dark')){
        const folder=path.join(process.env.WANT_WORKFLOW_SCREENSHOT_DIR,'after');
        fs.mkdirSync(folder,{recursive:true});
        await page.locator('#share-list-out img').evaluateAll(images=>images.forEach(image=>image.loading='eager'));
        await expect.poll(()=>page.locator('#share-list-out img').evaluateAll(images=>images.every(image=>image.complete)),{timeout:30000}).toBe(true);
        await page.locator('.contextual-copy-status').evaluateAll(nodes=>nodes.forEach(node=>node.textContent=''));
        await page.screenshot({path:path.join(folder,`public-${width}-${theme}.png`),fullPage:true});
      }
    }
    await assertPublicPrivacy(page);
  });

  test('paired public baseline evidence uses the same synthetic recipient wants',async({page})=>{
    test.skip(!process.env.WANT_WORKFLOW_BASELINE_REF||!process.env.WANT_WORKFLOW_SCREENSHOT_DIR,'Explicit visual review capture only.');
    await installPublicFirebase(page,{projection:representativePublicProjection(),realSprites:true});
    for(const file of ['css/app.css','js/app/publicShareApp.js','js/ui/stringHtml.js']){
      const body=execFileSync('git',['show',`${process.env.WANT_WORKFLOW_BASELINE_REF}:${file}`],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
      await page.route(`**/${file}*`,route=>route.fulfill({body,contentType:file.endsWith('.css')?'text/css':'application/javascript'}));
    }
    await page.goto('./?view=PublicTrainer&list=wishlist');
    await expect(page.locator('.share-pcard')).toHaveCount(9);
    const folder=path.join(process.env.WANT_WORKFLOW_SCREENSHOT_DIR,'before');
    fs.mkdirSync(folder,{recursive:true});
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await page.locator('#share-list-out img').evaluateAll(images=>images.forEach(image=>image.loading='eager'));
      await expect.poll(()=>page.locator('#share-list-out img').evaluateAll(images=>images.every(image=>image.complete)),{timeout:30000}).toBe(true);
      await page.screenshot({path:path.join(folder,`public-${width}-dark.png`),fullPage:true});
    }
    await assertPublicPrivacy(page);
  });

  test('one thousand public wants stay bounded and section copy includes entries beyond the visible page',async({page})=>{
    const wishlist=Object.fromEntries(Array.from({length:999},(_,index)=>[`Synthetic Pokémon ${String(index).padStart(4,'0')}`,'H']));
    wishlist.Mewtwo='H';
    await installPublicFirebase(page,{projection:{...publicProjection,lists:{...publicProjection.lists,wishlist}}});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__largeSectionCopy=text;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const high=page.locator('[data-want-section="H"]');
    await expect(high.locator('.share-pcard')).toHaveCount(80);
    await expect(high.locator('.share-section-toggle')).toContainText('1,000 entries');
    await expect(high.locator('.share-pgrid')).not.toContainText('Mewtwo');
    expect(await high.locator('*').count()).toBeLessThan(1300);
    const copy=high.locator('[data-contextual-copy]');
    await copy.click();
    const expected='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&150';
    expect(await page.evaluate(()=>window.__largeSectionCopy)).toBe(expected);
    await high.locator('[data-public-share-action="toggle-section"]').click();
    await expect(high.locator('.share-pcard')).toHaveCount(0);
    await copy.click();
    expect(await page.evaluate(()=>window.__largeSectionCopy)).toBe(expected);
    await high.locator('[data-public-share-action="toggle-section"]').click();
    await high.locator('[data-public-share-action="more-section"]').click();
    await expect(high.locator('.share-pcard')).toHaveCount(160);
    while(await high.locator('[data-public-share-action="more-section"]').count())await high.locator('[data-public-share-action="more-section"]').click();
    await expect(high.locator('.share-pcard')).toHaveCount(1000);
    await expect(high.locator('.share-pgrid')).toContainText('Mewtwo');
    await assertPublicPrivacy(page);
  });

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
        for(const [key,queryKey] of [['H','ordinaryPikachu'],['NEEDS_PRIORITY','specialEevee']]){
          const expected=PUBLIC_POLICY_QUERIES[locale][queryKey];
          await page.locator(`[data-want-section="${key}"] [data-contextual-copy]`).click();
          expect(await page.evaluate(()=>window.__unifiedCopy)).toBe(expected);
        }
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
  test('unprioritized special entries keep their meaning and friend-code copy needs no account',async({page})=>{
    await installPublicFirebase(page,{projection:{...publicProjection,lists:{...publicProjection.lists,wishlist:{Pikachu:'L',Eevee:'[shiny]'}}}});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__friendCodeCopy=text;}}}));
    await page.goto('./?view=PublicTrainer&list=wishlist');
    const neutral=page.locator('[data-want-section="SHINY"]');
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
    const section=page.locator('[data-want-section="H"]'),copy=section.locator('[data-contextual-copy]');
    for(const locale of ['ja','en','es','de']){
      await page.locator('#share-language-trigger').click();
      await page.locator('#settings-language').selectOption(locale);
      await page.locator('#settings-modal button:visible').first().focus();
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(()=>document.getElementById('settings-modal').contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#settings-modal')).not.toHaveClass(/open/);
      await expect(page.locator('#share-language-trigger')).toBeFocused();
      const expected=PUBLIC_POLICY_QUERIES[locale].specialPikachu;
      await expect(copy).toHaveAttribute('data-contextual-copy',expected);
      await copy.click();
      expect(await page.evaluate(()=>window.__copiedSearch)).toBe(expected);
      await expect(section.locator('.contextual-copy-status')).not.toBeEmpty();
      expect(await copy.innerText()).not.toContain('share.');
    }
    await page.locator('[data-list-type="dynamax"]').click();
    await expect(copy).toHaveAttribute('data-contextual-copy','!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&4');
    await page.locator('[data-list-type="costumes"]').click();
    await expect(copy).toHaveAttribute('data-contextual-copy','!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25');
    await page.evaluate(()=>{window.__denyCopy=true;});
    await copy.click();
    await expect(section.locator('.contextual-details')).toHaveAttribute('open','');
    await expect(section.locator('.contextual-search textarea')).toBeFocused();
    expect(await section.locator('.contextual-search textarea').evaluate(node=>node.selectionEnd-node.selectionStart)).toBeGreaterThan(0);
    await assertPublicPrivacy(page);
  });

  test('regional-form clipboard policy is independent of interface and Pokémon GO languages',async({browser})=>{
    const declaration={intent:'lf',name:'H-Typhlosion',category:'wishlist',p:'H',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false};
    const projection={...publicProjection,version:2,declarations:[declaration],declarationCount:1};
    for(const [interfaceLocale,gameLocale,expected] of [
      ['ja','en','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&157'],
      ['en','ja','!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&157']
    ]){
      const context=await browser.newContext();
      const page=await context.newPage();
      await page.addInitScript(({interfaceLocale,gameLocale})=>{
        localStorage.setItem('pogoUiLocale:v1',interfaceLocale);
        localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify(gameLocale));
        localStorage.setItem('pogoPokemonGoSearchLocaleOverride:v1','true');
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__regionalCopy=value;}}});
      },{interfaceLocale,gameLocale});
      await installPublicFirebase(page,{projection});
      await page.goto('./?view=PublicTrainer&list=wishlist');
      expect(await page.evaluate(()=>PogoI18n.core.getLocale())).toBe(interfaceLocale);
      const copy=page.locator('[data-want-section="H"] [data-contextual-copy]');
      await expect(copy).toHaveAttribute('data-contextual-copy',expected);
      await copy.click();
      expect(await page.evaluate(()=>window.__regionalCopy)).toBe(expected);
      await context.close();
    }
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
      await expect(page.locator('[data-contextual-copy]').first()).toBeVisible();
      expect(await page.evaluate(()=>PogoI18n.core.getLocale())).toBe(expected);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const box=await page.locator('[data-contextual-copy]').first().boundingBox();
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
    await expect(page.locator('.contextual-search')).toContainText('1 not included');
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
