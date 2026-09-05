const {test,expect}=require('@playwright/test');
async function fixture(page){
  const runtimeOrigin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('https://**/*',route=>new URL(route.request().url()).origin===runtimeOrigin?route.continue():route.abort());
  await page.route('**/sw.js*',route=>route.abort());
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;}}}));
  await page.goto('./?wants-search-fixture');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('wants-search-fixture'));
  await page.waitForFunction(()=>typeof renderMyList==='function');
  await page.evaluate(()=>{
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='SearchFixture';auth={currentUser:{uid:'synthetic-search-fixture'}};
    allData=normalizeData({users:{SearchFixture:{authUid:'synthetic-search-fixture',specialTradeBoard:{lf:[],ft:[{name:'Eevee',no:133}]}}},wishlist:{SearchFixture:{Pikachu:'H[shiny][bg:location-gofest2026chicago]',Snom:'M','Unmapped Fixture':'L'}},dynamax:{SearchFixture:{}},gmax:{SearchFixture:{}},costumes:{SearchFixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    switchTab('mylist',{render:false});renderMyList();
    window.__before=JSON.stringify(allData);window.__copied='';copyText=async value=>{window.__copied=value;};
  });
}
test('visible wants search follows filtering, top priority and persistent selection without writes',async({page})=>{
  await fixture(page);
  const panel=page.locator('#combined-search');
  await expect(panel.locator('[data-contextual-copy]')).toBeVisible();
  await expect(panel.locator('textarea')).toHaveValue('!traded&25,872');
  await expect(panel).toContainText('Unmapped Fixture');
  await expect(panel).not.toContainText('Chicago');
  await page.locator('#combined-filter').fill('Snom');
  await expect(panel.locator('textarea')).toHaveValue('!traded&872');
  await page.locator('#combined-filter').fill('');
  await page.locator('#combined-list input').first().check();
  await page.locator('#wants-search-scope').selectOption('selected');
  await expect(panel.locator('textarea')).toHaveValue('!traded&25');
  await page.locator('#combined-filter').fill('Snom');
  await expect(panel.locator('textarea')).toHaveValue('!traded&25');
  await page.locator('#combined-filter').fill('');
  await page.locator('#wants-search-scope').selectOption('top');
  await expect(panel.locator('textarea')).toHaveValue('!traded&25');
  await panel.locator('[data-contextual-copy]').click();
  expect(await page.evaluate(()=>__copied)).toBe('!traded&25');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
test('wants search localizes game terms and empty filters offer no misleading copy',async({page})=>{
  await fixture(page);
  for(const [locale,term] of [['en','!traded'],['ja','!こうかん'],['es','!intercambiados'],['de','!getauscht']]){
    await page.evaluate(locale=>changePokemonGoSearchLocale(locale),locale);
    await expect(page.locator('#combined-search textarea')).toHaveValue(`${term}&25,872`);
  }
  await page.locator('#combined-filter').fill('No matching entry');
  await expect(page.locator('#combined-search [data-contextual-copy]')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
