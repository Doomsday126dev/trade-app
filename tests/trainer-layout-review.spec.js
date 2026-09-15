const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const {installReviewFixture,showReviewSurface}=require('./helpers/ui-review-fixture.cjs');

test.use({serviceWorkers:'block'});

const preview=async(page,name)=>{
  if(!process.env.TRAINER_LAYOUT_PREVIEW)return;
  fs.mkdirSync(process.env.TRAINER_LAYOUT_PREVIEW,{recursive:true});
  await page.screenshot({path:path.join(process.env.TRAINER_LAYOUT_PREVIEW,`${name}.png`),animations:'disabled'});
};

async function installPopulatedFavorites(page){
  await installReviewFixture(page);
  await page.evaluate(async()=>{
    const store=ensureTrainerHistoryStore();
    store.renameTag(window.__reviewGroupIds.regional,'Regional swaps and distance trades');
    store.renameTag(window.__reviewGroupIds.raid,'Raid friends with a very long group name');
    const ids=window.__reviewGroupIds,tags=store.read().tags;
    const names=['Alice','Blair','Jamie','Noah','RegionalCollectorWithALongName','PrivateTrainer',
      ...Array.from({length:18},(_,index)=>`Trainer Number ${String(index+7).padStart(2,'0')}`)];
    const favorites=names.map((displayName,index)=>({
      key:displayName.toLowerCase().replaceAll(' ',''),displayName,
      tagIds:index%3===0?[ids.weekend]:index%3===1?[ids.regional]:[ids.raid],
      createdAt:index+1,updatedAt:index+1
    }));
    store.replaceSyncedOrganization({favorites,tags});
    Object.assign(allData.loginDirectory,Object.fromEntries(names.map(name=>[name,{authReady:true}])));
    managedFavoriteAdditions={};
    window.__layoutOpened='';window.__layoutOrganized='';
    openFavoriteTrainerByName=name=>{window.__layoutOpened=name;};
    openTrainerOrganizer=name=>{window.__layoutOrganized=name;};
    switchTab('find');setTrainerDiscoveryMode('favorites');await renderTrainerQuickLists();
    document.getElementById('toast').classList.remove('show');scrollTo(0,0);
  });
}

