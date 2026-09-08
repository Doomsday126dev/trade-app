const {test,expect}=require('@playwright/test');
const {installPriorityReviewFixture}=require('./helpers/my-list-priority-fixture.cjs');
test.use({serviceWorkers:'block'});
const section=(page,key)=>page.locator(`#combined-list > [data-wants-section="${key}"]`);

async function fixture(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await installPriorityReviewFixture(page);
  expect(errors).toEqual([]);
}

test('priority and special sections preserve all semantic rows, qualifiers and compact actions',async({page})=>{
  await fixture(page);
  expect(await page.locator('#combined-list > section').evaluateAll(nodes=>nodes.map(node=>node.dataset.wantsSection))).toEqual(['H','M','L','LUCKY','LUCKY+XXL','SHINY','XXL','XXS','NEEDS_PRIORITY']);
  await expect(section(page,'H').locator('[data-name="Pikachu"]')).toHaveCount(1);
  await expect(section(page,'LUCKY').locator('[data-name="Pikachu"]')).toHaveCount(1);
  await expect(section(page,'M')).toContainText('Antique');
  await expect(section(page,'NEEDS_PRIORITY')).toContainText('Psyduck');
  await expect(page.locator('#combined-list .myrow-priority-chip')).toHaveCount(0);
  await expect(page.locator('#wants-search-scope')).toHaveCount(0);
  await expect(page.locator('#intent-review')).toBeHidden();
  await expect(page.locator('#wants-selection-tools')).toBeHidden();
  await expect(page.locator('#wants-select-toggle')).toHaveText('Select');
  for(const key of ['H','M','L','LUCKY','XXL','XXS']){
    await expect(section(page,key).locator('[data-contextual-copy]')).toBeVisible();
    await expect(section(page,key).locator('textarea')).toBeHidden();
  }
  await expect(page.locator('#combined-list .myrow-edit')).toHaveCount(18);
  expect(await page.locator('#combined-list .mctrl').evaluateAll(nodes=>nodes.every(node=>node.textContent.trim()===''&&[...node.querySelectorAll('button')].every(button=>button.getAttribute('aria-label')&&button.title)))).toBe(true);
});

test('per-section Copy Search stays full-section across filtering, collapse and search locale changes',async({page})=>{
  await fixture(page);
  for(const locale of ['en','ja','es','de']){
    await page.evaluate(locale=>{i18nCore.setLocale(locale);renderMyList();},locale);
    const high=section(page,'H');
    const query=await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan(productDeclarations().entries.filter(entry=>entry.p==='H'),{locale:pokemonGoSearchLocale()}).parts[0]);
    await page.locator('#combined-filter').fill('Pikachu');
    await expect(high.locator('.myrow')).toHaveCount(2);
    const medium=section(page,'M');
    await expect(medium.locator('.myrow')).toHaveCount(0);
    await expect(medium.locator('[data-contextual-copy]')).toBeVisible();
    await medium.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan(productDeclarations().entries.filter(entry=>entry.p==='M'),{locale:pokemonGoSearchLocale()}).parts[0]));
    await high.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(query);
    await high.locator('.mylist-priority-toggle').click();
    await expect(high.locator('.myrow')).toHaveCount(0);
    await high.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(query);
    await high.locator('.mylist-priority-toggle').click();
    await page.locator('#combined-filter').fill('');
    await expect(page.locator('#combined-list .myrow')).toHaveCount(18);
  }
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__priorityReviewData));
});

