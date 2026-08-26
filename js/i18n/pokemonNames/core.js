(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const catalogs=global.PogoPokemonNameCatalogs||{};
  const variantCatalog=global.PogoPokemonVariantCatalog||{entries:{}};
  const structuredForms=global.PogoPokemonStructuredForms||{entries:{}};
  const structuredEntries=Object.freeze({...variantCatalog.entries,...structuredForms.entries});
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
    return Object.freeze({speciesId:Number(entry?.no)||null,variantId:String(entry?.catalogId||entry?.name||'').trim()||null});
  }
  function speciesName(entry,locale){
    const id=String(Number(entry?.no)||'');
    const requested=localeKey(locale);
    return catalogs[requested]?.[id]||catalogs[requested.split('-')[0]]?.[id]||catalogs.en?.[id]||'';
  }
  const englishSpeciesIds=Object.freeze(Object.fromEntries(Object.entries(catalogs.en||{}).map(([id,name])=>[normalizeSpeciesLookup(name),Number(id)])));
  function normalizeSpeciesLookup(value){return String(value||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[.'’]/g,'').replace(/[^\p{L}\p{N}♀♂]+/gu,' ').trim();}
  function speciesIdByEnglishName(value){return englishSpeciesIds[normalizeSpeciesLookup(value)]||null;}
  function regionalParts(entry){
    const canonical=String(entry?.name||'').trim();
    const match=canonical.match(/^([AGHP])[-_](.+)$/);
    return match?{code:match[1],base:match[2]}:null;
  }
  function variantKey(entry){return`${Number(entry?.no)||''}|${String(entry?.name||'').trim()}`;}
  function safeDescriptor(entry,englishSpecies){
    const original=originalLabel(entry),species=String(englishSpecies||'').trim();
    if(!original||!species)return null;
    const escaped=species.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const match=original.match(new RegExp(`^${escaped}\\s*\\(([^)]+)\\)(.*)$`,'i'));
    return match?`${match[1]}${match[2]||''}`.trim():null;
  }
  function composedVariantLabel(species,descriptor,locale){
    const lang=localeKey(locale),clean=String(descriptor||'').trim();
    if(!clean)return species;
    if(normalizeSpeciesLookup(clean).includes(normalizeSpeciesLookup(species)))return clean;
    return lang==='ja'?`${species}（${clean}）`:`${species} (${clean})`;
  }
  function regionalDescriptor(entry,englishSpecies){
    const regional=regionalParts(entry);if(!regional)return null;
    const original=originalLabel(entry),match=original.match(/\(([^)]+)\)(.*)$/);
    if(match)return`${match[1]}${match[2]||''}`.trim();
    const base=String(regional.base||'').replaceAll('_',' ').trim();
    if(normalizeSpeciesLookup(base)===normalizeSpeciesLookup(englishSpecies))return'';
    return null;
  }
  function resolveDisplayName(entry,{locale='en'}={}){
    const original=originalLabel(entry),lang=localeKey(locale);
    if(!original)return Object.freeze({text:'',status:'fallback',category:'unparseable'});
    if(lang==='en')return Object.freeze({text:original,status:'full',category:'canonical'});
    const localizedSpecies=speciesName(entry,lang);
    if(!localizedSpecies)return Object.freeze({text:original,status:'fallback',category:'unknown-species'});
    const englishSpecies=String(catalogs.en?.[String(Number(entry?.no)||'')]||'');
    const canonical=String(entry?.name||'').replaceAll('_',' ').replace(/\s+/g,' ').trim();
    const genderAlias=(entry?.no===29&&/^Nidoran[- ]?F$/i.test(canonical))||(entry?.no===32&&/^Nidoran[- ]?M$/i.test(canonical));
    const plain=!!englishSpecies&&(normalizeSpeciesLookup(canonical)===normalizeSpeciesLookup(englishSpecies)||normalizeSpeciesLookup(original)===normalizeSpeciesLookup(englishSpecies)||genderAlias);
    if(plain)return Object.freeze({text:localizedSpecies,status:'full',category:'ordinary-species'});
    const known=structuredEntries[variantKey(entry)];
    if(known){
      const descriptor=known.labels?.[lang];
      if(descriptor)return Object.freeze({text:composedVariantLabel(localizedSpecies,descriptor,lang),status:'full',category:known.category,formId:known.formId});
      return Object.freeze({text:composedVariantLabel(localizedSpecies,known.canonicalDescriptor,lang),status:'partial',category:known.category,formId:known.formId});
    }
    const regional=regionalParts(entry);
    if(regional){
      const descriptor=regionalDescriptor(entry,englishSpecies);
      if(descriptor==='')return Object.freeze({text:regionalLabel(localizedSpecies,regional.code,lang),status:'full',category:'regional-form'});
      if(descriptor)return Object.freeze({text:composedVariantLabel(regionalLabel(localizedSpecies,regional.code,lang),descriptor,lang),status:'partial',category:'regional-costume-or-subform'});
      return Object.freeze({text:original,status:'fallback',category:'unparseable-regional'});
    }
    const descriptor=safeDescriptor(entry,englishSpecies);
    if(descriptor)return Object.freeze({text:composedVariantLabel(localizedSpecies,descriptor,lang),status:'partial',category:'app-specific-costume'});
    return Object.freeze({text:original,status:'fallback',category:'unparseable'});
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
    return resolveDisplayName(entry,{locale}).text;
  }
  function searchLabels(entry,{locale='en'}={}){
    return Object.freeze([...new Set([
      displayName(entry,{locale}),speciesName(entry,locale),originalLabel(entry),String(entry?.name||'').replaceAll('_',' '),
      ...(entry?.legacyAliases||[]),...(entry?.searchAliases||[]),String(entry?.no||'')
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
  function variantCoverage(entries,locale){
    const summary={locale:localeKey(locale),full:0,partial:0,fallback:0,total:0,categories:{}};
    for(const entry of entries||[]){
      const resolved=resolveDisplayName(entry,{locale});summary.total++;summary[resolved.status]++;
      const bucket=summary.categories[resolved.category]||(summary.categories[resolved.category]={full:0,partial:0,fallback:0,total:0});
      bucket.total++;bucket[resolved.status]++;
    }
    return Object.freeze(summary);
  }

  root.pokemonNames=Object.freeze({localeKey,identity,originalLabel,speciesName,speciesIdByEnglishName,normalizeSpeciesLookup,displayName,resolveDisplayName,searchLabels,compareDisplay,coverage,variantCoverage,regionalParts,variantSource:variantCatalog.source||null,structuredFormSource:structuredForms.source||null});
})(window);
