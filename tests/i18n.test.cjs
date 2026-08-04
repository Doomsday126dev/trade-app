const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(){
  const window={};
  const context=vm.createContext({window});
  for(const file of ['js/i18n/locales/en.js','js/i18n/core.js']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return window.PogoI18n.core;
}

test('English fallback works for future and region-specific locales',()=>{
  const {createTranslator}=load();
  const translator=createTranslator({catalogs:{en:{hello:'Hello'},ja:{hello:'こんにちは'}},locale:'ja-JP'});
  assert.equal(translator.t('hello'),'こんにちは');
  translator.setLocale('de-DE');
  assert.equal(translator.t('hello'),'Hello');
});

test('complete messages interpolate named parameters',()=>{
  const {createTranslator}=load();
  const translator=createTranslator({catalogs:{en:{count:'Found {count} trainers for {query}.'}}});
  assert.equal(translator.t('count',{count:2,query:'Pika'}),'Found 2 trainers for Pika.');
});

test('missing keys remain stable and are reported without hardcoded replacement text',()=>{
  const {createTranslator}=load();
  const missing=[];
  const translator=createTranslator({catalogs:{en:{}},locale:'es',onMissing:item=>missing.push(item)});
  assert.equal(translator.t('profile.missing'),'profile.missing');
  assert.deepEqual(missing.map(item=>[item.key,item.locale,item.kind]),[['profile.missing','es','ui']]);
});

test('Pokemon-name localization stays separate from interface catalogs',()=>{
  const {createTranslator}=load();
  const translator=createTranslator({
    catalogs:{en:{pikachu:'Interface label'}},
    pokemonCatalogs:{en:{pikachu:'Pikachu'},ja:{pikachu:'ピカチュウ'}},
    locale:'ja'
  });
  assert.equal(translator.t('pikachu'),'Interface label');
  assert.equal(translator.pokemonName('pikachu'),'ピカチュウ');
});

test('the default catalog provides parameterized data-state keys',()=>{
  const core=load();
  assert.equal(core.t('data.loading',{resource:'trainer'}),'Loading trainer…');
  assert.equal(core.t('data.empty',{resource:'trainers'}),'No trainers found.');
});

test('session ownership warnings use stable translation keys with English fallback',()=>{
  const core=load();
  assert.match(core.t('storage.pendingChangesDiscarded'),/ownership could not be verified/);
  assert.match(core.t('storage.cacheReset'),/Cached session data was reset/);
  assert.match(core.t('storage.sessionOwnershipMismatch'),/does not match the authenticated account/);
  assert.match(core.t('storage.offlineRecoveryUnavailable'),/securely verified again/);
  assert.match(core.t('data.ownedReadUnavailable'),/verified offline cache remains available/);
});
