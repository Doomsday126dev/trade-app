import test from 'node:test';
import assert from 'node:assert/strict';
import {satisfies,matches,mergeDeclarations} from './model.js';
const p={no:150,name:'Mewtwo',bg:'Chicago 2026'};
test('exact background differs from absent, any, and another exact background',()=>{
  assert(satisfies(p,{...p}));
  for(const bg of ['', 'any','Paris'])assert.equal(satisfies(p,{...p,bg}),false);
  assert(satisfies({...p,bg:'any'},p));
  assert.equal(satisfies({...p,bg:'any'},{...p,bg:'any'}),false);
});
test('shiny costume and gender cannot be replaced with base assumptions',()=>{
  assert.equal(satisfies(p,{...p,shiny:true}),false);
  assert.equal(satisfies({...p,name:'Mewtwo (Armored)'},p),false);
  assert.equal(satisfies({...p,gender:'female'},p),false);
});
test('wants-in-common are never offers; directions remain separate',()=>{
  const mine=[{...p,want:true}],theirs=[{...p,want:true}];
  assert.equal(matches(mine,theirs).receive.length,0);
  assert.equal(matches(mine,[{...p,offer:true}]).receive.length,1);
  assert.equal(matches(mine,[{...p,offer:true}]).give.length,0);
});
test('unknown background is separate from exact count and inputs are not changed',()=>{
  const mine=[{...p,want:true}],theirs=[{...p,offer:true,bg:'any'}];
  const before=JSON.stringify([mine,theirs]);const m=matches(mine,theirs);
  assert.equal(m.receive.length,0);assert.equal(m.uncertain.length,1);
  assert.equal(JSON.stringify([mine,theirs]),before);
});
test('identical declarations merge sides without collapsing collectible qualifiers',()=>{
  const values=[{...p,id:'first',want:true},{...p,id:'second',offer:true},{...p,shiny:true,want:true},{...p,max:'Dynamax',offer:true}];
  const merged=mergeDeclarations(values);
  assert.equal(merged.length,3);
  assert.equal(merged[0].id,'first');
  assert(merged[0].want && merged[0].offer);
  assert.equal(values[0].offer,undefined);
});
test('Max capability cannot silently match a different capability',()=>{
  assert.equal(satisfies({...p,max:'Gigantamax'},{...p,max:'Dynamax'}),false);
  assert(satisfies({...p,max:'Gigantamax'},{...p,max:'Gigantamax'}));
});
