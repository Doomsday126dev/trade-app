const {test,expect:baseExpect}=require('@playwright/test');
const {fixture}=require('./helpers/usability-fixture.cjs');
const expect=baseExpect.configure({timeout:1800});
test.use({serviceWorkers:'block'});test.setTimeout(25000);
async function profile(page){await fixture(page);await page.evaluate(()=>{updateFcDisplay();openAccountSettingsSection('profile');window.__publications=0;requestPublicSharePublication=()=>{window.__publications=(window.__publications||0)+1;};});}
async function owner(page){await fixture(page);await page.evaluate(()=>{const uid='synthetic-owner-uid';cur=OWNER;auth={currentUser:{uid}};allData.users[OWNER]={authUid:uid,isAdmin:true,isOwner:true};allData.users.ReviewMember={authUid:'synthetic-member-uid',isAdmin:false};db=null;fbOn=false;});}

test('More Profile opens Profile rather than the last settings destination',async({page})=>{
 await fixture(page);await page.evaluate(()=>{openAccountSettingsSection('data');closeModal('settings-modal',{route:false});history.replaceState({},'',location.pathname);switchTab('more');});
 await page.locator('#tab-more button').filter({hasText:'Profile'}).click();await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();await expect(page).toHaveURL(/#settings\/profile$/);
});
test('real legacy profile writer refuses a replacement account after its readiness await',async({page})=>{
 await fixture(page);const result=await page.evaluate(async()=>{
  let writes=0;getLocal=()=>normalizeData({users:{NewSession:{authUid:'new-session-uid'}}});saveLocal=()=>{writes++;return true;};
  accountSyncPreserveLegacyBoard=()=>new Promise(resolve=>{window.__releaseProfileGuard=resolve;});
  const pending=writeUser(cur,{bio:'Earlier owner draft'});cur='NewSession';auth={currentUser:{uid:'new-session-uid'}};__releaseProfileGuard(false);await pending;return writes;
 });expect(result).toBe(0);
});
test('Profile errors retain the draft and never announce saved',async({page})=>{
 await profile(page);await page.evaluate(()=>{writeUser=async()=>{throw new Error('isolated write rejection');};});await page.locator('#prof-bio').fill('Keep this draft');await page.locator('#profile-save').click();
 await expect(page.locator('#profile-err')).toContainText(/could not|not confirmed|couldn't/i);await expect(page.locator('#prof-bio')).toHaveValue('Keep this draft');await expect(page.locator('#profile-save')).toBeEnabled();
 expect(await page.evaluate(()=>window.__publications||0)).toBe(0);
});
test('a newer Profile draft survives completion of an earlier queued save',async({page})=>{
 await profile(page);await page.evaluate(()=>{writeUser=(_u,data)=>new Promise(resolve=>{allData.users[cur]={...allData.users[cur],...data};window.__finishProfile=resolve;});});
 await page.locator('#prof-bio').fill('First draft');await page.locator('#profile-save').click();await page.locator('#prof-bio').fill('Second draft');await page.evaluate(()=>__finishProfile({ok:true,delivery:'queued'}));
 await expect(page.locator('#prof-bio')).toHaveValue('Second draft');await expect(page.locator('#profile-save')).toBeEnabled();await expect(page.locator('#profile-err')).toContainText('Unsaved');
});
test('old Profile completion cannot publish or reset a different session',async({page})=>{
 await profile(page);await page.evaluate(()=>{writeUser=()=>new Promise(resolve=>{window.__finishProfile=resolve;});});await page.locator('#prof-bio').fill('Earlier draft');await page.locator('#profile-save').click();
 await page.evaluate(()=>{cur='NewSession';auth={currentUser:{uid:'new-session-uid'}};__finishProfile({ok:true,delivery:'queued'});});await page.waitForTimeout(50);expect(await page.evaluate(()=>window.__publications||0)).toBe(0);
});
test('PIN password acknowledgement cannot write metadata for a new account',async({page})=>{
 await profile(page);await page.evaluate(()=>{allData.users[cur].pin='synthetic-legacy-proof';allData.users[cur].authUid=auth.currentUser.uid;auth.currentUser.providerData=[{providerId:'password'}];selectSettingsSection('security');renderConnectedAccounts();window.__pinWrites=[];updatePassword=()=>new Promise(resolve=>{window.__finishPassword=resolve;});hashPin=async()=> 'synthetic-hash';writeUser=async username=>{__pinWrites.push(username);};const save=savePinSettings;savePinSettings=(...args)=>window.__pinTask=save(...args);});
 expect(await page.evaluate(()=>usernamePinAccessUsable())).toBe(true);await expect(page.locator('#settings-security-pin-panel')).toBeVisible();
 await page.locator('#np1').fill('654321');await page.locator('#np2').fill('654321');await page.locator('[onclick="savePinSettings()"]').click();
 await page.evaluate(()=>{firebaseSignOut=async()=>{};logout();auth={currentUser:{uid:'new-session-uid'}};cur='NewSession';activateOwnedSession('new-session-uid','NewSession');allData=normalizeData({users:{NewSession:{authUid:'new-session-uid'}}});__finishPassword();});await page.evaluate(()=>__pinTask);expect(await page.evaluate(()=>__pinWrites)).toEqual([]);
});
test('appearance compatibility save cannot apply stale UI to another account',async({page})=>{
 await fixture(page);const result=await page.evaluate(async()=>{window.__wallpaperCalls=0;writeUser=()=>new Promise(resolve=>{window.__finishAppearance=resolve;});applyWallpaperForTheme=()=>__wallpaperCalls++;const pending=saveAppearance();cur='NewSession';auth={currentUser:{uid:'new-session-uid'}};__finishAppearance({ok:true,delivery:'queued'});await pending;return __wallpaperCalls;});expect(result).toBe(0);
});
test('failed admin denial keeps the request pending and reports unconfirmed delivery',async({page})=>{
 await owner(page);await page.evaluate(()=>{fbOn=true;db={};ref=(_db,path)=>path;window.__requestCache=normalizeData(allData);__requestCache.requests={req_1_a:{username:'SyntheticApplicant',status:'pending'}};allData=structuredClone(__requestCache);getLocal=()=>structuredClone(__requestCache);saveLocal=data=>{__requestCache=structuredClone(data);return true;};update=async()=>{throw new Error('isolated denial rejection');};});
 await page.evaluate(()=>denyRequest('req_1_a'));expect(await page.evaluate(()=>__requestCache.requests.req_1_a.status)).toBe('pending');await expect(page.locator('#toast')).not.toContainText('denied');
});
test('admin role feedback waits for the local queue result and handles rejection',async({page})=>{
 await owner(page);await page.evaluate(()=>{fbOn=true;db={};writeUser=async()=>{throw new Error('isolated role rejection');};});await page.evaluate(()=>toggleAdmin('ReviewMember',true));await expect(page.locator('#toast')).not.toContainText('now an admin');await expect(page.locator('#toast')).toContainText(/could not|not confirmed|couldn't/i);
});
test('Admin gate remains owner-and-UID bound and all five sections navigate',async({page})=>{
 await fixture(page);expect(await page.evaluate(()=>{allData.users[cur].isAdmin=true;switchTab('admin');return protectedOwnerSession();})).toBe(false);await expect(page.locator('#tab-admin')).toBeHidden();
 await page.evaluate(()=>{cur=OWNER;allData.users[OWNER]={authUid:'expected-owner-uid',isOwner:true,isAdmin:true};auth={currentUser:{uid:'different-uid'}};switchTab('admin');});await expect(page.locator('#tab-admin')).toBeHidden();
 await page.evaluate(()=>{auth={currentUser:{uid:'expected-owner-uid'}};switchTab('admin');});await expect(page.locator('#tab-admin')).toBeVisible();
 for(const section of ['overview','members','access','maintenance','diagnostics']){await page.locator(`[data-admin-target="${section}"]`).click();await expect(page.locator(`[data-admin-section="${section}"]`)).toBeVisible();}
});
test('public Settings exposes only language and legal dialog returns focus',async({page})=>{
 await fixture(page);await page.evaluate(()=>{cur='';openSettingsPanel('public');});await expect(page.locator('[data-settings-section="language"]')).toBeVisible();await expect(page.locator('[data-settings-section="security"]')).toBeHidden();await expect(page.locator('[data-settings-section="profile"]')).toBeHidden();
 await page.evaluate(()=>{closeModal('settings-modal',{route:false});history.replaceState({},'',location.pathname);});await page.locator('#app-legal-footer button').click();await expect(page.locator('#legal-dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#legal-dialog')).toBeHidden();await expect(page.locator('#app-legal-footer button')).toBeFocused();
});

test('PIN A-to-B-to-A logout and activation cannot revive the earlier completion',async({page})=>{
 await profile(page);await page.evaluate(()=>{allData.users[cur].pin='synthetic-legacy-proof';allData.users[cur].authUid=auth.currentUser.uid;auth.currentUser.providerData=[{providerId:'password'}];selectSettingsSection('security');renderConnectedAccounts();window.__pinWrites=[];updatePassword=()=>new Promise(resolve=>{window.__finishPassword=resolve;});hashPin=async()=> 'synthetic-hash';writeUser=async username=>{__pinWrites.push(username);};const save=savePinSettings;savePinSettings=(...args)=>window.__pinTask=save(...args);});
 expect(await page.evaluate(()=>usernamePinAccessUsable())).toBe(true);await expect(page.locator('#settings-security-pin-panel')).toBeVisible();
 await page.locator('#np1').fill('654321');await page.locator('#np2').fill('654321');await page.locator('[onclick="savePinSettings()"]').click();
 await page.evaluate(()=>{const user=auth.currentUser,name=cur,data=structuredClone(allData);firebaseSignOut=async()=>{};logout();auth={currentUser:{uid:'middle-uid'}};cur='MiddleSession';activateOwnedSession('middle-uid',cur);logout();auth={currentUser:user};cur=name;activateOwnedSession(user.uid,name);allData=data;__finishPassword();});await page.evaluate(()=>__pinTask);expect(await page.evaluate(()=>__pinWrites)).toEqual([]);
});
for(const outcome of ['resolve','reject'])test(`delayed request denial ${outcome} cannot restore an earlier account`,async({page})=>{
 await owner(page);await page.evaluate(()=>{fbOn=true;db={};ref=(_db,path)=>path;window.__requestCache=normalizeData(allData);__requestCache.requests={req_1_a:{username:'SyntheticApplicant',status:'pending'}};allData=structuredClone(__requestCache);getLocal=()=>structuredClone(__requestCache);saveLocal=data=>{__requestCache=structuredClone(data);return true;};update=()=>new Promise((resolve,reject)=>{window.__finishDenial=resolve;window.__failDenial=reject;});window.__denyTask=denyRequest('req_1_a');});
 await page.evaluate(outcome=>{firebaseSignOut=async()=>{};logout();auth={currentUser:{uid:'new-session-uid'}};cur='NewSession';activateOwnedSession('new-session-uid',cur);allData=normalizeData({users:{NewSession:{authUid:'new-session-uid'}}});if(outcome==='resolve')__finishDenial();else __failDenial(new Error('isolated rejection'));},outcome);await page.evaluate(()=>__denyTask);expect(await page.evaluate(()=>Object.keys(allData.users))).toEqual(['NewSession']);
});

test('Events minute ticks preserve mobile disclosures, calendar focus and detail return focus',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.evaluate(()=>{_eventData={events:[{eventID:'synthetic-clock',name:'Synthetic Community Day',eventType:'community-day',start:'2026-10-25T14:00:00',end:'2026-10-25T17:00:00',extraData:{communityday:{bonuses:[{text:'Synthetic bonus'}]}}}],raids:[],fetchedAt:Date.now()};_eventLoadState='ready';eventCalendarDate='';switchTab('schedule');renderEventsOnly();});
 await expect(page.locator('.events-credits')).toContainText('ScrapedDuck');await page.locator('[data-event-disclosure="mobile-calendar"] > summary').click();const next=page.locator('.event-calendar-mobile [data-event-month-delta="1"]');await next.focus();
 await page.clock.fastForward(60001);await expect(page.locator('.events-credits')).toContainText('LeekDuck');await expect(page.locator('[data-event-disclosure="mobile-calendar"]')).toHaveAttribute('open','');await expect(next).toBeFocused();
 await page.locator('.event-card [data-event-action="details"]').click();await page.clock.fastForward(60001);await expect(page.locator('#event-detail-modal')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.event-card [data-event-action="details"]')).toBeFocused();
 await page.evaluate(()=>jumpToEvent('synthetic-clock'));await expect(page.locator('.event-card [data-event-action="details"]')).toBeFocused();
});

test('organizer readiness cannot copy A memberships into B',async({page})=>{
 await fixture(page);const result=await page.evaluate(async()=>{
  const favorites={TrainerA:{tagIds:['group-a']},TrainerB:{tagIds:['group-b']}};const writes=[];
  ensureTrainerHistoryStore=()=>({favoriteFor:name=>favorites[name],setFavoriteTags:(name,ids)=>{writes.push({name,ids});favorites[name].tagIds=ids;return{ok:true};}});
  trainerOrganizerState.username='TrainerA';queueFavoriteTags=()=>new Promise(resolve=>{window.__finishOrganizer=resolve;});
  const pending=toggleTrainerOrganizerTag('group-extra');trainerOrganizerGeneration++;trainerOrganizerState.username='TrainerB';__finishOrganizer(null);await pending;
  return{writes,b:favorites.TrainerB.tagIds};
 });expect(result).toEqual({writes:[],b:['group-b']});
});
test('group creation does not consume a replacement organizer draft after readiness',async({page})=>{
 await fixture(page);const result=await page.evaluate(async()=>{
  const writes=[];ensureTrainerHistoryStore=()=>({ensureTag:label=>{writes.push(label);return{ok:true,id:'new-group'};}});
  trainerOrganizerState.username='TrainerA';document.getElementById('organizer-new-tag').value='A draft';accountSyncMutationAuthority=()=>new Promise(resolve=>{window.__finishAuthority=resolve;});
  const pending=createLocalTrainerTag();trainerOrganizerGeneration++;trainerOrganizerState.username='TrainerB';document.getElementById('organizer-new-tag').value='B draft';__finishAuthority({mode:'legacy'});await pending;
  return{writes,draft:document.getElementById('organizer-new-tag').value};
 });expect(result).toEqual({writes:[],draft:'B draft'});
});

test('Favorites filters, group management and canceling removal preserve membership and checked baselines',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const store=ensureTrainerHistoryStore();for(const name of ['ReviewTrainerA','ReviewTrainerB'])if(!store.isFavorite(name))store.toggleFavorite(name);const group=store.ensureTag('Raid friends');window.__groupId=group.id;store.setFavoriteTags('ReviewTrainerA',[group.id]);window.__favoritesBefore=store.read();switchTab('find');setTrainerDiscoveryMode('favorites');renderTrainerQuickLists();});
 await expect(page.locator('[data-favorite-action="manage-groups"]')).toBeVisible();await page.locator('#favorite-trainer-search').fill('ReviewTrainerA');await expect(page.locator('#favorite-trainers-list [data-trainer]')).toHaveCount(1);await page.locator('#favorite-trainer-search-clear').click();await expect(page.locator('#favorite-trainers-list [data-trainer]')).toHaveCount(2);
 const group=await page.evaluate(()=>__groupId);await page.locator(`[data-favorite-tag-id="${group}"]`).click();await expect(page.locator('#favorite-trainers-list [data-trainer]')).toHaveCount(1);await page.locator('[data-favorite-action="clear-groups"]').click();await page.locator('[data-favorite-action="manage-groups"]').click();await expect(page.locator('.favorite-groups-disclosure')).toHaveAttribute('open','');
 await page.evaluate(()=>{confirm=()=>false;});const card=page.locator('#favorite-trainers-list [data-trainer="ReviewTrainerA"]');await card.locator('[data-favorite-action="toggle-menu"]').last().click();await card.locator('[data-trainer-action="remove"]').click();
 const state=await page.evaluate(()=>({before:__favoritesBefore,after:ensureTrainerHistoryStore().read()}));expect(state.after.favorites).toEqual(state.before.favorites);expect(state.after.snapshots).toEqual(state.before.snapshots);
});
test('Settings tool dispatch cannot open a private tool after logout',async({page})=>{
 await fixture(page);const opened=await page.evaluate(()=>{const schedule=setTimeout;let callback;setTimeout=fn=>{callback=fn;return 1;};openSettingsTool('import');setTimeout=schedule;cur='';auth={currentUser:null};let calls=0;openImport=()=>calls++;callback();return calls;});expect(opened).toBe(0);
});
for(const action of ['add','remove','rename','delete'])test(`Favorite ${action} readiness is fenced before a new account can inherit the action`,async({page})=>{
 await fixture(page);const calls=await page.evaluate(async action=>{
  window.PogoDomain.favoriteCapabilities={resolverEnabled:false};let calls=0;const favorite={targetUid:'synthetic-target',tagIds:[]};ensureTrainerHistoryStore=()=>({isFavorite:()=>action==='remove',favoriteFor:()=>favorite,read:()=>({tags:{tag_test:{label:'Test'}}}),saveFavoriteOrganization:()=>{calls++;return{ok:true};},renameTag:()=>{calls++;return{ok:true};},deleteTag:()=>{calls++;return{ok:true};}});
  accountSyncMutationAuthority=()=>new Promise(resolve=>{window.__finishFavoriteAuthority=resolve;});accountSyncAuthorityCurrent=()=>true;confirm=()=>true;
  const pending=action==='add'?toggleTrainerFavorite('ReviewTrainerA'):action==='remove'?removeTrainerFavorite('ReviewTrainerA'):action==='rename'?renameLocalTrainerTag('tag_test'):deleteLocalTrainerTag('tag_test');
  cur='Replacement';auth={currentUser:{uid:'replacement-uid'}};__finishFavoriteAuthority({mode:'canonical',controller:{addEntity:()=>{calls++;return{ok:true};},patchEntity:()=>{calls++;return{ok:true};},deleteEntity:()=>{calls++;return{ok:true};}}});await pending;return calls;
 },action);expect(calls).toBe(0);
});

