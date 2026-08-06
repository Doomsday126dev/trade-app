const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {gzipSync,brotliCompressSync}=require('node:zlib');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
function source(file){return readFileSync(path.join(root,file),'utf8');}
function load(files){
  const window={};const context=vm.createContext({window,Intl,URL});
  for(const file of files)vm.runInContext(source(file),context,{filename:file});
  return window;
}
const window=load([
  'js/i18n/pokemonNames/catalog.js','js/i18n/pokemonNames/core.js','js/i18n/eventLabels/core.js',
  'js/domain/autocompleteText.js','js/domain/autocompleteMatching.js'
]);
const pokemon=window.PogoI18n.pokemonNames;
const events=window.PogoI18n.eventLabels;
const matching=window.PogoDomain.autocompleteMatching;
const dataWindow={};vm.runInNewContext(source('data.js'),{window:dataWindow});
const appEntries=['wishlist','dynamax','gmax','costumes'].flatMap(key=>dataWindow.POGO_TRADE_DB[key]);
const appSpeciesIds=[...new Set(appEntries.map(entry=>Number(entry.no)))].sort((a,b)=>a-b);

test('Pokemon display lookup uses stable species and variant identity',()=>{
  const entry={no:25,name:'Pikachu',displayName:'Pikachu'};
  assert.deepEqual(JSON.parse(JSON.stringify(pokemon.identity(entry))),{speciesId:25,variantId:'Pikachu'});
  assert.equal(pokemon.displayName(entry,{locale:'ja'}),'ピカチュウ');
  assert.equal(pokemon.displayName(entry,{locale:'es-MX'}),'Pikachu');
  assert.equal(pokemon.displayName(entry,{locale:'de-DE'}),'Pikachu');
  assert.deepEqual(entry,{no:25,name:'Pikachu',displayName:'Pikachu'});
});

test('Pokemon names fall back through base locale, English, and safe original labels',()=>{
  assert.equal(pokemon.displayName({no:150,name:'Mewtwo',displayName:'Mewtwo'},{locale:'de-AT'}),'Mewtu');
  assert.equal(pokemon.displayName({no:999,name:'FutureMon',displayName:'Future Mon'},{locale:'ja'}),'Future Mon');
  assert.equal(pokemon.displayName({no:25,name:'Pikachu Costume 2020',displayName:'Pikachu Costume 2020'},{locale:'ja'}),'Pikachu Costume 2020');
  assert.equal(pokemon.displayName({no:25,name:'Pikachu',displayName:'Pikachu'},{locale:'fr'}),'Pikachu');
});

test('regional forms use locale-aware templates without changing canonical keys',()=>{
  const alolan={no:37,name:'A-Vulpix',displayName:'A-Vulpix'};
  assert.equal(pokemon.displayName(alolan,{locale:'ja'}),'アローラのすがた ロコン');
  assert.equal(pokemon.displayName(alolan,{locale:'es'}),'Vulpix (forma de Alola)');
  assert.equal(pokemon.displayName(alolan,{locale:'de'}),'Vulpix (Alola-Form)');
  assert.equal(pokemon.identity(alolan).variantId,'A-Vulpix');
});

test('localized and English Pokemon names remain searchable together',()=>{
  const entry={no:1,name:'Bulbasaur',displayName:'Bulbasaur'};
  const item={name:entry.name,dn:pokemon.displayName(entry,{locale:'ja'}),no:entry.no};
  item.search=window.PogoDomain.autocompleteText.normalizeAcText(pokemon.searchLabels(entry,{locale:'ja'}).join(' '));
  assert.notEqual(matching.acMatchScore(item,'フシギダネ'),-1);
  assert.notEqual(matching.acMatchScore(item,'Bulbasaur'),-1);
  assert.equal(item.name,'Bulbasaur');
});

