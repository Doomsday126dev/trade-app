const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installSimplificationFixture,settlePriorityReview}=require('./helpers/my-list-simplification-fixture.cjs');
test.use({serviceWorkers:'block'});
const section=(page,key)=>page.locator(`#combined-list > [data-wants-section="${key}"]`);
const toolsMenu=page=>page.locator('#wants-list-tools > summary');
async function find(page){await toolsMenu(page).click();await page.locator('#wants-list-tools button[onclick*="setWantsFindOpen"]').click();}

test('48 variant-heavy High wants have direct copies and optional tools at desktop, mobile and narrow widths',async({page})=>{
  await installSimplificationFixture(page);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#combined-filter')).toBeHidden();
    await expect(page.locator('#wants-select-toggle')).toBeVisible();
    await expect(page.locator('.wants-list-toolbar > button[onclick="openProductShare()"]')).toBeVisible();
    await expect(section(page,'H').locator('[data-contextual-copy]')).toBeVisible();
    await expect(page.locator('[data-manual-check-count],.contextual-manual-review,#legacy-list-tools')).toHaveCount(0);
    await expect(page.locator('#combined-list .contextual-details:visible')).toHaveCount(0);
    await toolsMenu(page).click();
    await expect(page.locator('#wants-list-tools .wants-list-menu > button')).toHaveCount(3);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Escape');await expect(toolsMenu(page)).toBeFocused();
  }
});

test('Find opens focused, preserves full copies through no matches and collapse, and closes without hidden filtering',async({page})=>{
  await installSimplificationFixture(page);await find(page);
  const input=page.locator('#combined-filter'),high=section(page,'H');
  await expect(input).toBeFocused();
  const query=await high.locator('[data-contextual-copy]').getAttribute('data-contextual-copy');
  await input.fill('No matching Pokémon');await expect(page.locator('#combined-list .wants-row')).toHaveCount(0);
  await high.locator('[data-contextual-copy]').click();expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(query);
  await high.locator('.mylist-priority-toggle').click();
  await high.locator('[data-contextual-copy]').click();expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(query);
  await input.focus();await page.keyboard.press('Escape');await expect(input).toBeHidden();await expect(input).toHaveValue('');
  await expect(toolsMenu(page)).toBeFocused();
  await high.locator('.mylist-priority-toggle').click();await expect(high.locator('.wants-row')).toHaveCount(48);
  await find(page);await input.fill('Rotom');await page.locator('#wants-find button').click();
  await expect(input).toBeHidden();await expect(high.locator('.wants-row')).toHaveCount(48);
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
});

test('Combine uses compact wrapping accessible toggles and unchanged independent union scopes',async({page})=>{
  await installSimplificationFixture(page);
  await page.locator('#wants-combine > summary').click();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    for(const locale of ['en','de']){
      await page.evaluate(locale=>changeInterfaceLocale(locale),locale);
      const hits=await page.locator('[data-wants-scope]').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
      expect(hits.every(hit=>hit.w>=44&&hit.h>=44&&hit.h<=48)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  }
  for(const key of ['H','M','LUCKY']){const button=page.locator(`[data-wants-scope="${key}"]`);await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(button).toBeFocused();}
  const expected=await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan(productDeclarations().entries.filter(e=>['H','M'].includes(e.p)||!e.p&&e.lucky),{locale:pokemonGoSearchLocale()}).parts[0]);
  await expect(page.locator('.wants-custom-result [data-contextual-copy]')).toHaveCount(1);
  await page.locator('.wants-custom-result [data-contextual-copy]').click();expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(expected);
  await page.locator('[data-wants-scope="M"]').click();await expect(page.locator('[data-wants-scope="M"]')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
});

test('About searches is optional and Import still opens the existing preview flow',async({page})=>{
  await installSimplificationFixture(page);await toolsMenu(page).click();
  await page.locator('#wants-list-tools button[onclick*="toggleWantsSearchHelp"]').click();
  await expect(page.locator('#wants-about-searches')).toBeVisible();await expect(page.locator('#wants-about-searches')).toContainText('species');
  await expect(page.locator('#wants-about-searches')).toContainText('in Pokémon GO');
  await page.keyboard.press('Escape');await toolsMenu(page).click();await expect(page.locator('#wants-about-searches')).toBeHidden();
  await page.locator('#wants-list-tools button[onclick*="openImport"]').click();
  await expect(page.locator('#import-modal')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
});

test('real omissions name excluded entries, split queries remain bounded, and failed copy selects the exact part',async({page})=>{
  await installSimplificationFixture(page);
  const host=section(page,'H').locator('.wants-section-search');
  await page.evaluate(()=>document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml([{name:'Pikachu costume',no:25,lucky:true},{name:'Unresolved fixture',no:null}],'High',{compact:true}));
  await expect(host.locator('summary')).toHaveText('1 not included');await host.locator('summary').click();
  await expect(host.locator('.contextual-omitted')).toContainText('Unresolved fixture');await expect(host.locator('.contextual-omitted')).not.toContainText('Pikachu');
  await expect(host.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy','!traded&25');
  await page.evaluate(()=>document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml([{name:'Unresolved fixture',no:null}],'High',{compact:true}));
  await expect(host.locator('[data-contextual-copy]')).toHaveCount(0);await expect(host).toContainText('No species could be included');
  await page.evaluate(()=>document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml(Array.from({length:2000},(_,i)=>({no:i+1})),'High',{compact:true}));
  const parts=await host.locator('[data-contextual-copy]').evaluateAll(nodes=>nodes.map(n=>n.dataset.contextualCopy));
  expect(parts.length).toBeGreaterThan(1);expect(parts.every(p=>p.length<=1500)).toBe(true);
  await expect(host.locator('summary')).toHaveText('Split search');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
  await host.locator('[data-contextual-copy]').nth(1).click();
  await expect(host.locator('textarea').nth(1)).toBeFocused();await expect(host.locator('textarea').nth(1)).toHaveValue(parts[1]);
  expect(await host.locator('textarea').nth(1).evaluate(n=>n.selectionEnd-n.selectionStart)).toBe(parts[1].length);
  await expect(host.locator('.contextual-copy-status')).not.toBeEmpty();
});

test('capture simplification review states',async({page})=>{
  test.skip(!process.env.MY_LIST_SIMPLIFICATION_REVIEW_DIR,'Opt-in review artifacts');
  await installSimplificationFixture(page);const dir=path.resolve(process.env.MY_LIST_SIMPLIFICATION_REVIEW_DIR);fs.mkdirSync(dir,{recursive:true});
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));await settlePriorityReview(page);
    await page.mouse.move(0,0);await page.screenshot({path:path.join(dir,`normal-${width}.png`)});
    await toolsMenu(page).click();await page.mouse.move(0,0);await page.screenshot({path:path.join(dir,`tools-${width}.png`)});await page.keyboard.press('Escape');
    await page.locator('#wants-combine > summary').click();
    for(const key of ['H','M','LUCKY'])await page.locator(`[data-wants-scope="${key}"]`).click();
    await page.locator('#wants-combine').scrollIntoViewIfNeeded();await settlePriorityReview(page);
    await page.mouse.move(0,0);await page.screenshot({path:path.join(dir,`combine-${width}.png`)});
    await page.evaluate(()=>{wantsCustomScopes.clear();document.getElementById('wants-combine').open=false;refreshCombinedSearch();});
  }
});
