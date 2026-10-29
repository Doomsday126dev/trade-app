const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {reconcile,loadSources,summarizeReview}=require('../scripts/reconcile-catalogue.cjs');
const {parseGOInventory,parseMaxInventory,observeInventories}=require('../scripts/catalogue-source-observation.cjs');
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
 const calls=[];const input=inputs().sources;input.data['shiny-inventory']=[{no:999,name:'New Species',source:'https://www.serebii.net/pokemongo/shiny.shtml'}];input.data['max-inventory']=[{no:999,name:'New Species',source:'https://www.serebii.net/pokemongo/maxbattles.shtml'}];input.data['gigantamax-inventory']=input.data['max-inventory'];
 const result=await observeInventories(input,{now,fetchImpl:async url=>{calls.push(url);return{ok:false,status:403};}});assert.equal(calls.length,6);assert.equal(new Set(calls).size,calls.length);assert.equal(result.issues.length,7);assert.equal(result.data['normal-inventory'].length,1);assert.equal(reconcile({...inputs(),sources:result}).status,'source-failure');
});

test('unparsed miner files and legacy identity ambiguity remain visible owner issues',()=>{
 const input=inputs();input.sources.data.pokemod.tree=[{path:'new-format-999.png',sha:'fixture'}];input.art.entries=[{no:999,names:['New Species'],status:'unavailable'}];input.pendingArt=[{displayIdentity:'New Species',reasonCategory:'mapping-ambiguous',candidate:{reason:'Two exact variants exist'},acceptedSourcePage:'https://example.test/variants',nextReviewAction:'Resolve the exact variant'}];const result=reconcile(input);assert.ok(result.queue.some(r=>r.disposition==='unparsed-art-filename'&&r.file.path==='new-format-999.png'));const row=result.queue.find(r=>r.id==='missing-art:999:New Species');assert.equal(row.artState,'exact-identity-ambiguous');assert.equal(row.reason,'Two exact variants exist');assert.equal(row.priority,'urgent');assert.equal(row.disposition,'owner-attention-required');
});

test('current compact runtime names reconcile without losing the open source queue',()=>{const report=require('../scripts/reconcile-catalogue.cjs').build(now);assert.equal(report.status,'review-required');assert.ok(report.queue.length>0);assert.equal(report.sourceIssues.length,0);});
test('Gigantamax section is reconciled separately without consuming Dynamax names',()=>{
 const row=(no,name)=>`<a href="/pokemongo/pokemon/${no}.shtml">${name}</a>`;const g=Array.from({length:10},(_,i)=>row(i+1,'Gmax '+i)).join('');const d=Array.from({length:100},(_,i)=>row(i+1,'Dmax '+i)).join('');const html='<h2>List of Gigantamax Capable Pokémon</h2>'+g+'<h2>List of Dynamax Capable Pokémon</h2>'+d;assert.equal(parseMaxInventory(html,'https://example.test/max','gmax').length,10);assert.equal(parseMaxInventory(html,'https://example.test/max').length,100);const input=inputs();input.sources.data['gigantamax-inventory']=[{no:999,name:'New Species',source:'https://example.test/max'}];const result=reconcile(input);assert.equal(result.coverage['gigantamax-inventory'].unmatched,1);assert.ok(result.queue.some(r=>r.id==='gigantamax:999'));
});
test('owner summary deduplicates variants while retaining every unresolved row and rejecting stale alias identity',()=>{
 const report={queue:[{id:'normal',no:999,name:'New Species',source:'normal-inventory',disposition:'unmatched-identity'},{id:'shiny',no:999,name:'New Species',source:'shiny-inventory',disposition:'unmatched-identity'}],status:'review-required'};const original=JSON.stringify(report);const reviews={schemaVersion:1,aliases:[{rowId:'normal',no:999,sourceName:'New Species',catalogId:'exact',evidence:{sourceSprite:'https://example.test/999.png'}}],missingIdentities:[{id:'missing:999',no:999,name:'New Species',sourceNames:['New Species'],releaseState:'normal-released-confirmed',shinyReleaseState:'unverified'}]};const summary=summarizeReview(report,reviews);assert.equal(summary.rawRows,2);assert.equal(summary.groupCount,1);assert.deepEqual(summary.groups[0].rows,['normal','shiny']);assert.equal(summary.actionableMissing[0].shinyReleaseState,'unverified');assert.equal(JSON.stringify(report),original);reviews.aliases[0].no=1;assert.throws(()=>summarizeReview(report,reviews),/no longer matches/);
});

