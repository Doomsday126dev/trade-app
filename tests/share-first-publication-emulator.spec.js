const {test,expect}=require('@playwright/test');
const {seed,routeEmulators,login,settled,adminData}=require('./support/favoriteBrowserFixtures.cjs');

test.use({serviceWorkers:'block'});
test.skip(process.env.POGO_SAVING_EMULATORS!=='1','Requires isolated synthetic Auth and RTDB emulators.');

async function publicShare(username){return(await adminData('GET',`publicShares/${username}`)).value;}
async function finishStartup(page){
  await page.evaluate(()=>window.__pogoEnsureFullApp('share-publication-check'));
  await page.waitForFunction(()=>typeof managedAccountSyncRuntime!=='undefined'&&managedAccountSyncRuntime?.projectionReady,{},{timeout:30000});
  await page.evaluate(()=>managedAccountSyncRuntime.start());
  await settled(page);
  await page.evaluate(()=>flushSyncQueue());
}

test('only explicit Share creates the first public projection; later edits refresh but removal stays unpublished',async({page,context})=>{
  const fixture=await seed();
  await routeEmulators(page,fixture);
  await login(page,fixture);await finishStartup(page);
  expect(await publicShare(fixture.username)).toBeNull();

  await page.reload();
  await finishStartup(page);
  expect(await publicShare(fixture.username)).toBeNull();

  await page.evaluate(()=>{switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#combined-priorities input[value="M"]').check();
  await page.locator('#combined-save').click();await settled(page);
  expect(await publicShare(fixture.username)).toBeNull();

  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await page.locator('#prof-bio').fill('Synthetic public bio');
  await page.locator('#profile-save').click();
  await page.evaluate(()=>flushSyncQueue());
  expect(await publicShare(fixture.username)).toBeNull();

  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:String(test.info().project.use.baseURL||'http://localhost:4188')});
  await page.evaluate(()=>{closeModal('settings-modal');switchTab('mylist');openProductShare('link');});
  await expect(page.locator('#product-share-disclosure')).toBeVisible();
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  const first=await publicShare(fixture.username);
  expect(first).toMatchObject({version:2,username:fixture.username,publishedListTypes:['wishlist','dynamax','gmax','costumes']});
  expect(first.declarations.some(entry=>entry.name==='Pikachu'&&entry.p==='M')).toBe(true);
  expect(first.profile.bio).toBe('Synthetic public bio');
  expect(JSON.stringify(first)).not.toMatch(/authUid|authEmail|pin|privateNote|specialTradeBoard/);
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain(`view=${encodeURIComponent(fixture.username)}`);

  await page.keyboard.press('Escape');
  await page.evaluate(()=>{openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#combined-priorities input[value="L"]').check();
  await page.locator('#combined-save').click();await settled(page);
  await expect.poll(async()=>{const share=await publicShare(fixture.username);return share?.declarations.find(entry=>entry.name==='Pikachu')?.p;}).toBe('L');
  await page.evaluate(()=>openAccountSettingsSection('profile'));
  await page.locator('#prof-bio').fill('Updated after first share');
  await page.locator('#profile-save').click();await page.evaluate(()=>flushSyncQueue());
  await expect.poll(async()=>(await publicShare(fixture.username))?.profile.bio).toBe('Updated after first share');

  expect((await adminData('DELETE',`publicShares/${fixture.username}`)).status).toBe(200);
  await page.reload();
  await finishStartup(page);
  expect(await publicShare(fixture.username)).toBeNull();
  const queued=await page.evaluate(async()=>{
    const built=publicShareSnapshotForUser(cur,getLocal(),'owned_list_edit');
    const current=`publicShares/${cur}`,stale=`publicShares/${cur}Stale`;
    const accepted=[queueSync(current,built.snapshot),queueSync(stale,built.snapshot)];
    await flushSyncQueue();
    return{accepted,currentQueued:Object.hasOwn(syncQueue,current),staleQueued:Object.hasOwn(syncQueue,stale)};
  });
  expect(queued).toEqual({accepted:[true,true],currentQueued:false,staleQueued:false});
  expect(await publicShare(fixture.username)).toBeNull();
  expect(await publicShare(`${fixture.username}Stale`)).toBeNull();
  await page.evaluate(()=>{switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#combined-priorities input[value="H"]').check();
  await page.locator('#combined-save').click();await settled(page);
  await page.evaluate(()=>flushSyncQueue());
  expect(await publicShare(fixture.username)).toBeNull();
});

test('failed hydration blocks publication and clipboard denial retries only the confirmed URL',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await finishStartup(page);
  await page.evaluate(()=>{switchTab('mylist');openProductShare('link');window.__realShareRuntime=managedAccountSyncRuntime;managedAccountSyncRuntime={...window.__realShareRuntime,snapshot:async()=>({...await window.__realShareRuntime.snapshot(),pendingCount:1})};refreshProductShare();});
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notSaved');
  expect(await publicShare(fixture.username)).toBeNull();
  await page.evaluate(()=>{managedAccountSyncRuntime={...window.__realShareRuntime,snapshot:async()=>({...await window.__realShareRuntime.snapshot(),conflictCount:1})};refreshProductShare();});
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notSaved');
  expect(await publicShare(fixture.username)).toBeNull();
  await page.evaluate(()=>{managedAccountSyncRuntime=window.__realShareRuntime;refreshProductShare();managedPublicSharePublication.markFailed(activePublicShareHydrationToken,'wishlist');});
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','shareUi.notReady');
  expect(await publicShare(fixture.username)).toBeNull();
  await page.reload();await finishStartup(page);
  await page.evaluate(()=>{
    switchTab('mylist');openProductShare('link');
    window.__publicTransactions=0;window.__copyAttempts=[];
    const actualTransaction=runTransaction;
    runTransaction=(...args)=>{if(args[0].toString().includes('/publicShares/'))window.__publicTransactions++;return actualTransaction(...args);};
    copyText=async value=>{window.__copyAttempts.push(value);if(window.__copyAttempts.length===1)throw new Error('Synthetic clipboard denial');};
  });
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-manual-link')).toBeVisible();
  const verified=await publicShare(fixture.username);
  expect(verified?.version).toBe(2);
  const manual=await page.locator('#share-public-url').inputValue();
  expect(manual).toContain(`view=${encodeURIComponent(fixture.username)}`);
  expect(await page.evaluate(()=>window.__publicTransactions)).toBe(1);
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  expect(await page.evaluate(()=>({transactions:window.__publicTransactions,copies:window.__copyAttempts}))).toEqual({transactions:1,copies:[manual,manual]});
  expect(await publicShare(fixture.username)).toEqual(verified);
});

test('an account switch before a delayed first write cannot publish or copy the old owner',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await finishStartup(page);
  await page.evaluate(()=>{
    switchTab('mylist');openProductShare('link');
    const actualTransaction=runTransaction;
    runTransaction=(target,update,options)=>target.toString().includes('/publicShares/')
      ?new Promise(resolve=>{window.__releaseFirstPublication=()=>resolve(actualTransaction(target,update,options));})
      :actualTransaction(target,update,options);
  });
  await page.locator('#product-share-primary').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.__releaseFirstPublication)).toBe('function');
  await page.evaluate(()=>{cur='DifferentSyntheticOwner';window.__releaseFirstPublication();});
  await expect(page.locator('#product-share-modal')).toBeHidden();
  expect(await publicShare(fixture.username)).toBeNull();
});

test('an old background completion cannot recreate a share removed during its transaction',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await finishStartup(page);
  await page.evaluate(()=>{switchTab('mylist');openProductShare('link');});
  await page.locator('#product-share-primary').click();
  await expect(page.locator('#share-link-status')).toHaveAttribute('data-state','product.publishedCopied');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{
    const actualTransaction=runTransaction;
    runTransaction=(target,update,options)=>target.toString().includes('/publicShares/')
      ?new Promise(resolve=>{window.__releaseOldPublication=()=>resolve(actualTransaction(target,update,options));})
      :actualTransaction(target,update,options);
    openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));
  });
  await page.locator('#combined-priorities input[value="M"]').check();
  await page.locator('#combined-save').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.__releaseOldPublication)).toBe('function');
  expect((await adminData('DELETE',`publicShares/${fixture.username}`)).status).toBe(200);
  await page.evaluate(()=>window.__releaseOldPublication());
  await settled(page);
  expect(await publicShare(fixture.username)).toBeNull();
});
