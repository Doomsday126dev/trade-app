const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {performance}=require('node:perf_hooks');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=file=>readFileSync(path.join(root,file),'utf8');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

function load(files){
  const window={};
  const context=vm.createContext({window,Intl,URL,encodeURIComponent});
  for(const file of files)vm.runInContext(source(file),context,{filename:file});
  return window;
}

const window=load([
  'js/i18n/pokemonNames/catalog.js',
  'js/i18n/pokemonNames/variants.js',
  'js/i18n/pokemonNames/structuredForms.js',
  'js/i18n/pokemonNames/core.js',
  'js/domain/pokemonKeys.js',
  'js/domain/username.js',
  'js/domain/autocompleteText.js',
  'js/domain/autocompleteMatching.js',
  'js/domain/autocompleteRanking.js',
  'js/domain/priorityValues.js',
  'js/domain/favoritePokemonBrowse.js'
]);
const catalog=window.PogoDomain.pokemonCatalog;
const ranking=window.PogoDomain.autocompleteRanking;
const matching=window.PogoDomain.autocompleteMatching;
const browse=window.PogoDomain.favoritePokemonBrowse;

const dataWindow={};
vm.runInNewContext(source('data.js'),{window:dataWindow});
const dbPikachu=dataWindow.POGO_TRADE_DB.costumes.filter(entry=>entry.no===25);
const extraCostumes=JSON.parse(html.match(/const EXTRA_COSTUME_ENTRIES=(\[.*?\]);\n/s)[1]);
const extraPikachu=extraCostumes.filter(entry=>entry.no===25);
const selectablePikachu=catalog.canonicalizeEntries([...dbPikachu,...extraPikachu,...catalog.verifiedMissingEntries]);

test('reviewed duplicate inventory has the exact accepted relationship counts',()=>{
  const groups=catalog.VERIFIED_IDENTITIES.filter(def=>def.aliases.length>1);
  const pairRelationships=groups.reduce((sum,def)=>sum+(def.aliases.length*(def.aliases.length-1))/2,0);
  const redundantRows=groups.reduce((sum,def)=>sum+def.aliases.length-1,0);
  assert.equal(groups.length,48);
  assert.equal(pairRelationships,50);
  assert.equal(redundantRows,49);
});

test('canonical IDs and aliases are unique and display-name independent',()=>{
  const ids=catalog.VERIFIED_IDENTITIES.map(def=>def.catalogId);
  assert.equal(new Set(ids).size,ids.length);
  const aliases=catalog.VERIFIED_IDENTITIES.flatMap(def=>def.aliases.map(alias=>catalog.normalizeCatalogKey(alias)));
  assert.equal(new Set(aliases).size,aliases.length);
  const base={no:999,name:'Stable Legacy Key',displayName:'English label'};
  assert.equal(catalog.fallbackCatalogId(base),catalog.fallbackCatalogId({...base,displayName:'日本語の表示名'}));
  assert.notEqual(catalog.fallbackCatalogId(base),catalog.fallbackCatalogId({...base,name:'Another Stable Key'}));
});

test('verified duplicate source rows expose one selectable identity and preserve every legacy alias',()=>{
  for(const def of catalog.VERIFIED_IDENTITIES.filter(item=>item.aliases.length>1)){
    const matches=selectablePikachu.filter(entry=>entry.catalogId===def.catalogId);
    assert.equal(matches.length,1,def.catalogId);
    for(const alias of def.aliases){
      const resolved=catalog.resolveLegacyKey(alias);
      assert.equal(resolved.catalogId,def.catalogId,alias);
      assert.equal(resolved.canonicalKey,def.primary,alias);
      assert.ok(matches[0].legacyAliases.includes(alias),alias);
    }
  }
});

test('Professor Willow Assistant is present and distinct from WCS 2025',()=>{
  const willow=catalog.resolveLegacyKey("Pikachu (Professor Willow's Assistant)");
  const varsity=catalog.resolveLegacyKey('Pikachu Varsity Jacket');
  assert.equal(willow.catalogId,'pokemon:25:costume:PIKACHU_ANNIVERSARY_2026');
  assert.equal(varsity.catalogId,'pokemon:25:costume:PIKACHU_WCS_2025');
  assert.notEqual(willow.catalogId,varsity.catalogId);
  assert.equal(selectablePikachu.filter(entry=>entry.catalogId===willow.catalogId).length,1);
});