test('Advanced combinations are explicit independent scopes, with manual exact-check guidance',async({page})=>{
  await fixture(page);
  await page.locator('#legacy-list-tools > summary').click();
  await page.locator('[data-wants-scope="H"]').click();
  await page.locator('[data-wants-scope="M"]').click();
  const result=page.locator('.wants-custom-result');
  const assertScope=async keys=>{
    const expected=await page.evaluate(keys=>PogoDomain.searchStrings.contextualSearchPlan(productDeclarations().entries.filter(entry=>keys.includes(entry.p)||(!entry.p&&keys.includes('LUCKY')&&entry.lucky)),{locale:pokemonGoSearchLocale()}).parts[0],keys);
    await result.locator('[data-contextual-copy]').click();
    expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(expected);
  };
  await assertScope(['H','M']);
  await page.locator('[data-wants-scope="LUCKY"]').click();
  await assertScope(['H','M','LUCKY']);
  await result.locator('summary').click();
  await expect(result.locator('.contextual-search-body')).toContainText(/species/i);
  await expect(page.locator('#wants-search-scope')).toHaveCount(0);
  await expect(page.locator('[data-wants-scope="H"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-wants-scope="LUCKY"]')).toHaveAttribute('aria-pressed','true');
});

test('selection is contextual, survives filters, and copies/shares only selected declarations',async({page})=>{
  await fixture(page);
  await page.locator('#wants-select-toggle').click();
  await section(page,'H').locator('[data-name="Pikachu"] input').check();
  await section(page,'LUCKY').locator('[data-name="Pikachu"] input').check();
  await expect(page.locator('#combined-selected-count')).toHaveText('2 selected');
  await page.locator('#combined-filter').fill('Eevee');
  await expect(page.locator('#combined-list .myrow')).toHaveCount(1);
  await expect(page.locator('#combined-selected-count')).toHaveText('2 selected');
  await page.locator('#combined-search [data-contextual-copy]').click();
  const expected=await page.evaluate(()=>PogoDomain.searchStrings.contextualSearchPlan([{no:25}],{locale:pokemonGoSearchLocale()}).parts[0]);
  expect(await page.evaluate(()=>__priorityReviewCopied)).toBe(expected);
  await page.locator('#wants-selection-share').click();
  await expect(page.locator('#product-share-scope')).toHaveValue('selected');
  await expect(page.locator('#product-share-preview li')).toHaveCount(2);
  await expect(page.locator('[data-share-mode="link"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#wants-selection-tools button[onclick="clearWantsSelection()"] ').click();
  await expect(page.locator('#wants-selection-tools')).toBeHidden();
  await expect(page.locator('#wants-select-toggle')).toBeVisible();
  await page.locator('#combined-filter').fill('');
  expect(await page.evaluate(()=>combinedSelection.size)).toBe(0);
});

test('priority edit moves the canonical normal want and its exact alias without mutating Lucky',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const catalog=accountSyncCatalogIdentity('wishlist','Pikachu');
    const normalIdentity={surface:'my-list',lane:'wishlist',catalogId:catalog.catalogId};
    const aliasIdentity={surface:'my-list',lane:'looking-for',catalogId:catalog.catalogId};
    const luckyIdentity={surface:'special-board',lane:'looking-for',catalogId:catalog.catalogId};
    window.__normalId=accountSyncModel.tradeEntryId(normalIdentity);
    window.__aliasId=accountSyncModel.tradeEntryId(aliasIdentity);
    window.__luckyId=accountSyncModel.tradeEntryId(luckyIdentity);
    allData.users[cur].intentDeclarations=[{name:'Pikachu',side:'lf',p:'H',entityId:__aliasId,catalogId:catalog.catalogId}];
    accountSyncCanonicalEntities=[normalIdentity,aliasIdentity,luckyIdentity].map(identity=>({entityId:accountSyncModel.tradeEntryId(identity),identity,deleted:false}));
    accountSyncMutationAuthority=async()=>({mode:'canonical',controller:{}});accountSyncAuthorityCurrent=()=>true;
    window.__specialBefore=JSON.stringify(allData.users[cur].specialTradeBoard);
    applyAccountSyncTradeMutations=async mutations=>{
      window.__mutations=mutations;
      for(const mutation of mutations){
        if(mutation.entityId===__normalId)allData.wishlist[cur].Pikachu=mutation.patch.priority;
        if(mutation.entityId===__aliasId)allData.users[cur].intentDeclarations[0].p=mutation.patch.priority;
      }
      return{ok:true};
    };
    renderMyList();
  });
  await section(page,'M').locator('.mylist-priority-toggle').click();
  await section(page,'H').locator('[data-name="Pikachu"] .myrow-edit').click();
  await page.locator('#combined-priority').selectOption('M');
  await page.locator('#combined-save').click();
  await expect(section(page,'M').locator('[data-name="Pikachu"]')).toHaveCount(1);
  await expect(section(page,'H').locator('[data-name="Pikachu"]')).toHaveCount(0);
  await expect(section(page,'LUCKY').locator('[data-name="Pikachu"]')).toHaveCount(1);
  expect(await page.evaluate(()=>({mutations:__mutations.map(m=>({id:m.entityId,patch:m.patch})),expected:[__normalId,__aliasId].sort(),lucky:__luckyId,specialUntouched:JSON.stringify(allData.users[cur].specialTradeBoard)===__specialBefore}))).toEqual(expect.objectContaining({specialUntouched:true}));
  const audit=await page.evaluate(()=>({ids:__mutations.map(m=>m.entityId).sort(),expected:[__normalId,__aliasId].sort(),patches:__mutations.map(m=>m.patch)}));
  expect(audit.ids).toEqual(audit.expected);expect(audit.patches).toEqual([{priority:'M'},{priority:'M'}]);
});

