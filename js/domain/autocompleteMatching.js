(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const {normalizeAcText}=root.autocompleteText||{};
  if(!normalizeAcText)throw new Error('Autocomplete text helpers failed to load');

  const AC_RESULT_LIMIT=50; // Humans rarely scroll past ~20; capping at 50 keeps single-char queries from injecting 250 list items
  function acItemSearchText(e){
    let aliases='';
    if(/\(\?\)/.test(e.name))aliases+=' question questionmark question-mark';
    if(/\(!\)/.test(e.name))aliases+=' exclamation exclamationmark exclamation-mark';
    return normalizeAcText(`${e.name} ${e.dn} ${e.no||''} #${e.no||''}${aliases}`);
  }
  function acMatchScore(e,rawQuery){
    const q=normalizeAcText(rawQuery);
    if(!q)return-1;
    const text=e.search||acItemSearchText(e);
    const no=String(e.no||'');
    // Pure-digit query: prioritize dex number matches (lower score = better)
    const isPureDigits=/^\d+$/.test(q);
    if(isPureDigits&&no){
      if(no===q)return 0;                  // exact dex hit (Pikachu for "25")
      if(no.startsWith(q))return 1;        // dex prefix (matches "2" → 2,20,25,...)
      // For pure digits, demote non-dex matches strongly
      if(text.includes(q))return 50;       // some text contains digits but isn't a dex hit
      return -1;
    }
    if(no&&q===no)return 0;
    if(text===q)return 1;
    if(text.startsWith(q))return 2;
    if(text.includes(q))return 3;
    const tokens=q.split(' ').filter(Boolean);
    if(tokens.length&&tokens.every(t=>text.includes(t)))return 8+tokens.length;
    const digits=q.replace(/[^0-9]/g,'');
    if(no&&digits&&no.startsWith(digits))return 12;
    return -1;
  }

  root.autocompleteMatching=Object.freeze({
    AC_RESULT_LIMIT,
    acItemSearchText,
    acMatchScore
  });
})(window);
