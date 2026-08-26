(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const FLAG_KEYS=Object.freeze(['lucky','shiny','xxl','xxs']);

  function cleanEntry(entry){
    return Object.freeze({
      key:String(entry?.key||''),
      name:String(entry?.name||''),
      dn:String(entry?.dn||entry?.name||''),
      no:Number(entry?.no)||null,
      type:String(entry?.type||''),
      p:String(entry?.p||''),
      mod:String(entry?.mod||''),
      gender:String(entry?.gender||''),
      backgroundId:String(entry?.backgroundId||''),
      lucky:entry?.lucky===true,
      shiny:entry?.shiny===true,
      xxl:entry?.xxl===true,
      xxs:entry?.xxs===true,
      mirror:entry?.mirror===true
    });
  }
  function defaultNameKey(value){return String(value||'').trim().toLocaleLowerCase('en-US');}
  function qualifierKey(entry,normalizeQualifier=value=>String(value||'').trim().toLocaleLowerCase('en-US')){
    const item=cleanEntry(entry);
    return JSON.stringify([
      item.backgroundId,item.gender,normalizeQualifier(item.mod),
      ...FLAG_KEYS.map(flag=>item[flag])
    ]);
  }
  function exactOfferMatch(left,right,{nameKey=defaultNameKey,normalizeQualifier}={}){
    return nameKey(left?.name)===nameKey(right?.name)
      &&qualifierKey(left,normalizeQualifier)===qualifierKey(right,normalizeQualifier);
  }
  function matchingOffer(want,offers,{nameKey,matchesIntent}){
    return offers.find(offer=>nameKey(want.name)===nameKey(offer.name)&&matchesIntent(want,offer))||null;
  }
  function matchedWants(wants,offers,options){
    return wants.map(want=>{
      const offer=matchingOffer(want,offers,options);
      return offer?Object.freeze({...cleanEntry(offer),intent:cleanEntry(want)}):null;
    }).filter(Boolean);
  }
  function compareTradeLists({myWants=[],myOffers=[],theirWants=[],theirOffers=[]}={},options={}){
    const nameKey=typeof options.nameKey==='function'?options.nameKey:defaultNameKey;
    const matchesIntent=typeof options.matchesIntent==='function'?options.matchesIntent:()=>false;
    const normalizeQualifier=typeof options.normalizeQualifier==='function'?options.normalizeQualifier:undefined;
    const mine={wants:myWants.map(cleanEntry),offers:myOffers.map(cleanEntry)};
    const theirs={wants:theirWants.map(cleanEntry),offers:theirOffers.map(cleanEntry)};
    const compareOptions={nameKey,matchesIntent};
    const theyOfferMyWants=matchedWants(mine.wants,theirs.offers,compareOptions);
    const iOfferTheirWants=matchedWants(theirs.wants,mine.offers,compareOptions);
    const mirrors=mine.offers.filter(offer=>offer.mirror).map(offer=>{
      const counterpart=theirs.offers.find(other=>other.mirror&&exactOfferMatch(offer,other,{nameKey,normalizeQualifier}));
      return counterpart?Object.freeze({...offer,intent:offer}):null;
    }).filter(Boolean);
    return Object.freeze({
      theyOfferMyWants:Object.freeze(theyOfferMyWants),
      iOfferTheirWants:Object.freeze(iOfferTheirWants),
      mirrors:Object.freeze(mirrors)
    });
  }

  root.tradeListComparison=Object.freeze({FLAG_KEYS,cleanEntry,qualifierKey,exactOfferMatch,compareTradeLists});
})(window);
