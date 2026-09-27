const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const {buildArtifact}=require('../scripts/pages/build-artifact.cjs');

const ROOT=path.resolve(__dirname,'..');
const OLD_TAG='release-2026-09-23.123';
const OLD_SHA='62482523588e5f7a3065936c93bfa043d4d31fb5';
const NEW_ID='2026-09-27.124';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};

function git(...args){return execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();}
function makeBuilds(){
  expect(git('rev-parse',`${OLD_TAG}^{commit}`)).toBe(OLD_SHA);
  const parent=process.env.RELEASE_CLOSEOUT_EVIDENCE_DIR||os.tmpdir();
  fs.mkdirSync(parent,{recursive:true});
  const run=fs.mkdtempSync(path.join(parent,'cache-upgrade-'));
  const oldRoot=path.join(run,'source-123'),newRoot=path.join(run,'artifact-124');
  fs.mkdirSync(oldRoot);
  const archive=execFileSync('git',['archive','--format=tar',OLD_TAG],{cwd:ROOT,maxBuffer:64*1024*1024});
  const extracted=spawnSync('tar',['-x','-C',oldRoot],{input:archive,maxBuffer:64*1024*1024});
  if(extracted.status!==0)throw new Error(`Could not extract verified .123 source: ${extracted.stderr}`);
  const head=git('rev-parse','HEAD');
  const built=buildArtifact({source:ROOT,output:newRoot,runtimeSourceSha:head,runtimeReleaseId:NEW_ID,
    runtimeReleaseTag:`release-${NEW_ID}`,controlSelectorTag:`release-pages-control-${head}`,
    dispatcherSha:head,githubRunId:'0',controlWorkflowSha:'79be0d2dc7ef943fa7661ecd62ba33ba08d5ca52'});
  return{run,oldRoot,newRoot,head,built};
}
async function startSwitchableServer(roots){
  let current='old';
  const server=http.createServer((req,res)=>{
    let relative;
    try{relative=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/trade-app\//,'');}
    catch{res.writeHead(400).end();return;}
    if(relative.startsWith('/')||relative.split('/').includes('..')){res.writeHead(400).end();return;}
    const file=path.join(current==='old'?roots.oldRoot:roots.newRoot,relative||'index.html');
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream',
      'Content-Length':fs.statSync(file).size,
      'Cache-Control':'no-store',
      'Last-Modified':current==='old'?'Wed, 23 Sep 2026 00:00:00 GMT':'Sun, 27 Sep 2026 00:00:00 GMT'});
    if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{origin:`http://127.0.0.1:${server.address().port}`,switchToNew:()=>{current='new';},close:()=>new Promise(resolve=>server.close(resolve))};
}
async function waitForShell(page,id){
  await page.waitForFunction(async release=>{
    const registration=await navigator.serviceWorker.ready;
    return registration.active?.scriptURL.includes(`v=${release}`)&&(await caches.keys()).includes(`shell-pogo-trades-${release}`);
  },id,{timeout:30000});
}
async function loadApp(page){
  await page.evaluate(()=>window.__pogoEnsureFullApp('isolated-cache-upgrade'));
  await page.waitForFunction(()=>typeof checkForUpdate==='function');
  await page.evaluate(()=>checkForUpdate());
}

test('populated .123 cache upgrades on one origin without losing protected local state',async({browser})=>{
  test.setTimeout(120000);
  const builds=makeBuilds(),server=await startSwitchableServer(builds);
  const context=await browser.newContext({serviceWorkers:'allow'});
  const dismiss=await browser.newContext({serviceWorkers:'allow'});
  const clean=await browser.newContext({serviceWorkers:'allow'});
  try{
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await dismiss.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await clean.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const oldPage=await dismiss.newPage(),refreshPage=await context.newPage();
    await oldPage.goto(`${server.origin}/trade-app/?old-dismiss`);
    await refreshPage.goto(`${server.origin}/trade-app/?old-refresh`);
    await waitForShell(oldPage,'2026-09-23.123');
    await waitForShell(refreshPage,'2026-09-23.123');
    await loadApp(oldPage);await loadApp(refreshPage);
    await Promise.all([oldPage.waitForLoadState('networkidle'),refreshPage.waitForLoadState('networkidle')]);
    const seeded=await refreshPage.evaluate(()=>{
      const owner={uid:'synthetic-upgrade-uid',username:'UpgradeTrainer'};
      const values={
        pogoSessionCache_v2:JSON.stringify({schemaVersion:2,public:{loginDirectory:{}},protected:{owner,data:{users:{UpgradeTrainer:{authUid:owner.uid,wallpaper:'ocean'}},wishlist:{UpgradeTrainer:{Pikachu:'H'}}}}}),
        pogoSyncQueue_v2:JSON.stringify({schemaVersion:2,owner,entries:{'wishlist/UpgradeTrainer/Bulbasaur':{kind:'set',path:'wishlist/UpgradeTrainer/Bulbasaur',data:'M',ts:Date.now()}},quarantined:{}}),
        pogoTheme:JSON.stringify('dark'),
        'pogoUiLocale:v1':'de'
      };
      for(const[key,value]of Object.entries(values))localStorage.setItem(key,value);
      return values;
    });
    server.switchToNew();
    await oldPage.evaluate(()=>checkForUpdate());
    await refreshPage.evaluate(()=>checkForUpdate());
    await expect(oldPage.locator('#update-banner')).toBeVisible();
    await expect(refreshPage.locator('#update-banner')).toBeVisible();
    await oldPage.locator('.update-banner-dismiss').click();
    await expect(oldPage.locator('#update-banner')).toHaveCount(0);
    expect(await oldPage.evaluate(()=>window.__POGO_RELEASE_ID)).toBe('2026-09-23.123');
    await oldPage.close();
    await refreshPage.locator('.update-banner-btn').click();
    await refreshPage.waitForFunction(release=>window.__POGO_RELEASE_ID===release,NEW_ID);
    await waitForShell(refreshPage,NEW_ID);
    await refreshPage.waitForFunction(async()=>!(await caches.keys()).includes('shell-pogo-trades-2026-09-23.123'));
    await refreshPage.evaluate(()=>window.__pogoEnsureFullApp('upgrade-handlers'));
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
    fs.writeFileSync(path.join(builds.run,'cache-observation.json'),JSON.stringify({candidateHead:builds.head,caches:upgraded.caches,
      oldShellEntryCount:oldShellEntries.length,oldShellEntries,workerState},null,2));
    expect(upgraded.release).toBe(NEW_ID);expect(upgraded.client).toBe(NEW_ID);
    expect(upgraded.css).toContain(`v=${NEW_ID}`);
    expect(upgraded.handlers.every(([,kind])=>kind==='function')).toBe(true);
    expect(upgraded.local).toEqual(seeded);
    expect(upgraded.caches).toContain(`shell-pogo-trades-${NEW_ID}`);
    expect(upgraded.caches).not.toContain('shell-pogo-trades-2026-09-23.123');
    const cleanPage=await clean.newPage();
    await cleanPage.goto(`${server.origin}/trade-app/?clean-client`);
    await waitForShell(cleanPage,NEW_ID);
    expect(await cleanPage.evaluate(()=>window.__POGO_RELEASE_ID)).toBe(NEW_ID);
    expect(await cleanPage.evaluate(()=>caches.keys())).not.toContain('shell-pogo-trades-2026-09-23.123');
    fs.writeFileSync(path.join(builds.run,'upgrade-result.json'),JSON.stringify({oldTag:OLD_TAG,oldSha:OLD_SHA,
      candidateHead:builds.head,artifactDigest:builds.built.artifact_digest,releaseId:NEW_ID,
      sameOrigin:server.origin,upgrade:upgraded,cleanClient:true},null,2));
    console.log(`Cache-upgrade evidence: ${builds.run}`);
  }finally{await clean.close();await dismiss.close();await context.close();await server.close();}
});
