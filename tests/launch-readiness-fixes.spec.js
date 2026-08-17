const{test,expect}=require('@playwright/test');

async function openFixture(page,{preserveOrder=false}={}){
  await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app'),route=>route.abort());
  await page.goto(`./?launch-fixes=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof renderMyList==='function'&&_authStateKnown===true&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
  await page.evaluate(preserveOrder=>{
    managedSubscriptions?.unsubscribeAll?.();managedListenerLifecycle?.deactivateSession?.('launch_fixes');
    db=null;fbOn=false;managedFirebaseClient=null;cur='LaunchTester';auth={currentUser:{uid:'uid-launch-tester'}};currentAuthUid='uid-launch-tester';
    managedSessionCache.activate({uid:'uid-launch-tester',username:'LaunchTester'});
    if(!preserveOrder)localStorage.removeItem(myListOrderStorageKey('wishlist','LaunchTester'));
    const fixture=normalizeData({users:{LaunchTester:{}},wishlist:{LaunchTester:{Bulbasaur:'H',Pikachu:'H',Charmander:'H',Squirtle:'M',Snorlax:'M',Eevee:'L',Mew:'L'}}});
    saveLocal(fixture);allData=fixture;
    myListType='wishlist';bulkMode=false;reorderMode=false;bulkSelected.clear();_specialAcItems=null;
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));document.getElementById('tab-mylist').classList.add('active');renderMyList();
  },preserveOrder);
}

const names=locator=>locator.evaluateAll(rows=>rows.map(row=>row.dataset.name));

test('UX-01 historical, keyboard, desktop, pointer, priority, and reload ordering are authoritative',async({page})=>{
  await openFixture(page);
  const high=page.locator('[data-priority-section="H"] .myrow');
  await expect(high).toHaveCount(3);
  expect(await names(high)).toEqual(['Bulbasaur','Charmander','Pikachu']);
  await expect(page.locator('.drag-handle')).toHaveCount(0);
  await page.locator('#mylist-reorder-toggle').click();
  await expect(page.locator('.drag-handle')).toHaveCount(7);

  const pikachu=page.locator('.myrow[data-name="Pikachu"]');
  await pikachu.locator('[data-reorder-move="up"]').click();
  await pikachu.locator('[data-reorder-move="up"]').click();
  expect(await names(high)).toEqual(['Pikachu','Bulbasaur','Charmander']);
  await expect(page.locator('.myrow[data-name="Pikachu"] .drag-handle')).toBeFocused();
  await page.evaluate(()=>renderMyList());
  expect(await names(high)).toEqual(['Pikachu','Bulbasaur','Charmander']);

  await page.evaluate(()=>{
    const source=document.querySelector('.myrow[data-name="Pikachu"] .drag-handle'),target=document.querySelector('.myrow[data-name="Charmander"]');
    const box=target.getBoundingClientRect(),elementFromPoint=document.elementFromPoint.bind(document);document.elementFromPoint=()=>target;
    source.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:41,pointerType:'mouse',clientX:0,clientY:0}));
    source.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:41,pointerType:'mouse',clientX:box.left+2,clientY:box.top+2}));
    source.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41,pointerType:'mouse',clientX:box.left+2,clientY:box.top+2}));
    document.elementFromPoint=elementFromPoint;
  });
  expect(await names(high)).toEqual(['Bulbasaur','Charmander','Pikachu']);
  const rejected=await page.evaluate(()=>reorderMyListEntry('Pikachu','Squirtle'));
  expect(rejected).toBe(false);expect(await names(high)).toEqual(['Bulbasaur','Charmander','Pikachu']);

  await page.evaluate(()=>{
    const handle=document.querySelector('.myrow[data-name="Pikachu"] .drag-handle');
    const target=document.querySelector('.myrow[data-name="Bulbasaur"]');
    const box=target.getBoundingClientRect();
    const elementFromPoint=document.elementFromPoint.bind(document);document.elementFromPoint=()=>target;
    myListPointerStart({currentTarget:handle,pointerType:'touch',pointerId:17,preventDefault(){}});
    myListPointerMove({pointerId:17,clientX:box.left+4,clientY:box.top+4,preventDefault(){}});
    myListPointerEnd({pointerId:17});
    document.elementFromPoint=elementFromPoint;
  });
  expect(await names(high)).toEqual(['Pikachu','Bulbasaur','Charmander']);

  await page.evaluate(()=>movePriority('Pikachu','M'));
  expect(await names(page.locator('[data-priority-section="M"] .myrow'))).toEqual(['Squirtle','Snorlax','Pikachu']);
  await page.locator('#mylist-reorder-toggle').click();
  await expect(page.locator('.drag-handle')).toHaveCount(0);
  await page.evaluate(()=>{toggleReorderMode(true);renderMyList();});
  expect(await names(page.locator('[data-priority-section="M"] .myrow'))).toEqual(['Squirtle','Snorlax','Pikachu']);

  const orderRecord=await page.evaluate(()=>localStorage.getItem(myListOrderStorageKey('wishlist','LaunchTester')));
  expect(orderRecord).toContain('Pikachu');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>_authStateKnown===true&&typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    managedSubscriptions?.unsubscribeAll?.();db=null;fbOn=false;cur='LaunchTester';auth={currentUser:{uid:'uid-launch-tester'}};currentAuthUid='uid-launch-tester';managedSessionCache.activate({uid:'uid-launch-tester',username:'LaunchTester'});
    allData=normalizeData({users:{LaunchTester:{}},wishlist:{LaunchTester:{Bulbasaur:'H',Pikachu:'M',Charmander:'H',Squirtle:'M',Snorlax:'M',Eevee:'L',Mew:'L'}}});
    myListType='wishlist';document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));document.getElementById('tab-mylist').classList.add('active');renderMyList();
  });
  expect(await names(page.locator('[data-priority-section="M"] .myrow'))).toEqual(['Squirtle','Snorlax','Pikachu']);
});

test('UX-01 touch path remains usable at compact widths',async({page})=>{
  for(const width of[320,375,390,430]){
    await page.setViewportSize({width,height:780});await openFixture(page);await page.locator('#mylist-reorder-toggle').click();
    const result=await page.evaluate(pointerId=>{
      const source=document.querySelector('.myrow[data-name="Bulbasaur"] .drag-handle'),target=document.querySelector('.myrow[data-name="Pikachu"]'),box=target.getBoundingClientRect();
      const touchAction=getComputedStyle(source).touchAction,elementFromPoint=document.elementFromPoint.bind(document);
      document.elementFromPoint=()=>target;
      myListPointerStart({currentTarget:source,pointerType:'touch',pointerId,preventDefault(){}});
      myListPointerMove({pointerId,clientX:box.left+2,clientY:box.top+2,preventDefault(){}});myListPointerEnd({pointerId});
      document.elementFromPoint=elementFromPoint;
      return{order:currentListEntries('wishlist').filter(entry=>entry.p==='H').map(entry=>entry.name),touchAction,bodyOverflow:getComputedStyle(document.body).overflowY};
    },width);
    expect(result.order.at(-1)).toBe('Bulbasaur');expect(result.touchAction).toBe('none');expect(result.bodyOverflow).not.toBe('hidden');
  }
});

test('A11Y-02 Special Board traverses deep results and supports keyboard, pointer, and query reset',async({page})=>{
  await openFixture(page);await page.evaluate(()=>openSpecialTradeBoard());
  const input=page.locator('#special-lf-ac'),options=page.locator('#special-lf-dd [role="option"]');
  await input.fill('a');expect(await options.count()).toBeGreaterThan(30);
  for(let index=0;index<30;index++)await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant','special-lf-option-29');
  await expect(page.locator('#special-lf-option-29')).toHaveAttribute('aria-selected','true');
  const active=await page.locator('#special-lf-option-29').boundingBox(),list=await page.locator('#special-lf-dd').boundingBox();
  expect(active.y).toBeGreaterThanOrEqual(list.y-1);expect(active.y+active.height).toBeLessThanOrEqual(list.y+list.height+1);
  await input.press('Enter');await expect(input).toHaveAttribute('aria-expanded','false');await expect(page.locator('#special-lf-sel')).not.toHaveValue('');
  await input.fill('pika');await input.press('ArrowDown');await expect(input).toHaveAttribute('aria-activedescendant','special-lf-option-0');
  await input.fill('bulba');await expect(input).not.toHaveAttribute('aria-activedescendant',/.+/);
  await input.press('ArrowDown');await input.press('Escape');await expect(input).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('#special-board-modal')).toHaveClass(/open/);
  await input.fill('char');await page.locator('#special-lf-option-0').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:9});
  await expect(page.locator('#special-lf-sel')).not.toHaveValue('');
});

test('PERF-01 and PERF-02 keep decorative cold work bounded and lazy',async({page})=>{
  await openFixture(page);
  await page.waitForFunction(()=>pokemonTypeActive===0&&_scaleDetectActive===0,null,{timeout:10_000});
  const metrics=await page.evaluate(async()=>{
    const originalFetch=window.fetch,originalScaleRunner=_runSpriteScaleDetection;
    let typeStarted=0,typeActive=0,typePeak=0;
    window.fetch=async url=>{if(String(url).includes('pokeapi.co')){typeStarted++;typeActive++;typePeak=Math.max(typePeak,typeActive);await new Promise(resolve=>setTimeout(resolve,12));typeActive--;return{ok:true,json:async()=>({types:[{type:{name:'grass'}}]})};}return originalFetch(url);};
    pokemonTypes={};pokemonTypeInflight.clear();pokemonTypeQueue.length=0;pokemonTypeActive=0;
    document.getElementById('mylist-out').innerHTML='';
    const host=document.createElement('div');host.id='type-stress';host.style.cssText='position:fixed;inset:0;z-index:99999;overflow:auto;background:white';
    host.innerHTML=Array.from({length:1000},(_,index)=>`<div class="myrow" data-dex="${index+1}" style="height:58px"></div>`).join('');document.body.append(host);
    const typeStartedAt=performance.now();applyTypeColors();await new Promise(resolve=>setTimeout(resolve,120));const initialTypes=typeStarted;
    host.scrollTop=58*500;await new Promise(resolve=>setTimeout(resolve,120));const scrolledTypes=typeStarted,typeCpu=performance.now()-typeStartedAt;

    let opticalStarted=0,opticalActive=0,opticalPeak=0;
    _runSpriteScaleDetection=async url=>{opticalStarted++;opticalActive++;opticalPeak=Math.max(opticalPeak,opticalActive);await new Promise(resolve=>setTimeout(resolve,4));opticalActive--;spriteScaleCache[url]={scale:1,cx:.5,cy:.5,t:Date.now()};};
    spriteScaleCache={};_scaleDetectInflight.clear();_scaleDetectQueue.length=0;_scaleDetectActive=0;
    const spriteStartedAt=performance.now();for(let index=0;index<1000;index++)spriteImg((index%1025)+1,34,'stress-sprite',`Pokemon ${index}`);const markupProbes=opticalStarted,spriteCpu=performance.now()-spriteStartedAt;
    const probes=Array.from({length:20},(_,index)=>detectSpriteScale(`https://img.example/${index}.png`));
    await new Promise(resolve=>setTimeout(resolve,0));const loadedProbes=opticalStarted;
    await Promise.all(probes);
    host.remove();window.fetch=originalFetch;_runSpriteScaleDetection=originalScaleRunner;
    return{initialTypes,scrolledTypes,typePeak,typeCpu,markupProbes,loadedProbes,opticalPeak,spriteCpu};
  });
  expect(metrics.initialTypes).toBeGreaterThan(0);expect(metrics.initialTypes).toBeLessThan(100);
  expect(metrics.scrolledTypes).toBeGreaterThan(metrics.initialTypes);expect(metrics.scrolledTypes).toBeLessThan(200);
  expect(metrics.typePeak).toBeLessThanOrEqual(4);expect(metrics.markupProbes).toBe(0);expect(metrics.loadedProbes).toBe(4);expect(metrics.opticalPeak).toBeLessThanOrEqual(4);
  console.log(`LAUNCH_FIX_PERF ${JSON.stringify(metrics)}`);
});
