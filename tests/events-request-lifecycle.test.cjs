const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function between(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1);assert.notEqual(to,-1);
  return html.slice(from,to);
}
const eventSource=between("const SCRAPEDDUCK_BASE='",'function currentEvents');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return{promise,resolve,reject};
}
function response(data,{ok=true,status=200}={}){return{ok,status,json:async()=>data};}
function abortError(){const error=new Error('aborted');error.name='AbortError';return error;}

function harness({cached=null}={}){
  const requests=[],timers=new Map(),timerHistory=[];
  const storage=new Map(cached?[["pogoEventCache_v1",JSON.stringify(cached)]]:[]);
  let timerId=0;
  const fetchImpl=(url,{signal}={})=>{
    const item={url,signal,...deferred(),ignoreAbort:false};
    signal?.addEventListener('abort',()=>{if(!item.ignoreAbort)item.reject(abortError());},{once:true});
    requests.push(item);return item.promise;
  };
  const context=vm.createContext({
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{onLine:true},Date,Promise,JSON,Error,SyntaxError,AbortController,
    fetch:fetchImpl,
    setTimeout(callback,delay){const id=++timerId,record={id,callback,delay,cleared:false};timers.set(id,record);timerHistory.push(record);return id;},
    clearTimeout(id){const record=timers.get(id);if(record)record.cleared=true;timers.delete(id);}
  });
  vm.runInContext(eventSource,context);
  return{
    context,requests,storage,timers,timerHistory,
    run:expression=>vm.runInContext(expression,context),
    fire(record=timerHistory.at(-1)){record.callback();}
  };
}
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
function resolvePair(run,index,events=[],raids=[]){
  run.requests[index].resolve(response(events));
  run.requests[index+1].resolve(response(raids));
}

test('EVENT-01 uses one centralized 15-second deadline and clears it after success',async()=>{
  const run=harness();
  const pending=run.run('fetchPogoEvents()');
  assert.equal(run.requests.length,2);
  assert.equal(run.timerHistory.length,1);
  assert.equal(run.timerHistory[0].delay,15000);
  assert.equal(run.run('EVENT_REQUEST_TIMEOUT_MS'),15000);
  resolvePair(run,0,[{eventId:'ordinary'}]);
  const value=await pending;
  assert.equal(value.events[0].eventId,'ordinary');
  assert.equal(run.timerHistory[0].cleared,true);
  assert.equal(run.timers.size,0);
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 ordinary callers deduplicate onto one two-resource network operation',async()=>{
  const run=harness();
  const first=run.run('fetchPogoEvents()'),second=run.run('fetchPogoEvents()');
  assert.equal(run.requests.length,2);
  assert.equal(run.timerHistory.length,1);
  resolvePair(run,0,[{eventId:'shared'}]);
  const[one,two]=await Promise.all([first,second]);
  assert.equal(one.events[0].eventId,'shared');assert.equal(two.events[0].eventId,'shared');
});

test('EVENT-01 timeout aborts both requests and releases inflight ownership',async()=>{
  const run=harness();
  const pending=run.run('fetchPogoEvents()');
  run.fire();
  const value=await pending;
  assert.equal(run.requests.every(item=>item.signal.aborted),true);
  assert.deepEqual(Array.from(value.events),[]);
  assert.equal(run.run('_eventLoadState'),'error');
  assert.equal(run.run('_eventInflight===null'),true);
  assert.equal(run.run('_eventData.fetchedAt'),0);
});

test('EVENT-01 retry after timeout owns a fresh controller and can recover',async()=>{
  const run=harness();
  const failed=run.run('fetchPogoEvents()'),firstSignal=run.requests[0].signal;
  run.fire();await failed;
  const retry=run.run('fetchPogoEvents(true)');
  assert.equal(run.requests.length,4);
  assert.notEqual(run.requests[2].signal,firstSignal);
  assert.equal(run.requests[2].signal.aborted,false);
  resolvePair(run,2,[{eventId:'recovered'}]);
  assert.equal((await retry).events[0].eventId,'recovered');
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 forced replacement aborts the old operation and late old success cannot overwrite new data',async()=>{
  const run=harness();
  const older=run.run('fetchPogoEvents()');
  run.requests[0].ignoreAbort=true;run.requests[1].ignoreAbort=true;
  const newer=run.run('fetchPogoEvents(true)');
  assert.equal(run.requests[0].signal.aborted,true);
  resolvePair(run,2,[{eventId:'new'}]);await newer;
  resolvePair(run,0,[{eventId:'old'}]);await older;
  assert.equal(run.run('_eventData.events[0].eventId'),'new');
  assert.equal(JSON.parse(run.storage.get('pogoEventCache_v1')).data.events[0].eventId,'new');
});

