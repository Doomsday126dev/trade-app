const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const window={crypto:require('node:crypto').webcrypto};window.window=window;
vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/accountSyncModel.js'),'utf8'),{window,TextEncoder,crypto:window.crypto});
vm.runInNewContext(fs.readFileSync(path.join(root,'js/domain/accountSyncMigration.js'),'utf8'),{window});
const classify=window.PogoDomain.accountSyncMigration.classifyPreserved;

test('older unknown order does not masquerade as unsaved content, but note and background differences remain visible',()=>{
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:150'};
  const current={identity,values:{sortOrder:4,note:'current',backgroundId:'bg-b'},deleted:false};
  const candidate=(values,source='legacy-remote')=>({entityType:'tradeEntry',entityId:'entry',identity,values,source,resolved:false});
  const cases=[
    candidate({...current.values,sortOrder:100000}),
    candidate({...current.values,sortOrder:100000}),
    candidate({...current.values,note:'older',sortOrder:100000}),
    candidate({...current.values,backgroundId:'bg-a'}),
    candidate({...current.values,sortOrder:3},'legacy-remote-board'),
    candidate({...current.values})
  ];
  const result=classify(cases,()=>current);
  assert.equal(result.counts.olderOrder,2);
  assert.equal(result.counts.equivalent,1);
  assert.equal(result.counts.needsReview,3);
  assert.deepEqual([...result.items].map(item=>[item.kind,[...item.fields]]),[
    ['different',['note']],['different',['backgroundId']],['different',['sortOrder']]
  ]);
});

test('removed entries, missing entries, unresolved favorites and genuine identity changes require review',()=>{
  const cases=[
    {entityType:'tradeEntry',entityId:'removed',identity:{catalogId:'a'},values:{note:'older'}},
    {entityType:'tradeEntry',entityId:'absent',identity:{catalogId:'b'},values:{note:'older'}},
    {entityType:'favorite',entityId:'unknown',identity:{targetUid:''},values:{displayName:'Trainer'}}
  ];
  const result=classify(cases,(type,id)=>id==='removed'?{deleted:true}:null);
  assert.equal(result.counts.needsReview,3);
  assert.deepEqual([...result.items].map(item=>item.kind),['removed','missing','unresolved-favorite']);
});

test('retained list and board deletion requests remain visible even when values match',()=>{
  const identity={surface:'my-list',lane:'wishlist',catalogId:'pokemon:25'};
  const current={identity,values:{priority:'H',sortOrder:4},deleted:false};
  const candidate=reason=>({entityType:'tradeEntry',entityId:'entry',identity,values:{...current.values},source:'legacy-queue',reason,resolved:false});
  const result=classify([candidate('queued-delete-requires-review'),candidate('queued-board-delete-requires-review')],()=>current);
  assert.equal(result.counts.equivalent,0);assert.equal(result.counts.needsReview,2);
  assert.deepEqual([...result.items].map(item=>item.kind),['delete-request','delete-request']);
});
