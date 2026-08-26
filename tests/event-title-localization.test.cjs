const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=file=>readFileSync(path.join(root,file),'utf8');
const html=source('index.html');
const window={};window.window=window;
const context=vm.createContext({window,Intl});
for(const file of ['js/i18n/pokemonNames/catalog.js','js/i18n/pokemonNames/variants.js','js/i18n/pokemonNames/structuredForms.js','js/i18n/pokemonNames/core.js','js/i18n/eventLabels/currentTitles.js','js/i18n/eventLabels/core.js'])vm.runInContext(source(file),context,{filename:file});
const labels=window.PogoI18n.eventLabels;

const captured=[
  ['season-23-forever-forward','event','Forever Forward'],
  ['summer-marathon-2026','event','Summer Marathon: Arctic Embers'],
  ['go-pass-august-2026','event','GO Pass: August'],
  ['fire-and-ice-hatch-day-2026','event','Fire and Ice Hatch Day'],
  ['water-festival-2026','event','Ultra Unlock: Water Festival'],
  ['august-communityday2026','community-day','Nickit Community Day'],
  ['starmie-super-mega-raid-day-2026','raid-day','Starmie Super Mega Raid Day'],
  ['pokemon-go-fest-2026-mega-finale','event','Pokémon GO Fest 2026: Mega Finale'],
  ['spotlight-wurmple','pokemon-spotlight-hour','Wurmple Spotlight Hour'],
  ['spotlight-magikarp','pokemon-spotlight-hour','Magikarp Spotlight Hour'],
  ['spotlight-mankey','pokemon-spotlight-hour','Mankey Spotlight Hour'],
  ['raid-hour-lake','raid-hour','Uxie, Mesprit, and Azelf Raid Hour'],
  ['raid-hour-groudon','raid-hour','Groudon Raid Hour'],
  ['raid-hour-lunala','raid-hour','Lunala Raid Hour'],
  ['max-beldum','max-battles','Beldum Max Battle Day'],
  ['max-magikarp','max-mondays','Dynamax Magikarp during Max Monday'],
  ['max-hitmontop','max-mondays','Dynamax Hitmontop during Max Monday'],
  ['max-eevee','max-mondays','Dynamax Eevee during Max Monday'],
  ['mega-blaziken','raid-battles','Mega Blaziken in Mega Raids'],
  ['mega-garchomp','raid-battles','Mega Garchomp in Mega Raids'],
  ['mega-swampert','raid-battles','Mega Swampert in Mega Raids'],
  ['mega-gyarados','raid-battles','Mega Gyarados in Mega Raids'],
  ['lake-trio','raid-battles','Uxie, Mesprit, and Azelf in 5-star Raid Battles'],
  ['groudon','raid-battles','Groudon in 5-star Raid Battles'],
  ['lunala','raid-battles','Lunala in 5-star Raid Battles'],
  ['regis','raid-battles','Regirock, Regice, and Registeel in 5-star Raid Battles'],
  ['shadow-giratina','raid-battles','Shadow Giratina in Shadow Raids'],
  ['gbl-weather','go-battle-league','Ultra League and Weather Cup: Great League Edition | Forever Forward'],
  ['gbl-evolution','go-battle-league','Master League and Evolution Cup: Great League Edition | Forever Forward'],
  ['gbl-scroll','go-battle-league','Great League and Scroll Cup: Great League Edition | Forever Forward'],
  ['gbl-mega','go-battle-league','Great League, Ultra League, and Master League: Mega Edition | Forever Forward'],
  ['pokemon-xp-worlds','event','Pokémon XP & 2026 Worlds'],
  ['twitch-worlds','event','Twitch Drops for 2026 Pokémon World Championships'],
  ['lego-stores','event','Pokémon GO at LEGO Stores'],
  ['choose-path','event','Choose Your Path']
].map(([eventID,eventType,name])=>({eventID,eventType,name}));

test('official localized titles resolve by stable event identity with provenance',()=>{
  const event={eventID:'water-festival-2026',eventType:'event',name:'Raw English title'};
  assert.deepEqual(JSON.parse(JSON.stringify(labels.titleResolution(event,'ja'))),{text:'ウルトラアンロック：ウォーターフェスティバル',status:'official-localized',stableId:'water-festival-2026',ambiguous:false});
  const record=window.PogoI18n.eventTitleCatalog.titlesByEventId['water-festival-2026'];
  for(const locale of ['en','ja','es','de'])assert.match(record.sources[locale],new RegExp(`^https://pokemongo\\.com/${locale}/`));
});

