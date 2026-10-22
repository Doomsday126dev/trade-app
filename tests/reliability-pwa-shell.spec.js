const {test,expect}=require('@playwright/test');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
test.use({serviceWorkers:'allow'});

test('real service worker reloads offline shell and preserves owner-bound pending intent',async({page})=>{
  // WebKit's automation offline switch fails navigation even for a minimal SW.
  // Closing local request sockets exercises actual fetch rejection in all engines.
  let networkDown=false,refusedRequests=0;
  const root=path.resolve(__dirname,'..'),types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
  const server=http.createServer(async(request,response)=>{
    if(networkDown){refusedRequests++;request.socket.destroy();return;}
    const requested=new URL(request.url,'http://local.test').pathname,file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));
    if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
    try{const body=await fs.readFile(file);response.writeHead(200,{
      'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store',
      // Test-server policy, not production CSP: a controlling worker must not
      // bypass page routes and start external Auth/attestation while offline.
      'content-security-policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self'"
    });response.end(body);}
    catch{response.writeHead(404);response.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  test.info().annotations.push({type:'outage-simulation',description:'Local HTTP sockets are refused; browser offline toggle is not used.'});
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
  await page.route(url=>!['localhost','127.0.0.1'].includes(url.hostname),route=>route.abort());
  await page.goto(origin+'/?reliability-pwa');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller),{timeout:30000}).toBe(true);
  const release=await page.evaluate(()=>window.__POGO_RELEASE_ID);
  const cached=await page.evaluate(async release=>{
    const shell=await caches.open(`shell-pogo-trades-${release}`),keys=(await shell.keys()).map(request=>request.url);
    return{index:!!await shell.match(`./index.html?v=${release}`),journal:!!await shell.match(`./js/data/accountSyncJournal.js?v=${release}`),keys};
  },release);
  expect(cached.index).toBe(true);expect(cached.journal).toBe(true);
  expect(cached.keys.every(url=>!/(firebaseio|firebasedatabase|firestore|identitytoolkit)/.test(url))).toBe(true);
  for(const file of ['js/domain/accountSyncModel.js','js/data/accountSyncJournal.js'])await page.addScriptTag({url:`./${file}?v=${release}`});
  const prepared=await page.evaluate(async()=>{
    const model=window.PogoDomain.accountSyncModel,databaseName='pwa-isolated-'+crypto.randomUUID(),ownerUid='pwa-safe-owner',journal=window.PogoData.accountSyncJournal.createAccountSyncJournal({ownerUid,databaseName});
    const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25:base'},entityId=model.tradeEntryId(identity);
    const operation=(await model.createOperation({ownerUid,entityType:'tradeEntry',entityId,identity,kind:'add',patch:{priority:'H'},baseGeneration:0,generation:1,baseFieldRevisions:{priority:0},clientAt:10})).value;
    await journal.enqueueOperation(operation);await journal.close();return{databaseName,ownerUid,operationId:operation.operationId,inputHash:operation.inputHash};
  });
  await page.evaluate(()=>{window.__pwaDocumentNonce=crypto.randomUUID();});
  networkDown=true;await page.reload({waitUntil:'domcontentloaded'});
  expect(refusedRequests).toBeGreaterThan(0);expect(await page.evaluate(()=>window.__pwaDocumentNonce)).toBeUndefined();
  await expect.poll(()=>page.evaluate(()=>window.__POGO_RELEASE_ID)).toBe(release);
  expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  const asset=await page.evaluate(async release=>{const response=await fetch(`./js/data/accountSyncRuntime.js?v=${release}`);return{ok:response.ok,body:await response.text()};},release);
  expect(asset.ok).toBe(true);expect(asset.body).toContain('createAccountSyncRuntime');
  for(const file of ['js/domain/accountSyncModel.js','js/data/accountSyncJournal.js'])await page.addScriptTag({url:`./${file}?v=${release}`});
  const recovered=await page.evaluate(async fixture=>{
    const api=window.PogoData.accountSyncJournal,owner=api.createAccountSyncJournal(fixture),other=api.createAccountSyncJournal({...fixture,ownerUid:'pwa-other-owner'});
    const own=await owner.snapshot(),different=await other.snapshot(),operation=(await owner.listOperations())[0];await owner.close();await other.close();
    return{own:own.pendingCount,other:different.pendingCount,operationId:operation.operationId,inputHash:operation.operation.inputHash};
  },prepared);
  expect(recovered).toEqual({own:1,other:0,operationId:prepared.operationId,inputHash:prepared.inputHash});
  networkDown=false;await page.reload({waitUntil:'domcontentloaded'});
  expect(await page.evaluate(()=>window.__POGO_RELEASE_ID)).toBe(release);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
