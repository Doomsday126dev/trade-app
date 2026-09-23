'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');

test.use({serviceWorkers:'block'});
const HIGH_NAMES=Object.freeze([
  'Arrokuda','Flittle','Unown (Z)','Unown (M)','Shedinja',
  'P-Tauros (Aqua)','P-Tauros (Blaze)','P-Tauros (Combat)','H-Typhlosion',
  'Spinda (Form 7)','Spinda (Form 1)','Spinda (Form 2)','Spinda (Form 6)',
  'Relicanth','Rotom','Rotom (Frost)','Rotom (Fan)','Rotom (Heat)','Rotom (Wash)',
  'A-Raichu','G-Yamask','Galarian Articuno','Pikachu','Raichu','Eevee','Mewtwo',
  'Snorlax','Bulbasaur','Charmander','Squirtle','Pidgey','Rattata','Sandshrew',
  'Nidoran-F','Nidoran-M','Vulpix','Zubat','Oddish','Diglett','Psyduck',
  'Growlithe','Abra','Machop','Geodude','Slowpoke','Magnemite','Gastly'
]);
const HIGH_COMMAND='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&1,4,7,16,19,25,26,27,29,32,37,41,43,50,54,58,63,66,74,79,81,92,128,133,143,144,150,157,201,292,327,369,479,562,846,955';
const PATTERNS=Object.freeze(['Archipelago','Continental','Elegant','Garden','High Plains','Icy Snow','Jungle','Marine','Meadow','Modern','Monsoon','Ocean','Polar','River','Sandstorm','Savanna','Sun','Tundra']);
const SPINDA=Object.freeze([...Array.from({length:8},(_,i)=>`Spinda (Form ${i+1})`),'Spinda (Heart)']);
const ARTIFACT_DIR=process.env.SECTION_ACCEPTANCE_OUTPUT_DIR||'';
const artifact=name=>{
  if(!ARTIFACT_DIR)return'';
  fs.mkdirSync(ARTIFACT_DIR,{recursive:true});
  return path.join(ARTIFACT_DIR,name);
};

async function bootstrap(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    return url.origin===origin||request.resourceType()==='image'?route.continue():route.abort();
  });
  await page.route('**/sw.js*',route=>route.abort());
  await page.goto('./?section-pattern-acceptance');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('section-pattern-acceptance'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  return errors;
}
async function install(page,{patterns=false}={}){
  const errors=await bootstrap(page);
  const setup=await page.evaluate(({highNames,patternNames,spindaNames,patterns})=>{
    managedListenerLifecycle?.deactivateSession?.('section_pattern_acceptance');
    managedListenerLifecycle?.clearSelectedTrainer?.('section_pattern_acceptance');
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='PatternFixture';auth={currentUser:{uid:'synthetic-pattern-fixture'}};
    const high=patterns?[...patternNames,...spindaNames]:highNames;
    // The screenshot-shaped fixture includes two reviewed species absent from
    // this seed's selectable source. Add only synthetic catalog rows in memory.
    for(const name of high){
      if(listSource('wishlist').some(entry=>entry.name===name||entry.displayName===name))continue;
      const no=PogoDomain.publicPokemonDex.dex(name);
      if(no)DB.wishlist.push({no,name,displayName:name,users:{}});
    }
    accountSyncCatalogIndex=null;myListSourceMapCache.clear();spriteIndex=null;
    const missing=high.filter(name=>!listSource('wishlist').some(entry=>entry.name===name||entry.displayName===name));
    const wishlist=Object.fromEntries(high.map(name=>[name,'H']));
    if(!patterns){wishlist.Snom='M';wishlist.Joltik='L';}
    const board=patterns?{lf:[],ft:[]}:{lf:[
      {name:'Pichu',no:172,p:'',lucky:true},
      {name:'Bidoof',no:399,p:'',shiny:true},
      {name:'Wailmer',no:320,p:'',xxl:true},
      {name:'Yungoos',no:734,p:'',xxs:true}
    ],ft:[]};
    allData=normalizeData({users:{PatternFixture:{authUid:'synthetic-pattern-fixture',specialTradeBoard:board}},wishlist:{PatternFixture:wishlist},dynamax:{PatternFixture:{}},gmax:{PatternFixture:{}},costumes:{PatternFixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent='Pattern Fixture';document.getElementById('my-av').textContent='P';
    document.getElementById('top-un').textContent='Pattern Fixture';
    switchTab('mylist',{render:false});renderMyList();
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__sectionCopied=value;}}});
    window.__sectionCopied='';window.__sectionBefore=JSON.stringify(allData);
    return{missing,highCount:productDeclarations().entries.filter(e=>e.p==='H').length,
      unresolved:productDeclarations().entries.filter(e=>e.p==='H'&&!PogoDomain.searchStrings.contextualEntryIdentity(e).resolved).map(e=>({name:e.name,no:e.no}))};
  },{highNames:HIGH_NAMES,patternNames:PATTERNS.map(p=>`Scatterbug (${p})`),spindaNames:SPINDA,patterns});
  expect(setup.missing).toEqual([]);
  expect(setup.highCount).toBe(patterns?27:47);
  expect(setup.unresolved).toEqual([]);
  expect(errors).toEqual([]);
}