test('new Shiny release evidence stays urgent even when existing identity and exact art already match',()=>{
 const input=inputs();input.sources.data['normal-inventory']=[];input.sources.data['shiny-inventory']=[{no:999,name:'New Species',sourceSprite:'https://example.test/999.png',source:'https://example.test/shiny',statusText:'Available when encountered'}];input.identities.all=[{no:999,name:'New Species',catalogId:'one'}];input.forms.records=[{id:999,speciesId:999,name:'New Species'}];input.verifiedArt=[{no:999,shiny:true,status:'verified-bytes',decoded:true}];input.eligibility=[{no:999,name:'New Species',normal:'released',shiny:'unverified'}];const result=reconcile(input);assert.equal(result.coverage['shiny-inventory'].identityMatched,1);assert.ok(result.queue.some(r=>r.disposition==='variant-release-evidence-review-required'&&r.priority==='urgent'));assert.equal(result.status,'review-required');
});

test('reviewed missing identity counts cannot retain an already integrated exact canonical label',()=>{
 const {loadIdentities,identityKey}=require('../scripts/reconcile-catalogue.cjs');const {all}=loadIdentities(),reviews=require('../data/catalogue-sources/identity-reviews.json'),seen=new Set();
 for(const row of reviews.missingIdentities){assert.ok(!seen.has(row.id),'duplicate missing identity '+row.name);seen.add(row.id);assert.ok(!all.some(entry=>entry.no===row.no&&identityKey(entry.name)===identityKey(row.name)),'already integrated '+row.name);assert.ok(row.source&&row.action&&row.artState);assert.notEqual(row.disposition,'unavailable');}
});

test('finite queue art stays hash-pinned, Shiny duplicates stay blocked, and Zen labels survive line breaks',()=>{
 const {validateReviewedAssets}=require('../scripts/sprites/catalogue-review.cjs'),path=require('node:path');const allRecords=validateReviewedAssets(path.join(__dirname,'..')),records=allRecords.filter(r=>!r.sourceId.startsWith('variant-followup:'));assert.equal(allRecords.length,91);assert.equal(records.length,66);const stellar=records.find(row=>row.names[0]==='Terapagos (Stellar Form)');assert.ok(stellar.assets.default);assert.equal(stellar.assets.shiny,stellar.assets.default);assert.equal(stellar.sameAppearanceEvidence,'stellar-palette-10277-v1');assert.equal(stellar.blockedVariants,undefined);assert.equal(records.filter(row=>row.assets.shiny).length,66);
 const input=inputs();input.sources.data['normal-inventory']=[];assert.equal(reconcile(input).status,'reconciled');const html='<img src="/pokemongo/pokemon/555-gz.png"><td class="fooinfo"><a href="/pokemongo/pokemon/555.shtml">Darmanitan</a> (Galarian Form<br />Zen Mode)</td>';assert.equal(parseGOInventory(html,'https://www.serebii.net/pokemongo/gen5pokemon.shtml','normal')[0].name,'Darmanitan (Galarian Form Zen Mode)');
});

test('existing non-tradeable Mythical policy also applies to forms without excluding tradeable exceptions',()=>{
 const vm=require('node:vm'),path=require('node:path'),window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/domain/pokemonSearchTerms.js'),'utf8'),{window});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/domain/pokemonEntryRules.js'),'utf8'),{window});const rules=window.PogoDomain.pokemonEntryRules;
 for(const entry of [{no:494,name:'Victini'},{no:649,name:'Genesect (Shock Drive)'},{no:801,name:'Magearna (Original Color)'}])assert.equal(rules.isTradeableForWishlist(entry),false);
 for(const entry of [{no:808,name:'Meltan'},{no:809,name:'Melmetal'},{no:1024,name:'Terapagos (Stellar Form)'}])assert.equal(rules.isTradeableForWishlist(entry),true);
});

