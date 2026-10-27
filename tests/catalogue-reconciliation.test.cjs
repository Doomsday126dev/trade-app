const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {reconcile,loadSources}=require('../scripts/reconcile-catalogue.cjs');
const {parseGOInventory,observeInventories}=require('../scripts/catalogue-source-observation.cjs');
const now=new Date('2026-10-27T12:00:00Z');
function inputs(){return{sources:{manifest:{importedAt:now.toISOString(),sources:[{id:'normal-inventory',observedAt:now.toISOString()},{id:'shiny-inventory',observedAt:now.toISOString()},{id:'max-inventory',observedAt:now.toISOString()},{id:'pokemod',observedAt:now.toISOString(),commit:'fixture'}]},issues:[],data:{'normal-inventory':[{no:999,name:'New Species',source:'https://www.serebii.net/pokemongo/gen9pokemon.shtml',sourceSprite:'https://www.serebii.net/pokemongo/pokemon/999.png',availabilityClaim:'listed-without-unavailable-marker'}],'shiny-inventory':[],'max-inventory':[],pokemod:{tree:[]}}},identities:{all:[],database:{dynamax:[]}},art:{entries:[]},forms:{records:[]},now};}
test('a whole new identity, ambiguous alias and missing art all remain open independently of app seeds',()=>{
 const input=inputs();let result=reconcile(input);assert.equal(result.coverage['normal-inventory'].unmatched,1);assert.ok(result.queue.some(r=>r.name==='New Species'&&r.disposition==='unmatched-identity'));
 input.identities.all=[{no:999,name:'New Species',catalogId:'one'},{no:999,name:'Species New',catalogId:'two'}];result=reconcile(input);assert.equal(result.coverage['normal-inventory'].ambiguous,1);assert.ok(result.queue.some(r=>r.disposition==='ambiguous-identity'&&r.matches.length===2));
 input.art.entries=[{no:999,names:['New Species'],status:'unavailable'}];input.dispositions=[{id:'missing-art:999:New Species',reason:'No art yet',sources:['https://example.test/evidence'],disposition:'unavailable'}];result=reconcile(input);assert.ok(result.queue.some(r=>r.id==='missing-art:999:New Species'&&r.priority==='urgent'&&r.disposition==='owner-attention-required'));assert.notEqual(result.status,'reconciled');
 input.art.entries=[];input.dispositions=[];input.identities.all=[input.identities.all[0]];input.forms.records=[{no:999,speciesId:999,id:999,name:'New Species',aliases:[]}];input.verifiedArt=[{no:999,status:'verified-bytes',decoded:true}];input.sources.data['normal-inventory'].push({...input.sources.data['normal-inventory'][0],sourceSprite:'https://www.serebii.net/pokemongo/pokemon/999-costume.png'});result=reconcile(input);assert.equal(result.queue.filter(r=>r.disposition==='ambiguous-source-label').length,2);assert.notEqual(result.status,'reconciled');
});
test('source parser preserves form qualifiers outside name links and fails on empty/challenge responses',()=>{
 const row=(file,label)=>`<img src="/pokemongo/pokemon/${file}.png"><td class="fooinfo"><a href="/pokemongo/pokemon/571.shtml">Zoroark</a>${label}</td>`;
 const rows=parseGOInventory(row('571',' (Normal Form)')+row('571-h',' (Hisuian Form)'),'https://www.serebii.net/pokemongo/gen5pokemon.shtml','normal');assert.deepEqual(rows.map(r=>r.name),['Zoroark (Normal Form)','Zoroark (Hisuian Form)']);assert.throws(()=>parseGOInventory('<html>challenge</html>','https://www.serebii.net/','normal'),/No GO sprite rows/);
});
test('modified inventory hashes and stale observations are explicit source failures',()=>{
 const valid=loadSources(now);assert.deepEqual(valid.issues,[]);
 const corrupt=loadSources(now,file=>String(file).endsWith('/normal-inventory.json')?Buffer.from('[]'):fs.readFileSync(file));assert.ok(corrupt.issues.some(r=>r.source==='normal-inventory'&&r.kind==='source-integrity-failed'));
 assert.ok(loadSources(new Date('2026-11-10')).issues.some(r=>r.kind==='stale-or-failed-source'));
});
test('403 responses are recorded once per source without retries or success from cached data',async()=>{
 const calls=[];const input=inputs().sources;input.data['shiny-inventory']=[{no:999,name:'New Species',source:'https://www.serebii.net/pokemongo/shiny.shtml'}];input.data['max-inventory']=[{no:999,name:'New Species',source:'https://www.serebii.net/pokemongo/maxbattles.shtml'}];
 const result=await observeInventories(input,{now,fetchImpl:async url=>{calls.push(url);return{ok:false,status:403};}});assert.equal(calls.length,6);assert.equal(new Set(calls).size,calls.length);assert.equal(result.issues.length,6);assert.equal(result.data['normal-inventory'].length,1);assert.equal(reconcile({...inputs(),sources:result}).status,'source-failure');
});
