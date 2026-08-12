const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const emptyState=readFileSync(path.join(root,'js/ui/emptyState.js'),'utf8');
const shareVisibility=readFileSync(path.join(root,'js/domain/shareVisibility.js'),'utf8');
const trainerPreferences=readFileSync(path.join(root,'js/domain/trainerPreferences.js'),'utf8');
const locales=['en','ja','es','de'].map(locale=>readFileSync(path.join(root,`js/i18n/locales/${locale}.js`),'utf8'));
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';

test('design tokens define the bounded spacing, container, radius, type, control, and focus systems',()=>{
  for(const [name,value] of Object.entries({
    'space-1':'4px','space-2':'8px','space-3':'12px','space-4':'16px','space-5':'24px','space-6':'32px',
    'container-narrow':'480px','container-standard':'760px','container-wide':'1120px',
    'radius-sm':'4px','radius-md':'6px','radius-lg':'8px','radius-pill':'999px',
    'control-min':'48px'
  }))assert.match(css,new RegExp(`--${name}:${value.replace(/[()]/g,'\\$&')}`));
  for(const role of ['page','section','card','body','meta','utility'])assert.match(css,new RegExp(`--type-${role}:`));
  assert.match(css,/--type-meta:12px\/18px/);
});

test('consumer shell uses shared surface, motion, gutter, and navigation primitives',()=>{
  for(const token of ['surface-canvas','surface-raised','surface-subtle','surface-hover','border-strong','shadow-low','shadow-high','page-gutter','transition-fast','transition-base'])assert.match(css,new RegExp(`--${token}:`));
  assert.match(css,/\.topbar\{[\s\S]*?padding-inline:max\(var\(--page-gutter\),calc\(\(100vw - var\(--container-wide\)\)\/2\)\)/);
  assert.match(css,/\.tabs\{[\s\S]*?padding-inline:max\(var\(--page-gutter\),calc\(\(100vw - var\(--container-wide\)\)\/2\)\)/);
  assert.match(css,/\.tab\.active\{[^}]*box-shadow:inset 0 -3px var\(--accent\)/);
  assert.match(css,/\.tab-icon-slot\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center[^}]*width:22px[^}]*height:22px[^}]*flex:0 0 22px/);
  assert.match(css,/\.tab-icon-slot \.tab-icon\{[^}]*width:20px[^}]*height:20px[^}]*flex:none/);
  assert.match(css,/\.tab \.notif-badge\{[^}]*position:absolute/);
  for(const id of ['nav-mylist','nav-find','nav-events','admin-tab']){
    const button=html.match(new RegExp(`<button[^>]+id="${id}"[\\s\\S]*?<\\/button>`))?.[0]||'';
    assert.equal((button.match(/class="ui-icon tab-icon"/g)||[]).length,1,id);
    assert.equal((button.match(/class="tab-icon-slot"/g)||[]).length,1,id);
    assert.equal((button.match(/class="tab-label"/g)||[]).length,1,id);
    assert.equal((button.match(/class="tab-short-label"/g)||[]).length,1,id);
  }
  assert.doesNotMatch(css,/\.tab\[data-tab=[^\]]+\]::before\{content:/);
  for(const locale of locales)assert.doesNotMatch(locale,/'nav\.(?:myList|findTrainer|events|admin)(?:Short)?':'[^']*[📋🔍📅⚙️]/u);
  for(const icon of ['list','search','calendar','shield','settings','copy','sliders','chevron-right','chevron-down','upload','users','user-plus','key','wrench','activity','archive','grip'])assert.match(html,new RegExp(`id="ui-icon-${icon}"`));
  for(const icon of ['list','search','calendar','shield']){
    const symbol=html.match(new RegExp(`<symbol id="ui-icon-${icon}"[^>]+>[\\s\\S]*?<\\/symbol>`))?.[0]||'';
    assert.match(symbol,/viewBox="0 0 24 24"/,icon);
  }
  assert.match(html,/id="ui-icon-list"[^>]*>[\s\S]*?M8 4h12M8 12h12M8 20h12/);
  assert.match(html,/id="ui-icon-calendar"[^>]*>[\s\S]*?x="4" y="5" width="16" height="15"/);
  assert.match(html,/id="ui-icon-shield"[^>]*>[\s\S]*?M12 20s8-3\.2 8-8V6l-8-2-8 2v6c0 4\.8 8 8 8 8Z/);
});

