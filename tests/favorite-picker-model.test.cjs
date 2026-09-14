'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/favoritePickerModel.js','utf8'),{window});const create=window.PogoDomain.favoritePickerModel.createFavoritePickerModel;
test('Select all includes later matching pages, retains exact selection across searches and excludes self/confirmed/preserved',()=>{
 const model=create({names:['Self','Saved','Preserved',...Array.from({length:60},(_,i)=>'Trainer'+i)],self:'Self',existing:['Saved'],preserved:['Preserved'],remaining:70});
 assert.equal(model.snapshot().resultCount,62);assert.equal(model.snapshot().selectAllCount,60);model.search('Trainer');model.selectAll();assert.equal(model.snapshot().selected.length,60);model.go(2);assert.ok(model.snapshot().rows.every(row=>row.selected));model.search('Trainer1');assert.equal(model.snapshot().selected.length,60);assert.equal(model.snapshot().resultCount,11);model.clear();model.selectAll();assert.equal(model.snapshot().selected.length,11);model.search('');assert.equal(model.snapshot().selected.length,11);
});
test('over-capacity selection is retained without truncation; pending/failed work is never presented as confirmed',()=>{
 const model=create({names:['A','B','C','D'],self:'Self',remaining:1,intents:[{handle:'A',state:'pending'},{handle:'B',state:'unsuccessful'}],existing:['A','B']});
 model.selectAll();assert.equal(model.snapshot().selected.length,3);assert.equal(model.snapshot().overCapacity,true);assert.equal(model.snapshot().rows[0].status,'pending');assert.equal(model.snapshot().rows[1].status,'unsuccessful');model.update({intents:[{handle:'B',state:'confirmed'}],existing:['B'],remaining:1});assert.equal(model.snapshot().selected.includes('B'),false);
});
