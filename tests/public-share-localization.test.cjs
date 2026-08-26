const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=file=>readFileSync(path.join(root,file),'utf8');
const html=source('index.html');

function load(){
  const window={
    navigator:{languages:['en'],language:'en'},
    localStorage:{getItem(){return null;},setItem(){}}
  };
  window.window=window;
  const context=vm.createContext({window,Intl,Date,URL});
  for(const file of [
    'js/i18n/locales/en.js','js/i18n/locales/ja.js','js/i18n/locales/es.js','js/i18n/locales/de.js',
    'js/i18n/core.js','js/domain/priorities.js','js/ui/badges.js','js/domain/pokemonGoSearchSyntax.js','js/domain/searchStrings.js',
    'js/utils/textSafety.js','js/ui/stringHtml.js','js/ui/stringPanels.js'
  ])vm.runInContext(source(file),context,{filename:file});
  return window;
}

function block(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`Missing ${start}`);
  assert.notEqual(to,-1,`Missing ${end}`);
  return html.slice(from,to);
}

test('anonymous share catalogs have exact parity and natural share chrome',()=>{
  const window=load(),catalogs=window.PogoLocales;
  const keys=Object.keys(catalogs.en).sort();
  assert.equal(keys.length,1174);
  for(const locale of ['ja','es','de'])assert.deepEqual(Object.keys(catalogs[locale]).sort(),keys,locale);
  assert.equal(catalogs.ja['share.listTitle'],'{username} の交換リスト');
  assert.equal(catalogs.es['share.listTitle'],'Lista de intercambios de {username}');
  assert.equal(catalogs.de['share.listTitle'],'Tauschliste von {username}');
  for(const locale of ['en','ja','es','de'])assert.ok(catalogs[locale]['share.listTab']);
  for(const key of [
    'share.updated','share.entryCount.one','share.entryCount.other','share.copy',
    'share.copied','share.viewSearch','share.hideSearch','share.copyFailed','share.combinedOptions','share.emptyTitle','share.flagShiny'
  ])for(const locale of ['ja','es','de'])assert.notEqual(catalogs[locale][key],catalogs.en[key],`${locale}:${key}`);
});

test('share counts use locale plural rules and locale number formatting',()=>{
  const core=load().PogoI18n.core;
  core.setLocale('en',{persist:false});
  assert.equal(core.formatPlural('share.entryCount',1),'1 entry');
  assert.equal(core.formatPlural('share.entryCount',2),'2 entries');
  core.setLocale('ja',{persist:false});
  assert.equal(core.formatPlural('share.entryCount',1),'1件');
  assert.equal(core.formatPlural('share.entryCount',2),'2件');
  core.setLocale('es',{persist:false});
  assert.equal(core.formatPlural('share.entryCount',1),'1 entrada');
  assert.equal(core.formatPlural('share.entryCount',2),'2 entradas');
  core.setLocale('de',{persist:false});
  assert.equal(core.formatPlural('share.entryCount',1),'1 Eintrag');
  assert.equal(core.formatPlural('share.entryCount',1234),'1.234 Einträge');
});

