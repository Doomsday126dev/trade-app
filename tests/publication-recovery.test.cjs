const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=4000){const start=Date.now();while(!await fn()){if(Date.now()-start>ms)throw Error('condition timed out');await sleep(10);}}
function setup(writer,{state,online=true}={}){
 const window={crypto:webcrypto,navigator:{onLine:online}};
 const context=vm.createContext({window,console,setTimeout,clearTimeout,queueMicrotask,Uint8Array,unescape,encodeURIComponent});
 for(const f of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncController.js','js/testing/accountSyncHarness.js'])vm.runInContext(fs.readFileSync(f,'utf8'),context);
 const api=window.PogoTesting.accountSyncHarness,owner='uid-owner';state=state||api.createMemoryJournalState();
 const journal=api.createMemoryJournal(owner,state),base=api.createDeterministicServer({ownerUid:owner});let listener;
 const repository={...base,listenAccount(h){listener=h;return base.listenAccount(h);}};
 const controller=window.PogoData.accountSyncController.createAccountSyncController({journal,repository,ownerUid:owner,enabled:true,writesEnabled:true,admitted:true,online:()=>window.navigator.onLine,onProjection:writer,crypto:webcrypto});
 return {controller,journal,state,window,async start(){await controller.activate();await controller.waitForListenerReady();},reconnect(){window.navigator.onLine=true;listener.onData(base.snapshot());}};
}
test('normal publication confirms promptly and clears durable pending marker',async()=>{
 const h=setup(async()=>({ok:true,status:'published'}));await h.start();
 assert.equal((await h.controller.publishAcceptedProjection()).ok,true);assert.equal((await h.controller.snapshot()).lastProjectionError,'');assert.equal(await h.journal.getMeta('public-publication-pending-v1'),null);await h.controller.deactivate();
});
test('transient failure automatically converges in seconds without another edit',async()=>{
 let calls=0;const h=setup(async()=>{if(++calls===1)throw Error('temporary transport failure');return {ok:true,status:'published'};});await h.start();
 await h.controller.publishAcceptedProjection();assert.ok((await h.controller.snapshot()).lastProjectionError);assert.equal((await h.controller.snapshot()).pendingCount,0);
 await until(async()=>calls===2&&!(await h.controller.snapshot()).lastProjectionError);assert.equal(await h.journal.getMeta('public-publication-pending-v1'),null);await h.controller.deactivate();
});
test('offline retry pauses, reconnect resumes, and stopped sessions never publish',async()=>{
 let calls=0,fail=true;const h=setup(async()=>{calls++;if(fail)throw Error('offline');return {ok:true,status:'published'};});await h.start();await h.controller.publishAcceptedProjection();h.window.navigator.onLine=false;await sleep(1100);assert.equal(calls,1);
 fail=false;h.reconnect();await until(async()=>calls===2&&!(await h.controller.snapshot()).lastProjectionError);await h.controller.deactivate();await sleep(1100);assert.equal(calls,2);
});
test('failed publication survives runtime restart without retaining stale public rows',async()=>{
 const first=setup(async()=>{throw Error('network failure');});await first.start();await first.controller.publishAcceptedProjection();await first.controller.deactivate();assert.deepEqual(Object.keys(await first.journal.getMeta('public-publication-pending-v1')).sort(),['ownerUid','pending','schemaVersion']);
 let calls=0;const next=setup(async()=>{calls++;return{ok:true,status:'published'};},{state:first.state});await next.start();assert.ok((await next.controller.snapshot()).lastProjectionError);await until(async()=>calls===1&&!(await next.controller.snapshot()).lastProjectionError);await next.controller.deactivate();
});
test('slow concurrent requests coalesce and never claim success before acknowledgement',async()=>{
 let release,calls=0;const barrier=new Promise(r=>release=r);const h=setup(async()=>{calls++;if(calls===1)await barrier;return{ok:true,status:'published'};});await h.start();const first=h.controller.publishAcceptedProjection();await until(()=>calls===1);const second=h.controller.publishAcceptedProjection();assert.equal(first,second);assert.ok((await h.controller.snapshot()).lastProjectionError);release();await first;assert.equal(calls,2);assert.equal((await h.controller.snapshot()).lastProjectionError,'');await h.controller.deactivate();
});
test('real outages retain an honest durable error and back off',async()=>{
 let calls=0;const h=setup(async()=>{calls++;throw Object.assign(Error('permission denied'),{code:'PERMISSION_DENIED'});});await h.start();await h.controller.publishAcceptedProjection();await sleep(1200);assert.equal(calls,2);assert.equal((await h.controller.snapshot()).lastProjectionError,'PERMISSION_DENIED');assert.equal((await h.journal.getMeta('public-publication-pending-v1')).pending,true);await h.controller.deactivate();
});
