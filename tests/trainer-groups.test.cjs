const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('js/domain/tradeListComparison.js','utf8'),{window});
const {groupWants}=window.PogoDomain.tradeListComparison,now=2000000000000;
const entry=(extra={})=>({intent:'lf',name:'Pikachu',type:'wishlist',p:'H',...extra});
const member=(key,extra={})=>({key,displayName:key,status:'published',fetchedAt:now,updatedAt:now,entries:[entry()],...extra});
test('who wants separates explicit species breadth from exact published variants without fallback',()=>{
  const {whoWants,wantedIntentKey}=window.PogoDomain.tradeListComparison;
  const entries=[entry({no:25}),entry({no:25,shiny:true,gender:'f'}),entry({no:25,type:'gmax'}),entry({no:25,name:'Pikachu (Costume)',mod:'unknown detail'}),entry({no:133,name:'Eevee'}),entry({no:25,intent:'ft'})];
  const broad=whoWants(entries,{selected:{name:'Pikachu',no:25}});assert.equal(broad.entries.length,4);assert.equal(broad.exact,false);
  const key=wantedIntentKey(entries[1]);const exact=whoWants(entries,{selected:{no:25},variantKey:key});assert.equal(exact.entries.length,1);assert.equal(exact.entries[0].gender,'f');
  assert.equal(whoWants(entries.filter(e=>!e.shiny),{selected:{no:25},variantKey:key}).entries.length,0);
  assert.equal(whoWants(entries).entries.length,0);
  assert.equal(whoWants(entries,{selected:{name:'Unknown'}}).entries.length,0);
  const permitted=groupWants([member('private',{status:'not_published',entries}),member('expired',{fetchedAt:now-300001,entries}),member('old',{updatedAt:now-31*86400000,entries})],{now});
  assert.equal(whoWants(permitted.entries,{selected:{no:25}}).entries.every(e=>e.members.length===1&&e.members[0].key==='old'),true);
});
test('aggregate preserves exact variants and trainer attribution, excludes FT and inactive BG',()=>{
  const result=groupWants([member('A',{entries:[entry(),entry({shiny:true}),entry({intent:'ft',name:'Mewtwo'})]}),member('B',{entries:[entry({p:'M',backgroundId:'old-test-bg'})]})],{now});
  assert.equal(result.entries.length,2);assert.equal(result.entries[0].members.length,2);assert.equal(result.entries[0].backgroundId,'');
  const top=groupWants([member('A'),member('B',{entries:[entry({p:'M'})]})],{now,scope:'top'});
  assert.equal(top.entries[0].members.length,1);assert.equal(top.entries[0].members[0].key,'A');
});
test('access expiration excludes results but publication age does not revoke public wants',()=>{
  const result=groupWants([member('private',{status:'not_published'}),member('expired',{fetchedAt:now-300001}),member('old',{updatedAt:now-31*86400000}),member('unknown',{updatedAt:null}),member('future',{updatedAt:now+1})],{now});
  assert.equal(result.members.length,5);assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].members.length,3);
  assert.equal(result.members.filter(member=>member.status==='available'&&member.aged).length,3);
});
test('new scopes distinguish first check, additions, promotions, removals and exact variants',()=>{
  const {wantsChanges}=window.PogoDomain.tradeListComparison;
  assert.equal(wantsChanges([entry()]).first,true);
  assert.equal(wantsChanges([entry()]).added.length,0);
  const before=[entry({p:'L'}),entry({name:'Snom'})];
  const current=[entry(),entry({shiny:true})];
  const result=wantsChanges(current,before);
  assert.equal(result.added.length,1);assert.equal(result.newTop.length,2);assert.equal(result.removed,1);
  assert.equal(groupWants([member('A',{entries:current,previous:before})],{now,scope:'new'}).entries.length,2);
  assert.equal(wantsChanges(current,current).updated,false);
});
test('existing history retains Favorite baselines beyond recents, fences target identity and does not advance on open',()=>{
  for(const file of ['js/domain/productLimits.js','js/data/trainerHistoryStore.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window});
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const store=window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage,identity:{uid:'owner',username:'Owner'},now:()=>now});
  store.saveFavoriteOrganization('A',{targetUid:'target'});
  const snapshot={lists:{wishlist:{Pikachu:'H'}},updatedAt:now};
  assert.equal(store.rememberChecked('A',snapshot,{seenAt:now,targetUid:'wrong'}).ok,false);
  assert.equal(store.rememberChecked('A',snapshot,{seenAt:now,targetUid:'target'}).ok,true);
  for(let n=0;n<8;n++)store.rememberOpened('Other'+n,snapshot,now+n);
  store.rememberOpened('A',{lists:{wishlist:{Snom:'L'}}},now+10);
  assert.equal(store.snapshotFor('A').snapshot.lists.wishlist.Pikachu,'H');
  assert.equal(store.rememberChecked('A',snapshot,{seenAt:now-1,targetUid:'target'}).ok,false);
  const other=window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage,identity:{uid:'other',username:'Other'}});
  assert.equal(other.snapshotFor('A'),null);
});
test('Favorite history stays bounded and quota failures cannot acknowledge unseen data',()=>{
  const values=new Map();let fail=false;
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>{if(fail)throw new Error('quota');values.set(key,value);}};
  const store=window.PogoData.trainerHistoryStore.createTrainerHistoryStore({storage,identity:{uid:'bounded',username:'Owner'},now:()=>now});
  const snapshot={lists:{wishlist:{Pikachu:'H'}},padding:'x'.repeat(500000)};
  for(let n=0;n<5;n++){store.saveFavoriteOrganization('T'+n);assert.equal(store.rememberChecked('T'+n,snapshot,{seenAt:now+n}).ok,true);}
  assert.equal(Object.keys(store.read().snapshots).length,4);assert.equal(store.snapshotFor('T0'),null);
  const before=JSON.stringify(store.snapshotFor('T4'));fail=true;
  assert.equal(store.rememberChecked('T4',{lists:{}},{seenAt:now+10}).ok,false);
  assert.equal(JSON.stringify(store.snapshotFor('T4')),before);
});
test('empty scopes and source data remain unchanged',()=>{
  const data=[member('A',{entries:[entry({p:'L'})]})],before=JSON.stringify(data);
  assert.equal(groupWants(data,{now,scope:'top'}).entries.length,0);assert.equal(JSON.stringify(data),before);
});
