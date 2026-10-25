const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
// .91 removed category tabs. The active .131 product renders one wants model;
// category identity remains in its adapter and exports rather than a hidden tab UI.
function block(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,`missing ${start} / ${end}`);return html.slice(a,b);}
const myList=block('<!-- MY LIST -->','<!-- SCHEDULE -->');
const combined=block('function renderCombinedList(','function toggleWantsSection(');
const render=block('function renderMyList(','function confirmRemove(');

test('one visible wants list replaces category tabs without removing stored category identity',()=>{
 assert.match(myList,/id="combined-list"/);assert.doesNotMatch(myList,/data-mylist-type=|data-mylist-count=/);
 const adapter=block('function productDeclarations(','function setMyListIntent(');
 assert.match(adapter,/for\(const type of OWNED_MY_LIST_TYPES\)/);assert.match(adapter,/category:type/);assert.match(adapter,/intent:'lf'/);
});
test('wants section state is semantic and not conveyed by color alone',()=>{
 assert.match(combined,/toggle\.setAttribute\('aria-expanded',String\(!collapsed\)\)/);assert.match(combined,/body\.hidden=collapsed/);
 assert.match(combined,/title\.textContent=label/);assert.match(combined,/priorityPokemonCount/);
});
test('category compatibility selection remains in memory and cannot create remote writes',()=>{
 const source=block('function setMyList(t)','function productDeclarations(');
 const calls=[],context={myListType:'wishlist',ensureListSubscribed:type=>calls.push(type),buildAcItems:()=>{},renderMyList:()=>{}};
 vm.runInNewContext(source,context);context.setMyList('gmax');assert.equal(context.myListType,'gmax');assert.deepEqual(calls,['gmax']);
 assert.doesNotMatch(source,/localStorage|sessionStorage|queueSync|writeList/);
});
test('one fresh declaration snapshot drives visible wants and review state',()=>{
 const model={entries:[{name:'Synthetic'}]},calls=[],input={value:''},context={productShareIsOpen:()=>false,managedSessionCache:{snapshot:()=>({activeOwner:null})},cur:'',auth:null,myListFilterTimer:0,myListFilterGeneration:0,clearTimeout:()=>{},productDeclarations:()=>model,renderCombinedList:value=>calls.push(value),renderIntentEntries:(_query,value)=>calls.push(value),renderTradeComparisonReturn:()=>{},renderOwnerShareRepublishNotice:()=>{},document:{getElementById:id=>id==='combined-filter'?input:id==='tab-mylist'?{classList:{toggle:()=>{}}}:null}};
 vm.runInNewContext(render,context);context.renderMyList('synthetic');assert.equal(input.value,'synthetic');assert.deepEqual(calls,[model,model]);
});
test('an empty unified list renders an explicit empty state rather than stale category controls',()=>{
 assert.match(combined,/if\(!active\.length\)host\.innerHTML=/);assert.match(combined,/contextSearch\.empty/);
 assert.doesNotMatch(myList,/mylist-category-heading|mylist-category-name/);
});
test('category count compatibility reads declarations instead of raw duplicate aliases',()=>{
 const source=block('function myListCategoryCount(','function updateMyListCategoryChrome(');
 const fn=source.slice(0,source.indexOf('\n'));const context={myListIntent:'lf'};vm.runInNewContext(fn,context);
 assert.equal(context.myListCategoryCount('gmax',{entries:[{intent:'lf',category:'gmax'},{intent:'ft',category:'gmax'},{intent:'lf',category:'wishlist'}]}),1);
});
test('CSV exports the unified wants snapshot without changing selection or writing Firebase',()=>{
 const csv=block('function exportMyListCSV(','let publicLinkAttempt=');assert.match(csv,/productTextRows\(\)/);assert.match(csv,/wants\.csv/);
 assert.doesNotMatch(csv,/myListType\s*=|setMyList\(|allData\s*=|queueSync\(|writeList|writeListItem|set\s*\(\s*ref|update\s*\(\s*ref/);
 const helper=block('function productCSVText(','function exportMyListCSV(');assert.match(csv,/productCSVText\(entries\)/);
 const context={};vm.runInNewContext(helper,context);
 assert.equal(context.productCSVText([{name:'=SUM(A1)',note:'say \"hi\"'},{name:'@cmd',note:'safe'}]),'\"name\",\"note\"\n\"\'=SUM(A1)\",\"say \"\"hi\"\"\"\n\"\'@cmd\",\"safe\"');
});
test('priority headings retain text, counts and restrained semantic accents',()=>{
 assert.match(combined,/mylist-priority-heading/);assert.match(combined,/wants-section-title/);assert.match(html,/\.mylist-priority-heading\{[^}]*border-left:3px solid/);
 for(const priority of ['H','M','L'])assert.match(html,new RegExp(`\\.mylist-priority-section\\.${priority} \\.mylist-priority-heading\\{[^}]*border-left-color:var\\(--${priority}\\)`));
});
test('active wants collapse is local presentation state with a reversible action',()=>{
 const source=block('function toggleWantsSection(','function showMoreWantsSection('),context={wantsCollapsedSections:new Set(),renderMyList:()=>{context.renders++;},renders:0};
 vm.runInNewContext(source,context);context.toggleWantsSection('H');assert.ok(context.wantsCollapsedSections.has('H'));context.toggleWantsSection('H');assert.equal(context.wantsCollapsedSections.size,0);assert.equal(context.renders,2);
 assert.doesNotMatch(source,/localStorage|sessionStorage|queueSync|writeList/);
});
test('section counts remain full-scope while visible rows obey the in-list filter',()=>{
 assert.match(combined,/section\.entries\.filter\(e=>!query/);assert.match(combined,/priorityPokemonCount.*section\.entries\.length/);
 assert.match(combined,/updateWantsSearch\(search,entries,label\)/);assert.match(combined,/scopeNote\.textContent=query\?i18nCore\.t\('workflow\.fullSection'/);
});
test('account boundaries clear wants render, collapse and selection state',()=>{
 const reset=block('function resetMyListCategoryForAccountBoundary(','function setMyList(');
 assert.match(reset,/myListIntent='lf'/);assert.match(reset,/myListType='wishlist'/);assert.match(reset,/combinedRowCache\.clear\(\)/);assert.match(reset,/wantsCollapsedSections\.clear\(\)/);
 const logout=block('function logout(','// ── NAV');assert.match(logout,/resetMyListCategoryForAccountBoundary\(\)/);
 const transient=block('function resetSessionTransientUi(','_sessionTransientGeneration++;');
 assert.match(transient,/combinedSelection\.clear\(\);combinedOwner='';combinedEditor=null;wantsSelectionMode=false/);
});
test('empty selection removes detached search output and subset sharing',()=>{
 const source=block('function refreshCombinedSearch(','function closeWantsListTools(');
 assert.match(source,/selectedHost\.hidden=!selected\.length/);assert.match(source,/else selectedHost\.replaceChildren\(\)/);assert.match(source,/wants-selection-share'\)\.hidden=!selected\.length/);
});