test('47-entry High and independent sections copy literal full commands across filters and collapse',async({page})=>{
  await install(page);
  const high=page.locator('#combined-list > [data-wants-section="H"]');
  await expect(high.locator('.wants-row')).toHaveCount(47);
  await expect(high.locator('[data-contextual-copy]')).toHaveCount(1);
  await expect(high.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',HIGH_COMMAND);
  await expect(high.locator('.contextual-details')).toBeHidden();
  await expect(high).not.toContainText('Copy protected search');
  await expect(high).not.toContainText('Copy broad special search');
  await high.locator('[data-contextual-copy]').click();
  expect(await page.evaluate(()=>__sectionCopied)).toBe(HIGH_COMMAND);
  const literal={
    M:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&872',
    L:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&595',
    LUCKY:'!4*&!shiny&CP-2500&!shadow&!purified&!background&lucky&172',
    SHINY:'!4*&!traded&CP-2500&!shadow&!purified&!background&399',
    XXL:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxl&320',
    XXS:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxs&734'
  };
  for(const [key,expected] of Object.entries(literal)){
    const section=page.locator(`#combined-list > [data-wants-section="${key}"]`);
    await expect(section.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',expected);
    await section.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__sectionCopied)).toBe(expected);
  }
  await page.evaluate(()=>setWantsFindOpen(true));
  await page.locator('#combined-filter').fill('No visible match');
  await expect(high.locator('.wants-row')).toHaveCount(0);
  await high.locator('[data-contextual-copy]').click();
  expect(await page.evaluate(()=>__sectionCopied)).toBe(HIGH_COMMAND);
  await high.locator('.mylist-priority-toggle').click();
  await high.locator('[data-contextual-copy]').click();
  expect(await page.evaluate(()=>__sectionCopied)).toBe(HIGH_COMMAND);
  await high.locator('.mylist-priority-toggle').click();
  await page.locator('#combined-filter').fill('');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__sectionBefore));
  await page.evaluate(()=>{wantsCollapsedSections.clear();setWantsFindOpen(false);renderMyList();document.querySelectorAll('.contextual-copy-status').forEach(node=>node.textContent='');});
  await expect(high.locator('.wants-row')).toHaveCount(47);
  await expect(high.locator('.wants-row').first()).toBeVisible();
  await page.locator('#theme-toggle').click();
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await high.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
  await expect.poll(()=>high.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:15000}).toBe(true);
  await expect.poll(()=>high.locator('.wants-row').first().evaluate(row=>getComputedStyle(row).opacity)).toBe('1');
  await page.waitForTimeout(300);
  const desktopViewport=artifact('my-list-desktop-viewport.png');if(desktopViewport)await page.screenshot({path:desktopViewport});
  const desktop=artifact('my-list-desktop.png');if(desktop)await page.screenshot({path:desktop,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  const mobileViewport=artifact('my-list-390px-viewport.png');if(mobileViewport)await page.screenshot({path:mobileViewport});
  const mobile=artifact('my-list-390px.png');if(mobile)await page.screenshot({path:mobile,fullPage:true});
  const outputs=artifact('section-commands.json');if(outputs)fs.writeFileSync(outputs,JSON.stringify({high:HIGH_COMMAND,...literal},null,2)+'\n');
});