test('Find Trainer distinguishes failed directory reads from not found and recovers on retry',async({page})=>{
 await fixture(page);await page.evaluate(()=>{switchTab('find');setTrainerDiscoveryMode('trainers');providerTrainerDirectorySession=()=> 'synthetic-directory-session';loadProviderTrainerDirectoryQuery=async()=>{throw new Error('isolated directory outage');};});
 await page.locator('#find-trainer-input').fill('UnlistedSynthetic');await expect(page.locator('#find-trainer-retry')).toBeVisible();await expect(page.locator('#find-trainer-status')).toContainText(/try|could|unavailable|error/i);
 await page.evaluate(()=>{loadProviderTrainerDirectoryQuery=async()=>{};});await page.locator('#find-trainer-retry').click();await expect(page.locator('#find-trainer-status')).toContainText(/no|match/i);await expect(page.locator('#find-trainer-retry')).toBeHidden();await page.locator('#find-trainer-clear').click();await expect(page.locator('#find-trainer-input')).toHaveValue('');await expect(page.locator('#find-trainer-input')).toBeFocused();await expect(page.locator('#find-trainer-recovery')).toBeHidden();
});

test('accepted Profile avatar changes and clearing refresh all identity chrome',async({page})=>{
 await profile(page);await page.evaluate(()=>{avatarEntryForName=name=>name?{name,no:25,catalogId:'synthetic'}:null;_avatarImgHtml=()=>'<span data-synthetic-avatar>Avatar</span>';writeUser=(username,data)=>new Promise(resolve=>{window.__finishAvatar=()=>{allData.users[username]={...allData.users[username],...data};resolve({ok:true,delivery:'queued'});};});});
 for(const value of ['Synthetic avatar','']){
  await page.evaluate(value=>{document.getElementById('prof-av-input').value=value;syncProfileDirtyState();},value);await page.locator('#profile-save').click();await page.evaluate(()=>__finishAvatar());
  for(const id of ['top-av','my-av','account-menu-av','settings-account-av'])if(value)await expect(page.locator(`#${id} [data-synthetic-avatar]`)).toHaveCount(1);else await expect(page.locator(`#${id}`)).toHaveText('TR');
 }
});

test('Settings utilities open the intended tools and ordinary accounts cannot export an admin backup',async({page})=>{
 await fixture(page);
 for(const [tool,modal]of [['import','import-modal'],['export','product-share-modal'],['safe-transfer','safe-transfer-modal'],['shortcuts','shortcuts-modal']]){
  await page.evaluate(()=>openAccountSettingsSection('tools'));await page.locator(`[onclick="openSettingsTool('${tool}')"]`).click();await expect(page.locator(`#${modal}`)).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator(`#${modal}`)).toBeHidden();
 }
 await page.evaluate(()=>openAccountSettingsSection('tools'));await expect(page.locator('[onclick="openSettingsTool(\'backup\')"]')).toBeHidden();expect(await page.evaluate(()=>exportData())).toBe(false);
 await page.evaluate(()=>openAccountSettingsSection('data'));await expect(page.locator('[data-settings-section="data"]')).toBeVisible();await expect(page.locator('#trainer-sync-local-status')).toBeVisible();await expect(page.locator('#settings-release-id')).toContainText('2026-');
});
