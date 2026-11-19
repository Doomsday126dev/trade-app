'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/favoritePickerModel.js','utf8'),{window});const create=window.PogoDomain.favoritePickerModel.createFavoritePickerModel;
test('Select all includes preserved names as deliberate new additions while excluding self and confirmed',()=>{
 const model=create({names:['Self','Saved','Preserved',...Array.from({length:60},(_,i)=>'Trainer'+i)],self:'Self',existing:['Saved'],preserved:['Preserved'],remaining:70});
 assert.equal(model.snapshot().resultCount,62);assert.equal(model.snapshot().selectAllCount,60);assert.equal(model.snapshot().rows.find(row=>row.name==='Preserved').selectable,true);model.toggle('Preserved');assert.equal(JSON.stringify(model.snapshot().selected),JSON.stringify(['Preserved']));model.clear();model.search('Trainer');model.selectAll();assert.equal(model.snapshot().selected.length,60);model.go(2);assert.ok(model.snapshot().rows.every(row=>row.selected));model.search('Trainer1');assert.equal(model.snapshot().selected.length,60);assert.equal(model.snapshot().resultCount,11);model.clear();model.selectAll();assert.equal(model.snapshot().selected.length,11);model.search('');assert.equal(model.snapshot().selected.length,11);
});
test('over-capacity selection is retained without truncation; pending/failed work is never presented as confirmed',()=>{
 const model=create({names:['A','B','C','D'],self:'Self',remaining:1,intents:[{handle:'A',state:'pending'},{handle:'B',state:'unsuccessful'}],existing:['A','B']});
 model.selectAll();assert.equal(model.snapshot().selected.length,3);assert.equal(model.snapshot().overCapacity,true);assert.equal(model.snapshot().rows[0].status,'pending');assert.equal(model.snapshot().rows[1].status,'unsuccessful');model.update({intents:[{handle:'B',state:'confirmed'}],existing:['B'],remaining:1});assert.equal(model.snapshot().selected.includes('B'),false);
});
test('mixed results separate identity, resolver, and save failures without retrying unverified names in bulk',()=>{
 const model=create({names:['Confirmed','Unverified','Busy','Unsaved','Pending','Untouched']});
 model.search('Unverified');model.selectAll();model.search('');
 model.toggle('Busy');model.toggle('Unsaved');model.toggle('Pending');model.toggle('Confirmed');
 const rows=[
  {handle:'Confirmed',state:'confirmed'},
  {handle:'Unverified',state:'unsuccessful',code:'favorite/identity-unavailable'},
  {handle:'Busy',state:'unsuccessful',code:'favorite/rate-limited'},
  {handle:'Unsaved',state:'unsuccessful',code:'account-sync/conflict'},
  {handle:'Pending',state:'pending',code:'account-sync/network-failed'}
 ];
 model.update({intents:rows,remaining:99});
 model.unselectUnverified(rows);
 let state=model.snapshot();
 assert.deepEqual(Array.from(state.selected),['Busy','Unsaved','Pending']);
 assert.equal(state.rows.find(row=>row.name==='Confirmed').status,'already-present');
 assert.equal(state.rows.find(row=>row.name==='Pending').failure,'');
 assert.equal(state.rows.find(row=>row.name==='Unverified').failure,'notVerified');
 assert.equal(state.rows.find(row=>row.name==='Busy').failure,'checkFailed');
 assert.equal(state.rows.find(row=>row.name==='Unsaved').failure,'saveFailed');
 model.clear();model.selectAll();
 assert.deepEqual(Array.from(model.snapshot().selected),['Busy','Unsaved','Untouched']);
 model.toggle('Unverified');model.update({intents:rows});
 assert.equal(model.snapshot().selected.includes('Unverified'),true,'a deliberate individual recheck survives refreshing the dialog');
 model.update({intents:[...rows,{handle:'Unverified',state:'confirmed'}]});
 assert.equal(model.snapshot().selected.includes('Unverified'),false);
});
test('resolver and journal errors never expose their raw reason through the picker',()=>{
 const classify=window.PogoDomain.favoritePickerModel.failureKind;
 for(const code of ['favorite/network-failed','favorite/busy','favorite/unavailable','favorite/quota-unavailable','favorite/response-invalid','favorite/request-invalid','favorite/auth-required'])assert.equal(classify({state:'unsuccessful',code}),'checkFailed');
 for(const code of ['account-sync/conflict','favorite/removed','unexpected-sensitive-diagnostic'])assert.equal(classify({state:'unsuccessful',code}),'saveFailed');
 assert.equal(classify({state:'pending',code:'favorite/network-failed'}),'');
 assert.equal(classify(undefined),'');
});
