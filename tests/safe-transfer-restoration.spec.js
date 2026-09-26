const {test,expect}=require('@playwright/test');
const {readFileSync}=require('node:fs');
const path=require('node:path');

const enabledApplication=readFileSync(path.join(__dirname,'../js/app/application.js'),'utf8');
if(!enabledApplication.includes('const SAFE_TRANSFER_GENERATION_ENABLED=true;'))throw new Error('Reviewed Safe-transfer release gate is not enabled');

const owner={uid:'safe-transfer-owner',username:'SafeTransferOwner'};

function declaration(name,category='wishlist',extra={}){
  return{intent:'lf',category,name,p:'',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false,...extra};
}
function projection(username,declarations=[]){
  return{version:2,username,profile:{friendCode:'',bio:'',discord:'',avatarPokemon:'',lastUpdated:0},publishedListTypes:['wishlist','dynamax','gmax','costumes'],lists:{wishlist:{},dynamax:{},gmax:{},costumes:{}},updatedAt:119,declarations,declarationCount:declarations.length};
}

async function bootCandidate(page){
  await page.route('**/sw.js*',route=>route.abort());
  await page.route('https://**/*',route=>route.abort());
  await page.addInitScript(()=>{
    localStorage.setItem('pogoTourSeen',JSON.stringify(Date.now()));
    localStorage.setItem('pogoWhatsNewSeen',JSON.stringify(Date.now()));
  });
  await page.goto(`./?safe-transfer-candidate=${Date.now()}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.__pogoEnsureFullApp==='function');
  await page.evaluate(()=>window.__pogoEnsureFullApp('safe-transfer-candidate-local-build'));
  await page.waitForFunction(()=>typeof openSettingsPanel==='function'&&window.__pogoStartup?.firebaseStartupSettledAt!==null);
}

async function establishFixture(page,{results,locale='en',group=true,deferred=false,clipboard='direct'}={}){
  await page.evaluate(({owner,results,locale,group,deferred,clipboard})=>{
    auth={currentUser:{uid:owner.uid,providerData:[{providerId:'password'}]}};currentAuthUid=owner.uid;cur=owner.username;_authStateKnown=true;
    document.getElementById('login-pg').style.display='none';document.getElementById('app').style.display='flex';
    trainerHistoryStore=null;const store=ensureTrainerHistoryStore();
    for(const username of Object.keys(results))store.saveFavoriteOrganization(username);
    if(group){
      const created=store.ensureTag('Raid group');
      for(const username of Object.keys(results))store.setFavoriteTags(username,[created.id]);
      trainerGroupState.id=created.id;
    }else trainerGroupState.id='';
    _safeTransferSelected=null;_safeTransferController=null;_safeTransferCandidateMount=null;_safeTransferLiveSourceVersions={};
    if(locale==='en'){lsRemove(POGO_SEARCH_LANGUAGE_KEY);lsRemove(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY);}else{lsSet(POGO_SEARCH_LANGUAGE_KEY,locale);lsSet(POGO_SEARCH_LANGUAGE_OVERRIDE_KEY,true);}
    window.__safeTransportReads=[];window.__safeDeferredReads=[];window.__safeResults=structuredClone(results);window.__safeDeferReads=deferred;
    const client={
      readServer(path,options={}){
        __safeTransportReads.push(path);const name=decodeURIComponent(path.split('/').pop()),result=structuredClone(__safeResults[name]);
        const withEvidence=value=>value?.ok?{...value,evidence:{kind:'server-confirmed-public-share',transport:'rtdb-rest',scope:'whole-projection',completed:true,operationId:options.operationId}}:value;
        if(!window.__safeDeferReads)return Promise.resolve(withEvidence(result));
        return new Promise((resolve,reject)=>__safeDeferredReads.push({path,resolve:()=>resolve(withEvidence(result)),reject}));
      },
      read(){throw new Error('Safe-transfer qualification must not use cache-capable reads');},
      listen(){throw new Error('Safe-transfer qualification must use exact reads');}
    };
    managedPublicShareRepository=publicShareRepositoryData.createPublicShareRepository(client);
    window.__safeDirectWrites=[];window.__safeFallbackWrites=[];window.__safeFallbackAttempts=0;
    Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{
      if(clipboard==='deferred')return new Promise((resolve,reject)=>{window.__safeClipboard={value,resolve,reject};});
      if(clipboard!=='direct')return Promise.reject(Object.assign(new Error('direct denied'),{code:'clipboard-direct-denied'}));
      __safeDirectWrites.push(value);return Promise.resolve();
    }}});
    document.execCommand=command=>{
      if(command==='copy')window.__safeFallbackAttempts++;
      if(command!=='copy'||clipboard==='fail'||clipboard==='deferred')return false;
      __safeFallbackWrites.push(document.activeElement?.value||'');return true;
    };
  },{owner,results,locale,group,deferred,clipboard});
}

async function openFromSettingsTools(page){
  await page.evaluate(()=>{openSettingsPanel('account');selectSettingsSection('tools');});
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.locator('#settings-transfer').click();
  await expect(page.locator('#safe-transfer-modal')).toBeVisible();
  // Discovery no longer silently selects Favorites. Establish this fixture's
  // intended complete group explicitly through the existing selection control.
  await page.locator('#safe-transfer-modal button[onclick="setAllSafeTransferTrainers(true)"]').click();
}

async function waitForPhase(page,phase){await expect(page.locator('#stb-candidate')).toHaveAttribute('data-phase',phase);}

test('actual Settings route refreshes exact group sources, resolves aliases, and revalidates visible and direct copy actions',async({page})=>{
  await bootCandidate(page);
  await establishFixture(page,{results:{
    Ada:{ok:true,value:projection('Ada',[declaration('Pikachu'),declaration('Mr. Mime')])},
    Bert:{ok:true,value:projection('Bert',[declaration('Eevee'),declaration('Lapras','gmax')])}
  }});
  await openFromSettingsTools(page);await waitForPhase(page,'ready');
  const ready=await page.evaluate(()=>{const plan=_safeTransferController.snapshot().plan;return{scope:plan.scope,binding:plan.binding,protectedSpecies:plan.protectedSpecies,commands:plan.commands.map(item=>item.value)};});
  expect(ready.scope.kind).toBe('group');expect(ready.scope.selected.map(item=>item.label)).toEqual(['Ada','Bert']);
  expect(ready.protectedSpecies).toEqual(expect.arrayContaining([25,122,131,133]));
  expect(ready.binding.gameLocale).toBe('en');
  expect(await page.evaluate(()=>__safeTransportReads)).toEqual(['publicShares/Ada','publicShares/Bert']);
  await page.locator('[data-safe-transfer-copy="0"]').click();await waitForPhase(page,'copied');
  expect(await page.evaluate(()=>__safeTransportReads)).toEqual(['publicShares/Ada','publicShares/Bert','publicShares/Ada','publicShares/Bert']);
  expect(await page.evaluate(()=>__safeDirectWrites.length)).toBe(1);
  const direct=await page.evaluate(()=>copySafeTransferString(0));expect(direct.status).toBe('copied');
  expect(await page.evaluate(()=>__safeTransportReads.length)).toBe(6);
});

test('actual repository path protects the exact five-want set',async({page})=>{
  await bootCandidate(page);
  await establishFixture(page,{results:{
    Ada:{ok:true,value:projection('Ada',[declaration('Bulbasaur'),declaration('Pikachu'),declaration('Eevee')])},
    Bert:{ok:true,value:projection('Bert',[declaration('Squirtle'),declaration('Lapras')])}
  }});
  await openFromSettingsTools(page);await waitForPhase(page,'ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.protectedSpecies)).toEqual([1,7,25,131,133]);
  expect(await page.evaluate(()=>__safeTransportReads)).toEqual(['publicShares/Ada','publicShares/Bert']);
});

test('actual repository/validator path distinguishes empty and every blocked source class',async({page})=>{
  await bootCandidate(page);
  const completeEmpty={ok:true,value:projection('Ada',[])};
  const partial=projection('Ada',[]);partial.declarationCount=1;
  const obsolete=projection('Ada',[]);obsolete.version=99;
  const cases={
    missing:{ok:true,value:null},inaccessible:{ok:false,error:{code:'permission-denied'}},stale:{ok:false,error:{code:'cache-obsolete'}},
    timeout:{ok:false,error:{code:'deadline-exceeded'}},error:{ok:false,error:{code:'network-unavailable'}},partial:{ok:true,value:partial},
    malformed:{ok:true,value:{version:2,username:'Ada',publishedListTypes:'bad'}},obsolete:{ok:true,value:obsolete}
  };
  await establishFixture(page,{results:{Ada:completeEmpty},group:false});await openFromSettingsTools(page);await waitForPhase(page,'ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.protectedSpecies.length)).toBe(0);
  for(const [state,result] of Object.entries(cases)){
    await page.evaluate(({state,result})=>{window.__safeResults={Ada:result};_safeTransferController.invalidate(`case-${state}`);renderSafeTransferOutput();},{state,result});
    await waitForPhase(page,'blocked');
    expect(await page.evaluate(()=>_safeTransferController.snapshot().error.code)).toBe(`${state}_source`);
  }
  const hidden=projection('Ada',[]);hidden.lists.wishlist.Pikachu={p:'H'};
  await page.evaluate(hidden=>{window.__safeResults={Ada:{ok:true,value:hidden}};_safeTransferController.invalidate('case-hidden');renderSafeTransferOutput();},hidden);
  await waitForPhase(page,'blocked');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().error.code)).toBe('partial_source');
});

test('actual language controls localize candidate UI while Pokémon GO command language remains independently selectable',async({page})=>{
  await bootCandidate(page);
  await establishFixture(page,{results:{Ada:{ok:true,value:projection('Ada',[declaration('Pikachu')])}},group:false});
  await openFromSettingsTools(page);await waitForPhase(page,'ready');
  await page.evaluate(()=>closeModal('safe-transfer-modal'));
  await page.evaluate(()=>openSettingsPanel('account'));
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.locator('[data-settings-target="language"]').click();
  await page.locator('#settings-language').selectOption('ja');
  await expect.poll(()=>page.evaluate(()=>i18nCore.getLocale())).toBe('ja');
  await page.locator('[data-settings-target="tools"]').click();await page.locator('#settings-transfer').click();await waitForPhase(page,'ready');
  await expect(page.locator('[data-safe-transfer-scope]')).toContainText('選択範囲');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.gameLocale)).toBe('ja');

  await page.evaluate(()=>closeModal('safe-transfer-modal'));
  await page.evaluate(()=>openSettingsPanel('account'));
  await expect(page.locator('#settings-modal')).toBeVisible();
  await page.locator('[data-settings-target="language"]').click();
  await page.locator('#settings-language').selectOption('es');await expect.poll(()=>page.evaluate(()=>i18nCore.getLocale())).toBe('es');
  await page.locator('#settings-search-language-override').check();await page.locator('#settings-search-language').selectOption('de');
  await page.locator('[data-settings-target="tools"]').click();await page.locator('#settings-transfer').click();await waitForPhase(page,'ready');
  await expect(page.locator('[data-safe-transfer-scope]')).toContainText('Ámbito seleccionado');
  const result=await page.evaluate(()=>{const plan=_safeTransferController.snapshot().plan;return{locale:plan.gameLocale,parts:plan.commands.map(item=>({value:item.value,species:item.species})),candidates:plan.candidateSpecies};});
  expect(result.locale).toBe('de');expect(result.parts.flatMap(item=>item.species)).toEqual(result.candidates);expect(result.parts.every(item=>item.value.length<=1500)).toBe(true);
});

test('shared clipboard fallback succeeds, while both-method failure preserves only the current manual command',async({page})=>{
  await bootCandidate(page);
  const results={Ada:{ok:true,value:projection('Ada',[declaration('Pikachu')])}};
  await establishFixture(page,{results,group:false,clipboard:'fallback'});await openFromSettingsTools(page);await waitForPhase(page,'ready');
  await expect(page.locator('[data-safe-transfer-command="0"]')).toBeDisabled();
  await page.locator('[data-safe-transfer-copy="0"]').click();await waitForPhase(page,'copied');
  expect(await page.evaluate(()=>__safeFallbackWrites.length)).toBe(1);
  await page.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));document.execCommand=()=>false;});
  await page.locator('[data-safe-transfer-copy="0"]').click();await waitForPhase(page,'copy_failed');
  await expect(page.locator('[data-safe-transfer-command="0"]')).toBeEnabled();
  const failed=await page.evaluate(()=>{const state=_safeTransferController.snapshot();return{manual:state.manualCommand,command:state.plan.commands[0].value,phase:state.phase};});
  expect(failed.manual).toBe(failed.command);expect(failed.phase).toBe('copy_failed');
});

for(const outcome of ['resolve','reject'])test(`deferred clipboard ${outcome} after modal close cannot republish stale state`,async({page})=>{
  await bootCandidate(page);
  await establishFixture(page,{results:{Ada:{ok:true,value:projection('Ada',[declaration('Pikachu')])}},group:false,clipboard:'deferred'});
  await openFromSettingsTools(page);await waitForPhase(page,'ready');
  await page.locator('[data-safe-transfer-copy="0"]').click();await page.waitForFunction(()=>window.__safeClipboard&&_safeTransferController.snapshot().phase==='copying');
  await page.evaluate(outcome=>{closeModal('safe-transfer-modal');if(outcome==='resolve')__safeClipboard.resolve();else __safeClipboard.reject(Object.assign(new Error('late failure'),{code:'clipboard-unavailable'}));},outcome);
  await page.waitForFunction(()=>_safeTransferController.snapshot().phase==='invalidated');
  expect(await page.evaluate(()=>({phase:_safeTransferController.snapshot().phase,manual:_safeTransferController.snapshot().manualCommand}))).toEqual({phase:'invalidated',manual:''});
  expect(await page.evaluate(()=>__safeFallbackAttempts)).toBe(0);
});

test('account and group changes suppress delayed repository results, and copy-time source change fails closed',async({page})=>{
  await bootCandidate(page);
  const first=projection('Ada',[declaration('Pikachu')]);
  await establishFixture(page,{results:{Ada:{ok:true,value:first}},group:false,deferred:true});await openFromSettingsTools(page);await waitForPhase(page,'loading');
  await page.evaluate(()=>{auth.currentUser.uid='other-owner';for(const pending of __safeDeferredReads.splice(0))pending.resolve();});
  await page.waitForFunction(()=>_safeTransferController.snapshot().phase==='invalidated');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().manualCommand)).toBe('');

  await page.evaluate(()=>closeModal('safe-transfer-modal'));
  await establishFixture(page,{results:{Ada:{ok:true,value:first},Bert:{ok:true,value:projection('Bert',[])}},group:true,deferred:true});await openFromSettingsTools(page);await waitForPhase(page,'loading');
  await page.evaluate(()=>toggleSafeTransferTrainer('bert'));
  await page.evaluate(()=>{for(const pending of __safeDeferredReads.splice(0))pending.resolve();});
  await waitForPhase(page,'ready');
  expect(await page.evaluate(()=>_safeTransferController.snapshot().plan.scope.selected.map(item=>item.label))).toEqual(['Ada']);

  await page.evaluate(()=>{window.__safeDeferReads=false;const eevee={intent:'lf',category:'wishlist',name:'Eevee',p:'',mod:'',gender:'',backgroundId:'',note:'',lucky:false,shiny:false,xxl:false,xxs:false};window.__safeResults.Ada={ok:true,value:{...window.__safeResults.Ada.value,declarations:[...window.__safeResults.Ada.value.declarations,eevee],declarationCount:2}};});
  const stale=await page.evaluate(()=>copySafeTransferString(0));expect(stale.status).toBe('stale');await waitForPhase(page,'invalidated');
  expect(await page.evaluate(()=>__safeDirectWrites)).toEqual([]);
});
