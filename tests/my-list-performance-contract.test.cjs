const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(path.join(__dirname,'..'));

test('the primary wants filter is latest-query debounced',()=>{
  assert.match(source,/id="combined-filter"[^>]*oninput="scheduleMyListFilter\(this\.value\)"/);
  assert.match(source,/const MY_LIST_FILTER_DELAY_MS=60/);
  assert.match(source,/const generation=\+\+myListFilterGeneration/);
  assert.match(source,/generation!==myListFilterGeneration/);
});

test('bounded pagination replaces the obsolete background renderer',()=>{
  assert.match(source,/combinedLimit=120/);
  assert.match(source,/visible\.slice\(0,combinedLimit\)/);
  assert.match(source,/combinedLimit\+=120;renderCombinedList\(\)/);
  assert.match(source,/combinedRowCache\.size<=combinedLimit/);
  assert.doesNotMatch(source,/id="mylist-out"|function myListRowHtml\(|function scheduleProgressiveMyListRender\(/);
});

test('unchanged variant rows survive filters without serialized model metadata',()=>{
  assert.match(source,/cached\?\.signature===signature/);
  assert.match(source,/combinedRowCache\.set\(key,\{row,signature\}\)/);
  assert.match(source,/grid\.insertBefore\(row,grid\.children\[index\]\|\|null\)/);
  assert.match(source,/if\(!groupKeys\.has\(key\)\)combinedRowCache\.delete\(key\)/);
  assert.doesNotMatch(source,/row\.dataset\.signature=signature/);
});

test('one fresh declaration model supplies the current rows and copy output',()=>{
  const render=source.slice(source.indexOf('function renderMyList('),source.indexOf('function confirmRemove('));
  assert.equal((render.match(/productDeclarations\(\)/g)||[]).length,1);
  assert.match(render,/renderCombinedList\(declarations\)/);
  assert.match(source,/refreshCombinedSearch\(model\)/);
  assert.doesNotMatch(source,/function renderMyStrings\(|function myListSearchOptionHtml\(/);
});
