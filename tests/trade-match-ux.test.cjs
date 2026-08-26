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

test('trainer profile opens the wanted-list comparison',()=>{
  const source=block('function openActiveShareComparison','function openDiffModal');
  assert.match(source,/openTradeMatchModal\(username\)/);
  assert.doesNotMatch(source,/openDiffModal/);
  assert.match(html,/tradeMatch\.backToList/);
  assert.match(html,/tradeMatch\.editMyList/);
});

test('comparison uses only wanted lists including Special Board wants',()=>{
  const source=block('function tradeListWants','function tradeIntentFreeform');
  assert.match(source,/OWNED_MY_LIST_TYPES/);
  assert.match(source,/specialTradeBoard/);
  assert.match(source,/Array\.isArray\(board\?\.lf\)/);
  assert.match(source,/tradeListComparisonDomain\.compareWantedLists/);
  assert.doesNotMatch(source,/board\?\.ft|tradeListOffers|myOffers|theirOffers|allData\.have|inventory|\bqty\b/);
});

test('comparison cards render exact wanted qualifiers and three named sections',()=>{
  const source=block('function tradeIntentQualifierTokens','function renderTradeMatchModal');
  for(const token of ['lucky','shiny','xxl','xxs','background','gender','detail'])assert.match(source,new RegExp(token,'i'));
  for(const token of ['bothWant','onlyIWant','onlyTheyWant','bothDirection','mineDirection','theirsDirection'])assert.match(source,new RegExp(`tradeMatch\\.${token}`));
  assert.doesNotMatch(source,/theyDirection|iDirection|possibleMirrors/);
  assert.match(source,/diff-match-qualifier/);
});

test('wanted-set view models and cards exclude offers, mirrors, inventory, and quantities',()=>{
  const model=block('function tradeListWants','function tradeIntentFreeform');
  const render=block('function renderTradeMatchSummary','function renderTradeMatchModal');
  assert.doesNotMatch(model,/theirQty|\.qty\b|allData\.have|inventory|tradeListOffers|myOffers|theirOffers/i);
  assert.doesNotMatch(render,/diff-match-qty|theirQuantity|\bit\.qty\b/);
  assert.match(render,/diff-match-count/);
  for(const locale of ['en','es','de','ja']){
    const text=readFileSync(path.join(root,'js','i18n','locales',`${locale}.js`),'utf8');
    const tradeBlock=text.slice(text.indexOf("'tradeMatch.title'"),text.indexOf("'data.loading'"));
    assert.doesNotMatch(tradeBlock,/inventory|inventario|Inventar|\u6240\u6301|offer|ofrece|Angebot|\u4ea4\u63db\u5019\u88dc/i);
    assert.doesNotMatch(tradeBlock,/tradeMatch\.theirQuantity/);
    for(const key of ['tradeMatch.bothWant','tradeMatch.onlyIWant','tradeMatch.onlyTheyWant'])assert.match(tradeBlock,new RegExp(key.replace('.','\\.')));
  }
});

test('edit-and-return comparison state is process-local and recomputes from current data',()=>{
  const source=block('function renderTradeComparisonReturn','// ── SAFE-TO-TRANSFER');
  assert.match(source,/_tradeComparisonReturn=\{username,type:/);
  assert.match(source,/switchTab\('mylist'\)/);
  assert.match(source,/renderShareView\(target\.username,target\.type\)/);
  assert.match(source,/openTradeMatchModal\(target\.username\)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|set\(ref\(|update\(ref\(/);
});

test('wanted-list dialog exposes a title, Escape handling, focus trap, and disclosure state',()=>{
  const source=block('function renderTradeMatchModal','function renderTradeComparisonReturn');
  assert.match(source,/aria-labelledby="trade-match-title"/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/event\.key!=='Tab'/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(source,/setAttribute\('aria-expanded'/);
});