test('the two Worlds 2026 Pikachu are selectable, distinct identities',()=>{
  const spacesuit=catalog.resolveLegacyKey('Cosmog-themed Spacesuit Pikachu');
  const worlds=catalog.resolveLegacyKey('World Championships 2026 Pikachu');
  assert.equal(spacesuit.catalogId,'pokemon:25:costume:PIKACHU_PXP_2026');
  assert.equal(worlds.catalogId,'pokemon:25:costume:PIKACHU_WCS_2026');
  assert.notEqual(spacesuit.catalogId,worlds.catalogId);
  assert.equal(selectablePikachu.filter(entry=>entry.catalogId===spacesuit.catalogId).length,1);
  assert.equal(selectablePikachu.filter(entry=>entry.catalogId===worlds.catalogId).length,1);
});

test('all seven Flying Pikachu identities remain distinct',()=>{
  const keys=[
    'Pikachu (Flying)','Pikachu (Flying 5th Anniversary)','Pikachu (Fly Okinawa)',
    'Pikachu Flying 01','Pikachu Flying 02','Pikachu Flying 03','Pikachu Flying 04'
  ];
  const ids=keys.map(key=>catalog.resolveLegacyKey(key)?.catalogId);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size,7);
});

test('the eight identity-unresolved rows remain separate and are never guessed as aliases',()=>{
  assert.equal(catalog.UNRESOLVED_COSTUME_KEYS.length,8);
  const rows=selectablePikachu.filter(entry=>catalog.UNRESOLVED_COSTUME_KEYS.includes(entry.name));
  assert.equal(rows.length,8);
  assert.equal(new Set(rows.map(entry=>entry.catalogId)).size,8);
  for(const key of catalog.UNRESOLVED_COSTUME_KEYS)assert.equal(catalog.resolveLegacyKey(key),null,key);
});

test('unknown historical values fail safely while known aliases round trip',()=>{
  assert.equal(catalog.resolveLegacyKey('Pikachu (Unknown Future Costume)'),null);
  const legacy='Pikachu Varsity Jacket';
  const resolved=catalog.resolveLegacyKey(legacy);
  const entry=catalog.entryForLegacyKey(selectablePikachu,legacy);
  assert.equal(entry.catalogId,resolved.catalogId);
  assert.equal(entry.name,'Pikachu (Worlds 2025)');
  assert.ok(entry.legacyAliases.includes(legacy));
});

