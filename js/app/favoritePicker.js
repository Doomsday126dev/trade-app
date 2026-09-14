'use strict';
let favoritePickerSession=null;
const favoritePickerText=(key,values)=>i18nCore.t('favoritePicker.'+key,values);
function installFavoritePickerButton(){
  if(window.PogoDomain?.favoriteCapabilities?.resolverEnabled!==true||window.PogoDomain?.favoriteCapabilities?.pickerEnabled!==true||!managedFavoriteAdditions)return;
  const host=document.getElementById('favorite-trainers-controls');if(!host||host.querySelector('[data-add-trainers]'))return;
  const button=document.createElement('button');button.type='button';button.className='btn btn-secondary favorite-picker-open';button.dataset.addTrainers='';button.textContent=favoritePickerText('open');button.addEventListener('click',()=>openFavoritePicker(button));host.prepend(button);
}
function favoritePickerCurrent(session){return session===favoritePickerSession&&session.runtime===managedAccountSyncRuntime&&session.additions===managedFavoriteAdditions&&session.uid===auth?.currentUser?.uid;}
async function openFavoritePicker(returnFocus){
  if(window.PogoDomain?.favoriteCapabilities?.pickerEnabled!==true||!managedFavoriteAdditions)return;
  closeFavoritePicker();
  const dialog=document.createElement('dialog');dialog.id='favorite-picker';dialog.className='favorite-picker';dialog.setAttribute('aria-labelledby','favorite-picker-title');dialog.setAttribute('aria-describedby','favorite-picker-description');
  const t=(key,values)=>escHtml(favoritePickerText(key,values));
  dialog.innerHTML=`<header><div><h2 id="favorite-picker-title">${t('title')}</h2><p id="favorite-picker-description">${t('description')}</p></div><button type="button" class="btn btn-ghost" data-picker-close>${t('cancel')}</button></header><div class="favorite-picker-tools"><label for="favorite-picker-search">${t('search')}</label><input id="favorite-picker-search" type="search" autocomplete="off" placeholder="${escAttr(favoritePickerText('searchHint'))}"><div class="favorite-picker-selection"><button type="button" data-picker-all></button><button type="button" data-picker-clear>${t('clear')}</button></div><p data-picker-capacity></p></div><div class="favorite-picker-rows" data-picker-rows></div><nav class="favorite-picker-pagination" aria-label="${escAttr(favoritePickerText('pages'))}"><button type="button" data-picker-prev>${t('previous')}</button><span data-picker-page></span><button type="button" data-picker-next>${t('next')}</button></nav><footer><p role="status" aria-live="polite" data-picker-status></p><button type="button" class="btn btn-primary" data-picker-add></button></footer>`;
  const session={dialog,uid:auth.currentUser.uid,runtime:managedAccountSyncRuntime,additions:managedFavoriteAdditions,returnFocus,busy:false,message:'',preserved:[],evidenceReady:false,model:null};favoritePickerSession=session;
  // Names come only from the already permitted directory. No profile/list fetch.
  session.model=window.PogoDomain.favoritePickerModel.createFavoritePickerModel({names:Object.keys(allData.loginDirectory||{}),self:cur,remaining:favoriteAdditionUiState?.remaining??0});
  document.body.append(dialog);dialog.showModal();
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancelFavoritePicker();});
  dialog.querySelector('[data-picker-close]').onclick=cancelFavoritePicker;
  dialog.querySelector('#favorite-picker-search').oninput=event=>{session.model.search(event.target.value);renderFavoritePicker();};
  dialog.querySelector('[data-picker-all]').onclick=()=>{session.model.selectAll();renderFavoritePicker();};
  dialog.querySelector('[data-picker-clear]').onclick=()=>{session.model.clear();renderFavoritePicker();};
  dialog.querySelector('[data-picker-prev]').onclick=()=>{session.model.go(session.model.snapshot().page-1);renderFavoritePicker();};
  dialog.querySelector('[data-picker-next]').onclick=()=>{session.model.go(session.model.snapshot().page+1);renderFavoritePicker();};
  dialog.querySelector('[data-picker-rows]').onchange=event=>{const input=event.target.closest('[data-picker-name]');if(input){session.model.toggle(input.dataset.pickerName);renderFavoritePicker();}};
  dialog.querySelector('[data-picker-add]').onclick=submitFavoritePicker;
  renderFavoritePicker();
  try{const candidates=await session.runtime.listRecoveryCandidates();if(!favoritePickerCurrent(session))return;session.preserved=candidates.filter(row=>row.entityType==='favorite').map(row=>row.values?.displayName);session.evidenceReady=true;await session.additions.refresh();if(favoritePickerCurrent(session))renderFavoritePicker();}catch{if(favoritePickerCurrent(session)){session.message=favoritePickerText('notReady');renderFavoritePicker();}}
}
function renderFavoritePicker(){
  const session=favoritePickerSession;if(!session)return;if(!favoritePickerCurrent(session)){closeFavoritePicker();return;}
  const value=favoriteAdditionUiState;
  const state=session.model.update({existing:session.runtime.controller.activeEntities('favorite').map(row=>row.values.displayName),preserved:session.preserved,intents:value?.rows||[],remaining:value?.remaining??0});
  const dialog=session.dialog,t=(key,values)=>favoritePickerText(key,values);
  const active=document.activeElement?.dataset?.pickerName;
  dialog.querySelector('[data-picker-rows]').innerHTML=state.rows.length?state.rows.map(row=>`<label class="favorite-picker-row" data-state="${row.status}"><input type="checkbox" data-picker-name="${escAttr(row.name)}"${row.selected?' checked':''}${!row.selectable||session.busy||!session.evidenceReady?' disabled':''}><span class="favorite-picker-name">${escHtml(row.name)}</span><span class="favorite-picker-state">${escHtml(row.status==='candidate'?'':t(row.status==='already-present'?'already':row.status==='preserved'?'preserved':row.status==='pending'?'pending':'unsuccessful'))}</span></label>`).join(''):`<p class="favorite-picker-empty">${escHtml(t('empty'))}</p>`;
  if(active)Array.from(dialog.querySelectorAll('[data-picker-name]')).find(input=>input.dataset.pickerName===active)?.focus({preventScroll:true});
  dialog.querySelector('[data-picker-all]').textContent=t('all',{count:state.selectAllCount});dialog.querySelector('[data-picker-all]').disabled=session.busy||!state.selectAllCount;
  dialog.querySelector('[data-picker-clear]').disabled=session.busy||!state.selected.length;
  dialog.querySelector('[data-picker-capacity]').textContent=t('capacity',{remaining:state.remaining,selected:state.selected.length});
  dialog.querySelector('[data-picker-page]').textContent=t('page',{page:state.pageCount?state.page+1:0,pages:state.pageCount,count:state.resultCount});
  dialog.querySelector('[data-picker-prev]').disabled=state.page===0;dialog.querySelector('[data-picker-next]').disabled=state.page+1>=state.pageCount;
  const pending=state.selected.filter(name=>(value?.rows||[]).some(row=>row.handle===name&&row.state==='pending')).length;
  dialog.querySelector('[data-picker-status]').textContent=state.overCapacity?t('over',{count:state.newCount-state.remaining}):session.message||(pending?t('pendingDetail',{count:pending}):t('selectionDetail'));
  const add=dialog.querySelector('[data-picker-add]');add.textContent=session.busy?t('working'):t('add',{count:state.newCount});add.disabled=!session.evidenceReady||session.busy||state.overCapacity||!state.newCount;
}
async function submitFavoritePicker(){
  const session=favoritePickerSession;if(!session||session.busy)return;const state=session.model.snapshot();if(state.overCapacity||!state.newCount)return;
  const handles=state.selected.filter(name=>{const row=(favoriteAdditionUiState?.rows||[]).filter(row=>row.handle===name).at(-1);return !row||!['pending','confirmed','already-present'].includes(row.state);});
  session.busy=true;session.message=favoritePickerText('working');renderFavoritePicker();
  const result=await ensureTrainerFavorites(handles);
  if(!favoritePickerCurrent(session))return;session.busy=false;
  const rows=handles.map(handle=>[...(result?.rows||[])].reverse().find(row=>row.handle===handle));
  const confirmed=rows.filter(row=>['confirmed','already-present'].includes(row?.state)).length,pending=rows.filter(row=>row?.state==='pending').length,failed=rows.length-confirmed-pending;
  session.message=favoritePickerText('results',{confirmed,pending,failed});renderFavoritePicker();
}
function cancelFavoritePicker(){
  const session=favoritePickerSession;if(!session)return;const handles=session.model.snapshot().selected;
  if(session.busy)session.additions.cancel(handles).catch(()=>{});
  closeFavoritePicker();if(session.busy||handles.some(name=>(favoriteAdditionUiState?.rows||[]).some(row=>row.handle===name&&row.state==='pending')))toast(favoritePickerText('cancelDetail'),6000);
}
function closeFavoritePicker(){
  const session=favoritePickerSession;favoritePickerSession=null;if(!session)return;session.dialog.close();session.dialog.remove();if(session.returnFocus?.isConnected)session.returnFocus.focus();
}
