const {expect}=require('@playwright/test');

// Synthetic service boundary; the editor, authority, controller, journal,
// repository and projection are the application's unmodified implementations.
// Also serialized by the local-only interactive review launcher.
async function seedWantEditor(saved){
  managedSubscriptions.unsubscribeAll?.();managedListenerLifecycle.deactivateSession('want-editor-fixture');managedOwnedDataCoordinator?.reset();
  await stopAccountSyncRuntime();
  const uid='want-editor-local-uid',username='LocalTrainer';
  const original={lf:[],ft:[{name:'Eevee',no:133,qty:2,note:'Untouched offering'}]};
  const remote=saved||{authIndex:{[uid]:{username}},users:{[username]:{authUid:uid,specialTradeBoard:original}},wishlist:{[username]:{Pikachu:'H',Psyduck:'',Rotom:'M'}},dynamax:{[username]:{}},gmax:{[username]:{}},costumes:{[username]:{}}};
  const listeners=new Set(),writes=[],reads=[],clone=v=>v==null?null:structuredClone(v);
  const read=path=>path.split('/').reduce((v,k)=>v?.[k],remote)??null;
  const snapshot=path=>({val:()=>clone(read(path)),exists:()=>read(path)!=null});
  const put=(path,value)=>{const parts=path.split('/'),last=parts.pop();let parent=remote;for(const part of parts)parent=parent[part]??={};parent[last]=clone(value);};
  window.__editorFixture={remote,writes,reads,original,holdReads:false,readWaiters:[],offline:false};
  ref=(_db,path)=>path;serverTimestamp=()=>Date.now();
  get=async path=>{reads.push(path);if(__editorFixture.holdReads)await new Promise(resolve=>__editorFixture.readWaiters.push(resolve));return snapshot(path);};
  onValue=(path,onData)=>{const item={path,onData};listeners.add(item);queueMicrotask(()=>onData(snapshot(path)));return()=>listeners.delete(item);};
  runTransaction=async(path,fn,options)=>{
    if(!path.startsWith(`accountSync/${uid}/`)&&!path.startsWith(`authIndex/${uid}/accountSyncRecoveryReviews/`))throw Error(`Unexpected transaction: ${path}`);
    if(options?.applyLocally!==false)throw Error('Unverified local transaction');
    if(__editorFixture.offline)throw Object.assign(Error('Synthetic transport offline'),{code:'NETWORK_ERROR'});
    const next=fn(clone(read(path)));if(next===undefined)return{committed:false,snapshot:snapshot(path)};
    writes.push(path);put(path,next);for(const item of listeners)item.onData(snapshot(item.path));return{committed:true,snapshot:snapshot(path)};
  };
  set=async(path,value)=>{if(path!==`publicShares/${username}`)throw Error(`Unexpected write: ${path}`);writes.push(path);put(path,value);};
  update=async()=>{throw Error('Unexpected legacy update');};
  auth={currentUser:{uid}};cur=username;currentAuthUid=uid;_authStateKnown=true;firebaseDataProtectionReady=true;db={};fbOn=true;activeCanonicalIdentity=null;
  activateOwnedSession(uid,username);
  if(!saved){allData=normalizeData(clone(remote));saveLocal(allData);}
  for(const surface of publicSharePublicationDomain.REQUIRED_SOURCE_SURFACES)managedPublicSharePublication.markLoaded(activePublicShareHydrationToken,surface);
  _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded',have:'loaded'};
  document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
  document.getElementById('my-un').textContent=username;switchTab('mylist',{render:false});
  const started=await ensureAccountSyncRuntime();renderMyList();setSyncStatus('online');return started;
}
async function install(page,saved=null){
  await page.route(/(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com)/,r=>r.abort());
  await page.goto('./?want-editor-local');
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('want-editor-local'));
  await page.waitForFunction(()=>typeof ensureAccountSyncRuntime==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!=null);
  expect((await page.evaluate(seedWantEditor,saved)).ok).toBe(true);await settled(page);
}
async function settled(page){await expect.poll(()=>page.evaluate(async()=>{await managedAccountSyncRuntime.controller.drain();return(await managedAccountSyncRuntime.snapshot()).state;})).toBe('saved');}
async function addDialog(page,name=''){await page.locator('#wants-add-name').fill(name);await page.locator('.wants-add-form button[onclick="openWantsAddEditor()"] ').click();await expect(page.locator('#combined-editor-modal')).toBeVisible();}
async function edit(page,name){await page.locator('#combined-list .wants-row').filter({has:page.locator(`.wants-name[data-group]`,{hasText:new RegExp(`^${name}$`)})}).first().locator('.myrow-edit').click();await expect(page.locator('#combined-editor-title')).toHaveText('Edit want');}
async function priority(page,value){await page.locator(`#combined-priorities input[value="${value}"]`).check();}
async function entities(page){return page.evaluate(()=>structuredClone(accountSyncCanonicalEntities));}
module.exports={seedWantEditor,install,settled,addDialog,edit,priority,entities};
