const {test}=require('node:test');
const assert=require('node:assert/strict');
const {select,qualifiedReviewBase}=require('../scripts/select-product-checks.cjs');
test('documentation-only PR avoids browser, Functions and sync suites',()=>{
  const plan=select(['docs/product-audit/README.md']);assert.equal(plan.browser.length,0);assert.equal(plan.commands.length,0);assert.equal(plan.node.length,1);
});
test('shared application edits select owning sync and privacy contracts plus affected Chromium journeys',()=>{
  const plan=select(['js/app/application.js']);
  for(const name of ['account-sync-runtime','account-sync-repository','my-list-sync-safety','provider-privacy','public-share-publication'])assert.ok(plan.node.includes(`tests/${name}.test.cjs`));
  assert.ok(plan.browser.includes('tests/trusted-readiness.spec.js'));assert.ok(plan.browser.includes('tests/anonymous-public-share.spec.js'));
  assert.equal(plan.commands.length,0);assert.ok(!plan.node.some(file=>/operator/.test(file)));
});
test('Rules and Functions changes cannot receive UI-only qualification',()=>{
  assert.ok(select(['tests/firebase/database.rules.json']).commands.some(([,args])=>args.includes('check:sec02-production-rules')));
  assert.ok(select(['functions/index.js']).commands.some(([,args])=>args.includes('check:contract')));
  const firestore=select(['tests/firebase/firestore.rules']);
  assert.ok(firestore.commands.some(([,args])=>args.includes('check:e1-firestore-authority')));
  assert.ok(!firestore.commands.some(([,args])=>args.includes('check:sec02-production-rules')));
});
test('unrelated documentation skips expensive performance while runtime changes retain it',()=>{
  assert.equal(select(['docs/product-audit/README.md']).performance,false);
  for(const file of ['js/app/application.js','css/app.css','sw.js','package-lock.json'])assert.equal(select([file]).performance,true,file);
});
test('service-worker edits retain release integrity contracts',()=>{
  assert.ok(select(['sw.js']).node.includes('tests/service-worker-release.test.cjs'));
});
test('deep browser inventories and provider operator are never selected merely by file name',()=>{
  const plan=select(['tests/my-list-performance.spec.js','tests/provider-privacy.spec.js','tests/provider-identity-operator.test.cjs']);
  assert.equal(plan.browser.length,0);assert.equal(plan.node.length,1);
});
test('public payload changes select only their owning server and emulator checks with prerequisites',()=>{
  const plan=select(['functions/e1-authority-service/providerPublicProjection.js','tests/firebase/database.rules.provider-public-projection.json']);
  assert.equal(plan.functions,true);assert.equal(plan.rules,true);
  assert.equal(plan.commands.length,2);
  assert.ok(!plan.commands.some(([,args])=>args.includes('check:contract')));
  assert.ok(!plan.node.some(file=>file.startsWith('tests/firebase/')));
});
test('incremental qualification inherits only a successful predecessor on unchanged ancestry',()=>{
  const base='a'.repeat(40),previous='b'.repeat(40);
  assert.equal(qualifiedReviewBase({base,previous,passed:true,isAncestor:()=>true}),previous);
  for(const options of [{passed:false,isAncestor:()=>true},{passed:true,isAncestor:()=>false},{passed:true,previous:'invalid',isAncestor:()=>true}])assert.equal(qualifiedReviewBase({base,previous,...options}),base);
});
test('normal eligibility edits select exact admission and Chromium proof without unrelated artwork or backend suites',()=>{
  const plan=select(['js/app/application.js','js/data/accountSyncRuntime.js','tests/account-sync-eligibility.test.cjs']);
  assert.ok(plan.node.includes('tests/account-sync-eligibility.test.cjs'));assert.ok(plan.browser.includes('tests/normal-sync-product.spec.js'));
  assert.equal(plan.commands.length,0);assert.ok(!plan.node.some(file=>/sprite|events|catalog/.test(file)));
});
test('legacy fencing selects isolated reset dependencies, operator, Rules and named recovery journey',()=>{
  const plan=select(['functions/legacy-pin-reset/reset.js','tests/firebase/database.rules.legacy-identity-fences.json','tests/account-sync-runtime.test.cjs']);
  assert.equal(plan.legacyReset,true);assert.equal(plan.functions,false);assert.equal(plan.rules,true);
  assert.ok(plan.node.includes('tests/legacy-slot-reconciliation-evidence.test.cjs'));
  assert.ok(plan.commands.some(([,args])=>args.includes('scripts/check-legacy-identity-fences.sh')));
  assert.ok(plan.commands.some(([,args])=>args.includes('functions/legacy-pin-reset')));
  assert.ok(!plan.node.includes('tests/account-sync-runtime.test.cjs'));
  assert.ok(!plan.commands.some(([,args])=>args.includes('check:contract')||args.includes('check:sec02-production-rules')));
  assert.ok(!plan.node.some(file=>/provider/.test(file)));
});
test('legacy exemption never suppresses unrelated runtime, backend or Rules coverage',()=>{
  for(const extra of ['js/data/accountSyncRuntime.js','tests/account-sync-product.test.cjs']){
    const plan=select(['functions/legacy-pin-reset/reset.js','tests/account-sync-runtime.test.cjs',extra]);
    assert.ok(plan.node.includes('tests/account-sync-runtime.test.cjs'));
  }
  const plan=select(['functions/legacy-pin-reset/reset.js','functions/index.js','tests/firebase/database.rules.json']);
  assert.equal(plan.functions,true);assert.ok(plan.commands.some(([,args])=>args.includes('check:contract')));
  assert.ok(plan.commands.some(([,args])=>args.includes('check:sec02-production-rules')));
});

