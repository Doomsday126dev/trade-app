const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const source=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);

function between(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.notEqual(from,-1,`missing ${start}`);assert.notEqual(to,-1,`missing ${end}`);
  return source.slice(from,to);
}

function harness(){
  const elements={
    'stb-output':{value:'STALE UNSAFE RESULT',blurred:false,blur(){this.blurred=true;},select(){}},
    'stb-summary':{innerHTML:''},'stb-warn-wrap':{innerHTML:''},'stb-copy-btn':{disabled:false},
    'stb-prefilter-chk':{checked:true},'stb-trainer-grid':{addEventListener(){},innerHTML:''}
  };
  let clipboardCalls=0,execCalls=0;const toasts=[];
  const context=vm.createContext({
    auth:{currentUser:{uid:'fixture'}},cur:'Owner',allData:{users:{Other:{}},wishlist:{Other:{Pikachu:'H'}},dynamax:{},gmax:{},costumes:{}},
    DB:{wishlist:[{no:25,name:'Pikachu'}]},Set,Object,String,Number,Math,Array,Map,encodeURIComponent,
    document:{getElementById:id=>elements[id]||null,execCommand(){execCalls++;return true;}},
    navigator:{clipboard:{async writeText(){clipboardCalls++;}}},window:{isSecureContext:true},
    i18nCore:{t:key=>key,formatNumber:String},escHtml:String,lsGet:(_,fallback)=>fallback,lsSet(){},openModal(){},toast:value=>toasts.push(value),
    pokemonGoSearchSyntaxDomain:{safeTransferQuery:()=>({}),serializeQuery:()=>'',queryPrefix:()=>''},pokemonGoSearchLocale:()=> 'en',copyText:async()=>{clipboardCalls++;}
  });
  vm.runInContext(between("const SAFE_TRANSFER_DEFAULT_KEY='pogoSafeTransferDefault';",'function renderDiffModal'),context);
  return{context,elements,toasts,calls:()=>({clipboardCalls,execCalls})};
}

test('safe-transfer generation containment clears stale output and disables copy',()=>{
  const h=harness();
  vm.runInContext("_safeTransferSelected=new Set(['Other']);renderSafeTransferOutput()",h.context);
  assert.equal(h.elements['stb-output'].value,'');
  assert.equal(h.elements['stb-copy-btn'].disabled,true);
  assert.match(h.elements['stb-summary'].innerHTML,/safeTransfer\.temporarilyUnavailable/);
  assert.equal(vm.runInContext('computeSafeTransferString().status',h.context),'disabled');
});

test('direct copy handler rechecks containment and never calls either clipboard method',async()=>{
  const h=harness();
  await vm.runInContext('copySafeTransferString()',h.context);
  assert.deepEqual(h.calls(),{clipboardCalls:0,execCalls:0});
  assert.equal(h.elements['stb-output'].value,'');
  assert.equal(h.elements['stb-output'].blurred,true);
  assert.equal(h.elements['stb-copy-btn'].disabled,true);
  assert.deepEqual(h.toasts,['safeTransfer.temporarilyUnavailable']);
});

test('safe-transfer copy ships disabled before application startup',()=>{
  const html=readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/id="stb-copy-btn"[^>]*disabled/);
  assert.match(source,/const SAFE_TRANSFER_GENERATION_ENABLED=false/);
});
