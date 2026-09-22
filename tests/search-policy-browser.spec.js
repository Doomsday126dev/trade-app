const {test,expect}=require('@playwright/test');
const fs=require('node:fs');

const PUBLIC_SHARE_SOURCE=fs.readFileSync('js/app/publicShareApp.js','utf8');
const PROTECTED=Object.freeze({
  en:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&25',
  ja:'!4*&!こうかん&!色違い&cp-2500&!しゃどう&!らいと&!はいけい&25',
  es:'!4*&!intercambiados&!variocolor&PC-2500&!oscuro&!purificado&!fondo&25',
  de:'!4*&!getauscht&!Schillernd&WP-2500&!Crypto&!Erlöst&!hintergrund&25'
});
const BROAD=Object.freeze({
  en:'!traded&1',ja:'!こうかん&1',es:'!intercambiados&1',de:'!getauscht&1'
});

test.use({serviceWorkers:'block'});

test('real search controls copy complete protected and broad strings in every supported game locale',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await fixture(page);
  for(const locale of Object.keys(PROTECTED)){
    await page.evaluate(value=>changePokemonGoSearchLocale(value),locale);
    await copyAndExpect(page,'#combined-list > [data-wants-section="H"] [data-contextual-copy]',PROTECTED[locale]);
    await copyAndExpect(page,'#combined-list > [data-wants-section="SHINY"] [data-contextual-copy]',BROAD[locale]);
  }

  await page.evaluate(()=>{
    changePokemonGoSearchLocale('en');combinedSelection.clear();
    for(const entry of productDeclarations().entries)combinedSelection.add(productSelectionKey(entry));
    refreshCombinedSearch();
  });
  const mixed=page.locator('#combined-search [data-contextual-copy]');
  await expect(mixed).toHaveCount(2);
  await copyAndExpect(page,mixed.nth(0),PROTECTED.en);
  await copyAndExpect(page,mixed.nth(1),BROAD.en);

  const who=await page.evaluate(()=>{
    const entry={intent:'lf',name:'Pikachu',dn:'Pikachu',no:25,p:'H',type:'wishlist',members:[{key:'friend',displayName:'Friend',priorities:['H']}]};
    ensureTrainerHistoryStore=()=>({read:()=>({favorites:[{key:'friend',displayName:'Friend',tagIds:[]}],tags:{}})});
    favoriteLookupModel=()=>({entries:[entry],variants:[],exact:false,members:[{key:'friend',displayName:'Friend',status:'available',groups:[],updatedAt:1,fetchedAt:Date.now()}]});
    favoriteBrowseState.selected={name:'Pikachu',dn:'Pikachu',no:25};favoriteBrowseState.busy=false;favoriteBrowseState.expanded=true;
    changePokemonGoSearchLocale('en');renderFavoriteBrowseResults();
    const before=document.querySelector('#favorite-browse-results [data-contextual-copy]').dataset.contextualCopy;
    changePokemonGoSearchLocale('de');
    const after=document.querySelector('#favorite-browse-results [data-contextual-copy]').dataset.contextualCopy;
    return{before,after};
  });
  expect(who).toEqual({before:PROTECTED.en,after:PROTECTED.de});
  expect(errors).toEqual([]);
});

test('anonymous public share keeps its interface locale and copies the explicit game-search locale',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await fixture(page);
  await page.addScriptTag({content:PUBLIC_SHARE_SOURCE.replace('global.__pogoStartPublicShare=start;','global.__searchPolicyPublic={state,renderList};global.__pogoStartPublicShare=start;')});
  const result=await page.evaluate(()=>{
    PogoI18n.core.setLocale('en',{persist:false});
    localStorage.setItem('pogoPokemonGoSearchLocaleOverride:v1',JSON.stringify(true));
    localStorage.setItem('pogoPokemonGoSearchLocale:v1',JSON.stringify('de'));
    document.getElementById('share-view').classList.add('active');
    __searchPolicyPublic.state.snapshot={version:2,username:'PublicAudit',profile:{},declarations:[{intent:'lf',name:'Pikachu',category:'wishlist',p:'H'}],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}}};
    __searchPolicyPublic.state.type='wishlist';__searchPolicyPublic.renderList(__searchPolicyPublic.state.snapshot);
    return{ui:PogoI18n.core.getLocale(),query:document.querySelector('#share-list-out [data-contextual-copy]').dataset.contextualCopy};
  });
  expect(result).toEqual({ui:'en',query:PROTECTED.de});
  await copyAndExpect(page,'#share-list-out [data-contextual-copy]',PROTECTED.de);
  expect(errors).toEqual([]);
});

async function fixture(page){
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('**/*',route=>{
    let sameOrigin=false;try{sameOrigin=new URL(route.request().url()).origin===origin;}catch{}
    return sameOrigin?route.continue():route.abort();
  });
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copied=value;}}}));
  await page.goto('./?search-policy-browser');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('search-policy-browser'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(()=>{
    managedListenerLifecycle?.deactivateSession?.('search_policy_browser');managedListenerLifecycle?.clearSelectedTrainer?.('search_policy_browser');managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='Audit';auth={currentUser:{uid:'synthetic-search-policy'}};
    allData=normalizeData({users:{Audit:{authUid:'synthetic-search-policy'}},wishlist:{Audit:{Pikachu:'H',Bulbasaur:'[shiny]'}},dynamax:{},gmax:{},costumes:{}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    switchTab('mylist',{render:false});renderMyList();
  });
}

async function copyAndExpect(page,target,expected){
  const button=typeof target==='string'?page.locator(target):target;
  await page.evaluate(()=>window.__copied='');await button.click();
  await expect.poll(()=>page.evaluate(()=>window.__copied)).toBe(expected);
}