test('structured recurring titles use localized Pokemon names and complete templates',()=>{
  const event={eventID:'spotlight',eventType:'pokemon-spotlight-hour',name:'Wurmple Spotlight Hour'};
  assert.equal(labels.title(event,'ja'),'ケムッソのスポットライトアワー');
  assert.equal(labels.title(event,'es'),'Hora del Pokémon destacado: Wurmple');
  assert.equal(labels.title(event,'de'),'Rampenlicht-Stunde mit Waumpel');
  assert.equal(labels.titleResolution(event,'de').status,'structured-localized');
});

test('multi-Pokemon raid titles compose locale-aware lists',()=>{
  const event={eventID:'regis',eventType:'raid-battles',name:'Regirock, Regice, and Registeel in 5-star Raid Battles'};
  assert.equal(labels.title(event,'ja'),'レジロック、レジアイス、レジスチルが伝説レイドバトルに登場');
  assert.equal(labels.title(event,'es'),'Regirock, Regice y Registeel en incursiones de cinco estrellas');
  assert.equal(labels.title(event,'de'),'Regirock, Regice und Registeel in Stufe-5-Raids');
});

test('GO Battle League rotations use official localized league and season terms',()=>{
  const event={eventID:'gbl',eventType:'go-battle-league',name:'Great League, Ultra League, and Master League: Mega Edition | Forever Forward'};
  assert.equal(labels.title(event,'ja'),'スーパーリーグ：メガバージョン、ハイパーリーグ：メガバージョン、マスターリーグ：メガバージョン｜新たな歩み');
  assert.equal(labels.title(event,'es'),'Liga Super Ball: Edición Mega, Liga Ultra Ball: Edición Mega y Liga Master Ball: Edición Mega | Siempre Adelante');
  assert.equal(labels.title(event,'de'),'Mega-Edition: Superliga, Mega-Edition: Hyperliga und Mega-Edition: Meisterliga | Immer weiter');
});

test('unverified unique branded titles remain explicit English fallbacks',()=>{
  const event={eventID:'pokemon-xp-worlds',eventType:'event',name:'Pokémon XP & 2026 Worlds'};
  assert.deepEqual(JSON.parse(JSON.stringify(labels.titleResolution(event,'ja'))),{text:event.name,status:'english-fallback',stableId:event.eventID,ambiguous:false});
  assert.equal(labels.title({eventID:'pokemon-go-fest-2026-mega-finale',eventType:'event',name:'Pokémon GO Fest 2026: Mega Finale'},'ja'),'Pokémon GO Fest 2026: Mega Finale');
});

test('captured current-event coverage substantially limits fallback in every locale',t=>{
  const reports=Object.fromEntries(['en','ja','es','de'].map(locale=>[locale,JSON.parse(JSON.stringify(labels.coverage(captured,locale)))]));
  for(const report of Object.values(reports)){
    assert.equal(report.total,captured.length);
    assert.equal(report.ambiguous,0);
    assert.ok(report.officialLocalized>=7);
    assert.ok(report.structuredLocalized>=22);
    assert.ok(report.englishFallback<=5);
  }
  assert.equal(reports.ja.officialLocalized,7);
  for(const locale of ['en','es','de'])assert.equal(reports[locale].officialLocalized,8);
  t.diagnostic(JSON.stringify(reports));
});

test('locale changes preserve event identity and do not refetch or rewrite cache',()=>{
  const event=captured.find(item=>item.eventID==='regis'),id=labels.eventId(event);
  const outputs=['en','ja','de','es','en'].map(locale=>labels.localizeEvent(event,locale));
  for(const output of outputs)assert.equal(output.stableId,id);
  assert.deepEqual(event,{eventID:'regis',eventType:'raid-battles',name:'Regirock, Regice, and Registeel in 5-star Raid Battles'});
  const change=html.slice(html.indexOf('function changeInterfaceLocale'),html.indexOf('let trainerSuggestionTimer'));
  assert.match(change,/renderEventsOnly\(\)/);
  assert.doesNotMatch(change,/fetchPogoEvents|EVENT_CACHE_KEY|localStorage\.setItem/);
});

test('event localization assets have no Firebase, storage, or runtime network capability',()=>{
  for(const file of ['js/i18n/eventLabels/currentTitles.js','js/i18n/eventLabels/core.js'])assert.doesNotMatch(source(file),/localStorage|sessionStorage|indexedDB|firebase|firebaseio|fetch\s*\(|WebSocket|XMLHttpRequest|\.set\s*\(\s*ref|\.update\s*\(\s*ref/i,file);
});
