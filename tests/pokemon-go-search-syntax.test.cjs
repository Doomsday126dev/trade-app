const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=file=>readFileSync(path.join(root,file),'utf8');
const html=source('index.html');

function loadDomain(){
  const window={};window.window=window;
  const context=vm.createContext({window});
  for(const file of ['js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js'])vm.runInContext(source(file),context,{filename:file});
  return window.PogoDomain;
}

test('documented command catalog has explicit locale tokens and provenance',()=>{
  const syntax=loadDomain().pokemonGoSearchSyntax;
  assert.deepEqual(JSON.parse(JSON.stringify(syntax.SOURCE_URLS)),{
    en:'https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/',
    ja:'https://niantic.helpshift.com/hc/ja/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/?l=ja',
    es:'https://niantic.helpshift.com/hc/es/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/',
    de:'https://niantic.helpshift.com/hc/de/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/?hl=de&l=de'
  });
  const expected={
    traded:['traded','こうかん','intercambiados','getauscht'],shiny:['shiny','色違い','variocolor','Schillernd'],
    combatPower:['CP','cp','PC','WP'],shadow:['shadow','しゃどう','oscuro','Crypto'],
    purified:['purified','らいと','purificado','Erlöst'],background:['background','はいけい','fondo','hintergrund'],
    lucky:['lucky','キラ','con suerte','Glücks'],costume:['costume','とくべつ','disfraz','kostümiert']
  };
  for(const[key,values]of Object.entries(expected)){
    assert.deepEqual(['en','ja','es','de'].map(locale=>syntax.TOKEN_CATALOG[key][locale]),values,key);
    assert.deepEqual(JSON.parse(JSON.stringify(syntax.TOKEN_CATALOG[key].sourceByLocale)),JSON.parse(JSON.stringify(syntax.SOURCE_URLS)),`${key} provenance`);
  }
});

test('one semantic priority query serializes correctly in all four languages',()=>{
  const syntax=loadDomain().pokemonGoSearchSyntax,query=syntax.priorityQuery([25,150]);
  const expected={
    en:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25,150',
    ja:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25,150',
    es:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25,150',
    de:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25,150'
  };
  for(const[locale,value]of Object.entries(expected))assert.equal(syntax.serializeQuery(query,locale),value,locale);
  assert.deepEqual(JSON.parse(JSON.stringify(query.dexNumbers)),[25,150]);
});

test('catalog covers all audited generated and advanced documented terms',()=>{
  const syntax=loadDomain().pokemonGoSearchSyntax;
  const expected={
    appraisal4Star:['4*','4*','4*','4*'],locationBackground:['locationbackground','ろけーしょんはいけい','fondolugar','Ortshintergrund'],
    legendary:['legendary','伝説のポケモン','legendario','Legendär'],mythical:['mythical','まぼろし','singular','Mysteriös'],
    dynamax:['dynamax','だいまっくす','dinamax','dynamax'],gigantamax:['gigantamax','きょだいまっくす','gigamax','gigadynamax'],
    favorite:['favorite','お気に入り','favorito','Favorit'],hatched:['hatched','ふか','eclosionado','ausgebrütet'],
    eggOnly:['eggsonly','たまごのみ','huevosolo','nurausEiern'],xxl:['xxl','xxl','xxl','XXL'],xxs:['xxs','xxs','xxs','XXS']
  };
  for(const[key,values]of Object.entries(expected))assert.deepEqual(['en','ja','es','de'].map(locale=>syntax.TOKEN_CATALOG[key][locale]),values,key);
  assert.deepEqual(JSON.parse(JSON.stringify(syntax.AUDIT.notGenerated)),{
    region:'Import aid only; generated multi-Pokémon searches remain Pokédex-number based.',
    type:'No active generated type clause.',move:'No active generated move clause.',
    advancedEntryFlags:'Lucky, XXL, and XXS select separate Pokédex-number sets; they do not add a status token to current output.'
  });
});

