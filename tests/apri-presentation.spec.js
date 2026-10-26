const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const {normalFixture,fixture,settled}=require('./helpers/usability-fixture.cjs');
const records=require('../data/reviewed-consolidated-shiny-assets.json').records;
const out='/tmp/trade-apri-qa';mkdirSync(out,{recursive:true});
const events=[
 {eventID:'season-review',name:'Season coverage',start:'2026-10-01T10:00:00',end:'2026-12-01T10:00:00',bonuses:[{text:'2× catch Candy — eligible catches only'}]},
 {eventID:'hour-review',name:'Gastly Spotlight Hour',eventType:'pokemon-spotlight-hour',start:'2026-10-27T18:00:00',end:'2026-10-27T19:00:00',extraData:{spotlight:{bonus:'2× catch XP',list:[{name:'Gastly'}]}}},
 {eventID:'raid-review',name:'Giratina raid rotation',eventType:'raid-battles',start:'2026-10-27T10:00:00',end:'2026-11-03T10:00:00',extraData:{raidbattles:{bosses:[{name:'Giratina (Origin Forme)'}]}}},
 {eventID:'ending-review',name:'Harvest event',start:'2026-10-24T10:00:00',end:'2026-10-27T20:00:00',bonuses:[{text:'Ticket holders — additional Timed Research'}]},
 {eventID:'tomorrow-review',name:'Darkrai Raid Hour',eventType:'raid-hour',start:'2026-10-28T18:00:00',end:'2026-10-28T19:00:00'},
 {eventID:'unknown-review',name:'Venue event',eventType:'live-event',start:'2026-10-27T10:00:00',end:'2026-10-27T18:00:00',timeZoneBasis:'venue-unknown'}
];
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function seedList(page){
 await normalFixture(page);await page.evaluate(async()=>{const e=accountSyncCanonicalEntities.find(e=>!e.deleted&&e.entityType==='tradeEntry'&&accountSyncCatalogEntryForId(e.identity.catalogId)?.name==='Pikachu');await applyAccountSyncTradeMutations([{kind:'delete',entityType:'tradeEntry',entityId:e.entityId}],(await accountSyncMutationAuthority()).controller);});await settled(page);
 const chosen=[...records.slice(0,18),...records.slice(120,128),...records.slice(-10)];
 expect(await page.evaluate(input=>addManagedIntentEntries('lf',input),chosen.map((r,i)=>({name:r.name,no:r.no,p:i<18?'H':i<28?'M':'L',shiny:i%3===0,gender:r.sourceGenders.includes('f')&&i%4===0?'f':r.sourceGenders[0]})))).toBe(true);await settled(page);
}
for(const width of [390,820,1440])test(`Apri themes preserve 36-row list and tab layout at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:1000});await seedList(page);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>{applyTheme(theme);switchTab('mylist');renderMyList();},theme);
  await expect(page.locator('.wants-row')).toHaveCount(36);
  await page.locator('.wants-row img').evaluateAll(async imgs=>{for(const image of imgs){image.loading='eager';await image.decode();if(!image.naturalWidth)throw Error('Missing exact sprite');}});
  await expect(page.locator('#toast')).toBeHidden({timeout:10000});await noOverflow(page);
  await expect(page.locator('.wants-row').first()).toHaveCSS('opacity','1');
  await expect(page.locator('#wants-add-name')).toHaveCSS('border-top-color',theme==='light'?'rgb(133, 131, 125)':'rgb(129, 133, 142)');
  await expect(page.locator('.myrow-trait.shiny').first()).toHaveText('Shiny');await expect(page.locator('.myrow-trait.shiny').first()).toHaveCSS('font-size','11px');
  expect(await page.locator('.myrow-trait.shiny').first().evaluate(e=>getComputedStyle(e,'::before').content)).toBe('none');

  await page.screenshot({path:`${out}/${info.project.name}-mylist-${width}-${theme}.png`,fullPage:true,animations:'disabled'});await page.screenshot({path:`${out}/${info.project.name}-mylist-${width}-${theme}-viewport.png`,animations:'disabled'});
  await expect(page.locator('[data-wants-priority-filter="ALL"] .wants-filter-count')).toHaveText('36');
  await page.locator('[data-wants-priority-filter="M"]').click();await expect(page.locator('.wants-row')).toHaveCount(10);
  await page.screenshot({path:`${out}/${info.project.name}-priority-medium-${width}-${theme}-viewport.png`,animations:'disabled'});
  await page.locator('[data-wants-priority-filter="ALL"]').click();

  const first=page.locator('.wants-row').first();await expect(first).toHaveCSS('opacity','1');
  await page.locator('#nav-more').click();await expect(page.locator('#tab-more .more-profile')).toHaveCount(1);await noOverflow(page);
  await page.screenshot({path:`${out}/${info.project.name}-more-${width}-${theme}.png`,fullPage:true,animations:'disabled'});await page.screenshot({path:`${out}/${info.project.name}-more-${width}-${theme}-viewport.png`,animations:'disabled'});
  await page.locator('#tab-more [onclick*="appearance"]').click();await expect(page.locator('#settings-modal')).toBeVisible();await page.locator('#settings-modal').getByRole('button',{name:'Close settings',exact:true}).click();await expect(page.locator('#settings-modal')).toBeHidden();
  await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventLastAttemptAt=Date.now();eventCalendarDate='2026-10-27';eventCalendarAnchor=new Date(2026,9,1);eventAllSchedule=false;switchTab('schedule');renderEventsOnly();},events);
  await expect(page.locator('.event-agenda-card')).toHaveCount(5);
  await expect(page.locator('.event-agenda-card').first()).toHaveAttribute('data-event-id','raid-review');
  if(width===390)expect((await page.locator('.event-agenda-card').first().boundingBox()).y).toBeLessThan(350);
await expect(page.locator('.event-agenda-card[data-event-id="raid-review"]')).toContainText('Origin Forme');await expect(page.locator('.event-agenda-card[data-event-id="hour-review"]')).toContainText('2× catch XP');await noOverflow(page);
  await page.screenshot({path:`${out}/${info.project.name}-events-${width}-${theme}.png`,fullPage:true,animations:'disabled'});await page.screenshot({path:`${out}/${info.project.name}-events-${width}-${theme}-viewport.png`,animations:'disabled'});
 }
 await page.evaluate(()=>stopAccountSyncRuntime());
});
test('Trainers distinguish direct lookup, saved demand, and publication time without extra reads',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await fixture(page);
 await page.evaluate(async()=>{
  const store=ensureTrainerHistoryStore();store.clear();store.toggleFavorite('ReviewTrainerA');store.toggleFavorite('ReviewTrainerB');
  favoriteShareSessionCache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({repository:{read:async name=>({ok:true,value:{version:1,username:name,profile:{},lists:{wishlist:{Pikachu:'H'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:name==='ReviewTrainerA'?Date.parse('2026-10-26T14:35:00Z'):0}})},validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot});
  favoriteShareSessionCache.activate({uid:auth.currentUser.uid,username:cur});
  const favorites=favoriteShareSessionCache.syncFavorites(store.read().favorites);await Promise.all(favorites.map(f=>favoriteShareSessionCache.readFavorite(f)));
  switchTab('find');setTrainerDiscoveryMode('favorites');await renderTrainerQuickLists();
 });
 await expect(page.locator('.favorite-publication')).toHaveCount(2);await expect(page.locator('.favorite-publication time')).toHaveCount(1);await expect(page.locator('.favorite-publication').first()).toHaveAttribute('aria-label',/Not the trainer’s last sign-in/);
 for(const width of [1440,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(t=>applyTheme(t),theme);await noOverflow(page);await page.screenshot({path:`${out}/${info.project.name}-favorites-${width}-${theme}.png`,fullPage:true,animations:'disabled'});await page.screenshot({path:`${out}/${info.project.name}-favorites-${width}-${theme}-viewport.png`,animations:'disabled'});}
 await page.locator('#trainer-mode-trainers').click();await expect(page.locator('#find-trainer-description')).toContainText('No Favorite required');
 for(const width of [1440,390])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(t=>applyTheme(t),theme);await noOverflow(page);await page.screenshot({path:`${out}/${info.project.name}-trainers-lookup-${width}-${theme}-viewport.png`,animations:'disabled'});}

 await page.locator('#trainer-mode-pokemon').click();await expect(page.locator('#find-trainer-description')).toContainText('Wants do not indicate what they have available');
});
test('day navigation, details, all events and load/error/offline states remain truthful',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventLastAttemptAt=Date.now();eventCalendarDate='2026-10-27';eventCalendarAnchor=new Date(2026,9,1);eventAllSchedule=false;switchTab('schedule');renderEventsOnly();},events);
 await page.locator('.event-agenda-card[data-event-id="hour-review"] [data-event-action="details"]').click();await expect(page.locator('#event-detail-modal')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.event-agenda-card[data-event-id="hour-review"] [data-event-action="details"]')).toBeFocused();
 await page.locator('.event-week-day[data-date="2026-10-28"]').click();await expect(page.locator('.event-agenda-card[data-event-id="hour-review"]')).toHaveCount(0);await expect(page.locator('.event-agenda-card[data-event-id="tomorrow-review"]')).toBeVisible();
 const lastCategory=page.locator('.event-filter').last();await lastCategory.focus();await expect(lastCategory).toBeFocused();
 expect(await lastCategory.evaluate(e=>{const box=e.getBoundingClientRect(),row=e.parentElement.getBoundingClientRect();return box.right<=row.right+1&&box.left>=row.left-1;})).toBe(true);
 await page.keyboard.press('Enter');await expect(lastCategory).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-event-action="all-schedule"]').first().click();await expect(page.locator('.event-agenda-card')).toHaveCount(0);
 await page.evaluate(()=>{_eventData.stale=true;renderEventsOnly();});await expect(page.locator('.events-source.is-stale')).toBeVisible();

 for(const state of ['loading','error','offline']){await page.evaluate(state=>{_eventData={events:[],raids:[],fetchedAt:0};_eventLoadState=state;renderEventsOnly();},state);await expect(page.locator('.events-state')).toBeVisible();await noOverflow(page);}
});

test('theme contrast, system preference, reduced motion and keyboard More actions',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 const contrast=async selector=>page.locator(selector).evaluateAll(elements=>{
  const rgb=c=>(c.match(/[\d.]+/g)||[]).map(Number),mix=(front,back)=>front.slice(0,3).map((v,i)=>v*(front[3]??1)+back[i]*(1-(front[3]??1)));
  const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  return elements.filter(e=>e.getBoundingClientRect().height).map(e=>{let chain=[],n=e;while(n){chain.unshift(n);n=n.parentElement;}let bg=[255,255,255];for(const a of chain)bg=mix(rgb(getComputedStyle(a).backgroundColor),bg);const fg=mix(rgb(getComputedStyle(e).color),bg),a=lum(fg),b=lum(bg);return{text:e.textContent.trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
 });
 for(const theme of ['light','dark']){
  await page.evaluate(t=>applyTheme(t),theme);
  const boundary=await page.locator('#wants-add-name').evaluate(e=>{const c=getComputedStyle(e),rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0),r=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);return [r(lum(c.borderTopColor),lum(c.backgroundColor)),r(lum(c.borderTopColor),lum(getComputedStyle(e.closest('.add-form')).backgroundColor))];});
  for(const ratio of boundary)expect(ratio).toBeGreaterThanOrEqual(3);
  await page.locator('#nav-more').click();
  await expect(page.locator('#nav-more')).toHaveCSS('color',theme==='light'?'rgb(32, 36, 45)':'rgb(245, 243, 237)');
  await expect(page.locator('.more-entry-copy strong')).toHaveCount(10);
  const values=await contrast('.more-entry-copy strong,.more-entry-copy small,.more-intro,#nav-more');expect(values.length).toBeGreaterThanOrEqual(12);for(const v of values)expect(v.ratio,v.text).toBeGreaterThanOrEqual(4.5);
  for(const section of ['appearance','language','tools','data','security']){const button=page.locator(`#tab-more [onclick*="'${section}'"]`);await button.focus();await page.keyboard.press('Enter');await expect(page.locator('#settings-modal')).toBeVisible();await page.locator('#settings-modal').getByRole('button',{name:'Close settings',exact:true}).click();await expect(button).toBeFocused();}
  for(const id of ['#nav-mylist','#nav-find','#nav-events','#nav-more']){await page.locator(id).click();await expect(page.locator(id)).toHaveAttribute('aria-selected','true');await noOverflow(page);}
 }
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await page.evaluate(()=>applyTheme('auto'));await expect(page.locator('html')).not.toHaveAttribute('data-theme');await expect(page.locator('body')).toHaveCSS('color','rgb(32, 36, 45)');
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await expect(page.locator('body')).toHaveCSS('color','rgb(245, 243, 237)');
 const duration=await page.locator('#nav-more').evaluate(e=>getComputedStyle(e).transitionDuration);expect(duration.split(',').every(v=>parseFloat(v)<=.01)).toBe(true);
});

test('high-density phone header and empty list remain clear',async({browser,baseURL},info)=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},deviceScaleFactor:2,serviceWorkers:'block'});const page=await context.newPage();await fixture(page);
 await page.evaluate(()=>{allData.users[cur].specialTradeBoard={lf:[],ft:[]};for(const type of ['wishlist','dynamax','gmax','costumes'])allData[type][cur]={};combinedRowCache.clear();switchTab('mylist');renderMyList();});
 await expect(page.locator('.wants-row')).toHaveCount(0);
 for(const theme of ['light','dark']){await page.evaluate(t=>applyTheme(t),theme);await expect(page.locator('#toast')).toBeHidden();await noOverflow(page);await page.screenshot({path:`${out}/${info.project.name}-empty-390-${theme}-2x.png`,animations:'disabled'});}
 await context.close();
});
