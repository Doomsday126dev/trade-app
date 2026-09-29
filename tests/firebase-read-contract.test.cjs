const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const vm=require('node:vm');
const {collectReadSites,reconcileReadSites}=require('../scripts/lib/firebase-read-sites.cjs');
const controlRoot=path.join(__dirname,'..');
const root=path.resolve(process.env.PAGES_RUNTIME_ROOT||controlRoot);
const tagged='671579c07e8c14c2f1c7d5c6c149332c550a225c';
const hasConditionalObservation=collectReadSites(root).some(site=>site.handler==='observePublicShareForConditionalWrite');
const requestedRuntimeSha=String(process.env.PAGES_RUNTIME_SOURCE_SHA||'').trim();
if(requestedRuntimeSha)assert.match(requestedRuntimeSha,/^[0-9a-f]{40}$/);
const current=requestedRuntimeSha||(hasConditionalObservation?'a'.repeat(40):'f585cb2523ad65f2bbdcbe15ff8b5837a0366269');
const productionRollback='62482523588e5f7a3065936c93bfa043d4d31fb5';
const rollback='df20ddbc5a273b8fef0832c4e38b3de86b69a2dd';
const window={};
vm.runInNewContext(fs.readFileSync(path.join(controlRoot,'js/data/firebaseReadRegistry.js'),'utf8'),{window});
const newContract=window.PogoData.firebaseReadRegistry.SOURCE_CALL_CONTRACT;
const contract=window.PogoData.firebaseReadRegistry.SOURCE_CALL_CONTRACTS[current]||newContract;
function fixture(t,sourceRoot=root){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'firebase-read-contract-'));
  for(const file of ['index.html','css','js'])fs.cpSync(path.join(sourceRoot,file),path.join(dir,file),{recursive:true});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function check(dir,runtimeSourceSha=current){return spawnSync(process.execPath,[path.join(controlRoot,'scripts/check-firebase-reads.js'),'--inventory'],{encoding:'utf8',env:{...process.env,FIREBASE_READ_SOURCE_DIR:dir,PAGES_RUNTIME_SOURCE_SHA:runtimeSourceSha}});}
