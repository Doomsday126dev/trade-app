'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
function loadWithoutIdentity(){
  const window={};
  vm.runInNewContext(source('js/domain/pokemonGoSearchSyntax.js'),{window,Object,Set});
  vm.runInNewContext(source('js/domain/searchStrings.js'),{window,Object,Set});
  return window.PogoDomain.searchStrings;
}
function loadIdentityAware(){
  const window={};
  for(const file of [
    'js/domain/pokemonKeys.js','js/domain/publicPokemonDex.js',
    'js/i18n/pokemonNames/catalog.js','js/i18n/pokemonNames/variants.js',
    'js/i18n/pokemonNames/structuredForms.js','js/i18n/pokemonNames/core.js',
    'js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js'
  ])vm.runInNewContext(source(file),{window,Object,Set});
  return window;
}
const load=()=>loadIdentityAware().PogoDomain.searchStrings;
const plain=value=>JSON.parse(JSON.stringify(value));

const EXPECTED=Object.freeze({
  en:Object.freeze({protected:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25,150',broad:'!traded&25,150'}),
  ja:Object.freeze({protected:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25,150',broad:'!こうかん&25,150'}),
  es:Object.freeze({protected:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25,150',broad:'!intercambiados&25,150'}),
  de:Object.freeze({protected:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25,150',broad:'!getauscht&25,150'})
});

test('literal locale oracle keeps notes, forms and gender in one protected section command',()=>{
  const search=load();
  for(const [locale,expected]of Object.entries(EXPECTED)){
    assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,p:'H'},{name:'Mewtwo',no:150,p:'M'}],{locale}).parts),[expected.protected]);
    for(const annotation of [{gender:'f'},{mod:'Exact form'},{note:'ordinary note'},{category:'dynamax'}]){
      assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,...annotation},{name:'Mewtwo',no:150,...annotation}],{locale}).parts),[expected.protected],`${locale} ${JSON.stringify(annotation)}`);
    }
  }
});

test('canonical form policy is invariant across interface labels and game-search languages',()=>{
  const window=loadIdentityAware(),search=window.PogoDomain.searchStrings,names=window.PogoI18n.pokemonNames;
  const canonical={name:'H-Typhlosion',displayName:'H-Typhlosion',no:157};
  const labels=Object.fromEntries(['en','ja','es','de'].map(locale=>[locale,names.displayName(canonical,{locale})]));
  assert.deepEqual(labels,{
    en:'H-Typhlosion',ja:'ヒスイのすがた バクフーン',
    es:'Typhlosion (forma de Hisui)',de:'Tornupto (Hisui-Form)'
  });
  const expected=Object.freeze({en:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&157',ja:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&157',es:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&157',de:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&157'});
  for(const interfaceLocale of ['en','ja','es','de'])for(const gameLocale of ['en','ja','es','de']){
    const entry={...canonical,dn:labels[interfaceLocale],displayName:labels[interfaceLocale]};
    assert.equal(search.contextualEntryIdentity(entry).category,'catalog-identity');
    assert.equal(search.contextualEntryPolicy(entry).id,'section');
    const plan=search.contextualSearchPlan([entry],{locale:gameLocale});
    assert.equal(plan.policy,'section');
    assert.deepEqual(plain(plan.parts),[expected[gameLocale]]);
    assert.deepEqual(plain(search.stringParts(plan.parts[0])),['157']);
  }
});

test('catalog semantics cover full-width descriptors, regional aliases, hyphenated forms, and legacy aliases',()=>{
  const window=loadIdentityAware(),search=window.PogoDomain.searchStrings,names=window.PogoI18n.pokemonNames;
  const origin={name:'Giratina (Origin)',displayName:'Giratina (Origin)',no:487};
  const japaneseOrigin=names.displayName(origin,{locale:'ja'});
  assert.equal(japaneseOrigin,'ギラティナ（オリジンフォルム）');
  for(const entry of [
    {...origin,dn:japaneseOrigin,displayName:japaneseOrigin},
    {name:'H-Typhlosion',dn:'ヒスイのすがた バクフーン',no:157},
    {name:'Galarian Articuno',dn:'ガラルのすがた フリーザー',no:144},
    {name:'Pikachu Party Hat',dn:'ピカチュウ（パーティーハット）',no:25},
    {name:'Pikachu (Purple Party)',dn:'Pikachu mit Partyhut',no:25}
  ])assert.equal(search.contextualEntryPolicy(entry).id,'section',entry.name);
  for(const locale of ['en','ja','es','de']){
    const entry={name:'Nidoran-F',dn:names.displayName({name:'Nidoran-F',displayName:'Nidoran-F',no:29},{locale}),no:29};
    assert.equal(search.contextualEntryPolicy(entry).id,'section',locale);
  }
  const unresolved={name:'Unknown translated form',dn:'ヒスイのすがた バクフーン',no:157};
  assert.equal(search.contextualEntryPolicy(unresolved).id,'unresolved');
  const plan=search.contextualSearchPlan([unresolved],{locale:'ja'});
  assert.equal(plan.unresolved,1);assert.equal(plan.policy,'none');assert.deepEqual(plain(plan.parts),[]);
});

