const {expect}=require('@playwright/test');

const REVIEW_NOW=Date.UTC(2026,8,7,16);
const FAVORITES=['Alice','Blair','Jamie','Noah','RegionalCollectorWithALongName','PrivateTrainer'];

async function isolateReviewNetwork(page){
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(['localhost','127.0.0.1','::1'].includes(url.hostname))return route.continue();
    if(request.resourceType()==='image')return route.continue();
    return route.abort();
  });
  await page.route('**/sw.js*',route=>route.abort());
  await page.clock.setFixedTime(new Date(REVIEW_NOW));
}

async function installReviewFixture(page,{theme='dark'}={}){
  await isolateReviewNetwork(page);
  await page.addInitScript(({now})=>{
    localStorage.setItem('pogoTourSeen',JSON.stringify(now));
    localStorage.setItem('pogoWhatsNewSeen',JSON.stringify(now));
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__reviewCopy=value;}}});
  },{now:REVIEW_NOW,theme});
  await page.goto('./?ui-consolidation-review');
  await page.waitForFunction(()=>typeof __pogoEnsureFullApp==='function');
  await page.evaluate(()=>__pogoEnsureFullApp('ui-consolidation-review'));
  await page.waitForFunction(()=>typeof renderTrainerGroups==='function'&&window.__pogoStartup?.firebaseStartupSettledAt>0);
  await page.evaluate(({now,theme,names})=>{
    managedListenerLifecycle?.deactivateSession?.('ui_review_fixture');
    managedListenerLifecycle?.clearSelectedTrainer?.('ui_review_fixture');
    managedSubscriptions?.unsubscribeByKey?.('public:loginDirectory');
    managedOwnedDataCoordinator?.reset?.();
    db=null;fbOn=false;managedFirebaseClient=null;managedAccountSyncRuntime=null;accountSyncUiState=null;
    resetTrainerOrganizerState();localStorage.clear();sessionStorage.clear();
    cur='Avery';auth={currentUser:{uid:'synthetic-ui-review-avery'}};
    const wants={Pikachu:'H[shiny](F)',Rayquaza:'H[shiny]',Snom:'H',Gengar:'H',Lucario:'H',Dragonite:'H',
      'Unown (Z)':'H',Maractus:'H',Eevee:'M(F)',Lapras:'M[lucky]',Gardevoir:'M[shiny]',Snorlax:'L'};
    for(const entry of listSource('wishlist')){
      if(Object.keys(wants).length>=96)break;
      if(entry.no>0&&entry.no<=151&&!wants[entry.name]&&entry.name===pokemonCatalogDomain.speciesNameByNo?.(entry.no))wants[entry.name]='L';
    }
    // Use stable catalog names without inventing entries or image placeholders.
    if(Object.keys(wants).length<96)for(const entry of listSource('wishlist')){
      if(Object.keys(wants).length>=96)break;
      if(entry.no>0&&entry.no<=151&&!wants[entry.name]&&!/[()]/.test(entry.name))wants[entry.name]=Object.keys(wants).length%3===0?'M':'L';
    }
    const users={Avery:{authUid:'synthetic-ui-review-avery',friendCode:'1111 2222 3333',avatarPokemon:'Pikachu',lastUpdated:now-3600000,lastSeen:now,specialTradeBoard:{lf:[],ft:[]}}};
    names.forEach((name,index)=>{users[name]={authUid:`synthetic-ui-review-${index}`,lastUpdated:now-(index+1)*3600000,lastSeen:now-index*86400000};});
    allData=normalizeData({users,wishlist:{Avery:wants},dynamax:{Avery:{Charmander:'M'}},gmax:{Avery:{Pikachu:'L'}},
      costumes:{Avery:{'Pikachu (Worlds 2025)':'H'}},loginDirectory:Object.fromEntries(Object.keys(users).map(name=>[name,{authReady:true}]))});
    _pathLoadState={wishlist:'loaded',dynamax:'loaded',gmax:'loaded',costumes:'loaded'};accountSyncCanonicalEntities=[];
    accountSyncMutationAuthority=async()=>({mode:'legacy'});accountSyncAuthorityCurrent=()=>true;
    const store=ensureTrainerHistoryStore();
    names.forEach(name=>store.saveFavoriteOrganization(name));
    const weekend=store.createTag('Weekend trades'),regional=store.createTag('Regional swaps'),raid=store.createTag('Raid friends');
    for(const name of ['Alice','Blair','Jamie'])store.setFavoriteTags(name,[weekend.id]);
    for(const name of ['Noah','RegionalCollectorWithALongName'])store.setFavoriteTags(name,[regional.id]);
    store.setFavoriteTags('Alice',[weekend.id,raid.id]);store.setFavoriteTags('PrivateTrainer',[raid.id]);
    const snapshot={lists:{wishlist:{Pikachu:'M'},dynamax:{},gmax:{},costumes:{}}};
    store.rememberChecked('Alice',snapshot,{seenAt:now-2*86400000});
    store.rememberChecked('Blair',{lists:{wishlist:{Pikachu:'H',Eevee:'L'},dynamax:{},gmax:{},costumes:{}}},{seenAt:now-2*86400000});
    store.rememberOpened('Morgan',snapshot,now-3600000);store.rememberOpened('Casey',snapshot,now-86400000);
    window.__reviewGroupIds={weekend:weekend.id,regional:regional.id,raid:raid.id};
    window.__reviewPublicReads=[];
    const projections={};
    names.forEach((name,index)=>{
      const exact=name==='Alice';
      const declarations=publicSharePublicationDomain.publicDeclarations(exact?[
        {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',shiny:true,gender:'f'},
        {intent:'lf',category:'wishlist',name:'Snom',p:'H'},
        {intent:'lf',category:'wishlist',name:'Rayquaza',p:'M',shiny:true},
        {intent:'lf',category:'gmax',name:'Pikachu',p:'L'}
      ]:[{intent:'lf',category:'wishlist',name:'Pikachu',p:index%2?'M':'H'},
        {intent:'lf',category:'wishlist',name:index%2?'Eevee':'Lucario',p:'L'}]);
      projections[name]={version:2,username:name,profile:{friendCode:'',avatarPokemon:'',lastUpdated:now-(index+1)*3600000},
        lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],
        declarations,declarationCount:declarations.length,updatedAt:now-(name==='Noah'?32*86400000:(index+1)*3600000)};
    });
    const cache=favoriteShareSessionCacheData.createFavoriteShareSessionCache({repository:{read:async name=>{
      __reviewPublicReads.push(name);return{ok:true,value:name==='PrivateTrainer'?null:projections[name]||null};
    }},validateProjection:publicSharePublicationDomain.publicShareProjectionStatus,projectSnapshot:favoritePokemonBrowseDomain.projectSnapshot});
    cache.activate({uid:auth.currentUser.uid,username:cur});ensureFavoriteShareSessionCache=()=>cache;
    const hour=3600000,day=24*hour;
    _eventData={fetchedAt:now,raids:[],events:[
      {eventID:'review-active',name:'Raid Hour',eventType:'raid',start:new Date(now-hour).toISOString(),end:new Date(now+hour).toISOString()},
      {eventID:'review-spotlight',name:'Pikachu Spotlight Hour',eventType:'pokemon-spotlight-hour',start:new Date(now+2*hour).toISOString(),end:new Date(now+3*hour).toISOString()},
      {eventID:'review-max',name:'Dynamax Bulbasaur during Max Monday',eventType:'max-mondays',start:new Date(now+6*hour).toISOString(),end:new Date(now+7*hour).toISOString()},
      {eventID:'review-community',name:'Eevee Community Day',eventType:'community-day',start:new Date(now+2*day).toISOString(),end:new Date(now+2*day+3*hour).toISOString()},
      {eventID:'review-raid',name:'Rayquaza Raid Day',eventType:'raid-day',start:new Date(now+4*day).toISOString(),end:new Date(now+4*day+3*hour).toISOString()}
    ]};_eventLoadState='ready';eventTypeFilter='all';eventCalendarDate='';eventCalendarAnchor=new Date(new Date(now).getFullYear(),new Date(now).getMonth(),1);
    document.documentElement.dataset.theme=theme;document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    document.getElementById('my-un').textContent=cur;document.getElementById('my-av').innerHTML=spriteImg(25,48,'', 'Pikachu');
    document.getElementById('top-un').textContent=cur;document.getElementById('account-menu-name').textContent=cur;
    document.getElementById('my-fc-wrap').textContent='1111 2222 3333';
    renderInterimProductLabels();switchTab('mylist',{render:false});renderMyList();setSyncStatus('online');
    window.__reviewDataBefore=JSON.stringify(allData);window.__reviewCopy='';
  },{now:REVIEW_NOW,theme,names:FAVORITES});
  await page.evaluate(()=>waitForMyListRender());
  await expect(page.locator('#combined-list .wants-row')).toHaveCount(99);
}

