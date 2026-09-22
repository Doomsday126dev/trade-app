'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
function load(){
  const window={};
  vm.runInNewContext(source('js/domain/pokemonGoSearchSyntax.js'),{window,Object,Set});
  vm.runInNewContext(source('js/domain/searchStrings.js'),{window,Object,Set});
  return window.PogoDomain.searchStrings;
}
const plain=value=>JSON.parse(JSON.stringify(value));

const EXPECTED=Object.freeze({
  en:Object.freeze({protected:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25,150',broad:'!traded&25,150'}),
  ja:Object.freeze({protected:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25,150',broad:'!こうかん&25,150'}),
  es:Object.freeze({protected:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25,150',broad:'!intercambiados&25,150'}),
  de:Object.freeze({protected:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25,150',broad:'!getauscht&25,150'})
});

test('literal locale oracle covers complete ordinary and special command policies',()=>{
  const search=load();
  for(const [locale,expected]of Object.entries(EXPECTED)){
    assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,p:'H'},{name:'Mewtwo',no:150,p:'M'}],{locale}).parts),[expected.protected]);
    for(const requirement of [{shiny:true},{lucky:true},{xxl:true},{xxs:true},{gender:'f'},{mod:'Exact form'},{category:'dynamax'}]){
      assert.deepEqual(plain(search.contextualSearchPlan([{name:'Pikachu',no:25,...requirement},{name:'Mewtwo',no:150,...requirement}],{locale}).parts),[expected.broad],`${locale} ${JSON.stringify(requirement)}`);
    }
  }
});

test('mixed scopes split policy domains and keep repeated species where meanings differ',()=>{
  const search=load(),plan=search.contextualSearchPlan([
    {name:'Pikachu',no:25,p:'H'},
    {name:'Pikachu',no:25,shiny:true},
    {name:'Mewtwo',no:150,lucky:true}
  ],{locale:'en'});
  assert.deepEqual(plain(plan.parts),[
    '!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25',
    '!traded&25,150'
  ]);
  assert.deepEqual(plain(plan.partPolicies),['ordinary-protected','special-broad']);
  assert.equal(plan.policy,'mixed');
});

test('policy table makes contradictory exclusions and prospective Lucky behavior explicit',()=>{
  const search=load(),policies=search.CONTEXTUAL_SEARCH_POLICIES;
  assert.equal(policies.ordinary.query.excludeShiny,true);
  assert.equal(policies.shiny.query.excludeShiny,undefined);
  assert.equal(policies.lucky.query.includeLucky,undefined);
  assert.equal(policies.size.query.includeXxl,undefined);
  assert.equal(policies.size.query.includeXxs,undefined);
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
