const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const path=require('node:path');

const screenshotDir=process.env.BATCH_B_SCREENSHOT_DIR||'';

async function openFixture(page){
  await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app')||url.hostname.endsWith('googleapis.com'),route=>route.abort());
  await page.goto(`./?batch-b=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderMyList==='function'&&typeof openSettingsPanel==='function'&&_authStateKnown===true);
  return page.evaluate(()=>{
    managedSubscriptions?.unsubscribeAll?.();
    managedListenerLifecycle?.deactivateSession?.('batch_b_fixture');
    db=null;fbOn=false;managedFirebaseClient=null;
    cur='BatchBTester';auth={currentUser:{uid:'uid-batch-b-tester'}};
    allData=normalizeData({
      users:{BatchBTester:{avatarPokemon:'Pikachu'}},
      wishlist:{BatchBTester:{Pikachu:'H',Bulbasaur:'H[lucky]',Charizard:'M(shiny)',Snorlax:'L'}}
    });
    managedSessionCache.activate({uid:'uid-batch-b-tester',username:'BatchBTester'});
    managedSessionCache.writeData(allData);
    myListType='wishlist';bulkMode=false;reorderMode=false;bulkSelected.clear();
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
    document.getElementById('tab-mylist').classList.add('active');
    updateFcDisplay();renderMyList();
    return avatarOptionEntries().length;
  });
}

async function screenshot(page,name){
  if(!screenshotDir)return;
  mkdirSync(screenshotDir,{recursive:true});
  await page.screenshot({path:path.join(screenshotDir,`${name}.png`),fullPage:true});
}

test('dense My List keeps editing progressive and reorder explicit',async({page},testInfo)=>{
  await openFixture(page);
  await expect(page.locator('#mylist-out .myrow')).toHaveCount(4);
  await expect(page.locator('#mylist-out .drag-handle')).toHaveCount(0);
  await expect(page.locator('#mylist-out .myrow-priority-editor')).toHaveCount(0);
  const firstRow=page.locator('#mylist-out .myrow').first();
  const movedName=await firstRow.getAttribute('data-name');
  const box=await firstRow.boundingBox();expect(box.height).toBeGreaterThanOrEqual(56);expect(box.height).toBeLessThanOrEqual(68);
  const quick=firstRow.locator('.myrow-priority-quick');
  if(testInfo.project.name==='mobile')await expect(quick).toBeHidden();else await expect(quick).toBeVisible();
  await firstRow.locator('.myrow-edit').click();
  await expect(firstRow.locator('.myrow-priority-editor button')).toHaveCount(3);
  await firstRow.locator('.myrow-priority-editor button').nth(1).click();
  await expect(page.locator(`#mylist-out .myrow[data-name="${movedName}"]`)).toHaveAttribute('data-priority','M');
  await page.locator('#mylist-reorder-toggle').click();
  await expect(page.locator('#mylist-reorder-toggle')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#mylist-out .drag-handle')).toHaveCount(4);
  await page.locator('#mylist-reorder-toggle').click();
  await expect(page.locator('#mylist-out .drag-handle')).toHaveCount(0);
  await screenshot(page,`${testInfo.project.name}-my-list`);
});

test('avatar picker, Legal surface, and sprite fallback run without remote writes',async({page},testInfo)=>{
  const avatarCount=await openFixture(page);expect(avatarCount).toBeGreaterThan(800);
  await page.evaluate(()=>openSettingsPanel('account',{updateHistory:false,captureScroll:false}));
  await page.evaluate(()=>selectSettingsSection('profile',{focus:false,keepList:false,updateHistory:false}));
  await page.locator('#prof-av-open').click();
  await expect(page.locator('#prof-av-results .profile-avatar-option')).toHaveCount(24);
  await page.locator('#prof-av-search').fill('flying pikachu');
  const resultCount=await page.locator('#prof-av-results .profile-avatar-option').count();expect(resultCount).toBeGreaterThan(1);expect(resultCount).toBeLessThanOrEqual(48);
  if(screenshotDir){mkdirSync(screenshotDir,{recursive:true});await page.locator('#prof-av-dialog').screenshot({path:path.join(screenshotDir,`${testInfo.project.name}-avatar-picker.png`)});}
  await page.locator('#prof-av-search').press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('#prof-av-input')).not.toHaveValue('');
  await page.locator('#prof-av-clear').click();
  await expect(page.locator('#prof-av-input')).toHaveValue('');
  await page.evaluate(()=>selectSettingsSection('legal',{focus:false,updateHistory:false}));
  await expect(page.locator('[data-settings-section="legal"]')).toBeVisible();
  await expect(page.locator('#legal-source-list li')).toHaveCount(7);
  await expect(page.locator('#legal-source-list a')).toHaveCount(7);
  const fallback=await page.evaluate(()=>{
    const next='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"%3E%3C/svg%3E';
    const img=document.createElement('img');img.dataset.fallbacks=next;img.dataset.fallbackIndex='0';img.style.display='block';
    Object.defineProperties(img,{naturalWidth:{value:1},naturalHeight:{value:1}});validateSpriteLoad(img);
    return{src:img.src,next,remaining:img.dataset.fallbacks,display:img.style.display};
  });
  expect(fallback.src).toBe(fallback.next);expect(fallback.remaining).toBe('');expect(fallback.display).toBe('block');
  await screenshot(page,`${testInfo.project.name}-legal`);
});

