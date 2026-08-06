const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load({languages=['en-US'],storedLocale=''}={}){
  const values=new Map(storedLocale?[['pogoUiLocale:v1',storedLocale]]:[]);
  const window={navigator:{languages,language:languages[0]},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
  const context=vm.createContext({window});
  for(const file of ['js/i18n/locales/en.js','js/i18n/locales/ja.js','js/i18n/locales/es.js','js/i18n/locales/de.js','js/i18n/core.js']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return{core:window.PogoI18n.core,catalogs:window.PogoLocales,values};
}

test('English fallback works for future and region-specific locales',()=>{
  const {createTranslator}=load().core;
  const translator=createTranslator({catalogs:{en:{hello:'Hello'},ja:{hello:'こんにちは'}},locale:'ja-JP'});
  assert.equal(translator.t('hello'),'こんにちは');
  translator.setLocale('de-DE');
  assert.equal(translator.t('hello'),'Hello');
});

test('complete messages interpolate named parameters',()=>{
  const {createTranslator}=load().core;
  const translator=createTranslator({catalogs:{en:{count:'Found {count} trainers for {query}.'}}});
  assert.equal(translator.t('count',{count:2,query:'Pika'}),'Found 2 trainers for Pika.');
});

test('missing keys remain stable and are reported without hardcoded replacement text',()=>{
  const {createTranslator}=load().core;
  const missing=[];
  const translator=createTranslator({catalogs:{en:{}},locale:'es',onMissing:item=>missing.push(item)});
  assert.equal(translator.t('profile.missing'),'profile.missing');
  assert.deepEqual(missing.map(item=>[item.key,item.locale,item.kind]),[['profile.missing','es','ui']]);
});

test('Pokemon-name localization stays separate from interface catalogs',()=>{
  const {createTranslator}=load().core;
  const translator=createTranslator({
    catalogs:{en:{pikachu:'Interface label'}},
    pokemonCatalogs:{en:{pikachu:'Pikachu'},ja:{pikachu:'ピカチュウ'}},
    locale:'ja'
  });
  assert.equal(translator.t('pikachu'),'Interface label');
  assert.equal(translator.pokemonName('pikachu'),'ピカチュウ');
});

test('the default catalog provides parameterized data-state keys',()=>{
  const {core}=load();
  assert.equal(core.t('data.loading',{resource:'trainer'}),'Loading trainer…');
  assert.equal(core.t('data.empty',{resource:'trainers'}),'No trainers found.');
});

test('session ownership warnings use stable translation keys with English fallback',()=>{
  const {core}=load();
  assert.match(core.t('storage.pendingChangesDiscarded'),/ownership could not be verified/);
  assert.match(core.t('storage.cacheReset'),/Cached session data was reset/);
  assert.match(core.t('storage.sessionOwnershipMismatch'),/does not match the authenticated account/);
  assert.match(core.t('storage.offlineRecoveryUnavailable'),/securely verified again/);
  assert.match(core.t('data.ownedReadUnavailable'),/verified offline cache remains available/);
});

test('English, Japanese, Spanish, and German expose the same UI key set',()=>{
  const {catalogs}=load();
  const expected=Object.keys(catalogs.en).sort();
  for(const locale of ['ja','es','de'])assert.deepEqual(Object.keys(catalogs[locale]).sort(),expected,locale);
});

test('browser locale detection uses a supported base language and stored choice wins',()=>{
  assert.equal(load({languages:['fr-FR','ja-JP']}).core.getLocale(),'ja');
  assert.equal(load({languages:['ja-JP'],storedLocale:'de-DE'}).core.getLocale(),'de');
  assert.equal(load({languages:['fr-FR']}).core.getLocale(),'en');
});

test('manual locale selection persists only the supported device locale',()=>{
  const {core,values}=load();
  assert.equal(core.setLocale('es-MX'),'es');
  assert.equal(values.get(core.LOCALE_STORAGE_KEY),'es');
});

test('Intl date, number, and relative-time formatting follow the active locale',()=>{
  const {core}=load({storedLocale:'de'});
  assert.match(core.formatNumber(1234.5),/1[.\s]234,5/);
  assert.match(core.formatDate(new Date('2026-08-05T12:00:00Z'),{timeZone:'UTC',month:'long'}),/August/);
  assert.match(core.formatRelativeTime(-3,'day'),/3 Tagen/);
});

test('active Japanese, Spanish, and German labels are natural overrides rather than Pokemon-name data',()=>{
  const {catalogs}=load();
  assert.equal(catalogs.ja['trainer.findTitle'],'トレーナー検索');
  assert.equal(catalogs.es['settings.languageTitle'],'Idioma');
  assert.equal(catalogs.de['myList.addTitle'],'Pokémon hinzufügen');
  assert.equal(catalogs.ja['account.openMenu'],'アカウントメニューを開く');
  assert.equal(catalogs.es['account.signOut'],'Cerrar sesión');
  assert.equal(catalogs.de['account.languageSettings'],'Spracheinstellungen');
  for(const locale of ['en','ja','es','de'])assert.equal(Object.hasOwn(catalogs[locale],'pokemon.pikachu'),false);
});
