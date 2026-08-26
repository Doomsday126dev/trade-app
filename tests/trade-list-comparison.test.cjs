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
const priorities=window.PogoDomain.priorityValues;
const comparison=window.PogoDomain.tradeListComparison;
const key=value=>String(value||'').toLowerCase();
const compare=lists=>comparison.compareTradeLists(lists,{
  nameKey:key,
  matchesIntent:(want,offer)=>priorities.matchesTradeIntent(want,offer),
  normalizeQualifier:priorities.normalizeTradeQualifier
});
const entry=(name,extra={})=>({key:`${name}-${Math.random()}`,name,dn:name,no:25,...extra});

test('directional sections are derived only from wants and explicit offers',()=>{
  const result=compare({
    myWants:[entry('Pikachu',{p:'H'})],
    myOffers:[entry('Rayquaza')],
    theirWants:[entry('Rayquaza',{p:'M'})],
    theirOffers:[entry('Pikachu')],
    inventory:{Pikachu:{qty:999}}
  });
  assert.equal(result.theyOfferMyWants.length,1);
  assert.equal(result.iOfferTheirWants.length,1);
  assert.equal(result.theyOfferMyWants[0].intent.p,'H');
  assert.doesNotMatch(JSON.stringify(result),/qty|inventory/i);
});

test('background matching is generic for unqualified wants and exact when requested',()=>{
  assert.equal(compare({myWants:[entry('Pikachu')],theirOffers:[entry('Pikachu',{backgroundId:'new-york-city-2024'})]}).theyOfferMyWants.length,1);
  assert.equal(compare({myWants:[entry('Pikachu',{backgroundId:'new-york-city-2024'})],theirOffers:[entry('Pikachu',{backgroundId:'new-york-city-2024'})]}).theyOfferMyWants.length,1);
  assert.equal(compare({myWants:[entry('Pikachu',{backgroundId:'new-york-city-2024'})],theirOffers:[entry('Pikachu',{backgroundId:'osaka-2023'})]}).theyOfferMyWants.length,0);
  assert.equal(compare({myWants:[entry('Pikachu',{backgroundId:'new-york-city-2024'})],theirOffers:[entry('Pikachu')]}).theyOfferMyWants.length,0);
});

test('existing shiny, gender, and canonical form intent remains fail closed',()=>{
  assert.equal(compare({myWants:[entry('Pikachu',{shiny:true})],theirOffers:[entry('Pikachu',{shiny:false})]}).theyOfferMyWants.length,0);
  assert.equal(compare({myWants:[entry('Pikachu',{mod:'F'})],theirOffers:[entry('Pikachu',{mod:'M'})]}).theyOfferMyWants.length,0);
  assert.equal(compare({myWants:[entry('Rotom (Fan)')],theirOffers:[entry('Rotom (Mow)')]}).theyOfferMyWants.length,0);
});

test('mirrors require exact offers and explicit mirror interest on both sides',()=>{
  const shared={backgroundId:'new-york-city-2024',shiny:true,mirror:true};
  assert.equal(compare({myOffers:[entry('Pikachu',shared)],theirOffers:[entry('Pikachu',shared)]}).mirrors.length,1);
  assert.equal(compare({myOffers:[entry('Pikachu',shared)],theirOffers:[entry('Pikachu',{...shared,mirror:false})]}).mirrors.length,0);
  assert.equal(compare({myOffers:[entry('Pikachu',shared)],theirOffers:[entry('Pikachu',{...shared,backgroundId:'osaka-2023'})]}).mirrors.length,0);
});

test('the comparison module contains no retired inventory or quantity contract',()=>{
  const source=readFileSync(path.join(root,'js/domain/tradeListComparison.js'),'utf8');
  assert.doesNotMatch(source,/inventory|\bqty\b|quantity/i);
});
