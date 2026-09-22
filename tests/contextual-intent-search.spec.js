const {test,expect}=require('@playwright/test');
const HIGH=Object.freeze({
  en:{protected:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&26',broad:'!traded&25'},
  ja:{protected:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&26',broad:'!こうかん&25'},
  es:{protected:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&26',broad:'!intercambiados&25'},
  de:{protected:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&26',broad:'!getauscht&25'}
});
const MEDIUM=Object.freeze({
  en:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&872',
  ja:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&872',
  es:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&872',
  de:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&872'
});
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
  const highProtected=high.getByRole('button',{name:'Copy protected search'});
  const highBroad=high.getByRole('button',{name:'Copy broad special search'});
  await expect(highProtected).toHaveAttribute('data-wants-copy',HIGH.en.protected);
  await expect(highBroad).toHaveAttribute('data-wants-copy',HIGH.en.broad);
  await expect(medium.locator('[data-wants-copy]')).toHaveAttribute('data-wants-copy',MEDIUM.en);
  await expect(low).toContainText('Unmapped Fixture');
  await expect(low).toContainText('1 not included');
  await expect(low.locator('[data-wants-copy]')).toHaveCount(0);
  await expect(page.locator('#combined-list')).not.toContainText('Chicago');
  await expect(page.locator('#wants-search-scope')).toHaveCount(0);
  await expect(selection).toBeHidden();
  await page.evaluate(()=>setWantsFindOpen(true));
  await page.locator('#combined-filter').fill('Pikachu');
  await expect(high.locator('.wants-row')).toHaveCount(1);
  await expect(highProtected).toHaveAttribute('data-wants-copy',HIGH.en.protected);
  await expect(highBroad).toHaveAttribute('data-wants-copy',HIGH.en.broad);
  await highProtected.click();
  expect(await page.evaluate(()=>__copied)).toBe(HIGH.en.protected);
  await highBroad.click();
  expect(await page.evaluate(()=>__copied)).toBe(HIGH.en.broad);
  await page.locator('#wants-select-toggle').click();
  await high.locator('input.wants-select').check();
  await expect(selection.locator('textarea')).toHaveValue('!traded&25');
  await page.evaluate(()=>setWantsFindOpen(true));
  await page.locator('#combined-filter').fill('Snom');
  await expect(medium.locator('[data-wants-copy]')).toHaveAttribute('data-wants-copy',MEDIUM.en);
  await expect(selection.locator('textarea')).toHaveValue('!traded&25');
  await selection.locator('[data-wants-copy]').click();
  expect(await page.evaluate(()=>__copied)).toBe('!traded&25');
  await page.evaluate(()=>setWantsFindOpen(true));
  await page.locator('#combined-filter').fill('');
  await expect(high.locator('[data-name="Pikachu"] input')).toBeChecked();
  await expect(highProtected).toHaveAttribute('data-wants-copy',HIGH.en.protected);
  await expect(highBroad).toHaveAttribute('data-wants-copy',HIGH.en.broad);
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
test('wants search localizes game terms and unmatched filters retain complete section queries',async({page})=>{
  await fixture(page);
  for(const locale of ['en','ja','es','de']){
    await page.evaluate(locale=>changePokemonGoSearchLocale(locale),locale);
    const high=page.locator('#combined-list > [data-wants-section="H"]');
    await expect(high.getByRole('button',{name:/Copy protected search|保護された検索をコピー|Copiar búsqueda protegida|Geschützte Suche kopieren/})).toHaveAttribute('data-wants-copy',HIGH[locale].protected);
    await expect(high.getByRole('button',{name:/Copy broad special search|幅広い特別検索をコピー|Copiar búsqueda especial amplia|Breite Spezial-Suche kopieren/})).toHaveAttribute('data-wants-copy',HIGH[locale].broad);
    await expect(page.locator('#combined-list > [data-wants-section="M"] [data-wants-copy]')).toHaveAttribute('data-wants-copy',MEDIUM[locale]);
  }
  await page.evaluate(()=>setWantsFindOpen(true));
  await page.locator('#combined-filter').fill('No matching entry');
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);
  await expect(page.locator('#combined-list [data-wants-copy]')).toHaveCount(3);
  const high=page.locator('#combined-list > [data-wants-section="H"]');
  const medium=page.locator('#combined-list > [data-wants-section="M"] [data-wants-copy]');
  await expect(high.getByRole('button',{name:'Copy protected search'})).toHaveAttribute('data-wants-copy',HIGH.de.protected);
  await expect(high.getByRole('button',{name:'Copy broad special search'})).toHaveAttribute('data-wants-copy',HIGH.de.broad);
  await expect(medium).toHaveAttribute('data-wants-copy',MEDIUM.de);
  await medium.click();expect(await page.evaluate(()=>__copied)).toBe(MEDIUM.de);
  await expect(page.locator('#combined-list > [data-wants-section="L"] [data-wants-copy]')).toHaveCount(0);
  await expect(page.locator('#combined-search')).toBeHidden();
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__before));
});