test('consumer composition reduces nested chrome while preserving interactive boundaries',()=>{
  assert.match(css,/\.journey-guidance\{[^}]*border:0[^}]*border-left:3px solid var\(--accent\)/);
  assert.match(css,/\.trainer-quick-section \.favorite-empty,\.events-state \.empty-state\{[^}]*border:0[^}]*background:transparent/);
  assert.match(css,/\.recent-trainer-list\{[^}]*border:1px solid var\(--border\)/);
  assert.match(css,/\.recent-trainer-row\{[^}]*border:0[^}]*border-bottom:1px solid var\(--border\)/);
  assert.match(css,/\.settings-panel\{[^}]*border:0[^}]*border-bottom:1px solid var\(--border\)/);
  assert.match(css,/\.event-group:not\(\[data-group="now"\]\) \.event-card-grid\{[^}]*gap:0/);
  assert.match(css,/\.share-search-disclosure summary\{[^}]*min-height:48px/);
});

test('container and typography primitives cover the active hierarchy',()=>{
  for(const role of ['narrow','standard','wide','full'])assert.match(css,new RegExp(`\\.ui-container-${role}\\{`));
  for(const role of ['page','section','card','body','meta','utility'])assert.match(css,new RegExp(`\\.type-${role}\\{`));
  assert.match(html,/id="login-pg"[\s\S]*class="lcard ui-container ui-container-narrow card-content"/);
  assert.match(html,/id="tab-find"[\s\S]*class="trainer-discovery-content ui-container ui-container-standard"/);
  assert.match(html,/class="share-body ui-container ui-container-standard"/);
  assert.match(html,/class="modal settings-modal ui-container ui-container-wide"/);
});

test('button hierarchy exposes five distinct reusable roles with one primary in touched dialogs',()=>{
  for(const role of ['primary','secondary','ghost','icon','destructive'])assert.match(css,new RegExp(`\\.btn-${role}(?:\\{|,)`));
  assert.match(html,/class="lbtn btn btn-primary" id="login-btn"/);
  assert.match(html,/class="organizer-close btn btn-icon"/);
  assert.match(html,/class="organizer-actions"><button class="bpri btn btn-primary"/);
  const organizerActions=html.match(/class="organizer-actions">([\s\S]*?)<\/div>/)?.[1]||'';
  assert.equal((organizerActions.match(/btn-primary/g)||[]).length,1);
  assert.match(css,/\.btn\[aria-busy="true"\]\{[^}]*cursor:progress[^}]*pointer-events:none/);
});

