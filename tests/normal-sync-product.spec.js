const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});

// Only the Firebase transport/auth boundary is simulated. Admission, migration,
// IndexedDB, repository transactions, product actions and publication are real.
async function install(page,state=null,{profileOnly=false,emulator=''}={}){
  // Keep real SDK imports, but do not send local-fixture attestations, Auth
  // traffic, Functions/Run calls or analytics to production during startup.
  // Context-level routes also cover reopened pages; PWA caching is tested in
  // its separate service-worker-enabled file.
  await page.context().route(url=>/(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|cloudfunctions\.net|run\.app|cloudflareinsights\.com)$/.test(url.hostname)||url.pathname.includes('/recaptcha/'),route=>route.abort());
  await page.goto('./?normal-sync-qualification');
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('normal-sync-qualification'));
  await page.waitForFunction(()=>typeof ensureAccountSyncRuntime==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  return page.evaluate(async ({saved,profileOnly,emulator})=>{
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
    const notify=changed=>{for(const {path,onData} of listeners)if(path===changed||changed.startsWith(path+'/')||path.startsWith(changed+'/'))onData(snapshot(path));};
    runTransaction=async(path,fn,options)=>{
      if(!path.startsWith(`accountSync/${uid}/`)&&!path.startsWith(`authIndex/${uid}/accountSyncRecoveryReviews/`)&&path!==`users/${username}/canonicalListActivity`)throw new Error(`Unexpected transaction: ${path}`);
      if(options?.applyLocally!==false)throw new Error('Unverified local transaction');
      const next=fn(clone(read(path)));if(next===undefined)return{committed:false,snapshot:snapshot(path)};
      writes.push(path);put(path,next);notify(path);return{committed:true,snapshot:snapshot(path)};
    };
    set=async(path,value)=>{if(window.__normal?.failPublication&&path===`publicShares/${username}`)throw Object.assign(new Error('simulated disconnect'),{code:'db/public-share-timeout'});if(path!==`publicShares/${username}`&&path!==`users/${username}/canonicalListActivity`)throw new Error(`Legacy or identity write: ${path}`);writes.push(path);put(path,value);};
    update=async()=>{throw new Error('Unexpected legacy update');};
    if(emulator){
      if(!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(emulator))throw new Error('Local emulator required');
      const ns='demo-trade-investigation-default-rtdb',seconds=Math.floor(Date.now()/1000);
      const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      const token=encode({alg:'none',typ:'JWT'})+'.'+encode({sub:uid,user_id:uid,aud:'demo-trade-investigation',iss:'https://securetoken.google.com/demo-trade-investigation',iat:seconds,exp:seconds+3600,email:'safe@example.test',firebase:{sign_in_provider:'password'}})+'.';
      const endpoint=(path,authenticated=true)=>`${emulator}/${path?path+'.json':'.json'}?ns=${ns}${authenticated?'&auth='+token:''}`;
      const seed=saved?{ok:true}:await fetch(endpoint('',false),{method:'PUT',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify(remote)});if(!seed.ok)throw new Error('Emulator fixture seed failed');
      const readServer=async path=>{const response=await fetch(endpoint(path),{headers:{'X-Firebase-ETag':'true'}});if(!response.ok)throw new Error('Emulator read failed: '+response.status);return{value:await response.json(),etag:response.headers.get('etag')};};
      get=async path=>{reads.push(path);const {value}=await readServer(path);return{exists:()=>value!=null,val:()=>clone(value)};};
      serverTimestamp=()=>({'.sv':'timestamp'});
      runTransaction=async(path,fn,options)=>{
        if(options?.applyLocally!==false)throw new Error('Unverified local transaction');
        const current=await readServer(path),next=fn(clone(current.value));if(next===undefined)return{committed:false,snapshot:{val:()=>current.value}};
        const response=await fetch(endpoint(path),{method:'PUT',headers:{'content-type':'application/json','if-match':current.etag},body:JSON.stringify(next)});if(!response.ok)throw new Error('Emulator transaction rejected: '+response.status);
        const value=await response.json();put(path,value);writes.push(path);notify(path);return{committed:true,snapshot:snapshot(path)};
      };
      set=async(path,value)=>{
        if(window.__normal?.failPublication&&path===`publicShares/${username}`)throw Object.assign(new Error('simulated disconnect'),{code:'db/public-share-timeout'});
        const response=await fetch(endpoint(path),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Emulator write rejected: '+response.status);
        put(path,await response.json());writes.push(path);
      };
      update=async(path,fields)=>{
        const response=await fetch(endpoint(path),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(fields)});if(!response.ok)throw new Error('Emulator profile update rejected: '+response.status);
        for(const [field,value]of Object.entries(await response.json()))put(path+'/'+field,value);writes.push(path);notify(path);
      };
    }
    auth={currentUser:{uid}};cur=username;currentAuthUid=uid;_authStateKnown=true;firebaseDataProtectionReady=true;db={};fbOn=true;activeCanonicalIdentity=null;
    activateOwnedSession(uid,username);
    if(!saved){allData=normalizeData(clone(remote));saveLocal(allData);}
    for(const surface of (profileOnly?['profile']:publicSharePublicationDomain.REQUIRED_SOURCE_SURFACES))managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded',have:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent=username;switchTab('mylist',{render:false});
    const canary=await accountSyncCanaryMember(),started=await ensureAccountSyncRuntime();renderMyList();setSyncStatus('online');
    window.__normal={remote,writes,reads,original};
    return{canary,started,state:await managedAccountSyncRuntime.snapshot(),authority:(await accountSyncMutationAuthority()).mode};
  },{saved:state,profileOnly,emulator});
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
  expect(before.writes.every(path=>path.startsWith('accountSync/normal-product-uid/')||path==='publicShares/NormalProduct'||path==='users/NormalProduct/canonicalListActivity')).toBe(true);
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
  await page.locator('#combined-priority').selectOption('H');await page.locator('#combined-save').click();await settled(page);
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



test('canonical publication ignores unneeded legacy reads, reports failure and automatically retries before reload',async({page,context})=>{
  await install(page,null,{profileOnly:true});await settled(page);
  expect(await page.evaluate(()=>__normal.remote.publicShares.NormalProduct.declarationCount)).toBe(1);
  await page.evaluate(()=>{__normal.failPublication=true;});
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Squirtle',p:'H'}]))).toBe(true);await settled(page);
  const failed=await page.evaluate(async()=>({state:await managedAccountSyncRuntime.snapshot(),presentation:accountSyncPresentation(),remote:structuredClone(__normal.remote)}));
  expect(failed.state.state).toBe('saved');expect(failed.state.lastProjectionError).toBeTruthy();
  expect(failed.presentation.labelKey).toBe('accountSync.publicationPending');
  expect(failed.remote.publicShares.NormalProduct.declarationCount).toBe(1);
  expect(failed.remote.users.NormalProduct.canonicalListActivity.listed).toBe(2);
  const accepted=await page.evaluate(()=>Math.max(...accountSyncCanonicalEntities.filter(e=>e.entityType==='tradeEntry').map(e=>e.updatedAt)));
  expect(failed.remote.users.NormalProduct.canonicalListActivity.updatedAt).toBe(accepted);
  const row=await page.evaluate(()=>adminUserRows().find(row=>row.u===cur));expect(row.listed).toBe(2);expect(row.updated).toBe(accepted);expect(row.canonical).toBe(true);
  await page.evaluate(()=>{__normal.failPublication=false;});
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError),{timeout:5000}).toBe('');
  const saved=await page.evaluate(()=>structuredClone(__normal.remote));
  expect(saved.publicShares.NormalProduct.declarations.some(e=>e.name==='Squirtle')).toBe(true);
  await page.evaluate(()=>stopAccountSyncRuntime());await page.close();
  const reopened=await context.newPage();await install(reopened,saved,{profileOnly:true});await settled(reopened);
  const persisted=await reopened.evaluate(()=>__normal.remote.publicShares.NormalProduct);
  expect(persisted.declarations.some(e=>e.name==='Squirtle')).toBe(true);
  expect(await reopened.evaluate(()=>{const data=normalizeData({});applyPublicShareSnapshot(data,__normal.remote.publicShares.NormalProduct);return productDeclarations('NormalProduct',data).entries.map(e=>e.name);})).toContain('Squirtle');
  await reopened.evaluate(()=>stopAccountSyncRuntime());
});


