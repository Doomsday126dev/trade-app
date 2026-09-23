const {expect}=require('@playwright/test');
const HIGH_NAMES=['Arrokuda','Flittle','Unown (Z)','Unown (M)','Shedinja','P-Tauros (Aqua)','P-Tauros (Blaze)','P-Tauros (Combat)','H-Typhlosion','Spinda (Form 7)','Spinda (Form 1)','Spinda (Form 2)','Spinda (Form 6)','Relicanth','Rotom','Rotom (Frost)','Rotom (Fan)','Rotom (Heat)','Rotom (Wash)','A-Raichu','G-Yamask','Galarian Articuno','Pikachu','Raichu','Eevee','Mewtwo','Snorlax','Bulbasaur','Charmander','Squirtle','Pidgey','Rattata','Sandshrew','Nidoran-F','Nidoran-M','Vulpix','Zubat','Oddish','Diglett','Psyduck','Growlithe','Abra','Machop','Geodude','Slowpoke','Magnemite','Gastly'];
async function installVisualFixture(page){
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174').origin;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin||route.request().resourceType()==='image'?route.continue():route.abort());
  await page.goto('./?visual-consistency');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('visual-consistency'));
  await page.waitForFunction(()=>typeof renderMyList==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(names=>{
    managedListenerLifecycle?.deactivateSession?.('visual-fixture');
    managedListenerLifecycle?.clearSelectedTrainer?.('visual-fixture');
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    cur='VisualFixture';_authStateKnown=true;auth={currentUser:{uid:'synthetic-visual-fixture',providerData:[]}};
    for(const name of names)if(!listSource('wishlist').some(entry=>entry.name===name||entry.displayName===name)){
      const no=PogoDomain.publicPokemonDex.dex(name);if(no)DB.wishlist.push({no,name,displayName:name,users:{}});
    }
    accountSyncCatalogIndex=null;myListSourceMapCache.clear();spriteIndex=null;
    allData=normalizeData({users:{VisualFixture:{authUid:'synthetic-visual-fixture',friendCode:'1234 5678 9012',bio:'Weekend trades and long-distance friendships. Looking for regional forms and costumes.',discord:'synthetic-trainer',specialTradeBoard:{lf:[{name:'Pichu',no:172,p:'',lucky:true},{name:'Bidoof',no:399,p:'',shiny:true},{name:'Wailmer',no:320,p:'',xxl:true},{name:'Yungoos',no:734,p:'',xxs:true}],ft:[]}}},wishlist:{VisualFixture:{...Object.fromEntries(names.map(name=>[name,'H'])),Snom:'M',Joltik:'L'}},dynamax:{VisualFixture:{}},gmax:{VisualFixture:{}},costumes:{VisualFixture:{}}});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent='Visual Fixture';document.getElementById('my-av').textContent='V';document.getElementById('top-un').textContent='Visual Fixture';
    switchTab('mylist',{render:false});renderMyList();updateFcDisplay();applyTheme('dark');
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__visualCopied=value;}}});
    window.__visualBefore=JSON.stringify(allData);
  },HIGH_NAMES);
  await expect(page.locator('[data-wants-section="H"] .wants-row')).toHaveCount(47);
  await page.locator('#combined-list img').evaluateAll(images=>images.forEach(image=>image.loading='eager'));
  await expect.poll(()=>page.locator('[data-wants-section="H"] img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>1)),{timeout:20000}).toBe(true);
  await expect.poll(()=>page.locator('[data-wants-section="H"] .wants-row').first().evaluate(row=>getComputedStyle(row).opacity)).toBe('1');
}
module.exports={installVisualFixture,HIGH_NAMES};
