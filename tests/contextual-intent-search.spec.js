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
    allData=normalizeData({users:{SearchFixture:{authUid:'synthetic-search-fixture',specialTradeBoard:{lf:[],ft:[{name:'Eevee',no:133}]}}},wishlist:{SearchFixture:{Pikachu:'H[shiny][bg:location-gofest2026chicago]',Raichu:'H',Snom:'M','Unmapped Fixture':'L'}},dynamax:{SearchFixture:{}},gmax:{SearchFixture:{}},costumes:{SearchFixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    switchTab('mylist',{render:false});renderMyList();
    window.__before=JSON.stringify(allData);window.__copied='';copyText=async value=>{window.__copied=value;};
  });
}
test('section searches keep whole-priority scope while precision selection persists across filtering without writes',async({page})=>{
  await fixture(page);
  const high=page.locator('#combined-list > [data-wants-section="H"]');
  const medium=page.locator('#combined-list > [data-wants-section="M"]');
  const low=page.locator('#combined-list > [data-wants-section="L"]');
  const selection=page.locator('#combined-search');
  await expect(high.locator('[data-wants-copy]')).toBeVisible();
  await expect(high.locator('textarea')).toHaveValue('!traded&25,26');
  await expect(medium.locator('textarea')).toHaveValue('!traded&872');
  await expect(low).toContainText('Unmapped Fixture');
  await expect(low).toContainText('Manual checks needed: 1.');
  await expect(low.locator('[data-wants-copy]')).toHaveCount(0);
  await expect(page.locator('#combined-list')).not.toContainText('Chicago');
  await expect(page.locator('#wants-search-scope')).toHaveCount(0);
  await expect(selection).toBeHidden();
  await page.locator('#combined-filter').fill('Pikachu');
  await expect(high.locator('.wants-row')).toHaveCount(1);
  await expect(high.locator('textarea')).toHaveValue('!traded&25,26');
  await high.locator('[data-wants-copy]').click();
  expect(await page.evaluate(()=>__copied)).toBe('!traded&25,26');
  await page.locator('#wants-select-toggle').click();
  await high.locator('input.wants-select').check();
  await expect(selection.locator('textarea')).toHaveValue('!traded&25');
  await page.locator('#combined-filter').fill('Snom');
  await expect(medium.locator('textarea')).toHaveValue('!traded&872');
  await expect(selection.locator('textarea')).toHaveValue('!traded&25');
  await selection.locator('[data-wants-copy]').click();
  expect(await page.evaluate(()=>__copied)).toBe('!traded&25');
  await page.locator('#combined-filter').fill('');
  await expect(high.locator('[data-name="Pikachu"] input')).toBeChecked();
  await expect(high.locator('textarea')).toHaveValue('!traded&25,26');
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
test('wants search localizes game terms and unmatched filters retain complete section queries',async({page})=>{
  await fixture(page);
  for(const [locale,term] of [['en','!traded'],['ja','!こうかん'],['es','!intercambiados'],['de','!getauscht']]){
    await page.evaluate(locale=>changePokemonGoSearchLocale(locale),locale);
    await expect(page.locator('#combined-list > [data-wants-section="H"] textarea')).toHaveValue(`${term}&25,26`);
    await expect(page.locator('#combined-list > [data-wants-section="M"] textarea')).toHaveValue(`${term}&872`);
  }
  await page.locator('#combined-filter').fill('No matching entry');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);
  await expect(page.locator('#combined-list [data-wants-copy]')).toHaveCount(2);
  const high=page.locator('#combined-list > [data-wants-section="H"] [data-wants-copy]');
  const medium=page.locator('#combined-list > [data-wants-section="M"] [data-wants-copy]');
  await expect(high).toHaveAttribute('data-wants-copy','!getauscht&25,26');
  await expect(medium).toHaveAttribute('data-wants-copy','!getauscht&872');
  await medium.click();expect(await page.evaluate(()=>__copied)).toBe('!getauscht&872');
  await expect(page.locator('#combined-list > [data-wants-section="L"] [data-wants-copy]')).toHaveCount(0);
  await expect(page.locator('#combined-search')).toBeHidden();
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