test('EVENT-01 late old error cannot replace a newer successful state',async()=>{
  const run=harness();
  const older=run.run('fetchPogoEvents()');
  run.requests[0].ignoreAbort=true;run.requests[1].ignoreAbort=true;
  const newer=run.run('fetchPogoEvents(true)');
  resolvePair(run,2,[{eventId:'new'}]);await newer;
  run.requests[0].reject(new Error('late network failure'));
  run.requests[1].reject(new Error('late network failure'));
  await older;
  assert.equal(run.run('_eventData.events[0].eventId'),'new');
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 stale timeout callback cannot overwrite a newer successful state',async()=>{
  const run=harness();
  const older=run.run('fetchPogoEvents()'),oldTimer=run.timerHistory[0];
  run.requests[0].ignoreAbort=true;run.requests[1].ignoreAbort=true;
  const newer=run.run('fetchPogoEvents(true)');
  resolvePair(run,2,[{eventId:'new'}]);await newer;
  run.fire(oldTimer);
  resolvePair(run,0,[{eventId:'old'}]);await older;
  assert.equal(run.run('_eventData.events[0].eventId'),'new');
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 an old deadline firing while forced refresh is active cannot replace its success',async()=>{
  const run=harness();
  const older=run.run('fetchPogoEvents()'),oldTimer=run.timerHistory[0];
  run.requests[0].ignoreAbort=true;run.requests[1].ignoreAbort=true;
  const newer=run.run('fetchPogoEvents(true)');
  run.fire(oldTimer);
  resolvePair(run,2,[{eventId:'new'}]);await newer;
  resolvePair(run,0,[{eventId:'old'}]);await older;
  assert.equal(run.run('_eventData.events[0].eventId'),'new');
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 timeout prefers a structurally usable stale cache',async()=>{
  const cached={t:Date.now()-3*60*60*1000,data:{events:[{eventId:'cached'}],raids:[],fetchedAt:1}};
  const run=harness({cached});
  const pending=run.run('fetchPogoEvents()');
  assert.equal(run.requests.length,2,'expired cache must still attempt a refresh');
  run.fire();
  const value=await pending;
  assert.equal(value.events[0].eventId,'cached');
  assert.equal(run.run('_eventLoadState'),'ready');
});

test('EVENT-01 HTTP and parse failures remain recoverable without raw errors or orphaned timers',async()=>{
  for(const mode of ['http','parse']){
    const run=harness();
    const pending=run.run('fetchPogoEvents()');
    if(mode==='http'){
      run.requests[0].resolve(response([], {ok:false,status:503}));
      run.requests[1].resolve(response([]));
    }else{
      run.requests[0].resolve({ok:true,status:200,json:async()=>{throw new SyntaxError('private parser detail');}});
      run.requests[1].resolve(response([]));
    }
    await assert.doesNotReject(pending);
    assert.equal(run.run('_eventLoadState'),'error');
    assert.equal(run.run('_eventInflight===null'),true);
    assert.equal(run.timers.size,0);
  }
});

test('EVENT-01 classifies deadline, replacement, abort, HTTP, parse, and network failures distinctly',()=>{
  const run=harness();
  const classify=(error,operation)=>{
    run.context.error=error;run.context.operation=operation;
    return run.run('eventRequestFailureKind(error,operation)');
  };
  assert.equal(classify(new Error('x'),{replaced:true,deadlineExceeded:false}),'replaced');
  assert.equal(classify(new Error('x'),{replaced:false,deadlineExceeded:true}),'timeout');
  assert.equal(classify(abortError(),{replaced:false,deadlineExceeded:false}),'aborted');
  assert.equal(classify(Object.assign(new Error('x'),{code:'events/http'}),{replaced:false,deadlineExceeded:false}),'http');
  assert.equal(classify(new SyntaxError('x'),{replaced:false,deadlineExceeded:false}),'parse');
  assert.equal(classify(new TypeError('x'),{replaced:false,deadlineExceeded:false}),'network');
});
