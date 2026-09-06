const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
async function fixture(page){
  page.on('pageerror',error=>{throw error;});
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('https://**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.route('**/sw.js*',r=>r.abort());
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copy=text;}}}));
  await page.goto('./?groups-fixture');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');await page.evaluate(()=>__pogoEnsureFullApp('groups-fixture'));
  await page.waitForFunction(()=>typeof renderTrainerGroups==='function');
  await page.evaluate(()=>{
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='GroupFixture';auth={currentUser:{uid:'synthetic-group'}};allData=normalizeData({users:{GroupFixture:{authUid:'synthetic-group'}}});
    accountSyncMutationAuthority=async()=>({mode:'legacy'});accountSyncAuthorityCurrent=()=>true;
    const store=ensureTrainerHistoryStore();for(const name of ['Alice','Bob','Private','Old'])store.saveFavoriteOrganization(name);
    window.__reads=[];
    const cache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({repository:{read:async name=>{
      __reads.push(name);if(name==='Private')return{ok:true,value:null};
      const updatedAt=Date.now()-(name==='Old'?31*86400000:1000);
      return{ok:true,value:{version:1,username:name,profile:{friendCode:'',lastUpdated:updatedAt},lists:{wishlist:{Pikachu:name==='Bob'?'M':'H',...(name==='Alice'?{Snom:'L'}:{})},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt}};
    }},validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot});
    cache.activate({uid:'synthetic-group',username:cur});ensureFavoriteShareSessionCache=()=>cache;
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';switchTab('find',{render:false});setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();
  });
}
test('group CRUD and membership reuse private favorites; aggregate and copy only fresh permitted wants',async({page})=>{
  await fixture(page);await page.getByLabel('New group name',{exact:true}).fill('NYC trades');await page.getByRole('button',{name:'Create group',exact:true}).click();
  await page.locator('.group-membership summary').click();
  for(const name of ['Alice','Bob','Private','Old']){
    const input=page.locator(`[data-group-member="${name}"]`);if(!await input.isVisible())await page.locator('.group-membership summary').click();await input.check();
    await expect(page.locator('[data-group-action="refresh"]')).toBeEnabled();
  }
  await expect(page.locator('.group-availability')).toContainText('Private');await expect(page.locator('.group-availability')).toContainText('Unavailable');
  await expect(page.locator('.group-wants')).toContainText('Alice');await expect(page.locator('.group-wants')).toContainText('Bob');await expect(page.locator('.group-wants')).not.toContainText('Old');
  expect(await page.evaluate(()=>__reads.length)).toBe(4);
  await page.locator('#trainer-group-scope').selectOption('top');await expect(page.locator('.group-wants')).not.toContainText('Bob');
  await page.locator('#trainer-group-results [data-contextual-copy]').click();expect(await page.evaluate(()=>__copy)).toBe('!traded&25');
  await page.locator('[data-group-form="rename"] input').fill('Japan friends');await page.getByRole('button',{name:'Rename',exact:true}).click();
  expect(await page.evaluate(()=>Object.values(ensureTrainerHistoryStore().read().tags).map(x=>x.label))).toEqual(['Japan friends']);
  await page.locator('.group-membership summary').click();
  await page.locator('#trainer-group-scope').selectOption('all');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.GROUP_SCREENSHOTS){
    fs.mkdirSync(process.env.GROUP_SCREENSHOTS,{recursive:true});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`${process.env.GROUP_SCREENSHOTS}/groups-${test.info().project.name}.png`,animations:'disabled'});
    await page.locator('#trainer-group-results [data-contextual-copy]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${process.env.GROUP_SCREENSHOTS}/groups-search-${test.info().project.name}.png`,animations:'disabled'});
  }
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete group',exact:true}).click();
  expect(await page.evaluate(()=>ensureTrainerHistoryStore().read().favorites.length)).toBe(4);
  expect(await page.evaluate(()=>Object.keys(ensureTrainerHistoryStore().read().tags).length)).toBe(0);
});
test('canonical group operations use only existing tag entities; blocked writes never fall back locally',async({page})=>{
  await fixture(page);
  const result=await page.evaluate(async()=>{
    const store=ensureTrainerHistoryStore(),calls=[];
    const project=(id,label,deleted=false)=>{
      const state=store.read(),tags={...state.tags};if(deleted)delete tags[id];else tags[id]={id,label};
      store.replaceSyncedOrganization({favorites:state.favorites,tags});
    };
    accountSyncMutationAuthority=async()=>({mode:'canonical',controller:{
      addEntity:async input=>{calls.push(input);project(input.entityId,input.values.label);return{ok:true};},
      patchEntity:async input=>{calls.push(input);project(input.entityId,input.patch.label);return{ok:true};},
      deleteEntity:async input=>{calls.push(input);project(input.entityId,'',true);return{ok:true};}
    }});
    const created=await saveTrainerGroup('create','Canonical'),id=trainerGroupState.id;
    const renamed=await saveTrainerGroup('rename','Renamed'),deleted=await saveTrainerGroup('delete','');
    accountSyncMutationAuthority=async()=>({mode:'blocked'});
    const blocked=await saveTrainerGroup('create','Blocked');
    return{created,renamed,deleted,blocked,id,calls,remaining:Object.keys(store.read().tags).length};
  });
  expect(result).toMatchObject({created:true,renamed:true,deleted:true,blocked:false,remaining:0});
  expect(result.calls.map(call=>call.entityType)).toEqual(['tag','tag','tag']);
  expect(result.calls.every(call=>call.entityId===result.id)).toBe(true);
});
test('expired results cannot copy and identity changes clear groups',async({page})=>{
  await fixture(page);
  await page.evaluate(async()=>{const store=ensureTrainerHistoryStore(),tag=store.createTag('One');store.setFavoriteTags('Alice',[tag.id]);await openTrainerGroup(tag.id);trainerGroupState.records.forEach(record=>record.fetchedAt=Date.now()-300001);window.__copy='';});
  await page.locator('#trainer-group-results [data-contextual-copy]').click();expect(await page.evaluate(()=>__copy)).toBe('');
  await expect(page.locator('#trainer-group-results [data-contextual-copy]')).toHaveCount(0);
  await page.evaluate(()=>{resetTrainerOrganizerState();cur='Other';auth={currentUser:{uid:'synthetic-other'}};renderTrainerGroups();});
  await expect(page.locator('#trainer-groups')).not.toContainText('Alice');
});
test('late public responses cannot restore a previous account group',async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const store=ensureTrainerHistoryStore(),tag=store.createTag('Pending');store.setFavoriteTags('Alice',[tag.id]);
    ensureFavoriteShareSessionCache=()=>({syncFavorites(){},readFavorite:()=>new Promise(resolve=>{window.__resolveGroup=resolve;})});
    window.__pendingGroup=openTrainerGroup(tag.id);
  });
  await expect(page.locator('.group-availability')).toContainText('Checking');
  await page.evaluate(async()=>{
    resetTrainerOrganizerState();cur='Other';auth={currentUser:{uid:'synthetic-other'}};renderTrainerGroups();
    __resolveGroup({status:'published',fetchedAt:Date.now(),updatedAt:Date.now(),listSnapshot:{lists:{wishlist:{Pikachu:'H'}}}});
    await __pendingGroup;
  });
  await expect(page.locator('#trainer-groups')).not.toContainText('Alice');
  expect(await page.evaluate(()=>trainerGroupState.records.length)).toBe(0);
});
