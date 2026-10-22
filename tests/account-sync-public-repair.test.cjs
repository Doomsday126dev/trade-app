const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+4500;while(!await fn()){if(Date.now()>end)throw Error('repair did not converge');await sleep(10);}}
function barrier(){let release,entered;return{gate:new Promise(r=>release=r),waiting:new Promise(r=>entered=r),release:()=>release(),entered:()=>entered()};}
function setup({publish,allowed=true,online=true,rejectObserverWrites=false}={}){
 const window={crypto:webcrypto,navigator:{onLine:true},btoa:v=>Buffer.from(v,'binary').toString('base64')};
 const context=vm.createContext({window,console,setTimeout,clearTimeout,queueMicrotask,Uint8Array,unescape,encodeURIComponent});
 for(const f of ['js/domain/accountSyncModel.js','js/domain/accountSyncMerge.js','js/data/accountSyncController.js','js/testing/accountSyncHarness.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),context);
 const api=window.PogoTesting.accountSyncHarness,model=window.PogoDomain.accountSyncModel,owner='uid-owner',server=api.createDeterministicServer({ownerUid:owner}),journalState=api.createMemoryJournalState();
 const state={allowed,online,current:true,calls:[],published:[],listener:null};
 const journal=api.createMemoryJournal(owner,journalState);
 const make=(repository,extra={})=>window.PogoData.accountSyncController.createAccountSyncController({journal:api.createMemoryJournal(owner),repository,ownerUid:owner,enabled:true,writesEnabled:true,admitted:true,crypto:webcrypto,...extra});
 const repository={...server,async applyOperation(operation){if(rejectObserverWrites)throw Object.assign(Error('offline write'),{code:'account-sync/network-failed'});return server.applyOperation(operation);},listenAccount(handlers){state.listener=handlers;return server.listenAccount(handlers);}};
 const observer=make(repository,{journal,online:()=>state.online,sessionCurrent:()=>state.current,projectionAllowed:()=>state.allowed,onProjection:async(rows,operation)=>{
   state.calls.push({rows:JSON.parse(JSON.stringify(rows)),operation});
   if(publish)await publish(rows,state);
   state.published=JSON.parse(JSON.stringify(rows));return{ok:true,status:'published'};
 }});
 const writer=make(server);
 const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:pikachu'},entityId=model.tradeEntryId(identity);
 return{state,server,observer,writer,journal,journalState,identity,entityId,model,
   async start(){for(const c of [observer,writer]){await c.activate();await c.waitForListenerReady();}},
   async add(){assert.equal((await writer.addEntity({entityType:'tradeEntry',entityId,identity,values:{priority:'H'}})).ok,true);await writer.drain();await observer.waitForListenerReady();},
   async patch(priority){assert.equal((await writer.patchEntity({entityType:'tradeEntry',entityId,patch:{priority}})).ok,true);await writer.drain();await observer.waitForListenerReady();},
   async stop(){await writer.deactivate();await observer.deactivate();},
   echo(value=server.snapshot()){state.listener.onData(value);}
 };
}

test('healthy observer repairs accepted remote add, edit and delete without a local action',async()=>{
 const h=setup();await h.start();await h.add();
 assert.ok((await h.observer.snapshot()).lastProjectionError);assert.equal((await h.observer.snapshot()).pendingCount,0);
 await until(()=>h.state.calls.length===1&&h.state.published.length===1);assert.equal(h.state.published[0].priority,'H');
 await h.patch('M');await until(()=>h.state.calls.length===2&&h.state.published[0].priority==='M');
 assert.equal((await h.writer.deleteEntity({entityType:'tradeEntry',entityId:h.entityId})).ok,true);await h.writer.drain();
 await until(()=>h.state.calls.length===3&&h.state.published.length===0);
 assert.equal((await h.observer.snapshot()).lastProjectionError,'');assert.equal(await h.journal.getMeta('public-publication-pending-v1'),null);await h.stop();
});

test('remote bursts coalesce; identical echoes and private Favorite changes do not republish',async()=>{
 const h=setup();await h.start();await h.add();await h.patch('M');await h.patch('L');
 for(let i=0;i<4;i++)h.echo();
 await until(()=>h.state.calls.length===1);assert.equal(h.state.published[0].priority,'L');
 assert.equal((await h.writer.addEntity({entityType:'favorite',entityId:'uid-friend',identity:{targetUid:'uid-friend'},values:{displayName:'Private Friend'}})).ok,true);await h.writer.drain();
 for(let i=0;i<4;i++)h.echo();await h.observer.waitForListenerReady();await sleep(1200);
 assert.equal(h.state.calls.length,1);assert.equal(JSON.stringify(h.state.published).includes('Private Friend'),false);await h.stop();
});

test('remote change during slow publication publishes the latest accepted rows before clearing pending',async()=>{
 const held=barrier();let count=0;
 const h=setup({publish:async()=>{if(++count===1){held.entered();await held.gate;}}});await h.start();await h.add();await until(()=>h.state.calls.length===1);await held.waiting;
 await h.patch('L');assert.ok((await h.observer.snapshot()).lastProjectionError);held.release();
 await until(async()=>h.state.calls.length===2&&h.state.published[0]?.priority==='L'&&!(await h.observer.snapshot()).lastProjectionError);
 assert.equal(await h.journal.getMeta('public-publication-pending-v1'),null);await h.stop();
});

test('remote publication failure retains durable pending evidence and automatically retries',async()=>{
 let fail=true;const h=setup({publish:async()=>{if(fail)throw Object.assign(Error('denied'),{code:'PERMISSION_DENIED'});}});await h.start();await h.add();
 await until(()=>h.state.calls.length===1);assert.equal((await h.observer.snapshot()).lastProjectionError,'PERMISSION_DENIED');
 assert.equal((await h.journal.getMeta('public-publication-pending-v1')).pending,true);assert.equal(h.state.published.length,0);
 fail=false;await until(async()=>h.state.calls.length===2&&!(await h.observer.snapshot()).lastProjectionError);await h.stop();
});

test('offline observer pauses publication and reconnect repairs accepted rows',async()=>{
 const h=setup();await h.start();h.state.online=false;await h.add();await sleep(1200);assert.equal(h.state.calls.length,0);
 assert.equal((await h.journal.getMeta('public-publication-pending-v1')).pending,true);
 h.state.online=true;h.echo();await until(()=>h.state.calls.length===1);assert.equal(h.state.published.length,1);await h.stop();
});

for(const fence of ['projection-disabled','session-changed','stopped','invalid-snapshot'])test(`remote repair respects ${fence} authority fence`,async()=>{
 const h=setup();await h.start();await h.add();
 if(fence==='projection-disabled')h.state.allowed=false;
 if(fence==='session-changed')h.state.current=false;
 if(fence==='stopped')await h.observer.deactivate();
 if(fence==='invalid-snapshot'){h.echo({tradeEntries:{invalid:{ownerUid:'another-owner'}}});await until(async()=>(await h.observer.snapshot()).listenerState==='failed');}
 await sleep(1200);assert.equal(h.state.calls.length,0);assert.equal(h.state.published.length,0);await h.stop();
});

test('pending optimistic rows never enter automatic remote repair',async()=>{
 const h=setup({rejectObserverWrites:true});await h.start();
 // Offline admission retains the observer's new intent but sends no repository request.
 h.state.online=false;
 const privateIdentity={...h.identity,catalogId:'pokemon:eevee'},privateId=h.model.tradeEntryId(privateIdentity);
 assert.equal((await h.observer.addEntity({entityType:'tradeEntry',entityId:privateId,identity:privateIdentity,values:{priority:'L',note:'not accepted'}})).ok,true);
 await h.add();assert.equal(h.observer.publicProjection().length,1);assert.equal(h.observer.getEntity('tradeEntry',privateId).values.note,'not accepted');
 assert.equal(JSON.stringify(h.observer.publicProjection()).includes('not accepted'),false);assert.equal(h.state.calls.length,0);
 h.state.online=true;h.echo();
 await until(()=>h.state.calls.length===1);assert.equal(h.state.published.length,1);assert.equal(JSON.stringify(h.state.published).includes('not accepted'),false);
 assert.equal((await h.observer.snapshot()).pendingCount,1);
 await h.stop();
});
