(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function _normGender(g){
    const s=String(g||'').toLowerCase();
    if(s==='f'||s==='female'||s==='♀')return'f';
    if(s==='m'||s==='male'||s==='♂')return'm';
    return'';
  }
  // Composite inventory key: "Heracross", "Heracross::m", "Heracross::f"
  // Lets a trainer keep distinct rows + counts for ♂ / ♀ / genderless variants
  // of the same Pokémon (e.g. Heracross where ♂ has a giant horn).
  const HAVE_KEY_SEP='::';
  function splitHaveKey(key){
    const s=String(key||'');
    const i=s.lastIndexOf(HAVE_KEY_SEP);
    if(i<0)return{name:s,gender:''};
    const tail=s.slice(i+HAVE_KEY_SEP.length);
    if(tail==='m'||tail==='f')return{name:s.slice(0,i),gender:tail};
    return{name:s,gender:''};
  }
  function joinHaveKey(name,gender){
    const g=_normGender(gender);
    return g?`${name}${HAVE_KEY_SEP}${g}`:String(name||'');
  }
  // Aggregate qty across the genderless + ♂ + ♀ keys of one Pokémon
  function totalQtyForName(inv,name){
    let t=0;
    ['',':m',':f'].forEach(()=>{}); // noop, just for clarity
    ['',(HAVE_KEY_SEP+'m'),(HAVE_KEY_SEP+'f')].forEach(suf=>{
      const v=inv?.[name+suf];
      if(v!=null)t+=haveEntryInfo(v).qty;
    });
    return t;
  }
  function haveEntryInfo(entry){
    if(entry&&typeof entry==='object'&&!Array.isArray(entry)){
      const mirrorOnly=!!entry.mirrorOnly;
      const dontNeedBack=!!entry.dontNeedBack&&!mirrorOnly;
      const giveaway=!!entry.giveaway&&!mirrorOnly&&!dontNeedBack;
      const mode=mirrorOnly?'mirror':dontNeedBack?'dontNeedBack':giveaway?'giveaway':'any';
      const backgroundId=root.priorityValues?.normalizeBackgroundId?.(entry.backgroundId)||'';
      return{
        qty:Math.max(0,Math.min(999,parseInt(entry.qty)||0)),
        mirrorOnly,dontNeedBack,giveaway,
        note:String(entry.note||'').slice(0,140),
        mode,backgroundId,shiny:!!entry.shiny,lucky:!!entry.lucky,xxl:!!entry.xxl,xxs:!!entry.xxs
      };
    }
    return{qty:Math.max(0,Math.min(999,parseInt(entry)||0)),mirrorOnly:false,dontNeedBack:false,giveaway:false,note:'',mode:'any',backgroundId:'',shiny:false,lucky:false,xxl:false,xxs:false};
  }
  function haveEntryValue(qty,prev,opts={}){
    const old=haveEntryInfo(prev);
    const q=Math.max(0,Math.min(999,parseInt(qty)||0));
    // Resolve new mode: opts.mode wins, else individual flags, else preserve old
    let mode=old.mode;
    if(opts.mode)mode=opts.mode;
    else if(opts.mirrorOnly!==undefined||opts.dontNeedBack!==undefined||opts.giveaway!==undefined){
      const m=opts.mirrorOnly!==undefined?!!opts.mirrorOnly:old.mirrorOnly;
      const d=opts.dontNeedBack!==undefined?!!opts.dontNeedBack:old.dontNeedBack;
      const g=opts.giveaway!==undefined?!!opts.giveaway:old.giveaway;
      mode=m?'mirror':d?'dontNeedBack':g?'giveaway':'any';
    }
    // Note carries through for giveaway mode (other modes drop the note)
    const note=opts.note!==undefined?String(opts.note||'').slice(0,140):old.note;
    const backgroundId=root.priorityValues?.normalizeBackgroundId?.(opts.backgroundId!==undefined?opts.backgroundId:old.backgroundId)||'';
    const shiny=opts.shiny!==undefined?!!opts.shiny:old.shiny,lucky=opts.lucky!==undefined?!!opts.lucky:old.lucky,xxl=opts.xxl!==undefined?!!opts.xxl:old.xxl,xxs=opts.xxs!==undefined?!!opts.xxs:old.xxs;
    if(mode==='any'&&!backgroundId&&!shiny&&!lucky&&!xxl&&!xxs)return q;
    const obj={qty:q};
    if(mode==='mirror')obj.mirrorOnly=true;
    else if(mode==='dontNeedBack')obj.dontNeedBack=true;
    else if(mode==='giveaway'){obj.giveaway=true;if(note)obj.note=note;}
    if(backgroundId)obj.backgroundId=backgroundId;
    if(shiny)obj.shiny=true;if(lucky)obj.lucky=true;if(xxl)obj.xxl=true;if(xxs)obj.xxs=true;
    return obj;
  }

  function normalizeCatalogKey(value){
    return String(value||'').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }

  function identity(catalogId,goCostumeId,primary,aliases,searchAliases=[]){
    return Object.freeze({
      catalogId,
      speciesId:25,
      goFormId:goCostumeId,
      goCostumeId,
      gameplayDistinctGender:'',
      regionalFormCode:'',
      representedMaxState:'',
      primary,
      aliases:Object.freeze([primary,...aliases]),
      searchAliases:Object.freeze(searchAliases)
    });
  }

  // These relationships come from the reviewed identifier-level costume audit.
  // Historical names remain aliases; only the selectable surface is consolidated.
  const VERIFIED_IDENTITIES=Object.freeze([
    identity('pokemon:25:costume:party-hat-original','PIKACHU_PARTY_HAT_ORIGINAL','Pikachu (Purple Party)',['Pikachu Party Hat'],['Pikachu Party Hat']),
    identity('pokemon:25:costume:flower-hat-2020','PIKACHU_FLOWER_HAT_2020','Pikachu (Spring)',['Pikachu Flower Hat'],['Pikachu Flower Hat']),
    identity('pokemon:25:costume:PIKACHU_BB_2026','PIKACHU_BB_2026','Pikachu (Baseball)',['Pikachu Baseball Shirt'],['Baseball Shirt Pikachu']),
    identity('pokemon:25:costume:PIKACHU_COSTUME_2020','PIKACHU_COSTUME_2020','Pikachu (Flying)',['Pikachu Costume 2020'],['Flying Pikachu 2020']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_GOGGLES_BLUE','PIKACHU_GOFEST_2025_GOGGLES_BLUE','Pikachu (Dapper) Goggles - Blue',['Dapper Pikachu Blue Accents'],['Dapper Blue Goggles Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_GOGGLES_RED','PIKACHU_GOFEST_2025_GOGGLES_RED','Pikachu (Dapper) Goggles - Red',['Dapper Pikachu Red Accents'],['Dapper Red Goggles Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_GOGGLES_YELLOW','PIKACHU_GOFEST_2025_GOGGLES_YELLOW','Pikachu (Dapper) Goggles - Yellow',['Dapper Pikachu Yellow Accents'],['Dapper Yellow Goggles Pikachu']),
    identity('pokemon:25:costume:PIKACHU_DOCTOR','PIKACHU_DOCTOR','Pikachu (Ph_D)',['Pikachu Doctor'],['Pikachu Ph.D.']),
    identity('pokemon:25:costume:trick-and-treats-2023','PIKACHU_TRICK_AND_TREATS_2023','Pikachu (Halloween 2023)',['Pikachu Fall 2023'],['Trick and Treats Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_01','PIKACHU_FLYING_01','Pikachu (Flying Green)',['Pikachu Flying 01'],['Green Balloons Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_02','PIKACHU_FLYING_02','Pikachu (Flying Purple)',['Pikachu Flying 02'],['Purple Balloons Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_04','PIKACHU_FLYING_04','Pikachu (Indonesia Balloon)',['Pikachu Flying 04'],['Flying Red Pikachu','Red Balloons Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_5TH_ANNIV','PIKACHU_FLYING_5TH_ANNIV','Pikachu (Flying 5th Anniversary)',['Pikachu (5th Anniversary)'],['5th Anniversary Flying Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_OKINAWA','PIKACHU_FLYING_OKINAWA','Pikachu (Fly Okinawa)',['Pikachu Flying Okinawa'],['Flying Okinawa Pikachu']),
    identity('pokemon:25:costume:gofest-2021-meloetta-hat','PIKACHU_GOFEST_2021_MELOETTA_HAT','Pikachu (Meloetta Hat)',['Pikachu GO Fest 2021'],['GO Fest 2021 Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2022','PIKACHU_GOFEST_2022','Pikachu (Shaymin Scarf)',['Pikachu (GO Fest 2022)'],['GO Fest 2022 Pikachu']),
    identity('pokemon:25:costume:gofest-2022-gracidea','PIKACHU_GOFEST_2022_GRACIDEA','Pikachu (Shaymin Flower)',['Pikachu Gracidea'],['Gracidea Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2024_MTIARA','PIKACHU_GOFEST_2024_MTIARA','Pikachu (Moon)',['Pikachu Moon Crown'],['Moon Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2024_STIARA','PIKACHU_GOFEST_2024_STIARA','Pikachu (Sun)',['Pikachu Sun Crown'],['Sun Crown Pikachu']),
    identity('pokemon:25:costume:gotour-2023-may','PIKACHU_GOTOUR_2023_MAY','Pikachu (May)',['Pikachu May Bow'],["May's Bow Pikachu"]),
    identity('pokemon:25:costume:PIKACHU_GOTOUR_2024_B_02','PIKACHU_GOTOUR_2024_B_02','Pikachu (Akari)',['Pikachu Akari Kerchief'],["Akari's Kerchief Pikachu"]),
    identity('pokemon:25:costume:halloween-2021','PIKACHU_HALLOWEEN_2021','Pikachu (Halloween 2021)',['Pikachu Halloween Mischief'],['Halloween Mischief Pikachu']),
    identity('pokemon:25:costume:PIKACHU_HORIZONS','PIKACHU_HORIZONS','Pikachu (Captain)',['Pikachu Horizons'],["Cap's Hat Pikachu"]),
    identity('pokemon:25:costume:indonesia-football-2025','PIKACHU_INDONESIA_FOOTBALL_2025','Pikachu (Timnas Indonesia)',['Pikachu Indonesia 2025'],['Indonesia Football Pikachu']),
    identity('pokemon:25:costume:red-party-hat-2020','PIKACHU_RED_PARTY_HAT_2020','Pikachu (Red Party)',['Pikachu Party Hat 2020'],['Red Party Hat Pikachu']),
    identity('pokemon:25:costume:party-top-hat-2023','PIKACHU_PARTY_TOP_HAT_2023','Pikachu (Top Hat)',['Pikachu Party Top Hat'],['Party Top Hat Pikachu']),
    identity('pokemon:25:costume:PIKACHU_KARIYUSHI','PIKACHU_KARIYUSHI','Pikachu (Kariyushi Shirt)',['Pikachu Kariyushi'],['Kariyushi Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_MONOCLE_BLUE','PIKACHU_GOFEST_2025_MONOCLE_BLUE','Pikachu (Dapper) Monocle - Blue',['Formal Pikachu Blue Accents'],['Dapper Blue Monocle Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_MONOCLE_RED','PIKACHU_GOFEST_2025_MONOCLE_RED','Pikachu (Dapper) Monocle - Red',['Formal Pikachu Red Accents'],['Dapper Red Monocle Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOFEST_2025_MONOCLE_YELLOW','PIKACHU_GOFEST_2025_MONOCLE_YELLOW','Pikachu (Dapper) Monocle - Yellow',['Formal Pikachu Yellow Accents'],['Dapper Yellow Monocle Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOTOUR_2025_B','PIKACHU_GOTOUR_2025_B','Pikachu (Nate)',['Pikachu Nate Visor'],["Nate's Visor Pikachu"]),
    identity('pokemon:25:costume:original-cap','PIKACHU_ORIGINAL_CAP','Pikachu (Ash)',['Pikachu Original Cap'],['Original Cap Pikachu']),
    identity('pokemon:25:costume:PIKACHU_GOTOUR_2025_B_02','PIKACHU_GOTOUR_2025_B_02','Pikachu (Rosa)',['Pikachu Rosa Visor'],["Rosa's Visor Pikachu"]),
    identity('pokemon:25:costume:cherry-blossom-2023','PIKACHU_CHERRY_BLOSSOM_2023','Pikachu (Cherry Blossom)',['Pikachu (Spring 2023)','Pikachu Cherry Blossoms'],['Cherry Blossoms Pikachu']),
    identity('pokemon:25:costume:PIKACHU_SUMMER_2023_A','PIKACHU_SUMMER_2023_A','Pikachu (Malachite)',['Pikachu Malachite Crown'],['Malachite Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_SUMMER_2023_B','PIKACHU_SUMMER_2023_B','Pikachu (Aquamarine)',['Pikachu Aquamarine Crown'],['Aquamarine Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_SUMMER_2023_C','PIKACHU_SUMMER_2023_C','Pikachu (Quartz)',['Pikachu Quartz Crown'],['Quartz Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_SUMMER_2023_D','PIKACHU_SUMMER_2023_D','Pikachu (Pyrite)',['Pikachu Pyrite Crown'],['Pyrite Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_SUMMER_2023_E','PIKACHU_SUMMER_2023_E','Pikachu (Amethyst)',['Pikachu Amethyst Crown'],['Amethyst Crown Pikachu']),
    identity('pokemon:25:costume:PIKACHU_TSHIRT_01','PIKACHU_TSHIRT_01','Pikachu (Green Shirt)',['Pikachu Berry Shirt'],['Berry Shirt Pikachu']),
    identity('pokemon:25:costume:PIKACHU_VISOR_2026','PIKACHU_VISOR_2026','Pikachu (Marathon)',['Pikachu Marathon Visor'],['Marathon Visor Pikachu']),
    identity('pokemon:25:costume:PIKACHU_VS_2019','PIKACHU_VS_2019','Pikachu (Libre)',['Pikachu (VS 2019)'],['Pikachu Libre']),
    identity('pokemon:25:costume:PIKACHU_WCS_2024','PIKACHU_WCS_2024','Pikachu (Worlds 2024)',['Pikachu (Scuba)'],['World Championships 2024 Pikachu','Scuba Pikachu']),
    identity('pokemon:25:costume:PIKACHU_WCS_2025','PIKACHU_WCS_2025','Pikachu (Worlds 2025)',['Pikachu Varsity Jacket'],['World Championships 2025 Pikachu','Varsity Jacket Pikachu']),
    identity('pokemon:25:costume:beanie-2019','PIKACHU_BEANIE_2019','Pikachu (Winter 2019)',['Pikachu Beanie'],['Beanie Pikachu']),
    identity('pokemon:25:costume:PIKACHU_WINTER_2020','PIKACHU_WINTER_2020','Pikachu (Holiday 2020)',['Pikachu Winter Carnival Outfit'],['Winter Carnival Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_03','PIKACHU_FLYING_03','Pikachu Flying 03',[],['Flying Orange Pikachu','Orange Balloons Pikachu']),
    identity('pokemon:25:costume:PIKACHU_ANNIVERSARY_2026','PIKACHU_ANNIVERSARY_2026',"Pikachu (Professor Willow's Assistant)",[],["Professor Willow's assistant Pikachu","Willow's Assistant Pikachu"])
  ]);

  const UNRESOLVED_COSTUME_KEYS=Object.freeze([
    'Pikachu (Sari)','Pikachu (Halloween 2022)','Pikachu (Holiday 2022)',
    'Pikachu (Victor)','Pikachu (Gloria)','Pikachu (Halloween 2024)',
    'Pikachu (Holiday 2024)','Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)'
  ]);

  const verifiedAliasIndex=new Map();
  const verifiedIdentityByCatalogKey=new Map();
  VERIFIED_IDENTITIES.forEach(def=>def.aliases.forEach(alias=>{
    const key=normalizeCatalogKey(alias),prior=verifiedAliasIndex.get(key);
    if(prior&&prior.catalogId!==def.catalogId)throw new Error(`Ambiguous Pokemon catalog alias: ${alias}`);
    verifiedAliasIndex.set(key,def);
  }));
  VERIFIED_IDENTITIES.forEach(def=>verifiedIdentityByCatalogKey.set(normalizeCatalogKey(def.catalogId),def));

  const verifiedMissingEntries=Object.freeze([
    Object.freeze({
      no:25,
      name:"Pikachu (Professor Willow's Assistant)",
      displayName:"Pikachu (Professor Willow's Assistant)",
      users:{},
      goFormId:'PIKACHU_ANNIVERSARY_2026',
      goCostumeId:'PIKACHU_ANNIVERSARY_2026'
    })
  ]);

  function fallbackCatalogId(entry){
    const speciesId=Number(entry?.no)||0;
    const representedMaxState=String(entry?.maxType||'').trim().toLowerCase()||'standard';
    const stableLegacyKey=String(entry?.name||'').normalize('NFKC').trim();
    return`pokemon:${speciesId}:${representedMaxState}:legacy:${encodeURIComponent(stableLegacyKey)}`;
  }

  function decorateCatalogEntry(entry){
    if(!entry||!entry.name)return entry;
    const def=verifiedAliasIndex.get(normalizeCatalogKey(entry.name));
    const regionalFormCode=String(entry.name).match(/^([AGHP])[-_]/)?.[1]||'';
    const representedMaxState=String(entry.maxType||'').trim().toLowerCase();
    const catalogId=def?.catalogId||fallbackCatalogId(entry);
    const legacyAliases=def?.aliases||Object.freeze([String(entry.name)]);
    const searchAliases=def?.searchAliases||Object.freeze([]);
    return{
      ...entry,
      catalogId,
      speciesId:Number(entry.no)||null,
      goFormId:def?.goFormId||String(entry.goFormId||''),
      goCostumeId:def?.goCostumeId||String(entry.goCostumeId||''),
      gameplayDistinctGender:String(entry.gameplayDistinctGender||''),
      regionalFormCode,
      representedMaxState,
      legacyAliases,
      searchAliases,
      spriteLookupKeys:Object.freeze([...new Set([entry.name,...legacyAliases])])
    };
  }

  function canonicalizeEntries(entries){
    const groups=new Map(),order=[];
    for(const raw of entries||[]){
      const entry=decorateCatalogEntry(raw);if(!entry?.catalogId)continue;
      if(!groups.has(entry.catalogId)){groups.set(entry.catalogId,[]);order.push(entry.catalogId);}
      groups.get(entry.catalogId).push(entry);
    }
    return order.map(catalogId=>{
      const rows=groups.get(catalogId),def=VERIFIED_IDENTITIES.find(item=>item.catalogId===catalogId);
      const primary=(def&&rows.find(row=>row.name===def.primary))||rows[0];
      const legacyAliases=Object.freeze([...new Set(rows.flatMap(row=>row.legacyAliases||[row.name]))]);
      const searchAliases=Object.freeze([...new Set(rows.flatMap(row=>row.searchAliases||[]))]);
      const spriteLookupKeys=Object.freeze([...new Set(rows.flatMap(row=>row.spriteLookupKeys||[row.name]))]);
      return{...primary,legacyAliases,searchAliases,spriteLookupKeys,sourceRows:Object.freeze(rows.map(row=>row.name))};
    });
  }

  function resolveLegacyKey(value){
    const raw=String(value||'').normalize('NFKC').trim();if(!raw)return null;
    const def=verifiedAliasIndex.get(normalizeCatalogKey(raw));
    return def?Object.freeze({catalogId:def.catalogId,canonicalKey:def.primary,legacyKey:raw}):null;
  }

  function catalogKey(value){
    const normalized=normalizeCatalogKey(value);
    return resolveLegacyKey(value)?.catalogId||verifiedIdentityByCatalogKey.get(normalized)?.catalogId||normalized;
  }

  function entryMap(entries){
    const map=new Map();
    for(const entry of entries||[]){
      const decorated=decorateCatalogEntry(entry);if(!decorated?.name)continue;
      for(const key of decorated.legacyAliases||[decorated.name])map.set(normalizeCatalogKey(key),decorated);
    }
    return map;
  }

  function entryForLegacyKey(entries,value){
    return entryMap(entries).get(normalizeCatalogKey(value))||null;
  }

  root.pokemonKeys=Object.freeze({
    _normGender,
    HAVE_KEY_SEP,
    splitHaveKey,
    joinHaveKey,
    totalQtyForName,
    haveEntryInfo,
    haveEntryValue
  });
  root.pokemonCatalog=Object.freeze({
    VERIFIED_IDENTITIES,
    UNRESOLVED_COSTUME_KEYS,
    verifiedMissingEntries,
    normalizeCatalogKey,
    fallbackCatalogId,
    decorateCatalogEntry,
    canonicalizeEntries,
    resolveLegacyKey,
    catalogKey,
    entryMap,
    entryForLegacyKey
  });
})(window);
