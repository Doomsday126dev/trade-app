(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function alphaCompare(a,b){
    return String(a||'').localeCompare(String(b||''),undefined,{sensitivity:'base',numeric:true});
  }

  root.username=Object.freeze({
    alphaCompare
  });
})(window);
