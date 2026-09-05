const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'js/app/application.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(){
  const window={btoa:value=>Buffer.from(value,'binary').toString('base64')};
  const context=vm.createContext({window,console});
  for(const file of ['accountSyncModel','accountSyncProduct','tradeListComparison','publicSharePublication','providerPublicProjection']){
    vm.runInContext(fs.readFileSync(path.join(root,'js/domain',file+'.js'),'utf8'),context);
  }
  const domain=window.PogoDomain;
  Object.assign(context,{cur:'Owner',selectedTrainerRuntime:{},allData:{},OWNED_MY_LIST_TYPES:['wishlist','dynamax','gmax','costumes'],
    tradeListComparisonDomain:domain.tradeListComparison,accountSyncProduct:domain.accountSyncProduct,accountSyncModel:domain.accountSyncModel,
    accountSyncCatalogEntryForName:(_type,name)=>({name,no:{Pikachu:25,Eevee:133,Mew:151,Charmander:4}[name]}),
    pokemonCatalogDomain:{catalogKey:value=>value.toLowerCase()},normalizeTradeQualifier:value=>String(value||'').toLowerCase(),
    maxTypeForEntry:()=> 'wishlist',pokemonDisplayName:entry=>entry.name,entryGender:()=>'',parsePri:value=>typeof value==='string'?{p:value,mod:''}:value});
  vm.runInContext(app.slice(app.indexOf('function productDeclarations('),app.indexOf('function setMyListIntent(')),context);
  return{context,domain};
}
function source(){
  return{users:{Owner:{authUid:'private-owner',privateTags:['secret'],specialTradeBoard:{
    lf:[{name:'Pikachu',p:'H',shiny:true},{name:'Eevee',p:'',gender:'f',mod:'form',note:'Public note',backgroundId:'chicago',lucky:true,xxl:true}],
    ft:[{name:'Mew',p:'L',shiny:true},{name:'Mew',p:'M',shiny:false}]
  }}},wishlist:{Owner:{Pikachu:{p:'H',shiny:true}}},dynamax:{Owner:{}},gmax:{Owner:{}},costumes:{Owner:{}}};
}
function build(domain,data,entries){
  const gate=domain.publicSharePublication.createPublicSharePublicationGate(),token=gate.activate({uid:'private-owner',username:'Owner'}).token;
  for(const name of domain.publicSharePublication.REQUIRED_SOURCE_SURFACES)gate.markLoaded(token,name);
  return domain.publicSharePublication.buildPublicShareSnapshot({gate,token,trigger:'explicit_share',username:'Owner',source:data,declarations:entries,now:100}).snapshot;
}
test('unified publication includes Board LF/FT, dedupes exact aliases and preserves distinct qualifiers without provenance',()=>{
  const {context:c,domain:d}=harness(),data=source(),original=JSON.stringify(data);
  const model=c.productDeclarations('Owner',data),snapshot=build(d,data,model.entries);
  assert.equal(snapshot.version,2);assert.equal(snapshot.declarationCount,4);
  assert.equal(snapshot.declarations.filter(e=>e.name==='Pikachu').length,1);
  assert.equal(model.entries.find(e=>e.name==='Pikachu').ref.surface,'my-list');
  assert.equal(model.entries.find(e=>e.name==='Pikachu').aliases.length,1);
  assert.equal(snapshot.declarations.filter(e=>e.intent==='ft').length,2);
  assert.equal(snapshot.declarations.find(e=>e.name==='Eevee').p,'');
  assert.equal(snapshot.declarations.find(e=>e.name==='Eevee').gender,'f');
  assert.equal(snapshot.declarations.find(e=>e.name==='Eevee').note,'Public note');
  assert.doesNotMatch(JSON.stringify(snapshot),/private-owner|privateTags|aliases|entityId|catalogId|surface|revision|tombstone|recovery/);
  assert.equal(JSON.stringify(data),original);
  assert.deepEqual(plain(build(d,data,c.productDeclarations('Owner',data).entries)),plain(snapshot));
});
test('public V2 prefers declarations over compatibility lists and validates exact fields and completeness',()=>{
  const {context:c,domain:d}=harness(),data=source(),snapshot=build(d,data,c.productDeclarations('Owner',data).entries),api=d.publicSharePublication;
  snapshot.lists.wishlist.Ghost='H';
  const read=api.publicShareProjectionStatus(snapshot);
  assert.equal(read.ok,true);assert.equal(api.intentEntries(read.snapshot,'lf','wishlist').length,2);
  assert.equal(api.intentEntries(read.snapshot,'ft','wishlist').length,2);
  assert.equal(api.publicShareProjectionStatus({...snapshot,declarationCount:9}).ok,false);
  const corrupt=plain(snapshot);corrupt.declarations[0].ownerUid='secret';
  assert.equal(api.publicShareProjectionStatus(corrupt).ok,false);
  const empty={...snapshot,declarations:undefined,declarationCount:0,lists:{}};
  assert.equal(api.publicShareProjectionStatus(empty).status,'published_empty');
});
test('old LF-only public links remain readable and do not claim offer data',()=>{
  const {domain:d}=harness(),api=d.publicSharePublication;
  const read=api.publicShareProjectionStatus({version:1,username:'Owner',profile:{},lists:{wishlist:{Pikachu:'H'}}});
  assert.equal(read.ok,true);assert.equal(api.intentEntries(read.snapshot,'lf').length,1);
  assert.equal(api.intentEntries(read.snapshot,'ft').length,0);
  const compare=d.tradeListComparison.compareDeclarations({mine:[{name:'Pikachu',intent:'lf'}],theirs:[{name:'Pikachu',intent:'lf'}],offersAvailable:false});
  assert.equal(compare.both.length,1);assert.equal(compare.theyOffer.length,0);
});
test('unified priority searches use intent/category/filter and omit empty or unresolved sets',()=>{
  const {context:c}=harness();c.allData=source();
  Object.assign(c,{document:{getElementById:()=>({value:''})},normalizeAcText:value=>String(value||'').toLowerCase(),pokemonGoSearchLocale:()=> 'en',regionalFormTerm:()=>'',dexSearchTerm:entry=>String(entry.no),entrySearchFilters:()=>[],stringFromSearchItems:items=>items.map(item=>item.term).join(','),dexStringFromNumbers:numbers=>numbers.join(',')});
  vm.runInContext(app.slice(app.indexOf('function buildStrings('),app.indexOf('function myListSearchLabel(')),c);
  assert.deepEqual(plain(c.buildStrings('wishlist','Owner','lf')),{H:'25',U:'133',LUCKY:'133',XXL:'133'});
  assert.deepEqual(plain(c.buildStrings('wishlist','Owner','ft')),{M:'151',L:'151'});
  assert.equal(c.buildStrings('dynamax','Owner','lf'),null);
  c.document.getElementById=()=>({value:'absent'});
  assert.equal(c.buildStrings('wishlist','Owner','lf'),null);
});
test('canonical copy creation is add-only and idempotent; original Board records survive edits and reload',async()=>{
  const {context:c,domain:d}=harness(),data=source(),original=JSON.stringify(data.users.Owner.specialTradeBoard),calls=[];
  Object.assign(c,{allData:data,auth:{currentUser:{uid:'owner'}},accountSyncCanonicalEntities:[],accountSyncCatalogIdentity:(_type,name)=>({catalogId:name}),accountSyncAuthorityCurrent:()=>true,toast:()=>{},i18nCore:{t:key=>key},
    accountSyncMutationAuthority:async()=>({mode:'canonical',controller:{}}),
    applyAccountSyncTradeMutations:async mutations=>{calls.push(...mutations);for(const row of mutations)c.accountSyncCanonicalEntities.push({...row,deleted:false});return{ok:true};}});
  vm.runInContext(app.slice(app.indexOf('async function addManagedIntentEntries('),app.indexOf('async function enableIntentEditing(')),c);
  const entry=data.users.Owner.specialTradeBoard.ft[0];
  assert.equal(await c.addManagedIntentEntries('ft',[entry]),true);
  assert.equal(await c.addManagedIntentEntries('ft',[entry]),true);
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'add');assert.equal(calls[0].identity.surface,'my-list');assert.equal(calls[0].identity.lane,'for-trade');
  c.accountSyncCanonicalEntities[0].values={...calls[0].values,note:'Edited copy'};
  const projected=d.accountSyncProduct.projectTradeEntities({entities:plain(c.accountSyncCanonicalEntities),catalogEntryForId:name=>({name,no:151}),encodePriority:()=>''});
  data.users.Owner.intentDeclarations=plain(projected.intentDeclarations);
  const restored=c.productDeclarations('Owner',plain(data));
  assert.ok(restored.entries.some(e=>e.note==='Edited copy'));
  assert.equal(restored.entries.filter(e=>e.name==='Mew').length,3);
  assert.equal(JSON.stringify(data.users.Owner.specialTradeBoard),original);
});
test('canonical copying fails closed across account switches or unavailable sync',async()=>{
  for(const mode of ['legacy','changed']){
    const {context:c}=harness();let calls=0;
    Object.assign(c,{auth:{currentUser:{uid:'owner'}},accountSyncCanonicalEntities:[],toast:()=>{},i18nCore:{t:key=>key},accountSyncAuthorityCurrent:()=>true,
      accountSyncMutationAuthority:async()=>{if(mode==='changed')c.cur='Other';return{mode:mode==='legacy'?'legacy':'canonical'};},applyAccountSyncTradeMutations:async()=>{calls++;}});
    vm.runInContext(app.slice(app.indexOf('async function addManagedIntentEntries('),app.indexOf('async function enableIntentEditing(')),c);
    assert.equal(await c.addManagedIntentEntries('lf',[{name:'Pikachu'}]),false);assert.equal(calls,0);
  }
});
test('V2 provider public data round-trips through browser and server sanitizers without identity changes',()=>{
  const {context:c,domain:d}=harness(),data=source(),snapshot=build(d,data,c.productDeclarations('Owner',data).entries);
  snapshot.profile={friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:100};
  const api=d.providerPublicProjection,stored=api.nextProjection(snapshot,null,{trainerName:'Owner',now:200});
  const server=require('../functions/e1-authority-service/providerPublicProjection').sanitizeProviderPublicProjection(stored,{trainerName:'Owner'});
  assert.equal(stored.schemaVersion,2);assert.equal(server.version,2);
  assert.deepEqual(plain(server.declarations),plain(snapshot.declarations));
  assert.equal(api.projectionContentMatches(snapshot,stored,{trainerName:'Owner'}),true);
  const changed=plain(snapshot);changed.declarations[0].shiny=!changed.declarations[0].shiny;
  assert.equal(api.projectionContentMatches(changed,stored,{trainerName:'Owner'}),false);
  const malicious=plain(stored);malicious.declarations[0].aliases=['private'];
  assert.equal(api.storedProjectionStatus(malicious).ok,false);
  assert.equal(require('../functions/e1-authority-service/providerPublicProjection').sanitizeProviderPublicProjection(malicious),null);
});