test('active fields use the shared theme and retain deliberate search variants',()=>{
  for(const id of ['login-user','login-pin','find-trainer-input','ac-input','organizer-new-tag','settings-language','settings-search-language'])assert.match(html,new RegExp(`class="[^"]*field-control[^"]*"[^>]+id="${id}"|id="${id}"[^>]+class="[^"]*field-control`));
  assert.match(css,/\.field-control,#tab-admin/);
  assert.match(css,/\.search-lookup\{max-width:var\(--container-standard\)\}/);
  assert.match(css,/\.search-filter\{max-width:var\(--container-standard\)\}/);
  assert.match(css,/\.field-control\.app-search-input\{padding-left:42px\}/);
  assert.match(css,/\.command-input\{font-family:var\(--mono\)/);
  assert.doesNotMatch(css,/\.field-control[^}]*background:\s*(?:#fff|white)/i);
});

test('shared Pokémon autocomplete rows reset native controls onto themed surfaces',()=>{
  assert.match(css,/\.ac-dropdown\{[^}]*background:var\(--surface-raised\)[^}]*color:var\(--text\)[^}]*box-shadow:var\(--shadow-high\)/);
  assert.match(css,/\.ac-item\{[^}]*appearance:none[^}]*background:var\(--surface-raised\)[^}]*color:var\(--text\)/);
  assert.match(css,/\.ac-item:hover,\.ac-item\.focused,\.ac-item\[aria-selected="true"\]\{[^}]*background:var\(--surface-hover\)/);
  assert.match(css,/\.ac-item-no\{[^}]*color:var\(--muted\)/);
  assert.match(css,/\.ac-item-variant\{[^}]*color:var\(--muted\)/);
  assert.doesNotMatch(css,/\.ac-(?:dropdown|item)[^}]*background:\s*(?:#fff|white)/i);
  assert.match(html,/class="ac-dropdown" id="ac-dropdown"/);
  assert.match(html,/id="favorite-browse-suggestions" role="listbox"/);
});