test('emulator canonical save publishes under deployed rules and survives independent server read and reopen',async({page,context,request,browser})=>{
  const emulator=process.env.POGO_DATABASE_EMULATOR;test.skip(!emulator,'Run with a local RTDB emulator and the reviewed rules loaded');
  expect(emulator).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/);
  await install(page,null,{profileOnly:true,emulator});await settled(page);
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Squirtle',p:'H'}]))).toBe(true);await settled(page);
  const publicUrl=emulator+'/publicShares/NormalProduct.json?ns=demo-trade-investigation-default-rtdb';
  const publicResponse=await request.get(publicUrl);expect(publicResponse.status()).toBe(200);const published=await publicResponse.json();
  expect(published.declarations.some(e=>e.name==='Squirtle')).toBe(true);
  const server=await request.get(emulator+'/.json?ns=demo-trade-investigation-default-rtdb',{headers:{authorization:'Bearer owner'}});expect(server.status()).toBe(200);const stored=await server.json();
  expect(stored.users.NormalProduct.canonicalListActivity.listed).toBe(2);
  expect(Object.values(stored.accountSync['normal-product-uid'].tradeEntries).filter(e=>!e.deleted).length).toBe(3);
  const denied=await request.get(emulator+'/accountSync/normal-product-uid.json?ns=demo-trade-investigation-default-rtdb');expect(denied.status()).toBe(401);
  await page.evaluate(()=>stopAccountSyncRuntime());await page.close();
  const reopened=await context.newPage();await install(reopened,stored,{profileOnly:true,emulator});await settled(reopened);
  expect(await reopened.evaluate(()=>productDeclarations().entries.some(e=>e.name==='Squirtle'))).toBe(true);
  await reopened.evaluate(()=>stopAccountSyncRuntime());
  // A truly anonymous viewer must not inherit the owner's controlling SW, which
  // can bypass the SDK transport routes below (notably in WebKit).
  const {viewport,userAgent,deviceScaleFactor,isMobile,hasTouch,baseURL}=test.info().project.use;
  const viewerContext=await browser.newContext({viewport,userAgent,deviceScaleFactor,isMobile,hasTouch,baseURL,serviceWorkers:'block'});
  const viewer=await viewerContext.newPage();
  try{
  await viewer.route('**/sw.js*',route=>route.abort());
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:'export function initializeApp(){return{}}'}));
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:'export class ReCaptchaEnterpriseProvider{};export function initializeAppCheck(){return{}};export async function getToken(){return{token:"emulator-only"}}'}));
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:`export function getDatabase(){return{}};export function ref(db,path){return path};export async function get(path){const response=await fetch(${JSON.stringify(emulator)}+'/'+path+'.json?ns=demo-trade-investigation-default-rtdb');if(!response.ok)throw new Error('emulator read failed');const value=await response.json();return{exists:()=>value!=null,val:()=>value}}`}));
  await viewer.goto('./?view=NormalProduct');await expect(viewer.locator('#share-list-out')).toContainText('Squirtle');
  await viewer.reload();await expect(viewer.locator('#share-list-out')).toContainText('Squirtle');
  }finally{await viewerContext.close();}
});


