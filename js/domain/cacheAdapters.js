(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function cloneContainer(value){
    return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
  }
  function applyExactRecord(cache,path,value){
    const parts=String(path||'').split('/').filter(Boolean);
    if(!parts.length)return cache;
    const next=cloneContainer(cache);
    let source=cache&&typeof cache==='object'?cache:{};
    let target=next;
    parts.forEach((part,index)=>{
      if(index===parts.length-1){
        if(value==null)delete target[part];
        else target[part]=value;
        return;
      }
      source=source?.[part];
      target[part]=cloneContainer(source);
      target=target[part];
    });
    return next;
  }
  function replaceTopLevel(cache,path,value){
    const key=String(path||'').split('/').filter(Boolean)[0];
    if(!key)return cache;
    return{...cloneContainer(cache),[key]:value&&typeof value==='object'?value:{}};
  }

  root.cacheAdapters=Object.freeze({applyExactRecord,replaceTopLevel});
})(window);
