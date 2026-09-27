const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const {buildArtifact,artifactDigest}=require('../scripts/pages/build-artifact.cjs');
const {validateReleaseCoherence}=require('../scripts/pages/validate-release.cjs');

const ROOT=path.resolve(__dirname,'..');
const OLD_TAG='release-2026-09-23.123';
const OLD_SHA='62482523588e5f7a3065936c93bfa043d4d31fb5';
const NEW_ID='2026-09-27.124';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};

function git(...args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();}
function verifyTaggedSource(source){
  const tree=execFileSync('git',['ls-tree','-r','-z',OLD_TAG],{cwd:ROOT});
  for(const entry of tree.toString('utf8').split('\0').filter(Boolean)){
    const [metadata,relative]=entry.split('\t');
    const [mode,type,expected]=metadata.split(' ');
    if(type!=='blob')continue;
    const filename=path.join(source,relative);
    const bytes=mode==='120000'?Buffer.from(fs.readlinkSync(filename)):fs.readFileSync(filename);
    const actual=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(actual,`Immutable .123 source mismatch: ${relative}`).toBe(expected);
  }
}
function makeBuilds(){
  expect(git('rev-parse',`${OLD_TAG}^{commit}`)).toBe(OLD_SHA);
  const parent=process.env.RELEASE_CLOSEOUT_EVIDENCE_DIR||os.tmpdir();
  fs.mkdirSync(parent,{recursive:true});
  const run=fs.mkdtempSync(path.join(parent,'cache-upgrade-'));
  let oldRoot=path.join(run,'source-123');
  const newRoot=path.join(run,'artifact-124');
  if(process.env.RELEASE_CLOSEOUT_OLD_SOURCE){
    oldRoot=process.env.RELEASE_CLOSEOUT_OLD_SOURCE;
  }else{
    fs.mkdirSync(oldRoot);
    const archive=execFileSync('git',['archive','--format=tar',OLD_TAG],{cwd:ROOT,maxBuffer:64*1024*1024});
    const extracted=spawnSync('tar',['-x','-C',oldRoot],{input:archive,maxBuffer:64*1024*1024});
    if(extracted.status!==0)throw new Error(`Could not extract verified .123 source: ${extracted.stderr}`);
  }
  verifyTaggedSource(oldRoot);
  const head=git('rev-parse','HEAD');
  let artifactSource=ROOT;
  if(process.env.RELEASE_CLOSEOUT_SOURCE_ARTIFACT){
    artifactSource=process.env.RELEASE_CLOSEOUT_SOURCE_ARTIFACT;
    const release=validateReleaseCoherence(artifactSource,{expectedReleaseId:NEW_ID});
    const manifest=JSON.parse(fs.readFileSync(path.join(artifactSource,'deployment-manifest.json'),'utf8'));
    expect(artifactDigest(artifactSource,release.files)).toBe(manifest.artifact_digest);
    const changed=[...new Set([
      ...git('diff','--name-only',manifest.source_sha,head).split('\n'),
      ...git('diff','--name-only',head).split('\n'),
      ...git('diff','--cached','--name-only').split('\n')
    ].filter(Boolean))];
    expect(changed.filter(file=>release.files.includes(file)),
      'Prebuilt input must match every current frontend source path').toEqual([]);
  }
  const built=buildArtifact({source:artifactSource,output:newRoot,runtimeSourceSha:head,runtimeReleaseId:NEW_ID,
    runtimeReleaseTag:`release-${NEW_ID}`,controlSelectorTag:`release-pages-control-${head}`,
    dispatcherSha:head,githubRunId:'0',controlWorkflowSha:'79be0d2dc7ef943fa7661ecd62ba33ba08d5ca52'});
  return{run,oldRoot,newRoot,head,built};
}
async function startSwitchableServer(roots){
  let current='old',offline=false,failedRequired=null,failedAssetRequests=0;
  const server=http.createServer((req,res)=>{
    if(offline){req.socket.destroy();return;}
    let relative,url;
    try{url=new URL(req.url,'http://127.0.0.1');relative=decodeURIComponent(url.pathname).replace(/^\/trade-app\//,'');}
    catch{res.writeHead(400).end();return;}
    if(relative.startsWith('/')||relative.split('/').includes('..')){res.writeHead(400).end();return;}
    if(current==='new'&&relative===failedRequired&&url.searchParams.get('v')===NEW_ID){
      failedAssetRequests++;res.writeHead(503).end('Synthetic required-asset failure');return;
    }
    const file=path.join(current==='old'?roots.oldRoot:roots.newRoot,relative||'index.html');
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream',
      'Content-Length':fs.statSync(file).size,
      'Cache-Control':'no-store',
      'Last-Modified':current==='old'?'Wed, 23 Sep 2026 00:00:00 GMT':'Sun, 27 Sep 2026 00:00:00 GMT'});
    if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{origin:`http://127.0.0.1:${server.address().port}`,switchToNew:()=>{current='new';},
    failRequired:relative=>{failedRequired=relative;},failureCount:()=>failedAssetRequests,
    setOffline:value=>{offline=value;},close:()=>new Promise(resolve=>server.close(resolve))};
}
async function waitForShell(page,id){
  await expect.poll(()=>page.evaluate(async release=>{
    const registration=await navigator.serviceWorker.getRegistration();
    const names=await caches.keys();
    return Boolean(registration?.active?.scriptURL.includes(`v=${release}`)&&
      navigator.serviceWorker.controller?.scriptURL.includes(`v=${release}`)&&
      names.includes(`shell-pogo-trades-${release}`));
  },id),{timeout:30000}).toBe(true);
}
async function loadApp(page){
  await page.evaluate(()=>window.__pogoEnsureFullApp('isolated-cache-upgrade'));
  await page.waitForFunction(()=>typeof checkForUpdate==='function');
  await page.evaluate(()=>checkForUpdate());
}
async function readRetainedState(page){
  return page.evaluate(async()=>{
    const local=Object.fromEntries(['pogoSessionCache_v2','pogoSyncQueue_v2','pogoTheme','pogoUiLocale:v1'].map(key=>[key,localStorage.getItem(key)]));
    const indexedDraft=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('synthetic-upgrade-pending');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const transaction=request.result.transaction('drafts','readonly');
        const read=transaction.objectStore('drafts').get('note');
        read.onsuccess=()=>{request.result.close();resolve(read.result);};
        read.onerror=()=>reject(read.error);
      };
    });
    const names=await caches.keys();
    const unrelated=names.includes('unrelated-synthetic-tool-cache')?
      await(await caches.open('unrelated-synthetic-tool-cache')).match('./unrelated-fixture'):null;
    return{local,session:sessionStorage.getItem('syntheticUpgradeDraft'),indexedDraft,
      unrelatedCache:unrelated?await unrelated.text():null};
  });
}
async function exerciseNewHandlers(page){
  await page.waitForFunction(()=>window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(()=>{
    managedListenerLifecycle?.deactivateSession?.('synthetic-upgrade');
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;
    cur='UpgradeTrainer';
    auth={currentUser:{uid:'synthetic-upgrade-uid',providerData:[]}};
    currentAuthUid='synthetic-upgrade-uid';_authStateKnown=true;
    allData=normalizeData({users:{UpgradeTrainer:{authUid:'synthetic-upgrade-uid'}},
      wishlist:{UpgradeTrainer:{Pikachu:'H'}},dynamax:{UpgradeTrainer:{}},gmax:{UpgradeTrainer:{}},costumes:{UpgradeTrainer:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';
    document.getElementById('app').style.display='flex';
    switchTab('mylist',{render:false});renderMyList();
  });
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(1);
  await page.locator('#tab-mylist button[onclick^="openProductShare"]').click();
  await expect(page.locator('#product-share-modal')).toHaveClass(/open/);
  await expect(page.locator('#product-share-preview')).toContainText('Pikachu');
  await page.locator('#product-share-modal .share-close').click();
  await page.locator('#combined-list .wants-name').click();
  await expect(page.locator('#combined-editor-modal')).toHaveClass(/open/);
  await expect(page.locator('#combined-name')).toHaveValue('Pikachu');
  await page.locator('#combined-close').click();
  await page.locator('#nav-more').click();
  await page.locator('#more-settings').click();
  await expect(page.locator('#settings-modal')).toHaveClass(/open/);
  await page.locator('[data-settings-target="appearance"]').click();
  await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible();
  await page.locator('#settings-modal .settings-modal-close').click();
  return{share:true,editor:true,more:true,settings:true};
}

let builds;
test.beforeAll(()=>{test.setTimeout(600000);builds=makeBuilds();});

test('populated .123 cache upgrades on one origin without losing protected local state',async({browser})=>{
  test.setTimeout(120000);
  const server=await startSwitchableServer(builds);
  const context=await browser.newContext({serviceWorkers:'allow'});
  const clean=await browser.newContext({serviceWorkers:'allow'});
  const lifecycle=[];
  async function snapshot(page,stage){
    lifecycle.push({at:Date.now(),stage,...await page.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration();
      return{caches:await caches.keys(),scope:registration?.scope,installing:registration?.installing?.scriptURL,
        waiting:registration?.waiting?.scriptURL,active:registration?.active?.scriptURL,
        controller:navigator.serviceWorker.controller?.scriptURL};
    })});
  }
  try{
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await clean.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const oldPage=await context.newPage(),refreshPage=await context.newPage();
    await oldPage.goto(`${server.origin}/trade-app/?old-dismiss`);
    await refreshPage.goto(`${server.origin}/trade-app/?old-refresh`);
    await waitForShell(oldPage,'2026-09-23.123');
    await waitForShell(refreshPage,'2026-09-23.123');
    await snapshot(refreshPage,'old-shell-ready');
    await loadApp(oldPage);await loadApp(refreshPage);
    await Promise.all([oldPage.waitForLoadState('networkidle'),refreshPage.waitForLoadState('networkidle')]);
    const seeded=await refreshPage.evaluate(async()=>{
      const owner={uid:'synthetic-upgrade-uid',username:'UpgradeTrainer'};
      const values={
        pogoSessionCache_v2:JSON.stringify({schemaVersion:2,public:{loginDirectory:{}},protected:{owner,data:{users:{UpgradeTrainer:{authUid:owner.uid,wallpaper:'ocean'}},wishlist:{UpgradeTrainer:{Pikachu:'H'}}}}}),
        pogoSyncQueue_v2:JSON.stringify({schemaVersion:2,owner,entries:{'wishlist/UpgradeTrainer/Bulbasaur':{kind:'set',path:'wishlist/UpgradeTrainer/Bulbasaur',data:'M',ts:Date.now()}},quarantined:{}}),
        pogoTheme:JSON.stringify('dark'),
        'pogoUiLocale:v1':'de'
      };
      for(const[key,value]of Object.entries(values))localStorage.setItem(key,value);
      sessionStorage.setItem('syntheticUpgradeDraft','Unsent synthetic draft');
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('synthetic-upgrade-pending',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const transaction=request.result.transaction('drafts','readwrite');
          transaction.objectStore('drafts').put('Retained synthetic note','note');
          transaction.oncomplete=()=>{request.result.close();resolve();};
          transaction.onerror=()=>reject(transaction.error);
        };
      });
      return values;
    });
    await refreshPage.evaluate(async()=>{
      const cache=await caches.open('unrelated-synthetic-tool-cache');
      await cache.put('./unrelated-fixture',new Response('Do not delete unrelated cache'));
    });
    server.switchToNew();
    await oldPage.evaluate(()=>checkForUpdate());
    await refreshPage.evaluate(()=>checkForUpdate());
    await snapshot(refreshPage,'new-served-banner');
    await expect(oldPage.locator('#update-banner')).toBeVisible();
    await expect(refreshPage.locator('#update-banner')).toBeVisible();
    await oldPage.locator('.update-banner-dismiss').click();
    await expect(oldPage.locator('#update-banner')).toHaveCount(0);
    expect(await oldPage.evaluate(()=>window.__POGO_RELEASE_ID)).toBe('2026-09-23.123');
    await refreshPage.locator('.update-banner-btn').click();
    await refreshPage.waitForFunction(release=>window.__POGO_RELEASE_ID===release,NEW_ID);
    await snapshot(refreshPage,'new-html-loaded');
    await waitForShell(refreshPage,NEW_ID);
    await snapshot(refreshPage,'new-active-shell-ready');
    await expect.poll(()=>refreshPage.evaluate(async()=>!(await caches.keys()).includes('shell-pogo-trades-2026-09-23.123')),
      {timeout:30000}).toBe(true);
    await snapshot(refreshPage,'old-cache-first-absent');
    await refreshPage.evaluate(()=>window.__pogoEnsureFullApp('upgrade-handlers'));
    await snapshot(refreshPage,'full-app-loaded');
    const upgraded=await refreshPage.evaluate(()=>({
      release:window.__POGO_RELEASE_ID,client:window.PogoDomain?.clientRelease?.RELEASE_ID,
      css:document.querySelector('link[rel="stylesheet"]')?.href,
      handlers:['openProductShare','openMoreDestination','selectSettingsSection','openCombinedEditor'].map(name=>[name,typeof window[name]]),
      caches:null,
      local:Object.fromEntries(['pogoSessionCache_v2','pogoSyncQueue_v2','pogoTheme','pogoUiLocale:v1'].map(key=>[key,localStorage.getItem(key)]))
    }));
    upgraded.caches=await refreshPage.evaluate(()=>caches.keys());
    const oldShellEntries=await refreshPage.evaluate(async()=>{
      if(!(await caches.keys()).includes('shell-pogo-trades-2026-09-23.123'))return[];
      const cache=await caches.open('shell-pogo-trades-2026-09-23.123');
      return(await cache.keys()).map(request=>request.url);
    });
    const workerState=await refreshPage.evaluate(async()=>({active:(await navigator.serviceWorker.getRegistration())?.active?.scriptURL,
      controller:navigator.serviceWorker.controller?.scriptURL}));
    const retained=await readRetainedState(refreshPage);
    const actions=await exerciseNewHandlers(refreshPage);
    expect(await oldPage.evaluate(()=>window.__POGO_RELEASE_ID)).toBe('2026-09-23.123');
    await oldPage.locator('#login-language-trigger').click();
    await expect(oldPage.locator('#settings-modal')).toHaveClass(/open/);
    await oldPage.locator('#settings-modal .settings-modal-close').click();
    await snapshot(oldPage,'retained-old-tab-usable');
    const cleanPage=await clean.newPage();
    await cleanPage.goto(`${server.origin}/trade-app/?clean-client`);
    await waitForShell(cleanPage,NEW_ID);
    const cleanClient={release:await cleanPage.evaluate(()=>window.__POGO_RELEASE_ID),
      caches:await cleanPage.evaluate(()=>caches.keys())};
    await refreshPage.goto(`${server.origin}/trade-app/?after-upgrade`);
    await waitForShell(refreshPage,NEW_ID);
    const afterNavigation={release:await refreshPage.evaluate(()=>window.__POGO_RELEASE_ID),
      caches:await refreshPage.evaluate(()=>caches.keys()),retained:await readRetainedState(refreshPage)};
    server.setOffline(true);
    await refreshPage.goto(`${server.origin}/trade-app/?offline-shell`,{waitUntil:'domcontentloaded'});
    await waitForShell(refreshPage,NEW_ID);
    await refreshPage.evaluate(()=>window.__pogoEnsureFullApp('offline-upgrade-check'));
    const offline={release:await refreshPage.evaluate(()=>window.__POGO_RELEASE_ID),
      caches:await refreshPage.evaluate(()=>caches.keys()),retained:await readRetainedState(refreshPage),
      handler:await refreshPage.evaluate(()=>typeof window.openCombinedEditor)};
    server.setOffline(false);
    fs.writeFileSync(path.join(builds.run,'cache-observation.json'),JSON.stringify({candidateHead:builds.head,
      artifactDigest:builds.built.artifact_digest,oldTag:OLD_TAG,oldSha:OLD_SHA,
      dismissedOldPage:true,retainedOldTab:true,upgrade:upgraded,retained,actions,cleanClient,afterNavigation,offline,
      oldShellEntryCount:oldShellEntries.length,oldShellEntries,workerState,lifecycle},null,2));
    expect(upgraded.release).toBe(NEW_ID);expect(upgraded.client).toBe(NEW_ID);
    expect(upgraded.css).toContain(`v=${NEW_ID}`);
    expect(upgraded.handlers.every(([,kind])=>kind==='function')).toBe(true);
    expect(upgraded.local).toEqual(seeded);
    expect(retained).toEqual({local:seeded,session:'Unsent synthetic draft',
      indexedDraft:'Retained synthetic note',unrelatedCache:'Do not delete unrelated cache'});
    expect(upgraded.caches).toContain(`shell-pogo-trades-${NEW_ID}`);
    expect(upgraded.caches).not.toContain('shell-pogo-trades-2026-09-23.123');
    expect(cleanClient.release).toBe(NEW_ID);
    expect(cleanClient.caches).not.toContain('shell-pogo-trades-2026-09-23.123');
    expect(afterNavigation.release).toBe(NEW_ID);
    expect(afterNavigation.caches).not.toContain('shell-pogo-trades-2026-09-23.123');
    expect(afterNavigation.retained).toEqual(retained);
    expect(offline.release).toBe(NEW_ID);
    expect(offline.caches).not.toContain('shell-pogo-trades-2026-09-23.123');
    expect(offline.retained).toEqual(retained);
    expect(offline.handler).toBe('function');
    fs.writeFileSync(path.join(builds.run,'upgrade-result.json'),JSON.stringify({oldTag:OLD_TAG,oldSha:OLD_SHA,
      candidateHead:builds.head,artifactDigest:builds.built.artifact_digest,releaseId:NEW_ID,
      sameOrigin:server.origin,upgrade:upgraded,cleanClient:true},null,2));
    console.log(`Cache-upgrade evidence: ${builds.run}`);
  }finally{await clean.close();await context.close();await server.close();}
});

