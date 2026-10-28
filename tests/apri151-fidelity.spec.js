const{test,expect}=require('@playwright/test'),{fixture}=require('./helpers/usability-fixture.cjs'),fs=require('node:fs');
const out='/tmp/trade151-qa';fs.mkdirSync(out,{recursive:true});
test('Favorites entry renders after delayed owner restoration instead of a blank panel',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await fixture(page);
 await page.evaluate(()=>{const store=ensureTrainerHistoryStore();for(let i=1;i<=5;i++)store.toggleFavorite('StartupTrainer'+i);});
 const before=await page.evaluate(()=>{const store=ensureTrainerHistoryStore();return{key:store.key,raw:localStorage.getItem(store.key),count:store.read().favorites.length,writes:structuredClone(window.__trustedWrites||[]),lists:JSON.stringify([allData.wishlist,allData.dynamax,allData.gmax,allData.costumes,allData.users[cur].specialTradeBoard])};});
 await page.evaluate(()=>{window.__delayedFavoriteAuth=auth;auth={currentUser:null};});
 await page.locator('#nav-find').click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(()=>{auth=window.__delayedFavoriteAuth;delete window.__delayedFavoriteAuth;});
 await page.locator('#trainer-mode-favorites').click();
 await expect(page.locator('#favorite-trainers-list .favorite-card-shell')).toHaveCount(before.count);
 expect(before.count).toBe(7);
 expect(await page.evaluate(key=>localStorage.getItem(key),before.key)).toBe(before.raw);
 expect(await page.evaluate(()=>window.__trustedWrites||[])).toEqual(before.writes);
 expect(await page.evaluate(()=>JSON.stringify([allData.wishlist,allData.dynamax,allData.gmax,allData.costumes,allData.users[cur].specialTradeBoard]))).toBe(before.lists);
 await page.screenshot({path:`/tmp/trade164-${info.project.name}-favorites-restored-phone.png`,animations:'disabled'});
});
test('Favorites keyboard entry renders after delayed owner restoration and retains tab focus',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{window.__delayedFavoriteAuth=auth;auth={currentUser:null};});
 await page.locator('#nav-find').click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(()=>{auth=window.__delayedFavoriteAuth;delete window.__delayedFavoriteAuth;});
 await page.locator('#trainer-mode-trainers').focus();await page.keyboard.press('ArrowRight');
 await expect(page.locator('#trainer-mode-favorites')).toBeFocused();
 await expect(page.locator('#favorite-trainers-list .favorite-card-shell')).toHaveCount(2);
});
test('Favorites shows owner-pending state and recovers on the normal readiness render',async({page})=>{
 await fixture(page);
 const before=await page.evaluate(()=>{const store=ensureTrainerHistoryStore();return{key:store.key,raw:localStorage.getItem(store.key)};});
 await page.evaluate(()=>{window.__delayedFavoriteAuth=auth;auth={currentUser:null};});
 await page.locator('#nav-find').click();await page.locator('#trainer-mode-favorites').click();
 await expect(page.locator('#favorite-trainers-list .favorite-card-shell')).toHaveCount(0);
 await expect(page.locator('#favorite-trainers-list')).not.toBeEmpty();
 await expect(page.locator('#favorite-trainers-list .ui-state-loading')).toBeVisible();
 await page.evaluate(()=>{auth=window.__delayedFavoriteAuth;delete window.__delayedFavoriteAuth;queueRefreshAll('startup-fixture:owner-ready');});
 await expect(page.locator('#favorite-trainers-list .favorite-card-shell')).toHaveCount(2);
 expect(await page.evaluate(key=>localStorage.getItem(key),before.key)).toBe(before.raw);
});
test('packaged referenced mascot and paper decode in both themes at phone and desktop widths',async({page,request},info)=>{
 for(const file of ['apri.webp','ivory-paper.webp']){const r=await request.get('./assets/brand/'+file);expect(r.status()).toBe(200);expect(r.headers()['content-type']).toContain('image/webp');}
 await fixture(page);
 for(const width of [375,390,430,820,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width<700?844:1000});await page.evaluate(theme=>{applyTheme(theme);switchTab('mylist');},theme);
  const brand=page.locator('.topbar .brand-mark');await expect(brand).toBeVisible();expect(await brand.evaluate(async im=>{await im.decode();return[im.naturalWidth,im.naturalHeight]})).toEqual([128,128]);
  expect(await page.evaluate(async()=>{const im=new Image();im.src='assets/brand/ivory-paper.webp';await im.decode();return[im.naturalWidth,im.naturalHeight]})).toEqual([256,256]);
  await page.screenshot({path:`${out}/${info.project.name}-logo-${width}-${theme}.png`});
 }
 const wallpapers=await page.evaluate(()=>{applyTheme('dark');return WALLPAPERS.map(w=>{applyWallpaperForTheme(w.key);return{key:w.key,selected:document.body.classList.contains('wp-'+w.key)};});});expect(wallpapers.every(w=>w.selected)).toBe(true);await page.evaluate(()=>{applyWallpaperForTheme('aurora');});expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundImage)).toContain('linear-gradient');await page.evaluate(()=>applyTheme('light'));expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundImage)).toContain('ivory-paper.webp');
});
test('visible saved Favorites load real public publication timestamps once, retain unknown dates and compact actions',async({page},info)=>{
 await fixture(page);
 await page.evaluate(()=>{
  ensureTrainerHistoryStore().clear();const store=ensureTrainerHistoryStore();store.toggleFavorite('ReviewTrainerWithLongName');store.toggleFavorite('ReviewTrainerB');
  window.__publicationReads=[];managedPublicShareRepository={read:async name=>{__publicationReads.push(name);return{ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:name==='ReviewTrainerWithLongName'?Date.parse('2026-10-26T14:35:00Z'):0}}}};
  const state=store.read();store.replaceSyncedOrganization({favorites:state.favorites.map(item=>({...item,tagIds:['tag_nyc']})),tags:{tag_nyc:{id:'tag_nyc',label:'NYC'}}});managedFavoriteAdditions={};favoriteShareSessionCache=null;window.__trustedWrites=[];switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();
 });
 const a=page.locator('.favorite-card-shell[data-trainer="ReviewTrainerWithLongName"]'),b=page.locator('.favorite-card-shell[data-trainer="ReviewTrainerB"]');await page.evaluate(()=>{window.__openedTrainers=[];openFavoriteTrainerByName=name=>__openedTrainers.push(name);});
 await expect(a.locator('.favorite-publication time')).toHaveAttribute('datetime','2026-10-26T14:35:00.000Z');await expect(b.locator('.favorite-publication')).toBeHidden();expect(await page.evaluate(()=>__publicationReads.sort())).toEqual(['ReviewTrainerWithLongName','ReviewTrainerB'].sort());
 for(const width of [375,390,430,820,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width<700?844:1000});await page.evaluate(t=>applyTheme(t),theme);await expect(a.locator('.favorite-publication time')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const boxes=await page.evaluate(()=>['#tab-find .have-hdr','#tab-find .trainer-discovery-modes','#favorite-trainers-controls','#favorite-trainers > .favorite-toolbar-search','#favorite-trainers-list .favorite-card-shell'].map(s=>({selector:s,x:document.querySelector(s)?.getBoundingClientRect().x})));expect(boxes.every(b=>Number.isFinite(b.x)&&Math.abs(b.x-boxes[0].x)<=1.5),JSON.stringify(boxes)).toBe(true);const manage=await page.locator('#favorite-trainers-controls .favorite-manage-groups').boundingBox(),add=await page.locator('#favorite-trainers-controls .favorite-picker-open').boundingBox();expect(manage).not.toBeNull();expect(add).not.toBeNull();expect(Math.abs(manage.y-add.y)).toBeLessThanOrEqual(1);expect(manage.height).toBeGreaterThanOrEqual(48);expect(add.height).toBeGreaterThanOrEqual(48);
  await expect(a.locator('.favorite-card-open')).toHaveCount(1);if(width>700)await expect(a.locator('.favorite-card-open')).toBeVisible();else await expect(a.locator('.favorite-card-open')).toBeHidden();await expect(a.locator('.favorite-card-primary')).toBeVisible();const box=await a.boundingBox();expect(box.height).toBeLessThan(130);
  for(const btn of await a.locator('.favorite-card-add-tag,.favorite-card-more').all()){const r=await btn.boundingBox();expect(r.width).toBeGreaterThanOrEqual(48);expect(r.height).toBeGreaterThanOrEqual(48);}
  const more=a.locator('.favorite-card-more');await more.click();await expect(a.locator('.favorite-card-menu')).toBeVisible();await page.keyboard.press('Escape');await expect(a.locator('.favorite-card-menu')).toBeHidden();await expect(more).toBeFocused();await (width>700?a.locator('.favorite-card-open'):a.locator('.favorite-card-primary')).click();expect(await page.evaluate(()=>__openedTrainers.at(-1))).toBe('ReviewTrainerWithLongName');if(width<700){const nav=await page.locator('.tabs').boundingBox();expect(nav.y+nav.height).toBeLessThanOrEqual((await page.viewportSize()).height+1);}
  await page.screenshot({path:`${out}/${info.project.name}-favorites-${width}-${theme}.png`});
 }
 await page.evaluate(()=>{setTrainerDiscoveryMode('trainers');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});await page.waitForTimeout(100);expect(await page.evaluate(()=>__publicationReads.length)).toBe(2);expect(await page.evaluate(()=>__trustedWrites.length)).toBe(0);
});
test('a late public summary cannot update another account session',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const store=ensureTrainerHistoryStore();store.clear();store.toggleFavorite('ReviewTrainerWithLongName');window.__trustedWrites=[];managedPublicShareRepository={read:name=>new Promise(resolve=>{window.__releasePublication=()=>resolve({ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:Date.parse('2026-10-26T14:35:00Z')}});})};favoriteShareSessionCache=null;switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});
 await page.waitForFunction(()=>typeof window.__releasePublication==='function');await page.evaluate(()=>{auth={currentUser:{uid:'different-fixture-owner'}};cur='OtherFixture';resetFavoriteBrowseSession();__releasePublication();});await page.waitForTimeout(100);await expect(page.locator('.favorite-publication time')).toHaveCount(0);expect(await page.evaluate(()=>__trustedWrites.length)).toBe(0);
});
test('seven UID-bound Favorites survive six-second identity latency with serialized batched requests',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{
  const store=ensureTrainerHistoryStore();store.clear();for(let i=0;i<7;i++)store.toggleFavorite('LatencyTrainer'+i,{targetUid:'latency-uid-'+i});
  window.__identityCalls=[];window.__identityActive=0;window.__identityMax=0;window.__publicationReads=[];window.__trustedWrites=[];
  const original=window.PogoServices.favoriteResolverClient;
  window.PogoServices.favoriteResolverClient={...original,createFavoriteResolverClient:()=>({resolve:async names=>{__identityCalls.push([...names]);__identityActive++;__identityMax=Math.max(__identityMax,__identityActive);await new Promise(r=>setTimeout(r,6000));__identityActive--;return names.map(handle=>({handle,status:'resolved',targetUid:'latency-uid-'+handle.at(-1),canonicalHandle:handle}));}})};
  managedPublicShareRepository={read:async name=>{__publicationReads.push(name);return{ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:Date.parse('2026-10-26T14:35:00Z')}};}};
  managedFavoriteAdditions={};favoriteShareSessionCache=null;favoriteIdentityResolverSession=null;switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();
 });
 await expect(page.locator('#favorite-trainers-list .favorite-publication time')).toHaveCount(7,{timeout:35000});
 const evidence=await page.evaluate(()=>({calls:__identityCalls.map(x=>x.length),max:__identityMax,reads:__publicationReads.length,writes:__trustedWrites.length,statuses:[...favoriteShareSessionCache.snapshot().records.values()].map(r=>r.status)}));
 expect(evidence.calls).toEqual([2,2,2,1]);expect(evidence.max).toBe(1);expect(evidence.reads).toBe(7);expect(evidence.writes).toBe(0);expect(evidence.statuses.every(s=>s==='published')).toBe(true);
});
test('transient cached metadata failure is visible and retried at most once on re-entry',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const store=ensureTrainerHistoryStore();store.clear();store.toggleFavorite('RetryTrainer');window.__retryReads=0;managedPublicShareRepository={read:async name=>{__retryReads++;return __retryReads===1?{ok:false,error:{code:'network/offline'}}:{ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:Date.parse('2026-10-26T14:35:00Z')}};}};managedFavoriteAdditions={};favoriteShareSessionCache=null;switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});
 await expect(page.locator('.favorite-publication')).toBeVisible();await expect(page.locator('.favorite-publication')).toContainText('Unavailable');
 await page.evaluate(()=>{setTrainerDiscoveryMode('trainers');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});await expect(page.locator('.favorite-publication time')).toHaveCount(1);
 await page.evaluate(()=>{setTrainerDiscoveryMode('trainers');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});expect(await page.evaluate(()=>__retryReads)).toBe(2);
});