test('new special wants save without priority; new normal wants require classification and existing legacy is preserved',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    accountSyncCanonicalEntities=[];
    accountSyncMutationAuthority=async()=>({mode:'canonical',controller:{}});accountSyncAuthorityCurrent=()=>true;
    window.__mutations=[];applyAccountSyncTradeMutations=async mutations=>{window.__mutations=mutations;return{ok:false};};
    openCombinedEditor();
  });
  await page.locator('#combined-name').fill('Charmander');
  await page.locator('#combined-save').click();
  await expect(page.locator('#combined-error')).toHaveText('Choose a priority or a special requirement.');
  expect(await page.evaluate(()=>__mutations)).toEqual([]);
  for(const flag of ['lucky','xxl','xxs','shiny']){
    await page.evaluate(()=>openCombinedEditor());
    await page.locator('#combined-name').fill('Charmander');
    await page.locator('#combined-'+flag).check();
    await page.locator('#combined-save').click();
    const mutation=await page.evaluate(()=>__mutations[0]);
    expect(mutation.values.priority).toBe('');expect(mutation.values[flag]).toBe(true);
    expect(mutation.identity.lane).toBe('looking-for');
  }
  await page.keyboard.press('Escape');
  await section(page,'NEEDS_PRIORITY').locator('.myrow-edit').click();
  await expect(page.locator('#combined-priority')).toHaveValue('');
  await expect(page.locator('#combined-name')).toHaveValue('Psyduck');
});

test('remove icon retains confirmation and clipboard failure opens only that section for manual recovery',async({page})=>{
  await fixture(page);
  let dismissed=0;page.once('dialog',async dialog=>{dismissed++;await dialog.dismiss();});
  await section(page,'H').locator('.myrow-remove').first().click();
  expect(dismissed).toBe(1);await expect(page.locator('#combined-list .myrow')).toHaveCount(18);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('denied');};});
  await section(page,'H').locator('[data-contextual-copy]').click();
  await expect(section(page,'H').locator('textarea')).toBeFocused();
  await expect(section(page,'M').locator('textarea')).toBeHidden();
  expect(await page.evaluate(()=>JSON.stringify(allData))).toBe(await page.evaluate(()=>__priorityReviewData));
});

