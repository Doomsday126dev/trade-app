const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const application=readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8');
const start=application.indexOf('async function copyText('),end=application.indexOf('async function copyStr(',start);
assert.ok(start>=0&&end>start,'active copyText implementation must be extractable');
const source=application.slice(start,end);

function harness({fallback=true}={}){
  let resolvePrimary,rejectPrimary,fallbackAttempts=0,removed=0;
  const primary=new Promise((resolve,reject)=>{resolvePrimary=resolve;rejectPrimary=reject;});
  const textarea={value:'',setAttribute(){},style:{},focus(){},select(){},setSelectionRange(){}};
  const document={
    createElement(){return textarea;},body:{appendChild(){},removeChild(){removed++;}},
    execCommand(command){if(command==='copy')fallbackAttempts++;return fallback;}
  };
  const navigator={clipboard:{writeText(){return primary;}}},window={isSecureContext:true};
  const context=vm.createContext({document,navigator,window,Object,Error});vm.runInContext(source,context);
  return{context,resolvePrimary,rejectPrimary,counts:()=>({fallbackAttempts,removed})};
}

for(const fallback of [true,false])test(`cancelled deferred Clipboard rejection starts no ${fallback?'successful':'failing'} fallback`,async()=>{
  const fixture=harness({fallback});fixture.context.valid=true;
  const pending=vm.runInContext(`copyText('qualified',{isCurrent:()=>valid})`,fixture.context);
  fixture.context.valid=false;fixture.rejectPrimary(Object.assign(new Error('denied'),{code:'clipboard/denied'}));
  await assert.rejects(pending,error=>error.code==='copy/cancelled');
  assert.deepEqual(fixture.counts(),{fallbackAttempts:0,removed:0});
});

test('an already-issued Clipboard resolution is not overwritten or undone after cancellation',async()=>{
  const fixture=harness();fixture.context.valid=true;
  const pending=vm.runInContext(`copyText('qualified',{isCurrent:()=>valid})`,fixture.context);
  fixture.context.valid=false;fixture.resolvePrimary();await pending;
  assert.deepEqual(fixture.counts(),{fallbackAttempts:0,removed:0});
});

for(const fallback of [true,false])test(`current operation preserves normal fallback ${fallback?'success':'failure'}`,async()=>{
  const fixture=harness({fallback});fixture.context.valid=true;
  const pending=vm.runInContext(`copyText('qualified',{isCurrent:()=>valid})`,fixture.context);
  fixture.rejectPrimary(new Error('direct denied'));
  if(fallback)await pending;else await assert.rejects(pending,/Copy command failed/);
  assert.deepEqual(fixture.counts(),{fallbackAttempts:1,removed:1});
});
