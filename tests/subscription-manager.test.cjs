const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','js/data/subscriptionManager.js'),'utf8');

function loadModule(){
  const window={};
  vm.runInNewContext(source,{window});
  return window.PogoData.subscriptionManager;
}

function sourceHarness(){
  const starts=[];
  const stops=[];
  function start({next,error}){
    const record={next,error,stopped:false};
    starts.push(record);
    return()=>{record.stopped=true;stops.push(record);};
  }
  return{start,starts,stops};
}

test('subscribe is idempotent for the same logical key, scope, and fingerprint',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const source=sourceHarness();
  const first=manager.subscribe({key:'users',scope:'session',fingerprint:'users',start:source.start,onValue:()=>{}});
  const second=manager.subscribe({key:'users',scope:'session',fingerprint:'users',start:source.start,onValue:()=>{}});
  assert.equal(first.status,'subscribed');
  assert.equal(second.status,'existing');
  assert.equal(source.starts.length,1);
  assert.equal(manager.size(),1);
});

test('key replacement unsubscribes the old listener and suppresses stale callbacks',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const source=sourceHarness();
  const values=[];
  manager.subscribe({key:'trainer',scope:'selectedTrainer',fingerprint:'one',start:source.start,onValue:value=>values.push(`old:${value}`)});
  const old=source.starts[0];
  const result=manager.subscribe({key:'trainer',scope:'selectedTrainer',fingerprint:'two',start:source.start,onValue:value=>values.push(`new:${value}`)});
  old.next('stale');
  source.starts[1].next('current');
  assert.equal(result.status,'replaced');
  assert.equal(old.stopped,true);
  assert.deepEqual(values,['new:current']);
});

test('scope cleanup owns lazy-list and selected-trainer listeners explicitly',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const source=sourceHarness();
  manager.subscribe({key:'list:wishlist',scope:'screen',start:source.start,onValue:()=>{}});
  manager.subscribe({key:'list:gmax',scope:'screen',start:source.start,onValue:()=>{}});
  manager.subscribe({key:'share:trainer',scope:'selectedTrainer',start:source.start,onValue:()=>{}});
  const screen=manager.unsubscribeByScope('screen');
  assert.equal(screen.count,2);
  assert.equal(manager.size(),1);
  const trainer=manager.unsubscribeByScope('selectedTrainer');
  assert.equal(trainer.count,1);
  assert.equal(manager.size(),0);
});

test('logout and auth-loss cleanup remove all scopes without duplicates across repeated sessions',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const source=sourceHarness();
  for(let cycle=0;cycle<3;cycle++){
    manager.subscribe({key:'session:users',scope:'session',fingerprint:'users',start:source.start,onValue:()=>{}});
    manager.subscribe({key:'admin:requests',scope:'legacyAdmin',start:source.start,onValue:()=>{}});
    assert.equal(manager.size(),2);
    assert.equal(manager.cleanupForLogout().count,2);
    assert.equal(manager.size(),0);
  }
  assert.equal(source.starts.length,6);
  assert.equal(source.stops.length,6);
  manager.subscribe({key:'session:users',scope:'session',start:source.start,onValue:()=>{}});
  assert.equal(manager.cleanupForAuthLoss().count,1);
  assert.equal(manager.size(),0);
});

test('listener errors are forwarded only while current',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const source=sourceHarness();
  const errors=[];
  manager.subscribe({key:'users',scope:'session',start:source.start,onValue:()=>{},onError:error=>errors.push(error.message)});
  source.starts[0].error(Object.assign(new Error('live failure'),{code:'database/live-failure'}));
  manager.unsubscribeByKey('users');
  source.starts[0].error(new Error('stale failure'));
  assert.deepEqual(errors,['live failure']);
});

test('invalid input and listener startup failures return predictable errors',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  assert.equal(manager.subscribe({}).error.code,'listener/invalid-key');
  assert.equal(manager.subscribe({key:'x',scope:'unknown',start(){},onValue(){}}).error.code,'listener/invalid-scope');
  const failed=manager.subscribe({key:'x',scope:'session',start(){throw Object.assign(new Error('nope'),{code:'listener/test'});},onValue(){}});
  assert.deepEqual({ok:failed.ok,code:failed.error.code,message:failed.error.message},{ok:false,code:'listener/test',message:'nope'});
  assert.equal(manager.size(),0);
});

test('a synchronous initial callback is delivered and can be unsubscribed',()=>{
  const {createSubscriptionManager}=loadModule();
  const manager=createSubscriptionManager();
  const values=[];
  const result=manager.subscribe({
    key:'sync',scope:'session',
    start({next}){next('initial');return()=>{};},
    onValue:value=>values.push(value)
  });
  assert.equal(result.ok,true);
  assert.deepEqual(values,['initial']);
  assert.equal(manager.unsubscribeByKey('sync').status,'unsubscribed');
});
