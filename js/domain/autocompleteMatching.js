(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const {normalizeAcText}=root.autocompleteText||{};
  if(!normalizeAcText)throw new Error('Autocomplete text helpers failed to load');

  const AC_RESULT_LIMIT=200;
  function acItemSearchText(e){
    let aliases='';
    if(/\(\?\)/.test(e.name))aliases+=' question questionmark question-mark';
    if(/\(!\)/.test(e.name))aliases+=' exclamation exclamationmark exclamation-mark';
    const catalogAliases=[...(e.legacyAliases||[]),...(e.searchAliases||[]),...(e.aliases||[])].join(' ');
    return normalizeAcText(`${e.name} ${e.dn} ${e.no||''} #${e.no||''} ${catalogAliases}${aliases}`);
  }
  function wordPrefix(text,query){
    return text.split(' ').some(word=>word.startsWith(query));
  }
  function acMatchScore(e,rawQuery){
    const q=normalizeAcText(rawQuery);
    if(!q)return-1;
    const text=e.search||acItemSearchText(e);
    const display=normalizeAcText(e.dn||e.displayName||e.name)||text;
    const aliases=[...(e.legacyAliases||[]),...(e.searchAliases||[]),...(e.aliases||[])]
      .map(normalizeAcText).filter(Boolean);
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
    if(display===q)return 1;
    if(aliases.includes(q))return 2;
    if(display.startsWith(q))return 3;
    if(aliases.some(alias=>alias.startsWith(q)))return 4;
    if(wordPrefix(display,q)||aliases.some(alias=>wordPrefix(alias,q)))return 5;
    if(display.includes(q)||aliases.some(alias=>alias.includes(q)))return 6;
    const tokens=q.split(' ').filter(Boolean);
    if(tokens.length&&tokens.every(t=>text.includes(t)))return 10+tokens.length;
    const digits=q.replace(/[^0-9]/g,'');
    if(no&&digits&&no.startsWith(digits))return 20;
    return -1;
  }

  root.autocompleteMatching=Object.freeze({
    AC_RESULT_LIMIT,
    acItemSearchText,
    acMatchScore
  });
})(window);
