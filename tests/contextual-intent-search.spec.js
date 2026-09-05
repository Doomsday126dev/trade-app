const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
async function fixture(page){
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/sw.js*',route=>route.abort());
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__contextCopy=text;}}}));
  await page.goto('./?contextual-search-fixture');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('contextual-search-fixture'));
  await page.waitForFunction(()=>typeof renderMyList==='function');
  await page.evaluate(()=>{
    db=null;fbOn=false;managedFirebaseClient=null;
    cur='SearchFixture';auth={currentUser:{uid:'synthetic-search-fixture'}};
    managedAccountSyncRuntime=null;accountSyncUiState=null;
    allData=normalizeData({users:{SearchFixture:{authUid:'synthetic-search-fixture',isOwner:true,specialTradeBoard:{lf:[],ft:[{name:'Eevee',no:133,shiny:true,note:'retain fixture note'}]}}},wishlist:{SearchFixture:{Pikachu:'H[shiny][bg:location-gofest2026chicago]',Snom:'M','Unmapped Fixture':'L'}},dynamax:{SearchFixture:{}},gmax:{SearchFixture:{}},costumes:{SearchFixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    switchTab('mylist',{render:false});myListType='wishlist';myListIntent='lf';renderMyList();
    window.__contextBefore=JSON.stringify(allData);
  });
}
test('current intent, filter, selection, locale and Board searches are read-only',async({page})=>{
  await fixture(page);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});
    const panel=page.locator('#mylist-contextual-search');
    await panel.locator('summary').first().click();
    await expect(panel).toContainText('Species-only prefilter');
    await expect(panel).toContainText('1 entries cannot be included');
    await panel.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__contextCopy)).toBe('!traded&25,872');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(process.env.PHASE1_SCREENSHOTS){fs.mkdirSync(process.env.PHASE1_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PHASE1_SCREENSHOTS,`mylist-search-${width}.png`)});}
    await panel.locator('summary').first().click();
  }
  await page.locator('#mylist-filter').fill('Snom');
  await expect(page.locator('#mylist-contextual-search textarea')).toHaveValue('!traded&872');
  await page.locator('#mylist-filter').fill('Chicago');
  await expect(page.locator('#mylist-contextual-search textarea')).toHaveValue('!traded&25');
  await page.locator('#mylist-filter').fill('');
  await page.evaluate(()=>{toggleBulkMode();toggleBulkSelection('Pikachu');openSelectedIntentSearch();});
  await expect(page.locator('#selected-contextual-search textarea')).toHaveValue('!traded&25');
  await expect(page.locator('#selected-contextual-search')).not.toContainText('Snom');
  await page.evaluate(()=>changePokemonGoSearchLocale('ja'));
  await expect(page.locator('#selected-contextual-search textarea')).toHaveValue('!こうかん&25');
  await page.evaluate(()=>{toggleBulkMode();setMyListIntent('ft');});
  await expect(page.locator('#mylist-contextual-search textarea')).toHaveValue('!こうかん&133');
  await page.evaluate(()=>openSpecialTradeBoard());
  await expect(page.locator('#board-contextual-search textarea')).toHaveValue('!こうかん&25,133,872');
  await page.locator('#special-ft-list input').uncheck();
  await expect(page.locator('#board-contextual-search textarea')).toHaveValue('!こうかん&25,872');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__contextBefore));
});
test('reciprocal searches preserve give/receive directions without loading another account',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    selectedTrainerRuntime={...selectedTrainerRuntime,username:'SyntheticRecipient',publicData:normalizeData({users:{SyntheticRecipient:{publicDeclarations:[{name:'Eevee',category:'wishlist',intent:'lf',shiny:true},{name:'Pikachu',category:'wishlist',intent:'ft',shiny:true,backgroundId:'location-gofest2026chicago'}]}}})};
    document.body.insertAdjacentHTML('beforeend',renderTradeMatchSummary('SyntheticRecipient'));
  });
  await expect(page.locator('[data-contextual-direction="i-offer"] textarea')).toHaveValue('!traded&133');
  await expect(page.locator('[data-contextual-direction="they-offer"] textarea')).toHaveValue('!traded&25');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__contextBefore));
});
