const{test,expect}=require('@playwright/test'),{fixture}=require('./helpers/usability-fixture.cjs'),fs=require('fs');
const source=fs.readFileSync(require('path').join(__dirname,'apri-presentation.spec.js'),'utf8');const events=eval(source.slice(source.indexOf('const events=')+13,source.indexOf('\nasync function noOverflow')));
const out='/tmp/trade153-qa',phase=process.env.UI153_PHASE||'after';fs.mkdirSync(out,{recursive:true});
for(const width of[390,1440])test(`reported UI states at ${width}`,async({page},info)=>{
 await fixture(page);await page.setViewportSize({width,height:width===390?844:1000});
 for(const theme of['light','dark']){
  await page.evaluate(theme=>{applyTheme(theme);switchTab('mylist');allData.wishlist[cur]={Pikachu:'H',Snom:'M'};allData.users[cur].specialTradeBoard={lf:[{name:'Pikachu',no:25,p:'H'}],ft:[]};renderMyList();},theme);
  await page.screenshot({path:`${out}/${phase}-${info.project.name}-duplicates-${width}-${theme}.png`,animations:'disabled'});
  await page.evaluate(()=>openProductShare('link'));await page.screenshot({path:`${out}/${phase}-${info.project.name}-share-${width}-${theme}.png`,animations:'disabled'});
  await page.evaluate(async()=>{const publish=publishPublicShareNow,copy=copyText;publishPublicShareNow=async()=>{rememberPublicLinkConfirmation(publicShareSnapshotForUser(cur).snapshot);return{ok:true,status:'published'};};copyText=async()=>{throw Error('synthetic clipboard failure');};try{await copyShareLink();}finally{publishPublicShareNow=publish;copyText=copy;}});await page.screenshot({path:`${out}/${phase}-${info.project.name}-share-error-${width}-${theme}.png`,animations:'disabled'});
  await page.evaluate(()=>closeModal('product-share-modal'));
  await page.locator('#wants-combine').evaluate(el=>el.open=true);await page.evaluate(()=>refreshCombinedSearch());const high=page.locator('[data-wants-scope="H"]');await high.click();await high.click();await expect(high).toHaveAttribute('aria-pressed','false');await high.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${phase}-${info.project.name}-combine-${width}-${theme}.png`,animations:'disabled'});
  await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventLastAttemptAt=Date.now();eventAllSchedule=true;eventTypeFilter='all';switchTab('schedule');renderEventsOnly();},events);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/${phase}-${info.project.name}-events-${width}-${theme}.png`,animations:'disabled'});
 }
});
test('Share exposes only confirmed links and distinguishes pending, failed publication and failed copy',async({page})=>{
 await fixture(page);await page.evaluate(()=>{window.__publications=0;window.__beforeShareData=JSON.stringify(allData);publishPublicShareNow=async()=>{__publications++;return{ok:false,status:'pending'};};copyText=async()=>{throw Error('synthetic clipboard failure');};openProductShare('link');});
 await expect(page.locator('#share-public-url')).toBeHidden();await page.locator('#product-share-scope').selectOption('top');await expect(page.locator('#share-link-action')).toBeDisabled();expect(await page.evaluate(()=>__publications)).toBe(0);
 await page.locator('#product-share-scope').selectOption('full');await page.locator('#share-link-action').click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','share.publicationPending');await expect(page.locator('#share-link-status')).not.toContainText(/copied/i);await expect(page.locator('#share-public-url')).toBeHidden();
 await page.evaluate(()=>publishPublicShareNow=async()=>({ok:false,status:'unavailable'}));await page.locator('#share-link-action').click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishFailed');await expect(page.locator('#share-public-url')).toBeHidden();
 await page.evaluate(()=>publishPublicShareNow=async()=>{rememberPublicLinkConfirmation(publicShareSnapshotForUser(cur).snapshot);return{ok:true,status:'published'};});await page.locator('#share-link-action').click();await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopyFailed');await expect(page.locator('#share-public-url')).toBeVisible();await expect(page.locator('#share-public-url')).toBeFocused();expect(await page.locator('#share-public-url').evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length)).toBe(true);expect(await page.evaluate(()=>JSON.stringify(allData)===__beforeShareData)).toBe(true);
});
test('Combine second tap clears visual selection, duplicate notice is quiet and pull refresh does not cover navigation',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{switchTab('mylist');allData.wishlist[cur]={Pikachu:'H',Snom:'M'};allData.users[cur].specialTradeBoard={lf:[{name:'Pikachu',no:25,p:'H'}],ft:[]};renderMyList();window.__beforeRefinement=JSON.stringify(allData);});
 await expect(page.locator('#intent-review')).toBeHidden();expect(await page.evaluate(()=>productDeclarations().duplicates.length)).toBeGreaterThan(0);
 await page.locator('#wants-combine').evaluate(el=>el.open=true);await page.evaluate(()=>refreshCombinedSearch());const high=page.locator('[data-wants-scope="H"]');
 for(const theme of['light','dark']){
  await page.evaluate(t=>applyTheme(t),theme);await high.click();await expect(high).toHaveAttribute('aria-pressed','true');await high.evaluate(async el=>{getComputedStyle(el).backgroundColor;await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});const selected=await high.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,border:getComputedStyle(el).borderColor}));
  await high.click();await high.hover();await expect(high).toHaveAttribute('aria-pressed','false');await high.evaluate(async el=>{getComputedStyle(el).backgroundColor;await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});const unselected=await high.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,border:getComputedStyle(el).borderColor}));expect(unselected.bg).not.toBe(selected.bg);expect(unselected.color).not.toBe(selected.color);
  await high.focus();await page.keyboard.press('Space');await expect(high).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Space');await expect(high).toHaveAttribute('aria-pressed','false');
 }
 expect(await page.evaluate(()=>JSON.stringify(allData)===__beforeRefinement)).toBe(true);
 await page.evaluate(()=>{window.__localRefreshCalls=0;syncFromLocal=()=>__localRefreshCalls++;fbOn=false;_ptrState={dy:90,active:true};ptrEnd();});await expect(page.locator('#feedback-status')).toHaveText('View updated.');await expect(page.locator('#toast')).not.toHaveClass(/show/);expect(await page.evaluate(()=>__localRefreshCalls)).toBe(1);await expect(page.locator('.tabs')).toBeVisible();
});
test('Upcoming controls share the content edge, compact rows retain details, bonuses and source access',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});await page.evaluate(events=>{events[0].link='https://pokemongo.com/news';_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventAllSchedule=true;eventTypeFilter='all';switchTab('schedule');renderEventsOnly();},events);
 const card=page.locator('.event-card[data-event-id="season-review"]');await expect(card).toContainText('2× catch Candy');
 const positions=await page.evaluate(()=>['#tab-schedule .sched-hdr','.event-filter-row','.event-card'].map(s=>document.querySelector(s).getBoundingClientRect().x));expect(Math.max(...positions)-Math.min(...positions)).toBeLessThanOrEqual(1.5);expect((await card.boundingBox()).height).toBeLessThan(220);expect(await card.locator('.event-card-cue').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 await card.locator('[data-event-action="details"]').click();await expect(page.locator('#event-detail-modal')).toBeVisible();await expect(page.locator('#event-detail-body')).toContainText('2× catch Candy');await expect(page.locator('#event-detail-body a.btn[href="https://pokemongo.com/news"]')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#event-detail-modal')).toBeHidden();await expect(card.locator('[data-event-action="details"]')).toBeFocused();
});
test('phone category hint has a separate track and never covers scrolled or keyboard-focused labels',async({page},info)=>{
 await fixture(page);
 for(const width of[375,390,430])for(const theme of['light','dark']){
  await page.setViewportSize({width,height:844});await page.evaluate(({events,theme})=>{applyTheme(theme);_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventAllSchedule=true;eventTypeFilter='all';switchTab('schedule');renderEventsOnly();}, {events,theme});
  const row=page.locator('.event-filter-row'),general=row.locator('[data-type="general"]');
  const geometry=await row.evaluate(el=>{const box=el.getBoundingClientRect(),wrap=el.parentElement.getBoundingClientRect(),hint=getComputedStyle(el.parentElement,'::after');return{right:box.right,edge:wrap.right,width:parseFloat(hint.width),position:hint.position};});expect(geometry.position).toBe('static');expect(geometry.edge-geometry.width-geometry.right).toBeGreaterThanOrEqual(3);
  for(const button of await row.locator('button').all()){const box=await button.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);}
  await page.screenshot({path:`${out}/arrow-${info.project.name}-${width}-${theme}.png`,animations:'disabled'});
  await general.focus();await expect(general).toBeFocused();await expect.poll(async()=>row.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);const bounds=await row.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})),focused=await general.boundingBox();expect(focused.x).toBeGreaterThanOrEqual(bounds.left-1);expect(focused.x+focused.width).toBeLessThanOrEqual(bounds.right+1);
  await page.keyboard.press('Enter');await expect(page.locator('.event-filter[data-type="general"]')).toHaveAttribute('aria-pressed','true');await page.keyboard.press('ArrowLeft');await expect(page.locator('.event-filter[data-type="research"]')).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('active pull indicator has a temporary clear lane above a long phone trainer name',async({page},info)=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 for(const theme of['light','dark']){
  await page.evaluate(theme=>{applyTheme(theme);switchTab('mylist');scrollTo(0,0);window.__pullRefreshes=0;syncFromLocal=()=>__pullRefreshes++;fbOn=false;},theme);
  const name=page.locator('#tab-mylist .my-uname'),before=await name.boundingBox();
  await page.evaluate(()=>{ptrStart({touches:[{clientY:20}]});ptrMove({touches:[{clientY:110}],preventDefault(){}});});
  const indicator=page.locator('#ptr-indicator');await expect(indicator).toHaveClass(/pulling/);await indicator.evaluate(async el=>{getComputedStyle(el).transform;await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});const box=await indicator.boundingBox(),title=await name.boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(title.y);expect(await page.evaluate(()=>scrollY)).toBe(0);
  await page.screenshot({path:`${out}/pull-${info.project.name}-390-${theme}.png`,animations:'disabled'});
  await page.evaluate(()=>ptrEnd());await expect(indicator).not.toHaveClass(/visible/);await expect(page.locator('#feedback-status')).toHaveText('View updated.');await expect(page.locator('#toast')).not.toHaveClass(/show/);expect(Math.abs((await name.boundingBox()).y-before.y)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>__pullRefreshes)).toBe(1);
  await page.evaluate(()=>{ptrStart({touches:[{clientY:20}]});ptrMove({touches:[{clientY:50}],preventDefault(){}});ptrEnd();});await expect(indicator).not.toHaveClass(/visible/);expect(Math.abs((await name.boundingBox()).y-before.y)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>__pullRefreshes)).toBe(1);
 }
});
