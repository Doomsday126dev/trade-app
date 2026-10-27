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
const localRecovery=/(?:2026-10-22\.13[01]|2026-10-25\.13[2-8]|2026-10-26\.(?:139|140|141|142|143|144|145|146|147|148|149)|2026-10-27\.(?:150|151|152|153|154))/.test(fs.readFileSync(path.join(root,'js/domain/clientRelease.js'),'utf8'));
const current=requestedRuntimeSha||(localRecovery?'27c4bdc3b5266c653b7a0f88df65b90bba0bf2a8':hasConditionalObservation?'a'.repeat(40):'f585cb2523ad65f2bbdcbe15ff8b5837a0366269');
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
  assert.equal(JSON.parse(local.stdout).directReads.length,collectReadSites(controlRoot).length);
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


test('focused .125 uses its exact reviewed legacy publication contract',t=>{
  const sha='a794c3d8150f20745045383cba4c6b8fd5940698',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,23);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .125 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('focused .126 uses its exact reviewed legacy publication contract',t=>{
  const sha='aa7a3ec6629b9c77868dd8764c9d12ce9e92b5d7',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,23);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .126 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('focused .127 uses its exact reviewed legacy publication contract',t=>{
  const sha='76c0fd1cf9f5cd6295c2be5037f7c933af3a9e6b',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,23);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .127 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('focused .128 uses its exact reviewed legacy publication contract',t=>{
  const sha='9d7fd6c2a93dacfa04f2eba5db5123c4741a9718',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,23);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .128 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('focused .129 queue retry release retains exact reviewed read boundaries',t=>{
  const sha='c13d6728c3def45551c9b00e561a66b42ecd0285',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,23);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .129 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('focused .130 recovery release retains exact public readback boundaries',t=>{
  const sha='27c4bdc3b5266c653b7a0f88df65b90bba0bf2a8',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .130 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

test('isolated .131 analytics release preserves exact public readback boundaries',t=>{
  const sha='56ae1b8217bd1e6e66da19ec74aee9ec57382dc6',dir=fixture(t);
  for(const file of ['index.html','css/app.css','js/app/application.js','js/data/firebaseReadRegistry.js'])fs.writeFileSync(path.join(dir,file),execFileSync('git',['show',`${sha}:${file}`],{cwd:root}));
  const result=check(dir,sha);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
  assert.notEqual(check(dir,'b'.repeat(40)).status,0,'unregistered revisions must not inherit the .131 exception');
  change(dir,'js/app/application.js','const target=ref(db,`publicShares/${username}`);','const target=ref(db,`users/${username}`);');
  assert.match(check(dir,sha).stderr,/path bindings or execution semantics changed/);
});

function compactEventsFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events134-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['archive','0e1a9f7844d6c0c7d556518a6d06815de185d2fc','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact Events .134 source retains reviewed recovery read contract',t=>{
 const result=check(compactEventsFixture(t),'0e1a9f7844d6c0c7d556518a6d06815de185d2fc');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
});
test('Events registration does not authorize an unknown SHA',t=>{
 const result=check(compactEventsFixture(t),'b'.repeat(40));assert.notEqual(result.status,0);
});
test('Events exact-SHA registration still rejects changed read targets',t=>{
 const dir=compactEventsFixture(t);change(dir,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(dir,'0e1a9f7844d6c0c7d556518a6d06815de185d2fc').status,0);
});

function plannerEventsFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events135-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['archive','9879c42ebcf743397b77fd61514efb3e9f4e5e0c','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact Events .135 source retains reviewed recovery read contract',t=>{
 const result=check(plannerEventsFixture(t),'9879c42ebcf743397b77fd61514efb3e9f4e5e0c');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
});
test('planner registration does not authorize an unknown 9879c42ebcf743397b77fd61514efb3e9f4e5e0c',t=>{
 assert.notEqual(check(plannerEventsFixture(t),'b'.repeat(40)).status,0);
});
test('planner exact-9879c42ebcf743397b77fd61514efb3e9f4e5e0c registration still rejects changed read targets',t=>{
 const dir=plannerEventsFixture(t);change(dir,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(dir,'9879c42ebcf743397b77fd61514efb3e9f4e5e0c').status,0);
});

function detailsEventsFixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'events136-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['archive','87cf84e712384491b23897c1a2f252258a17448e','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact Events .136 source retains reviewed recovery read contract',t=>{
 const result=check(detailsEventsFixture(t),'87cf84e712384491b23897c1a2f252258a17448e');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
});
test('Details registration does not authorize an unknown 87cf84e712384491b23897c1a2f252258a17448e',t=>{
 assert.notEqual(check(detailsEventsFixture(t),'b'.repeat(40)).status,0);
});
test('planner exact-87cf84e712384491b23897c1a2f252258a17448e registration still rejects changed read targets',t=>{
 const dir=detailsEventsFixture(t);change(dir,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(dir,'87cf84e712384491b23897c1a2f252258a17448e').status,0);
});

function members137Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'members137-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['archive','0bfa8e08c64bd80fb5881458601daec11d03e2cc','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact Members .137 source retains reviewed recovery read contract',t=>{
 const result=check(members137Fixture(t),'0bfa8e08c64bd80fb5881458601daec11d03e2cc');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).directReads.length,24);
});
test('Members registration rejects unknown source 0bfa8e08c64bd80fb5881458601daec11d03e2cc',t=>{
 assert.notEqual(check(members137Fixture(t),'b'.repeat(40)).status,0);
});
test('Members exact-source registration still rejects changed read targets',t=>{
 const dir=members137Fixture(t);change(dir,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(dir,'0bfa8e08c64bd80fb5881458601daec11d03e2cc').status,0);
});

function costume138Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume138-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['archive','3740d59178758afd2371a6dbea1d8d10f3888312','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact costume .138 source retains reviewed recovery reads',t=>{const r=check(costume138Fixture(t),'3740d59178758afd2371a6dbea1d8d10f3888312');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('costume .138 registration rejects unknown source',t=>{assert.notEqual(check(costume138Fixture(t),'b'.repeat(40)).status,0)});
test('costume .138 registration rejects a changed private read target',t=>{const d=costume138Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'3740d59178758afd2371a6dbea1d8d10f3888312').status,0)});

function finalCostume138Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume138-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','ed7139d87da409e6fa0ec81e31b149cebbc33ea8','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('final .138 with all eleven costumes retains exact recovery read contract',t=>{const r=check(finalCostume138Fixture(t),'ed7139d87da409e6fa0ec81e31b149cebbc33ea8');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('final .138 contract rejects unknown SHA',t=>{assert.notEqual(check(finalCostume138Fixture(t),'b'.repeat(40)).status,0)});
test('final .138 rejects changed private target',t=>{const d=finalCostume138Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'ed7139d87da409e6fa0ec81e31b149cebbc33ea8').status,0)});

function costume139Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume139-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','8046c28127ded3916c9dc69504e7ed0a62e213da','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .139 with five exact costume sprite repairs retains exact recovery read contract',t=>{const r=check(costume139Fixture(t),'8046c28127ded3916c9dc69504e7ed0a62e213da');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .139 contract rejects unknown SHA',t=>{assert.notEqual(check(costume139Fixture(t),'b'.repeat(40)).status,0)});
test('exact .139 rejects changed private target',t=>{const d=costume139Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'8046c28127ded3916c9dc69504e7ed0a62e213da').status,0)});