function checkWithoutRuntimeSha(dir){
  const env={...process.env,FIREBASE_READ_SOURCE_DIR:dir};
  delete env.PAGES_RUNTIME_SOURCE_SHA;
  return spawnSync(process.execPath,[path.join(controlRoot,'scripts/check-firebase-reads.js'),'--inventory'],{encoding:'utf8',env});
}
function change(dir,file,from,to){
  const target=path.join(dir,file),source=fs.readFileSync(target,'utf8');
  assert.ok(source.includes(from));fs.writeFileSync(target,source.replace(from,to));
}
test('parsed runtime inventory matches its exact reviewed contract',()=>{
  const actual=collectReadSites(root);
  assert.equal(actual.length,contract.directReadSites.length);
  const inventory=reconcileReadSites(actual,contract.directReadSites,contract.readHandlerHashes);
  assert.equal(inventory.filter(site=>site.operation==='get').length,contract.directGetCount);
  assert.equal(inventory.filter(site=>site.operation==='onValue').length,contract.directOnValueCount);
  assert.equal(new Set(inventory.map(site=>`${site.file}:${site.line}`)).size,actual.length);
  const observation=newContract.directReadSites.find(site=>site.operation==='onValue');
  assert.equal(observation.handler,'observePublicShareForConditionalWrite');
  assert.equal(observation.normalizedPath,'publicShares/{currentUsername} | trainerShares/{currentUid}');
  assert.equal(observation.ownerScope,'session');
  assert.equal(observation.audience,'owner');
  assert.equal(observation.activeInProduct,true);
  assert.equal(newContract.directOnValueCount,1);
  assert.ok(inventory.every(site=>site.normalizedPath&&site.justification&&site.featureGate));
  assert.ok(!contract.needles.some(item=>item.text.includes('loginDirectory/${handle}')));
});
test('default checker validates the control checkout without downgrading identified runtimes',t=>{
  const dir=fixture(t,controlRoot);
  const local=checkWithoutRuntimeSha(dir);
  assert.equal(local.status,0,local.stderr);
  assert.equal(JSON.parse(local.stdout).directReads.length,23);
  const identified=check(dir,'a'.repeat(40));
  assert.notEqual(identified.status,0,'an explicit new-runtime SHA must not select the local .123 contract');
  change(dir,'js/app/application.js','const path=`trainerShares/${session.uid}`;','const path=`users/${session.uid}`;');
  assert.match(checkWithoutRuntimeSha(dir).stderr,/path bindings or execution semantics changed/);
});
test('conditional publication callers keep exact owner paths',t=>{
  const dir=fixture(t);
  assert.equal(check(dir).status,0);
  change(dir,'js/app/application.js','const path=`trainerShares/${session.uid}`;','const path=`users/${session.uid}`;');
  assert.match(check(dir).stderr,/path bindings or execution semantics changed/);
  const legacy=fixture(t);
  change(legacy,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(legacy).stderr,/path bindings or execution semantics changed/);
});
test('conditional publication listener cannot become broad or outlive the write',t=>{
  if(!hasConditionalObservation){
    assert.equal(newContract.directOnValueCount,1);
    assert.equal(newContract.directReadSites.filter(site=>site.operation==='onValue').length,1);
    assert.equal(contract.directOnValueCount,0);
    return;
  }
  const dir=fixture(t);
  change(dir,'js/app/application.js','unsubscribe=onValue(target,resolve,reject);',"unsubscribe=onValue(ref(db,'users'),resolve,reject);");
  assert.match(check(dir).stderr,/expression changed/);
  const bounded=fixture(t);
  change(bounded,'js/app/application.js','}finally{observation?.close();}','}finally{}');
  assert.match(check(bounded).stderr,/path bindings or execution semantics changed/);
  const failed=fixture(t);
  change(failed,'js/app/application.js','}catch(error){unsubscribe?.();throw error;}','}catch(error){throw error;}');
  assert.match(check(failed).stderr,/path bindings or execution semantics changed/);
});
test('trusted control validates the unchanged immutable .87 runtime and ignores its stale validation metadata',t=>{
  const dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js']){
    fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${tagged}:${file}`],{cwd:process.env.PAGES_RUNTIME_ROOT||root}));
  }
  const result=check(dir,tagged);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).directReads.length,25);
});
test('an unregistered direct read fails even in an existing handler',t=>{
  const dir=fixture(t);change(dir,'js/app/application.js','async function doLogin(){','async function doLogin(){get(ref(db,"unregistered"));');
  assert.match(check(dir).stderr,/inventory changed/);
});
test('a same-count path substitution fails',t=>{
  const dir=fixture(t);change(dir,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');
  assert.notEqual(check(dir).status,0);
});
test('an indirect target path change fails without changing the get expression',t=>{
  const dir=fixture(t);change(dir,'js/app/application.js','const path=`trainerShares/${session.uid}`;','const path=`users/${session.uid}`;');
  assert.match(check(dir).stderr,/path bindings or execution semantics changed/);
});
test('removing a feature gate fails with the same read count',t=>{
  const dir=fixture(t);change(dir,'js/app/application.js','if(!LEGACY_PROVISIONING_ENFORCEMENT_ENABLED||!fbOn||!db)return null;','if(!fbOn||!db)return null;');
  assert.match(check(dir).stderr,/path bindings or execution semantics changed/);
});
test('an extra repository call in an allowed file still fails',t=>{
  const dir=fixture(t);fs.appendFileSync(path.join(dir,'js/data/publicShareRepository.js'),'\nclient.read("unregistered");');
  assert.match(check(dir).stderr,/Repository read sites changed/);
});
test('a repository call in an unregistered file fails',t=>{
  const dir=fixture(t);fs.writeFileSync(path.join(dir,'js/unregistered.js'),'client.listen("private",{});');
  assert.match(check(dir).stderr,/Repository read sites changed/);
});
test('snapshot handler tampering still fails the preserved handler hash',t=>{
  const dir=fixture(t);change(dir,'js/app/application.js',"selectedTrainerRuntime.source='legacy';\n  allData=runtimeDataWithSelectedTrainer(getLocal());","selectedTrainerRuntime.source='legacy';\n  saveLocal(allData);\n  allData=runtimeDataWithSelectedTrainer(getLocal());");
  assert.match(check(dir).stderr,/snapshot behavior changed/);
});
test('computed repository reads cannot evade the call inventory',t=>{
  const dir=fixture(t);fs.appendFileSync(path.join(dir,'js/data/publicShareRepository.js'),'\nclient["read"]("unregistered");');
  assert.match(check(dir).stderr,/Repository read sites changed/);
});
test('Pages invokes the trusted checker against target bytes, never the historical target checker',()=>{
  const workflow=fs.readFileSync(path.join(controlRoot,'.github/workflows/pages-release-control.yml'),'utf8');
  assert.ok(workflow.includes('FIREBASE_READ_SOURCE_DIR=target node control/scripts/check-firebase-reads.js'));
  assert.ok(!workflow.includes('node target/scripts/check-firebase-reads.js'));
});

test('static read validation uses the trusted registry even when the target never loads it',t=>{
  const dir=fixture(t);
  const file=path.join(dir,'index.html');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/<script src="js\/data\/firebaseReadRegistry\.js\?v=[^"]+"><\/script>\n/g,''));
  fs.writeFileSync(path.join(dir,'js/data/firebaseReadRegistry.js'),'throw new Error("target registry must never execute during validation");');
  const result=check(dir,current);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).directReads.length,contract.directReadSites.length);
});

test('trusted control accepts exact immutable .123 rollback without the .124 listener',t=>{
  const dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js']){
    fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${productionRollback}:${file}`],{cwd:process.env.PAGES_RUNTIME_ROOT||root}));
  }
  const result=check(dir,productionRollback);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).directReads.length,23);
});