test('failed required .124 asset retains the complete usable .123 shell and pending state',async({browser})=>{
  test.setTimeout(120000);
  const server=await startSwitchableServer(builds);
  const context=await browser.newContext({serviceWorkers:'allow'});
  try{
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const oldPage=await context.newPage();
    await oldPage.goto(`${server.origin}/trade-app/?old-failure-client`);
    await waitForShell(oldPage,'2026-09-23.123');
    await loadApp(oldPage);
    await oldPage.waitForLoadState('networkidle');
    const pending=await oldPage.evaluate(async()=>{
      const values={pogoSessionCache_v2:'synthetic-protected-account-cache',
        pogoSyncQueue_v2:'synthetic-unsent-queue',pogoTheme:'"dark"'};
      for(const[key,value]of Object.entries(values))localStorage.setItem(key,value);
      const unrelated=await caches.open('unrelated-synthetic-tool-cache');
      await unrelated.put('./unrelated-fixture',new Response('Do not delete unrelated cache'));
      const registration=await navigator.serviceWorker.getRegistration();
      window.__installStates=[];
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        if(!worker)return;
        window.__installStates.push(worker.state);
        worker.addEventListener('statechange',()=>window.__installStates.push(worker.state));
      });
      return values;
    });
    server.failRequired('js/domain/clientRelease.js');
    server.switchToNew();
    const attemptedPage=await context.newPage();
    await attemptedPage.goto(`${server.origin}/trade-app/?required-asset-fails`,{waitUntil:'domcontentloaded'});
    await expect.poll(()=>server.failureCount(),{timeout:30000}).toBeGreaterThan(0);
    await expect.poll(()=>oldPage.evaluate(()=>window.__installStates.includes('redundant')),
      {timeout:30000}).toBe(true);
    const observed=await oldPage.evaluate(async pending=>{
      const registration=await navigator.serviceWorker.getRegistration();
      const names=await caches.keys();
      const oldName='shell-pogo-trades-2026-09-23.123';
      const oldEntries=names.includes(oldName)?
        (await(await caches.open(oldName)).keys()).map(request=>request.url):[];
      const unrelated=names.includes('unrelated-synthetic-tool-cache')?
        await(await caches.open('unrelated-synthetic-tool-cache')).match('./unrelated-fixture'):null;
      return{release:window.__POGO_RELEASE_ID,scope:registration.scope,
        active:registration.active?.scriptURL,controller:navigator.serviceWorker.controller?.scriptURL,
        installing:registration.installing?.scriptURL,waiting:registration.waiting?.scriptURL,
        states:window.__installStates,caches:names,oldShellEntryCount:oldEntries.length,
        requiredOldAssets:['index.html','css/app.css','js/app/application.js'].every(relative=>
          oldEntries.some(url=>url.endsWith(`${relative}?v=2026-09-23.123`))),
        local:Object.fromEntries(Object.keys(pending).map(key=>[key,localStorage.getItem(key)])),
        unrelatedCache:unrelated?await unrelated.text():null};
    },pending);
    await oldPage.locator('#login-language-trigger').click();
    await expect(oldPage.locator('#settings-modal')).toHaveClass(/open/);
    await oldPage.locator('#settings-modal .settings-modal-close').click();
    fs.writeFileSync(path.join(builds.run,'failed-install-observation.json'),JSON.stringify({candidateHead:builds.head,
      artifactDigest:builds.built.artifact_digest,failedAsset:'js/domain/clientRelease.js',
      failedAssetRequests:server.failureCount(),pending,observed,oldUiUsable:true},null,2));
    expect(observed.release).toBe('2026-09-23.123');
    expect(observed.active).toContain('v=2026-09-23.123');
    expect(observed.controller).toContain('v=2026-09-23.123');
    expect(observed.caches).toContain('shell-pogo-trades-2026-09-23.123');
    expect(observed.caches).not.toContain('shell-pogo-trades-2026-09-27.124');
    expect(observed.oldShellEntryCount).toBeGreaterThanOrEqual(90);
    expect(observed.requiredOldAssets).toBe(true);
    expect(observed.local).toEqual(pending);
    expect(observed.unrelatedCache).toBe('Do not delete unrelated cache');
  }finally{await context.close();await server.close();}
});