function costume140Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume140-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','0a664598ec9d21f0157f8eb00cca6a511bfdeef8','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .140 with six exact costume sprite repairs retains exact recovery read contract',t=>{const r=check(costume140Fixture(t),'0a664598ec9d21f0157f8eb00cca6a511bfdeef8');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .140 contract rejects unknown SHA',t=>{assert.notEqual(check(costume140Fixture(t),'b'.repeat(40)).status,0)});
test('exact .140 rejects changed private target',t=>{const d=costume140Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'0a664598ec9d21f0157f8eb00cca6a511bfdeef8').status,0)});

function costume141Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume141-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','748ad63a7b0d2e1efbc7689b660483b95fdab4e3','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .141 with six exact costume sprite repairs retains exact recovery read contract',t=>{const r=check(costume141Fixture(t),'748ad63a7b0d2e1efbc7689b660483b95fdab4e3');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .141 contract rejects unknown SHA',t=>{assert.notEqual(check(costume141Fixture(t),'b'.repeat(40)).status,0)});
test('exact .141 rejects changed private target',t=>{const d=costume141Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'748ad63a7b0d2e1efbc7689b660483b95fdab4e3').status,0)});

function costume142Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume142-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','2bec47c137361e43867fb5f767d6d1f567a2a0e8','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .142 with gender and exact Cosmog sprite corrections retains exact recovery read contract',t=>{const r=check(costume142Fixture(t),'2bec47c137361e43867fb5f767d6d1f567a2a0e8');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .142 contract rejects unknown SHA',t=>{assert.notEqual(check(costume142Fixture(t),'b'.repeat(40)).status,0)});
test('exact .142 rejects changed private target',t=>{const d=costume142Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'2bec47c137361e43867fb5f767d6d1f567a2a0e8').status,0)});

