(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const catalogs=global.PogoPokemonNameCatalogs||{};
  const supported=Object.freeze(['en','ja','es','de']);
  const formNames=Object.freeze({
    en:Object.freeze({A:'Alolan',G:'Galarian',H:'Hisuian',P:'Paldean'}),
    ja:Object.freeze({A:'アローラ',G:'ガラル',H:'ヒスイ',P:'パルデア'}),
    es:Object.freeze({A:'Alola',G:'Galar',H:'Hisui',P:'Paldea'}),
    de:Object.freeze({A:'Alola',G:'Galar',H:'Hisui',P:'Paldea'})
  });

  function localeKey(value){
    const normalized=String(value||'en').trim().toLowerCase().replaceAll('_','-');
    const base=normalized.split('-')[0];
    return supported.includes(normalized)?normalized:supported.includes(base)?base:'en';
  }
  function originalLabel(entry){return String(entry?.displayName||entry?.dn||entry?.name||'').trim();}
  function identity(entry){
    return Object.freeze({speciesId:Number(entry?.no)||null,variantId:String(entry?.name||'').trim()||null});
  }
  function speciesName(entry,locale){
    const id=String(Number(entry?.no)||'');
    const requested=localeKey(locale);
    return catalogs[requested]?.[id]||catalogs[requested.split('-')[0]]?.[id]||catalogs.en?.[id]||'';
  }
  const englishSpeciesIds=Object.freeze(Object.fromEntries(Object.entries(catalogs.en||{}).map(([id,name])=>[normalizeSpeciesLookup(name),Number(id)])));
  function normalizeSpeciesLookup(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[.']/g,'').replace(/[^\p{L}\p{N}♀♂]+/gu,' ').trim();}
  function speciesIdByEnglishName(value){return englishSpeciesIds[normalizeSpeciesLookup(value)]||null;}
  function regionalParts(entry){
    const canonical=String(entry?.name||'').trim();
    const match=canonical.match(/^([AGHP])[-_](.+)$/);
    return match?{code:match[1],base:match[2]}:null;
  }
  function regionalLabel(name,code,locale){
    const lang=localeKey(locale),form=formNames[lang]?.[code]||formNames.en[code];
    if(!form)return name;
    if(lang==='ja')return`${form}のすがた ${name}`;
    if(lang==='es')return`${name} (forma de ${form})`;
    if(lang==='de')return`${name} (${form}-Form)`;
    return`${name} (${form} Form)`;
  }
  function displayName(entry,{locale='en'}={}){
    const original=originalLabel(entry);if(!original)return'';
    const lang=localeKey(locale);if(lang==='en')return original;
    const localizedSpecies=speciesName(entry,lang);if(!localizedSpecies)return original;
    const regional=regionalParts(entry);
    if(regional)return regionalLabel(localizedSpecies,regional.code,lang);
    const englishSpecies=String(catalogs.en?.[String(Number(entry?.no)||'')]||'');
    const canonical=String(entry?.name||'').replaceAll('_',' ').replace(/\s+/g,' ').trim();
    const genderAlias=(entry?.no===29&&/^Nidoran[- ]?F$/i.test(canonical))||(entry?.no===32&&/^Nidoran[- ]?M$/i.test(canonical));
    const plain=!!englishSpecies&&(canonical===englishSpecies||original===englishSpecies||genderAlias);
    return plain?localizedSpecies:original;
  }
  function searchLabels(entry,{locale='en'}={}){
    return Object.freeze([...new Set([
      displayName(entry,{locale}),originalLabel(entry),String(entry?.name||'').replaceAll('_',' '),String(entry?.no||'')
    ].map(value=>String(value||'').trim()).filter(Boolean))]);
  }
  function compareDisplay(a,b,{locale='en'}={}){
    return new Intl.Collator(localeKey(locale),{numeric:true,sensitivity:'base'}).compare(displayName(a,{locale}),displayName(b,{locale}));
  }
  function coverage(entries,locale){
    const ids=[...new Set((entries||[]).map(entry=>String(Number(entry?.no)||'')).filter(Boolean))];
    const lang=localeKey(locale),translated=ids.filter(id=>Object.prototype.hasOwnProperty.call(catalogs[lang]||{},id));
    return Object.freeze({locale:lang,translatedSpecies:translated.length,totalSpecies:ids.length,fallbackSpecies:ids.length-translated.length,complete:translated.length===ids.length});
  }

  root.pokemonNames=Object.freeze({localeKey,identity,originalLabel,speciesName,speciesIdByEnglishName,normalizeSpeciesLookup,displayName,searchLabels,compareDisplay,coverage,regionalParts});
})(window);
