const {test,expect}=require('@playwright/test');
const {fixture,normalFixture,settled}=require('./helpers/usability-fixture.cjs');
test.use({serviceWorkers:'block'});

test('import rejects coercion, supports either qualifier order, and makes variants opt-in',async({page})=>{
  await fixture(page);await page.evaluate(()=>openImport());
  for(const input of ['!25','1-3','CP300','25&unknown','25&shiny&!shadow','25|133']){
    await page.locator('#import-str-input').fill(input);await page.getByRole('button',{name:'Preview',exact:false}).click();
    await expect(page.locator('#import-err')).toContainText('Unsupported');await expect(page.locator('#import-step1')).toHaveClass(/active/);
  }
  for(const input of ['25&shiny','shiny&25']){
    await page.evaluate(()=>openImport());await page.locator('#import-str-input').fill(input);await page.evaluate(()=>parseImportString());
    await expect(page.locator('#import-step2')).toHaveClass(/active/);await expect(page.locator('#import-warn-box')).toContainText('Multiple variants');
    expect(await page.evaluate(()=>importMatches.every(m=>m.shiny&&!m.checked))).toBe(true);
    await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  }
  expect(await page.evaluate(()=>window.__trustedWrites||[])).toEqual([]);
});

test('import preserves existing entries, blocks conflicting qualifiers and session changes',async({page})=>{
  await fixture(page);await page.evaluate(()=>openImport());await page.locator('#import-str-input').fill('25,25&shiny');await page.evaluate(()=>parseImportString());
  await expect(page.locator('#import-row-0 input')).toBeDisabled();
  await page.evaluate(()=>{const pair=importMatches.filter(e=>e.name===importMatches[1].name);pair.forEach(e=>e.checked=true);});
  await page.evaluate(()=>confirmImport());await expect(page.locator('#import-warn-box')).toContainText('only one set');
  await page.evaluate(()=>{cur='DifferentOwner';});await page.evaluate(()=>confirmImport());
  expect(await page.evaluate(()=>window.__trustedWrites||[])).toEqual([]);
});

test('failed request stays editable and same-ID retry only shows success after acknowledgement',async({page})=>{
  await fixture(page);await page.evaluate(()=>{cur='';allData.requests={};knownLoginUsernames=()=>[];ensureFirebaseDataProtection=async()=>{};fbOn=true;db={};ref=(_db,path)=>path;window.__requestWrites=[];set=(path,payload)=>new Promise((resolve,reject)=>{__requestWrites.push({path,payload});window.__requestResolve=resolve;window.__requestReject=reject;});document.getElementById('app').style.display='none';document.getElementById('login-pg').style.display='flex';showRequestForm();});
  await page.locator('#req-username').fill('SyntheticApplicant');await page.locator('#req-note').fill('Synthetic access request');await page.locator('#request-send').click();
  await expect(page.locator('#request-send')).toBeDisabled();await page.evaluate(()=>__requestReject(new Error('simulated network failure')));
  await expect(page.locator('#req-err')).toContainText(/failed|try again/i);await expect(page.locator('#req-form-inner')).toBeVisible();await expect(page.locator('#req-sent-status')).toBeHidden();
  expect(await page.evaluate(()=>Object.keys(allData.requests))).toEqual([]);
  await page.locator('#request-send').click();expect(await page.evaluate(()=>__requestWrites[0].path===__requestWrites[1].path)).toBe(true);
  await page.evaluate(()=>__requestResolve());await expect(page.locator('#req-sent-status')).toBeVisible();
});

test('slow request checks reuse the pending write and Back prevents late success UI',async({page})=>{
  await fixture(page);await page.evaluate(()=>{cur='';allData.requests={};knownLoginUsernames=()=>[];ensureFirebaseDataProtection=async()=>{};fbOn=true;db={};ref=(_db,path)=>path;window.__requestWrites=0;set=()=>new Promise(resolve=>{__requestWrites++;window.__requestResolve=resolve;});document.getElementById('app').style.display='none';document.getElementById('login-pg').style.display='flex';showRequestForm();});
  await page.clock.install();await page.locator('#req-username').fill('SyntheticSlow');await page.locator('#request-send').click();await page.clock.fastForward(15001);
  await expect(page.locator('#req-err')).toContainText('not confirmed');await page.locator('#request-send').click();expect(await page.evaluate(()=>__requestWrites)).toBe(1);
  await page.evaluate(()=>hideRequestForm());await page.evaluate(()=>__requestResolve());await page.clock.fastForward(50);await expect(page.locator('#req-sent-status')).toBeHidden();
});

test('share goals preserve mode and scope; keyboard and export reach real controls',async({page})=>{
  await fixture(page);await page.evaluate(()=>openSettingsTool('export'));await expect(page.locator('#product-share-modal')).toBeVisible();
  await page.locator('[data-share-mode="text"]').click();await page.locator('#product-share-scope').selectOption('top');await expect(page.locator('#product-share-text')).toBeVisible();
  await page.locator('[data-share-mode="link"]').click();await expect(page.locator('#share-link-action')).toBeDisabled();await expect(page.locator('[data-full-list-export]').first()).toBeDisabled();await expect(page.locator('#share-link-scope-help')).toContainText('full list');
  await page.locator('[data-share-mode="search"]').click();await expect(page.locator('#share-search-output textarea')).toHaveCount(1);await page.locator('#share-game-language').selectOption('ja');await expect(page.locator('#share-search-output textarea')).toContainText('こうかん');
  await page.keyboard.press('Escape');await page.keyboard.press('n');await expect(page.locator('#wants-add-name')).toBeFocused();await page.locator('#wants-add-name').blur();await page.keyboard.press('s');await expect(page.locator('#product-share-search')).toBeVisible();
});

