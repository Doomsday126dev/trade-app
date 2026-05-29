(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function uniqueEntries(...groups){
    const seen=new Set(),out=[];
    groups.flat().forEach(e=>{
      if(!e?.name||seen.has(e.name))return;
      seen.add(e.name);out.push(e);
    });
    return out;
  }
  function costumeDedupeKey(entry){
    const label=String(entry?.displayName||entry?.name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/['’]s\b/g,'').replace(/[_.]/g,' ')
      // Preserve ? and ! as distinct word tokens BEFORE the alphanumeric strip
      // below, otherwise "Unown (!)" and "Unown (?)" both collapse to "unown"
      // and the question-mark variant gets silently dropped as a duplicate.
      .replace(/\?/g,' qmark ')
      .replace(/!/g,' exclaim ')
      .replace(/\b(galarian|g)\s+/g,'g ').replace(/\b(alolan|a)\s+/g,'a ')
      .replace(/\b(hisuian|h)\s+/g,'h ').replace(/\b(paldean|p)\s+/g,'p ')
      .replace(/\bwcs\b/g,'world championships').replace(/\bworlds\b/g,'world championships')
      .replace(/\bfly\b/g,'flying')
      .replace(/\banniv\b/g,'anniversary')
      .replace(/\b(team|hat|cap|costume|attire|style|with|the|mothif|motif)\b/g,'')
      .replace(/[^a-z0-9]+/g,' ').trim();
    return`${entry?.no||''}|${label}`;
  }
  // PoGo lets you trade Legendaries (special trades) but blocks the vast majority
  // of Mythicals — only Meltan / Melmetal / Gimmighoul are tradeable Mythicals.
  // Listing the others in the wishlist autocomplete is misleading: someone might
  // add "Mew" expecting a trade partner can fulfil it, when nobody can. We keep
  // them in LEGENDARY_AVATAR_ENTRIES (the source) so the avatar picker still
  // shows them — just filtered out from the trade dropdown specifically.
  const UNTRADEABLE_MYTHICAL_NAMES=new Set([
    'Mew','Celebi','Jirachi',
    'Deoxys (Normal)','Deoxys (Attack)','Deoxys (Defense)','Deoxys (Speed)',
    'Victini',
    'Phione','Manaphy','Darkrai',
    'Shaymin (Land)','Shaymin (Sky)',
    'Arceus',
    'Keldeo (Ordinary)','Keldeo (Resolute)',
    'Meloetta','Genesect',
    'Diancie',
    'Hoopa (Confined)','Hoopa (Unbound)',
    'Volcanion',
    'Magearna','Marshadow','Zeraora',
    'Zarude','Pecharunt'
  ]);
  function isTradeableForWishlist(entry){
    return !UNTRADEABLE_MYTHICAL_NAMES.has(entry?.name);
  }
  function maxTypeForEntry(entry,type=''){
    if(type==='gmax')return'gmax';
    if(type==='dynamax')return'dynamax';
    if(entry?.maxType)return entry.maxType;
    const label=`${entry?.name||''} ${entry?.displayName||''} ${entry?.dn||''}`;
    if(/\bgigantamax\b/i.test(label))return'gmax';
    if(/\bdynamax\b/i.test(label))return'dynamax';
    return'';
  }

  root.pokemonEntryRules=Object.freeze({
    uniqueEntries,
    costumeDedupeKey,
    UNTRADEABLE_MYTHICAL_NAMES,
    isTradeableForWishlist,
    maxTypeForEntry
  });
})(window);
