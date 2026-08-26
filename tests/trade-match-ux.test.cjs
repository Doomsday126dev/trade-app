const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');

function block(start,end){
  const from=html.indexOf(start),to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return html.slice(from,to);
}

test('trainer profile opens the reciprocal comparison instead of generic list overlap',()=>{
  const source=block('function openActiveShareComparison','function openDiffModal');
  assert.match(source,/openTradeMatchModal\(username\)/);
  assert.doesNotMatch(source,/openDiffModal/);
  assert.match(html,/tradeMatch\.backToList/);
  assert.match(html,/tradeMatch\.editMyList/);
});

test('reciprocal matching binds actual entries to compatible intent and honest availability',()=>{
  const source=block('function ownTradeInventoryAvailable','function tradeIntentFreeform');
  assert.match(source,/managedOwnedDataCoordinator\?\.isHydratedFor\('inventory'/);
  assert.match(source,/selectedTrainerRuntime\.username===them&&!!selectedTrainerRuntime\.publicData/);
  assert.match(source,/protectedOwnerSession\(\)&&_pathLoadState\.have==='loaded'/);
  assert.match(source,/matchesTradeIntent\(intent,it\.gender\)/);
  assert.match(source,/return\{theyHaveYouWant,youHaveTheyWant,mirrors,availability\}/);
});

test('comparison cards render extensible qualifiers and keep direction non-color-dependent',()=>{
  const source=block('function tradeIntentQualifierTokens','function renderTradeMatchModal');
  for(const token of ['priority','lucky','shiny','xxl','xxs','gender','detail'])assert.match(source,new RegExp(token,'i'));
  assert.match(source,/tradeMatch\.theyDirection/);
  assert.match(source,/tradeMatch\.iDirection/);
  assert.match(source,/aria-hidden="true">↓/);
  assert.match(source,/aria-hidden="true">↑/);
  assert.match(source,/diff-match-qualifier/);
});

test('edit-and-return comparison state is process-local and recomputes from current data',()=>{
  const source=block('function renderTradeComparisonReturn','// ── SAFE-TO-TRANSFER');
  assert.match(source,/_tradeComparisonReturn=\{username,type:/);
  assert.match(source,/switchTab\('mylist'\)/);
  assert.match(source,/renderShareView\(target\.username,target\.type\)/);
  assert.match(source,/openTradeMatchModal\(target\.username\)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|set\(ref\(|update\(ref\(/);
});

test('reciprocal dialog exposes a title, Escape handling, focus trap, and disclosure state',()=>{
  const source=block('function renderTradeMatchModal','function renderTradeComparisonReturn');
  assert.match(source,/aria-labelledby="trade-match-title"/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/event\.key!=='Tab'/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(source,/setAttribute\('aria-expanded'/);
});
