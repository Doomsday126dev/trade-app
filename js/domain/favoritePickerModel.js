(function(global){
  'use strict';
  const root=global.PogoDomain=global.PogoDomain||{};
  const fold=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
  const checkErrors=new Set(['favorite/network-failed','favorite/rate-limited','favorite/busy','favorite/unavailable','favorite/quota-unavailable','favorite/auth-required','favorite/app-check-required','favorite/caller-unavailable','favorite/not-enabled','favorite/response-invalid','favorite/request-invalid','favorite/session-changed']);
  function failureKind(intent){
    if(intent?.state!=='unsuccessful')return '';
    if(intent.code==='favorite/identity-unavailable')return 'notVerified';
    return checkErrors.has(intent.code)?'checkFailed':'saveFailed';
  }
  function createFavoritePickerModel({names,self,existing=[],preserved=[],intents=[],remaining=100,pageSize=20}={}){
    const selected=new Set();let query='',page=0;
    const candidates=[...new Set(names||[])].filter(name=>typeof name==='string'&&name&&fold(name)!==fold(self)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
    const indexIntents=rows=>new Map(rows.map(row=>[row.handle,row]));
    let latestIntents=indexIntents(intents);
    const latestIntent=name=>latestIntents.get(name);
    function status(name){
      const intent=latestIntent(name);
      if(intent&&['pending','selected','resolving','ready','unsuccessful'].includes(intent.state))return intent.state==='unsuccessful'?'unsuccessful':'pending';
      if(existing.includes(name)||intent&&['confirmed','already-present'].includes(intent.state))return 'already-present';
      if(preserved.some(value=>fold(value)===fold(name)))return 'preserved';
      return 'candidate';
    }
    const selectable=name=>['candidate','preserved','unsuccessful'].includes(status(name));
    const bulkSelectable=name=>['candidate','unsuccessful'].includes(status(name))&&failureKind(latestIntent(name))!=='notVerified';
    function snapshot(){
      const results=candidates.filter(name=>fold(name).includes(fold(query))),eligible=results.filter(bulkSelectable);
      page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(results.length/pageSize)-1)));
      const newCount=[...selected].filter(selectable).length;
      return {query,page,pageCount:Math.ceil(results.length/pageSize),resultCount:results.length,selectAllCount:eligible.length,selected:[...selected],newCount,remaining,overCapacity:newCount>remaining,
        rows:results.slice(page*pageSize,(page+1)*pageSize).map(name=>({name,status:status(name),failure:failureKind(latestIntent(name)),selected:selected.has(name),selectable:selectable(name)}))};
    }
    return Object.freeze({snapshot,search(value){query=String(value);page=0;return snapshot();},go(value){page=value;return snapshot();},toggle(name){if(candidates.includes(name)&&selectable(name))selected.has(name)?selected.delete(name):selected.add(name);return snapshot();},selectAll(){for(const name of candidates)if(fold(name).includes(fold(query))&&bulkSelectable(name))selected.add(name);return snapshot();},clear(){selected.clear();return snapshot();},unselectUnverified(rows){for(const row of rows)if(failureKind(row)==='notVerified')selected.delete(row.handle);return snapshot();},update(value){({existing=existing,preserved=preserved,remaining=remaining}=value);if(value.intents!==undefined)latestIntents=indexIntents(value.intents);for(const name of selected)if(status(name)==='already-present')selected.delete(name);return snapshot();}});
  }
  root.favoritePickerModel=Object.freeze({fold,failureKind,createFavoritePickerModel});
})(window);
