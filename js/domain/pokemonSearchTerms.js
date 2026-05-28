(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

const REGION_CODE_TERMS={K:'kanto',J:'johto',H:'hoenn',S:'sinnoh',U:'unova',L:'kalos',A:'alola',G:'galar',P:'paldea'};
const REGIONAL_FORM_TERMS={A:'alola',G:'galar',H:'hisui',P:'paldea'};
const REGION_SEARCH_TERMS=new Set([...Object.values(REGION_CODE_TERMS),'hisui']);
const CASTFORM_TYPE_TERMS=new Set(['fire','water','ice','normal']);
// Form-variant qualifiers: terms users can append to target evolution-gated forms.
// e.g. once GO enables White Basculin → Basculegion, add 'white' here.
const FORM_QUALIFIER_TERMS=new Set([]);

function regionalFormPrefix(name){return String(name||'').match(/^([AGHP])[-_]/)?.[1]||'';}
function regionalFormTerm(name){return REGIONAL_FORM_TERMS[regionalFormPrefix(name)]||'';}
function regionTermFromDex(dex){
  const n=parseInt(dex);
  if(!n)return'';
  if(n<=151)return'kanto';
  if(n<=251)return'johto';
  if(n<=386)return'hoenn';
  if(n<=493)return'sinnoh';
  if(n<=649)return'unova';
  if(n<=721)return'kalos';
  if(n<=809)return'alola';
  if(n<=898)return'galar';
  if(n<=905)return'hisui';
  return'paldea';
}
function dexRegionTerm(entry,dexHasRegional){
  const regional=regionalFormTerm(entry?.name);
  if(regional)return regional;
  return dexHasRegional?.[entry?.no]?REGION_CODE_TERMS[entry?.region]||regionTermFromDex(entry?.no):'';
}
function dexSearchTerm(entry,dexHasRegional){
  const dex=entry?.no;if(!dex)return'';
  const region=dexRegionTerm(entry,dexHasRegional);
  return region?`${region}&${dex}`:String(dex);
}
function castformTypeFilter(entry,mod=''){
  if(parseInt(entry?.no)!==351&&!String(entry?.name||'').toLowerCase().includes('castform'))return'';
  const text=`${entry?.name||''} ${entry?.displayName||''} ${mod}`.toLowerCase();
  if(/\b(ice|snow|snowy|frost|frosty)\b/.test(text))return'ice';
  if(/\b(fire|sun|sunny)\b/.test(text))return'fire';
  if(/\b(water|rain|rainy)\b/.test(text))return'water';
  if(/\b(normal|base|plain|default)\b/.test(text))return'normal';
  return'';
}
function modSearchFilters(mod){
  const m=String(mod||'').toLowerCase();
  const out=[];
  if(/\bshiny\b|\bshny\b/.test(m))out.push('shiny');
  if(/\bfemale\b|\bf\b/.test(m))out.push('female');
  else if(/\bmale\b|\bm\b/.test(m))out.push('male');
  if(m.includes('xxs'))out.push('xxs');
  else if(m.includes('xs'))out.push('xs');
  if(m.includes('xxl'))out.push('xxl');
  else if(m.includes('xl'))out.push('xl');
  return out;
}
function modFromSearchFilters(filters){
  const f=filters.map(x=>x.toLowerCase());
  if(f.includes('female'))return'f';
  if(f.includes('male'))return'm';
  if(f.includes('xxs'))return'xxs';
  if(f.includes('xs'))return'xs';
  if(f.includes('xxl'))return'xxl';
  if(f.includes('xl'))return'xl';
  return'';
}
function castformTypeFromSearchFilters(filters){
  return filters.find(f=>CASTFORM_TYPE_TERMS.has(f))||'';
}
// Form-variant qualifier — detects evolution-gated forms by entry name/mod.
// TODO: When GO enables White Basculin → Basculegion, add 'white' to FORM_QUALIFIER_TERMS
// and handle no===550 here so "550&white" targets only White-Stripe Basculin.
function formVariantFilter(entry,mod=''){
  const no=parseInt(entry?.no);
  if(!no)return'';
  // Add form cases here as GO enables form-specific evolutions.
  return'';
}
function formVariantFromSearchFilters(filters){
  return filters.find(f=>FORM_QUALIFIER_TERMS.has(f))||'';
}

  root.pokemonSearchTerms=Object.freeze({
    REGION_CODE_TERMS,
    REGIONAL_FORM_TERMS,
    REGION_SEARCH_TERMS,
    CASTFORM_TYPE_TERMS,
    FORM_QUALIFIER_TERMS,
    regionalFormPrefix,
    regionalFormTerm,
    regionTermFromDex,
    dexRegionTerm,
    dexSearchTerm,
    castformTypeFilter,
    modSearchFilters,
    modFromSearchFilters,
    castformTypeFromSearchFilters,
    formVariantFilter,
    formVariantFromSearchFilters
  });
})(window);