test('named identities fail closed when canonical dependencies are unavailable',()=>{
  const search=loadWithoutIdentity();
  assert.equal(search.contextualEntryIdentity({name:'H-Typhlosion',no:157}).category,'identity-unavailable');
  const named=search.contextualSearchPlan([{name:'H-Typhlosion',no:157}],{locale:'en'});
  assert.equal(named.unresolved,1);assert.deepEqual(plain(named.parts),[]);
  assert.deepEqual(plain(search.contextualSearchPlan([{no:157}],{locale:'en'}).parts),[EXPECTED.en.protected.replace('25,150','157')]);
});

test('hyphenated Pumpkaboo form retains policy and species across all interface labels',()=>{
  const search=loadIdentityAware().PogoDomain.searchStrings;
  const canonical={name:'Pumpkaboo - Super',no:710};
  const labels=['Pumpkaboo - Super','バケッチャ（とくだいサイズ）','Pumpkaboo (tamaño extragrande)','Irrbis (Größe XL)'];
  const outputs={en:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&710',ja:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&710',es:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&710',de:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&710'};
  for(const label of labels)for(const [locale,expected]of Object.entries(outputs)){
    const entry={...canonical,dn:label,displayName:label};
    assert.equal(search.contextualEntryPolicy(entry).id,'section');
    assert.deepEqual(plain(search.contextualSearchPlan([entry],{locale}).parts),[expected]);
  }
});

test('mixed explicit requirements make one compatible command and deduplicate species',()=>{
  const search=load(),plan=search.contextualSearchPlan([
    {name:'Pikachu',no:25,p:'H'},
    {name:'Pikachu',no:25,shiny:true},
    {name:'Mewtwo',no:150,lucky:true}
  ],{locale:'en'});
  assert.deepEqual(plain(plan.parts),['!4*&CP-2500&!shadow&!purified&!background&25,150']);
  assert.deepEqual(plain(plan.partPolicies),['section']);
  assert.equal(plan.policy,'section');
});

test('independent special sections use compatible positive constraints',()=>{
  const search=load();
  assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,lucky:true}],{locale:'en'}).parts),['!4*&!shiny&CP-2500&!shadow&!purified&!background&lucky&25']);
  assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,xxl:true}],{locale:'en'}).parts),['!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxl&25']);
  assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,xxs:true}],{locale:'en'}).parts),['!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&xxs&25']);
  assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,shiny:true}],{locale:'en'}).parts),['!4*&!traded&CP-2500&!shadow&!purified&!background&25']);
});

test('device-local game language wins in public views only when override is explicit',()=>{
  const search=load();
  assert.equal(search.resolveGameLocalePreference('en','de',true),'de');
  assert.equal(search.resolveGameLocalePreference('en','de',false),'en');
  assert.equal(search.resolveGameLocalePreference('ja','fr',true),'ja');
  assert.deepEqual(plain(search.GAME_LANGUAGE_STORAGE_KEYS),{locale:'pogoPokemonGoSearchLocale:v1',override:'pogoPokemonGoSearchLocaleOverride:v1'});
});

test('Who-wants refresh and public renderer consume current game-language state',()=>{
  const application=source('js/app/application.js'),publicApp=source('js/app/publicShareApp.js');
  const refresh=application.slice(application.indexOf('function rerenderPokemonGoSearchLanguageSurfaces'),application.indexOf('function changePokemonGoSearchLocale'));
  assert.match(refresh,/favoriteBrowseState\.selected\)renderFavoriteBrowseResults\(\)/);
  assert.match(application,/function favoriteLookupSignature\(model\)\{return JSON\.stringify\(\[pokemonGoSearchLocale\(\),model\.entries\]\);\}/);
  assert.match(application,/dataset\.lookupSignature=favoriteLookupSignature\(model\)/);
  assert.match(publicApp,/GAME_LANGUAGE_STORAGE_KEYS/);
  assert.match(publicApp,/resolveGameLocalePreference\(core\(\)\.getLocale\(\),stored,override\)/);
  assert.match(publicApp,/contextualSearchPlan\(entries,\{locale:pokemonGoSearchLocale\(\)\}\)/);
});
