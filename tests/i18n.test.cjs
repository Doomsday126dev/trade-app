const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');

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
  assert.equal(expected.length,1025);
  for(const locale of ['ja','es','de'])assert.deepEqual(Object.keys(catalogs[locale]).sort(),expected,locale);
});

test('Recent Trainer recency uses natural Viewed copy in every supported locale',()=>{
  const {core,catalogs}=load();
  const expected={
    en:['Viewed 12m ago','Viewed 3h ago','Viewed 2d ago','Viewed 3w ago'],
    ja:['12分前に閲覧','3時間前に閲覧','2日前に閲覧','3週間前に閲覧'],
    es:['Visto hace 12 min','Visto hace 3 h','Visto hace 2 d','Visto hace 3 sem'],
    de:['Vor 12 Min. angesehen','Vor 3 Std. angesehen','Vor 2 T. angesehen','Vor 3 Wo. angesehen']
  };
  for(const [locale,values] of Object.entries(expected)){
    const translator=core.createTranslator({catalogs,locale});
    assert.deepEqual([
      translator.t('trainer.viewedMinutes',{count:12}),
      translator.t('trainer.viewedHours',{count:3}),
      translator.t('trainer.viewedDays',{count:2}),
      translator.t('trainer.viewedWeeks',{count:3})
    ],values,locale);
  }
});

test('My List category context is complete and localized',()=>{
  const {catalogs}=load();
  const required=[
    'myList.categories','myList.categoryTabLabel','myList.categoryCount','myList.filteredCategoryCount',
    'myList.empty.wishlistTitle','myList.empty.dynamaxTitle','myList.empty.gigantamaxTitle','myList.empty.othersTitle',
    'myList.empty.othersHelp','myList.viewCategory','myList.viewCategoryLabel','strings.categoryTitle','strings.emptyCategoryTitle'
  ];
  for(const key of required){
    for(const locale of ['en','ja','es','de'])assert.ok(String(catalogs[locale][key]||'').trim(),`${locale}:${key}`);
  }
  for(const locale of ['ja','es','de'])assert.notEqual(catalogs[locale]['myList.empty.othersHelp'],catalogs.en['myList.empty.othersHelp'],locale);
});

test('active setup, Admin, profile, import, export, and safety surfaces use catalog keys',()=>{
  const required=[
    'setup.title','setup.failed','request.sendFailed','admin.pendingRequests','admin.memberAddFailed',
    'profile.title','profile.friendCodeInvalid','health.title','import.summary','export.shareCopyFailed',
    'safeTransfer.limitWarning','specialBoard.description','shortcuts.title','bulk.deleteConfirm'
  ];
  const {catalogs}=load();
  for(const key of required){
    for(const locale of ['en','ja','es','de'])assert.ok(String(catalogs[locale][key]||'').trim(),`${locale}:${key}`);
    for(const locale of ['ja','es','de'])assert.notEqual(catalogs[locale][key],catalogs.en[key],`${locale}:${key}`);
  }
  for(const marker of [
    'data-i18n="setup.title"','data-i18n="request.title"','data-i18n="admin.pendingRequests"',
    'data-i18n="settings.sectionProfile"','data-i18n="health.title"','data-i18n="import.title"',
    'data-i18n="safeTransfer.title"','data-i18n="specialBoard.title"','data-i18n="shortcuts.title"'
  ])assert.match(html,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('active runtime feedback does not expose raw Firebase errors',()=>{
  const requestBlock=html.slice(html.indexOf('async function submitRequest'),html.indexOf('// ── PROFILE'));
  const profileBlock=html.slice(html.indexOf('async function saveProfile'),html.indexOf('// ── UI HELPERS'));
  const setupBlock=html.slice(html.indexOf('async function connectFirebase'),html.indexOf('function applyDataPath'));
  for(const block of [requestBlock,profileBlock,setupBlock]){
    assert.match(block,/i18nCore\.t\(/);
    assert.doesNotMatch(block,/textContent\s*=\s*['"`]❌?\s*['"`]\s*\+\s*e\.message/);
  }
  assert.match(html,/console\.warn\('Firebase setup failed',e\)/);
});

test('covered active runtime surfaces use locale keys instead of English-only feedback',()=>{
  for(const literal of [
    "toast('✅ Backup downloaded!')","toast('⚠️ Admin only')",
    "emptyHtml('No search strings yet'","emptyHtml('No matching Pokémon'",
    "toast('⚠️ Select a Pokémon from the list')","toast('✅ App installed!')",
    "confirm('Wipe all LF and FT entries from this board?')","toast('No variants found')",
    "toast('Pick another trainer')","toast('🎤 Voice input requires HTTPS')",
    "textContent=`${haveBulkSelected.size} selected`"
  ])assert.ok(!html.includes(literal),literal);
  for(const key of [
    'common.noResults','myList.queueAdded','browse.noMatches','strings.noSearchStrings',
    'backup.restoreConfirm','inventory.bulkDeleteConfirm','health.clearCacheConfirm',
    'specialBoard.clearConfirm','install.unavailable','myList.addAllVariantsTitle',
    'compare.pickAnother','voice.requiresHttps'
  ])assert.ok(html.includes(`i18nCore.t('${key}'`)||html.includes(`i18nCore.t(\`${key}\``),key);
  assert.match(html,/i18nCore\.t\(`saveStatus\.\$\{s\}Help`\)/);
});

test('canonical and private values remain outside interface translation',()=>{
  assert.match(html,/placeholder="https:\/\/your-project-default-rtdb\.firebaseio\.com"/);
  assert.doesNotMatch(html,/const SAFE_TRANSFER_PREFILTER=/);
  assert.match(html,/pokemonGoSearchSyntaxDomain\.safeTransferQuery\(safe\)/);
  assert.match(html,/pokemonGoSearchSyntaxDomain\.serializeQuery\(query,pokemonGoSearchLocale\(\)\)/);
  assert.match(html,/tag\.label/);
  assert.doesNotMatch(html,/favorite\.note|organizer-note/);
  const exportBlock=html.slice(html.indexOf('function exportMyListMarkdown'),html.indexOf('// ── SPECIAL TRADE BOARD'));
  assert.doesNotMatch(exportBlock,/trainerPreferences|trainerHistoryStore|favorite\.note|tag\.label|organizer/);
});

test('retired trade-offer surfaces stay classified and unreachable in trainer-first mode',()=>{
  assert.match(html,/const TRAINER_FIRST_INTERIM_ENABLED=true/);
  assert.match(html,/id="accept-offer-modal"/);
  const interim=readFileSync(path.join(__dirname,'trainer-first-interim.test.cjs'),'utf8');
  assert.match(interim,/retired records remain present and no deletion migration is introduced/);
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

test('Account & Security readiness copy is complete and localized',()=>{
  const {catalogs}=load();
  const keys=[
    'security.title','security.description','security.methodsLabel','security.google','security.email',
    'security.discord','security.legacyPin','security.notLinked','security.active','security.futureUnavailable',
    'security.emailPlanned','security.legacyPinHelp','security.disabledNotice'
  ];
  for(const key of keys){
    for(const locale of ['en','ja','es','de'])assert.ok(String(catalogs[locale][key]||'').trim(),`${locale}:${key}`);
    for(const locale of ['ja','es','de']){
      if(!['security.google','security.discord'].includes(key))assert.notEqual(catalogs[locale][key],catalogs.en[key],`${locale}:${key}`);
    }
  }
});