function costume143Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'costume143-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','d40923bc02f5f6e7953e91d44c19e8368c4a9b54','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .143 with twenty-one costume artwork corrections retains exact recovery read contract',t=>{const r=check(costume143Fixture(t),'d40923bc02f5f6e7953e91d44c19e8368c4a9b54');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .143 contract rejects unknown SHA',t=>{assert.notEqual(check(costume143Fixture(t),'b'.repeat(40)).status,0)});
test('exact .143 rejects changed private target',t=>{const d=costume143Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'d40923bc02f5f6e7953e91d44c19e8368c4a9b54').status,0)});

function nav144Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nav144-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','4bacc23c76c463797b340e7f380ad19438785b97','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .144 with direct mobile Events navigation retains exact recovery read contract',t=>{const r=check(nav144Fixture(t),'4bacc23c76c463797b340e7f380ad19438785b97');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .144 contract rejects unknown SHA',t=>{assert.notEqual(check(nav144Fixture(t),'b'.repeat(40)).status,0)});
test('exact .144 rejects changed private target',t=>{const d=nav144Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'4bacc23c76c463797b340e7f380ad19438785b97').status,0)});

function cleanup145Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup145-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','4536e64b26e0a1204bcecefc246704c4e8285ce7','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .145 with reviewed Pikachu art and scoped list/picker polish retains exact recovery read contract',t=>{const r=check(cleanup145Fixture(t),'4536e64b26e0a1204bcecefc246704c4e8285ce7');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .145 contract rejects unknown SHA',t=>{assert.notEqual(check(cleanup145Fixture(t),'b'.repeat(40)).status,0)});
test('exact .145 rejects changed private target',t=>{const d=cleanup145Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'4536e64b26e0a1204bcecefc246704c4e8285ce7').status,0)});

function art146Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'art146-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','77d5a85e297e783a81ecc0977df19babe826ccef','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .146 with 85 reviewed additional artwork mappings retains exact recovery read contract',t=>{const r=check(art146Fixture(t),'77d5a85e297e783a81ecc0977df19babe826ccef');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .146 contract rejects unknown SHA',t=>{assert.notEqual(check(art146Fixture(t),'b'.repeat(40)).status,0)});
test('exact .146 rejects changed private target',t=>{const d=art146Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'77d5a85e297e783a81ecc0977df19babe826ccef').status,0)});

function art147Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'art147-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','abefd66586d06bcc6253d4b1ae3f1f9196136944','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .147 with 173 consolidated reviewed artwork mappings retains exact recovery read contract',t=>{const r=check(art147Fixture(t),'abefd66586d06bcc6253d4b1ae3f1f9196136944');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .147 contract rejects unknown SHA',t=>{assert.notEqual(check(art147Fixture(t),'b'.repeat(40)).status,0)});
test('exact .147 rejects changed private target',t=>{const d=art147Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'abefd66586d06bcc6253d4b1ae3f1f9196136944').status,0)});

function traffic148Fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'traffic148-final-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','84e057be83f5de292c660324b156fd07940ec3af','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;
}
test('exact .148 with validated CSS screen width retains exact recovery read contract',t=>{const r=check(traffic148Fixture(t),'84e057be83f5de292c660324b156fd07940ec3af');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .148 contract rejects unknown SHA',t=>{assert.notEqual(check(traffic148Fixture(t),'b'.repeat(40)).status,0)});
test('exact .148 rejects changed private target',t=>{const d=traffic148Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'84e057be83f5de292c660324b156fd07940ec3af').status,0)});

function catalog149Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog149-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','80db1bb90f3132f7125d7c32932b841ab77abf2b','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact .149 catalog runtime retains the reviewed recovery read contract',t=>{const r=check(catalog149Fixture(t),'80db1bb90f3132f7125d7c32932b841ab77abf2b');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .149 contract rejects unknown SHA',t=>{assert.notEqual(check(catalog149Fixture(t),'b'.repeat(40)).status,0)});

