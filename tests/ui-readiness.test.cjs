const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function emptyState(){
  const window={};
  vm.runInContext(readFileSync(path.join(root,'js/ui/emptyState.js'),'utf8'),vm.createContext({window}));
  return window.PogoUi.emptyState;
}

test('active login, navigation, My List, and Settings controls use translation hooks',()=>{
  for(const key of ['login.subtitle','login.username','login.pin','login.signIn','login.trouble','login.requestAccess','app.mainSections','myList.addTitle','myList.searchPlaceholder','myList.listTitle','settings.languageTitle','settings.localToolsTitle']){
    assert.match(html,new RegExp(`data-i18n(?:-[a-z-]+)?="${key.replaceAll('.','\\.')}"`),key);
  }
  assert.match(html,/function applyTranslationAttributes\(root=document\)/);
  assert.match(html,/document\.documentElement\.lang=i18nCore\.getLocale\(\)/);
});

test('manual language selection is device-local and exposes all four supported locales',()=>{
  assert.match(html,/id="settings-language" onchange="changeInterfaceLocale\(this\.value\)"/);
  for(const locale of ['en','ja','es','de'])assert.match(html,new RegExp(`<option value="${locale}"`));
  const core=readFileSync(path.join(root,'js/i18n/core.js'),'utf8');
  assert.match(core,/LOCALE_STORAGE_KEY='pogoUiLocale:v1'/);
  assert.doesNotMatch(html,/changeInterfaceLocale[\s\S]{0,300}(userPreferences|shareAccess|managedTrainerPreferencesRepository)/);
});

test('Settings is removed from primary navigation and relocated to an account dialog',()=>{
  const tabs=html.slice(html.indexOf('<div class="tabs" role="tablist"'),html.indexOf('</div>',html.indexOf('<div class="tabs" role="tablist"')));
  assert.doesNotMatch(tabs,/settings|nav-settings/);
  assert.match(html,/id="account-trigger"[^>]+aria-expanded="false"[^>]+aria-controls="account-popover"/);
  assert.match(html,/id="account-popover"[^>]+hidden/);
  assert.match(html,/id="account-settings-action" onclick="openSettingsPanel\('account'\)"/);
  assert.match(html,/id="account-signout-action" onclick="logout\(\)"/);
  assert.match(html,/id="settings-modal" role="dialog" aria-modal="true"/);
  assert.doesNotMatch(html,/id="tab-settings"/);
});

test('signed-out and anonymous screens expose language settings without a profile menu',()=>{
  assert.match(html,/id="login-language-trigger"[^>]+openSettingsPanel\('public'\)/);
  assert.match(html,/id="share-language-trigger"[^>]+openSettingsPanel\('public'\)/);
  assert.match(html,/function configureSettingsPanel\(context='public'\)/);
  assert.match(html,/el\.hidden=_settingsContext!=='account'/);
});

test('account menu and Settings dialog preserve keyboard focus and route compatibility',()=>{
  assert.match(html,/popover\.querySelector\('button'\)\?\.focus\(\)/);
  assert.match(html,/if\(e\.key==='Escape'&&popover&&!popover\.hidden\)/);
  assert.match(html,/if\(ev\.key==='Escape'\)\{closeModal\(id\);return;\}/);
  assert.match(html,/_modalPrevFocus\?\.focus\?\.\(\)/);
  assert.match(html,/history\.pushState\([^\n]+settingsPanel:true/);
  assert.match(html,/window\.addEventListener\('popstate',syncSettingsRoute\)/);
  assert.match(html,/window\.addEventListener\('hashchange',syncSettingsRoute\)/);
  assert.match(html,/action==='settings'/);
});

test('relocated Settings retains local locale controls and exposes no preference writes',()=>{
  assert.match(html,/id="settings-language" onchange="changeInterfaceLocale\(this\.value\)"/);
  assert.match(html,/class="settings-panel local-preferences-panel settings-account-only"/);
  assert.doesNotMatch(html,/function (?:openSettingsPanel|changeInterfaceLocale)[\s\S]{0,800}(?:firebaseSet|firebaseUpdate|managedTrainerPreferencesRepository\.write)/);
});

test('standard states distinguish loading, offline, authorization, stale, and update-required UI',()=>{
  const ui=emptyState();
  for(const kind of ['loading','offline','retrying','unavailable','permission_denied','signed_out','empty','stale','update_required'])assert.equal(ui.stateModel(kind).kind,kind);
  assert.match(ui.stateHtml(ui.stateModel('loading',{title:'Loading'})),/aria-live="polite" aria-busy="true"/);
  assert.match(ui.stateHtml(ui.stateModel('permission_denied',{title:'Private'})),/aria-live="assertive"/);
  assert.doesNotMatch(ui.stateHtml(ui.stateModel('unavailable',{title:'Unavailable'})),/Firebase|PERMISSION_DENIED/);
});

test('Find Trainer preserves public-only reads and distinct projection states',()=>{
  assert.match(html,/managedPublicShareRepository\.read/);
  assert.match(html,/publicShares\/\$\{username\}/);
  assert.match(html,/projection_incomplete.*trainer\.shareNeedsRepublishing/);
  assert.match(html,/projection_unsupported.*trainer\.sharedMalformed/);
  assert.doesNotMatch(html,/loadPublicShareData[\s\S]{0,900}(wishlist\/\$\{username\}|users\/\$\{username\})/);
});

test('local preferences stay clearly device-local and expose no enabled sync control',()=>{
  assert.match(html,/class="settings-panel local-preferences-panel settings-account-only"/);
  assert.match(html,/data-i18n="settings\.syncComingLater"/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
  assert.doesNotMatch(html,/id="settings-(?:sync|save)-preferences"/);
});

test('responsive and accessibility safeguards cover compact screens, long labels, focus, and reduced motion',()=>{
  assert.match(html,/@media\(max-width:360px\)/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.match(html,/:focus-visible\{outline:3px solid var\(--ac2\)/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/min-height:48px/);
  assert.match(html,/window\.visualViewport/);
  assert.match(html,/role="combobox" aria-autocomplete="list"/);
  assert.match(html,/if\(ev\.key==='Escape'\)\{closeModal\(id\);return;\}/);
});

test('Events distinguish loading, offline, filtered-empty, and legitimate empty states',()=>{
  assert.match(html,/stateModel\('loading',\{title:i18nCore\.t\('events\.loading'\)/);
  assert.match(html,/stateModel\('offline',\{title:i18nCore\.t\('events\.offline'\)/);
  assert.match(html,/eventTypeFilter==='all'\?'events\.empty':'events\.filteredEmpty'/);
});

test('owner share recovery remains explicit and readiness gated',()=>{
  assert.match(html,/onclick="republishOwnPublicShare\(\)"/);
  assert.match(html,/managedPublicSharePublication\.authorize\(token,'explicit_share'\)/);
  assert.match(html,/share\.ownerPrivateSafe/);
});
