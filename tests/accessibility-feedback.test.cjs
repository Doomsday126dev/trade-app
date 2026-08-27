const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

test('A11Y-03 hidden transient actions are removed from layout and keyboard order',()=>{
  assert.match(html,/\[hidden\]\{display:none!important\}/);
  assert.match(html,/id="undo-toast"[^>]*aria-hidden="true" hidden/);
  assert.match(html,/class="undo-btn"[^>]*type="button"|type="button" class="undo-btn"/);
  assert.match(html,/\.undo-btn\{[^}]*min-width:48px[^}]*min-height:48px/);
  assert.match(html,/function hideUndo\(\{restoreFocus=false\}=\{\}\)[\s\S]*focusWasInside[\s\S]*fallback\?\.focus/);
  assert.match(html,/undoTimer=setTimeout\(\(\)=>\{\s*hideUndo\(\{restoreFocus:true\}\)/);
});

test('feedback uses one polite announcer without making visual toasts live regions',()=>{
  assert.match(html,/id="feedback-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/class="feedback-stack" id="feedback-stack"/);
  assert.match(html,/class="toast" id="toast" aria-hidden="true" hidden/);
  assert.doesNotMatch(html,/class="toast" id="toast"[^>]*(?:role=|aria-live=)/);
  assert.match(html,/function announceFeedback\(message\)[\s\S]*_lastFeedbackAnnouncement[\s\S]*<800/);
  assert.match(html,/function toast\(msg,dur=2500\)[\s\S]*announceFeedback\(msg\)/);
  assert.match(html,/showFavoriteSavedPrompt\(username\)[\s\S]*announceFeedback\(message\.textContent\)/);
});

test('copy confirmation remains focused, visual, and deduplicated',()=>{
  const copy=html.slice(html.indexOf('async function copyStr'),html.indexOf('function toggleStrUser'));
  assert.match(copy,/dataset\.copyState==='copied'\)return/);
  assert.match(copy,/dataset\.copyState='copied'/);
  assert.match(copy,/toast\(i18nCore\.t\(`\$\{keyPrefix\}\.copySuccess`\)\)/);
  assert.doesNotMatch(copy,/btn\.disabled\s*=\s*true/);
  assert.doesNotMatch(copy,/\.focus\(/);
});

test('A11Y-04 Login and request access use associated labels and urgent error announcements',()=>{
  assert.match(html,/<label for="login-user"[^>]*data-i18n="login\.username"/);
  assert.match(html,/<label for="login-pin"[^>]*data-i18n="login\.pin"/);
  assert.match(html,/id="login-pin"[^>]*autocomplete="current-password"/);
  assert.match(html,/<button type="button" class="req-link"[^>]*data-i18n="login\.requestAccess"/);
  assert.match(html,/\.req-link\{[^}]*min-height:48px/);
  assert.match(html,/id="login-err" role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(html,/id="req-err" role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(html,/id="req-sent-status"[^>]*role="status" aria-live="polite"/);
  assert.match(html,/id="login-user-option-\$\{i\}" role="option" aria-selected=/);
  assert.match(html,/function renderLoginUserSuggestions\(open=true\)[\s\S]*aria-expanded[\s\S]*aria-activedescendant/);
  assert.match(html,/function hideLoginUserSuggestions\(\)[\s\S]*aria-expanded','false'[\s\S]*removeAttribute\('aria-activedescendant'\)/);
});

test('A11Y-05 light-theme trait and disclaimer colors use explicit readable tokens',()=>{
  assert.match(html,/html\[data-theme="light"\]\{[\s\S]*--trait-xxl:#4f46c8;--trait-xxs:#0f766e/);
  assert.match(html,/\.brand-disclaimer\{[^}]*color:var\(--muted\)[^}]*opacity:1/);
  assert.match(html,/\.myrow-trait\.xxl\{color:var\(--trait-xxl\)\}/);
  assert.match(html,/\.myrow-trait\.xxs\{color:var\(--trait-xxs\)\}/);
  assert.match(html,/\.share-pcard-flag\.xxl\{[^}]*color:var\(--trait-xxl\)/);
  assert.match(html,/\.share-pcard-flag\.xxs\{[^}]*color:var\(--trait-xxs\)/);
});

test('A11Y-06 provides a skip target and native search-string disclosure controls',()=>{
  assert.match(html,/<a class="skip-link" href="#main-content"[^>]*data-i18n="common\.skipToContent"/);
  assert.match(html,/<main id="main-content" tabindex="-1">/);
  assert.match(html,/class="user-str-toggle"[^>]*aria-expanded="false"[^>]*aria-controls=/);
  assert.match(html,/function toggleStrUser\(el\)[\s\S]*el\.setAttribute\('aria-expanded',String\(!isOpen\)\)/);
  assert.doesNotMatch(html,/class="user-str-hdr" onclick=/);
});

test('My List autocomplete exposes a named combobox and managed active option',()=>{
  assert.match(html,/id="ac-input"[^>]*data-i18n-aria-label="myList\.searchPlaceholder"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="false"[^>]*aria-controls="ac-dropdown"/);
  assert.match(html,/id="ac-dropdown" role="listbox"[^>]*data-i18n-aria-label="myList\.suggestionsLabel"/);
  assert.match(html,/id="add-pokemon-option-\$\{i\}" role="option" aria-selected="false"/);
  assert.match(html,/function acUpdateFocus\(\)[\s\S]*aria-activedescendant[\s\S]*aria-selected/);
  assert.match(html,/function closeAddAutocomplete\(\)[\s\S]*aria-expanded','false'[\s\S]*removeAttribute\('aria-activedescendant'\)/);
});

test('compact feedback is bounded, safe-area aware, nonblocking, and reduced-motion aware',()=>{
  assert.match(html,/\.toast,\.undo-toast\{[^}]*max-width:min\(480px,calc\(100vw - 24px\)\)[^}]*pointer-events:none/);
  assert.match(html,/\.undo-btn\{[^}]*pointer-events:auto/);
  assert.match(html,/@media\(max-height:600px\)\{\.feedback-stack\{[^}]*bottom:calc\(8px \+ env\(safe-area-inset-bottom\)\)[^}]*max-height:calc\(100dvh/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/\.update-banner\{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(html,/\.update-banner-btn\{[^}]*min-height:48px/);
  assert.match(html,/\.update-banner-dismiss\{[^}]*width:48px[^}]*height:48px/);
  assert.match(html,/\.sync-banner-btn\{[^}]*min-height:48px/);
  assert.match(html,/\.sync-banner-dismiss\{[^}]*width:48px[^}]*height:48px/);
  assert.match(html,/\.feedback-stack\{[^}]*flex-direction:column-reverse[^}]*gap:8px[^}]*pointer-events:none/);
  assert.match(html,/\.feedback-stack \.update-banner\{[^}]*position:relative[^}]*pointer-events:auto/);
  assert.match(html,/\.trainer-sync-recovery\{[^}]*min-height:48px/);
  assert.match(html,/function showUpdateBanner\(\)[\s\S]*announceFeedback\(banner\.querySelector\('strong'\)\?\.textContent\)/);
  assert.match(html,/document\.getElementById\('feedback-stack'\)\|\|document\.body/);
});
