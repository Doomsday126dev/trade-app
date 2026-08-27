const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('function myListSourceMap('),html.indexOf('function confirmRemove('));

test('My List caches locale-bound normalized view models and invalidates changed values',()=>{
  assert.match(html,/const myListViewModelCache=new Map\(\)/);
  assert.match(source,/cacheKey=JSON\.stringify\(\[type,user,locale,name\]\)/);
  assert.match(source,/fingerprint=JSON\.stringify\(\[value,/);
  assert.match(source,/cached\?\.fingerprint===fingerprint/);
  assert.match(source,/rawValue:value/);
});

test('filtering is latest-query debounced and preserves stable row nodes for ordinary lists',()=>{
  assert.match(html,/oninput="scheduleMyListFilter\(this\.value\)"/);
  assert.match(source,/const generation=\+\+myListFilterGeneration/);
  assert.match(source,/generation!==myListFilterGeneration/);
  assert.match(source,/row\.hidden=!show/);
  assert.match(source,/previous\?\.visibilityDom/);
});

test('large lists expose a bounded usable state before idle progressive completion',()=>{
  assert.match(html,/const MY_LIST_PROGRESSIVE_THRESHOLD=180/);
  assert.match(html,/const MY_LIST_PROGRESSIVE_INITIAL_ROWS=120/);
  assert.match(source,/window\.requestIdleCallback/);
  assert.match(source,/root\.dataset\.renderComplete='true'/);
  assert.match(source,/function waitForMyListRender\(\)/);
});

test('keyed patching reuses unchanged rows and swipe ownership stays on the stable root',()=>{
  assert.match(source,/row\.dataset\.renderKey!==expectedKey/);
  assert.match(source,/fragment\.append\(row\)/);
  assert.match(source,/grid\.replaceChildren\(fragment\)/);
  assert.match(html,/const grid=document\.getElementById\('mylist-out'\)/);
});
