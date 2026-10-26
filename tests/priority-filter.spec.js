const {test,expect}=require('@playwright/test');
const {normalFixture,settled,fixture}=require('./helpers/usability-fixture.cjs');
const filter=(page,key)=>page.locator(`[data-wants-priority-filter="${key}"]`);
test('priority views count actual rows, preserve selected/full share scopes and update after canonical edits',async({page})=>{
 await normalFixture(page);
 expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Charmander',p:'M'},{name:'Squirtle',p:'L'},{name:'Bulbasaur',shiny:true}]))).toBe(true);await settled(page);
 await expect(page.locator('.wants-row')).toHaveCount(4);
 for(const [key,count]of Object.entries({ALL:4,H:1,M:1,L:1}))await expect(filter(page,key).locator('.wants-filter-count')).toHaveText(String(count));
 const original=await page.evaluate(()=>({entries:productDeclarations().entries,all:productScopeEntries('full'),top:productScopeEntries('top'),writes:__normal.writes.length}));
 await page.locator('#wants-select-toggle').click();await page.locator('.wants-row[data-name="Pikachu"] input').check();
 await filter(page,'M').focus();await page.keyboard.press('Enter');await expect(filter(page,'M')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.wants-row')).toHaveCount(1);
 await expect(page.locator('#wants-selection-filter-note')).toContainText('1 selected in other priorities');
 expect(await page.evaluate(()=>productScopeEntries('selected').map(e=>e.name))).toEqual(['Pikachu']);
 expect(await page.evaluate(()=>productScopeEntries('full'))).toEqual(original.all);expect(await page.evaluate(()=>productScopeEntries('top'))).toEqual(original.top);
 expect(await page.evaluate(()=>__normal.writes.length)).toBe(original.writes);
 await page.locator('.wants-row[data-name="Charmander"] .wants-name').click();await page.locator('#combined-priority').selectOption('L');await page.locator('#combined-save').click();await settled(page);
 await expect(page.locator('.wants-row')).toHaveCount(0);await expect(page.locator('#combined-list')).toContainText('No Pokémon with Medium priority');
 await expect(filter(page,'M').locator('.wants-filter-count')).toHaveText('0');await expect(filter(page,'L').locator('.wants-filter-count')).toHaveText('2');
 await filter(page,'ALL').click();await expect(page.locator('.wants-row')).toHaveCount(4);await expect(page.locator('.wants-row[data-name="Pikachu"] input')).toBeChecked();
 await expect(page.locator('#wants-selection-filter-note')).toBeHidden();await expect(page.locator('[data-wants-section="SHINY"] .wants-section-title')).toHaveText('Shiny');
 // Add priority still controls additions, independently of the view selector.
 await filter(page,'H').click();expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Eevee',p:'M'}]))).toBe(true);await settled(page);
 await expect(page.locator('.wants-row')).toHaveCount(1);await expect(filter(page,'M').locator('.wants-filter-count')).toHaveText('1');
 await page.evaluate(()=>setWantsFindOpen(true));await page.locator('#combined-filter').fill('no such pokemon');await expect(page.locator('.wants-row')).toHaveCount(0);await expect(filter(page,'ALL').locator('.wants-filter-count')).toHaveText('5');
 await page.evaluate(()=>stopAccountSyncRuntime());
});
test('priority selection is local to account, all includes unprioritized rows, empty choices remain usable',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{allData.users[cur].specialTradeBoard={lf:[],ft:[]};for(const type of ['wishlist','dynamax','gmax','costumes'])allData[type][cur]={};renderMyList();});
 for(const key of ['ALL','H','M','L']){await expect(filter(page,key).locator('.wants-filter-count')).toHaveText('0');await filter(page,key).click();await expect(filter(page,key)).toHaveAttribute('aria-pressed','true');expect((await filter(page,key).boundingBox()).height).toBeGreaterThanOrEqual(44);}
 await expect(page.locator('#combined-list')).toContainText('No Pokémon with Low priority');
 await page.evaluate(()=>{cur='OtherPreviewOwner';allData.users[cur]={};for(const type of ['wishlist','dynamax','gmax','costumes'])allData[type][cur]={};renderMyList();});
 await expect(filter(page,'ALL')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
