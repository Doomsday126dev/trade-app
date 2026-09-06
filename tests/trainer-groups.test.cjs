const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/tradeListComparison.js','utf8'),{window});
const {groupWants}=window.PogoDomain.tradeListComparison,now=2000000000000;
const entry=(extra={})=>({intent:'lf',name:'Pikachu',type:'wishlist',p:'H',...extra});
const member=(key,extra={})=>({key,displayName:key,status:'published',fetchedAt:now,updatedAt:now,entries:[entry()],...extra});
test('aggregate preserves exact variants and trainer attribution, excludes FT and inactive BG',()=>{
  const result=groupWants([member('A',{entries:[entry(),entry({shiny:true}),entry({intent:'ft',name:'Mewtwo'})]}),member('B',{entries:[entry({p:'M',backgroundId:'old-test-bg'})]})],{now});
  assert.equal(result.entries.length,2);assert.equal(result.entries[0].members.length,2);assert.equal(result.entries[0].backgroundId,'');
  const top=groupWants([member('A'),member('B',{entries:[entry({p:'M'})]})],{now,scope:'top'});
  assert.equal(top.entries[0].members.length,1);assert.equal(top.entries[0].members[0].key,'A');
});
test('private, expired, old, unknown-timestamp and future members remain visible but never contribute',()=>{
  const result=groupWants([member('private',{status:'not_published'}),member('expired',{fetchedAt:now-300001}),member('old',{updatedAt:now-31*86400000}),member('unknown',{updatedAt:null}),member('future',{updatedAt:now+1})],{now});
  assert.equal(result.members.length,5);assert.equal(result.entries.length,0);
});
test('empty scopes and source data remain unchanged',()=>{
  const data=[member('A',{entries:[entry({p:'L'})]})],before=JSON.stringify(data);
  assert.equal(groupWants(data,{now,scope:'top'}).entries.length,0);assert.equal(JSON.stringify(data),before);
});
