const {test,expect}=require('@playwright/test');
const {normalFixture,settled}=require('./helpers/usability-fixture.cjs');
for(const width of [1440,390,320]){
 test('select opens compact options without saving at '+width,async({page},testInfo)=>{
  await normalFixture(page);await page.setViewportSize({width,height:900});
  const before=await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities));
  const search=page.locator('#wants-add-name');await search.fill('Squirtle');
  await page.locator('#wants-add-name-suggestions [role=option]').filter({hasText:/^Squirtle$/}).click();
  await expect(page.locator('#combined-editor-modal')).toHaveClass(/open/);
  await expect(page.locator('#combined-priority')).toHaveValue('H');
  await expect(page.locator('.add-flow-search')).toBeHidden();
  await expect(page.locator('#combined-change')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
  const box=await page.locator('.combined-editor').boundingBox();
  expect(box.width).toBeLessThanOrEqual(500);expect(Math.abs(box.x-(width-box.width)/2)).toBeLessThan(2);
  await expect(page.locator('#combined-save')).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('compact-'+width+'.png')});
  await page.locator('#combined-change').click();await page.locator('#combined-name').fill('Mewtwo');await page.locator('#combined-name').press('Enter');
  await expect(page.locator('#combined-priority')).toHaveValue('');
  expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
  await page.locator('#combined-close').click();await expect(search).toBeFocused();
  await search.fill('Bulbasaur');await search.press('ArrowDown');await search.press('Enter');
  await expect(page.locator('#combined-editor-modal')).toHaveClass(/open/);await expect(page.locator('#combined-priority')).toHaveValue('H');
  expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities))).toBe(before);
  await page.locator('#combined-save').click();await settled(page);
  expect(await page.evaluate(()=>productDeclarations().entries.find(e=>e.name==='Bulbasaur').p)).toBe('H');
 });
}
