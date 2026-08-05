const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function functionSource(name,nextName){
  const start=source.indexOf(`function ${name}(`);
  const end=source.indexOf(`function ${nextName}(`,start+1);
  assert.ok(start>=0&&end>start,`Unable to extract ${name}`);
  return source.slice(start,end);
}
const guardSource=functionSource('establishedAccountResetBlocked','establishedAccountResetMessage');
const messageSource=functionSource('establishedAccountResetMessage','openReset');
const openStart=source.indexOf('function openReset(');
const openEnd=source.indexOf('async function confirmReset(',openStart);
const openSource=source.slice(openStart,openEnd);
const confirmStart=source.indexOf('async function confirmReset(');
const confirmEnd=source.indexOf('// ── REQUEST ACCESS',confirmStart);
const confirmSource=source.slice(confirmStart,confirmEnd);

function contextFor(user){
  const calls=[];
  const context={
    allData:{users:{Admin:{isOwner:true},Target:user}},cur:'Admin',OWNER:'Owner',rpinTarget:'Target',calls,
    i18nCore:{t:key=>key},toast:(...args)=>calls.push(['toast',...args]),closeModal:id=>calls.push(['closeModal',id]),
    openModal:id=>calls.push(['openModal',id]),isSixDigitPin:()=>true,document:{getElementById:()=>({value:'123456',textContent:''})},
    provisionFreshFirebaseAuthForTrainer:async()=>{calls.push(['provision']);return{version:2,uid:'replacement'}},
    authVersionForUser:()=>1,hashPin:async()=>'',writeUserStrict:async()=>calls.push(['write'])
  };
  vm.createContext(context);
  vm.runInContext(`${guardSource}\n${messageSource}\n${openSource}\n${confirmSource}`,context);
  return context;
}

test('established UID-bound accounts are identified independently of profile roles',()=>{
  const context=contextFor({authUid:'existing-uid',isAdmin:false});
  assert.equal(context.establishedAccountResetBlocked('Target'),true);
  context.allData.users.Target={isAdmin:true};
  assert.equal(context.establishedAccountResetBlocked('Target'),false);
});

test('opening Reset for an established account cannot open the legacy modal',async()=>{
  const context=contextFor({authUid:'existing-uid'});
  await context.openReset('Target');
  assert.equal(context.calls.some(([name])=>name==='openModal'),false);
  assert.equal(context.calls.some(([name,value])=>name==='toast'&&value==='admin.establishedResetUnavailable'),true);
});

test('direct confirmReset invocation cannot provision or rewrite an established account',async()=>{
  const context=contextFor({authUid:'existing-uid',authEmail:'synthetic@invalid.example',authVersion:1});
  await context.confirmReset();
  assert.equal(context.calls.some(([name])=>name==='provision'),false);
  assert.equal(context.calls.some(([name])=>name==='write'),false);
  assert.equal(context.rpinTarget,null);
});

test('Admin rendering disables established Reset and uses the translated explanation',()=>{
  const render=source.slice(source.indexOf('function renderAdmin('),source.indexOf('async function repairAccount('));
  assert.match(render,/const establishedResetBlocked=!!d\.authUid/);
  assert.match(render,/canReset&&!establishedResetBlocked/);
  assert.match(render,/admin\.establishedResetUnavailable/);
  assert.match(source,/id="admin-reset-safety-note"/);
});

test('the established-account guard executes before fresh-account provisioning',()=>{
  assert.ok(confirmSource.indexOf('establishedAccountResetBlocked')<confirmSource.indexOf('provisionFreshFirebaseAuthForTrainer'));
  assert.match(source,/admin\.establishedResetUnavailable/);
});
