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