test('populated Favorites keeps groups direct and trainer actions distinct at desktop, 390, and 320',async({page},testInfo)=>{
  await installPopulatedFavorites(page);
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>scrollTo(0,0));

  await expect(page.locator('.favorite-card-shell')).toHaveCount(24);
  await expect(page.locator('.favorite-group-access')).toBeVisible();
  await expect(page.locator('.favorite-group-access .favorite-filter-chip')).toHaveCount(4);
  await expect(page.getByRole('button',{name:'All Favorites',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'View all wants',exact:true})).toBeVisible();
  await expect(page.locator('.favorite-groups-disclosure')).not.toHaveAttribute('open','');
  await preview(page,'desktop-populated-favorites');

  await page.getByRole('button',{name:'View all wants',exact:true}).click();
  await expect(page.locator('#trainer-groups-title')).toHaveText('All Favorites');
  await expect(page.locator('#trainer-group-results [data-contextual-copy]').first()).toBeFocused();
  await page.locator('[data-group-action="back"]').click();
  await expect(page.getByRole('button',{name:'View all wants',exact:true})).toBeFocused();

  const regional=page.getByRole('button',{name:'Regional swaps and distance trades',exact:true});
  await regional.click();
  await expect(regional).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.favorite-card-shell')).toHaveCount(8);
  const weekend=page.getByRole('button',{name:'Weekend trades',exact:true});
  await weekend.click();
  await expect(weekend).toHaveAttribute('aria-pressed','true');
  await expect(regional).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.favorite-card-shell')).toHaveCount(8);
  await regional.click();
  await expect(regional).toHaveAttribute('aria-pressed','true');
  await expect(weekend).toHaveAttribute('aria-pressed','false');
  await regional.click();
  await expect(regional).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.favorite-card-shell')).toHaveCount(8);
  await expect(page.getByRole('button',{name:'View group wants',exact:true})).toBeVisible();
  await page.evaluate(()=>scrollTo(0,0));
  await preview(page,'desktop-group-selected');

  await page.getByRole('button',{name:'View group wants',exact:true}).click();
  const directCopy=page.locator('#trainer-group-results [data-contextual-copy]').first();
  await expect(directCopy).toBeVisible();
  await expect(directCopy).toBeFocused();
  await expect(page.locator('.group-management')).toBeVisible();
  await expect(page.locator('.favorite-groups-disclosure > summary')).toBeHidden();
  await page.locator('.group-management > summary').click();
  await expect(page.getByRole('button',{name:'Delete group',exact:true})).toBeVisible();
  await preview(page,'desktop-group-wants-manage');
  await page.locator('.group-management > summary').click();
  await preview(page,'desktop-group-wants-copy');
  await page.locator('[data-group-action="back"]').click();
  await expect(page.getByRole('button',{name:'View group wants',exact:true})).toBeFocused();
  await expect(page.locator('.favorite-card-shell')).toHaveCount(8);

  await page.evaluate(async()=>{trainerOrganizerState.tagIds=[window.__reviewGroupIds.regional,window.__reviewGroupIds.raid];await renderTrainerQuickLists();});
  await expect(page.getByRole('button',{name:'All Favorites',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'View all wants',exact:true})).toBeEnabled();
  await expect(page.locator('.favorite-card-shell')).toHaveCount(24);
  await regional.click();

  const first=page.locator('.favorite-card-shell').first();
  await expect(first.locator('.favorite-card-primary .favorite-card-chevron')).toBeVisible();
  await expect(first.locator('.favorite-card-primary button')).toHaveCount(0);
  await first.locator('.favorite-card-primary').click();
  await expect.poll(()=>page.evaluate(()=>window.__layoutOpened)).not.toBe('');
  await first.locator('.favorite-card-add-tag').click();
  await expect.poll(()=>page.evaluate(()=>window.__layoutOrganized)).not.toBe('');
  await first.locator('.favorite-card-more').click();
  await expect(first.locator('.favorite-card-menu')).toBeVisible();

  await page.getByRole('button',{name:'All Favorites',exact:true}).click();
  await expect(page.locator('.favorite-card-shell')).toHaveCount(24);
  await page.locator('.favorite-groups-disclosure > summary').click();
  await page.locator(`[data-group-open-id="${await page.evaluate(()=>window.__reviewGroupIds.weekend)}"]`).click();
  await expect(page.locator('#trainer-group-results [data-contextual-copy]').first()).toBeVisible();
  await expect(page.locator('.group-management')).toBeVisible();
  await page.locator('[data-group-action="back"]').click();
  await expect(page.locator('.favorite-group-access')).toBeVisible();

  for(const width of [390,320]){
    await page.getByRole('button',{name:'All Favorites',exact:true}).click();
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>scrollTo(0,0));
    await expect(page.locator('.favorite-card-primary').first()).toBeVisible();
    await expect(page.locator('.favorite-card-more').first()).toBeVisible();
    const geometry=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth>innerWidth,
      primary:document.querySelector('.favorite-card-primary').getBoundingClientRect().width,
      more:document.querySelector('.favorite-card-more').getBoundingClientRect().height,
      chips:document.querySelector('.favorite-group-access-list').getBoundingClientRect().width,
      action:document.querySelector('.favorite-group-wants-action').getBoundingClientRect().height
    }));
    expect(geometry.overflow).toBe(false);expect(geometry.primary).toBeGreaterThan(120);
    expect(geometry.more).toBeGreaterThanOrEqual(44);expect(geometry.chips).toBeGreaterThan(0);expect(geometry.action).toBeGreaterThanOrEqual(44);
    const lastChip=page.locator('.favorite-group-access-list [data-favorite-tag-id]').last();
    await lastChip.focus();
    await expect.poll(()=>page.evaluate(()=>document.querySelector('.favorite-group-access-list').scrollLeft)).toBeGreaterThan(0);
    await lastChip.press('Enter');
    await expect(lastChip).toBeFocused();
    const chipPosition=await lastChip.evaluate((chip)=>{const item=chip.getBoundingClientRect(),strip=chip.parentElement.getBoundingClientRect();return{left:item.left-strip.left,right:item.right-strip.right};});
    expect(chipPosition.left).toBeGreaterThanOrEqual(-1);expect(chipPosition.right).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button',{name:'View group wants',exact:true})).toBeVisible();
    if(testInfo.project.name==='mobile'){
      await page.getByRole('button',{name:'View group wants',exact:true}).tap();
      await expect(page.locator('#trainer-group-results [data-contextual-copy]').first()).toBeVisible();
      await page.locator('[data-group-action="back"]').tap();
    }
    if(width===390)await preview(page,'390-group-selected');
  }

  await page.evaluate(async()=>{
    const store=ensureTrainerHistoryStore();store.replaceSyncedOrganization({favorites:[],tags:{}});
    await renderTrainerQuickLists();
  });
  await expect(page.locator('.favorite-group-access')).toHaveCount(0);
  await expect(page.locator('#favorite-trainers-list .empty-state')).toBeVisible();
});

