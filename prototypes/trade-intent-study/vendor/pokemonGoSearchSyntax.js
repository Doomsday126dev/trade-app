(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const SUPPORTED_LOCALES=Object.freeze(['en','ja','es','de']);
  const SOURCE_URLS=Object.freeze({
    en:'https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/',
    ja:'https://niantic.helpshift.com/hc/ja/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/?l=ja',
    es:'https://niantic.helpshift.com/hc/es/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/',
    de:'https://niantic.helpshift.com/hc/de/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/?hl=de&l=de'
  });
  const OPERATORS=Object.freeze({exclude:'!',and:'&',or:'|',list:',',alternateList:Object.freeze([':', ';']),range:'-',appraisal:'*'});
  const token=(en,ja,es,de)=>Object.freeze({en,ja,es,de,sourceByLocale:SOURCE_URLS});
  const TOKEN_CATALOG=Object.freeze({
    appraisal4Star:token('4*','4*','4*','4*'),
    traded:token('traded','こうかん','intercambiados','getauscht'),
    shiny:token('shiny','色違い','variocolor','Schillernd'),
    combatPower:token('CP','cp','PC','WP'),
    shadow:token('shadow','しゃどう','oscuro','Crypto'),
    purified:token('purified','らいと','purificado','Erlöst'),
    background:token('background','はいけい','fondo','hintergrund'),
    locationBackground:token('locationbackground','ろけーしょんはいけい','fondolugar','Ortshintergrund'),
    lucky:token('lucky','キラ','con suerte','Glücks'),
    costume:token('costume','とくべつ','disfraz','kostümiert'),
    legendary:token('legendary','伝説のポケモン','legendario','Legendär'),
    mythical:token('mythical','まぼろし','singular','Mysteriös'),
    dynamax:token('dynamax','だいまっくす','dinamax','dynamax'),
    gigantamax:token('gigantamax','きょだいまっくす','gigamax','gigadynamax'),
    favorite:token('favorite','お気に入り','favorito','Favorit'),
    hatched:token('hatched','ふか','eclosionado','ausgebrütet'),
    eggOnly:token('eggsonly','たまごのみ','huevosolo','nurausEiern'),
    xxl:token('xxl','xxl','xxl','XXL'),
    xxs:token('xxs','xxs','xxs','XXS')
  });
  const BOOLEAN_CLAUSES=Object.freeze({
    excludeFavorite:Object.freeze({token:'favorite',exclude:true}),
    excludeAppraisal4Star:Object.freeze({token:'appraisal4Star',exclude:true}),
    excludeShiny:Object.freeze({token:'shiny',exclude:true}),
    excludeShadow:Object.freeze({token:'shadow',exclude:true}),
    excludePurified:Object.freeze({token:'purified',exclude:true}),
    excludeBackground:Object.freeze({token:'background',exclude:true}),
    excludeLocationBackground:Object.freeze({token:'locationBackground',exclude:true}),
    excludeTraded:Object.freeze({token:'traded',exclude:true}),
    excludeLegendary:Object.freeze({token:'legendary',exclude:true}),
    excludeMythical:Object.freeze({token:'mythical',exclude:true}),
    includeLucky:Object.freeze({token:'lucky',exclude:false}),
    includeCostume:Object.freeze({token:'costume',exclude:false}),
    includeDynamax:Object.freeze({token:'dynamax',exclude:false}),
    includeGigantamax:Object.freeze({token:'gigantamax',exclude:false}),
    includeHatched:Object.freeze({token:'hatched',exclude:false}),
    includeEggOnly:Object.freeze({token:'eggOnly',exclude:false}),
    includeXxl:Object.freeze({token:'xxl',exclude:false}),
    includeXxs:Object.freeze({token:'xxs',exclude:false})
  });
  const SERIALIZATION_PROFILES=Object.freeze({
    priority:Object.freeze(['excludeAppraisal4Star','excludeTraded','excludeShiny','maxCp','excludeShadow','excludePurified','excludeBackground']),
    safeTransfer:Object.freeze(['excludeFavorite','excludeAppraisal4Star','excludeShiny','excludeShadow','excludePurified','excludeBackground','excludeTraded','excludeLegendary','excludeMythical','maxCp']),
    canonical:Object.freeze([...Object.keys(BOOLEAN_CLAUSES),'maxCp'])
  });
  const PRIORITY_QUERY=Object.freeze({profile:'priority',excludeAppraisal4Star:true,excludeTraded:true,excludeShiny:true,maxCp:2500,excludeShadow:true,excludePurified:true,excludeBackground:true,dexNumbers:Object.freeze([])});
  const SAFE_TRANSFER_QUERY=Object.freeze({profile:'safeTransfer',excludeFavorite:true,excludeAppraisal4Star:true,excludeShiny:true,excludeShadow:true,excludePurified:true,excludeBackground:true,excludeTraded:true,excludeLegendary:true,excludeMythical:true,maxCp:2500,dexNumbers:Object.freeze([])});
  const AUDIT=Object.freeze({
    generated:Object.freeze(['appraisal4Star','traded','shiny','combatPower','shadow','purified','background','favorite','legendary','mythical']),
    catalogedButInactive:Object.freeze(['locationBackground','lucky','costume','dynamax','gigantamax','hatched','eggOnly','xxl','xxs']),
    notGenerated:Object.freeze({region:'Import aid only; generated multi-Pokémon searches remain Pokédex-number based.',type:'No active generated type clause.',move:'No active generated move clause.',advancedEntryFlags:'Lucky, XXL, and XXS select separate Pokédex-number sets; they do not add a status token to current output.'})
  });

  function localeKey(value){const base=String(value||'en').trim().toLowerCase().replaceAll('_','-').split('-')[0];return SUPPORTED_LOCALES.includes(base)?base:'en';}
  function uniqueDexNumbers(values){return Object.freeze([...new Set((values||[]).map(Number).filter(Number.isInteger).filter(n=>n>0))].sort((a,b)=>a-b));}
  function normalizeQuery(value={}){
    const profile=Object.hasOwn(SERIALIZATION_PROFILES,value.profile)?value.profile:'canonical';
    const out={profile,dexNumbers:uniqueDexNumbers(value.dexNumbers)};
    for(const key of Object.keys(BOOLEAN_CLAUSES))out[key]=value[key]===true;
    const maxCp=Number(value.maxCp);out.maxCp=Number.isInteger(maxCp)&&maxCp>0?maxCp:null;
    return Object.freeze(out);
  }
  function tokenFor(key,locale){const entry=TOKEN_CATALOG[key];if(!entry)throw new Error(`Unsupported Pokémon GO search semantic: ${key}`);return entry[localeKey(locale)];}
  function clausesFor(value,locale){
    const model=normalizeQuery(value),clauses=[];
    for(const key of SERIALIZATION_PROFILES[model.profile]){
      if(key==='maxCp'){
        if(model.maxCp)clauses.push(`${tokenFor('combatPower',locale)}${OPERATORS.range}${model.maxCp}`);
        continue;
      }
      if(!model[key])continue;
      const rule=BOOLEAN_CLAUSES[key],command=tokenFor(rule.token,locale);
      clauses.push(`${rule.exclude?OPERATORS.exclude:''}${command}`);
    }
    return clauses;
  }
  function serializeQuery(value,locale='en'){
    const model=normalizeQuery(value),parts=clausesFor(model,locale);
    if(model.dexNumbers.length)parts.push(model.dexNumbers.join(OPERATORS.list));
    return parts.join(OPERATORS.and);
  }
  function queryPrefix(value,locale='en'){const body=clausesFor(value,locale).join(OPERATORS.and);return body?`${body}${OPERATORS.and}`:'';}
  function withDexNumbers(value,dexNumbers){return normalizeQuery({...value,dexNumbers});}
  function priorityQuery(dexNumbers=[]){return withDexNumbers(PRIORITY_QUERY,dexNumbers);}
  function safeTransferQuery(dexNumbers=[]){return withDexNumbers(SAFE_TRANSFER_QUERY,dexNumbers);}

  root.pokemonGoSearchSyntax=Object.freeze({SUPPORTED_LOCALES,SOURCE_URLS,OPERATORS,TOKEN_CATALOG,SERIALIZATION_PROFILES,PRIORITY_QUERY,SAFE_TRANSFER_QUERY,AUDIT,localeKey,uniqueDexNumbers,normalizeQuery,tokenFor,clausesFor,serializeQuery,queryPrefix,withDexNumbers,priorityQuery,safeTransferQuery});
})(window);