test('coverage reports are explicit and do not claim a complete catalog',()=>{
  const entries=[{no:1},{no:25},{no:2000}];
  for(const locale of ['en','ja','es','de']){
    const report=pokemon.coverage(entries,locale);
    assert.equal(report.translatedSpecies,2);
    assert.equal(report.totalSpecies,3);
    assert.equal(report.complete,false);
  }
});

test('generated catalogs completely cover every stable species ID in data.js',()=>{
  assert.equal(appEntries.length,966);
  assert.equal(appSpeciesIds.length,571);
  assert.equal(appEntries.filter(entry=>!Number.isInteger(Number(entry.no))||Number(entry.no)<=0).length,0);
  for(const locale of ['en','ja','es','de']){
    const catalog=window.PogoPokemonNameCatalogs[locale],keys=Object.keys(catalog);
    assert.equal(keys.length,1025,`${locale} source catalog`);
    assert.equal(new Set(keys).size,keys.length,`${locale} duplicate mapping`);
    assert.equal(appSpeciesIds.filter(id=>!String(catalog[id]||'').trim()).length,0,`${locale} missing app species`);
    assert.deepEqual(JSON.parse(JSON.stringify(pokemon.coverage(appEntries,locale))),{locale,translatedSpecies:571,totalSpecies:571,fallbackSpecies:0,complete:true});
  }
  assert.deepEqual(JSON.parse(JSON.stringify(window.PogoPokemonNameCatalogSource)),{
    repository:'PokeAPI/pokeapi',path:'data/v2/csv/pokemon_species_names.csv',gitBlobSha:'44954a1248493d8cc336f121ce5cce394cee9ac0',retrievedAt:'2026-08-06',sourceSpecies:1025,languageIds:{ja:1,de:6,es:7,en:9}
  });
});

test('official examples, accents, gender symbols, aliases, and numeric lookup remain searchable',()=>{
  const examples=[
    [{no:1,name:'Bulbasaur',displayName:'Bulbasaur'},'ja','フシギダネ','Bulbasaur'],
    [{no:635,name:'Hydreigon',displayName:'Hydreigon'},'de','Trikephalo','Hydreigon'],
    [{no:669,name:'Flabébé',displayName:'Flabébé'},'es','Flabébé','Flabebe'],
    [{no:29,name:'Nidoran-F',displayName:'Nidoran-F'},'ja','ニドラン♀','Nidoran-F']
  ];
  for(const[entry,locale,localized,englishQuery]of examples){
    const search=window.PogoDomain.autocompleteText.normalizeAcText(pokemon.searchLabels(entry,{locale}).join(' '));
    const item={name:entry.name,dn:pokemon.displayName(entry,{locale}),no:entry.no,search};
    assert.equal(item.dn,localized);
    assert.notEqual(matching.acMatchScore(item,localized),-1);
    assert.notEqual(matching.acMatchScore(item,englishQuery),-1);
    assert.notEqual(matching.acMatchScore(item,String(entry.no)),-1);
  }
});

test('repeated locale switching changes labels but never stable Pokemon identity',()=>{
  const entry={no:150,name:'Mewtwo',displayName:'Mewtwo'},identity=JSON.stringify(pokemon.identity(entry));
  const labels=['en','ja','de','es','en'].map(locale=>pokemon.displayName(entry,{locale}));
  assert.deepEqual(labels,['Mewtwo','ミュウツー','Mewtu','Mewtwo','Mewtwo']);
  for(const locale of ['en','ja','de','es','en'])assert.equal(JSON.stringify(pokemon.identity(entry)),identity);
  assert.deepEqual(entry,{no:150,name:'Mewtwo',displayName:'Mewtwo'});
});