test('publication cannot follow an account switch while its activity transaction is pending',async({page})=>{
  await install(page);await settled(page);
  const result=await page.evaluate(async()=>{
    const rows=accountSyncModel.publicTradeProjection(accountSyncCanonicalEntities),before=__normal.writes.length;
    let release,entered;const started=new Promise(resolve=>{entered=resolve;});
    runTransaction=async(path,fn)=>{const value=fn(__normal.remote.users.NormalProduct.canonicalListActivity);entered();return new Promise(resolve=>{release=()=>resolve({committed:true,snapshot:{val:()=>value}});});};
    const pending=publishAccountSyncProjection(rows,{}, {updatedAt:Date.now()}).then(()=>'',error=>error.message);
    await started;cur='OtherTrainer';auth={currentUser:{uid:'other-user'}};activateOwnedSession('other-user','OtherTrainer');release();
    return{error:await pending,writes:__normal.writes.slice(before)};
  });
  expect(result.error).toBe('share-publication/session-changed');expect(result.writes).toEqual([]);
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('emulator account fence cannot make activity analytics block an allowed public update',async({page,request})=>{
  const emulator=process.env.POGO_DATABASE_EMULATOR;test.skip(!emulator,'Local emulator required');
  expect(emulator).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/);
  await install(page,null,{profileOnly:true,emulator});await settled(page);
  const fence=await request.put(emulator+'/legacyIdentityFences/normal-product-uid.json?ns=demo-trade-investigation-default-rtdb',{headers:{authorization:'Bearer owner'},data:{fixture:true}});expect(fence.status()).toBe(200);
  await page.evaluate(async()=>{
    const row=accountSyncCanonicalEntities.find(e=>!e.deleted&&e.entityType==='tradeEntry'&&accountSyncCatalogEntryForId(e.identity.catalogId)?.name==='Pikachu');
    await applyAccountSyncTradeMutations([{kind:'patch',entityType:'tradeEntry',entityId:row.entityId,patch:{priority:'L'}}],(await accountSyncMutationAuthority()).controller);
  });await settled(page);
  expect(await page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError)).toBe('');
  const published=await request.get(emulator+'/publicShares/NormalProduct.json?ns=demo-trade-investigation-default-rtdb');expect(published.status()).toBe(200);
  expect((await published.json()).declarations.some(e=>e.name==='Pikachu'&&e.p==='L')).toBe(true);
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('stale offline profile edit and old queued replay cannot overwrite canonical activity',async({page})=>{
  const emulator=process.env.POGO_DATABASE_EMULATOR||'';
  await install(page,null,{emulator});await settled(page);
  const result=await page.evaluate(async emulator=>{
    const stale=structuredClone(getLocal().users[cur]);
    const fresh={schemaVersion:1,updatedAt:Date.now()+1000,listed:9};
    const serverSet=set,serverUpdate=update;
    if(emulator)await runTransaction(ref(db,`users/${cur}/canonicalListActivity`),()=>fresh,{applyLocally:false});
    else __normal.remote.users[cur].canonicalListActivity=fresh;
    update=async()=>{throw new Error('offline profile transport');};
    await writeUserNow(cur,{...stale,bio:'offline biography'});clearTimeout(syncFlushTimer);
    const generated=Object.values(syncQueue).filter(item=>item.path?.includes('/canonicalListActivity')).map(item=>item.path);
    // Persisted .126 queue shapes must also be safe after upgrading.
    syncQueue[`users/${cur}/canonicalListActivity`]={kind:'set',path:`users/${cur}/canonicalListActivity`,data:stale.canonicalListActivity,ts:1};
    syncQueue[`users/${cur}/canonicalListActivity/listed`]={kind:'set',path:`users/${cur}/canonicalListActivity/listed`,data:1,ts:1};
    syncQueue[`users/${cur}`]={kind:'set',path:`users/${cur}`,data:{bio:'offline biography',canonicalListActivity:stale.canonicalListActivity,'canonicalListActivity/listed':1},ts:1};
    _onOwnedDataSnapshot({surface:'profile',path:`users/${cur}`,value:structuredClone(__normal.remote.users[cur])});
    const overlaid=structuredClone(getLocal().users[cur].canonicalListActivity);
    const attempts=[];
    const apply=(path,value)=>{const parts=path.split('/'),key=parts.pop();let node=__normal.remote;for(const part of parts)node=node[part]??={};node[key]=structuredClone(value);};
    set=async(path,value)=>{attempts.push(path);if(emulator)return serverSet(path,value);apply(path,value);};
    update=async(path,fields)=>{attempts.push(path);if(emulator)return serverUpdate(path,fields);for(const [field,value]of Object.entries(fields))apply(path+'/'+field,value);};
    await flushSyncQueue();clearTimeout(syncFlushTimer);
    return{generated,overlaid,fresh,remote:emulator?(await get(ref(db,`users/${cur}`))).val():__normal.remote.users[cur],attempts,remaining:Object.keys(syncQueue)};
  },emulator);
  expect.soft(result.generated).toEqual([]);
  expect.soft(result.overlaid).toEqual(result.fresh);
  expect.soft(result.remote.canonicalListActivity).toEqual(result.fresh);
  expect(result.remote.bio).toBe('offline biography');
  expect(result.attempts.some(path=>path.includes('/canonicalListActivity'))).toBe(false);
  expect(result.remaining).toEqual([]);
  await page.evaluate(()=>stopAccountSyncRuntime());
});


test('auth binding preserves the newer server activity summary',async({page})=>{
  const emulator=process.env.POGO_DATABASE_EMULATOR||'';
  await install(page,null,{emulator});await settled(page);
  const result=await page.evaluate(async emulator=>{
    const fresh={schemaVersion:1,updatedAt:Date.now()+2000,listed:12};
    if(emulator)await runTransaction(ref(db,`users/${cur}/canonicalListActivity`),()=>fresh,{applyLocally:false});
    else __normal.remote.users[cur].canonicalListActivity=fresh;
    const apply=(path,value)=>{const parts=path.split('/'),key=parts.pop();let node=__normal.remote;for(const part of parts)node=node[part]??={};node[key]=structuredClone(value);};
    // Auth-directory provisioning is outside this synthetic member fixture; the profile write and read use real emulator rules.
    const serverSet=set;
    set=async(path,value)=>{if(path.startsWith('loginDirectory/'))return apply(path,value);if(emulator)return serverSet(path,value);apply(path,value);};
    if(!emulator)update=async(path,fields)=>{for(const [field,value]of Object.entries(fields))apply(path+'/'+field,value);};
    await bindAuthUserNow(cur,{authUid:'normal-product-uid'});
    return{fresh,remote:emulator?(await get(ref(db,`users/${cur}`))).val():__normal.remote.users[cur]};
  },emulator);
  expect(result.remote.canonicalListActivity).toEqual(result.fresh);
  expect(result.remote.authUid).toBe('normal-product-uid');
  await page.evaluate(()=>stopAccountSyncRuntime());
});


test('a delayed legacy public queue cannot overwrite a newer canonical publication',async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(async()=>{
    const old=structuredClone(__normal.remote.publicShares.NormalProduct),serverSet=set;let release,entered;
    const barrier=new Promise(r=>release=r),started=new Promise(r=>entered=r);
    let held=false;
    set=async(path,value)=>{if(path==='publicShares/NormalProduct'&&!held&&value.declarationCount===1){held=true;entered();await barrier;}return serverSet(path,value);};
    __normal.releaseLegacy=release;
    queueSync('publicShares/NormalProduct',old);clearTimeout(syncFlushTimer);
    __normal.legacyFlush=flushSyncQueue();await started;
  });
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Squirtle',p:'H'}]))).toBe(true);
  // The unfixed queue writer is outside canonical serialization: the newer
  // publication can finish while its stale cached public write is held.
  await page.waitForFunction(()=>__normal.remote.publicShares.NormalProduct.declarationCount===2,null,{timeout:500}).catch(()=>{});
  await page.evaluate(async()=>{__normal.releaseLegacy();await __normal.legacyFlush;});
  await settled(page);
  const result=await page.evaluate(async()=>({state:await managedAccountSyncRuntime.snapshot(),count:__normal.remote.publicShares.NormalProduct.declarationCount,names:__normal.remote.publicShares.NormalProduct.declarations.map(e=>e.name)}));
  expect(result.state.pendingCount).toBe(0);expect(result.state.lastProjectionError).toBe('');
  expect(result.count).toBe(2);expect(result.names).toContain('Squirtle');
  await page.evaluate(()=>stopAccountSyncRuntime());
});


test('canonical public queue retains failed work and reports publication pending',async({page})=>{
  await install(page);await settled(page);
  const failed=await page.evaluate(async()=>{
    __normal.failPublication=true;queueSync('publicShares/NormalProduct',structuredClone(__normal.remote.publicShares.NormalProduct));clearTimeout(syncFlushTimer);
    await flushSyncQueue();clearTimeout(syncFlushTimer);
    return{queued:!!syncQueue['publicShares/NormalProduct'],state:await managedAccountSyncRuntime.snapshot(),presentation:accountSyncPresentation()};
  });
  expect(failed.queued).toBe(true);expect(failed.state.state).toBe('saved');expect(failed.state.lastProjectionError).toBeTruthy();
  expect(failed.presentation.publicationPending).toBe(true);
  await page.evaluate(async()=>{__normal.failPublication=false;await flushSyncQueue();clearTimeout(syncFlushTimer);});
  expect(await page.evaluate(()=>!!syncQueue['publicShares/NormalProduct'])).toBe(false);
  expect(await page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError)).toBe('');
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('same-account runtime replacement recovers a held save without waiting for its old transport',async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(async()=>{
    const transaction=runTransaction;let release,entered,held=false;
    const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
    runTransaction=async(...args)=>{if(!held&&String(args[0]).includes('/tradeEntries/')){held=true;entered();await gate;}return transaction(...args);};
    __normal.heldSave={release,waiting,restore:()=>{runTransaction=transaction;}};
    // Repositories capture their transport at construction time.
    await stopAccountSyncRuntime();await ensureAccountSyncRuntime();
  });
  expect(await page.evaluate(()=>addManagedIntentEntries('lf',[{name:'Squirtle',p:'H'}]))).toBe(true);
  await page.evaluate(async()=>{await __normal.heldSave.waiting;__normal.heldSave.oldDrain=managedAccountSyncRuntime.controller.drain();});
  const result=await page.evaluate(async()=>{
    const started=performance.now();await stopAccountSyncRuntime();const elapsed=performance.now()-started;
    __normal.heldSave.restore();const replacement=await ensureAccountSyncRuntime();
    await managedAccountSyncRuntime.controller.drain();
    const entity=managedAccountSyncRuntime.controller.activeEntities('tradeEntry').find(e=>e.identity.catalogId.includes('squirtle')||accountSyncCatalogEntryForId(e.identity.catalogId,e.identity)?.name==='Squirtle');
    if(!entity)throw Error('Recovered declaration missing');
    const changed=await managedAccountSyncRuntime.controller.patchEntity({entityType:'tradeEntry',entityId:entity.entityId,patch:{priority:'M'}});
    if(!changed.ok)throw Error('Replacement edit failed');await managedAccountSyncRuntime.controller.drain();
    __normal.heldSave.release();await __normal.heldSave.oldDrain;
    return{elapsed,replacement,state:await managedAccountSyncRuntime.snapshot(),server:structuredClone(__normal.remote.accountSync['normal-product-uid']),public:structuredClone(__normal.remote.publicShares.NormalProduct)};
  });
  expect(result.elapsed).toBeLessThan(1500);expect(result.replacement.ok).toBe(true);expect(result.state.state).toBe('saved');
  // Two public wants plus the preserved, inert legacy FT entry.
  const rows=Object.values(result.server.tradeEntries).filter(e=>!e.deleted);expect(rows).toHaveLength(3);expect(result.public.declarations).toHaveLength(2);
  expect(result.public.declarations.find(e=>e.name==='Squirtle').p).toBe('M');
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('another device repairs the public list through the product allowlist',async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(async()=>{
    const ownerUid=auth.currentUser.uid,journal=accountSyncJournalData.createAccountSyncJournal({ownerUid,databaseName:'repair-peer-'+Date.now()});
    const repository=accountSyncRepositoryData.createAccountSyncRepository({database:db,ref,get,onValue,runTransaction,serverTimestamp,ownerUid});
    const peer=window.PogoData.accountSyncController.createAccountSyncController({ownerUid,journal,repository,enabled:true,writesEnabled:true,admitted:true});
    await peer.activate();await peer.waitForListenerReady();
    const old=peer.activeEntities('tradeEntry').find(e=>e.identity.surface==='my-list');
    const changed=await peer.patchEntity({entityType:'tradeEntry',entityId:old.entityId,patch:{priority:'L'}});if(!changed.ok)throw Error('Peer mutation failed');
    await peer.drain();await peer.deactivate();await journal.close();
  });
  await expect.poll(()=>page.evaluate(()=>__normal.remote.publicShares.NormalProduct.declarations.find(e=>e.name==='Pikachu')?.p),{timeout:5000}).toBe('L');
  const result=await page.evaluate(async()=>({public:__normal.remote.publicShares.NormalProduct,state:await managedAccountSyncRuntime.snapshot()}));
  expect(result.public.declarations.every(e=>e.intent==='lf')).toBe(true);expect(result.public.declarations.some(e=>e.name==='Eevee')).toBe(false);
  expect(result.public.favorites).toBeUndefined();expect(result.public.tags).toBeUndefined();expect(result.public.recoveryCandidates).toBeUndefined();
  expect(result.state.lastProjectionError).toBe('');await page.evaluate(()=>stopAccountSyncRuntime());
});

for(const cause of ['runtime-replaced','deadline-expired'])test(`late public write is reconciled after ${cause}`,async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(async cause=>{
    const serverSet=set,timeout=withTimeout;let release,entered,held=false;
    const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
    set=async(path,value)=>{
      if(path==='publicShares/NormalProduct'&&!held){held=true;entered();await gate;const result=await serverSet(path,value);__normal.latePriority=value.declarations.find(e=>e.name==='Pikachu')?.p;return result;}
      return serverSet(path,value);
    };
    if(cause==='deadline-expired')withTimeout=(promise,ms,message,code)=>timeout(promise,code==='db/public-share-timeout'?40:ms,message,code);
    __normal.latePublic={release,waiting,restoreTimeout:()=>{withTimeout=timeout;}};
    __normal.latePublic.publication=managedAccountSyncRuntime.publishCurrentProjection('late-write-fixture');
    await waiting;
  },cause);
  if(cause==='runtime-replaced')await page.evaluate(async()=>{await stopAccountSyncRuntime();await ensureAccountSyncRuntime();});
  else await page.evaluate(async()=>{await __normal.latePublic.publication;__normal.latePublic.restoreTimeout();});
  await page.evaluate(async()=>{
    const entity=managedAccountSyncRuntime.controller.activeEntities('tradeEntry').find(e=>e.identity.surface==='my-list');
    const result=await managedAccountSyncRuntime.controller.patchEntity({entityType:'tradeEntry',entityId:entity.entityId,patch:{priority:'M'}});
    if(!result.ok)throw Error('Current edit failed');await managedAccountSyncRuntime.controller.drain();
    if(__normal.remote.publicShares.NormalProduct.declarations.find(e=>e.name==='Pikachu')?.p!=='M')throw Error('Current publication missing');
    __normal.latePublic.release();await __normal.latePublic.publication;
  });
  await expect.poll(()=>page.evaluate(()=>__normal.latePriority)).toBe('H');
  await expect.poll(()=>page.evaluate(()=>__normal.remote.publicShares.NormalProduct.declarations.find(e=>e.name==='Pikachu')?.p),{timeout:5000}).toBe('M');
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError)).toBe('');
  await page.evaluate(()=>stopAccountSyncRuntime());
});

