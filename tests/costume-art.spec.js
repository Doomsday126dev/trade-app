'use strict';

const {test,expect}=require('@playwright/test');
const pending=require('../data/pending-costume-artwork.json');

test('reviewed costume art and excluded identities stay honest across current wants surfaces',async({page})=>{
  await page.route(url=>url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasedatabase.app')||url.hostname.endsWith('.cloudfunctions.net')||['identitytoolkit.googleapis.com','securetoken.googleapis.com','firebaseappcheck.googleapis.com'].includes(url.hostname),route=>route.abort());
  await page.goto('./?costume-freshness-contract=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('costume-freshness-contract'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.authStateKnownAt!==null&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
  const selectable=await page.evaluate(names=>{
    managedSubscriptions.unsubscribeByKey('public:loginDirectory');
    managedListenerLifecycle.deactivateSession('costume_fixture');
    managedListenerLifecycle.clearSelectedTrainer('costume_fixture');
    managedOwnedDataCoordinator?.reset();
    db=null;fbOn=false;managedFirebaseClient=null;
    cur='CostumeReviewFixture';auth={currentUser:{uid:'uid-costume-review-fixture'}};
    localStorage.clear();sessionStorage.clear();
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('active'));
    document.getElementById('tab-mylist').classList.add('active');
    allData=normalizeData({users:{CostumeReviewFixture:{specialTradeBoard:{lf:[],ft:[]}}},wishlist:{CostumeReviewFixture:{}},dynamax:{},gmax:{},costumes:{CostumeReviewFixture:{'Pikachu (Worlds 2025)':'H','Pikachu (Worlds 2026)':'M','Gengar (Halloween 2024)':'L'}}});
    _pathLoadState={have:'loaded',wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    myListType='costumes';buildAcItems();renderMyList('');
    return names.map(name=>({name,selectable:selectableSpriteEntry({name,no:PogoDomain.costumeSpriteCatalog.resolve({name})?.no}),urls:PogoDomain.costumeSpriteCatalog.resolution({name}).urls}));
  },pending.entries.map(entry=>entry.displayIdentity));
  expect(selectable).toHaveLength(21);
  for(const row of selectable){expect(row.selectable,row.name).toBe(false);expect(row.urls,row.name).toEqual([]);}
  expect(await page.evaluate(()=>selectableSpriteEntry({name:'Pikachu (Worlds 2025)',no:25}))).toBe(true);
  const exact=page.locator('.myrow').filter({hasText:'Pikachu (Worlds 2025)'}).locator('img');
  await expect(exact).toHaveAttribute('src',/assets\/sprites\/go\/pikachu-world-champs-2025\.png/);
  await exact.scrollIntoViewIfNeeded();
  // Force decoding for this art check; native lazy-load budgets have separate tests.
  await exact.evaluate(image=>{image.loading='eager';});
  await expect.poll(()=>exact.evaluate(image=>image.complete&&image.naturalWidth>1)).toBe(true);
  const historical=page.locator('.myrow').filter({hasText:'Pikachu (Worlds 2026)'});
  await expect(historical.locator('img')).toHaveCount(0);
  await expect(historical.locator('.known-unavailable')).toHaveAttribute('aria-label','Artwork not yet available for Pikachu (Worlds 2026)');

  await page.evaluate(()=>openSpecialTradeBoard());
  await expect(page.locator('#special-ft-list .sb-row')).toHaveCount(0);
  const board=page.locator('#special-lf-list');
  await expect(board.locator('.sb-row').filter({hasText:'Pikachu (Worlds 2025)'}).locator('img')).toHaveAttribute('src',/pikachu-world-champs-2025\.png/);
  await expect(board.locator('.sb-row').filter({hasText:'Gengar (Halloween 2024)'}).locator('img')).toHaveAttribute('src',/gengar-spooky-festival\.png/);
  const unavailable=board.locator('.sb-row').filter({hasText:'Pikachu (Worlds 2026)'}).locator('.known-unavailable');
  await expect(unavailable).toHaveAttribute('title','Artwork not yet available for Pikachu (Worlds 2026)');
  for(const theme of ['dark','light']){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:900});
      expect(await unavailable.evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,border:getComputedStyle(node).borderStyle,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}))).toEqual({width:34,height:34,border:'dashed',overflow:false});
    }
  }
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{
    document.getElementById('app').style.display='none';
    document.getElementById('share-view').classList.add('active');
    renderShareView('CostumeReviewFixture','costumes');
  });
  await expect(page.locator('.share-pcard').filter({hasText:'Pikachu (Worlds 2025)'}).locator('img')).toHaveAttribute('src',/pikachu-world-champs-2025\.png/);
  const shared=page.locator('.share-pcard').filter({hasText:'Pikachu (Worlds 2026)'});
  await expect(shared.locator('img')).toHaveCount(0);
  await expect(shared.locator('.known-unavailable')).toHaveAttribute('aria-label','Artwork not yet available for Pikachu (Worlds 2026)');
});
