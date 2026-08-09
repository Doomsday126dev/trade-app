const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const add=html.slice(html.indexOf('<div class="add-form">'),html.indexOf('<div class="owner-share-notice"'));

test('normal add hierarchy keeps lookup, priority, Add, More options, and Tools visible',()=>{
  assert.match(add,/class="ac-wrap search-lookup"/);
  assert.match(add,/class="add-pri-group"/);
  assert.match(add,/class="bsave"[^>]+myList\.addAction/);
  assert.match(add,/myList\.moreOptions/);
  assert.match(add,/aria-controls="export-menu"/);
});

test('power actions live inside one compact Tools menu',()=>{
  const menu=add.slice(add.indexOf('id="export-menu"'),add.indexOf('</div>\n        </div>',add.indexOf('id="export-menu"')));
  for(const key of ['myList.importAction','myList.speedAdd','myList.bulkEdit','export.classicImage'])assert.match(menu,new RegExp(key.replace('.','\\.')));
  assert.equal((add.match(/id="export-menu-btn"/g)||[]).length,1);
});

test('voice is an accessible action inside the lookup field',()=>{
  const lookup=add.slice(add.indexOf('class="ac-wrap search-lookup"'),add.indexOf('</div>',add.indexOf('class="ac-wrap search-lookup"')));
  assert.match(lookup,/id="voice-btn"/);assert.match(lookup,/data-i18n-aria-label="myList\.voiceInput"/);
  assert.match(html,/\.voice-btn\{[^}]*width:48px;height:48px/);
});

test('flags and variant details remain behind More options without changing identifiers',()=>{
  assert.match(add,/id="add-advanced"/);
  for(const id of ['add-pmon-lucky','add-pmon-shiny','add-pmon-xxl','add-pmon-xxs','add-pmon-notes'])assert.match(add,new RegExp(`id="${id}"`));
  assert.match(add,/myList\.variantDetailsPlaceholder/);
  assert.match(html,/list\[name\]=priValue\(pri,notes,lucky,xxl,xxs,shiny\)/);
});

test('lookup and existing-list filter use deliberate search variants',()=>{
  assert.match(add,/search-lookup/);
  assert.match(html,/class="mylist-search app-search-shell search-filter"/);
});

test('tag metadata and selectable assignment controls have distinct weight',()=>{
  assert.match(html,/\.favorite-card-tag\{[^}]*min-height:26px/);
  assert.match(html,/\.organizer-selectable-chip\{[^}]*min-height:48px/);
  assert.match(html,/class="organizer-selectable-chip"[^>]+aria-pressed=/);
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
