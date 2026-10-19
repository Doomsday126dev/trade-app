const {test,expect}=require('@playwright/test');

// Only the Firebase transport/auth boundary is simulated. Admission, migration,
// IndexedDB, repository transactions, product actions and publication are real.
async function install(page,state=null,{profileOnly=false,emulator=''}={}){
  await page.route(/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|firestore\.googleapis\.com)/,route=>route.abort());
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



test('canonical publication ignores unneeded legacy reads, reports publication failure and retries after reload',async({page,context})=>{
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
  await page.evaluate(()=>openSyncDetail());
  expect(await page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).lastProjectionError)).toBe('');
  const saved=await page.evaluate(()=>structuredClone(__normal.remote));
  expect(saved.publicShares.NormalProduct.declarations.some(e=>e.name==='Squirtle')).toBe(true);
  await page.evaluate(()=>stopAccountSyncRuntime());await page.close();
  const reopened=await context.newPage();await install(reopened,saved,{profileOnly:true});await settled(reopened);
  const persisted=await reopened.evaluate(()=>__normal.remote.publicShares.NormalProduct);
  expect(persisted.declarations.some(e=>e.name==='Squirtle')).toBe(true);
  expect(await reopened.evaluate(()=>{const data=normalizeData({});applyPublicShareSnapshot(data,__normal.remote.publicShares.NormalProduct);return productDeclarations('NormalProduct',data).entries.map(e=>e.name);})).toContain('Squirtle');
  await reopened.evaluate(()=>stopAccountSyncRuntime());
});


test('emulator canonical save publishes under deployed rules and survives independent server read and reopen',async({page,context,request})=>{
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
  const viewer=await context.newPage();
  await viewer.route('**/sw.js*',route=>route.abort());
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:'export function initializeApp(){return{}}'}));
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:'export class ReCaptchaEnterpriseProvider{};export function initializeAppCheck(){return{}};export async function getToken(){return{token:"emulator-only"}}'}));
  await viewer.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:`export function getDatabase(){return{}};export function ref(db,path){return path};export async function get(path){const response=await fetch(${JSON.stringify(emulator)}+'/'+path+'.json?ns=demo-trade-investigation-default-rtdb');if(!response.ok)throw new Error('emulator read failed');const value=await response.json();return{exists:()=>value!=null,val:()=>value}}`}));
  await viewer.goto('./?view=NormalProduct');await expect(viewer.locator('#share-list-out')).toContainText('Squirtle');
  await viewer.reload();await expect(viewer.locator('#share-list-out')).toContainText('Squirtle');
});
