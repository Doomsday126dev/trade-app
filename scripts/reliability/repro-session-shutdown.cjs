// Synthetic transport only. No network or Firebase credentials.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const {webcrypto}=require('node:crypto');const root=path.resolve(__dirname,'../..');
(async()=>{
 const window={crypto:webcrypto,btoa:v=>Buffer.from(v,'binary').toString('base64')},ctx=vm.createContext({window,console,setTimeout,clearTimeout,queueMicrotask,Uint8Array,unescape,encodeURIComponent});
 for(const f of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncController.js','js/testing/accountSyncHarness.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
 const api=window.PogoTesting.accountSyncHarness,owner='uid-owner',state=api.createMemoryJournalState(),journal=api.createMemoryJournal(owner,state),server=api.createDeterministicServer({ownerUid:owner});
 let release,entered;const barrier=new Promise(r=>release=r),started=new Promise(r=>entered=r);let hold=true;
 const repository={...server,async applyOperation(op){if(hold){entered();await barrier;}return server.applyOperation(op);}};
 const make=()=>window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:owner,enabled:true,writesEnabled:true,admitted:true,onProjection:async()=>({ok:true,status:'published'}),crypto:webcrypto});
 const c=make();await c.activate();await c.waitForListenerReady();
 const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=window.PogoDomain.accountSyncModel.tradeEntryId(identity);
 assert.equal((await c.addEntity({entityType:'tradeEntry',entityId,identity,values:{priority:'H'}})).ok,true);await started;
 const stopping=c.deactivate();let closed=false;stopping.then(()=>closed=true);
 await new Promise(r=>setTimeout(r,250));assert.equal(closed,false);assert.equal((await c.snapshot()).active,false);
 console.log(JSON.stringify({finding:'shutdown-waits-for-unresolved-transport',after250ms:{sessionDetached:true,stopCompleted:closed,pending:(await journal.snapshot()).pendingCount}}));
 hold=false;release();await stopping;
 const next=make();await next.activate();await next.waitForListenerReady();await next.drain();
 assert.equal(server.entities.size,1);assert.equal((await next.snapshot()).pendingCount,0);assert.equal((await next.snapshot()).state,'saved');await next.deactivate();
 console.log(JSON.stringify({afterLateAcknowledgement:{stopCompleted:true,reopenedState:'saved',serverEntities:server.entities.size,idempotencyPreserved:true}}));
})().catch(e=>{console.error(e);process.exitCode=1;});
