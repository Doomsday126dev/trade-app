const{test,expect}=require('@playwright/test'),{fixture}=require('./helpers/usability-fixture.cjs'),fs=require('node:fs');
const names=['OrderAlpha','OrderBeta','OrderDelta','OrderEcho','OrderFoxtrot','OrderGamma','OrderZulu'];
const ordered=['OrderBeta','OrderDelta','OrderGamma','OrderAlpha','OrderEcho','OrderFoxtrot','OrderZulu'];
const cards=page=>page.locator('#favorite-trainers-list .favorite-card-shell');
const order=page=>cards(page).evaluateAll(nodes=>nodes.map(n=>n.dataset.trainer));
async function setup(page,width){await page.setViewportSize({width,height:width<700?844:1000});await fixture(page);await page.evaluate(names=>{
 const store=ensureTrainerHistoryStore();store.clear();for(const name of names)store.toggleFavorite(name);
 const state=store.read();store.replaceSyncedOrganization({favorites:state.favorites.map(item=>({...item,tagIds:['OrderAlpha','OrderBeta','OrderEcho'].includes(item.displayName)?['tag_nyc']:[]})),tags:{tag_nyc:{id:'tag_nyc',label:'NYC'}}});
 window.__beforeFavorites=JSON.stringify(store.read());window.__trustedWrites=[];window.__favoriteMetadataReads=[];window.__favoriteMetadataGate=new Promise(resolve=>window.__releaseMetadata=resolve);
 const dates={OrderAlpha:'2026-10-24T10:00:00Z',OrderBeta:'2026-10-27T10:00:00Z',OrderDelta:'2026-10-27T10:00:00Z',OrderGamma:'2026-10-26T10:00:00Z'};
 managedPublicShareRepository={read:async name=>{__favoriteMetadataReads.push(name);await __favoriteMetadataGate;return{ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:dates[name]?Date.parse(dates[name]):0}};}};
 managedFavoriteAdditions={};favoriteShareSessionCache=null;switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();
 window.__completeMetadata=()=>favoriteShareSessionCache.hydrate(store.read().favorites);
 },names);await expect(cards(page)).toHaveCount(7);await page.mouse.move(0,0);}
for(const width of [390,1440]){
 test('publication dates order seven Favorites with stable ties, missing dates, filters and unchanged storage '+width,async({page},info)=>{
  await setup(page,width);await page.evaluate(async()=>{__releaseMetadata();await __completeMetadata();});await expect.poll(()=>order(page)).toEqual(ordered);
  const state=await page.evaluate(()=>({before:__beforeFavorites,after:JSON.stringify(ensureTrainerHistoryStore().read()),reads:__favoriteMetadataReads,writes:__trustedWrites.length}));expect(state.after).toBe(state.before);expect(state.reads.sort()).toEqual([...names].sort());expect(state.writes).toBe(0);
  await expect(page.locator('[data-trainer="OrderBeta"] time')).toHaveAttribute('datetime','2026-10-27T10:00:00.000Z');await expect(page.locator('[data-trainer="OrderEcho"] .favorite-publication')).toBeHidden();
  fs.mkdirSync('/tmp/trade154-share-qa',{recursive:true});for(const theme of ['light','dark']){await page.evaluate(t=>applyTheme(t),theme);await expect(page.locator('#favorite-trainer-search')).toHaveCSS('background-color',theme==='dark'?'rgb(25, 27, 32)':'rgb(250, 247, 239)');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/trade154-share-qa/${info.project.name}-favorites-${width}-${theme}.png`,fullPage:true,animations:'disabled'});}
  await page.evaluate(()=>toggleFavoriteTagFilter('tag_nyc'));await expect.poll(()=>order(page)).toEqual(['OrderBeta','OrderAlpha','OrderEcho']);await page.evaluate(()=>clearFavoriteGroupFilters());await expect.poll(()=>order(page)).toEqual(ordered);await page.evaluate(()=>setFavoriteSearch('OrderGamma'));await expect.poll(()=>order(page)).toEqual(['OrderGamma']);await page.evaluate(()=>clearFavoriteSearch());await expect.poll(()=>order(page)).toEqual(ordered);
  await page.evaluate(()=>{setTrainerDiscoveryMode('trainers');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});await expect.poll(()=>order(page)).toEqual(ordered);expect(await page.evaluate(()=>JSON.stringify(ensureTrainerHistoryStore().read()))).toBe(state.before);
 });
 test('metadata completion preserves focused card and open menu until interaction leaves '+width,async({page})=>{
  await setup(page,width);const alpha=page.locator('.favorite-card-shell[data-trainer="OrderAlpha"]');await alpha.locator('.favorite-card-more').click();await expect(alpha.locator('[role=menu]')).toBeVisible();await page.evaluate(async()=>{__releaseMetadata();await __completeMetadata();});await expect(alpha.locator('time')).toBeVisible();await page.waitForTimeout(200);expect(await order(page)).toEqual(names);await expect(alpha.locator('[role=menu]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(alpha.locator('[role=menu]')).toBeHidden();await alpha.locator('.favorite-card-more').focus();await page.waitForTimeout(200);expect(await order(page)).toEqual(names);
  await page.mouse.move(0,0);await page.locator('#favorite-trainer-search').focus();await expect.poll(()=>order(page)).toEqual(ordered);await expect(page.locator('#favorite-trainer-search')).toBeFocused();
 });
}

test('metadata never moves a Favorite beneath a resting mouse pointer',async({page})=>{await setup(page,1440);await page.locator('.favorite-card-shell[data-trainer="OrderAlpha"]').hover();await page.evaluate(async()=>{__releaseMetadata();await __completeMetadata();});await page.waitForTimeout(200);expect(await order(page)).toEqual(names);await page.mouse.move(0,0);await expect.poll(()=>order(page)).toEqual(ordered);});