test('all twelve reported historical Pikachu keys remain owner-visible without rewriting storage',()=>{
  const historical=[
    'Pikachu (Pop Star)','Pikachu (Brendan)','Pikachu (Dawn)','Pikachu (Ethan)',
    'Pikachu (Fossil)','Pikachu (Shaymin Scarf)','Pikachu (Kariyushi Shirt)',
    'Pikachu (Hilda)','Pikachu (Top Hat)','Pikachu (Leaf)','Pikachu (Lyra)','Pikachu (May)'
  ];
  const stored=Object.fromEntries(historical.map((name,index)=>[name,index?'M':'H']));
  const before=JSON.stringify(stored);
  for(const name of historical){
    const entry=catalog.entryForLegacyKey(selectablePikachu,name);
    assert.ok(entry,name);
    assert.ok(entry.legacyAliases.includes(name),name);
  }
  const viewModel=html.slice(html.indexOf('function myListViewModel('),html.indexOf('const MY_LIST_ORDER_PREFIX'));
  const ownerEntries=html.slice(html.indexOf('function currentListEntries('),html.indexOf('function scheduleMyListFilter('));
  assert.match(ownerEntries,/Object\.entries\(list\)\.map\(\(\[name,val\]\)/);
  assert.match(ownerEntries,/return myListViewModel\(type,cur,name,val,srcMap\)/);
  assert.match(viewModel,/const model=\{\s*name,dn,/);
  assert.doesNotMatch(`${viewModel}\n${ownerEntries}`,/delete |queueSync|writeList|set\(ref/);
  assert.equal(JSON.stringify(stored),before);
});

test('localized labels and legacy aliases search the same locale-independent identity',()=>{
  const entry=catalog.entryForLegacyKey(selectablePikachu,'Pikachu Varsity Jacket');
  const labels=window.PogoI18n.pokemonNames.searchLabels(entry,{locale:'ja'});
  assert.ok(labels.includes('ピカチュウ（Worlds 2025）'));
  assert.ok(labels.includes('Pikachu Varsity Jacket'));
  assert.equal(window.PogoI18n.pokemonNames.identity(entry).variantId,'pokemon:25:costume:PIKACHU_WCS_2025');
});

test('public-share projection and lookup reconcile legacy aliases without writes',()=>{
  const snapshot={lists:{costumes:{'Pikachu Varsity Jacket':'H','Pikachu (Worlds 2025)':'M'}}};
  const projected=browse.projectSnapshot(snapshot);
  assert.equal(projected.length,1);
  assert.equal(projected[0].pokemonKey,'pokemon:25:costume:PIKACHU_WCS_2025');
  assert.equal(projected[0].priority,'H');
  const records=new Map([['owner',{status:'published',trainerKey:'owner',displayName:'Owner',entries:projected}]]);
  const index=browse.buildIndex(records);
  assert.equal(browse.resultsForPokemon(index,'Pikachu (Worlds 2025)',{favorites:[{displayName:'Owner'}]}).length,1);
  assert.equal(browse.resultsForPokemon(index,'Pikachu Varsity Jacket',{favorites:[{displayName:'Owner'}]}).length,1);
  assert.deepEqual(snapshot,{lists:{costumes:{'Pikachu Varsity Jacket':'H','Pikachu (Worlds 2025)':'M'}}});
});

test('autocomplete renders beyond eight with deterministic canonical deduplication',()=>{
  const items=Array.from({length:30},(_,index)=>({
    name:`Pikachu Variant ${index+1}`,
    dn:`Pikachu Variant ${index+1}`,
    no:25,
    catalogId:`pokemon:25:test:${index+1}`
  }));
  items.push({...items[0],name:'Old Pikachu Variant One',legacyAliases:['Old Pikachu Variant One']});
  const results=ranking.rankAutocompleteItems(items,'pika');
  assert.equal(matching.AC_RESULT_LIMIT,200);
  assert.equal(results.length,30);
  assert.equal(results.filter(item=>item.catalogId===items[0].catalogId).length,1);
  assert.ok(results[8]);
  assert.ok(results[29]);
});

test('autocomplete ranks exact display, exact alias, prefix, word-prefix, then substring',()=>{
  const items=[
    {name:'one',dn:'Pikachu',catalogId:'one'},
    {name:'two',dn:'Raichu',catalogId:'two',searchAliases:['Pikachu']},
    {name:'three',dn:'Pikachu Libre',catalogId:'three'},
    {name:'four',dn:'Costume Pikachu',catalogId:'four'},
    {name:'five',dn:'Superpikachu',catalogId:'five'}
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(ranking.rankAutocompleteItems(items,'pikachu').map(item=>item.catalogId))),['one','two','three','four','five']);
});

test('autocomplete stays bounded and fast for a realistic broad result set',t=>{
  const items=Array.from({length:1000},(_,index)=>({name:`Pikachu ${index}`,dn:`Pikachu ${index}`,no:25,catalogId:`test:${index}`}));
  const started=performance.now(),results=ranking.rankAutocompleteItems(items,'pika'),elapsed=performance.now()-started;
  assert.equal(results.length,200);
  assert.ok(elapsed<100,`ranking took ${elapsed.toFixed(2)}ms`);
  t.diagnostic(`1,000-item broad query: ${elapsed.toFixed(2)}ms`);
});

test('Find by Pokemon keyboard contract traverses and scrolls the full rendered set',()=>{
  const block=html.slice(html.indexOf('function favoriteBrowseCatalog'),html.indexOf('function favoriteBrowseEmpty'));
  assert.doesNotMatch(block,/limit\s*:\s*8/);
  assert.match(block,/rankAutocompleteItems\(favoriteBrowseCatalog\(\),query\)/);
  assert.match(block,/scrollIntoView\(\{block:'nearest'\}\)/);
  assert.match(block,/event\.key==='Enter'/);
  assert.match(block,/event\.key==='Escape'/);
  assert.match(block,/data-favorite-action="select-browse" data-favorite-index="\$\{index\}"/);
  assert.match(html,/favoriteAction==='select-browse'/);
  assert.match(html,/\.favorite-browse-search \.ac-dropdown\{z-index:350\}/);
  assert.match(html,/\.ac-dropdown\{[^}]*overflow-y:auto/);
});
