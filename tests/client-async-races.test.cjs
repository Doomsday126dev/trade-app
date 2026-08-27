const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));
function between(start,end){const from=html.indexOf(start),to=html.indexOf(end,from);assert.notEqual(from,-1);assert.notEqual(to,-1);return html.slice(from,to);}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const response=data=>({ok:true,status:200,json:async()=>data});

test('TEST-02 Events deduplicates ordinary loads and a forced newer response wins',async()=>{
  const requests=[];const storage=new Map();
  const context=vm.createContext({
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{onLine:true},Date,Promise,JSON,Error,SyntaxError,AbortController,
    setTimeout:()=>1,clearTimeout:()=>{},
    fetch:url=>{const item=deferred();requests.push({url,item});return item.promise;}
  });
  vm.runInContext(between("const SCRAPEDDUCK_BASE='",'function currentEvents'),context);
  const first=vm.runInContext('fetchPogoEvents()',context),duplicate=vm.runInContext('fetchPogoEvents()',context);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);
  requests[0].item.resolve(response([{eventId:'old'}]));requests[1].item.resolve(response([]));
  await Promise.all([first,duplicate]);
  const stale=vm.runInContext('fetchPogoEvents(true)',context),newer=vm.runInContext('fetchPogoEvents(true)',context);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,6);
  requests[4].item.resolve(response([{eventId:'new'}]));requests[5].item.resolve(response([]));await newer;
  requests[2].item.resolve(response([{eventId:'stale'}]));requests[3].item.resolve(response([]));await stale;
  assert.equal(vm.runInContext('_eventData.events[0].eventId',context),'new');
  assert.equal(JSON.parse(storage.get('pogoEventCache_v1')).data.events[0].eventId,'new');
  assert.equal(vm.runInContext('_eventLoadState',context),'ready');
});

test('TEST-02 a stale public-profile exact read cannot replace a newer selected trainer',async()=>{
  const reads=[],applied=[];
  const context=vm.createContext({
    db:{},_publicShareRequestGeneration:0,allData:{},Promise,console:{warn(){}},
    ref:(_db,path)=>path,get:path=>{const item=deferred();reads.push({path,item});return item.promise;},
    publicSharePublicationDomain:{publicShareProjectionStatus:(value,{username})=>({ok:true,status:'published',snapshot:{username,value}})},
    selectedTrainerData:username=>({username}),applyPublicShareSnapshot:(state,snapshot)=>{applied.push(snapshot.username);state.snapshot=snapshot;return true;},
    runtimeDataWithSelectedTrainer:value=>value,getLocal:()=>({}),setSyncStatus(){}
  });
  vm.runInContext(between('async function loadPublicShareData','async function loadShareViewData'),context);
  vm.runInContext('_publicShareRequestGeneration=1; var older=loadPublicShareData("TrainerA",{requestGeneration:1});',context);
  vm.runInContext('_publicShareRequestGeneration=2; var newer=loadPublicShareData("TrainerB",{requestGeneration:2});',context);
  reads[1].item.resolve({exists:()=>true,val:()=>({})});await vm.runInContext('newer',context);
  reads[0].item.resolve({exists:()=>true,val:()=>({})});const stale=await vm.runInContext('older',context);
  assert.equal(stale.status,'stale');assert.deepEqual(applied,['TrainerB']);
  assert.deepEqual(reads.map(item=>item.path),['publicShares/TrainerA','publicShares/TrainerB']);
});

test('async session guards cover Browse, public profiles, Events, and pending UI callbacks',()=>{
  assert.match(html,/favorite-cache\/session-changed/);
  assert.match(html,/requestGeneration!==_publicShareRequestGeneration/);
  assert.match(html,/generation!==_eventRequestGeneration/);
  assert.match(html,/generation!==_sessionTransientGeneration/);
  assert.match(html,/resetFavoriteBrowseSession\(\)/);
});