test('event localization uses stable IDs and selected, base, English, then source fallback',()=>{
  const event={id:'community-day-2026-08',title:{en:'August Community Day',ja:'8月のコミュニティ・デイ'},summary:{en:'Official source summary'},eventType:'community-day'};
  assert.equal(events.eventId(event),'community-day-2026-08');
  assert.equal(events.title(event,'ja-JP'),'8月のコミュニティ・デイ');
  assert.equal(events.title(event,'de-DE'),'August Community Day');
  assert.equal(events.summary(event,'es'),'Official source summary');
  assert.equal(events.title({eventID:'source-1',name:'English source title'},'ja'),'English source title');
});

test('event type and structured bonus labels localize without rewriting prose',()=>{
  assert.equal(events.typeLabel('raid-day','ja'),'レイド・デイ');
  assert.equal(events.typeLabel('spotlight hour','es'),'Hora del Pokémon destacado');
  assert.equal(events.bonusLabel('stardust-bonus','de'),'Sternenstaub-Bonus');
  const sourceEvent={eventID:'one',name:'Source title',description:'Untranslated source prose'};
  assert.equal(events.localizeEvent(sourceEvent,'ja').localizedSummary,'Untranslated source prose');
  assert.equal(events.bonusLabel('unknown_future_bonus','ja'),'');
});

test('recurring event titles compose only from exact species and locale templates',()=>{
  const spotlight={eventID:'spotlight-1',eventType:'pokemon-spotlight-hour',name:'Delibird Spotlight Hour'};
  assert.equal(events.title(spotlight,'ja'),'デリバードのスポットライトアワー');
  assert.equal(events.title(spotlight,'es'),'Hora del Pokémon destacado: Delibird');
  assert.equal(events.title(spotlight,'de'),'Rampenlicht-Stunde mit Botogel');
  assert.equal(events.title({eventID:'cd-1',eventType:'community-day',name:'Nickit Community Day'},'de'),'Community Day mit Kleptifux');
  assert.equal(events.title({eventID:'max-1',eventType:'max-mondays',name:'Dynamax Beldum during Max Monday'},'ja'),'マックスマンデー：ダイマックスダンバル');
  assert.equal(events.title({eventID:'unique-1',eventType:'pokemon-go-fest',name:'Pokémon GO Fest 2026: Mega Finale'},'ja'),'Pokémon GO Fest 2026: Mega Finale');
  assert.equal(events.title({eventID:'multi-1',eventType:'raid-hour',name:'Uxie, Mesprit, and Azelf Raid Hour'},'de'),'Uxie, Mesprit, and Azelf Raid Hour');
});

test('official event maps win while English-only maps and prose fall back cleanly',()=>{
  const official={eventID:'mapped',title:{en:'Official English',ja:'公式タイトル'},summary:{en:'English prose',de:'Deutscher Text'}};
  assert.deepEqual(JSON.parse(JSON.stringify(events.titleResolution(official,'ja'))),{text:'公式タイトル',status:'official-localized',stableId:'mapped'});
  assert.deepEqual(JSON.parse(JSON.stringify(events.titleResolution(official,'es'))),{text:'Official English',status:'english-fallback',stableId:'mapped'});
  assert.equal(events.summary(official,'de'),'Deutscher Text');
  assert.equal(events.summary(official,'es'),'English prose');
});