const now=new Date('2026-10-25T12:00:00Z').getTime();
const events=[{eventID:'synthetic-community-day',name:'Synthetic Community Day',eventType:'community-day',start:'2026-10-25T14:00:00',end:'2026-10-25T17:00:00',link:'https://example.invalid/event',extraData:{communityday:{bonuses:[{text:'2× synthetic catch Candy*'}],bonusDisclaimers:['* Synthetic trade bonus continues until 9 p.m. local time.'],spawns:[{name:'Pikachu'}],specialresearch:[{name:'Synthetic research',tasks:[{text:'Catch 3 Pokémon',reward:{text:'Synthetic reward'}}]}]}}}];
test('Events shows hours and bonuses without expansion; details and stale/empty/error states remain honest',async({page})=>{
  await fixture(page);await page.clock.install({time:now});await page.evaluate(events=>{_eventData={events,raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventCalendarDate='';switchTab('schedule');renderEventsOnly();},events);
  await expect(page.locator('.event-card-date')).toContainText('Sun');await expect(page.locator('.event-card-time')).toContainText(/2:00|14:00/);await expect(page.locator('.event-card .event-bonuses')).toContainText('2× synthetic');await expect(page.locator('.event-bonus-caveats').first()).toContainText('9 p.m.');
  await page.locator('[data-event-action="details"]').click();await expect(page.locator('#event-detail-modal')).toBeVisible();await expect(page.locator('#event-detail-body')).toContainText('not supplied reliably');await expect(page.locator('#event-detail-body')).toContainText('Pikachu');await page.keyboard.press('Escape');
  await page.evaluate(()=>{_eventData.stale=true;renderEventsOnly();});await expect(page.locator('.events-source')).toContainText('Last-known');
  await page.evaluate(()=>{_eventData={events:[],raids:[],fetchedAt:Date.now()};renderEventsOnly();});await expect(page.locator('.events-state')).toBeVisible();
  await page.evaluate(()=>{_eventLoadState='error';renderEventsOnly();});await expect(page.locator('[data-event-action="retry"]')).toBeVisible();
});

test('confirmed import survives real controller projection without changing existing wants or inert offers',async({page})=>{
  await normalFixture(page);await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Charmander',p:'H',shiny:true}]));await settled(page);
  const before=await page.evaluate(()=>({existing:productDeclarations().entries.filter(e=>e.name==='Charmander'),board:JSON.stringify(__normal.remote.users.NormalProduct.specialTradeBoard),legacy:JSON.stringify(__normal.remote.wishlist.NormalProduct)}));
  await page.evaluate(()=>openImport());await page.locator('#import-str-input').fill('7&shiny');await page.evaluate(()=>parseImportString());
  await page.evaluate(()=>{importMatches.forEach((e,i)=>{e.checked=e.name==='Squirtle';document.getElementById('import-chk-'+i).checked=e.checked;});updateImportCount();});
  await page.locator('#import-confirm-btn').click();await settled(page);
  expect(await page.evaluate(()=>productDeclarations().entries.find(e=>e.name==='Squirtle'))).toMatchObject({shiny:true,p:'M'});
  expect(await page.evaluate(()=>productDeclarations().entries.filter(e=>e.name==='Charmander'))).toEqual(before.existing);
  expect(await page.evaluate(()=>JSON.stringify(__normal.remote.users.NormalProduct.specialTradeBoard))).toBe(before.board);
  expect(await page.evaluate(()=>JSON.stringify(__normal.remote.wishlist.NormalProduct))).toBe(before.legacy);
  expect(await page.evaluate(()=>__normal.writes.every(path=>path.startsWith('accountSync/normal-product-uid/')||path==='publicShares/NormalProduct'||path==='users/NormalProduct/canonicalListActivity'))).toBe(true);
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('a late import completion cannot close a newly opened import dialog',async({page})=>{
 await fixture(page);await page.evaluate(()=>{openImport();importCategory='wishlist';importMatches=[{name:'Charmander',checked:true,mod:'',shiny:false}];writeList=()=>new Promise(resolve=>{window.__finishImport=resolve;});window.__oldImport=confirmImport();});
 await page.evaluate(()=>{closeModal('import-modal');openImport();});await page.locator('#import-str-input').fill('133');await page.evaluate(()=>__finishImport(true));
 await expect(page.locator('#import-modal')).toBeVisible();await expect(page.locator('#import-str-input')).toHaveValue('133');
});

test('an access-request acknowledgement cannot update a different account session',async({page})=>{
 await fixture(page);await page.evaluate(()=>{cur='';allData.requests={};knownLoginUsernames=()=>[];ensureFirebaseDataProtection=async()=>{};fbOn=true;db={};ref=(_db,path)=>path;set=()=>new Promise(resolve=>{window.__requestResolve=resolve;});document.getElementById('app').style.display='none';document.getElementById('login-pg').style.display='flex';showRequestForm();});
 await page.locator('#req-username').fill('SyntheticSession');await page.locator('#request-send').click();await page.evaluate(()=>{cur='DifferentSession';auth={currentUser:{uid:'different-uid'}};__requestResolve();});
 await expect(page.locator('#request-send')).toBeEnabled();await expect(page.locator('#req-sent-status')).toBeHidden();expect(await page.evaluate(()=>Object.keys(allData.requests))).toEqual([]);
});
