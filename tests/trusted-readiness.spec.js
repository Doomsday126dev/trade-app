const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const screenshotDir=process.env.TRUSTED_READINESS_SCREENSHOT_DIR||'';
const viewports=[
  {width:1728,height:1000},
  {width:1440,height:900},
  {width:430,height:932},
  {width:390,height:844},
  {width:375,height:812},
  {width:320,height:568}
];

async function capture(page,name){
  if(!screenshotDir)return;
  mkdirSync(screenshotDir,{recursive:true});
  await page.screenshot({path:path.join(screenshotDir,`${name}.png`),fullPage:false});
}

async function loadFullApp(page,reason){
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(value=>window.__pogoEnsureFullApp(value),reason);
  await page.waitForFunction(()=>(
    typeof renderMyList==='function'&&
    typeof renderShareView==='function'&&
    typeof openSpecialTradeBoard==='function'&&
    window.__pogoStartup?.authStateKnownAt!==null&&
    window.__pogoStartup?.firebaseStartupSettledAt!==null
  ));
}

async function installTrustedFixture(page){
  await loadFullApp(page,'trusted-readiness');
  await page.evaluate(()=>{
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedListenerLifecycle?.deactivateSession?.('trusted_readiness_fixture');
    managedListenerLifecycle?.clearSelectedTrainer?.('trusted_readiness_fixture');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;
    cur='TrustedTester';auth={currentUser:{uid:'uid-trusted-tester'}};
    accountSyncUiState=null;managedAccountSyncRuntime=null;accountSyncEligibleUid='';
    localStorage.clear();sessionStorage.clear();trainerHistoryStore=null;favoriteShareSessionCache=null;
    const nyc='location-gofestnewyorkcity';
    allData=normalizeData({
      users:{
        TrustedTester:{authUid:'uid-trusted-tester',isOwner:true,specialTradeBoard:{lf:[{name:'Pikachu',dn:'Pikachu',no:25,backgroundId:nyc,shiny:true,mirror:false}],ft:[{name:'Eevee',dn:'Eevee',no:133,backgroundId:'',shiny:false,mirror:false,qty:2}]}},
        Mazer:{specialTradeBoard:{lf:[],ft:[]}},
        RecentTrainer:{specialTradeBoard:{lf:[],ft:[]}}
      },
      loginDirectory:{Mazer:{ready:true},RecentTrainer:{ready:true}},
      have:{TrustedTester:{Eevee:{qty:2}},Mazer:{Pikachu:{qty:1}}},
      wishlist:{
        TrustedTester:{Pikachu:`H[shiny][bg:${nyc}]`,Eevee:'M',Bulbasaur:'L',Mew:'H'},
        Mazer:{Pikachu:`H[shiny][bg:${nyc}]`,Charmander:'M',Mew:'H'}
      },
      dynamax:{TrustedTester:{}},gmax:{TrustedTester:{}},costumes:{TrustedTester:{}}
    });
    _pathLoadState={have:'loaded',wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    const save=(type,username,list)=>{
      if(!allData[type])allData[type]={};
      allData[type][username]={...(list||{})};
      window.__trustedWrites=(window.__trustedWrites||[]).concat({kind:'list',type,username});
      renderMyList();
      return true;
    };
    writeList=async(type,username,list)=>save(type,username,list);
    writeListItem=async(type,username,name,value)=>{
      const list={...(allData[type]?.[username]||{})};
      if(value==null)delete list[name];else list[name]=value;
      window.__trustedWrites=(window.__trustedWrites||[]).concat({kind:'entity',type,username,name,value});
      return save(type,username,list);
    };
    requireOwnedListHydration=()=>true;
    writeSpecialBoard=async board=>{allData.users[cur].specialTradeBoard=structuredClone(board);renderSpecialBoard();return true;};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    document.getElementById('share-view').classList.remove('active');
    switchTab('mylist',{render:false});
    const store=PogoData.trainerHistoryStore.createTrainerHistoryStore({storage:localStorage,identity:{uid:'uid-trusted-tester',username:'TrustedTester'}});
    store.clear();store.toggleFavorite('Mazer');store.toggleFavorite('RecentTrainer');
    store.rememberOpened('Mazer',{lists:{wishlist:{}}},Date.now()-60_000);
    store.rememberOpened('RecentTrainer',{lists:{wishlist:{}}},Date.now()-120_000);
    renderMyList();setSyncStatus('online');
  });
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#slbl')).toContainText(/Saved/i);
  await expect(page.locator('#nav-mylist')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#toast')).toBeHidden({timeout:5_000});
}

async function expectNoOverflow(page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
}

test('safe owner journey covers the pre-trusted product contract',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`./?trusted-readiness=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#login-pg')).toBeVisible();
  await expect(page.locator('#login-btn')).toBeVisible();
  await installTrustedFixture(page);

  const pikachu=page.locator('.myrow[data-name="Pikachu"]');
  await expect(pikachu).toBeVisible();
  expect(await pikachu.evaluate(node=>getComputedStyle(node).getPropertyValue('--type-color').trim())).not.toBe('');
  await expect(pikachu.locator('.background-visual-label')).toBeVisible();
  await expect(pikachu.getByRole('button',{name:'Remove Pikachu'})).toBeVisible();
  await capture(page,'trusted-journey-my-list-1440x900');

  await page.evaluate(()=>{
    document.getElementById('add-pmon-sel').value='Squirtle';
    document.getElementById('ac-input').value='Squirtle';
    document.getElementById('add-pmon-pri').value='L';
  });
  await page.evaluate(()=>addEntry());
  await expect(page.locator('.myrow[data-name="Squirtle"]')).toBeVisible();
  await page.evaluate(()=>movePriority('Squirtle','M'));
  await expect.poll(()=>page.evaluate(()=>parsePri(allData.wishlist.TrustedTester.Squirtle).p)).toBe('M');

  page.once('dialog',dialog=>dialog.accept());
  await page.locator('.myrow[data-name="Squirtle"] .myrow-remove').click();
  await expect(page.locator('.myrow[data-name="Squirtle"]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__trustedWrites.filter(item=>item.kind==='entity'&&item.name==='Squirtle').at(-1))).toMatchObject({value:null});

  await page.evaluate(()=>{switchTab('find',{render:false});renderFindTrainer();});
  await expect(page.locator('#find-trainer-title')).toHaveText('Find Trainer');
  await expect(page.locator('#trainer-favorites-preview .trainer-favorites-preview-row')).toHaveCount(2);
  await page.locator('[data-discovery-mode="favorites"]').click();
  await expect(page.locator('#find-trainer-title')).toHaveText('Favorites');
  await expect(page.locator('#favorite-trainers-list .favorite-card-shell')).toHaveCount(2);
  await page.locator('[data-discovery-mode="pokemon"]').click();
  await expect(page.locator('#find-trainer-title')).toHaveText('Find by Pokémon');
  await expect(page.locator('#favorite-browse-input')).toBeFocused();
  await capture(page,'trusted-journey-discovery-1440x900');

  await page.evaluate(()=>{
    selectedTrainerRuntime={username:'Mazer',publicData:normalizeData({users:{Mazer:allData.users.Mazer},wishlist:{Mazer:allData.wishlist.Mazer},dynamax:{},gmax:{},costumes:{}})};
    document.getElementById('app').style.display='none';
    document.getElementById('share-view').classList.add('active');
    renderShareView('Mazer','wishlist');
  });
  await expect(page.locator('#share-hdr')).toContainText('Mazer');
  await capture(page,'trusted-journey-profile-1440x900');
  await page.getByRole('button',{name:/Compare with My List/i}).click();
  await expect(page.locator('#trade-match-modal')).toHaveClass(/open/);
  await expect(page.locator('#trade-match-modal .diff-match-box.both')).toContainText('Mew');
  await expect(page.locator('#trade-match-modal .diff-match-box.mine')).toContainText('Eevee');
  await expect(page.locator('#trade-match-modal .diff-match-box.theirs')).toContainText('Charmander');
  await expect(page.locator('#trade-match-modal .trade-match-search')).toHaveCount(3);
  await capture(page,'trusted-journey-compare-1440x900');
  await page.keyboard.press('Escape');

  await page.evaluate(()=>{
    document.getElementById('share-view').classList.remove('active');document.getElementById('app').style.display='flex';
    switchTab('schedule',{render:false});
    const now=Date.now(),hour=3600000;
    _eventData={events:[{eventID:'trusted-event',name:'Trusted Readiness Raid Hour',eventType:'raid',start:new Date(now-hour).toISOString(),end:new Date(now+hour).toISOString(),link:'https://example.com/trusted'}],raids:[],fetchedAt:now};
    _eventLoadState='ready';eventTypeFilter='all';eventCalendarDate='';renderEventsOnly();
  });
  await expect(page.locator('#events-out .event-card')).toHaveCount(1);
  await capture(page,'trusted-journey-events-1440x900');

  await page.evaluate(()=>openSettingsPanel('account'));
  await expect(page.locator('#settings-modal')).toHaveClass(/open/);
  await expect(page.locator('#trainer-sync-local-status')).toContainText('Saved');
  await page.evaluate(()=>selectSettingsSection('security',{focus:false}));
  await expect(page.locator('[data-provider="username-pin"]')).toBeVisible();
  await expect(page.locator('[data-provider="username-pin"] [data-provider-status-label]')).toHaveText('Connected');
  await expect(page.locator('.account-security-provider-development:visible')).toHaveCount(0);
  await capture(page,'trusted-journey-settings-1440x900');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>openSpecialTradeBoard());
  await expect(page.locator('#special-lf-list .sb-row')).toHaveCount(1);
  await expect(page.locator('#special-lf-list .background-visual-card')).toHaveCount(1);
  await capture(page,'trusted-journey-special-board-1440x900');
  await page.keyboard.press('Escape');

  const exported=await page.evaluate(async()=>{
    window.__trustedMarkdown='';window.__trustedCsv='';
    const originalCopy=copyText,originalCreate=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;
    copyText=async value=>{window.__trustedMarkdown=String(value);};
    URL.createObjectURL=blob=>{window.__trustedCsvPromise=blob.text().then(value=>{window.__trustedCsv=value;});return'blob:trusted-readiness';};
    HTMLAnchorElement.prototype.click=function(){};
    try{exportMyListMarkdown();exportMyListCSV();await window.__trustedCsvPromise;return{markdown:window.__trustedMarkdown,csv:window.__trustedCsv};}
    finally{copyText=originalCopy;URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}
  });
  expect(exported.markdown).toContain('Pikachu');
  expect(exported.markdown).toContain('New York City');
  expect(exported.csv).toContain('Background ID,Background');

  for(const locale of ['ja','es','de','en']){
    await page.evaluate(value=>changeInterfaceLocale(value),locale);
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('#nav-mylist .tab-label')).not.toHaveText('');
  }
  await expectNoOverflow(page);
});

test('priority surfaces preserve geometry at every supported viewport',async({page})=>{
  await page.goto(`./?trusted-geometry=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await installTrustedFixture(page);
  for(const viewport of viewports){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>{document.getElementById('share-view').classList.remove('active');document.getElementById('app').style.display='flex';switchTab('mylist',{render:false});renderMyList();});
    await expect(page.locator('#nav-mylist')).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.myrow').first()).toBeVisible();
    const removeBox=await page.locator('.myrow-remove').first().boundingBox();
    expect(removeBox?.width).toBeGreaterThanOrEqual(43.9);expect(removeBox?.height).toBeGreaterThanOrEqual(43.9);
    expect(await page.locator('.myrow').first().evaluate(node=>getComputedStyle(node).getPropertyValue('--type-color').trim())).not.toBe('');
    await expectNoOverflow(page);
    await capture(page,`trusted-my-list-${viewport.width}x${viewport.height}`);

    await page.evaluate(()=>{switchTab('find',{render:false});setTrainerDiscoveryMode('trainers');renderFindTrainer();});
    await expect(page.locator('#trainer-panel-trainers')).toBeVisible();
    await capture(page,`trusted-trainers-${viewport.width}x${viewport.height}`);
    await page.locator('[data-discovery-mode="favorites"]').click();
    await expect(page.locator('#trainer-panel-favorites')).toBeVisible();
    await capture(page,`trusted-favorites-${viewport.width}x${viewport.height}`);
    await page.locator('[data-discovery-mode="pokemon"]').click();
    await expect(page.locator('#trainer-panel-pokemon')).toBeVisible();
    await expectNoOverflow(page);
    await capture(page,`trusted-find-pokemon-${viewport.width}x${viewport.height}`);

    await page.evaluate(()=>openSettingsPanel('account'));
    await page.evaluate(()=>selectSettingsSection('security',{focus:false}));
    await expect(page.locator('[data-provider="username-pin"]')).toBeVisible();
    await expect(page.locator('.account-security-provider-development:visible')).toHaveCount(0);
    const settingsBox=await page.locator('#settings-modal .modal').boundingBox();
    expect(settingsBox?.width).toBeLessThanOrEqual(viewport.width);
    expect(settingsBox?.height).toBeLessThanOrEqual(viewport.height);
    await expectNoOverflow(page);
    await capture(page,`trusted-settings-${viewport.width}x${viewport.height}`);
    await page.keyboard.press('Escape');
    if(await page.locator('#settings-modal').isVisible())await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
  }
});
