const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const root=join(__dirname,'..');
const html=readFileSync(join(root,'index.html'),'utf8');
const css=readFileSync(join(root,'css/app.css'),'utf8');
const app=readFileSync(join(root,'js/app/application.js'),'utf8');

test('Settings profile has one identity row, one Friend Code control, and explicit draft actions',()=>{
  const profile=html.slice(html.indexOf('data-settings-section="profile"'),html.indexOf('data-settings-section="language"'));
  assert.equal((profile.match(/id="settings-account-av"/g)||[]).length,1);
  assert.equal((profile.match(/id="fc-inp"/g)||[]).length,1);
  assert.doesNotMatch(profile,/id="pfc-disp"|id="prof-av-preview"/);
  assert.match(profile,/<form[^>]+id="settings-profile-form"[^>]+onsubmit="saveProfile\(event\)"/);
  assert.match(profile,/id="profile-discard"[^>]+disabled/);
  assert.match(profile,/id="profile-save"[^>]+disabled/);
  assert.match(app,/function syncProfileDirtyState\(\)/);
  assert.match(app,/function discardProfileChanges\(\)/);
});

test('Settings mobile height chain gives its detail pane a definite scroll container',()=>{
  assert.match(css,/@media\(max-width:767px\)[\s\S]*\.settings-overlay \.settings-modal\{height:calc\(100dvh/);
  assert.match(css,/\.settings-overlay \.settings-modal-body\{flex:1;height:auto;min-height:0;max-height:none;overflow:hidden\}/);
  assert.match(css,/\.settings-overlay \.settings-detail\{overflow-y:auto;overscroll-behavior:contain\}/);
});

test('Settings focus and nested avatar keyboard handlers stay within the visible layer',()=>{
  assert.match(app,/function setSettingsUnderlyingContentInert\(active\)/);
  assert.match(app,/if\(id==='settings-modal'\)setSettingsUnderlyingContentInert\(true\)/);
  assert.match(app,/if\(ev\.defaultPrevented\)return/);
  assert.match(app,/event\.key==='Escape'\)\{event\.preventDefault\(\);event\.stopPropagation\(\);closeAvatarPicker\(\);return;\}/);
  assert.match(html,/id="prof-av-results"[^>]+onkeydown="avatarPickerKeydown\(event\)"/);
  assert.match(app,/const focusedIndex=options\.indexOf\(document\.activeElement\)/);
});

test('Settings visual direction is scoped to the Settings overlay',()=>{
  assert.match(css,/\.settings-overlay\.settings-page-mode \.settings-layout\{max-width:1120px;grid-template-columns:200px minmax\(0,1fr\);gap:40px\}/);
  assert.match(css,/\.settings-overlay \.settings-profile-form\{/);
  assert.match(html,/data-i18n="account\.closeSettings"/);
  for(const icon of ['users','globe','sun','shield','wrench','archive'])assert.match(html,new RegExp(`#ui-icon-${icon}`));
});
