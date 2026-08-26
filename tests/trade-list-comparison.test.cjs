const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const window={};
for(const file of ['js/domain/priorityValues.js','js/domain/tradeListComparison.js']){
  vm.runInNewContext(readFileSync(path.join(root,file),'utf8'),{window});
}
const comparison=window.PogoDomain.tradeListComparison;
const key=value=>String(value||'').toLowerCase();
const compare=lists=>comparison.compareWantedLists(lists,{
  nameKey:key,
  normalizeQualifier:window.PogoDomain.priorityValues.normalizeTradeQualifier
});
const entry=(name,extra={})=>({key:`${name}-${Math.random()}`,name,dn:name,no:25,...extra});

test('Blaze Tauros and Shedinja fixture is a wanted-list set comparison',()=>{
  const result=compare({
    myWants:[entry('Paldean Tauros (Blaze)',{type:'wishlist'}),entry('Shedinja',{type:'wishlist'})],
    theirWants:[entry('Paldean Tauros (Blaze)',{type:'wishlist'}),entry('Rotom (Frost)',{type:'wishlist'})]
  });
  assert.deepEqual(Array.from(result.both,item=>item.name),['Paldean Tauros (Blaze)']);
  assert.deepEqual(Array.from(result.onlyMine,item=>item.name),['Shedinja']);
  assert.deepEqual(Array.from(result.onlyTheirs,item=>item.name),['Rotom (Frost)']);
});

test('expressed wanted identity distinguishes background, shiny, form, gender, and size qualifiers',()=>{
  const result=compare({
    myWants:[entry('Paldean Tauros (Blaze)',{type:'wishlist'}),entry('Shedinja',{type:'wishlist'}),entry('Pikachu',{type:'wishlist',shiny:true}),entry('Rayquaza',{type:'wishlist',backgroundId:'new-york-city-2024'})],
    theirWants:[entry('Paldean Tauros (Blaze)',{type:'wishlist'}),entry('Rotom (Frost)',{type:'wishlist'}),entry('Pikachu',{type:'wishlist',shiny:true}),entry('Rayquaza',{type:'wishlist',backgroundId:'osaka-2023'})]
  });
  assert.deepEqual(Array.from(result.both,item=>item.name),['Paldean Tauros (Blaze)','Pikachu']);
  assert.deepEqual(Array.from(result.onlyMine,item=>[item.name,item.backgroundId]),[['Shedinja',''],['Rayquaza','new-york-city-2024']]);
  assert.deepEqual(Array.from(result.onlyTheirs,item=>[item.name,item.backgroundId]),[['Rotom (Frost)',''],['Rayquaza','osaka-2023']]);
  for(const [mine,theirs] of [
    [entry('Pikachu',{type:'wishlist'}),entry('Pikachu',{type:'wishlist',shiny:true})],
    [entry('Pikachu',{type:'wishlist'}),entry('Pikachu',{type:'wishlist',mod:'F',gender:'f'})],
    [entry('Pikachu',{type:'wishlist'}),entry('Pikachu',{type:'wishlist',backgroundId:'new-york-city-2024'})],
    [entry('Rotom',{type:'wishlist'}),entry('Rotom (Frost)',{type:'wishlist'})],
    [entry('Pikachu',{type:'wishlist',xxl:true}),entry('Pikachu',{type:'wishlist',xxs:true})]
  ]){
    const compared=compare({myWants:[mine],theirWants:[theirs]});
    assert.equal(compared.both.length,0);
    assert.equal(compared.onlyMine.length,1);
    assert.equal(compared.onlyTheirs.length,1);
  }
});

test('priority and duplicate storage paths do not split the same expressed wanted identity',()=>{
  const result=compare({
    myWants:[entry('Pikachu',{type:'wishlist',p:'H',shiny:true}),entry('Pikachu',{type:'wishlist',p:'L',shiny:true})],
    theirWants:[entry('Pikachu',{type:'wishlist',p:'M',shiny:true})]
  });
  assert.equal(result.both.length,1);
  assert.equal(result.onlyMine.length,0);
  assert.equal(result.onlyTheirs.length,0);
});

test('offers, inventory, and quantities cannot influence wanted-list comparison',()=>{
  const lists={myWants:[entry('Shedinja',{type:'wishlist'})],theirWants:[entry('Rotom (Frost)',{type:'wishlist'})]};
  const baseline=compare(lists);
  const noisy=compare({...lists,myOffers:[entry('Rotom (Frost)')],theirOffers:[entry('Shedinja')],inventory:{Shedinja:{qty:999}}});
  assert.deepEqual(JSON.parse(JSON.stringify(noisy)),JSON.parse(JSON.stringify(baseline)));
});

test('the comparison module contains no retired inventory or quantity contract',()=>{
  const source=readFileSync(path.join(root,'js/domain/tradeListComparison.js'),'utf8');
  assert.doesNotMatch(source,/inventory|\bqty\b|quantity|offer|mirror/i);
});
