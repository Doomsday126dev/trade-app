const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const root=join(__dirname,'..');
const html=readFileSync(join(root,'index.html'),'utf8');

test('signed-in desktop Settings is a routed page with six semantic destinations',()=>{
  assert.match(html,/const SETTINGS_DESKTOP_QUERY='\(min-width:768px\)'/);
  assert.match(html,/const SETTINGS_SECTIONS=Object\.freeze\(\['profile','language','appearance','security','tools','data'\]\)/);
  assert.match(html,/function settingsRouteHash\(section=null\)\{return section&&SETTINGS_SECTIONS\.includes\(section\)\?`#settings\/\$\{section\}`:'#settings';\}/);
  assert.match(html,/\.settings-overlay\.settings-page-mode\{[^}]*background:var\(--bg\)/);
  assert.match(html,/\.settings-page-mode \.settings-layout\{[^}]*grid-template-columns:240px minmax\(0,1fr\)/);
  assert.match(html,/<nav class="settings-nav settings-account-only" aria-label="Settings sections"/);
});

test('route parsing handles valid deep links and safely falls back to profile',()=>{
  const parser=html.slice(html.indexOf('function parseSettingsRoute'),html.indexOf('function settingsRouteUrl'));
  assert.ok(parser.includes("/^#settings\\/([^/?#]+)$/"));
  assert.match(parser,/section:SETTINGS_SECTIONS\.includes\(match\[1\]\)\?match\[1\]:'profile'/);
  assert.match(html,/route\.matches&&!modal\.classList\.contains\('open'\)/);
  assert.match(html,/if\(_settingsContext==='account'&&!route\.valid\)\{\s*selectSettingsSection\('profile'/);
});

test('valid section deep links wait for auth readiness before public normalization',()=>{
  assert.match(html,/let _pendingSettingsRouteSection=null/);
  const sync=html.slice(html.indexOf('function syncSettingsRoute'),html.indexOf('function openSettingsTool'));
  assert.match(sync,/route\.valid&&route\.section&&!_authStateKnown&&!cur/);
  assert.match(sync,/_pendingSettingsRouteSection=route\.section;\s*return/);
  assert.match(sync,/function syncPendingSettingsRouteAfterAuth\(\)/);
  const observer=html.slice(html.indexOf('function bindAuthObserver'),html.indexOf('function waitForAuthState'));
  assert.match(observer,/_authStateKnown=true;[\s\S]*syncPendingSettingsRouteAfterAuth\(\)/);
});

test('section changes replace the one Settings history entry and reset content scroll',()=>{
  const selection=html.slice(html.indexOf("function selectSettingsSection(section='profile'"),html.indexOf('function showSettingsSectionList'));
  assert.match(selection,/history\.replaceState\([^\n]+settingsSection:section/);
  assert.match(selection,/detail\.scrollTop=0/);
  assert.match(html,/showSettingsSectionList[\s\S]*history\.replaceState\([^\n]+settingsRouteUrl\(true\)/);
  assert.match(html,/if\(history\.state\?\.settingsPanel\)\{history\.back\(\);return true;\}/);
});

test('mobile and public Settings retain their constrained dialog boundaries',()=>{
  assert.match(html,/@media\(max-width:767px\)[\s\S]*\.settings-layout\.mobile-list \.settings-detail\{display:none\}/);
  assert.match(html,/if\(_settingsContext==='public'\)\{layout\?\.classList\.remove\('mobile-list'\);selectSettingsSection\('language'/);
  assert.match(html,/if\(pageMode\)\{overlay\.removeAttribute\('role'\);overlay\.removeAttribute\('aria-modal'\);\}\s*else\{overlay\.setAttribute\('role','dialog'\);overlay\.setAttribute\('aria-modal','true'\);\}/);
  assert.match(html,/if\(id==='settings-modal'&&settingsDetailIsOpenOnMobile\(\)\)\{showSettingsSectionList\(\);return;\}/);
});

test('logout exits every Settings deep link and provider rows remain informational',()=>{
  const logout=html.slice(html.indexOf('function logout(){'),html.indexOf('// ── NAV'));
  assert.match(logout,/if\(parseSettingsRoute\(\)\.matches\)history\.replaceState\(\{\},'',settingsRouteUrl\(false\)\)/);
  const security=html.slice(html.indexOf('id="settings-account-security"'),html.indexOf('</section>',html.indexOf('id="settings-account-security"')));
  assert.match(security,/data-provider-actions="disabled"/);
  assert.doesNotMatch(security,/<button[^>]+data-provider|linkWithPopup|linkWithRedirect/);
  assert.match(security,/security\.disabledNotice/);
});

test('Settings navigation adds no preference, share, auth-provider, or remote mutation path',()=>{
  const settings=html.slice(html.indexOf("let _settingsContext='public'"),html.indexOf('function openModal'));
  assert.doesNotMatch(settings,/firebase(?:Set|Update|Remove)|managedTrainerPreferencesRepository\.(?:write|mutate|save)|publicShares|fetch\(|WebSocket|linkWithPopup|linkWithRedirect/i);
});

test('profile, appearance, and PIN controls have separate routed ownership',()=>{
  assert.doesNotMatch(html,/id="prof-modal"/);
  const profile=html.slice(html.indexOf('data-settings-section="profile"'),html.indexOf('data-settings-section="language"'));
  const appearance=html.slice(html.indexOf('data-settings-section="appearance"'),html.indexOf('data-settings-section="security"'));
  const security=html.slice(html.indexOf('data-settings-section="security"'),html.indexOf('data-settings-section="tools"'));
  assert.match(profile,/id="prof-av-input"/);assert.match(profile,/id="fc-inp"/);assert.doesNotMatch(profile,/id="np1"|id="wp-picker"/);
  assert.match(appearance,/data-settings-theme="auto"/);assert.match(appearance,/id="wp-picker"/);assert.doesNotMatch(appearance,/id="np1"/);
  assert.match(security,/id="np1"/);assert.match(security,/savePinSettings/);
  assert.match(html,/function applyWallpaperForTheme/);assert.match(html,/if\(effectiveTheme\(\)!=='dark'\)return/);
});
