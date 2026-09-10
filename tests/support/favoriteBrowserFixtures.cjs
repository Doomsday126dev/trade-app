const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.INCIDENT_SOURCE_ROOT||path.join(__dirname,'../..');
const project='demo-pogo-saving-incident',database='http://127.0.0.1:9500',authHost='http://127.0.0.1:9599';
const namespace=`${project}-default-rtdb`;



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
async function routeEmulators(page,fixture,{legacy=true,candidate=false,picker=false}={}){
  const origin=String(test.info().project.use.baseURL||'http://localhost:4174');
  if(page.context().browser()?.browserType().name()==='chromium')await page.context().grantPermissions(['local-network-access'],{origin});
  await page.route(url=>/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com)$/.test(url.hostname),route=>route.abort());
  if(candidate){
    expect((await adminData('PUT','.settings/rules',JSON.parse(fs.readFileSync(path.join(root,'tests/firebase/database.rules.favorite-resolver.json'),'utf8')))).status).toBe(200);
    await page.route('**/js/services/favoriteWriteTransport.js*',route=>{
      let source=fs.readFileSync(path.join(root,'js/services/favoriteWriteTransport.js'),'utf8');
      source=source.replace('https://trade-list-a4297-default-rtdb.firebaseio.com/.json','http://127.0.0.1:9500/.json?ns=demo-pogo-saving-incident-default-rtdb');
      source=source.replace('const response=await fetch(url.href,',"if(window.__incidentRejectWrites)throw failure('account-sync/network-failed');const response=await fetch(url.href,");
      return route.fulfill({contentType:'text/javascript',body:source});
    });
    await page.route('**/js/domain/favoriteCapabilities.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.PogoDomain.favoriteCapabilities=Object.freeze({resolverEnabled:true,pickerEnabled:${picker}});`}));
    await page.route('https://us-central1-trade-list-a4297.cloudfunctions.net/resolveLegacyFavoriteIdentities',async route=>{
      const headers=route.request().headers();headers.origin=origin;
      const response=await fetch('http://127.0.0.1:4198',{method:route.request().method(),headers,body:route.request().postData()});
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
    });
  }
  await page.route('**/js/app/application.js*',route=>{
    let source=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
    source=source.replace('getDatabase=dbMod.getDatabase;','getDatabase=dbMod.getDatabase;window.__incidentDbSdk=dbMod;');
    source=source.replace('runTransaction=dbMod.runTransaction;',"runTransaction=(...args)=>window.__incidentRejectWrites?Promise.reject(Object.assign(new Error('offline'),{code:'account-sync/network-failed'})):dbMod.runTransaction(...args);");
    source=source.replace('onValue=dbMod.onValue;',"onValue=(reference,onData,onError,...rest)=>{if(reference.toString().includes('/accountSync/'))window.__incidentListenerFailure=onError;return dbMod.onValue(reference,onData,onError,...rest);};");
    source=source.replace('firebaseDatabaseHandle=getDatabase(fbApp,url);',"firebaseDatabaseHandle=getDatabase(fbApp,url);window.__incidentDbSdk.connectDatabaseEmulator(firebaseDatabaseHandle,'127.0.0.1',9500);");
    source=source.replace('function startFirebaseAppCheck(', 'function unusedIncidentAppCheck(');
    source+='\nfunction startFirebaseAppCheck(){return Promise.resolve({ok:true,instance:{}});}\n';
    source=source.replace('function firebaseAppCheckReady(){',"function firebaseAppCheckReady(){if(window.__incidentAppCheckFailed)return Promise.resolve({ok:false,code:'app-check/network-failed'});return Promise.resolve({ok:true,instance:{}});");
    if(candidate){
      source=source.replace('update=dbMod.update;',"update=(...args)=>window.__incidentRejectWrites?Promise.reject(Object.assign(new Error('offline'),{code:'account-sync/network-failed'})):dbMod.update(...args);");
      source=source.replace('function loadFirebaseAppCheckSdk(', 'function unusedCandidateLoadAppCheckSdk(');
      source+='\nfunction loadFirebaseAppCheckSdk(){return Promise.resolve({getToken:async()=>({token:"simulated-rtdb-appcheck"}),getLimitedUseToken:async()=>{const response=await fetch(\'http://127.0.0.1:4198/__test/token\');return response.json();}}); }\n';
    }
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
async function settled(page){try{await expect.poll(()=>page.evaluate(async()=>{await managedAccountSyncRuntime.controller.drain();const state=await managedAccountSyncRuntime.snapshot();return state.pendingCount+state.blockedCount+state.conflictCount;})).toBe(0);}catch(error){console.log('Candidate sync failure',await page.evaluate(async()=>({state:await managedAccountSyncRuntime.snapshot(),additions:await managedFavoriteAdditions?.snapshot()})));throw error;}}
async function account(fixture){return(await adminData('GET',`accountSync/${fixture.uid}`)).value;}


module.exports={seed,routeEmulators,login,settled,account,adminData,request,dataUrl};