function apri150Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apri150-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','d9a6a0d0232c065465fb8084ed8d010699b0fbbb','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact .150 Apri runtime retains the reviewed recovery read contract',t=>{const r=check(apri150Fixture(t),'d9a6a0d0232c065465fb8084ed8d010699b0fbbb');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact .150 rejects unknown SHA',t=>{assert.notEqual(check(apri150Fixture(t),'b'.repeat(40)).status,0)});
test('exact .150 rejects changed private target',t=>{const d=apri150Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'d9a6a0d0232c065465fb8084ed8d010699b0fbbb').status,0)});

function apriHalloween150Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apri-halloween150-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','fd74ad68cf196117a0bc479998f7ba1ea29d1bd5','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact combined Apri Halloween .150 retains the reviewed 24-read contract',t=>{const r=check(apriHalloween150Fixture(t),'fd74ad68cf196117a0bc479998f7ba1ea29d1bd5');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact combined Apri Halloween rejects changed private target',t=>{const d=apriHalloween150Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'fd74ad68cf196117a0bc479998f7ba1ea29d1bd5').status,0)});

function apri151Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apri151-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','351ebcafe42b1cb3558355aa238c189e55bb09b6','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact Apri151 logo Trainers runtime retains the reviewed 24-read contract',t=>{const r=check(apri151Fixture(t),'351ebcafe42b1cb3558355aa238c189e55bb09b6');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact Apri151 rejects a changed private target',t=>{const d=apri151Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'351ebcafe42b1cb3558355aa238c189e55bb09b6').status,0)});

function favorites152Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'favorites152-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','8bf0fd8b2de333bb8bb3a58c5e959cf566746957','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact Favorites152 bounded metadata runtime retains the reviewed 24-read contract',t=>{const r=check(favorites152Fixture(t),'8bf0fd8b2de333bb8bb3a58c5e959cf566746957');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact Favorites152 rejects a changed private target',t=>{const d=favorites152Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'8bf0fd8b2de333bb8bb3a58c5e959cf566746957').status,0)});

function ui153Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ui153-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','44f03e950ec22b2c62b4ae47d7b5096d8d10fae6','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('exact UI153 presentation runtime retains the reviewed 24-read contract',t=>{const r=check(ui153Fixture(t),'44f03e950ec22b2c62b4ae47d7b5096d8d10fae6');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('exact UI153 rejects a changed private target',t=>{const d=ui153Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'44f03e950ec22b2c62b4ae47d7b5096d8d10fae6').status,0)});

function ui153FinalFixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ui153-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','23bae53f08554d8a4a15bc9f9391ba1e7e98c849','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('final UI153 performance-qualified presentation runtime retains the reviewed 24-read contract',t=>{const r=check(ui153FinalFixture(t),'23bae53f08554d8a4a15bc9f9391ba1e7e98c849');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('final UI153 rejects a changed private target',t=>{const d=ui153FinalFixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'23bae53f08554d8a4a15bc9f9391ba1e7e98c849').status,0)});

function ui153VisualFixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ui153-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','c847782d345b9d880cc44ce8b67826082eb8b5ae','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('visual UI153 performance-qualified presentation runtime retains the reviewed 24-read contract',t=>{const r=check(ui153VisualFixture(t),'c847782d345b9d880cc44ce8b67826082eb8b5ae');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('visual UI153 rejects a changed private target',t=>{const d=ui153VisualFixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'c847782d345b9d880cc44ce8b67826082eb8b5ae').status,0)});

function catalog154Fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog154-read-contract-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));execFileSync('git',['archive','3882727d438b52443d83c8b251449fd363b648b9','index.html','css','js'],{cwd:root,stdio:['ignore',fs.openSync(path.join(dir,'source.tar'),'w'),'pipe']});execFileSync('tar',['-xf',path.join(dir,'source.tar'),'-C',dir]);return dir;}
test('catalogue154 runtime retains the reviewed 24-read contract',t=>{const r=check(catalog154Fixture(t),'3882727d438b52443d83c8b251449fd363b648b9');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).directReads.length,24)});
test('catalogue154 rejects a changed private target',t=>{const d=catalog154Fixture(t);change(d,'js/app/application.js','get(ref(db,`accountSync/${owner}`))','get(ref(db,`users/${owner}`))');assert.notEqual(check(d,'3882727d438b52443d83c8b251449fd363b648b9').status,0)});
