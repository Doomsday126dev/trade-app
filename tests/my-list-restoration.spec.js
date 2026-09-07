const {test,expect}=require('@playwright/test');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');

const baseline=process.env.MY_LIST_VISUAL_BASELINE==='89';
const screenshots=process.env.MY_LIST_VISUAL_DIR;
async function fixture(page){
  await page.route('https://**/*',route=>route.request().resourceType()==='image'?route.continue():route.abort());
  await page.route('**/sw.js*',route=>route.abort());
  await page.goto('./?my-list-visual-review');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('visual-review'));
  await page.waitForFunction(()=>typeof renderMyList==='function');
  await page.evaluate(()=>{
    managedListenerLifecycle?.deactivateSession?.('visual_fixture');
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='Avery';auth={currentUser:{uid:'synthetic-visual-avery'}};
    localStorage.clear();sessionStorage.clear();
    allData=normalizeData({users:{Avery:{authUid:'synthetic-visual-avery',specialTradeBoard:{lf:[],ft:[]}}},
      wishlist:{Avery:{Rayquaza:'H[shiny]',Pikachu:'H[shiny]',Dragonite:'H',Gengar:'M',Eevee:'M(F)',Lucario:'M',Lapras:'L[lucky]',Snorlax:'L',Bulbasaur:'L',Charmander:'L',Squirtle:'L',Gardevoir:'M[shiny]'}},
      dynamax:{Avery:{}},gmax:{Avery:{}},costumes:{Avery:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    accountSyncCanonicalEntities=[];
    document.documentElement.dataset.theme='dark';
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent='Avery';document.getElementById('my-av').textContent='A';
    document.getElementById('my-fc-wrap').innerHTML='';
    switchTab('mylist',{render:false});renderMyList();setSyncStatus('online');
    window.__visualBefore=JSON.stringify(allData);
    window.__visualCopied='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__visualCopied=value;}}});
  });
  await page.evaluate(()=>waitForMyListRender());
  await expect(page.locator('#toast')).toBeHidden({timeout:8000});
}

test('desktop and mobile visual review evidence',async({page})=>{
  test.skip(!screenshots,'Screenshots are an explicit review artifact.');
  mkdirSync(screenshots,{recursive:true});
  await fixture(page);
  const metrics=[];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.locator('#tab-mylist img').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
    await expect.poll(()=>page.locator('#tab-mylist img').evaluateAll(images=>images.every(img=>img.complete)),{timeout:20000}).toBe(true);
    const sprites=page.locator(baseline?'#mylist-out .myrow-sprite':'#combined-list .myrow-sprite');
    await expect(sprites).toHaveCount(12);
    expect(await sprites.evaluateAll(images=>images.every(img=>img.naturalWidth>0))).toBe(true);
    metrics.push(await page.locator(baseline?'#mylist-out .myrow':'#combined-list .myrow').first().evaluate(row=>{
      const name=getComputedStyle(row.querySelector('.myrow-name'));
      return{viewport:innerWidth,rowHeight:row.getBoundingClientRect().height,spriteSlot:getComputedStyle(row.querySelector('.myrow-sprite-wrap')).width,font:name.fontFamily,fontSize:name.fontSize,fontWeight:name.fontWeight,grid:getComputedStyle(row.closest('.mygrid')).gridTemplateColumns};
    }));
    await page.screenshot({path:path.join(screenshots,`${baseline?'baseline-89':'restored'}-${viewport.width}.png`),fullPage:true});
    const first=page.locator(baseline?'#mylist-out .myrow':'#combined-list .myrow').first();
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshots,`${baseline?'baseline-89':'restored'}-rows-${viewport.width}.png`)});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  writeFileSync(path.join(screenshots,`${baseline?'baseline-89':'restored'}-metrics.json`),JSON.stringify(metrics,null,2));
});

test('restored rows remain bounded and details stay optional',async({page})=>{
  test.skip(baseline);
  await fixture(page);
  await expect(page.locator('.combined-row')).toHaveCount(0);
  await expect(page.locator('#combined-list .myrow')).toHaveCount(12);
  await expect(page.locator('#combined-search textarea')).toBeHidden();
  await expect(page.getByRole('button',{name:'Copy Search',exact:true})).toBeVisible();
  const data=await page.evaluate(()=>JSON.stringify(allData));
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const geometry=await page.locator('#combined-list .myrow').first().evaluate(row=>{
      const box=row.getBoundingClientRect(),sprite=row.querySelector('img').getBoundingClientRect(),name=row.querySelector('.wants-name').getBoundingClientRect(),controls=row.querySelector('.mctrl').getBoundingClientRect();
      return{height:box.height,spriteWidth:parseFloat(getComputedStyle(row.querySelector('.myrow-sprite-wrap')).width),ordered:sprite.right<=name.left&&name.right<=controls.left};
    });
    expect(geometry.height).toBeLessThanOrEqual(64);
    expect(geometry.spriteWidth).toBe(width<=600?32:34);
    expect(geometry.ordered).toBe(true);
  }
  await page.locator('.wants-search-details > summary').click();
  await expect(page.locator('#combined-search textarea')).toBeVisible();
  await expect(page.locator('#combined-search .contextual-manual > summary')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(data);
});

test('copy failure expands the raw string for manual recovery',async({page})=>{
  test.skip(baseline);
  await fixture(page);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('denied');};});
  await page.getByRole('button',{name:'Copy Search',exact:true}).click();
  await expect(page.locator('#combined-search textarea')).toBeVisible();
  await expect(page.locator('#combined-search textarea')).toBeFocused();
  await expect(page.locator('#combined-search .contextual-copy-status')).not.toBeEmpty();
});

test('restored add draft clears across an identity boundary',async({page})=>{
  test.skip(baseline);
  await fixture(page);
  await page.locator('#wants-add-name').fill('Charmander');
  await page.locator('[data-wants-add-priority="H"]').click();
  await page.evaluate(()=>resetSessionTransientUi('visual_identity_boundary'));
  await expect(page.locator('#wants-add-name')).toHaveValue('');
  await expect(page.locator('[data-wants-add-priority="H"]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#combined-list')).toBeEmpty();
});

test('a finishing add cannot clear a new account draft',async({page})=>{
  test.skip(baseline);
  await fixture(page);
  await page.locator('#wants-add-name').fill('Charmander');
  await page.evaluate(()=>{
    saveCombinedEditor=()=>new Promise(resolve=>{window.__finishAdd=resolve;});
    window.__pendingAdd=submitWantsAdd();
  });
  await expect(page.locator('.wants-add-form [type="submit"]')).toBeDisabled();
  await page.evaluate(()=>{resetSessionTransientUi('identity_switch');cur='OtherFixture';auth={currentUser:{uid:'other-fixture'}};});
  await page.locator('#wants-add-name').fill('Eevee');
  await page.evaluate(async()=>{window.__finishAdd();await window.__pendingAdd;});
  await expect(page.locator('#wants-add-name')).toHaveValue('Eevee');
});
