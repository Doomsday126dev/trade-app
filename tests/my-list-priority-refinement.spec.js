const {test,expect}=require('@playwright/test');
const {installPriorityReviewFixture}=require('./helpers/my-list-priority-fixture.cjs');
test.use({serviceWorkers:'block'});
const section=(page,key)=>page.locator(`#combined-list > [data-wants-section="${key}"]`);

test('Dragonite fixture carries canonical species metadata and the unchanged resolver draws correct base artwork',async({page})=>{
  await installPriorityReviewFixture(page);
  const evidence=await page.evaluate(async()=>{
    const entry=productDeclarations().entries.find(entry=>entry.name==='Dragonite');
    const catalog=accountSyncCatalogEntryForName('wishlist','Dragonite');
    const urls=exportSpriteFallbackUrls({...entry,spriteUrl:entrySpriteUrl(entry,entry.name)});
    const drawn=[],original=drawImageContain;
    drawImageContain=(ctx,image,...args)=>{drawn.push({src:image.src,width:image.naturalWidth,height:image.naturalHeight});return original(ctx,image,...args);};
    try{await renderProductShareImage([entry],cur);}finally{drawImageContain=original;}
    return{no:entry.no,catalogNo:catalog.no,name:catalog.name,urls,drawn};
  });
  expect(evidence.no).toBe(149);expect(evidence.catalogNo).toBe(149);expect(evidence.name).toBe('Dragonite');
  expect(evidence.urls[0]).toMatch(/\/other\/home\/149\.png$/);
  expect(evidence.drawn).toHaveLength(1);
  expect(evidence.drawn[0].src).toMatch(/\/149\.png$/);
  expect(evidence.drawn[0].width).toBeGreaterThan(0);
});

test('Share selected localizes at desktop and mobile; only existing owner legacy edits say Needs priority',async({page})=>{
  await installPriorityReviewFixture(page);
  await page.locator('#wants-select-toggle').click();
  await section(page,'H').locator('[data-name="Pikachu"] input').check();
  for(const width of [1440,390])for(const locale of ['en','ja','es','de']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(locale=>changeInterfaceLocale(locale),locale);
    const labels=await page.evaluate(()=>({selected:i18nCore.t('workflow.shareSelected'),share:i18nCore.t('product.share'),owner:i18nCore.t('workflow.needsPriority'),recipient:i18nCore.t('workflow.priorityNotSet')}));
    await expect(page.locator('#wants-selection-share')).toHaveText(labels.selected);
    await expect(page.locator('.wants-list-toolbar > button[onclick="openProductShare()"]')).toHaveText(labels.share);
    await expect(section(page,'NEEDS_PRIORITY').locator('.wants-section-title')).toHaveText(labels.owner);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.evaluate(()=>openCombinedEditor());
    await expect(page.locator('#combined-priority')).not.toContainText(labels.owner);
    await expect(page.locator('#combined-priority')).not.toContainText(labels.recipient);
    await page.keyboard.press('Escape');
  }
});

test('clean section, selected and Combine searches scopes hide details; clipboard failure still exposes exact copied bytes',async({page})=>{
  await installPriorityReviewFixture(page);
  await page.evaluate(()=>{
    allData=normalizeData({users:{Avery:{}},wishlist:{Avery:{Pikachu:'H',Eevee:'M'}}});renderMyList();
  });
  const high=section(page,'H');
  await expect(high.locator('.contextual-details')).toBeHidden();
  await expect(high.locator('[data-contextual-copy]')).toBeVisible();
  await page.locator('#wants-select-toggle').click();
  await high.locator('input').check();
  await expect(page.locator('#combined-search .contextual-details')).toBeHidden();
  await page.locator('#wants-combine > summary').click();
  await page.locator('[data-wants-scope="H"]').click();
  await page.locator('[data-wants-scope="M"]').click();
  await expect(page.locator('.wants-custom-result .contextual-details')).toBeHidden();
  await expect(page.locator('.wants-custom-result [data-contextual-copy]')).toHaveAttribute('data-contextual-copy','!traded&25,133');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
  await high.locator('[data-contextual-copy]').click();
  await expect(high.locator('.contextual-details')).toBeVisible();
  await expect(high.locator('textarea')).toHaveValue('!traded&25');
  await expect(high.locator('textarea')).toBeFocused();
  await expect(high.locator('.contextual-copy-status')).not.toBeEmpty();
});
