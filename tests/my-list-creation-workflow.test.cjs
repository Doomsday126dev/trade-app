const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
// The wants-only shell uses a real form and one shared detail editor, not retired category trays.
const add=html.slice(html.indexOf('<form class="add-form wants-add-form"'),html.indexOf('<div class="wants-list-toolbar"'));
const editor=html.slice(html.indexOf('id="combined-editor-modal"'),html.indexOf('<!-- SETTINGS'));
const toolbar=html.slice(html.indexOf('<div class="wants-list-toolbar"'),html.indexOf('<div id="wants-find"'));
const prioritySource=readFileSync(path.join(root,'js/domain/priorityValues.js'),'utf8');
const enLocale=readFileSync(path.join(root,'js/i18n/locales/en.js'),'utf8');

function loadPriorityValues(){
  const window={PogoDomain:{}};
  vm.runInNewContext(prioritySource,{window});
  return window.PogoDomain.priorityValues;
}

test('normal add hierarchy keeps lookup, priority, Add, and per-entry details together',()=>{
  assert.match(add,/class="[^"]*ac-wrap[^"]*search-lookup[^"]*"/);
  assert.match(add,/class="add-pri-group"/);
  assert.match(add,/class="bsave"[^>]+myList\.addAction/);
  assert.match(add,/wantEditor\.options/);
  assert.doesNotMatch(add,/aria-controls="export-menu"/);
});

test('list-wide actions are discoverable beside Share and Select in one compact tools menu',()=>{
  assert.match(toolbar,/onclick="openProductShare\(\)"/);assert.match(toolbar,/onclick="startWantsSelection\(\)"/);
  assert.match(toolbar,/<details id="wants-list-tools"/);assert.match(toolbar,/<summary[^>]*>/);
  for(const key of ['workflow.findInList','myList.importAction','workflow.aboutSearches'])assert.match(toolbar,new RegExp(key.replace('.','\\.')));
  assert.equal((toolbar.match(/id="wants-list-tools"/g)||[]).length,1);
  assert.doesNotMatch(toolbar,/mylist-reorder-toggle|speedAdd|bulkEdit/);
});

test('canonical catalog lookup is named and does not advertise the removed voice action',()=>{
  assert.match(add,/id="wants-add-name"[^>]*required/);
  assert.match(add,/data-i18n-aria-label="myList\.searchPlaceholder"/);
  assert.match(html,/input.setAttribute\('role','combobox'\)/);assert.match(html,/onfocus="prepareWantsCatalog\(\)"/);
  assert.doesNotMatch(add,/voice-btn|toggleVoiceInput/);
});

test('flags and exact variant details live in the shared wants editor and omit backgrounds',()=>{
  assert.match(add,/onclick="openWantsAddEditor\(this\)"/);
  for(const id of ['combined-lucky','combined-shiny','combined-xxl','combined-xxs','combined-mod','combined-gender','combined-note'])assert.match(editor,new RegExp(`id="${id}"`));
  assert.match(editor,/maxlength="160"/);assert.doesNotMatch(editor,/background-picker|combined-background/);
  const save=html.slice(html.indexOf('async function saveCombinedEditor('),html.indexOf('let boardHiddenKeys='));
  assert.match(save,/if\(changes\.xxl&&changes\.xxs\)return fail/);
  assert.match(save,/workflow\.choosePriority/);assert.match(save,/applyAccountSyncTradeMutations\(mutations,authority\.controller\)/);
  assert.match(save,/draft\.owner!==cur\|\|draft\.uid!==auth\?\.currentUser\?\.uid/);
});

test('trade qualifiers normalize gender aliases and reject impossible Shadow requirements',()=>{
  const domain=loadPriorityValues();
  for(const [value,expected] of [['male','M'],['MALE','M'],['m','M'],['M','M'],['♂','M'],['female','F'],['FEMALE','F'],['f','F'],['F','F'],['♀','F']]){
    assert.equal(domain.normalizeTradeQualifier(value),expected,value);
  }
  for(const [value,expected] of [['macho','M'],['männlich','M'],['オス','M'],['hembra','F'],['weiblich','F'],['メス','F']])assert.equal(domain.normalizeTradeQualifier(value),expected,value);
  assert.equal(domain.normalizeTradeQualifier('female shadow'),'F');
  assert.equal(domain.normalizeTradeQualifier('male, winter costume'),'M, winter costume');
  assert.equal(domain.normalizeTradeQualifier('Shadow'),'');
  assert.equal(domain.normalizeTradeQualifier('winter costume'),'winter costume');
  assert.equal(domain.priValue('H','female shadow'),'H(F)');
  assert.equal(domain.parsePri('M(male)').mod,'M');
  assert.equal(domain.parsePri('L(Shadow)').mod,'');
  assert.equal(domain.matchesTradeIntent({mod:'female'},'f'),true);
  assert.equal(domain.matchesTradeIntent({mod:'female'},'m'),false);
  assert.equal(domain.matchesTradeIntent({mod:'male, winter costume'},'m'),true);
  assert.equal(domain.matchesTradeIntent({mod:'winter costume'},''),true);
  assert.equal(domain.matchesTradeIntent({p:'H',mod:''},''),true);
});

test('lookup and existing-list filter use deliberate search variants',()=>{
  assert.match(add,/search-lookup/);
  assert.match(html,/type="search" class="field-control" id="combined-filter"/);
  assert.match(html,/id="combined-filter"[^>]*data-i18n-aria-label="workflow\.findInList"/);
});

test('tag metadata and selectable assignment controls have distinct weight',()=>{
  assert.match(html,/\.favorite-card-tag\{[^}]*min-height:26px/);
  assert.match(html,/\.organizer-selectable-chip\{[^}]*min-height:48px/);
  assert.match(html,/class="[^"]*organizer-selectable-chip[^"]*"[^>]+aria-pressed=/);
  assert.doesNotMatch(html,/class="organizer-check"/);
});

test('tag picker is bounded and keeps inline creation and sticky Done',()=>{
  assert.match(html,/\.organizer-assignment\{[^}]*max-height:180px[^}]*overflow-y:auto/);
  assert.match(html,/\.organizer-actions\{[^}]*position:sticky/);
  assert.match(html,/function trainerTagInputKeydown[\s\S]*event\.key==='Enter'[\s\S]*event\.key==='Escape'/);
  assert.match(html,/function createLocalTrainerTag[\s\S]*ensureTag/);
});

test('Find Trainer uses one concise description and no repeated guidance paragraph',()=>{
  const find=html.slice(html.indexOf('<!-- FIND TRAINER'),html.indexOf('<!-- MY LIST'));
  assert.match(find,/id="find-trainer-description"/);
  assert.doesNotMatch(find,/find-guidance-title|sync is not active|private tags/i);
});

test('page containers and reciprocal match labels use one intentional product vocabulary',()=>{
  assert.match(html,/#tab-find \.have-hdr,\.trainer-discovery-content,#tab-schedule \.sched-hdr,#events-out\{width:100%;max-width:var\(--container-wide\)/);
  assert.match(enLocale,/They Have My Wants/);
  assert.match(enLocale,/I Have Their Wants/);
  assert.doesNotMatch(html,/They have that you want|You have that they want/);
});
