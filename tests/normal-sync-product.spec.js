const {test,expect}=require('@playwright/test');

// Only the Firebase transport/auth boundary is simulated. Admission, migration,
// IndexedDB, repository transactions, product actions and publication are real.
async function install(page,state=null){
  await page.route(/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com)/,route=>route.abort());
  await page.goto('./?normal-sync-qualification');
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('normal-sync-qualification'));
  await page.waitForFunction(()=>typeof ensureAccountSyncRuntime==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  return page.evaluate(async saved=>{
    managedSubscriptions.unsubscribeAll?.();managedListenerLifecycle.deactivateSession('normal-sync-fixture');managedOwnedDataCoordinator?.reset();
    await stopAccountSyncRuntime();
    const uid='normal-product-uid',username='NormalProduct';
    const original={lf:[],ft:[{name:'Eevee',no:133,shiny:false,qty:1}]};
    const remote=saved||{authIndex:{[uid]:{username}},users:{[username]:{authUid:uid,specialTradeBoard:original}},wishlist:{[username]:{Pikachu:'H'}},dynamax:{[username]:{}},gmax:{[username]:{}},costumes:{[username]:{}}};
    const listeners=new Set(),writes=[],reads=[];
    const clone=value=>value==null?null:structuredClone(value);
    const read=path=>path.split('/').reduce((value,key)=>value?.[key],remote)??null;
    const snapshot=path=>({val:()=>clone(read(path)),exists:()=>read(path)!=null});
    const put=(path,value)=>{const parts=path.split('/'),last=parts.pop();let parent=remote;for(const part of parts)parent=parent[part]??={};parent[last]=clone(value);};
    ref=(_db,path)=>path;get=async path=>{reads.push(path);return snapshot(path);};serverTimestamp=()=>Date.now();
    onValue=(path,onData)=>{const item={path,onData};listeners.add(item);queueMicrotask(()=>onData(snapshot(path)));return()=>listeners.delete(item);};
    const notify=()=>{for(const {path,onData} of listeners)onData(snapshot(path));};
    runTransaction=async(path,fn,options)=>{
      if(!path.startsWith(`accountSync/${uid}/`)&&!path.startsWith(`authIndex/${uid}/accountSyncRecoveryReviews/`))throw new Error(`Unexpected transaction: ${path}`);
      if(options?.applyLocally!==false)throw new Error('Unverified local transaction');
      const next=fn(clone(read(path)));if(next===undefined)return{committed:false,snapshot:snapshot(path)};
      writes.push(path);put(path,next);notify();return{committed:true,snapshot:snapshot(path)};
    };
    set=async(path,value)=>{if(path!==`publicShares/${username}`)throw new Error(`Legacy or identity write: ${path}`);writes.push(path);put(path,value);};
    update=async()=>{throw new Error('Unexpected legacy update');};
    auth={currentUser:{uid}};cur=username;currentAuthUid=uid;_authStateKnown=true;firebaseDataProtectionReady=true;db={};fbOn=true;activeCanonicalIdentity=null;
    activateOwnedSession(uid,username);
    if(!saved){allData=normalizeData(clone(remote));saveLocal(allData);}
    for(const surface of publicSharePublicationDomain.REQUIRED_SOURCE_SURFACES)managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded',have:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent=username;switchTab('mylist',{render:false});
    const canary=await accountSyncCanaryMember(),started=await ensureAccountSyncRuntime();renderMyList();setSyncStatus('online');
    window.__normal={remote,writes,reads,original};
    return{canary,started,state:await managedAccountSyncRuntime.snapshot(),authority:(await accountSyncMutationAuthority()).mode};
  },state);
}
async function settled(page){
  await expect.poll(()=>page.evaluate(async()=>{await managedAccountSyncRuntime.controller.drain();return(await managedAccountSyncRuntime.snapshot()).state;})).toBe('saved');
}