test('exact variant owner blockers survive source matches and cannot disappear into aliases',()=>{
 const input=inputs();input.variantIssues=[{id:'clone-shiny',no:3,name:'Venusaur (Clone)',releaseState:'shiny-unverified',artState:'missing-exact-shiny',reason:'Exact Clone Shiny art has not been sourced',sources:['https://example.test/clones'],nextAction:'Check the exact clone miner group; never substitute base art.'}];const report=reconcile(input),row=report.queue.find(r=>r.id==='exact-variant:clone-shiny');assert.equal(row.priority,'urgent');assert.equal(row.disposition,'owner-attention-required');assert.equal(report.status,'review-required');input.variantIssues[0].sources=[];assert.throws(()=>reconcile(input),/Incomplete exact variant owner issue/);
});


test('Spooky Festival sources preserve all eight sizes and reject crossed size, species or Shiny paths',()=>{
 const os=require('node:os'),path=require('node:path'),{validateReviewedAssets}=require('../scripts/sprites/catalogue-review.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spooky-source-guard-')),original=require('../data/catalogue-reviewed-assets.json');
 try{fs.mkdirSync(path.join(root,'data'));fs.symlinkSync(path.join(__dirname,'../assets'),path.join(root,'assets'));fs.copyFileSync(path.join(__dirname,'../data/stellar-same-appearance-evidence.json'),path.join(root,'data/stellar-same-appearance-evidence.json'));
 const rows=original.records.filter(r=>r.sourceId.startsWith('variant-followup:spooky-size:'));assert.equal(rows.length,8);assert.equal(new Set(rows.flatMap(r=>Object.values(r.assets))).size,16);
 const validate=mutate=>{const data=structuredClone(original);mutate(data.records.filter(r=>r.sourceId.startsWith('variant-followup:spooky-size:')));fs.writeFileSync(path.join(root,'data/catalogue-reviewed-assets.json'),JSON.stringify(data));return validateReviewedAssets(root);};
 assert.equal(validate(()=>{}).length,91);
 for(const mutate of [r=>r[0].artProof.default.url=r[1].artProof.default.url,r=>r[0].artProof.shiny.url=r[1].artProof.shiny.url,r=>r[0].no=711,r=>r[0].artProof.shiny.url=r[0].artProof.default.url])assert.throws(()=>validate(mutate),/Wrong Spooky Festival/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('selectable denominator follows runtime picker seeds and cannot be satisfied by sprite names alone',()=>{
 const {loadIdentities}=require('../scripts/reconcile-catalogue.cjs'),current=loadIdentities(),repairs=require('../data/catalogue-selectable-repair.json').records;
 assert.equal(current.all.length,1762);assert.equal(repairs.length,61);
 for(const row of repairs)assert.ok(current.all.some(e=>e.name===row.name&&e.no===row.no),row.name);
 const database=JSON.parse(JSON.stringify(current.database));database.wishlist=database.wishlist.filter(r=>r.name!=='Ivysaur');const missing=loadIdentities({database});
 assert.ok(missing.publicAll.some(e=>e.name==='Ivysaur'));assert.ok(!missing.all.some(e=>e.name==='Ivysaur'));
 const input=inputs();input.identities=missing;input.sources.data['normal-inventory']=[{no:2,name:'Ivysaur',sourceSprite:'https://www.serebii.net/pokemongo/pokemon/002.png',source:'https://www.serebii.net/pokemongo/gen1pokemon.shtml',availabilityClaim:'listed-without-unavailable-marker'}];input.sources.data['shiny-inventory']=[];input.art.entries=[];
 const result=reconcile(input);assert.equal(result.coverage['normal-inventory'].unmatched,1);assert.ok(result.queue.some(r=>r.no===2&&r.disposition==='unmatched-identity'&&r.priority==='urgent'));
});

test('compact variant status preserves every original status and gender boundary',()=>{
 const vm=require('node:vm'),path=require('node:path'),window={};for(const file of ['js/domain/pokemonKeys.js','js/domain/costumeSpriteCatalog.js','js/domain/publicPokemonDex.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{window});
 for(const row of require('../data/reviewed-variant-status.json').records){const actual=window.PogoDomain.publicPokemonDex.variantStatus(row.name);assert.equal(actual.normal,row.normal,row.name);assert.equal(actual.shiny,row.shiny,row.name);assert.deepEqual(Array.from(actual.genders),row.genders,row.name);}
 assert.equal(window.PogoDomain.publicPokemonDex.variantStatus('Centiskorch').shiny,'unverified');assert.deepEqual(Array.from(window.PogoDomain.publicPokemonDex.variantStatus('Blissey').genders),['f']);
});

test('actual selectable reconciliation retains explicit existing Mythical policy exclusions',()=>{
 const input=inputs();input.identities.isTradeableForWishlist=entry=>entry.no!==151;input.sources.data['shiny-inventory']=[];input.sources.data['normal-inventory']=[{no:151,name:'Mew',sourceSprite:'https://example.test/151.png',source:'https://example.test/inventory',availabilityClaim:'listed-without-unavailable-marker'}];
 const report=reconcile(input);assert.equal(report.coverage['normal-inventory'].policyExcluded,1);assert.equal(report.coverage['normal-inventory'].unmatched,0);assert.ok(report.queue.some(r=>r.no===151&&r.disposition==='excluded-existing-trade-policy'&&r.priority==='review'));
});

test('a reviewed normal miner file cannot hide missing Shiny artwork or an absent picker form',()=>{
 const input=inputs();input.sources.data['normal-inventory']=[];
 input.sources.data.pokemod.tree=[{path:'Addressable Assets/pm999.fEXACT.icon.png',sha:'normal'},{path:'Addressable Assets/pm999.fEXACT.s.icon.png',sha:'shiny'}];
 input.identities.all=[{no:999,name:'New Species (Exact)',catalogId:'exact'}];
 input.art.entries=[{no:999,names:['New Species (Exact)'],status:'exact',sourceFile:'pm999.fEXACT.icon.png',assets:{default:'normal.png'}}];
 let result=reconcile(input),row=result.queue.find(r=>r.id==='mined:999.fEXACT');
 assert.equal(result.coverage.pokemod.mapped,0);assert.equal(row.variants.normal.artQualified,true);assert.equal(row.variants.shiny.artQualified,false);assert.equal(row.variants.shiny.sourceAvailable,true);assert.deepEqual(row.selectableCatalogIds,['exact']);
 input.art.entries[0].assets.shiny='shiny.png';result=reconcile(input);assert.equal(result.coverage.pokemod.mapped,1);assert.equal(result.coverage.pokemod.variantDenominator,2);
 input.identities.all=[];result=reconcile(input);row=result.queue.find(r=>r.id==='mined:999.fEXACT');assert.ok(row);assert.deepEqual(row.selectableCatalogIds,[]);assert.equal(row.variants.normal.artQualified,false);assert.equal(result.coverage.pokemod.mapped,0);
});
test('legacy miner pairs remain separate and same-art fallback cannot close Shiny',()=>{
 const input=inputs();input.sources.data['normal-inventory']=[];input.identities.all=[{no:999,name:'New Species (Hat)',catalogId:'hat'}];
 input.sources.data.pokemod.tree=[{path:'pokemon_icon_999_01.png',sha:'normal'},{path:'pokemon_icon_999_01_shiny.png',sha:'shiny'}];
 input.art.entries=[{no:999,names:['New Species (Hat)'],status:'exact',sourceFile:'pokemon_icon_999_01.png',assets:{default:'normal.png',shiny:'normal.png'}}];
 let result=reconcile(input);assert.equal(result.coverage.pokemod.legacyMapped,0);assert.equal(result.coverage.pokemod.legacyVariantDenominator,2);assert.equal(result.queue.find(r=>r.id==='legacy-mined:999:01').variants.shiny.artQualified,false);
 input.art.entries[0].sameAppearanceEvidence='stellar-palette-10277-v1';result=reconcile(input);assert.equal(result.coverage.pokemod.legacyMapped,0);
 input.art.entries[0].assets.shiny='exact-shiny.png';result=reconcile(input);assert.equal(result.coverage.pokemod.legacyMapped,1);
});
test('ordinary miner identity matching requires separately decoded normal and Shiny proofs',()=>{
 const input=inputs();input.sources.data.pokemod.tree=[{path:'Addressable Assets/pm999.icon.png',sha:'normal'},{path:'Addressable Assets/pm999.s.icon.png',sha:'shiny'}];input.identities.all=[{no:999,name:'New Species',catalogId:'base'}];
 input.verifiedArt=[{no:999,shiny:false,status:'verified-bytes',decoded:true}];let result=reconcile(input);assert.equal(result.coverage.pokemod.mapped,0);assert.deepEqual(result.coverage.pokemod.qualifiedVariants,{normal:1,shiny:0});
 input.verifiedArt.push({no:999,shiny:true,status:'verified-bytes',decoded:true});result=reconcile(input);assert.equal(result.coverage.pokemod.mapped,1);
 input.identities.all=[];assert.equal(reconcile(input).coverage.pokemod.mapped,0);
});

test('independent miner head changes require review and failures never become a fresh baseline',async()=>{
 const url='https://api.github.com/repos/PokeMiners/pogo_assets/commits/master',old='1'.repeat(40),latest='2'.repeat(40);
 const make=()=>{const value=inputs().sources;value.manifest.secondarySources=[{id:'pokeminers-head',url,reviewedCommit:old,scope:'head watch only'}];return value;};
 for(const success of [true,false]){
  const input=make(),calls=[];
  const result=await observeInventories(input,{now,fetchImpl:async target=>{calls.push(target);return target===url&&success?{ok:true,status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({sha:latest,commit:{committer:{date:'2026-10-26T12:00:00Z'}}}))}:{ok:false,status:503};}});
  assert.equal(calls.filter(value=>value===url).length,1);assert.equal(result.manifest.secondarySources[0].reviewedCommit,old);assert.equal(input.manifest.secondarySources[0].observedAt,undefined);
  if(success){assert.ok(result.assetChanges.some(row=>row.id==='secondary-miner-head:'+latest&&row.releaseState==='uncertain'));assert.equal(result.manifest.secondarySources[0].sourceUpdatedAt,'2026-10-26T12:00:00Z');assert.equal(result.manifest.secondarySources[0].observedAt,now.toISOString());}
  else{assert.ok(result.issues.some(row=>row.source==='pokeminers-head'&&row.kind==='live-source-failed'));assert.equal(result.manifest.secondarySources[0].observedAt,undefined);}
 }
 const current=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/catalogue-sources/manifest.json')));delete current.secondarySources;
 assert.ok(loadSources(now,file=>String(file).endsWith('/manifest.json')?Buffer.from(JSON.stringify(current)):fs.readFileSync(file)).issues.some(row=>row.kind==='missing-or-invalid-secondary-watch'));
});

test('plain source namespaces cannot bind unparenthesized costume or alternate-form names',()=>{
 const input=inputs();input.sources.data.pokemod.tree=[{path:'Addressable Assets/pm999.icon.png',sha:'normal'},{path:'Addressable Assets/pm999.s.icon.png',sha:'shiny'}];input.identities.all=[{no:999,name:'New Species',catalogId:'base'},{no:999,name:'New Species Party Hat',catalogId:'hat'},{no:999,name:'Ultra New Species',catalogId:'ultra'}];input.verifiedArt=[{no:999,shiny:false,status:'verified-bytes',decoded:true}];let result=reconcile(input),row=result.queue.find(r=>r.id==='mined:999');assert.deepEqual(row.selectableCatalogIds,['base']);assert.equal(row.variants.normal.artQualified,true);assert.equal(row.variants.shiny.artQualified,false);input.verifiedArt.push({no:999,shiny:true,status:'verified-bytes',decoded:true});assert.equal(reconcile(input).coverage.pokemod.mapped,1);input.sources.data['normal-inventory']=[];row=reconcile(input).queue.find(r=>r.id==='mined:999');assert.deepEqual(row.selectableCatalogIds,[]);assert.equal(row.variants.normal.artQualified,false);
});
