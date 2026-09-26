const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {installSimplificationFixture,settlePriorityReview}=require('./helpers/my-list-simplification-fixture.cjs');
test.use({serviceWorkers:'block'});
const section=(page,key)=>page.locator(`#combined-list > [data-wants-section="${key}"]`);
const toolsMenu=page=>page.locator('#wants-list-tools > summary');
// Accepted English section protections, specified independently of the serializer.
const PROTECTED_PREFIX='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&';
async function find(page){await toolsMenu(page).click();await page.locator('#wants-list-tools button[onclick*="setWantsFindOpen"]').click();}

test('48 variant-heavy High wants have direct copies and optional tools at desktop, mobile and narrow widths',async({page})=>{
  const fixture=await installSimplificationFixture(page);
  const high=section(page,'H'),medium=section(page,'M');
  // Dragonite is added only to this synthetic private catalog. Its absence
  // from the public dex must remain a visible omission, not a hidden exception.
  expect(await page.evaluate(()=>{
    const entry=productDeclarations().entries.find(e=>e.p==='M'&&e.name==='Dragonite');
    return{name:entry.name,no:entry.no,publicDex:PogoDomain.publicPokemonDex.dex(entry.name),identity:PogoDomain.searchStrings.contextualEntryIdentity(entry)};
  })).toEqual({name:'Dragonite',no:149,publicDex:0,identity:{resolved:false,explicit:false,category:'unresolved-catalog',speciesId:149}});
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#combined-filter')).toBeHidden();
    await expect(page.locator('#wants-select-toggle')).toBeVisible();
    const shareLabel=await page.evaluate(()=>i18nCore.t('product.share'));
    await expect(page.locator('.wants-list-toolbar').getByRole('button',{name:shareLabel,exact:true})).toBeVisible();
    await expect(high.locator('.wants-row')).toHaveCount(48);
    expect(await high.locator('.wants-row').evaluateAll(rows=>rows.map(row=>row.dataset.name).sort())).toEqual(fixture.high.map(entry=>entry.name).sort());
    await expect(high.locator('[data-contextual-copy]')).toHaveCount(1);
    await expect(high.locator('[data-contextual-copy]')).toBeVisible();
    await expect(high.locator('.contextual-details')).toBeHidden();
    await expect(high.locator('.contextual-omitted')).toHaveCount(0);
    await expect(page.locator('[data-manual-check-count],.contextual-manual-review,#legacy-list-tools')).toHaveCount(0);
    expect(await page.locator('#combined-list .contextual-details:visible').evaluateAll(nodes=>nodes.map(node=>node.closest('[data-wants-section]').dataset.wantsSection))).toEqual(['M']);
    await expect(medium.locator('.contextual-details')).toBeVisible();
    await expect(medium.locator('summary')).toHaveText('1 not included');
    await medium.locator('summary').click();
    await expect(medium.locator('.contextual-omitted')).toBeVisible();
    await expect(medium.locator('.contextual-omitted')).toHaveText('Dragonite');
    await expect(medium.locator('.contextual-unresolved')).toHaveText('These species could not be resolved and are not included in copied searches.');
    await medium.locator('summary').click();
    await expect(medium.locator('[data-contextual-copy]')).toHaveCount(1);
    await expect(medium.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',PROTECTED_PREFIX+'25,133,854,872');
    await medium.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(PROTECTED_PREFIX+'25,133,854,872');
    await toolsMenu(page).click();
    await expect(page.locator('#wants-list-tools .wants-list-menu > button')).toHaveCount(3);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press('Escape');await expect(toolsMenu(page)).toBeFocused();
  }
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
});

test('localized Share trigger opens and restores focus independently of optional-details diagnostics',async({page})=>{
  await installSimplificationFixture(page);
  for(const width of [1440,390,320])for(const locale of ['en','ja','es','de']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(locale=>changeInterfaceLocale(locale),locale);
    const shareLabel=await page.evaluate(()=>i18nCore.t('product.share'));
    const trigger=page.locator('.wants-list-toolbar').getByRole('button',{name:shareLabel,exact:true});
    await expect(trigger).toBeVisible();await trigger.click();
    await expect(page.locator('#product-share-modal')).toBeVisible();
    await expect(page.locator('#product-share-tab-link')).toHaveAttribute('aria-selected','true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#product-share-modal')).toBeHidden();await expect(trigger).toBeFocused();
  }
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
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
  await page.locator('#wants-import').click();
  await expect(page.locator('#import-modal')).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
});