test('release routing selects existing permanent checks including lifecycle and workflow ownership',()=>{
  const fs=require('node:fs');
  for(const file of ['sw.js','release/current.json','scripts/select-product-checks.cjs','.github/workflows/pages-release-control.yml']){
    const plan=select([file]);
    assert.deepEqual(plan.errors,[]);
    for(const check of plan.node)assert.ok(fs.existsSync(check),check);
    for(const name of ['release','atomic-install','cache-lifecycle','deployment-rollback','install-performance']){
      assert.ok(plan.node.includes(`tests/service-worker-${name}.test.cjs`),`${file}: ${name}`);
    }
  }
});

test('changed backend tests self-select with Functions dependencies, even for unknown names',()=>{
  for(const file of ['functions/test/e1-rate-limit.test.cjs','functions/test/e1-provider-public-share.test.cjs','functions/test/new-suite.test.cjs']){
    const plan=select([file],{exists:()=>true});
    assert.ok(plan.node.includes(file)||plan.commands.some(([,args])=>args.includes(file)),file);
    assert.equal(plan.functions,true);assert.deepEqual(plan.errors,[]);
  }
});

test('deletion retains source ownership while removing deleted test and syntax arguments',()=>{
  for(const [deleted,expected]of [
    ['js/data/accountSyncRuntime.js','tests/account-sync-runtime.test.cjs'],
    ['tests/account-sync-runtime.test.cjs','tests/account-sync-repository.test.cjs'],
    ['tests/service-worker-release.test.cjs','tests/service-worker-atomic-install.test.cjs'],
    ['functions/test/e1-rate-limit.test.cjs','functions/test/e1-reserve-trainer-handle.test.cjs'],
    ['functions/test/e1-provider-public-share.test.cjs','functions/test/e1-provider-public-share-gateway.test.cjs']
  ]){
    const plan=select([deleted],{exists:file=>file!==deleted});
    assert.ok(plan.node.includes(expected),`${deleted}: ${expected}`);
    assert.deepEqual(plan.errors,[]);
    assert.ok(!plan.node.includes(deleted));assert.ok(!plan.syntax.includes(deleted));
    assert.ok(!plan.commands.some(([,args])=>args.includes(deleted)));
  }
});

test('unmapped test, browser, helper and source deletions fail closed even alongside known changes',()=>{
  for(const deleted of ['functions/test/unknown.test.cjs','tests/unknown.test.cjs','tests/unknown.spec.js','tests/helpers/unknown.cjs','assets/unknown.json']){
    const plan=select([deleted,'sw.js'],{exists:file=>file!==deleted});
    assert.ok(plan.errors.some(error=>error.includes(deleted)),deleted);
    assert.ok(!plan.node.includes(deleted));assert.ok(!plan.browser.includes(deleted));
  }
  assert.deepEqual(select(['docs/obsolete.md'],{exists:()=>false}).errors.filter(error=>error.includes('Deleted')),[]);
});

