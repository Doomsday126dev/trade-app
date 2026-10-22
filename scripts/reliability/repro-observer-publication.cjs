// Controller-level recovery diagnostic. Synthetic accounts and transport only.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const {webcrypto}=require('node:crypto');const root=path.resolve(__dirname,'../..');
(async()=>{
 const window={crypto:webcrypto,btoa:v=>Buffer.from(v,'binary').toString('base64')},ctx=vm.createContext({window,console,setTimeout,clearTimeout,queueMicrotask,Uint8Array,unescape,encodeURIComponent});
 for(const f of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncController.js','js/testing/accountSyncHarness.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
 const api=window.PogoTesting.accountSyncHarness,owner='uid-owner',server=api.createDeterministicServer({ownerUid:owner});let publicRows=[],observerCalls=0;
 const make=onProjection=>window.PogoData.accountSyncController.createAccountSyncController({journal:api.createMemoryJournal(owner),repository:server,ownerUid:owner,enabled:true,writesEnabled:true,admitted:true,onProjection,crypto:webcrypto});
 const observer=make(async rows=>{observerCalls++;publicRows=rows;return {ok:true,status:'published'};});
 const writer=make(async()=>{throw Object.assign(Error('writer transport unavailable'),{code:'network/offline'});});
 for(const c of [observer,writer]){await c.activate();await c.waitForListenerReady();}
 await observer.publishAcceptedProjection();const callsBefore=observerCalls;
 const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=window.PogoDomain.accountSyncModel.tradeEntryId(identity);
 assert.equal((await writer.addEntity({entityType:'tradeEntry',entityId,identity,values:{priority:'H'}})).ok,true);await writer.drain();
 assert.ok((await writer.snapshot()).lastProjectionError);await writer.deactivate();
 await new Promise(r=>setTimeout(r,1200));
 const state=await observer.snapshot();assert.equal(state.state,'saved');assert.equal(state.lastProjectionError,'');assert.equal(observerCalls,callsBefore+1);assert.equal(server.entities.size,1);assert.equal(publicRows.length,1);
 console.log(JSON.stringify({finding:'healthy-observer-recovers-departed-writer-publication',scope:'controller fixture; not a live browser reproduction',serverEntities:server.entities.size,observerState:state.state,observerPublicationError:state.lastProjectionError,observerRepublished:true,publicRows:publicRows.length}));
 await observer.deactivate();
})().catch(e=>{console.error(e);process.exitCode=1;});
