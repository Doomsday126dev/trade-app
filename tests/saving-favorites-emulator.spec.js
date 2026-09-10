const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.INCIDENT_SOURCE_ROOT||path.join(__dirname,'..');
const project='demo-pogo-saving-incident',database='http://127.0.0.1:9500',authHost='http://127.0.0.1:9599';
const namespace=`${project}-default-rtdb`;
test.use({serviceWorkers:'block'});
test.skip(process.env.POGO_SAVING_EMULATORS!=='1','Run with the isolated Auth/RTDB incident emulators.');

async function request(url,method='GET',value,headers={}){
  const response=await fetch(url,{method,headers:{'content-type':'application/json',...headers},body:value===undefined?undefined:JSON.stringify(value)});
  return{status:response.status,value:await response.json()};
}
function dataUrl(key,token){const url=new URL(`${database}/${key||''}.json`);url.searchParams.set('ns',namespace);if(token)url.searchParams.set('auth',token);return url;}
async function adminData(method,key,value){return request(dataUrl(key),method,value,{authorization:'Bearer owner'});}
async function seed(){
  const suffix=Date.now().toString(36),username=`Incident${suffix}`,other=`Other${suffix}`,pin='834761';
  const create=async name=>{const response=await request(`${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,'POST',{email:`${name.toLowerCase()}@pogotrades.nyc`,password:pin,returnSecureToken:true});expect(response.status).toBe(200);return response.value;};
  const account=await create(username),target=await create(other),uid=account.localId,targetUid=target.localId;
  const ownerProfile={authUid:uid,authEmail:`${username.toLowerCase()}@pogotrades.nyc`,authVersion:1,isAdmin:false,isOwner:false,specialTradeBoard:{lf:[],ft:[]}};
  const data={loginDirectory:{[username]:{authReady:true,authVersion:1},[other]:{authReady:true,authVersion:1}},users:{[username]:ownerProfile,[other]:{authUid:targetUid,privateNote:'MUST NOT REACH ORDINARY CLIENT'}},authIndex:{[uid]:{username},[targetUid]:{username:other}},wishlist:{[username]:{Pikachu:'H'},[other]:{Eevee:'L'}},dynamax:{[username]:{}},gmax:{[username]:{}},costumes:{[username]:{}},publicShares:{[other]:{version:1,username:other,profile:{bio:'Public profile'},lists:{wishlist:{Eevee:'L'},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],updatedAt:1}}};
  expect((await adminData('PUT','',data)).status).toBe(200);
  // Ordinary tokens really are denied the identity records that old fixtures supplied.
  for(const key of [`users/${other}`,`authIndex/${targetUid}`,'users','authIndex'])expect((await request(dataUrl(key,account.idToken))).status).toBe(401);
  const history={version:3,schemaVersion:3,migrationVersion:3,owner:{uid,username},favorites:[{key:other.toLowerCase(),displayName:other,tagIds:['tag_nearby'],createdAt:1,updatedAt:1}],tags:{tag_nearby:{label:'Nearby',createdAt:1,updatedAt:1}},recent:[],snapshots:{[other.toLowerCase()]:{seenAt:1,snapshot:{version:1,username:other,lists:{wishlist:{Eevee:'L'}}}}},legacyExtension:{preserve:true}};
  const owned={users:{[username]:ownerProfile},authIndex:{[uid]:{username}},wishlist:{[username]:{Pikachu:'H'}},dynamax:{},gmax:{},costumes:{}};
  return{uid,username,other,targetUid,pin,history,owned};
}

// Only emulator endpoint wiring and the App Check attestation boundary are
// substituted. Login, restored Auth, own-account subscriptions, IndexedDB,
// startup/migration, RTDB transactions and the product actions execute normally.
async function routeEmulators(page,fixture,{legacy=true}={}){
  const origin=String(test.info().project.use.baseURL||'http://localhost:4174');
  if(page.context().browser()?.browserType().name()==='chromium')await page.context().grantPermissions(['local-network-access'],{origin});
  await page.route(url=>/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com)$/.test(url.hostname),route=>route.abort());
  await page.route('**/js/app/application.js*',route=>{
    let source=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
    source=source.replace('getDatabase=dbMod.getDatabase;','getDatabase=dbMod.getDatabase;window.__incidentDbSdk=dbMod;');
    source=source.replace('runTransaction=dbMod.runTransaction;',"runTransaction=(...args)=>window.__incidentRejectWrites?Promise.reject(Object.assign(new Error('offline'),{code:'account-sync/network-failed'})):dbMod.runTransaction(...args);");
    source=source.replace('onValue=dbMod.onValue;',"onValue=(reference,onData,onError,...rest)=>{if(reference.toString().includes('/accountSync/'))window.__incidentListenerFailure=onError;return dbMod.onValue(reference,onData,onError,...rest);};");
    source=source.replace('firebaseDatabaseHandle=getDatabase(fbApp,url);',"firebaseDatabaseHandle=getDatabase(fbApp,url);window.__incidentDbSdk.connectDatabaseEmulator(firebaseDatabaseHandle,'127.0.0.1',9500);");
    source=source.replace('function startFirebaseAppCheck(', 'function unusedIncidentAppCheck(');
    source+='\nfunction startFirebaseAppCheck(){return Promise.resolve({ok:true,instance:{}});}\n';
    source=source.replace('function firebaseAppCheckReady(){',"function firebaseAppCheckReady(){if(window.__incidentAppCheckFailed)return Promise.resolve({ok:false,code:'app-check/network-failed'});return Promise.resolve({ok:true,instance:{}});");
    return route.fulfill({contentType:'text/javascript',body:source});
  });
  await page.route(url=>url.origin===origin&&(url.pathname==='/'||url.pathname==='/index.html'),route=>{
    let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replaceAll('trade-list-a4297',project);
    html=html.replace('state.auth=state.authMod.getAuth(state.app);',`state.auth=state.authMod.getAuth(state.app);state.authMod.connectAuthEmulator(state.auth,'${authHost}',{disableWarnings:true});`);
    return route.fulfill({contentType:'text/html',body:html});
  });
  if(legacy)await page.addInitScript(({uid,username,history,owned})=>{
    if(localStorage.getItem('incident-storage-seeded'))return;
    localStorage.setItem(`pogoTrainerHistory_v1:${encodeURIComponent(uid)}`,JSON.stringify(history));
    localStorage.setItem('pogoSessionCache_v2',JSON.stringify({schemaVersion:2,public:{loginDirectory:{}},protected:{owner:{uid,username},data:owned}}));
    localStorage.setItem('pogoSyncQueue_v2',JSON.stringify({schemaVersion:2,owner:{uid,username},entries:{},quarantined:{}}));
    localStorage.setItem('incident-storage-seeded','true');
  },fixture);
}
async function login(page,fixture){
  await page.goto('./?saving-incident');
  await page.evaluate(()=>window.__pogoEnsureFullApp('saving-incident'));
  await page.waitForFunction(()=>typeof ensureAccountSyncRuntime==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  await page.waitForFunction(()=>managedLoginDirectory.snapshot().status==='loaded',{},{timeout:30000});
  await expect(page.locator('#login-user')).toBeEnabled({timeout:30000});
  await page.locator('#login-user').fill(fixture.username);await page.locator('#login-pin').fill(fixture.pin);await page.locator('#login-btn').click();
  await expect.poll(()=>page.evaluate(()=>typeof managedAccountSyncRuntime!=='undefined'&&managedAccountSyncRuntime?.projectionReady),{timeout:30000}).toBe(true);
  await expect(page.locator('#app')).toBeVisible();
}
async function settled(page){await expect.poll(()=>page.evaluate(async()=>{await managedAccountSyncRuntime.controller.drain();const state=await managedAccountSyncRuntime.snapshot();return state.pendingCount+state.blockedCount+state.conflictCount;})).toBe(0);}
async function account(fixture){return(await adminData('GET',`accountSync/${fixture.uid}`)).value;}

test('returning ordinary login migrates wants, preserves Favorite evidence and permits acknowledged edit/remove across restored login',async({page,browser})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await settled(page);
  expect(await page.evaluate(()=>allData.users[cur]?.isAdmin===true)).toBe(false);
  const evidence=await page.evaluate(()=>({authority:accountSyncProjectionReady(),state:accountSyncUiState.state,local:allData,history:ensureTrainerHistoryStore().read(),raw:localStorage.getItem(ensureTrainerHistoryStore().retainedKey)}));
  expect(evidence.authority).toBe(true);expect(evidence.state).toBe('review-required');
  expect(evidence.local.users[fixture.other]).toBeUndefined();expect(evidence.local.authIndex[fixture.targetUid]).toBeUndefined();
  expect(evidence.history.favorites).toHaveLength(0);expect(JSON.parse(evidence.raw).snapshots[fixture.other.toLowerCase()]).toEqual(fixture.history.snapshots[fixture.other.toLowerCase()]);
  const initial=await account(fixture),candidate=Object.values(initial.recoveryCandidates)[0];
  expect(candidate.values.displayName).toBe(fixture.other);expect(Object.keys(candidate.values.tagIds)).toHaveLength(1);
  await page.evaluate(()=>{switchTab('trainers');focusTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});
  await expect(page.locator('[data-preserved-favorites]')).toContainText(fixture.other);await expect(page.locator('[data-preserved-favorites]')).toContainText('Nearby');
  await page.evaluate(()=>{switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#combined-priority').selectOption('M');await page.locator('#combined-save').click();await settled(page);
  await expect(page.locator('#combined-editor-modal')).toBeHidden();
  expect(Object.values((await account(fixture)).tradeEntries).find(e=>!e.deleted).values.priority).toBe('M');
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>typeof managedAccountSyncRuntime!=='undefined'&&managedAccountSyncRuntime?.projectionReady),{timeout:30000}).toBe(true);
  await settled(page);expect(await page.evaluate(()=>auth.currentUser.uid)).toBe(fixture.uid);
  expect(Object.keys((await account(fixture)).migrations)).toEqual(Object.keys(initial.migrations));
  await page.evaluate(()=>{switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#wants-remove').click();await settled(page);
  expect(Object.values((await account(fixture)).tradeEntries).every(e=>e.deleted)).toBe(true);
  const second=await browser.newContext({serviceWorkers:'block'}),otherPage=await second.newPage();
  try{await routeEmulators(otherPage,fixture,{legacy:false});await login(otherPage,fixture);await settled(otherPage);expect(await otherPage.evaluate(()=>productDeclarations().entries.some(e=>e.name==='Pikachu'))).toBe(false);}
  finally{await second.close();}
});

test('pending journal survives a page restart and ordinary listener recovery while an unrelated Favorite needs review',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await settled(page);
  const migrations=Object.keys((await account(fixture)).migrations);
  await page.evaluate(()=>{window.__incidentRejectWrites=true;switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));});
  await page.locator('#combined-priority').selectOption('L');await page.locator('#combined-save').click();
  await expect(page.locator('#combined-editor-modal')).toBeHidden();
  await expect.poll(()=>page.evaluate(async()=>(await managedAccountSyncRuntime.snapshot()).pendingCount)).toBe(1);
  expect(Object.values((await account(fixture)).tradeEntries)[0].values.priority).toBe('H');
  await page.reload();await expect.poll(()=>page.evaluate(()=>typeof managedAccountSyncRuntime!=='undefined'&&managedAccountSyncRuntime?.projectionReady),{timeout:30000}).toBe(true);await settled(page);
  expect(Object.values((await account(fixture)).tradeEntries)[0].values.priority).toBe('L');
  expect(Object.keys((await account(fixture)).migrations)).toEqual(migrations);
  await page.evaluate(()=>window.__incidentListenerFailure(Object.assign(new Error('transient transport loss'),{code:'account-sync/network-failed'})));
  await expect.poll(()=>page.evaluate(()=>accountSyncUiState.listenerHealthy)).toBe(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>page.evaluate(()=>accountSyncProjectionReady()),{timeout:30000}).toBe(true);await settled(page);
  expect(Object.keys((await account(fixture)).migrations)).toEqual(migrations);
});

test('new Favorites fail under real own-account reads without creating a local success or private read',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await settled(page);
  await page.evaluate(other=>toggleTrainerFavorite(other),fixture.other);
  await expect(page.locator('#toast')).toContainText('account identity is unavailable');
  expect((await account(fixture)).favorites||{}).toEqual({});
  expect(await page.evaluate(other=>ensureTrainerHistoryStore().isFavorite(other),fixture.other)).toBe(false);
  // Shared-list action calls the same mutation; public content is not identity proof.
  await page.evaluate(other=>{_activeShareView={username:other,type:'wishlist'};return toggleTrainerFavorite(other);},fixture.other);
  expect((await account(fixture)).favorites||{}).toEqual({});
});

test('retryable admission and App Check failures retain the open draft until an acknowledged retry',async({page})=>{
  const fixture=await seed();await routeEmulators(page,fixture);await login(page,fixture);await settled(page);
  await page.evaluate(()=>{switchTab('mylist');openCombinedEditor(combinedGroups().findIndex(group=>group[0].name==='Pikachu'));window.__incidentGet=get;get=async()=>{throw Object.assign(new Error('transport unavailable'),{code:'account-sync/network-failed'});};});
  await page.locator('#combined-priority').selectOption('L');await page.locator('#combined-save').click();
  await expect(page.locator('#combined-error')).toContainText('draft is still here');await expect(page.locator('#combined-priority')).toHaveValue('L');
  expect(Object.values((await account(fixture)).tradeEntries)[0].values.priority).toBe('H');
  await page.evaluate(()=>{get=window.__incidentGet;});await page.locator('#combined-save').click();await settled(page);
  expect(Object.values((await account(fixture)).tradeEntries)[0].values.priority).toBe('L');
  await page.evaluate(()=>{window.__incidentAppCheckFailed=true;firebaseDataProtectionReady=false;firebaseDataProtectionPromise=null;});
  expect(await page.evaluate(()=>recoverAccountSyncAfterReconnect().then(()=>false,()=>true))).toBe(true);
  await page.evaluate(()=>{window.__incidentAppCheckFailed=false;});await page.evaluate(()=>recoverAccountSyncAfterReconnect());await settled(page);
  expect(await page.evaluate(()=>auth.currentUser.uid)).toBe(fixture.uid);
});

for(const entryPoint of ['Trainers','shared list'])test(`existing canonical Favorite removal from ${entryPoint} is acknowledged under own-account reads`,async({page})=>{
  const fixture=await seed();
  const vm=require('node:vm'),{webcrypto}=require('node:crypto'),window={crypto:webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  const context=vm.createContext({window,Uint8Array,unescape,encodeURIComponent});
  for(const name of ['accountSyncModel','accountSyncMerge'])vm.runInContext(fs.readFileSync(path.join(root,'js/domain',name+'.js'),'utf8'),context);
  const operation=await window.PogoDomain.accountSyncModel.createOperation({ownerUid:fixture.uid,entityType:'favorite',entityId:fixture.targetUid,identity:{targetUid:fixture.targetUid},kind:'add',patch:{displayName:fixture.other},baseGeneration:0,generation:1,baseFieldRevisions:{displayName:0},clientAt:1},{crypto:webcrypto});
  expect(operation.ok).toBe(true);
  const entity=window.PogoDomain.accountSyncMerge.mergeOperation(null,operation.value,{acceptedAt:1}).value;
  expect((await adminData('PUT',`accountSync/${fixture.uid}/favorites/${fixture.targetUid}`,entity)).status).toBe(200);
  await routeEmulators(page,fixture,{legacy:false});await login(page,fixture);await settled(page);
  expect(await page.evaluate(other=>ensureTrainerHistoryStore().isFavorite(other),fixture.other)).toBe(true);
  page.on('dialog',dialog=>dialog.accept());
  await page.evaluate(({other,entryPoint})=>{if(entryPoint==='shared list')_activeShareView={username:other,type:'wishlist'};else switchTab('trainers');return toggleTrainerFavorite(other);},{other:fixture.other,entryPoint});
  await settled(page);expect((await account(fixture)).favorites[fixture.targetUid].deleted).toBe(true);
  await page.reload();await expect.poll(()=>page.evaluate(()=>typeof managedAccountSyncRuntime!=='undefined'&&managedAccountSyncRuntime?.projectionReady),{timeout:30000}).toBe(true);
  expect(await page.evaluate(other=>ensureTrainerHistoryStore().isFavorite(other),fixture.other)).toBe(false);
});