async function showReviewSurface(page,surface){
  await page.evaluate(async surface=>{
    if(_modalActiveId)closeModal(_modalActiveId,{route:false});
    if(surface==='my-list'||surface==='advanced'){
      switchTab('mylist');await waitForMyListRender();
      if(surface==='advanced')document.getElementById('wants-combine').open=true;
    }else if(['trainers','favorites','group','who-wants'].includes(surface)){
      switchTab('find');setTrainerDiscoveryMode(surface==='trainers'?'trainers':surface==='who-wants'?'pokemon':'favorites');
      await renderTrainerQuickLists();
      if(surface==='group')await openTrainerGroup(__reviewGroupIds.weekend);
    }else if(surface==='events'){switchTab('schedule');renderEventsOnly();}
    else if(surface==='more')switchTab('more');
    else if(surface==='settings'||surface==='settings-language'){
      switchTab('more');openSettingsPanel('account');
      if(surface==='settings-language')selectSettingsSection('language',{focus:false,updateHistory:false});
    }else if(surface==='share'){switchTab('mylist');openProductShare();}
    else if(surface==='editor'){switchTab('mylist');openCombinedEditor(combinedKey(combinedGroups()[0][0]));document.querySelector('#combined-editor-modal details').open=true;}
    else if(surface==='admin'){
      allData.users.Doomsday126={authUid:'synthetic-ui-review-owner',isOwner:true,isAdmin:true};
      allData.loginDirectory.Doomsday126={authReady:true};cur='Doomsday126';auth={currentUser:{uid:'synthetic-ui-review-owner'}};
      switchTab('admin');renderAdmin();setAdminSection('maintenance');
    }
    window.scrollTo(0,0);
  },surface);
  if(surface==='who-wants'){
    await page.locator('#favorite-browse-input').fill('Pikachu');
    await page.locator('#favorite-browse-input').press('Enter');
    await expect(page.locator('.favorite-browse-row').first()).toBeVisible();
  }
  if(surface==='advanced')await page.locator('#wants-combine').evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-130));
}

