(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const {alphaCompare}=root.username||{};
  if(!alphaCompare)throw new Error('Username helpers failed to load');
  const {AC_RESULT_LIMIT,acMatchScore}=root.autocompleteMatching||{};
  if(!AC_RESULT_LIMIT||!acMatchScore)throw new Error('Autocomplete matching helpers failed to load');

  function autocompleteDexSortValue(e){
    return parseInt(e.no)||9999;
  }

  function compareAutocompleteMatches(a,b,opts={}){
    const alphaTieBreak=opts.alphaTieBreak!==false;
    return a.score-b.score||autocompleteDexSortValue(a.e)-autocompleteDexSortValue(b.e)||(alphaTieBreak?alphaCompare(a.e.dn,b.e.dn):0);
  }

  function rankAutocompleteItems(items,rawQuery,opts={}){
    const limit=opts.limit??AC_RESULT_LIMIT;
    return items.map(e=>({e,score:acMatchScore(e,rawQuery)}))
      .filter(x=>x.score>=0)
      .sort((a,b)=>compareAutocompleteMatches(a,b,opts))
      .slice(0,limit)
      .map(x=>x.e);
  }

  root.autocompleteRanking=Object.freeze({
    autocompleteDexSortValue,
    compareAutocompleteMatches,
    rankAutocompleteItems
  });
})(window);