test('shared fields preserve theme, focus, and validation layers during browser autofill',()=>{
  const start=css.indexOf('/* Browser autofill paints above normal background/color declarations.');
  const end=css.indexOf('.favorite-card-tag',start);
  assert.ok(start>0&&end>start);
  const autofill=css.slice(start,end);
  for(const state of ['',':hover',':focus',':active'])assert.match(autofill,new RegExp(`:-webkit-autofill${state.replace(':','\\:')}`));
  assert.match(autofill,/@supports selector\(input:autofill\)/);
  assert.match(autofill,/:autofill\{/);
  assert.match(autofill,/-webkit-text-fill-color:var\(--text\)/);
  assert.match(autofill,/caret-color:var\(--text\)/);
  assert.match(autofill,/0 0 0 1000px var\(--bg\) inset/);
  assert.match(autofill,/:focus\{[^}]*var\(--focus-ring\)/);
  assert.match(autofill,/\[aria-invalid="true"\][^{]*\{[^}]*rgba\(239,68,68,\.14\)/);
  assert.doesNotMatch(autofill,/animation|transition-delay|99999/i);
  assert.match(html,/id="login-user"[^>]+autocomplete="off"/);
  assert.match(html,/type="password"[^>]+id="login-pin"[^>]+autocomplete="current-password"/);
});

test('chip taxonomy keeps metadata, selection, filtering, status, removal, and navigation distinct',()=>{
  for(const role of ['metadata','selectable','filter','status','removable'])assert.match(css,new RegExp(`\\.chip-${role}\\{`));
  assert.match(css,/\.nav-pill\{/);
  assert.match(html,/favorite-card-tag chip chip-metadata/);
  assert.match(html,/organizer-selectable-chip chip chip-selectable/);
  assert.match(html,/favorite-filter-chip chip chip-filter/);
  assert.match(html,/event-filter chip chip-filter/);
  assert.match(css,/\.chip-metadata\{[^}]*pointer-events:none/);
  assert.match(css,/\.chip-selectable\{[^}]*min-height:var\(--control-min\)/);
});

test('My List category navigation uses a dot and semantic selection, never a checkmark',()=>{
  const myList=html.slice(html.indexOf('<!-- MY LIST'),html.indexOf('<!-- HAVE'));
  assert.match(myList,/class="ltab nav-pill active"[^>]+aria-selected="true"/);
  assert.match(myList,/class="ltab-marker" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(myList,/class="ltab-marker"[^>]*>✓/);
  assert.match(css,/\.mylist-type-tabs \.ltab-marker\{[^}]*width:6px[^}]*border-radius:50%[^}]*background:var\(--ac2\)/);
});

test('obvious application chrome uses the shared icon system and dense rows disclose rare controls',()=>{
  assert.match(html,/id="find-trainer-input"[\s\S]*?ui-icon-search/);
  assert.match(html,/function myListSearchActionHtml[\s\S]*?uiIconMarkup\('copy'/);
  assert.match(html,/id="account-settings-action"[\s\S]*?ui-icon-settings/);
  assert.match(html,/function applyTheme[\s\S]*?uiIconMarkup\(effective==='dark'\?'moon':'sun'/);
  const rows=html.slice(html.indexOf('function myListRowsHtml'),html.indexOf('function myListPrioritySectionHtml'));
  assert.match(rows,/class="myrow-priority" role="group"/);
  assert.match(rows,/class="myrow-active-traits"/);
  assert.match(rows,/details class="myrow-editor"/);
  assert.match(rows,/summary class="myrow-edit"/);
  for(const handler of ['setLucky','setShiny','setXxl','setXxs','setNotes','confirmRemove'])assert.match(rows,new RegExp(`${handler}\\(`));
  assert.match(css,/\.myrow-edit\{[^}]*min-width:48px/);
  assert.match(css,/\.myrow-editor-popover\{[^}]*position:absolute/);
});

test('My List rows foreground collection identity while retaining fast editing',()=>{
  const rows=html.slice(html.indexOf('function myListRowsHtml'),html.indexOf('function myListPrioritySectionHtml'));
  assert.match(rows,/uiIconMarkup\('grip','ui-icon'\)/);
  assert.match(rows,/myrow-sprite-wrap/);
  assert.match(rows,/class="myrow-name"/);
  assert.match(rows,/class="myrow-priority" role="group"/);
  assert.match(rows,/details class="myrow-editor"/);
  assert.match(css,/\.myrow\{[^}]*min-height:62px[^}]*gap:9px/);
  assert.match(css,/\.myrow-sprite-wrap\{width:38px;height:38px\}/);
  assert.match(css,/\.myrow-name\{font-size:14px;font-weight:700/);
  assert.match(css,/\.drag-handle\{[^}]*width:28px;height:40px/);
});

test('cards, priority, status, and empty-state primitives preserve semantic structure',()=>{
  for(const role of ['content','interactive','row','status'])assert.match(css,new RegExp(`\\.card-${role}(?:,|\\{)`));
  assert.match(html,/favorite-card-shell card-interactive/);
  assert.match(html,/event-card card-row/);
  assert.match(html,/share-pcard card-row/);
  assert.match(css,/\.share-section\.card-content\{padding:0\}/);
  assert.match(css,/\.share-pcard\.card-row\{padding:7px 9px/);
  assert.match(css,/\.mylist-priority-section\.H \.mylist-priority-heading\{[^}]*border-left-color:var\(--H\)/);
  assert.doesNotMatch(css,/\.mylist-priority-section\.[HML]\{[^}]*border-top-color/);
  assert.match(emptyState,/class="empty empty-state"/);
  assert.match(emptyState,/class="ui-state card-status/);
  assert.match(emptyState,/role="status" aria-live=/);
  for(const icon of ['list','search','users','activity','archive','alert','offline'])assert.match(emptyState,new RegExp(`${icon}:`));
  assert.match(emptyState,/class="ui-state-skeleton"/);
  assert.doesNotMatch(emptyState,/class="ui-state-icon"[^\n]*>\$\{m\.icon\}/);
});

test('accessibility and disabled product boundaries remain explicit',()=>{
  assert.match(css,/:where\(button,a,input,select,textarea,\[role="button"\],\[tabindex\]\):focus-visible/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/role="tablist"[^>]+aria-label="My List categories"/);
  assert.match(html,/organizer-selectable-chip chip chip-selectable"[^>]+aria-pressed=/);
  assert.match(shareVisibility,/SHARE_VISIBILITY_MODEL_ENABLED\s*:\s*false/);
  assert.match(trainerPreferences,/SYNCED_TRAINER_PREFERENCES_ENABLED\s*:\s*false/);
});