test('operators and numeric identity remain locale-independent',()=>{
  const syntax=loadDomain().pokemonGoSearchSyntax;
  assert.deepEqual(JSON.parse(JSON.stringify(syntax.OPERATORS)),{exclude:'!',and:'&',or:'|',list:',',alternateList:[':', ';'],range:'-',appraisal:'*'});
  const model=syntax.normalizeQuery({excludeTraded:true,includeLucky:true,includeCostume:true,maxCp:1234,dexNumbers:[150,25,25]});
  assert.equal(syntax.serializeQuery(model,'ja'),'!こうかん&キラ&とくべつ&cp-1234&25,150');
  assert.equal(syntax.serializeQuery(model,'de'),'!getauscht&Glücks&kostümiert&WP-1234&25,150');
});

test('safe-transfer model localizes commands without changing its conservative semantics',()=>{
  const syntax=loadDomain().pokemonGoSearchSyntax,query=syntax.safeTransferQuery([1,25]);
  assert.equal(syntax.serializeQuery(query,'en'),'!favorite&!4*&!shiny&!shadow&!purified&!background&!traded&!legendary&!mythical&CP-2500&1,25');
  assert.equal(syntax.serializeQuery(query,'es'),'!favorito&!4*&!variocolor&!oscuro&!purificado&!fondo&!intercambiados&!legendario&!singular&PC-2500&1,25');
});

test('combined priority options regenerate in the selected command language',()=>{
  const domain=loadDomain(),syntax=domain.pokemonGoSearchSyntax,strings=domain.searchStrings;
  const en={H:syntax.serializeQuery(syntax.priorityQuery([25]),'en'),M:syntax.serializeQuery(syntax.priorityQuery([150]),'en')};
  const options=strings.combinedStringOptions(en,{locale:'de'});
  const highMedium=options.find(option=>option.levels.join(',')==='H,M');
  assert.ok(highMedium);
  assert.equal(highMedium.value,'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25,150');
});

test('Lucky and size Dex blocks preserve current number-set behavior',()=>{
  const domain=loadDomain(),syntax=domain.pokemonGoSearchSyntax,strings=domain.searchStrings;
  const lucky=strings.dexStringFromNumbers([133,25],{locale:'ja'});
  assert.equal(lucky,'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25,133');
  assert.doesNotMatch(lucky,/キラ|xxl|xxs/i);
  assert.equal(strings.stringFromSearchItems([{term:'25&alola',filters:['ignored']},{term:'150'}],{locale:'es'}),'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25,150');
});

test('1500-character warning boundary remains exact after localization',()=>{
  const strings=loadDomain().searchStrings;
  assert.deepEqual(JSON.parse(JSON.stringify(strings.strLenInfo('x'.repeat(1500)))),{len:1500,cls:'warn'});
  assert.deepEqual(JSON.parse(JSON.stringify(strings.strLenInfo('x'.repeat(1501)))),{len:1501,cls:'danger'});
});