async function settleReview(page){
  await page.locator('img').evaluateAll(images=>images.forEach(image=>{if(image.getClientRects().length)image.loading='eager';}));
  await expect.poll(()=>page.locator('img').evaluateAll(images=>images.filter(image=>{
    const rect=image.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight;
  }).every(image=>image.complete)),{timeout:30000}).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#toast')).toBeHidden({timeout:8000});
}

async function installPublicReview(page,{theme='dark'}={}){
  await isolateReviewNetwork(page);
  const declarations=[
    {intent:'lf',category:'wishlist',name:'Pikachu',p:'H',shiny:true,gender:'f'},
    {intent:'lf',category:'wishlist',name:'Rayquaza',p:'H',shiny:true},
    {intent:'lf',category:'wishlist',name:'Snom',p:'H'},
    {intent:'lf',category:'wishlist',name:'Lucario',p:'M'},
    {intent:'lf',category:'wishlist',name:'Eevee',p:'M',gender:'f'},
    {intent:'lf',category:'wishlist',name:'Lapras',p:'L',lucky:true},
    {intent:'lf',category:'costumes',name:'Pikachu (Worlds 2025)',p:'H'}
  ].map(entry=>({mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...entry}));
  const projection={version:2,username:'Avery',profile:{friendCode:'1111 2222 3333',bio:'Weekend meetups. Shiny and regional wants.',avatarPokemon:'',lastUpdated:REVIEW_NOW-3600000},
    lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},publishedListTypes:['wishlist','dynamax','gmax','costumes'],declarations,declarationCount:declarations.length,updatedAt:REVIEW_NOW-3600000};
  const fulfill=body=>route=>route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body});
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',fulfill('export function initializeApp(){return {}}'));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js',fulfill('export class ReCaptchaEnterpriseProvider{};export function initializeAppCheck(){return {}};export async function getToken(){return {token:"synthetic-local-fixture"}}'));
  await page.route('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',fulfill(`const projection=${JSON.stringify(projection)};export function getDatabase(){return {}};export function ref(_,path){return {path}};export async function get(target){globalThis.__reviewPublicReads=(globalThis.__reviewPublicReads||[]).concat(target.path);return {exists:()=>true,val:()=>projection}}`));
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__reviewCopy=value;}}});
  },theme);
  await page.goto('./?view=Avery');
  await expect(page.locator('#share-view')).toBeVisible();
  await expect(page.locator('.share-pcard')).toHaveCount(6);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
}

module.exports={REVIEW_NOW,FAVORITES,installReviewFixture,showReviewSurface,settleReview,installPublicReview};