test('trusted control accepts immutable .104 raw preservation without modifying its stale registry',t=>{
  const dir=fixture(t),runtime='384d6bea6664c0e20a69b08c5623ec21563f80a4';
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js']){
    fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${runtime}:${file}`],{cwd:process.env.PAGES_RUNTIME_ROOT||root}));
  }
  const before=fs.readFileSync(path.join(dir,'js/data/firebaseReadRegistry.js'),'utf8');
  const result=check(dir,runtime);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).directReads.length,25);
  assert.equal(fs.readFileSync(path.join(dir,'js/data/firebaseReadRegistry.js'),'utf8'),before);
  change(dir,'js/app/application.js',"const paths=[...OWNED_MY_LIST_TYPES.map(type=>`${type}/${username}`),`users/${username}`];","const paths=[...OWNED_MY_LIST_TYPES.map(type=>`${type}/${username}`),`users/Other`];");
  assert.match(check(dir,runtime).stderr,/path bindings or execution semantics changed/);
});

test('trusted control accepts the exact .115 rollback read contract',t=>{
  const dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js']){
    fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${rollback}:${file}`],{cwd:process.env.PAGES_RUNTIME_ROOT||root}));
  }
  const result=check(dir,rollback);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).directReads.length,25);
});

test('selected runtime retains its exact read contract',t=>{
  const dir=fixture(t),future=current;
  const result=check(dir,future);assert.equal(result.status,0,result.stderr);
  change(dir,'js/app/application.js','async function doLogin(){','async function doLogin(){get(ref(db,"unregistered"));');
  assert.match(check(dir,future).stderr,/inventory changed/);
});

test('an unregistered source cannot select the historical rollback contract',t=>{
  const dir=fixture(t),future='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js']){
    fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${rollback}:${file}`],{cwd:process.env.PAGES_RUNTIME_ROOT||root}));
  }
  assert.match(check(dir,future).stderr,/inventory changed/);
});
