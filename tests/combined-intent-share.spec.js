const {test,expect}=require('@playwright/test');
async function fixture(page){
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/sw.js*',route=>route.abort());
  await page.goto('./?phase2-fixture');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('phase2-fixture'));
  await page.waitForFunction(()=>typeof renderMyList==='function');
  await page.evaluate(()=>{
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='Phase2Fixture';auth={currentUser:{uid:'synthetic-phase2'}};
    allData=normalizeData({users:{Phase2Fixture:{authUid:'synthetic-phase2',specialTradeBoard:{lf:[],ft:[{name:'Eevee',no:133,note:'Public intent note'}]}}},wishlist:{Phase2Fixture:{Pikachu:'H[shiny]',Snom:'M'}},dynamax:{Phase2Fixture:{}},gmax:{Phase2Fixture:{}},costumes:{Phase2Fixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';switchTab('mylist',{render:false});renderMyList();
    window.__before=JSON.stringify(allData);window.__copied='';copyText=async value=>{window.__copied=value;};
  });
}
test('scope controls output, selection persists across filtering and no data changes',async({page})=>{
  await fixture(page);
  await expect(page.locator('#combined-list .combined-row')).toHaveCount(3);
  await page.locator('#combined-list input').first().check();
  await page.locator('#combined-filter').fill('Snom');
  await page.locator('#combined-filter').fill('');
  await expect(page.locator('#combined-list input').first()).toBeChecked();
  await page.evaluate(()=>openProductShare());
  await expect(page.locator('[data-share-mode="link"]')).toBeVisible();
  for(const scope of ['top','selected']){
    await page.locator('#product-share-scope').selectOption(scope);
    await expect(page.locator('[data-share-mode="link"]')).toBeHidden();
    await page.evaluate(()=>setProductShareMode('link'));
    await expect(page.locator('#product-share-link')).toBeHidden();
    await page.locator('[data-share-mode="text"]').click();
    await page.locator('#product-share-text button').click();
    const text=await page.evaluate(()=>__copied);
    expect(text).toContain(scope==='top'?'Pikachu':'Eevee');
    expect(text).not.toContain('Snom');
  }
  await page.locator('#product-share-scope').selectOption('full');
  await expect(page.locator('[data-share-mode="link"]')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
test('both-side add is one canonical batch, failed save retains the draft',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    accountSyncCanonicalEntities=[];
    accountSyncMutationAuthority=async()=>({mode:'canonical',controller:{}});
    accountSyncAuthorityCurrent=()=>true;
    applyAccountSyncTradeMutations=async mutations=>{window.__mutations=mutations;return{ok:false};};
    openCombinedEditor();
  });
  await page.locator('#combined-name').fill('Charmander');
  await page.locator('#combined-ft').check();
  await page.locator('#combined-shiny').check();
  await page.locator('#combined-save').click();
  await expect(page.locator('#combined-editor-modal')).toBeVisible();
  await expect(page.locator('#combined-name')).toHaveValue('Charmander');
  const mutations=await page.evaluate(()=>__mutations);
  expect(mutations.map(x=>x.identity.lane)).toEqual(['looking-for','for-trade']);
  expect(mutations.every(x=>x.values.shiny)).toBe(true);
  expect(mutations[0].entityId).not.toBe(mutations[1].entityId);
});
test('responsive navigation and editor fit',async({page})=>{
  await fixture(page);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    if(width<701)await expect(page.locator('#nav-events')).toBeHidden();else await expect(page.locator('#nav-events')).toBeVisible();
    await page.evaluate(()=>openCombinedEditor());
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    if(process.env.PHASE2_SCREENSHOTS)await page.screenshot({path:`${process.env.PHASE2_SCREENSHOTS}/combined-${width}.png`});
  }
});
test('image keeps missing art and long exact details without mutating selection',async({page})=>{
  await fixture(page);
  const result=await page.evaluate(async()=>{
    loadCanvasImageWithFallback=async()=>null;
    const entries=[{name:'Unmapped costume',dn:'Unmapped costume',intent:'lf',backgroundId:'unknown-exact-background',mod:'Long exact qualifier '.repeat(8),note:'Published note',shiny:true}];
    const blob=await renderProductShareImage(entries,cur);
    const bitmap=await createImageBitmap(blob);
    return{size:blob.size,width:bitmap.width,height:bitmap.height,unchanged:JSON.stringify(allData)===__before};
  });
  expect(result.size).toBeGreaterThan(1000);expect(result.width).toBe(1800);expect(result.height).toBeGreaterThan(600);expect(result.unchanged).toBe(true);
});