test('legacy account preserves inert FT while wants edits and publication survive IndexedDB reopen',async({page,context})=>{
  const result=await install(page);expect(result.canary).toBe(false);expect(result.started.ok).toBe(true);expect(result.authority).toBe('canonical');await settled(page);
  expect(await page.evaluate(()=>accountSyncCanonicalEntities.filter(e=>!e.deleted).length)).toBe(2);
  const inert=await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities.filter(e=>e.identity.lane==='for-trade'||e.identity.lane==='offering')));
  await expect(page.locator('#combined-list')).not.toContainText('Eevee');
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Squirtle',p:'',shiny:true}]))).toBe(true);await settled(page);
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Bulbasaur',p:'',gender:'f'}]))).toBe(true);await settled(page);
  await page.evaluate(async()=>{
    const entry=accountSyncCanonicalEntities.find(e=>e.identity.lane==='looking-for'&&accountSyncCatalogEntryForId(e.identity.catalogId)?.name==='Squirtle');
    const authority=await accountSyncMutationAuthority();
    await applyAccountSyncTradeMutations([{kind:'patch',entityType:'tradeEntry',entityId:entry.entityId,patch:{shiny:false,gender:'m',priority:'H'}}],authority.controller);
  });await settled(page);
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Charmander',p:'M'}]))).toBe(true);await settled(page);
  await page.evaluate(async()=>{
    const entry=accountSyncCanonicalEntities.find(e=>e.identity.lane==='looking-for'&&accountSyncCatalogEntryForId(e.identity.catalogId)?.name==='Charmander');
    await applyAccountSyncTradeMutations([{kind:'delete',entityType:'tradeEntry',entityId:entry.entityId}],(await accountSyncMutationAuthority()).controller);
  });await settled(page);
  const before=await page.evaluate(async()=>{
    await managedAccountSyncRuntime.publishCurrentProjection();
    return{remote:structuredClone(__normal.remote),entities:accountSyncCanonicalEntities,original:__normal.original,writes:__normal.writes};
  });
  expect(before.remote.users.NormalProduct.specialTradeBoard).toEqual(before.original);
  expect(before.remote.wishlist.NormalProduct).toEqual({Pikachu:'H'});
  expect(before.writes.every(path=>path.startsWith('accountSync/normal-product-uid/')||path==='publicShares/NormalProduct')).toBe(true);
  const declarations=before.remote.publicShares.NormalProduct.declarations;
  expect(declarations.some(e=>e.name==='Bulbasaur'&&e.intent==='lf'&&e.p==='')).toBe(true);
  expect(declarations.some(e=>e.name==='Squirtle'&&e.intent==='lf'&&e.p==='H'&&e.gender==='m'&&!e.shiny)).toBe(true);
  expect(declarations.every(e=>e.intent==='lf')).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(accountSyncCanonicalEntities.filter(e=>e.identity.lane==='for-trade'||e.identity.lane==='offering')))).toBe(inert);
  expect(declarations.some(e=>e.name==='Charmander')).toBe(false);
  await page.evaluate(()=>stopAccountSyncRuntime());
  await page.close();
  const reopened=await context.newPage(),resumed=await install(reopened,before.remote);expect(resumed.authority).toBe('canonical');await settled(reopened);
  expect(await reopened.evaluate(()=>accountSyncCanonicalEntities)).toEqual(before.entities);
  expect(await reopened.evaluate(()=>__normal.writes.filter(path=>path.startsWith('accountSync/')))).toEqual([]);
  expect(await reopened.evaluate(()=>__normal.reads.some(path=>/^wishlist\//.test(path)))).toBe(false);
  expect(await reopened.evaluate(()=>JSON.stringify(__normal.remote.users.NormalProduct.specialTradeBoard))).toBe(JSON.stringify(before.original));
  await reopened.screenshot({path:'test-results/normal-sync-reopened.png',fullPage:false});
  await reopened.evaluate(()=>stopAccountSyncRuntime());
});

test('wants editor saves and prioritizes through the existing canonical runtime',async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(()=>openCombinedEditor());
  await page.locator('#combined-name').fill('Charmander');await page.locator('#combined-shiny').check();
  await page.locator('#combined-save').click();await settled(page);
  await expect(page.locator('#combined-editor-modal')).toBeHidden();
  const entries=await page.evaluate(()=>productDeclarations().entries.filter(e=>e.name==='Charmander'));
  expect(entries.map(e=>e.intent).sort()).toEqual(['lf']);expect(entries.every(e=>e.shiny)).toBe(true);
  await page.evaluate(()=>openCombinedEditor(combinedGroups().findIndex(g=>g[0].name==='Charmander')));
  await page.locator('#combined-top').check();await page.locator('#combined-save').click();await settled(page);
  const updated=await page.evaluate(()=>productDeclarations().entries.filter(e=>e.name==='Charmander'));
  expect(updated.find(e=>e.intent==='lf').p).toBe('H');expect(updated.find(e=>e.intent==='ft')).toBeUndefined();
  expect(await page.evaluate(()=>__normal.remote.users.NormalProduct.specialTradeBoard)).toEqual(await page.evaluate(()=>__normal.original));
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('normal product authority rejects broken identity and unresolved recovery without fallback writes',async({page})=>{
  await install(page);await settled(page);
  const result=await page.evaluate(async()=>{
    const before=__normal.writes.length;
    __normal.remote.authIndex['normal-product-uid'].username='ConflictingTrainer';
    const broken=await addManagedIntentEntries('lf',[{name:'Squirtle'}]),afterIdentity=__normal.writes.length;
    __normal.remote.authIndex['normal-product-uid'].username=cur;
    await managedAccountSyncRuntime.recordRecoveryCandidate({reason:'stale-device-cache',entityType:'tradeEntry',entityId:'unresolved:fixture',identity:{unresolved:true},values:{unresolved:true},source:'fixture'});
    const afterCandidate=__normal.writes.length,recovery=await addManagedIntentEntries('lf',[{name:'Squirtle'}]);
    return{before,broken,afterIdentity,afterCandidate,recovery,after:__normal.writes.length,state:(await managedAccountSyncRuntime.snapshot()).state};
  });
  expect(result.broken).toBe(false);expect(result.afterIdentity).toBe(result.before);
  expect(result.recovery).toBe(false);expect(result.after).toBe(result.afterCandidate);expect(result.state).toBe('review-required');
  await page.evaluate(()=>stopAccountSyncRuntime());
});