test('saved Favorites without groups still open the honest all-Favorites aggregate and Copy Search',async({page})=>{
  await installPopulatedFavorites(page);
  await page.evaluate(async()=>{
    const store=ensureTrainerHistoryStore(),state=store.read();
    store.replaceSyncedOrganization({favorites:state.favorites.map(item=>({...item,tagIds:[]})),tags:{}});
    trainerOrganizerState.query='Alice';
    await renderTrainerQuickLists();
  });
  await expect(page.locator('.favorite-group-access-list')).toHaveCount(0);
  await expect(page.locator('.favorite-card-shell')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'View all wants',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View all wants',exact:true}).click();
  await expect(page.locator('#trainer-groups-title')).toHaveText('All Favorites');
  await expect(page.locator('#trainer-groups .trainer-section-heading')).toContainText('24 trainers');
  const copy=page.locator('#trainer-group-results [data-contextual-copy]').first();
  await expect(copy).toBeVisible();await copy.click();
  await expect.poll(()=>page.evaluate(()=>window.__reviewCopy.length)).toBeGreaterThan(0);
  await page.locator('[data-group-action="back"]').click();
  await expect(page.locator('.favorite-card-shell')).toHaveCount(1);
  await expect(page.locator('#favorite-trainer-search')).toHaveValue('Alice');
});

test('Who wants this stays simple with real populated variants and priorities on mobile',async({page})=>{
  await installPopulatedFavorites(page);
  await page.setViewportSize({width:390,height:844});
  await showReviewSurface(page,'who-wants');
  await expect(page.locator('.favorite-browse-row')).toHaveCount(6);
  await expect(page.locator('.favorite-browse-row').first()).toContainText(/Pikachu/);
  await expect(page.locator('.favorite-browse-row').first()).toContainText(/High|Medium|Low/);
  await expect(page.locator('.favorite-browse-row button[data-trainer-action="open"]').first()).toBeVisible();
  await expect(page.locator('[data-contextual-copy]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await preview(page,'390-populated-who-wants');
});

test('pending and unsuccessful Favorite additions remain visible',async({page})=>{
  await installReviewFixture(page);
  await page.evaluate(async()=>{
    allData.loginDirectory.PendingTrainer={authReady:true};allData.loginDirectory.NeedsRetryTrainer={authReady:true};
    managedFavoriteAdditions={};switchTab('find');setTrainerDiscoveryMode('favorites');await renderTrainerQuickLists();
    managedAccountSyncRuntime={ownerUid:auth.currentUser.uid,controller:{activeEntities:()=>[]},listRecoveryCandidates:async()=>[]};
    favoriteAdditionUiState={remaining:98,rows:[{handle:'PendingTrainer',state:'pending'},{handle:'NeedsRetryTrainer',state:'unsuccessful',code:'favorite/identity-unavailable'}]};
    managedFavoriteAdditions={refresh:async()=>favoriteAdditionUiState,cancel:async()=>{}};
    await openFavoritePicker(document.body);
  });
  await expect(page.locator('.favorite-picker-row[data-state="pending"]')).toContainText('Pending');
  await expect(page.locator('.favorite-picker-row[data-state="unsuccessful"]')).toContainText('Not saved · add again');
});
