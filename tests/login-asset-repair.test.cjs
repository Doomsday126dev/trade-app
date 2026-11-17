const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('js/app/application.js','utf8');
const start=app.indexOf('async function clearLoginLocalCache(){'),end=app.indexOf('// ── AUTH ──',start);
assert.ok(start>=0&&end>start);
const action=app.slice(start,end);
function exercise({approved=true,online=true,storageError=false}={}){
  const removed=[],unregistered=[],messages=[],navigations=[];
  const untouched=new Map([['pogoSyncQueue_v2','pending'],['pogoTrainerHistory_v1:one','first'],['pogoTrainerHistory_v1:two','second'],['pg-other-project','other']]);
  const storage={removeItem:k=>untouched.delete(k),clear:()=>untouched.clear(),key:i=>[...untouched.keys()][i],get length(){return untouched.size;}};
  const names=['shell-pogo-trades-2026-11-16.176','sprites-pogo-trades-v6','shell-pogo-trades-2026-08-01.22-installing','shell-pogo-trades-another-app','unrelated','sprites-pogo-trades-v6-extra'];
  const scopes=['https://example.test/trade-app/','https://example.test/trade-app/nested/','https://example.test/'];
  const caches={keys:async()=>{if(storageError)throw Error('unavailable');return names;},delete:async n=>{removed.push(n);return true;}};
  const ctx={window:{caches},localStorage:storage,sessionStorage:storage,indexedDB:{deleteDatabase(){assert.fail('must preserve database');}},caches,URL,
    navigator:{onLine:online,serviceWorker:{getRegistrations:async()=>scopes.map(scope=>({scope,unregister:async()=>{unregistered.push(scope);return true;}}))}},
    location:{href:'https://example.test/trade-app/?sample',pathname:'/trade-app/',replace:u=>navigations.push(u)},toast:m=>messages.push(m),i18nCore:{t:k=>k},confirm:()=>approved};
  vm.runInNewContext(action,ctx);return {run:ctx.clearLoginLocalCache,removed,unregistered,messages,navigations,untouched};
}
test('login repair removes only versioned app assets and the exact worker scope, never trainer data',async()=>{
  const t=exercise();await t.run();
  assert.deepEqual(t.removed,['shell-pogo-trades-2026-11-16.176','sprites-pogo-trades-v6','shell-pogo-trades-2026-08-01.22-installing']);
  assert.deepEqual(t.unregistered,['https://example.test/trade-app/']);assert.equal(t.untouched.size,4);assert.equal(t.navigations.length,1);
});
test('cancel and offline do not discard even cached offline assets',async()=>{
  for(const config of [{approved:false},{online:false}]){const t=exercise(config);await t.run();assert.equal(t.untouched.size,4);assert.deepEqual(t.removed,[]);assert.deepEqual(t.unregistered,[]);assert.deepEqual(t.navigations,[]);assert.deepEqual(t.messages,config.online===false?['health.cacheRepairOffline']:[]);}
});
test('asset-maintenance failure leaves user data and does not announce success',async()=>{
  const t=exercise({storageError:true});await t.run();assert.equal(t.untouched.size,4);assert.deepEqual(t.navigations,[]);assert.deepEqual(t.messages,['health.cacheRepairFailed']);
});