test('late-write observer handles settled deadline races and refuses another owner',async({page})=>{
  await install(page);await settled(page);await page.evaluate(()=>stopAccountSyncRuntime());
  const result=await page.evaluate(async()=>{
    const uid=auth.currentUser.uid,username=cur,calls=[];
    const runtime={ownerUid:uid,username,projectionReady:true,publishCurrentProjection:async kind=>{calls.push(kind);return{ok:true,status:'published'};}};
    managedAccountSyncRuntime=runtime;
    try{
      const completion=observePublicWriteCompletion(Promise.resolve(),username,uid);
      await Promise.resolve();completion.markUncertain();completion.markUncertain();await new Promise(r=>setTimeout(r,0));
      const afterDeadlineRace=calls.length;
      let release;const pending=new Promise(r=>release=r);observePublicWriteCompletion(pending,username,uid);
      managedAccountSyncRuntime={...runtime,ownerUid:'another-owner',username:'Another'};release();await new Promise(r=>setTimeout(r,0));
      const afterOwnerSwitch=calls.length;managedAccountSyncRuntime=runtime;
      const aborted=observePublicWriteCompletion(Promise.resolve({committed:false}),username,uid,{provider:true});aborted.markUncertain();await new Promise(r=>setTimeout(r,0));
      return{afterDeadlineRace,afterOwnerSwitch,afterProviderAbort:calls.length};
    }finally{managedAccountSyncRuntime=null;}
  });
  expect(result).toEqual({afterDeadlineRace:1,afterOwnerSwitch:1,afterProviderAbort:1});
});