test('real omissions name excluded entries, split queries remain bounded, and failed copy selects the exact part',async({page})=>{
  await installSimplificationFixture(page);
  const host=section(page,'H').locator('.wants-section-search');
  const evidence=await page.evaluate(()=>{
    const source=DB.costumes.find(entry=>entry.name==='Pikachu (Worlds 2025)');
    if(!source)throw new Error('Missing reviewed Pikachu costume');
    const entry={...source,category:'costumes',lucky:true};
    const entries=[entry,{name:'Unresolved fixture',no:null}];
    const plan=PogoDomain.searchStrings.contextualSearchPlan(entries,{locale:'en'});
    document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml(entries,'High',{compact:true});
    return{identity:PogoDomain.searchStrings.contextualEntryIdentity(entry),publicDex:PogoDomain.publicPokemonDex.dex(entry.name),entries:plan.manual.map(e=>({name:e.name,no:e.no,unresolved:e.unresolved}))};
  });
  expect(evidence).toEqual({identity:{resolved:true,explicit:false,category:'catalog-identity',catalogId:'pokemon:25:costume:PIKACHU_WCS_2025',speciesId:25},publicDex:25,entries:[{name:'Pikachu (Worlds 2025)',no:25,unresolved:false},{name:'Unresolved fixture',no:null,unresolved:true}]});
  await expect(host.locator('summary')).toHaveText('1 not included');await host.locator('summary').click();
  await expect(host.locator('.contextual-omitted')).toHaveText('Unresolved fixture');await expect(host.locator('.contextual-omitted')).not.toContainText('Pikachu');
  await expect(host.locator('[data-contextual-copy]')).toHaveCount(1);
  await expect(host.locator('[data-contextual-copy]')).toHaveAttribute('data-contextual-copy',PROTECTED_PREFIX+'25');
  await host.locator('[data-contextual-copy]').click();expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(PROTECTED_PREFIX+'25');
  // A valid dex number cannot make an unknown name or inconsistent form valid.
  for(const [entry,publicDex]of [[{name:'Pikachu costume',no:25,lucky:true},0],[{name:'Pikachu (Worlds 2025)',category:'costumes',no:133,lucky:true},25]]){
    const rejected=await page.evaluate(entry=>{
      document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml([entry],'High',{compact:true});
      return{identity:PogoDomain.searchStrings.contextualEntryIdentity(entry),publicDex:PogoDomain.publicPokemonDex.dex(entry.name)};
    },entry);
    expect(rejected).toEqual({identity:{resolved:false,explicit:false,category:'unresolved-catalog',speciesId:entry.no},publicDex});
    await expect(host.locator('summary')).toHaveText('1 not included');await host.locator('summary').click();
    await expect(host.locator('.contextual-omitted')).toHaveText(entry.name);
    await expect(host.locator('[data-contextual-copy]')).toHaveCount(0);
  }
  await page.evaluate(()=>document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml([{name:'Unresolved fixture',no:null}],'High',{compact:true}));
  await expect(host.locator('[data-contextual-copy]')).toHaveCount(0);await expect(host).toContainText('No species could be included');
  await expect(host.locator('summary')).toHaveText('1 not included');await host.locator('summary').click();
  await expect(host.locator('.contextual-omitted')).toHaveText('Unresolved fixture');
  await page.evaluate(()=>document.querySelector('[data-wants-section="H"] .wants-section-search').innerHTML=contextualIntentSearchHtml(Array.from({length:2000},(_,i)=>({no:i+1})),'High',{compact:true}));
  const parts=await host.locator('[data-contextual-copy]').evaluateAll(nodes=>nodes.map(n=>n.dataset.contextualCopy));
  expect(parts.length).toBeGreaterThan(1);expect(parts.every(p=>p.length<=1500)).toBe(true);
  const species=[];
  for(const part of parts){
    const clauses=part.split('&');
    expect(clauses.slice(0,-1)).toEqual(['!4*','!traded','!shiny','CP-2500','!shadow','!purified','!background']);
    expect(clauses.at(-1)).toMatch(/^\d+(,\d+)*$/);
    species.push(...clauses.at(-1).split(',').map(Number));
  }
  expect(species).toEqual(Array.from({length:2000},(_,i)=>i+1));
  expect(new Set(species).size).toBe(2000);
  await expect(host.locator('.contextual-omitted')).toHaveCount(0);
  await expect(host.locator('.contextual-details')).toBeVisible();
  await expect(host.locator('summary')).toHaveText('Split search');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
  await host.locator('[data-contextual-copy]').nth(1).click();
  await expect(host.locator('textarea').nth(1)).toBeFocused();await expect(host.locator('textarea').nth(1)).toHaveValue(parts[1]);
  expect(await host.locator('textarea').nth(1).evaluate(n=>n.selectionEnd-n.selectionStart)).toBe(parts[1].length);
  await expect(host.locator('.contextual-copy-status')).toHaveClass(/is-error/);
  await expect(host.locator('.contextual-copy-status')).toHaveText(await page.evaluate(()=>i18nCore.t('strings.copyFailed')));
  expect(await page.evaluate(()=>JSON.stringify(allData)===__simplificationBefore)).toBe(true);
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
