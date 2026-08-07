(function(global){
  const root=global.PogoI18n=global.PogoI18n||{};
  const SUPPORTED_LOCALES=Object.freeze(['en','ja','es','de']);
  const LOCALE_STORAGE_KEY='pogoUiLocale:v1';

  function normalizeLocale(locale){
    return String(locale||'en').trim().toLowerCase().replaceAll('_','-')||'en';
  }
  function supportedLocale(locale){
    const normalized=normalizeLocale(locale),base=normalized.split('-')[0];
    return SUPPORTED_LOCALES.includes(normalized)?normalized:SUPPORTED_LOCALES.includes(base)?base:'en';
  }
  function detectBrowserLocale(languages=global.navigator?.languages||[global.navigator?.language]){
    for(const locale of languages||[]){
      const normalized=normalizeLocale(locale),base=normalized.split('-')[0];
      if(SUPPORTED_LOCALES.includes(normalized))return normalized;
      if(SUPPORTED_LOCALES.includes(base))return base;
    }
    return'en';
  }
  function readStoredLocale(storage=global.localStorage){
    try{return storage?.getItem(LOCALE_STORAGE_KEY)||'';}catch{return'';}
  }
  function persistLocale(locale,storage=global.localStorage){
    try{storage?.setItem(LOCALE_STORAGE_KEY,supportedLocale(locale));return true;}catch{return false;}
  }
  function interpolate(template,params={}){
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g,(match,key)=>
      Object.prototype.hasOwnProperty.call(params,key)?String(params[key]):match
    );
  }
  function createTranslator({catalogs={},pokemonCatalogs={},locale='en',fallbackLocale='en',onMissing}={}){
    let activeLocale=supportedLocale(locale);
    const fallback=supportedLocale(fallbackLocale);
    const uiCatalogs={...catalogs};
    const names={...pokemonCatalogs};
    function catalogFor(collection,requested){
      const normalized=normalizeLocale(requested);
      return collection[normalized]||collection[normalized.split('-')[0]]||null;
    }
    function lookup(collection,key,requested){
      const primary=catalogFor(collection,requested);
      if(primary&&Object.prototype.hasOwnProperty.call(primary,key))return primary[key];
      const base=catalogFor(collection,normalizeLocale(requested).split('-')[0]);
      if(base&&Object.prototype.hasOwnProperty.call(base,key))return base[key];
      const fallbackCatalog=catalogFor(collection,fallback);
      if(fallbackCatalog&&Object.prototype.hasOwnProperty.call(fallbackCatalog,key))return fallbackCatalog[key];
      onMissing?.({key,locale:requested,kind:collection===names?'pokemon':'ui'});
      return key;
    }
    return Object.freeze({
      t:(key,params={})=>interpolate(lookup(uiCatalogs,String(key),activeLocale),params),
      pokemonName:key=>String(lookup(names,String(key),activeLocale)),
      setLocale:value=>{activeLocale=supportedLocale(value);return activeLocale;},
      getLocale:()=>activeLocale,
      fallbackLocale:fallback
    });
  }

  const missing=[];
  const initialLocale=supportedLocale(readStoredLocale()||detectBrowserLocale());
  const translator=createTranslator({catalogs:global.PogoLocales||{},locale:initialLocale,fallbackLocale:'en',onMissing:item=>missing.push(item)});
  function setLocale(value,{persist=true,storage=global.localStorage}={}){
    const locale=translator.setLocale(value);
    if(persist)persistLocale(locale,storage);
    return locale;
  }
  function formatDate(value,options={}){
    const date=value instanceof Date?value:new Date(value);
    if(Number.isNaN(date.getTime()))return'';
    return new Intl.DateTimeFormat(translator.getLocale(),options).format(date);
  }
  function formatNumber(value,options={}){
    return new Intl.NumberFormat(translator.getLocale(),options).format(Number(value)||0);
  }
  function formatRelativeTime(value,unit='minute',options={numeric:'auto'}){
    return new Intl.RelativeTimeFormat(translator.getLocale(),options).format(Number(value)||0,unit);
  }
  function formatPlural(key,count,params={}){
    const numeric=Number(count)||0;
    const category=new Intl.PluralRules(translator.getLocale()).select(numeric);
    const values={...params,count:formatNumber(numeric)};
    const categoryKey=`${key}.${category}`;
    const localized=translator.t(categoryKey,values);
    return localized===categoryKey?translator.t(`${key}.other`,values):localized;
  }
  function relativeTimeFromTimestamp(timestamp,now=Date.now()){
    const delta=Number(timestamp)-Number(now);if(!Number.isFinite(delta))return'';
    const abs=Math.abs(delta);
    if(abs<60000)return formatRelativeTime(Math.round(delta/1000),'second');
    if(abs<3600000)return formatRelativeTime(Math.round(delta/60000),'minute');
    if(abs<86400000)return formatRelativeTime(Math.round(delta/3600000),'hour');
    return formatRelativeTime(Math.round(delta/86400000),'day');
  }

  root.core=Object.freeze({
    SUPPORTED_LOCALES,LOCALE_STORAGE_KEY,normalizeLocale,supportedLocale,detectBrowserLocale,
    readStoredLocale,persistLocale,interpolate,createTranslator,t:translator.t,
    pokemonName:translator.pokemonName,setLocale,getLocale:translator.getLocale,
    formatDate,formatNumber,formatRelativeTime,formatPlural,relativeTimeFromTimestamp,
    missingKeys:()=>Object.freeze(missing.map(item=>Object.freeze({...item})))
  });
})(window);
