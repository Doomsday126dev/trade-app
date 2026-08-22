const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function between(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.notEqual(from,-1,`Missing ${start}`);
  assert.notEqual(to,-1,`Missing ${end}`);
  return source.slice(from,to);
}

function classList(seed=[]){
  const values=new Set(seed);
  return{add:(...items)=>items.forEach(item=>values.add(item)),remove:(...items)=>items.forEach(item=>values.delete(item)),contains:item=>values.has(item)};
}
function transientHarness(){
  let favoriteBrowseResets=0;
  let hydrationResets=0;
  const elements={
    'undo-toast':{id:'undo-toast',hidden:false,textContent:'',classList:classList(['show']),setAttribute(){}},
    'undo-msg':{textContent:'Removed Pidgey'},
    toast:{hidden:false,textContent:'Trainer A message',classList:classList(['show']),setAttribute(){}},
    'feedback-status':{textContent:'Removed Pidgey Undo'},
    'favorite-saved-prompt':{hidden:false,querySelector:()=>({onclick:()=>{}})},
    'shortcuts-modal':{id:'shortcuts-modal',classList:classList(['ov','open'])},
    'mylist-filter':{value:'private search'},
    'have-filter':{value:'private inventory search'},
    'add-tray':{hidden:false,innerHTML:'Pidgey'},
    'sync-banner':{hidden:false}
  };
  const conflictToast={id:'conflict',removed:false,remove(){this.removed=true;}};
  const selected={style:{transform:'translateX(10px)'},classList:classList(['bulk-selected'])};
  const checked={checked:true};
  const cleared=[];
  const context=vm.createContext({
    _sessionTransientGeneration:0,undoTimer:11,undoStack:{name:'Pidgey'},undoReturnFocus:{},_toastTimer:12,
    _feedbackAnnouncementTimer:13,_lastFeedbackAnnouncement:{message:'Removed Pidgey Undo',at:1},
    trainerSuggestionTimer:14,favoriteSavedPromptTimer:15,_modalFocusTimer:16,_myHaveRenderTimer:17,_haveBrowseRenderTimer:18,
    clearTimeout:id=>cleared.push(id),
    document:{
      getElementById:id=>elements[id]||null,
      querySelectorAll:selector=>({
        '.ov.open':[elements['shortcuts-modal']],
        '.undo-toast':[elements['undo-toast'],conflictToast],
        '.bulk-selected,.swiping,.swipe-action,.swipe-action-select':[selected],
        '.bulk-check:checked,.have-bulk-check:checked':[checked]
      }[selector]||[]),
      removeEventListener(){},body:{classList:classList(['bulk-mode','have-bulk-mode'])}
    },
    _modalKeyHandler:()=>{},_modalPrevFocus:{},rpinTarget:'TrainerA',addTray:[{name:'Pidgey'}],
    acItems:[1],acFiltered:[1],acFocusIdx:1,haveAcItems:[1],haveAcFiltered:[1],haveAcFocusIdx:1,
    dragSrc:{},bulkMode:true,bulkSelected:new Set(['Pidgey']),haveBulkMode:true,haveBulkSelected:new Set(['Pidgey']),
    _safeTransferSelected:new Set(['TrainerB']),_qaSelected:{lf:new Set(['Pidgey']),ft:new Set()},
    _activeDiff:{username:'TrainerB'},_activeTradeMatch:{username:'TrainerB'},_swipeState:{},_ptrState:{},
    voiceRecognition:{aborted:false,abort(){this.aborted=true;}},resetTrainerOrganizerState(){},
    resetOwnedHydrationState(){hydrationResets++;},
    resetFavoriteBrowseSession(){favoriteBrowseResets++;},trainerHistoryStore:{owner:'uid-a'},
    closeAddAutocomplete(){},
    managedSessionCache:{snapshot:()=>({activeOwner:{uid:'uid-a',username:'TrainerA'}})}
  });
  vm.runInContext(between('function sessionTransientCallback','function activateOwnedSession'),context);
  return{context,elements,conflictToast,selected,checked,cleared,
    favoriteBrowseResets:()=>favoriteBrowseResets,hydrationResets:()=>hydrationResets};
}