test('sustained slow public acknowledgements converge without a rewrite loop and proof is one-use',async({page})=>{
  await install(page);await settled(page);
  await page.evaluate(async()=>{
    const serverSet=set,timeout=withTimeout;__normal.slowWrites=0;
    set=async(path,value)=>{if(path==='publicShares/NormalProduct'){__normal.slowWrites++;await new Promise(r=>setTimeout(r,70));}return serverSet(path,value);};
    withTimeout=(promise,ms,message,code)=>timeout(promise,code==='db/public-share-timeout'?40:ms,message,code);
    __normal.restoreSlow=()=>{set=serverSet;withTimeout=timeout;};
    await managedAccountSyncRuntime.publishCurrentProjection('sustained-slow-fixture');
  });
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError),{timeout:3000}).toBe('');
  await page.waitForTimeout(300);expect(await page.evaluate(()=>__normal.slowWrites)).toBe(1);
  await page.evaluate(()=>managedAccountSyncRuntime.publishCurrentProjection('explicit_share'));
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError),{timeout:3000}).toBe('');
  await page.waitForTimeout(300);expect(await page.evaluate(()=>__normal.slowWrites)).toBe(2);
  await page.evaluate(async()=>{__normal.restoreSlow();await stopAccountSyncRuntime();});
});