test('share renderer routes dynamic chrome through i18n without changing priority identity',()=>{
  const render=block('function renderShareView(username,type){','// ── SWIPE GESTURES');
  for(const key of [
    'share.listTitle','share.listTab','share.emptyTitle','share.emptyHelp','share.entryCount',
    'share.flagFemale','share.flagMale','share.flagLucky','share.flagShiny','share.flagXxl','share.flagXxs'
  ])assert.ok(render.includes(key),key);
  assert.match(render,/publicShareUpdatedLabel\(ud\.lastUpdated\)/);
  assert.match(render,/publicSharePriorityBadge\(p\)/);
  assert.match(render,/strLevelsHtml\(strs,\{t:i18nCore\.t,formatNumber:i18nCore\.formatNumber,priorityLabel:publicSharePriorityLabel,searchLocale:pokemonGoSearchLocale\(\)\}\)/);
  assert.doesNotMatch(render,/'s Trade List|Updated \$\{|LIST_LABELS\[t\]|No entries in this list|sorted\.length===1\?'entry':'entries'/);
  const priorities=load().PogoDomain.priorities;
  assert.deepEqual(JSON.parse(JSON.stringify(priorities.PRI)),{
    H:{label:'High',emoji:'🔴'},M:{label:'Medium',emoji:'🟡'},L:{label:'Low',emoji:'🟢'}
  });
});

test('public search panels localize controls while preserving canonical clipboard bytes',()=>{
  const window=load(),core=window.PogoI18n.core,panel=window.PogoUi.stringPanels;
  const canonical='!4*&!traded&25,150';
  core.setLocale('de',{persist:false});
  const de=panel.strLevelsHtml({H:canonical,M:'1',L:'2'}, {
    t:core.t,formatNumber:core.formatNumber,
    priorityLabel:p=>core.t({H:'priority.high',M:'priority.medium',L:'priority.low'}[p])
  });
  assert.match(de,/Hoch/);
  assert.match(de,/Kopieren/);
  assert.match(de,/Kombinierte Optionen/);
  assert.match(de,/Suche anzeigen/);
  assert.match(de,/Suche ausblenden/);
  assert.ok((de.match(/<details class="share-search-disclosure">/g)||[]).length>=3);
  assert.doesNotMatch(de,/<details class="share-search-disclosure" open/);
  assert.match(de,/data-copy-scope="share"/);
  assert.match(de,/data-copy="!4\*&amp;!traded&amp;25,150"/);
  core.setLocale('ja',{persist:false});
  const ja=panel.strLevelsHtml({H:canonical}, {
    t:core.t,formatNumber:core.formatNumber,priorityLabel:()=>core.t('priority.high')
  });
  assert.match(ja,/高/);
  assert.match(ja,/コピー/);
  assert.match(ja,/検索を表示/);
  assert.match(ja,/data-copy="!4\*&amp;!traded&amp;25,150"/);
});

test('all generated priority and Dex panels use explicit Search String labels',()=>{
  const window=load(),core=window.PogoI18n.core,panel=window.PogoUi.stringPanels;
  core.setLocale('en',{persist:false});
  const rendered=panel.strLevelsHtml({H:'1',M:'2',L:'3',LUCKY:'4',SHINY:'5',XXL:'6',XXS:'7'}, {
    t:core.t,formatNumber:core.formatNumber,
    priorityLabel:p=>core.t({H:'priority.high',M:'priority.medium',L:'priority.low'}[p])
  });
  for(const label of [
    'High Priority Search String','Medium Priority Search String','Low Priority Search String',
    'Lucky Dex Search String','Shiny Dex Search String','XXL Dex Search String','XXS Dex Search String'
  ])assert.match(rendered,new RegExp(label));
  for(const value of ['1','2','3','4','5','6','7'])assert.match(rendered,new RegExp(`data-copy="${value}"`));
});

test('copy success and failure use anonymous-share keys only for share buttons',()=>{
  const copy=block('async function copyStr(str,btn){','// ── STRINGS PAGE');
  assert.match(copy,/dataset\.copyScope==='share'\?'share':'strings'/);
  assert.match(copy,/i18nCore\.t\(`\$\{keyPrefix\}\.copied`\)/);
  assert.match(copy,/i18nCore\.t\(`\$\{keyPrefix\}\.copySuccess`\)/);
  assert.match(copy,/i18nCore\.t\(`\$\{keyPrefix\}\.copyFailed`\)/);
});

test('locale switch rerenders the active share without reads, publication, writes, or URL reset',()=>{
  const change=block('function changeInterfaceLocale(locale){','let trainerSuggestionTimer');
  assert.match(change,/renderShareView\(_activeShareView\.username,_activeShareView\.type\)/);
  assert.match(change,/const scrollX=window\.scrollX,scrollY=window\.scrollY/);
  assert.match(change,/window\.scrollTo\(scrollX,scrollY\)/);
  assert.doesNotMatch(change,/loadPublicShareData|ensureShareViewSubscriptions|requestPublicSharePublication|publishPublicShareNow|publicShares|queueSync|set\(ref|history\.|location\./);
});

test('anonymous share localization has no Firebase or network capability',()=>{
  for(const file of [
    'js/i18n/core.js','js/i18n/locales/en.js','js/i18n/locales/ja.js','js/i18n/locales/es.js',
    'js/i18n/locales/de.js','js/ui/stringHtml.js','js/ui/stringPanels.js'
  ])assert.doesNotMatch(source(file),/\bfetch\s*\(|new\s+WebSocket|XMLHttpRequest|queueSync\s*\(|set\s*\(\s*ref|update\s*\(\s*ref/i,file);
  const render=block('const PUBLIC_SHARE_LIST_KEYS','// ── SWIPE GESTURES');
  assert.doesNotMatch(render,/requestPublicSharePublication|publishPublicShareNow|queueSync|set\(ref|update\(ref/);
});

test('Japanese and German share chrome retains bounded responsive wrapping',()=>{
  assert.match(html,/#share-view\{[^}]*overflow-x:hidden[^}]*max-width:100vw/);
  assert.match(html,/\.share-list-tabs\{[^}]*flex-wrap:wrap/);
  assert.match(html,/\.share-hdr-name\{[^}]*word-break:break-word/);
  assert.match(html,/\.str-level-hdr\{[^}]*flex-wrap:wrap/);
  assert.match(html,/\.strbox\{[^}]*word-break:break-all/);
  assert.match(html,/#share-view\s+\.cpbtn\{[^}]*min-height:48px/);
  assert.match(html,/\.share-search-disclosure summary\{[^}]*min-height:48px/);
});

test('release 2026-08-26.64 is coherent and contains no active .63 assets',()=>{
  const worker=source('sw.js'),release=source('js/domain/clientRelease.js');
  assert.match(html,/window\.__POGO_RELEASE_ID='2026-08-26\.64'/);
  assert.match(worker,/const RELEASE='2026-08-26\.64'/);
  assert.match(release,/RELEASE_ID='2026-08-26\.64'/);
  const firstParty=[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match=>match[1]).filter(src=>!/^https?:/.test(src));
  assert.equal(firstParty.length,64);
  for(const src of firstParty)assert.equal(new URL(src,'https://example.test').searchParams.get('v'),'2026-08-26.64');
  assert.doesNotMatch(`${html}\n${worker}\n${release}`,/2026-08-25\.63/);
});