test('responsive rows, selection and Advanced tools fit 1440, 390 and 320 in both themes',async({page})=>{
  await fixture(page);
  for(const theme of ['dark','light'])for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    // Measure resting hit areas after the existing row entrance translation ends.
    await page.locator('#combined-list .myrow').evaluateAll(rows=>Promise.all(rows.flatMap(row=>row.getAnimations()).map(animation=>animation.finished)));
    const geometry=await page.locator('#combined-list .myrow').evaluateAll(rows=>rows.map(row=>({width:row.getBoundingClientRect().width,scroll:row.scrollWidth,height:row.getBoundingClientRect().height,
      hits:[...row.querySelectorAll('.mctrl button')].map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))})));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(geometry.every(row=>row.scroll<=Math.ceil(row.width))).toBe(true);
    expect(geometry.every(row=>row.hits.every(hit=>hit.height>=44&&hit.width>=(width<601?44:40))),JSON.stringify({theme,width,geometry})).toBe(true);
    await page.evaluate(()=>startWantsSelection());
    await section(page,'H').locator('input').first().check();
    await page.locator('#legacy-list-tools > summary').click();
    await page.locator('[data-wants-scope="H"]').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.evaluate(()=>{clearWantsSelection();document.getElementById('legacy-list-tools').open=false;});
  }
});

test('classified wants cannot become legacy; genuine legacy edits persist and classification removes the maintenance section',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    accountSyncCanonicalEntities=[];window.__writes=[];
    for(const name of ['Pikachu','Bulbasaur','Psyduck']){
      const catalog=accountSyncCatalogIdentity('wishlist',name),identity={surface:'my-list',lane:'wishlist',catalogId:catalog.catalogId};
      accountSyncCanonicalEntities.push({entityId:accountSyncModel.tradeEntryId(identity),identity,deleted:false});
    }
    accountSyncMutationAuthority=async()=>({mode:'canonical',controller:{}});accountSyncAuthorityCurrent=()=>true;
    applyAccountSyncTradeMutations=async mutations=>{
      __writes.push(...mutations);
      for(const mutation of mutations)if(mutation.patch?.priority)allData.wishlist[cur].Psyduck=mutation.patch.priority;
      return{ok:true};
    };
  });
  await section(page,'H').locator('[data-name="Pikachu"] .myrow-edit').click();
  await page.locator('#combined-priority').selectOption('');await page.locator('#combined-save').click();
  await expect(page.locator('#combined-error')).toContainText('Choose a priority');
  expect(await page.evaluate(()=>__writes.length)).toBe(0);await page.keyboard.press('Escape');
  await section(page,'LUCKY').locator('[data-name="Bulbasaur"] .myrow-edit').click();
  await page.locator('#combined-lucky').uncheck();await page.locator('#combined-save').click();
  await expect(page.locator('#combined-error')).toContainText('Choose a priority');
  expect(await page.evaluate(()=>__writes.length)).toBe(0);await page.keyboard.press('Escape');
  await section(page,'NEEDS_PRIORITY').locator('.myrow-edit').click();
  await page.locator('#combined-editor-modal details > summary').click();
  await page.locator('#combined-note').fill('Keep until classified');await page.locator('#combined-save').click();
  expect(await page.evaluate(()=>__writes.at(-1).patch)).toEqual({note:'Keep until classified'});
  await expect(section(page,'NEEDS_PRIORITY')).toHaveCount(1);
  await section(page,'NEEDS_PRIORITY').locator('.myrow-edit').click();await page.locator('#combined-priority').selectOption('L');await page.locator('#combined-save').click();
  await expect(section(page,'NEEDS_PRIORITY')).toHaveCount(0);await expect(section(page,'L').locator('[data-name="Psyduck"]')).toHaveCount(1);
});

test('unresolved-only wants cannot imply an empty list or a match-all query',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{allData=normalizeData({users:{Avery:{}},wishlist:{Avery:{'Unresolved exact Pokémon':'[xxs]'}}});renderMyList();});
  await expect(section(page,'XXS')).toContainText('Unresolved exact Pokémon');
  await expect(section(page,'XXS')).toContainText('Search unavailable');
  await expect(section(page,'XXS').locator('[data-contextual-copy]')).toHaveCount(0);
  await expect(section(page,'XXS')).not.toContainText('No entries in this scope');
});
