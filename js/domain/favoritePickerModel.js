(function(global){
  'use strict';
  const root=global.PogoDomain=global.PogoDomain||{};
  const fold=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-US');
  function createFavoritePickerModel({names,self,existing=[],preserved=[],intents=[],remaining=100,pageSize=20}={}){
    const selected=new Set();let query='',page=0;
    const candidates=[...new Set(names||[])].filter(name=>typeof name==='string'&&name&&fold(name)!==fold(self)).sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
    function status(name){
      if(preserved.some(value=>fold(value)===fold(name)))return 'preserved';
      const intent=[...intents].reverse().find(row=>row.handle===name);
      if(intent&&['pending','selected','resolving','ready','unsuccessful'].includes(intent.state))return intent.state==='unsuccessful'?'unsuccessful':'pending';
      if(existing.includes(name)||intent&&['confirmed','already-present'].includes(intent.state))return 'already-present';
      return 'candidate';
    }
    const selectable=name=>['candidate','unsuccessful'].includes(status(name));
    function snapshot(){
      const results=candidates.filter(name=>fold(name).includes(fold(query))),eligible=results.filter(selectable);
      page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(results.length/pageSize)-1)));
      const newCount=[...selected].filter(selectable).length;
      return {query,page,pageCount:Math.ceil(results.length/pageSize),resultCount:results.length,selectAllCount:eligible.length,selected:[...selected],newCount,remaining,overCapacity:newCount>remaining,
        rows:results.slice(page*pageSize,(page+1)*pageSize).map(name=>({name,status:status(name),selected:selected.has(name),selectable:selectable(name)}))};
    }
    return Object.freeze({snapshot,search(value){query=String(value);page=0;return snapshot();},go(value){page=value;return snapshot();},toggle(name){if(candidates.includes(name)&&selectable(name))selected.has(name)?selected.delete(name):selected.add(name);return snapshot();},selectAll(){for(const name of candidates)if(fold(name).includes(fold(query))&&selectable(name))selected.add(name);return snapshot();},clear(){selected.clear();return snapshot();},update(value){({existing=existing,preserved=preserved,intents=intents,remaining=remaining}=value);for(const name of selected)if(status(name)==='already-present')selected.delete(name);return snapshot();}});
  }
  root.favoritePickerModel=Object.freeze({fold,createFavoritePickerModel});
})(window);
