const {expect}=require('@playwright/test');

const PRIORITY_REVIEW_NOW=Date.UTC(2026,8,7,16);

// One fixed, entirely synthetic dataset for both the .99 baseline and candidate.
// Network isolation allows artwork but prevents account/service requests.
async function installPriorityReviewFixture(page,{theme='dark',large=false}={}){
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(['localhost','127.0.0.1','::1'].includes(url.hostname)||request.resourceType()==='image')return route.continue();
    return route.abort();
  });
  await page.route('**/sw.js*',route=>route.abort());
  await page.clock.setFixedTime(new Date(PRIORITY_REVIEW_NOW));
  await page.goto('./?my-list-priority-review');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('my-list-priority-review'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(({theme,large,now})=>{
    managedListenerLifecycle?.deactivateSession?.('priority_review_fixture');
    managedListenerLifecycle?.clearSelectedTrainer?.('priority_review_fixture');
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    localStorage.clear();sessionStorage.clear();
    cur='Avery';auth={currentUser:{uid:'synthetic-priority-review-avery'}};
    const wishlist={Pikachu:'H',Rayquaza:'H[shiny]',Dragonite:'H',Eevee:'M(F)',Sinistea:'M(Antique)',Gardevoir:'M[shiny]',
      Snorlax:'L',Lapras:'L[lucky]',Bulbasaur:'[lucky]',Charmander:'[xxl]',Squirtle:'[xxs]',Gengar:'[shiny]',Wailmer:'[lucky][xxl]',Psyduck:''};
    if(large){
      for(const entry of listSource('wishlist')){
        if(Object.keys(wishlist).length>=1000)break;
        if(entry.name&&!Object.hasOwn(wishlist,entry.name))wishlist[entry.name]=['H','M','L'][Object.keys(wishlist).length%3];
      }
    }
    allData=normalizeData({users:{Avery:{authUid:'synthetic-priority-review-avery',lastUpdated:now-3600000,
      specialTradeBoard:{lf:[{name:'Pikachu',no:25,p:'',lucky:true,note:'Lucky dex'}],ft:[]}}},
      wishlist:{Avery:wishlist},dynamax:{Avery:{Charmander:'M'}},gmax:{Avery:{}},
      costumes:{Avery:{'Pikachu (Worlds 2025)':'H','Unown (!)':'M'}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    accountSyncCanonicalEntities=[];
    document.documentElement.dataset.theme=theme;
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent='Avery';document.getElementById('my-av').textContent='A';
    document.getElementById('top-un').textContent='Avery';document.getElementById('account-menu-name').textContent='Avery';
    document.getElementById('my-fc-wrap').innerHTML='';
    renderInterimProductLabels();switchTab('mylist',{render:false});renderMyList();setSyncStatus('online');
    window.__priorityReviewData=JSON.stringify(allData);window.__priorityReviewCopied='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__priorityReviewCopied=value;}}});
  },{theme,large,now:PRIORITY_REVIEW_NOW});
  await page.evaluate(()=>waitForMyListRender());
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(large?120:18);
}

async function settlePriorityReview(page){
  await page.locator('#tab-mylist img').evaluateAll(images=>images.forEach(image=>image.loading='eager'));
  await expect.poll(()=>page.locator('#combined-list img').evaluateAll(images=>images.every(image=>image.complete)),{timeout:30000}).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#toast')).toBeHidden({timeout:8000});
}

module.exports={PRIORITY_REVIEW_NOW,installPriorityReviewFixture,settlePriorityReview};