test('search-language override is device-local and regenerates every visible string surface',()=>{
  assert.match(html,/const POGO_SEARCH_LANGUAGE_KEY='pogoPokemonGoSearchLocale:v1'/);
  assert.match(html,/id="settings-search-language-override"[^>]*onchange="togglePokemonGoSearchLocaleOverride\(this\.checked\)"/);
  assert.match(html,/id="settings-search-language-override-row" hidden/);
  assert.match(html,/id="settings-search-language"[^>]*onchange="changePokemonGoSearchLocale\(this\.value\)"/);
  const block=html.slice(html.indexOf('function pokemonGoSearchLanguagePreference'),html.indexOf('function saveSyncQueue'));
  assert.match(block,/lsGet\(POGO_SEARCH_LANGUAGE_KEY,null\)/);
  assert.match(block,/if\(value!==null\)lsRemove\(POGO_SEARCH_LANGUAGE_KEY\)/);
  assert.match(block,/function togglePokemonGoSearchLocaleOverride\(enabled\)/);
  assert.match(block,/if\(next==='follow-app'\)lsRemove\(POGO_SEARCH_LANGUAGE_KEY\)/);
  assert.match(block,/lsSet\(POGO_SEARCH_LANGUAGE_KEY,next\)/);
  assert.match(block,/checkbox\.checked=override/);
  assert.match(block,/row\.hidden=!override/);
  assert.match(block,/select\.disabled=!override/);
  assert.match(block,/renderMyStrings\(\);renderStrings\(\)/);
  assert.match(block,/renderDiffModal\(\)/);
  assert.match(block,/renderSafeTransferOutput\(\)/);
  assert.match(block,/renderShareView\(_activeShareView\.username,_activeShareView\.type\)/);
  assert.doesNotMatch(block,/userPreferences|trainerPreferences|firebase|queueSync|set\s*\(\s*ref|update\s*\(\s*ref|fetch\s*\(/i);
});

test('language panel makes app language primary and the search override subordinate',()=>{
  const panel=html.slice(html.indexOf('<section class="settings-section language-settings-panel"'),html.indexOf('</section>',html.indexOf('<section class="settings-section language-settings-panel"')));
  assert.match(panel,/class="language-primary-row"/);
  assert.match(panel,/settings\.searchLanguageAutomatic/);
  assert.match(panel,/settings\.searchLanguageOverride/);
  assert.match(panel,/aria-controls="settings-search-language-override-row"/);
  assert.doesNotMatch(panel,/option value="follow-app"/);
  assert.match(html,/\.language-override-toggle\{[^}]*min-height:48px/);
  assert.match(html,/\.language-primary-row select,\.language-override-row select\{min-height:48px\}/);
  assert.match(html,/\.language-primary-row\{grid-template-columns:1fr;gap:6px\}/);
});

test('visible and copied query bytes share one selected-locale value',()=>{
  const window={};window.window=window;
  const context=vm.createContext({window});
  for(const file of ['js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js','js/domain/priorities.js','js/ui/badges.js','js/utils/textSafety.js','js/ui/stringHtml.js','js/ui/stringPanels.js'])vm.runInContext(source(file),context,{filename:file});
  const value=window.PogoDomain.pokemonGoSearchSyntax.serializeQuery(window.PogoDomain.pokemonGoSearchSyntax.priorityQuery([25]),'ja');
  const panel=window.PogoUi.stringPanels.strLevelsHtml({H:value},{searchLocale:'ja'});
  const escaped=value.replaceAll('&','&amp;');
  assert.match(panel,new RegExp(`data-copy="${escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`));
  assert.match(panel,new RegExp(`<div class="strbox">${escaped.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</div>`));
});

test('My List ARIA labels use complete locale templates around localized names',()=>{
  const render=html.slice(html.indexOf('function renderMyList(filterVal)'),html.indexOf('function confirmRemove'));
  for(const key of ['myList.setHighPriority','myList.setMediumPriority','myList.setLowPriority','myList.toggleLuckyFor','myList.toggleShinyFor','myList.toggleXxlFor','myList.toggleXxsFor','myList.removeEntry','myList.reorderEntry'])assert.ok(html.includes(`i18nCore.t('${key}'`)||html.includes(`'${key}'`),key);
  assert.doesNotMatch(render,/aria-label="Set \$\{|aria-label="Toggle (?:Lucky|Shiny|XXL|XXS)|aria-label="Remove"/);
});

test('command catalog and serializer have no UI-catalog, storage, Firebase, or network dependency',()=>{
  for(const file of ['js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js']){
    const code=source(file);
    assert.doesNotMatch(code,/PogoLocales|i18nCore|localStorage|sessionStorage|indexedDB|firebase|firebaseio|fetch\s*\(|WebSocket|XMLHttpRequest/i,file);
  }
});
