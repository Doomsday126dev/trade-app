const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const html=readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('trainer suggestions are anchored to the combobox above surrounding content',()=>{
  assert.match(html,/class="[^"]*\btrainer-combobox\b[^"]*">[\s\S]*id="find-trainer-input"[\s\S]*id="find-trainer-suggestions"/);
  assert.match(html,/\.trainer-combobox\{position:relative;flex:1;min-width:0\}/);
  assert.match(html,/\.trainer-suggestions\{position:absolute;z-index:340/);
  assert.match(html,/\.trainer-search-shell\.suggestions-open\{z-index:330\}/);
  assert.match(html,/overscroll-behavior:contain/);
});

test('mobile dropdown uses visual viewport, supports upward placement, and keeps large touch targets',()=>{
  assert.match(html,/window\.visualViewport/);
  assert.match(html,/spaceBelow<176&&spaceAbove>spaceBelow/);
  assert.match(html,/box\.dataset\.placement=above\?'above':'below'/);
  assert.match(html,/trainer-suggestions\[data-placement="above"\]/);
  assert.match(html,/\.trainer-suggestion\{min-height:48px;font-size:14px\}/);
  assert.match(html,/scrollIntoView\?\.\(\{block:'center',behavior:'smooth'\}\)/);
});

test('combobox semantics and keyboard/touch selection remain intact',()=>{
  assert.match(html,/role="combobox" aria-autocomplete="list"/);
  assert.match(html,/role="listbox"/);
  assert.match(html,/role="option"/);
  assert.match(html,/event\.key==='ArrowDown'\|\|event\.key==='ArrowUp'/);
  assert.match(html,/event\.key==='Enter'/);
  assert.match(html,/event\.key==='Escape'/);
  assert.match(html,/onclick="selectTrainerSuggestion\(\$\{index\}\)"/);
});
