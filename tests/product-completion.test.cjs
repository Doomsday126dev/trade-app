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
function publicationSource(){
  const data=source();
  data.users.Owner.specialTradeBoard.lf.push({name:'Pikachu',p:'H'},
    {name:'Eevee',gender:'m',mod:'other form',xxs:true,note:'Distinct requirement'});
  data.users.Owner.intentDeclarations=[{name:'Charmander',side:'ft',entityId:'private-offer',p:'H'}];
  data.dynamax.Owner.Charmander={p:'M'};
  return data;
}
// Independently specified public fields; no expected values are produced by the projector.
const publicWant=(name,fields={})=>({intent:'lf',category:'wishlist',name,p:'',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...fields});
const expectedPublicWants=()=>[
  publicWant('Pikachu',{p:'H',shiny:true}),
  publicWant('Eevee',{gender:'f',mod:'form',note:'Public note',lucky:true,xxl:true}),
  publicWant('Pikachu',{p:'H'}),
  publicWant('Eevee',{gender:'m',mod:'other form',note:'Distinct requirement',xxs:true}),
  publicWant('Charmander',{category:'dynamax',p:'M'})
];
test('wants-only application publication dedupes exact aliases, preserves distinct requirements and excludes retired offers',()=>{
  const {context:c,domain:d}=harness(),data=publicationSource(),original=JSON.stringify(data);
  const model=c.productDeclarations('Owner',data),snapshot=build(d,data,model.entries);
  assert.equal(snapshot.version,2);assert.equal(snapshot.declarationCount,5);
  assert.deepEqual(plain(snapshot.declarations),expectedPublicWants());
  const shinyPikachu=model.entries.filter(e=>e.name==='Pikachu'&&e.shiny);
  assert.equal(shinyPikachu.length,1);assert.equal(shinyPikachu[0].ref.surface,'my-list');
  assert.equal(shinyPikachu[0].aliases.length,1);
  assert.equal(model.duplicates.length,1);
  assert.ok(model.entries.every(e=>e.intent==='lf'));
  assert.equal(snapshot.declarations.filter(e=>e.intent==='ft'||e.name==='Mew').length,0);
  assert.doesNotMatch(JSON.stringify(snapshot),/private-owner|privateTags|aliases|entityId|catalogId|surface|revision|tombstone|recovery/);
  assert.equal(JSON.stringify(data),original);
  assert.deepEqual(plain(build(d,data,c.productDeclarations('Owner',data).entries)),plain(snapshot));
});
test('public V2 prefers declarations over compatibility lists and validates exact fields and completeness',()=>{
  const {context:c,domain:d}=harness(),data=publicationSource(),snapshot=build(d,data,c.productDeclarations('Owner',data).entries),api=d.publicSharePublication;
  snapshot.lists.wishlist.Ghost='H';
  const read=api.publicShareProjectionStatus(snapshot);
  assert.equal(read.ok,true);
  assert.deepEqual(plain(api.intentEntries(read.snapshot,'lf')),expectedPublicWants());
  assert.deepEqual(plain(api.intentEntries(read.snapshot,'lf','wishlist')),expectedPublicWants().slice(0,4));
  assert.deepEqual(plain(api.intentEntries(read.snapshot,'lf','dynamax')),[publicWant('Charmander',{category:'dynamax',p:'M'})]);
  assert.equal(api.intentEntries(read.snapshot,'ft').length,0);
  assert.ok(!api.intentEntries(read.snapshot,'lf').some(e=>e.name==='Ghost'));
  assert.equal(api.publicShareProjectionStatus({...snapshot,declarationCount:9}).ok,false);
  for(const change of [entry=>{entry.ownerUid='secret';},entry=>{delete entry.gender;},
    entry=>{entry.shiny='true';},entry=>{entry.p='invalid';},entry=>{entry.intent='inventory';}]){
    const corrupt=plain(snapshot);change(corrupt.declarations[0]);
    assert.equal(api.publicShareProjectionStatus(corrupt).ok,false);
  }
  assert.equal(api.publicShareProjectionStatus({...snapshot,declarations:snapshot.declarations.slice(1)}).ok,false);
  const empty={...snapshot,declarations:undefined,declarationCount:0,lists:{}};
  assert.equal(api.publicShareProjectionStatus(empty).status,'published_empty');
});
test('lower-level V2 compatibility still reads explicit LF and FT declarations without changing application scope',()=>{
  const {domain:d}=harness(),api=d.publicSharePublication;
  const entries=[publicWant('Pikachu',{p:'H',shiny:true}),publicWant('Eevee',{intent:'ft',mod:'form',gender:'f',lucky:true,note:'Legacy offer'})];
  const snapshot=build(d,source(),entries),read=api.publicShareProjectionStatus(snapshot);
  assert.equal(read.ok,true);assert.equal(read.snapshot.declarationCount,2);
  assert.deepEqual(plain(api.intentEntries(read.snapshot,'lf')),[entries[0]]);
  assert.deepEqual(plain(api.intentEntries(read.snapshot,'ft')),[entries[1]]);
});
test('old LF-only public links remain readable and do not claim offer data',()=>{
  const {domain:d}=harness(),api=d.publicSharePublication;
  const read=api.publicShareProjectionStatus({version:1,username:'Owner',profile:{},lists:{wishlist:{Pikachu:'H'}}});
  assert.equal(read.ok,true);assert.equal(api.intentEntries(read.snapshot,'lf').length,1);
  assert.equal(api.intentEntries(read.snapshot,'ft').length,0);
  const compare=d.tradeListComparison.compareDeclarations({mine:[{name:'Pikachu',intent:'lf'}],theirs:[{name:'Pikachu',intent:'lf'}],offersAvailable:false});
  assert.equal(compare.both.length,1);assert.equal(compare.theyOffer.length,0);
});
test('search harness uses real protected serialization, scoped filters and conditional shiny section commands',()=>{
  const {context:c,domain:d}=harness();c.allData=source();
  for(const file of ['js/domain/pokemonKeys.js','js/domain/publicPokemonDex.js','js/domain/pokemonSearchTerms.js',
    'js/domain/pokemonEntryRules.js','js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js',
    'js/utils/textSafety.js','js/ui/stringHtml.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
  const filter={value:''};
  Object.assign(c,{document:{getElementById:id=>id==='mylist-filter'?filter:null},
    normalizeAcText:value=>String(value||'').toLowerCase(),pokemonGoSearchLocale:()=> 'en',
    ...d.pokemonSearchTerms,...d.pokemonEntryRules,...d.searchStrings,searchStringDomain:d.searchStrings,i18nCore:{t:key=>key}});
  // Function-only slices deliberately exclude unrelated DOM initialization/listeners.
  vm.runInContext(app.slice(app.indexOf('function buildStrings('),app.indexOf('async function copyText(')),c);
  vm.runInContext(app.slice(app.indexOf('function contextualIntentSearchHtml('),app.indexOf('async function editIntentEntry(')),c);
  const ordinary='!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&';
  // The legacy priority builder still owns category/filter behavior, not section requirements.
  assert.deepEqual(plain(c.buildStrings('wishlist','Owner','lf')),{H:ordinary+'25',U:ordinary+'133',LUCKY:ordinary+'133',XXL:ordinary+'133'});
  assert.equal(c.buildStrings('wishlist','Owner','ft'),null);
  assert.equal(c.buildStrings('dynamax','Owner','lf'),null);
  filter.value='PIKA';assert.deepEqual(plain(c.buildStrings('wishlist','Owner')),{H:ordinary+'25'});
  filter.value='absent';assert.equal(c.buildStrings('wishlist','Owner'),null);
  c.allData.wishlist.Other={Charmander:{p:'M'}};
  assert.deepEqual(plain(c.buildStrings('wishlist','Other')),{M:ordinary+'4'},'owner filter must not filter another trainer');
  filter.value='';c.allData.dynamax.Owner={Unresolved:{p:'H'}};
  assert.equal(c.buildStrings('dynamax','Owner'),null);

  // Active section controls use the real application adapter, query policy and HTML renderer.
  const copied=entries=>[...c.contextualIntentSearchHtml(entries,'Fixture',{compact:true}).matchAll(/data-contextual-copy="([^"]+)"/g)].map(match=>match[1].replaceAll('&amp;','&'));
  const wants=c.productDeclarations('Owner').entries;
  assert.deepEqual(copied(wants),['!4*&!traded&CP-2500&!shadow&!purified&!background&25,133']);
  assert.deepEqual(copied(wants.filter(e=>e.name==='Eevee')),[ordinary+'xxl&133']);
  assert.deepEqual(copied([{name:'Pikachu',no:25},{name:'Mew',no:151,intent:'ft',shiny:true}]),[ordinary+'25']);
  assert.deepEqual(copied([]),[]);
  assert.deepEqual(copied([{name:'Unresolved',no:null}]),[]);
  assert.deepEqual(copied([{name:'Pikachu',no:25},{name:'Unresolved',no:null,shiny:true}]),[ordinary+'25']);
  assert.match(c.contextualIntentSearchHtml([{name:'Unresolved',no:null}],'Fixture',{compact:true}),/contextual-omitted[^>]*>Unresolved/);
});
test('canonical copy creation is add-only and idempotent; original Board records survive edits and reload',async()=>{
  const {context:c,domain:d}=harness(),data=source(),original=JSON.stringify(data.users.Owner.specialTradeBoard),calls=[];
  Object.assign(c,{allData:data,auth:{currentUser:{uid:'owner'}},accountSyncCanonicalEntities:[],accountSyncCatalogIdentity:(_type,name)=>({catalogId:name}),accountSyncAuthorityCurrent:()=>true,toast:()=>{},i18nCore:{t:key=>key},
    accountSyncMutationAuthority:async()=>({mode:'canonical',controller:{}}),
    applyAccountSyncTradeMutations:async mutations=>{calls.push(...mutations);for(const row of mutations)c.accountSyncCanonicalEntities.push({...row,deleted:false});return{ok:true};}});
  vm.runInContext(app.slice(app.indexOf('async function addManagedIntentEntries('),app.indexOf('async function enableIntentEditing(')),c);
  const entry=data.users.Owner.specialTradeBoard.lf[1],originalLists=JSON.stringify(data.wishlist);
  assert.equal(await c.addManagedIntentEntries('lf',[entry]),true);
  assert.equal(await c.addManagedIntentEntries('lf',[entry]),true);
  assert.equal(calls.length,1);assert.equal(c.accountSyncCanonicalEntities.length,1);
  assert.equal(calls[0].kind,'add');assert.equal(calls[0].identity.surface,'my-list');assert.equal(calls[0].identity.lane,'looking-for');
  assert.equal(calls[0].entityId,d.accountSyncModel.tradeEntryId({surface:'my-list',lane:'looking-for',catalogId:'Eevee'}));
  c.accountSyncCanonicalEntities[0].values={...calls[0].values,note:'Edited copy'};
  const projected=d.accountSyncProduct.projectTradeEntities({entities:plain(c.accountSyncCanonicalEntities),catalogEntryForId:name=>({name,no:133}),encodePriority:()=>''});
  data.users.Owner.intentDeclarations=plain(projected.intentDeclarations);
  const restored=c.productDeclarations('Owner',plain(data));
  const edited=restored.entries.filter(e=>e.ref.managed);
  assert.equal(edited.length,1);
  assert.deepEqual(plain({name:edited[0].name,intent:edited[0].intent,note:edited[0].note,mod:edited[0].mod,gender:edited[0].gender,lucky:edited[0].lucky,xxl:edited[0].xxl}),
    {name:'Eevee',intent:'lf',note:'Edited copy',mod:'form',gender:'f',lucky:true,xxl:true});
  assert.equal(restored.entries.filter(e=>e.name==='Eevee').length,2);
  assert.ok(restored.entries.some(e=>e.name==='Eevee'&&e.note==='Public note'&&!e.ref.managed));
  assert.equal(JSON.stringify(data.users.Owner.specialTradeBoard),original);
  assert.equal(JSON.stringify(data.wishlist),originalLists);
});
test('unsupported application FT copy performs no authority lookup or mutation',async()=>{
  const {context:c}=harness();let authorityCalls=0,mutationCalls=0;
  Object.assign(c,{accountSyncMutationAuthority:async()=>{authorityCalls++;},applyAccountSyncTradeMutations:async()=>{mutationCalls++;}});
  vm.runInContext(app.slice(app.indexOf('async function addManagedIntentEntries('),app.indexOf('async function enableIntentEditing(')),c);
  assert.equal(await c.addManagedIntentEntries('ft',source().users.Owner.specialTradeBoard.ft),false);
  assert.equal(authorityCalls,0);assert.equal(mutationCalls,0);
});
test('canonical copying fails closed across account switches or unavailable sync',async()=>{
  for(const mode of ['legacy','changed','changed-uid','stale-authority']){
    const {context:c}=harness();let calls=0;
    Object.assign(c,{auth:{currentUser:{uid:'owner'}},accountSyncCanonicalEntities:[],toast:()=>{},i18nCore:{t:key=>key},accountSyncAuthorityCurrent:()=>mode!=='stale-authority',
      accountSyncMutationAuthority:async()=>{if(mode==='changed')c.cur='Other';if(mode==='changed-uid')c.auth.currentUser.uid='other';return{mode:mode==='legacy'?'legacy':'canonical'};},applyAccountSyncTradeMutations:async()=>{calls++;}});
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
  let declarations=[{name:'Pikachu',intent:'lf',category:'wishlist'}],copies=0;
  const {context:c}=require('./helpers/share-link-vm.cjs').shareLinkHarness({entries:()=>declarations,
    publish:async()=>{declarations=[...declarations,{name:'Eevee',intent:'lf',category:'wishlist'}];return{ok:true,status:'published'};},copy:async()=>{copies++;}});
  await c.copyShareLink();
  assert.equal(copies,0);assert.equal(c.statuses.at(-1),'shareUi.changed');
});

test('application Compare uses exact wanted overlap without manufacturing offers and retains V1 fallback',()=>{
  const {context:c}=harness();c.allData=source();
  Object.assign(c,{ownTradeListsAvailable:()=>true,trainerTradeListsAvailable:()=>true});
  c.selectedTrainerRuntime={username:'Other',publicData:{users:{Other:{publicDeclarations:[
    {intent:'ft',category:'wishlist',name:'Pikachu',p:'H',shiny:true},
    {intent:'lf',category:'wishlist',name:'Mew',p:'L',shiny:true},
    {intent:'lf',category:'wishlist',name:'Pikachu',p:'M',shiny:true},
    {intent:'lf',category:'wishlist',name:'Eevee',mod:'form',gender:'m',lucky:true,xxl:true},
    {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',shiny:false}
  ]}}}};
  vm.runInContext(app.slice(app.indexOf('function computeTradeMatchSummary('),app.indexOf('function tradeIntentFreeform(')),c);
  const wanted=c.computeTradeMatchSummary('Other');
  assert.equal(wanted.offersAvailable,true,'V2 availability metadata is not an offer match');
  assert.equal(wanted.both.length,1);assert.equal(wanted.both[0].name,'Pikachu');assert.equal(wanted.both[0].shiny,true);
  assert.equal(wanted.onlyMine.length,1);assert.equal(wanted.onlyMine[0].name,'Eevee');
  assert.equal(wanted.onlyTheirs.length,3,'gender and shiny qualifiers must not collapse');
  assert.equal(wanted.theyOffer.length,0);assert.equal(wanted.iOffer.length,0);
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