test('canonical sprite matrix stays contained and catalog operations stay lightweight',async({page},testInfo)=>{
  const avatarCount=await openFixture(page);
  const metrics=await page.evaluate(()=>{
    const entries=avatarOptionEntries();
    const resolverStarted=performance.now();
    let resolverOperations=0;
    for(let pass=0;pass<10;pass++)for(const entry of entries){
      spriteCatalogContext(entry.no,entry.name,entry.displayName,entry.catalogId);
      resolverOperations++;
    }
    const resolverMs=performance.now()-resolverStarted;
    openSettingsPanel('account',{updateHistory:false,captureScroll:false});
    selectSettingsSection('profile',{focus:false,keepList:false,updateHistory:false});
    openAvatarPicker();
    const searchStarted=performance.now();renderAvatarPicker('pikachu');
    const avatarSearchMs=performance.now()-searchStarted;
    const byName=(pattern)=>entries.find(entry=>pattern.test(entry.name)||pattern.test(entry.displayName));
    const byCatalog=(fragment)=>entries.find(entry=>entry.catalogId.includes(fragment));
    const samples=[
      byName(/^Bulbasaur$/i),byName(/^Wailord$/i),byName(/^Rayquaza$/i),byName(/^Exeggutor$/i),
      byName(/^(G-Ponyta|G\.? Ponyta)$/i),byName(/^Nidoran-F$/i),byCatalog('PIKACHU_FLYING_5TH_ANNIV'),
      byCatalog('PIKACHU_FLYING_OKINAWA'),byName(/Pikachu.*Safari/i),byCatalog('PIKACHU_ANNIVERSARY_2026'),
      byCatalog('PIKACHU_WCS_2025'),byName(/Pikachu.*Detective/i),byName(/Unown \(A\)/i)
    ].filter(Boolean);
    for(const entry of entries){if(samples.length>=13)break;if(!samples.some(sample=>sample.catalogId===entry.catalogId))samples.push(entry);}
    const slots=[['autocomplete','sprite-slot-autocomplete',28],['my-list','sprite-slot-list',34],['find-by-pokemon','sprite-slot-card',40],['public-profile','sprite-slot-card',40],['avatar','sprite-slot-avatar',48]];
    const host=document.createElement('section');host.id='batch-b-sprite-matrix';host.setAttribute('aria-label','Batch B sprite matrix');
    host.style.cssText='position:relative;z-index:9999;margin:16px;padding:16px;background:var(--surface-raised);color:var(--text);display:grid;gap:12px';
    host.innerHTML=samples.map((entry,index)=>{const [surface,slot,size]=slots[index%slots.length];return`<div class="sprite-matrix-item" data-surface="${surface}" style="display:grid;grid-template-columns:72px minmax(0,1fr);align-items:center;gap:10px"><span class="${slot}" style="display:inline-flex;align-items:center;justify-content:center">${spriteImg(entry.no,size,'batch-b-matrix-sprite',entry.name,'',entry.displayName,{catalogId:entry.catalogId})}</span><span>${escHtml(entry.displayName)} · ${surface}</span></div>`;}).join('');
    document.body.appendChild(host);
    return{avatarCount:entries.length,resolverOperations,resolverMs,avatarSearchMs,avatarResults:document.querySelectorAll('#prof-av-results .profile-avatar-option').length,sampleCount:samples.length};
  });
  expect(metrics.avatarCount).toBe(avatarCount);expect(metrics.avatarCount).toBeGreaterThan(800);
  expect(metrics.resolverOperations).toBeGreaterThan(8000);expect(metrics.resolverMs).toBeLessThan(1000);
  expect(metrics.avatarSearchMs).toBeLessThan(1000);expect(metrics.avatarResults).toBeGreaterThan(1);expect(metrics.sampleCount).toBeGreaterThanOrEqual(11);
  await expect(page.locator('#batch-b-sprite-matrix .sprite-matrix-item')).toHaveCount(metrics.sampleCount);
  const containment=await page.locator('#batch-b-sprite-matrix .sprite-matrix-item').evaluateAll(items=>items.map(item=>{
    const slot=item.querySelector('span'),img=item.querySelector('img'),slotStyle=getComputedStyle(slot),imgStyle=img&&getComputedStyle(img);
    return{width:slot.getBoundingClientRect().width,height:slot.getBoundingClientRect().height,overflow:slotStyle.overflow,objectFit:imgStyle?.objectFit};
  }));
  for(const item of containment){expect([28,34,40,48]).toContain(Math.round(item.width));expect(Math.round(item.height)).toBe(Math.round(item.width));expect(item.overflow).not.toBe('hidden');expect(item.objectFit).toBe('contain');}
  console.log(`BATCH_B_PERF ${JSON.stringify(metrics)}`);
  if(screenshotDir){mkdirSync(screenshotDir,{recursive:true});await page.locator('#batch-b-sprite-matrix').screenshot({path:path.join(screenshotDir,`${testInfo.project.name}-sprite-matrix.png`)});}
});
