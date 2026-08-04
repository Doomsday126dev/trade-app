(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};

  function normalizeLocale(locale){
    return String(locale||'en').trim().toLowerCase().replace('_','-')||'en';
  }
  function interpolate(template,params={}){
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g,(match,key)=>
      Object.prototype.hasOwnProperty.call(params,key)?String(params[key]):match
    );
  }
  function createTranslator({catalogs={},pokemonCatalogs={},locale='en',fallbackLocale='en',onMissing}={}){
    let activeLocale=normalizeLocale(locale);
    const fallback=normalizeLocale(fallbackLocale);
    const uiCatalogs={...catalogs};
    const names={...pokemonCatalogs};
    function catalogFor(collection,requested){
      const exact=collection[requested];
      if(exact)return exact;
      const base=collection[requested.split('-')[0]];
      return base||null;
    }
    function lookup(collection,key,requested){
      const primary=catalogFor(collection,requested);
      if(primary&&Object.prototype.hasOwnProperty.call(primary,key))return primary[key];
      const fallbackCatalog=catalogFor(collection,fallback);
      if(fallbackCatalog&&Object.prototype.hasOwnProperty.call(fallbackCatalog,key))return fallbackCatalog[key];
      onMissing?.({key,locale:requested,kind:collection===names?'pokemon':'ui'});
      return key;
    }
    return Object.freeze({
      t:(key,params={})=>interpolate(lookup(uiCatalogs,String(key),activeLocale),params),
      pokemonName:key=>String(lookup(names,String(key),activeLocale)),
      setLocale:value=>{activeLocale=normalizeLocale(value);return activeLocale;},
      getLocale:()=>activeLocale,
      fallbackLocale:fallback
    });
  }

  const translator=createTranslator({catalogs:global.PogoLocales||{},locale:'en',fallbackLocale:'en'});
  root.core=Object.freeze({normalizeLocale,interpolate,createTranslator,t:translator.t,pokemonName:translator.pokemonName,setLocale:translator.setLocale,getLocale:translator.getLocale});
})(window);