test('logout clears session transient state before listeners, cache, identity, and Firebase sign-out',()=>{
  const block=between('function logout(){','// ── NAV');
  const transient=block.indexOf("resetSessionTransientUi('logout');");
  const listeners=block.indexOf("managedListenerLifecycle.deactivateSession('logout');");
  const cache=block.indexOf('clearOwnedSession();');
  const identity=block.indexOf('cur=null;');
  const signOut=block.indexOf('firebaseSignOut(auth).catch(()=>{});');
  assert.ok(transient>=0&&transient<listeners);
  assert.ok(listeners<cache&&cache<identity&&identity<signOut);
});

test('transient cleanup cancels undo and toast timers and removes their messages and actions',()=>{
  const block=between("function resetSessionTransientUi(reason='session_boundary'){",'function resetTransientUiBeforeSessionActivation');
  for(const required of [
    'clearTimeout(undoTimer)','undoTimer=null','undoStack=null','clearTimeout(_toastTimer)','_toastTimer=null',
    "undoMessage.textContent=''","toastEl.textContent=''","undoToast.hidden=true","toastEl.hidden=true"
  ])assert.ok(block.includes(required),`Missing transient reset: ${required}`);
});

test('User A to User B clears account-owned transient UI before activating the new owner',()=>{
  const activation=between('function resetTransientUiBeforeSessionActivation','function activateOwnedSession');
  assert.match(activation,/activeOwner/);
  assert.match(activation,/owner\.uid===uid&&owner\.username===username/);
  assert.match(activation,/resetSessionTransientUi\('identity_switch'\)/);
  assert.match(activation,/resetFavoriteBrowseSession\(\)/);
  assert.match(activation,/trainerHistoryStore=null/);
  const activate=between('function activateOwnedSession','function storedSessionMatches');
  assert.ok(activate.indexOf('resetTransientUiBeforeSessionActivation(uid,username);')<activate.indexOf('managedSessionCache.activate'));
});

test('same-user activation and normal navigation do not clear valid transient state',()=>{
  const activation=between('function resetTransientUiBeforeSessionActivation','function activateOwnedSession');
  assert.match(activation,/if\(!owner\|\|owner\.uid===uid&&owner\.username===username\)return false/);
  const switcher=between('function switchTab','function refreshAll');
  assert.doesNotMatch(switcher,/resetSessionTransientUi/);
});

test('auth loss clears transient UI before protected listeners and cache are suspended',()=>{
  const observer=between('function bindAuthObserver(){','function waitForAuthState');
  const transient=observer.indexOf("resetSessionTransientUi('auth_loss');");
  const listeners=observer.indexOf("managedListenerLifecycle.deactivateSession('auth_loss');");
  const cache=observer.indexOf("suspendOwnedSession('auth_loss');");
  assert.ok(transient>=0&&transient<listeners&&listeners<cache);
});