test('every supplemental signed-in legendary has the same anonymous dex identity',()=>{
  const window={};const context=vm.createContext({window});
  for(const file of ['pokemonKeys','publicPokemonDex'])vm.runInContext(fs.readFileSync(path.join(root,'js/domain',file+'.js'),'utf8'),context);
  const domain=window.PogoDomain;
  for(const entry of domain.pokemonCatalog.legendaryEntries){
    assert.equal(domain.publicPokemonDex.dex(entry.name),entry.no,entry.name);
    assert.equal(domain.publicPokemonDex.dex(entry.displayName),entry.no,entry.displayName);
  }
});

test('a declaration edit during publication prevents copying an out-of-date URL as current',async()=>{
  let declarations=[{name:'Pikachu',intent:'lf'}],copies=0;const statuses=[];
  const c=vm.createContext({cur:'Owner',auth:{currentUser:{uid:'owner'}},myListType:'wishlist',
    location:{origin:'https://example.test',pathname:'/'},publicLinkAttempt:0,
    publicSharePublicationDomain:{publicDeclarations:rows=>rows},productDeclarations:()=>({entries:declarations}),
    document:{getElementById:()=>null},linkPublicationStatus:key=>statuses.push(key),
    publishPublicShareNow:async()=>{declarations=[...declarations,{name:'Eevee',intent:'ft'}];return{status:'published'};},
    publicSharePublicationCurrent:()=>true,copyText:async()=>{copies++;}});
  vm.runInContext(app.slice(app.indexOf('async function copyShareLink('),app.indexOf('// ── SPECIAL TRADE BOARD')),c);
  await c.copyShareLink();
  assert.equal(copies,0);assert.equal(statuses.at(-1),'share.publicationPending');
});

