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
  for(const key of ['login.subtitle','login.username','login.pin','login.signIn','login.trouble','login.requestAccess','app.mainSections','myList.addTitle','myList.searchPlaceholder','myList.categories','settings.languageTitle','settings.sectionTools','settings.sectionData']){
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

test('Settings presents one primary language with an accessible optional search-language override',()=>{
  assert.match(html,/class="settings-section language-settings-panel"/);
  assert.match(html,/id="settings-search-language-automatic"[^>]+data-i18n="settings\.searchLanguageAutomatic"/);
  assert.match(html,/id="settings-search-language-override"[^>]+aria-controls="settings-search-language-override-row"[^>]+aria-describedby="settings-search-language-override-help"/);
  assert.match(html,/id="settings-search-language-override-row" hidden/);
  assert.match(html,/id="settings-search-language"[^>]+disabled[^>]+aria-describedby="settings-search-language-override-help"/);
  assert.match(html,/\.language-field select\{[^}]*min-height:48px/);
  assert.match(html,/\.language-override-toggle\{[^}]*min-height:48px/);
  assert.match(html,/\.language-primary-row select,\.language-override-row select\{min-height:48px\}/);
});

test('Settings is removed from primary navigation and uses routed desktop plus dialog presentation',()=>{
  const tabs=html.slice(html.indexOf('<div class="tabs" role="tablist"'),html.indexOf('</div>',html.indexOf('<div class="tabs" role="tablist"')));
  assert.doesNotMatch(tabs,/settings|nav-settings/);
  assert.match(html,/id="account-trigger"[^>]+aria-expanded="false"[^>]+aria-controls="account-popover"/);
  assert.match(html,/id="account-popover"[^>]+hidden/);
  assert.match(html,/id="account-settings-action" onclick="openSettingsPanel\('account'\)"/);
  assert.match(html,/id="account-signout-action" onclick="logout\(\)"/);
  assert.match(html,/id="settings-modal" role="dialog" aria-modal="true"/);
  assert.match(html,/\.settings-overlay\.settings-page-mode\{/);
  assert.match(html,/if\(pageMode\)\{overlay\.removeAttribute\('role'\);overlay\.removeAttribute\('aria-modal'\);\}/);
  assert.doesNotMatch(html,/id="tab-settings"/);
});

test('account and Settings controls expose 48px minimum touch targets',()=>{
  assert.match(html,/\.account-trigger\{[^}]*min-width:48px;min-height:48px/);
  assert.match(html,/\.account-action\{[^}]*min-height:48px/);
  assert.match(html,/\.local-settings-trigger\{[^}]*min-height:48px/);
  assert.match(html,/\.settings-modal-close\{[^}]*width:48px;height:48px;min-width:48px;min-height:48px/);
});

test('favorite organizer trigger and sheet controls expose 48px touch targets',()=>{
  assert.match(html,/\.trainer-icon-btn\{width:48px;height:48px/);
  assert.match(html,/\.organizer-close\{width:48px;height:48px;min-width:48px/);
  assert.match(html,/\.organizer-add-tag button,\.organizer-new-tag-toggle\{min-height:48px/);
  assert.match(html,/\.favorite-card-add-tag\{width:auto;height:48px;min-width:64px/);
  assert.match(html,/\.favorite-card-more\{width:48px;height:48px;min-width:48px/);
  assert.match(html,/\.organizer-body\{[^}]*overflow-y:auto/);
  assert.match(html,/padding-bottom:calc\(20px \+ env\(safe-area-inset-bottom\)\)/);
});

test('signed-out and anonymous screens expose language settings without a profile menu',()=>{
  assert.match(html,/id="login-language-trigger"[^>]+openSettingsPanel\('public'\)/);
  assert.match(html,/id="share-language-trigger"[^>]+openSettingsPanel\('public'\)/);
  assert.match(html,/function configureSettingsPanel\(context='public'\)/);
  assert.match(html,/el\.hidden=_settingsContext!=='account'/);
});

test('account menu and Settings surfaces preserve keyboard focus and route compatibility',()=>{
  assert.match(html,/popover\.querySelector\('button'\)\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(html,/if\(e\.key==='Escape'&&popover&&!popover\.hidden\)/);
  assert.match(html,/if\(ev\.key==='Escape'\)\{if\(id==='settings-modal'&&settingsDetailIsOpenOnMobile\(\)\)\{showSettingsSectionList\(\);return;\}if\(id==='trainer-organizer-modal'\)closeTrainerOrganizer\(\);else closeModal\(id\);return;\}/);
  assert.match(html,/if\(returnFocus\?\.isConnected&&!returnFocus\.disabled\)returnFocus\.focus\(/);
  assert.match(html,/history\.pushState\([^\n]+settingsPanel:true/);
  assert.match(html,/history\.replaceState\([^\n]+settingsSection:section/);
  assert.match(html,/settingsRouteHash\(section=null\)/);
  assert.match(html,/window\.addEventListener\('popstate',syncSettingsRoute\)/);
  assert.match(html,/window\.addEventListener\('hashchange',syncSettingsRoute\)/);
  assert.match(html,/action==='settings'/);
});

test('Settings routing owns one transient route-scoped scroll snapshot',()=>{
  const lifecycle=html.slice(html.indexOf("let _settingsScrollSnapshot=null;"),html.indexOf('function openSettingsTool'));
  const modalLifecycle=html.slice(html.indexOf('function openModal'),html.indexOf('function toast'));
  const sessionReset=html.slice(html.indexOf("function resetSessionTransientUi"),html.indexOf('function resetTransientUiBeforeSessionActivation'));
  assert.match(lifecycle,/let _settingsScrollSnapshot=null;/);
  assert.match(lifecycle,/function settingsRouteKey\(\)/);
  assert.match(lifecycle,/_settingsScrollSnapshot=\{x:window\.scrollX,y:window\.scrollY,routeKey:settingsRouteKey\(\)\}/);
  assert.match(lifecycle,/if\(_settingsScrollSnapshot\.routeKey!==settingsRouteKey\(\)\)/);
  assert.match(lifecycle,/options\.captureScroll!==false\)captureSettingsScrollSnapshot\(\)/);
  assert.match(lifecycle,/openSettingsPanel\(publicContext\?'public':'account',\{updateHistory:false,captureScroll:options\.captureScroll!==false\}\)/);
  assert.match(modalLifecycle,/focus\(id==='settings-modal'\?\{preventScroll:true\}:undefined\)/);
  assert.match(modalLifecycle,/if\(id==='settings-modal'\)restoreAndClearSettingsScrollSnapshot\(\)/);
  assert.match(html,/setTimeout\(\(\)=>syncSettingsRoute\(\{captureScroll:false\}\),0\)/);
  assert.match(sessionReset,/_settingsScrollSnapshot=null;/);
  assert.doesNotMatch(lifecycle,/(firebase|userPreferences|publicShares|fetch\(|WebSocket|localStorage|sessionStorage)/i);
});

test('relocated Settings retains local locale controls and exposes no preference writes',()=>{
  assert.match(html,/id="settings-language" onchange="changeInterfaceLocale\(this\.value\)"/);
  assert.match(html,/class="settings-section local-preferences-panel settings-account-only"/);
  assert.doesNotMatch(html,/function (?:openSettingsPanel|changeInterfaceLocale)[\s\S]{0,800}(?:firebaseSet|firebaseUpdate|managedTrainerPreferencesRepository\.write)/);
});

test('standard states distinguish loading, offline, authorization, stale, and update-required UI',()=>{
  const ui=emptyState();
  for(const kind of ['loading','offline','retrying','unavailable','permission_denied','signed_out','empty','stale','update_required'])assert.equal(ui.stateModel(kind).kind,kind);
  assert.match(ui.stateHtml(ui.stateModel('loading',{title:'Loading'})),/aria-live="polite" aria-busy="true"/);
  assert.match(ui.stateHtml(ui.stateModel('permission_denied',{title:'Private'})),/aria-live="assertive"/);
  assert.doesNotMatch(ui.stateHtml(ui.stateModel('unavailable',{title:'Unavailable'})),/Firebase|PERMISSION_DENIED/);
  assert.match(ui.stateHtml(ui.stateModel('loading',{title:'Loading'})),/class="ui-state-skeleton"/);
  assert.match(ui.stateHtml(ui.stateModel('offline',{title:'Offline'})),/class="empty-svg state-svg"/);
  assert.doesNotMatch(ui.stateHtml(ui.stateModel('offline',{title:'Offline'})),/⚠️|📋|🔍/u);
});

test('loading and feedback primitives preserve stable layout and reduced motion',()=>{
  const loader=html.slice(html.indexOf("function pokeballLoader(text='')"),html.indexOf('// ── WALLPAPER'));
  assert.match(loader,/class="loader-wrap" role="status"/);
  assert.equal((loader.match(/class="skel skel-row"/g)||[]).length,3);
  assert.doesNotMatch(loader,/POKEBALL_SVG|pokeball-loader/);
  assert.match(html,/\.toast,\.undo-toast\{[^}]*border-left:3px solid var\(--accent\)[^}]*pointer-events:auto/);
  assert.match(html,/\.toast::before,\.undo-toast::before\{/);
  assert.match(html,/\.undo-btn\{[^}]*margin-left:auto/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Find Trainer preserves public-only reads and distinct projection states',()=>{
  assert.match(html,/managedPublicShareRepository\.read/);
  assert.match(html,/publicShares\/\$\{username\}/);
  assert.match(html,/projection_incomplete.*trainer\.shareNeedsRepublishing/);
  assert.match(html,/projection_unsupported.*trainer\.sharedMalformed/);
  assert.doesNotMatch(html,/loadPublicShareData[\s\S]{0,900}(wishlist\/\$\{username\}|users\/\$\{username\})/);
});

test('local preferences stay clearly device-local and expose no enabled sync control',()=>{
  assert.match(html,/class="settings-section local-preferences-panel settings-account-only"/);
  assert.match(html,/id="trainer-sync-local-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html,/data-i18n="trainer\.syncState\.local-only"/);
  assert.match(html,/data-i18n="trainer\.syncStatus\.localOnlyDetail"/);
  assert.match(html,/createTrainerPreferencesRepository\(\{enabled:false\}\)/);
  assert.doesNotMatch(html,/id="settings-(?:sync|save)-preferences"/);
});

test('Account & Security remains an informational account-only readiness surface',()=>{
  const start=html.indexOf('id="settings-account-security-heading"');
  const end=html.indexOf('</section>',start);
  assert.ok(start>0&&end>start);
  const panel=html.slice(start,end);
  const methods=panel.slice(panel.indexOf('class="account-security-methods"'),panel.indexOf('class="account-security-notice"'));
  assert.match(html,/account-security-panel settings-account-only/);
  assert.match(panel,/data-provider="google"/);
  assert.match(panel,/data-provider="email"/);
  assert.match(panel,/data-provider="discord"/);
  assert.match(panel,/data-provider="legacy-pin"/);
  assert.doesNotMatch(methods,/<button|onclick=|href=|data-action=/);
  assert.match(panel,/id="settings-logout" onclick="logout\(\)"/);
  assert.match(html,/\.account-security-method\{[^}]*min-height:56px/);
  assert.match(html,/DURABLE_AUTH_PROVIDERS_ENABLED!==false/);
});

test('favorite organizer saves tag changes immediately and clears stale deleted-tag filters',()=>{
  const opener=html.slice(html.indexOf('function openTrainerOrganizer'),html.indexOf('function closeTrainerOrganizer'));
  const changed=html.slice(html.indexOf('function trainerOrganizerChanged'),html.indexOf('function renderTrainerOrganizer'));
  const deletion=html.slice(html.indexOf('function deleteLocalTrainerTag'),html.indexOf('function rememberTrainerOpened'));
  assert.match(changed,/setFavoriteTags\(trainerOrganizerState\.username,tagIds\)/);
  assert.doesNotMatch(opener,/discardChanges|draftNote|draftTagIds/);
  assert.match(deletion,/trainerOrganizerState\.tagIds=trainerOrganizerState\.tagIds\.filter/);
  assert.doesNotMatch(deletion,/draftTagIds|saveTrainerOrganizer/);
  assert.match(html,/if\(el\.id==='trainer-organizer-modal'\)closeTrainerOrganizer\(\)/);
  const accountSwitch=html.slice(html.indexOf('function resetTransientUiBeforeSessionActivation'),html.indexOf('function activateOwnedSession'));
  const authLoss=html.slice(html.indexOf('function bindAuthObserver'),html.indexOf('function waitForAuthState'));
  assert.match(accountSwitch,/resetSessionTransientUi\('identity_switch'\);\s*resetTrainerOrganizerState\(\)/);
  assert.match(authLoss,/resetSessionTransientUi\('auth_loss'\);\s*resetTrainerOrganizerState\(\)/);
});

test('modal lifecycle reuses one handler and cancels stale focus restoration',()=>{
  const lifecycle=html.slice(html.indexOf('function openModal'),html.indexOf('function toast'));
  assert.match(html,/let _modalFocusTimer=null;\s*let _modalActiveId='';/);
  assert.match(lifecycle,/if\(_modalKeyHandler\)\{document\.removeEventListener\('keydown',_modalKeyHandler\);_modalKeyHandler=null;\}/);
  assert.match(lifecycle,/if\(_modalFocusTimer\)\{clearTimeout\(_modalFocusTimer\);_modalFocusTimer=null;\}/);
  assert.match(lifecycle,/if\(_modalActiveId==='trainer-organizer-modal'\)closeTrainerOrganizer\(\);else closeModal\(_modalActiveId,\{route:false\}\)/);
  assert.match(lifecycle,/if\(active\?\.classList\.contains\('open'\)\)return;/);
  assert.match(lifecycle,/if\(_modalActiveId!==id\|\|!m\.classList\.contains\('open'\)\)return;/);
  assert.match(lifecycle,/if\(m\.contains\(document\.activeElement\)\)return;/);
  assert.match(lifecycle,/if\(returnFocus\?\.isConnected&&!returnFocus\.disabled\)returnFocus\.focus\(/);
});

test('responsive and accessibility safeguards cover compact screens, long labels, focus, and reduced motion',()=>{
  assert.match(html,/@media\(max-width:360px\)/);
  assert.match(html,/overflow-wrap:anywhere/);
  assert.match(html,/:focus-visible\{outline:3px solid var\(--ac2\)/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/min-height:48px/);
  assert.match(html,/window\.visualViewport/);
  assert.match(html,/role="combobox" aria-autocomplete="list"/);
  assert.match(html,/if\(ev\.key==='Escape'\)\{if\(id==='settings-modal'&&settingsDetailIsOpenOnMobile\(\)\)\{showSettingsSectionList\(\);return;\}if\(id==='trainer-organizer-modal'\)closeTrainerOrganizer\(\);else closeModal\(id\);return;\}/);
});

test('localized Admin and dialog surfaces preserve bounded responsive geometry',()=>{
  for(const marker of [
    'data-i18n="admin.pendingRequests"','data-i18n="settings.profileGroupTrainer"',
    'data-i18n="settings.profileGroupPokemonGo"','data-i18n="settings.profileGroupAbout"',
    "i18nCore.t('safeTransfer.limitWarning'",'data-i18n="specialBoard.description"'
  ])assert.ok(html.includes(marker),marker);
  assert.match(html,/\.admin-member-row\{display:grid/);
  assert.match(html,/@media\(max-width:600px\)\{\.admin-header/);
  assert.match(html,/\.admin-nav-button\{[^}]*min-height:48px/);
  assert.match(html,/\.modal\{[^}]*overflow-y:auto/);
  assert.match(html,/\.health-actions\{[^}]*flex-wrap:wrap/);
  assert.match(html,/\.export-menu-item\{[^}]*white-space:normal/);
  assert.match(html,/overflow-wrap:anywhere/);
});

test('Events distinguish loading, offline, filtered-empty, and legitimate empty states',()=>{
  assert.match(html,/eventStateHtml\('loading',i18nCore\.t\('events\.loading'\)\)/);
  assert.match(html,/eventStateHtml\('offline',i18nCore\.t\('events\.offlineTitle'\),i18nCore\.t\('events\.offline'\)/);
  assert.match(html,/filtered\?'events\.filteredEmptyTitle':'events\.emptyTitle'/);
  assert.match(html,/filtered\?'events\.filteredEmpty':'events\.empty'/);
});

test('owner share recovery remains explicit and readiness gated',()=>{
  assert.match(html,/onclick="republishOwnPublicShare\(\)"/);
  assert.match(html,/managedPublicSharePublication\.authorize\(token,'explicit_share'\)/);
  assert.match(html,/share\.ownerPrivateSafe/);
});