test('delayed removal and swipe callbacks are invalidated while conflict UI is removed at a session boundary',()=>{
  const callback=between('function sessionTransientCallback','function resetSessionTransientUi');
  const cleanup=between("function resetSessionTransientUi(reason='session_boundary'){",'function resetTransientUiBeforeSessionActivation');
  const conflict=between('function showConflictModal','// ── IMPORT FROM SEARCH STRING');
  assert.match(callback,/generation!==_sessionTransientGeneration/);
  assert.match(source,/setTimeout\(sessionTransientCallback\(\(\)=>\{\s*if\(writeListItem\([^)]*\)\)\{\s*undoStack=pendingUndo;\s*showUndo/);
  assert.match(source,/else row\.classList\.remove\('removing'\)/);
  assert.match(source,/setTimeout\(sessionTransientCallback\(\(\)=>\{const n=row\.dataset\.name/);
  assert.match(cleanup,/querySelectorAll\('\.conflict-notice'\).*el=>el\.remove\(\)/);
  assert.doesNotMatch(conflict,/setTimeout|sessionTransientCallback/);
});

test('session cleanup resets modal, selection, filter, queue, and pending comparison state',()=>{
  const block=between("function resetSessionTransientUi(reason='session_boundary'){",'function resetTransientUiBeforeSessionActivation');
  for(const required of [
    "document.querySelectorAll('.ov.open')",'bulkSelected.clear()','haveBulkSelected.clear()',
    'addTray=[]','rpinTarget=null','_activeDiff=null','_activeTradeMatch=null',
    "'mylist-filter'","'have-filter'",'_safeTransferSelected=null','voiceRecognition.abort()'
  ])assert.ok(block.includes(required),`Missing transient reset: ${required}`);
});

test('Firebase sign-out failure cannot restore cleared transient state',()=>{
  const block=between('function logout(){','// ── NAV');
  assert.match(block,/resetSessionTransientUi\('logout'\)/);
  assert.match(block,/firebaseSignOut\(auth\)\.catch\(\(\)=>\{\}\)/);
  assert.doesNotMatch(block,/catch\([^)]*\).*undoStack|catch\([^)]*\).*toast/s);
});

test('runtime cleanup removes User A undo, toast, modal, selection, and queued UI state',()=>{
  const h=transientHarness();
  const result=vm.runInContext("resetSessionTransientUi('logout')",h.context);
  assert.equal(result.ok,true);
  assert.deepEqual(h.cleared,[14,15,16,17,18,11,12,13]);
  assert.equal(h.elements['undo-msg'].textContent,'');
  assert.equal(h.elements['undo-toast'].hidden,true);
  assert.equal(h.elements.toast.textContent,'');
  assert.equal(h.elements.toast.hidden,true);
  assert.equal(h.elements['feedback-status'].textContent,'');
  assert.equal(h.elements['favorite-saved-prompt'].hidden,true);
  assert.equal(h.elements['shortcuts-modal'].classList.contains('open'),false);
  assert.equal(h.conflictToast.removed,true);
  assert.equal(h.selected.classList.contains('bulk-selected'),false);
  assert.equal(h.checked.checked,false);
  assert.equal(vm.runInContext('undoStack',h.context),null);
  assert.equal(vm.runInContext('addTray.length',h.context),0);
  assert.equal(vm.runInContext('bulkSelected.size',h.context),0);
  assert.equal(h.hydrationResets(),1);
});

test('runtime generation guard suppresses callbacks captured before cleanup',()=>{
  const h=transientHarness();
  vm.runInContext('var callbackRan=false; var pending=sessionTransientCallback(()=>{callbackRan=true;});',h.context);
  vm.runInContext("resetSessionTransientUi('logout'); pending();",h.context);
  assert.equal(vm.runInContext('callbackRan',h.context),false);
});

test('listener and timer lifecycle stays centralized across rerenders and account boundaries',()=>{
  const cleanup=between("function resetSessionTransientUi(reason='session_boundary'){",'function resetTransientUiBeforeSessionActivation');
  for(const timer of ['trainerSuggestionTimer','favoriteSavedPromptTimer','_modalFocusTimer','_myHaveRenderTimer','_haveBrowseRenderTimer'])assert.match(cleanup,new RegExp(`clearTimeout\\(${timer}\\)`));
  const favoritesRender=between('async function renderTrainerQuickLists','function toggleTrainerFavorite');
  assert.doesNotMatch(favoritesRender,/addEventListener\(/);
  assert.equal((source.match(/getElementById\('favorite-trainers-list'\)\?\.addEventListener\('click'/g)||[]).length,1);
  assert.equal((source.match(/window\.addEventListener\('popstate',syncSettingsRoute\)/g)||[]).length,1);
  assert.match(source,/setTimeout\(sessionTransientCallback\(\(\)=>renderPendingRequests\(\)\),4000\)/);
});

test('runtime activation guard preserves same-user state and clears different-user state',()=>{
  const same=transientHarness();
  assert.equal(vm.runInContext("resetTransientUiBeforeSessionActivation('uid-a','TrainerA')",same.context),false);
  assert.equal(same.elements['undo-msg'].textContent,'Removed Pidgey');

  const switched=transientHarness();
  assert.equal(vm.runInContext("resetTransientUiBeforeSessionActivation('uid-b','TrainerB')",switched.context),true);
  assert.equal(switched.elements['undo-msg'].textContent,'');
  assert.equal(switched.elements.toast.textContent,'');
  assert.equal(switched.favoriteBrowseResets(),1);
  assert.equal(vm.runInContext('trainerHistoryStore',switched.context),null);
});