test('application Compare consumes public FT/LF and falls back to wanted overlap for v1',()=>{
  const {context:c}=harness();c.allData=source();
  Object.assign(c,{ownTradeListsAvailable:()=>true,trainerTradeListsAvailable:()=>true});
  c.selectedTrainerRuntime={username:'Other',publicData:{users:{Other:{publicDeclarations:[
    {intent:'ft',category:'wishlist',name:'Pikachu',p:'H',shiny:true},
    {intent:'lf',category:'wishlist',name:'Mew',p:'L',shiny:true}
  ]}}}};
  vm.runInContext(app.slice(app.indexOf('function computeTradeMatchSummary('),app.indexOf('function tradeIntentFreeform(')),c);
  const reciprocal=c.computeTradeMatchSummary('Other');
  assert.equal(reciprocal.offersAvailable,true);
  assert.equal(reciprocal.theyOffer.length,1);assert.equal(reciprocal.iOffer.length,1);
  c.selectedTrainerRuntime.publicData={users:{Other:{}},wishlist:{Other:{Pikachu:{p:'H',shiny:true}}}};
  const legacy=c.computeTradeMatchSummary('Other');
  assert.equal(legacy.offersAvailable,false);assert.equal(legacy.both.length,1);
  assert.equal(legacy.theyOffer.length,0);assert.equal(legacy.iOffer.length,0);
});

test('categorized canonical source wins an exact managed alias without a second editable row',()=>{
  const {domain:d}=harness();
  const entry={name:'Pikachu',intent:'lf',type:'wishlist',p:'H'};
  const result=d.tradeListComparison.unifyDeclarations([
    {...entry,ref:{surface:'my-list',managed:true}},
    {...entry,ref:{surface:'special-board'}},
    {...entry,ref:{surface:'my-list',type:'wishlist'}}
  ]);
  assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].ref.type,'wishlist');
  assert.equal(result.entries[0].aliases.length,2);
});