test('missing unchanged owners and deletion of all companions are explicit qualification failures',()=>{
  const missing='tests/service-worker-release.test.cjs';
  assert.ok(select(['sw.js'],{exists:file=>file!==missing}).errors.includes(`Required check is missing: ${missing}`));
  const deleted=['functions/test/e1-provider-public-share.test.cjs','functions/test/e1-provider-public-share-gateway.test.cjs'];
  const plan=select(deleted,{exists:file=>!deleted.includes(file)});
  assert.ok(plan.errors.length>0);
  assert.ok(!plan.commands.some(([,args])=>args.length===1&&args[0]==='--test'));
});

test('Git discovery includes deletions, both rename owners, type changes and literal unusual filenames',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {execFileSync}=require('node:child_process');
  const {changedFiles}=require('../scripts/select-product-checks.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'product-diff-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{
    git('init');git('config','user.name','Selector test');git('config','user.email','selector@example.test');
    for(const file of ['deleted.test.cjs','old.js','typed.js','modified.js','space and\nnewline.js'])fs.writeFileSync(path.join(dir,file),'original\n');
    git('add','.');git('-c','commit.gpgsign=false','commit','-m','base');const base=git('rev-parse','HEAD');
    fs.unlinkSync(path.join(dir,'deleted.test.cjs'));fs.renameSync(path.join(dir,'old.js'),path.join(dir,'new.js'));
    fs.unlinkSync(path.join(dir,'typed.js'));fs.symlinkSync('new.js',path.join(dir,'typed.js'));
    for(const file of ['modified.js','space and\nnewline.js','added.js'])fs.writeFileSync(path.join(dir,file),'changed\n');
    git('add','-A');git('-c','commit.gpgsign=false','commit','-m','changes');
    const files=changedFiles(base,{cwd:dir});
    assert.deepEqual(files.sort(),['deleted.test.cjs','old.js','new.js','typed.js','modified.js','space and\nnewline.js','added.js'].sort());
    assert.ok(select(files,{exists:file=>fs.existsSync(path.join(dir,file))}).errors.some(error=>error.includes('deleted.test.cjs')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('backend helper edits and deletions select their declared consumer suites',()=>{
  for(const [helper,test]of [['functions/test/helpers.cjs','functions/test/tags.test.cjs'],['functions/test/helpers/groupEFixture.cjs','functions/test/e1-group-e-admission.test.cjs']]){
    for(const deleted of [false,true]){
      const plan=select([helper],{exists:file=>!deleted||file!==helper});
      assert.ok(plan.node.includes(test));assert.equal(plan.functions,true);assert.deepEqual(plan.errors,[]);
    }
  }
  assert.ok(select(['functions/test/helpers/new.cjs'],{exists:()=>true}).errors.some(error=>error.includes('declared consumers')));
});

test('boot entrypoints and release inventories retain runtime absence and offline route proofs',()=>{
  for(const file of ['index.html','sw.js','js/app/application.js','scripts/pages/frontend-files.json']){
    const plan=select([file]);
    assert.ok(plan.node.includes('tests/signed-in-boot-dependencies.test.cjs'),file);
    assert.ok(plan.browser.includes('tests/signed-in-boot-dependencies.spec.js'),file);
  }
});

test('offline archive tooling selects its proof without browser, Firebase, identity-history or performance work',()=>{
  for(const file of ['scripts/archive-proof/format.cjs','scripts/archive-proof/fixtures/synthetic-source.cjs','docs/verification/archive-proof/archive-v1.schema.json']){
    const plan=select([file]);
    assert.ok(plan.node.includes('tests/offline-archive-restore.test.cjs'),file);
    assert.deepEqual(plan.browser,[]);assert.deepEqual(plan.commands,[]);
    assert.equal(plan.functions,false);assert.equal(plan.rules,false);assert.equal(plan.legacyReset,false);assert.equal(plan.performance,false);
  }
});

test('isolated Favorite backend and Rules use their dedicated qualification without routing through provider infrastructure',()=>{
  const plan=select(['functions/favorite-resolver/index.js','tests/firebase/database.rules.favorite-resolver.json']);
  assert.equal(plan.commands.some(([,args])=>args.includes('check:contract')||args.includes('check:sec02-production-rules')),false);
});
