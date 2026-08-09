const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=readFileSync(path.join(root,'index.html'),'utf8');
const myList=html.slice(html.indexOf('<!-- MY LIST'),html.indexOf('<!-- HAVE'));
const setMyList=html.slice(html.indexOf('function setMyList('),html.indexOf('function toggleAddAdvanced('));
const renderMyList=html.slice(html.indexOf('function renderMyList('),html.indexOf('async function renderListImage('));
const exportCsv=html.slice(html.indexOf('function exportMyListCSV('),html.indexOf('async function copyShareLink('));
const tools=html.slice(html.indexOf('function toggleExportMenu('),html.indexOf('function exportMyListMarkdown('));

test('all four My List categories expose hydrated counts and semantic selection',()=>{
  assert.match(myList,/role="tablist"/);
  for(const type of ['wishlist','dynamax','gmax','costumes']){
    assert.match(myList,new RegExp(`role="tab"[^>]+data-mylist-type="${type}"`));
    assert.match(myList,new RegExp(`data-mylist-count="${type}"`));
  }
  assert.match(html,/setAttribute\('aria-selected',active\?'true':'false'\)/);
  assert.match(html,/myList\.categoryTabLabel/);
});

test('selected category is visually unmistakable without relying on color alone',()=>{
  assert.match(html,/\.mylist-type-tabs \.ltab\.active \.ltab-marker\{display:inline\}/);
  assert.match(myList,/class="ltab-marker" aria-hidden="true">✓<\/span>/);
  assert.match(html,/\.ltab\.active\{[^}]*border-color:#fff[^}]*font-weight:700[^}]*box-shadow/);
});

test('heading and empty state always identify the active category',()=>{
  assert.match(myList,/id="mylist-category-name"/);
  assert.match(renderMyList,/myListCategoryLabel\(myListType\)/);
  assert.match(renderMyList,/`myList\.empty\.\$\{myListCategoryKey\(myListType\)\}Title`/);
  assert.match(renderMyList,/`myList\.empty\.\$\{myListCategoryKey\(myListType\)\}Help`/);
  assert.doesNotMatch(renderMyList,/myList\.emptyTitle|Nothing here yet/);
});

test('an empty category offers a safe shortcut to populated hydrated data',()=>{
  assert.match(html,/function populatedMyListAlternative\(\)/);
  assert.match(renderMyList,/myList\.viewCategory/);
  assert.match(renderMyList,/onclick="setMyList\('\$\{alternative\}'\)"/);
});

test('counts derive from current hydrated data and refresh with list rendering',()=>{
  assert.match(html,/function myListCategoryCount\(type\)\{return Object\.keys\(allData\[type\]\?\.\[cur\]\|\|\{\}\)\.length;\}/);
  assert.match(renderMyList,/updateMyListCategoryChrome\(\)/);
  assert.match(renderMyList,/Object\.keys\(list\)\.length/);
});

test('CSV export and Tools lifecycle preserve myListType',()=>{
  assert.match(exportCsv,/currentListEntries\(myListType\)/);
  assert.doesNotMatch(exportCsv,/myListType\s*=|setMyList\(/);
  assert.doesNotMatch(tools,/myListType\s*=|setMyList\(/);
  assert.match(tools,/closeExportMenu\(\)/);
});

test('category selection remains in-memory and fresh page load defaults to Trades',()=>{
  assert.match(html,/let myListType='wishlist'/);
  assert.match(setMyList,/myListType=t/);
  assert.doesNotMatch(setMyList,/localStorage|sessionStorage|lsSet/);
});

test('logout and a new authenticated identity reset category to Trades',()=>{
  const logout=html.slice(html.indexOf('function logout('),html.indexOf('// ── NAV'));
  const observer=html.slice(html.indexOf('function bindAuthObserver('),html.indexOf('function waitForAuthState('));
  const login=html.slice(html.indexOf('async function doLogin('),html.indexOf('function logout('));
  assert.match(html,/function resetMyListCategoryForAccountBoundary\(\)\{\s*myListType='wishlist'/);
  assert.match(logout,/resetMyListCategoryForAccountBoundary\(\)/);
  assert.match(observer,/user&&_lastAuthenticatedIdentityUid!==user\.uid/);
  assert.match(observer,/resetMyListCategoryForAccountBoundary\(\)/);
  assert.match(login,/if\(cur&&cur!==u\)resetMyListCategoryForAccountBoundary\(\)/);
});

test('empty category suppresses detached search controls',()=>{
  const strings=html.slice(html.indexOf('function renderMyStrings('),html.indexOf('async function copyText('));
  assert.match(strings,/if\(!strs\)\{el\.innerHTML='';return;\}/);
});