test('locale switching rerenders active shares and never publishes or mutates stored identities',()=>{
  const change=html.slice(html.indexOf('function changeInterfaceLocale'),html.indexOf('let trainerSuggestionTimer'));
  assert.match(change,/renderShareView\(_activeShareView\.username,_activeShareView\.type\)/);
  assert.match(change,/buildAcItems\(\)/);
  assert.match(change,/renderEventsOnly\(\)/);
  assert.doesNotMatch(change,/eventTypeFilter\s*=/);
  assert.match(change,/trainer-organizer-modal[\s\S]*renderTrainerOrganizer\(\)/);
  assert.doesNotMatch(change,/resetTrainerOrganizerState\(\)/);
  assert.doesNotMatch(change,/requestPublicSharePublication|publishPublicShareNow|writeList|queueSync|set\(ref/);
  assert.match(html,/dispMap\[e\.name\]=pokemonDisplayName\(e\)/);
});

test('event cache stays source-faithful and locale changes neither refetch nor rewrite it',()=>{
  const fetchBlock=html.slice(html.indexOf('async function fetchPogoEvents'),html.indexOf('function currentEvents'));
  const change=html.slice(html.indexOf('function changeInterfaceLocale'),html.indexOf('let trainerSuggestionTimer'));
  assert.match(fetchBlock,/localStorage\.setItem\(EVENT_CACHE_KEY,JSON\.stringify\(\{t:Date\.now\(\),data:_eventData\}\)\)/);
  assert.doesNotMatch(fetchBlock,/eventLabelsI18n|localizedTitle|pokemonDisplayName/);
  assert.doesNotMatch(change,/fetchPogoEvents|EVENT_CACHE_KEY|localStorage\.setItem/);
  assert.match(html,/prepareEvents\(_eventData\.events\|\|\[\],\{filter:eventTypeFilter\}\)/);
  const badges=html.slice(html.indexOf('function eventBadgeForPokemon'),html.indexOf('function renderEventBanner'));
  const banner=html.slice(html.indexOf('function renderEventBanner'),html.indexOf('// ── POKÉBALL'));
  assert.match(badges,/eventLabelsI18n\.typeLabel/);
  assert.doesNotMatch(badges,/>⚔ Raid<|>⏰ Spotlight<|>🎉 Event</);
  assert.match(banner,/i18nCore\.formatRelativeTime\(daysLeft,'day'\)/);
  assert.doesNotMatch(banner,/day\$\{daysLeft===1/);
});

test('all Pokemon render surfaces route displayed labels through the resolver',()=>{
  for(const pattern of [
    /function pokemonDisplayName[\s\S]*pokemonNamesI18n\.displayName/,
    /buildAcItems[\s\S]*pokemonSearchLabels/,
    /renderMyList[\s\S]*pokemonDisplayName/,
    /renderBrowse[\s\S]*pokemonDisplayName/,
    /renderShareView[\s\S]*pokemonDisplayName/,
    /renderMyHave[\s\S]*pokemonDisplayName/,
    /dispMap\[e\.name\]=pokemonDisplayName\(e\)/
  ])assert.match(html,pattern);
});

test('catalog asset remains bounded and offline-precacheable',()=>{
  const catalog=Buffer.from(source('js/i18n/pokemonNames/catalog.js'));
  assert.ok(catalog.length<100000,`catalog bytes ${catalog.length}`);
  assert.ok(gzipSync(catalog).length<45000);
  assert.ok(brotliCompressSync(catalog).length<40000);
  assert.match(source('sw.js'),/'js\/i18n\/pokemonNames\/catalog\.js'/);
  assert.match(html,/js\/i18n\/pokemonNames\/catalog\.js\?v=2026-08-05\.12/);
});

test('generated Pokemon GO strings remain canonical and localization has no storage or Firebase capability',()=>{
  const strings=html.slice(html.indexOf('function buildStrings'),html.indexOf('function renderMyStrings'));
  assert.doesNotMatch(strings,/pokemonDisplayName|pokemonNamesI18n|i18nCore\.getLocale/);
  for(const file of ['js/i18n/pokemonNames/catalog.js','js/i18n/pokemonNames/core.js','js/i18n/eventLabels/core.js']){
    assert.doesNotMatch(source(file),/localStorage|sessionStorage|firebase|firebaseio|queueSync|fetch\(|XMLHttpRequest|\.set\(|\.update\(/i,file);
  }
});

test('trainer organizer data remains locale-independent and untouched',()=>{
  const store=source('js/data/trainerHistoryStore.js');
  assert.match(store,/const VERSION=2/);
  assert.doesNotMatch(store,/pokemonNames|eventLabels/);
  assert.match(html,/tag\.label/);
  assert.match(html,/favorite\.note/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
});
