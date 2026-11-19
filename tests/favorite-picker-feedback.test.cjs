'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=path=>fs.readFileSync(path,'utf8');
test('mixed verified, unavailable, transport, and write results render truthful labels and preserve prior saves',async()=>{
 const nodes=new Map();
 const dialog={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}};
 const uid='test-owner';
 let active=[];
 const runtime={controller:{activeEntities(){return active;}}};
 const requestAttempts=[];
 const added=[{handle:'Saved trainer',state:'confirmed'}];
 const outcomes=[
  ...added,
  {handle:'Directory trainer',state:'unsuccessful',code:'favorite/identity-unavailable'},
  {handle:'Connection trainer',state:'unsuccessful',code:'favorite/network-failed'},
  {handle:'Write trainer',state:'unsuccessful',code:'account-sync/conflict'}
 ];
 const context=vm.createContext({window:{},document:{activeElement:null},dialog,
  auth:{currentUser:{uid}},managedAccountSyncRuntime:runtime,managedFavoriteAdditions:{},
  favoriteAdditionUiState:{remaining:100,rows:[]},escHtml:value=>String(value).replaceAll('&','&amp;'),escAttr:String,
  async ensureTrainerFavorites(handles){
    requestAttempts.push(Array.from(handles));
    active=added.map(row=>({values:{displayName:row.handle}}));
    context.favoriteAdditionUiState={remaining:99,rows:outcomes};
    return context.favoriteAdditionUiState;
  }
 });
 vm.runInContext(source('js/i18n/locales/en.js')+'\ni18nCore={t:(key,values={})=>window.PogoLocales.en[key].replace(/\\{(\\w+)\\}/g,(_,name)=>values[name])};',context);
 vm.runInContext(source('js/domain/favoritePickerModel.js')+'\n'+source('js/app/favoritePicker.js'),context);
 await vm.runInContext(`
  favoritePickerSession={
    dialog,uid:auth.currentUser.uid,runtime:managedAccountSyncRuntime,additions:managedFavoriteAdditions,
    model:window.PogoDomain.favoritePickerModel.createFavoritePickerModel({
      names:['Directory trainer','Connection trainer','Write trainer','Saved trainer']
    }),preserved:[],evidenceReady:true,busy:false
  };
  favoritePickerSession.model.selectAll();
  submitFavoritePicker();
 `,context);
 const rows=nodes.get('[data-picker-rows]').innerHTML;
 for(const label of ['Already added','Couldn’t verify trainer','Check failed · try later','Save failed · check App &amp; Data'])assert.ok(rows.includes(label),label);
 assert.ok(!rows.includes('favorite/identity-unavailable')&&!rows.includes('account-sync/conflict'));
 assert.match(nodes.get('[data-picker-status]').textContent,/1 confirmed · 0 pending · 3 not saved\. Select an unverified trainer to check again\./);
 assert.equal(nodes.get('[data-picker-add]').textContent,'Add 2 favorites');
 await vm.runInContext('submitFavoritePicker()',context);
 assert.deepEqual(requestAttempts[1],['Connection trainer','Write trainer']);
});