test('all Scatterbug and Spinda identities retain distinct rows, correct art, and species search',async({page})=>{
  await install(page,{patterns:true});
  const high=page.locator('#combined-list > [data-wants-section="H"]');
  await expect(high.locator('.wants-row')).toHaveCount(27);
  await expect(high.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&327,664');
  const rows=await high.locator('.wants-row').evaluateAll(nodes=>nodes.map(node=>({name:node.dataset.name,src:node.querySelector('img')?.getAttribute('src')||'',placeholder:!!node.querySelector('.pc-sprite-placeholder')})));
  expect(new Set(rows.map(row=>row.name)).size).toBe(27);
  for(const row of rows){
    expect(row.placeholder,row.name).toBe(false);
    if(row.name.startsWith('Scatterbug'))expect(row.src,row.name).toMatch(/\/664\.png$/);
    else expect(row.src,row.name).toMatch(new RegExp(`spinda-${row.name==='Spinda (Heart)'?'09':row.name.match(/Form (\d+)/)[1].padStart(2,'0')}\\.png$`));
  }
  await high.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
  await expect.poll(()=>high.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:15000}).toBe(true);
  const exportPaths=await page.evaluate(names=>names.map(name=>{
    const entry=listSource('wishlist').find(row=>row.name===name);
    return{name,paths:exportSpriteFallbackUrls({...entry,spriteUrl:entrySpriteUrl(entry,name)})};
  }),[...PATTERNS.map(p=>`Scatterbug (${p})`),...SPINDA]);
  for(const row of exportPaths)expect(row.paths[0],row.name).toContain(row.name.startsWith('Scatterbug')?'/664.png':'/spinda-');
  const imageBlob=await page.evaluate(async()=>{
    const entries=productDeclarations().entries;
    const blob=await renderProductShareImage(entries,'PatternFixture');
    return{type:blob.type,size:blob.size};
  });
  expect(imageBlob.type).toBe('image/png');expect(imageBlob.size).toBeGreaterThan(5000);
  await page.evaluate(()=>{
    document.getElementById('app').style.display='none';document.getElementById('share-view').classList.add('active');
    renderShareView('PatternFixture','wishlist');
  });
  await expect(page.locator('#share-list-out .share-pcard')).toHaveCount(27);
  await expect(page.locator('#share-list-out [data-contextual-copy]')).toHaveAttribute('data-contextual-copy','!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&327,664');
  await expect(page.locator('#share-list-out .share-pcard img')).toHaveCount(27);
  await expect.poll(()=>page.locator('#share-list-out .share-pcard img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:15000}).toBe(true);
  await page.evaluate(()=>{
    document.getElementById('share-view').classList.remove('active');document.getElementById('app').style.display='flex';renderMyList();
    const sheet=document.createElement('div');sheet.id='pattern-contact-sheet';
    sheet.style.cssText='position:fixed;inset:0;z-index:99999;background:#f8fafc;color:#14202b;padding:20px;overflow:auto;font:13px sans-serif;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px';
    for(const row of document.querySelectorAll('#combined-list .wants-row')){
      const card=document.createElement('div');card.style.cssText='background:white;border:1px solid #cad5df;border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;min-height:110px';
      const image=row.querySelector('img')?.cloneNode(true);if(image){image.loading='eager';image.style.cssText='width:88px;height:88px;object-fit:contain;flex:none';card.append(image);}
      const label=document.createElement('span');label.textContent=row.dataset.name;card.append(label);sheet.append(card);
    }
    document.body.append(sheet);
  });
  await expect.poll(()=>page.locator('#pattern-contact-sheet img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:15000}).toBe(true);
  const sheet=artifact('pattern-contact-sheet.png');if(sheet)await page.screenshot({path:sheet});
  const afterFailure=await page.evaluate(()=>{
    const first=document.querySelector('#combined-list [data-name="Scatterbug (Garden)"] img');
    first?.dispatchEvent(new Event('error'));
    return document.querySelector('#combined-list [data-wants-section="H"] [data-contextual-copy]')?.dataset.contextualCopy;
  });
  expect(afterFailure).toBe('!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&327,664');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__sectionBefore));
});

test('entire runtime-selectable catalog resolves species independently of art and renders in bounded chunks',async({page})=>{
  test.setTimeout(180000);
  await bootstrap(page);
  const result=await page.evaluate(()=>{
    const rows=[...listSource('wishlist'),...listSource('dynamax'),...listSource('gmax'),...listSource('costumes')];
    const seen=new Set(),unique=[];
    for(const row of rows){const key=`${row.catalogId||row.name}|${row.name}`;if(!seen.has(key)){seen.add(key);unique.push(row);}}
    const failures=[],explicitCandidates=[],counts={total:unique.length,resolved:0,exactArt:0,sharedArt:0,sourceArt:0,unavailable:0,ambiguousVisibleForm:0,rendered:0};
    for(let index=0;index<unique.length;index+=80){
      const chunk=unique.slice(index,index+80),host=document.createElement('div');
      for(const entry of chunk){
        const expected=Number(entry.no),actual=PogoDomain.searchStrings.contextualEntryIdentity(entry);
        const publicNo=PogoDomain.publicPokemonDex.dex(entry.name);
        if(!actual.resolved||actual.speciesId!==expected||publicNo!==expected){failures.push({name:entry.name,expected,actual:actual.speciesId,publicNo,kind:'species'});continue;}
        counts.resolved++;
        const reviewed=PogoDomain.costumeSpriteCatalog.resolution({name:entry.name});
        const equivalent=PogoDomain.spriteSlugs.verifiedEquivalentSpriteUrl(entry.name,expected);
        const url=entrySpriteUrl(entry,entry.name);
        const markup=spriteImg(expected,34,'sweep-art',entry.name,'',entry.displayName,{urlOverride:url,catalogId:entry.catalogId});
        host.insertAdjacentHTML('beforeend',`<div data-name="${entry.name.replaceAll('"','&quot;')}">${markup}</div>`);
        const node=host.lastElementChild,rendered=node.querySelector('img')?.getAttribute('src')||'';
        if(PogoDomain.spriteSlugs.isAmbiguousVisibleForm(entry.name,expected)){
          counts.ambiguousVisibleForm++;
          if(rendered||!node.querySelector('.pc-sprite-placeholder'))failures.push({name:entry.name,kind:'ambiguous-form-substitution',rendered});
        }
        else if(reviewed.status==='unavailable'){counts.unavailable++;if(rendered)failures.push({name:entry.name,kind:'unavailable-substitution',rendered});}
        else if(reviewed.status==='exact'){counts.exactArt++;if(rendered!==reviewed.urls[0])failures.push({name:entry.name,kind:'exact-art',rendered,expected:reviewed.urls[0]});}
        else if(equivalent){
          counts.sharedArt++;
          if(rendered!==equivalent)failures.push({name:entry.name,kind:'shared-art',rendered,expected:equivalent});
          explicitCandidates.push({name:entry.name,urls:[equivalent]});
        }
        else{
          counts.sourceArt++;
          if(!rendered&&!node.querySelector('.pc-sprite-placeholder'))failures.push({name:entry.name,kind:'renderer-empty'});
          if(PogoDomain.spriteSlugs.spriteSemanticIdentity(entry.name,'',expected).explicitForm&&rendered)
            explicitCandidates.push({name:entry.name,urls:spriteFallbackChain(expected,entry.name,'',entry.displayName||entry.name,entry.catalogId)});
        }
        counts.rendered++;
      }
      host.remove();
    }
    const genuineUnavailable=PogoDomain.costumeSpriteCatalog.records.filter(record=>record.status==='unavailable').map(record=>({names:record.names,no:record.no,reason:record.unavailableReason}));
    return{counts,failures:failures.slice(0,30),failureCount:failures.length,explicitCandidates,genuineUnavailable};
  });
  expect(result.failureCount,JSON.stringify(result.failures,null,2)).toBe(0);
  expect(result.counts.resolved).toBe(result.counts.total);
  expect(result.counts.sharedArt).toBeGreaterThanOrEqual(144);
  expect(result.counts.ambiguousVisibleForm).toBe(1);
  const sourceCandidates=result.explicitCandidates;
  const imageLoads=await page.evaluate(async candidates=>{
    const tryUrl=url=>new Promise(resolve=>{
      const image=new Image(),timer=setTimeout(()=>resolve('timeout'),5000);
      image.onload=()=>{clearTimeout(timer);resolve(image.naturalWidth>1?'loaded':'empty');};
      image.onerror=()=>{clearTimeout(timer);resolve('error');};
      image.src=url;
    });
    const results=Array(candidates.length);let next=0;
    await Promise.all(Array.from({length:16},async()=>{
      while(next<candidates.length){
        const index=next++,candidate=candidates[index];let loaded='',timedOut=false;
        for(const url of candidate.urls){const status=await tryUrl(url);if(status==='loaded'){loaded=url;break;}if(status==='timeout')timedOut=true;}
        results[index]={name:candidate.name,status:loaded?'loaded':timedOut?'timeout':'failed',url:loaded,candidates:candidate.urls};
      }
    }));
    return results;
  },sourceCandidates);
  result.imageLoadSample={candidateCount:sourceCandidates.length,checked:imageLoads.length,loaded:imageLoads.filter(row=>row.status==='loaded').length,
    failed:imageLoads.filter(row=>row.status==='failed'),timedOut:imageLoads.filter(row=>row.status==='timeout')};
  delete result.explicitCandidates;
  const report=artifact('catalog-resolution.json');if(report)fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
  expect(result.imageLoadSample.loaded).toBe(result.imageLoadSample.checked);
  expect(result.imageLoadSample.failed).toEqual([]);
  expect(result.imageLoadSample.timedOut).toEqual([]);
});
