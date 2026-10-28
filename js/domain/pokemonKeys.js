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
    return String(value||'').normalize('NFKC').trim().toLowerCase();
  }

  function identity(catalogId,goCostumeId,primary,aliases,searchAliases=[],speciesId=25){
    return Object.freeze({
      catalogId,
      speciesId,
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
    identity('pokemon:25:costume:halloween-2026','','Pikachu (Hat and Capelet)',['Pikachu (Halloween 2026)'],['Halloween 2026 Pikachu','Hat and Capelet Pikachu']),
    identity('pokemon:41:costume:halloween-2026','','Zubat (Top Hat)',[],['Top Hat Zubat','Halloween 2026 Zubat'],41),
    identity('pokemon:854:costume:bow-2026:phony','','Sinistea (Bow, Phony)',[],['Phony Bow Sinistea','Halloween Bow Phony Sinistea'],854),
    identity('pokemon:854:costume:bow-2026:antique','','Sinistea (Bow, Antique)',[],['Antique Bow Sinistea','Halloween Bow Antique Sinistea'],854),
    identity('pokemon:25:costume:orange-hanbok-2026','','Pikachu (Orange Hanbok)',[],['Orange Hanbok Pikachu','Korean Pikachu','Korea Pikachu','Autumn Picnic Pikachu','주황색 한복의 피카츄']),
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
    identity('pokemon:25:costume:halloween-2021','PIKACHU_HALLOWEEN_2021','Pikachu (Halloween 2021)',['Pikachu Halloween Mischief',"Pikachu (Halloween 2022)"],['Halloween Mischief Pikachu']),
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
    identity('pokemon:25:costume:PIKACHU_WINTER_2020','PIKACHU_WINTER_2020','Pikachu (Holiday 2020)',['Pikachu Winter Carnival Outfit',"Pikachu (Holiday 2022)","Pikachu (Holiday 2024)"],['Winter Carnival Pikachu']),
    identity('pokemon:25:costume:PIKACHU_FLYING_03','PIKACHU_FLYING_03','Pikachu Flying 03',[],['Flying Orange Pikachu','Orange Balloons Pikachu']),
    identity('pokemon:25:costume:PIKACHU_ANNIVERSARY_2026','PIKACHU_ANNIVERSARY_2026',"Pikachu (Professor Willow's Assistant)",[],["Professor Willow's assistant Pikachu","Willow's Assistant Pikachu"]),
    identity('pokemon:25:costume:PIKACHU_PXP_2026','PIKACHU_PXP_2026','Pikachu (Cosmog Spacesuit)',['Cosmog-themed Spacesuit Pikachu'],['Cosmog Spacesuit Pikachu']),
    identity('pokemon:25:costume:PIKACHU_WCS_2026','PIKACHU_WCS_2026','Pikachu (Worlds 2026)',['World Championships 2026 Pikachu'],['Worlds 2026 Pikachu'])
  ]);
  // Correct a presentation typo without changing the persisted legacy catalog ID
  // or expanding the audited duplicate-costume identity inventory.
  const LEGACY_LABEL_CORRECTIONS=Object.freeze([
    identity('pokemon:80:standard:legacy:Slowpoke%202021','','Slowbro 2021',['Slowpoke 2021'],[],80)
  ]);
  const REVIEWED_FORM_ALIASES=Object.freeze([
    identity("pokemon:423:standard:legacy:Gastrodon%20(West%20Sea)",'',"Gastrodon (West Sea)",["Gastrodon"],[],423),
    identity("pokemon:681:standard:legacy:Aegislash%20(Shield%20Forme)",'',"Aegislash (Shield Forme)",["Aegislash"],[],681),
    identity("pokemon:745:standard:legacy:Lycanroc%20(Midday%20Form)",'',"Lycanroc (Midday Form)",["Lycanroc"],[],745),
    identity("pokemon:902:standard:legacy:Basculegion%20(Male)",'',"Basculegion (Male)",["Basculegion"],[],902),
    identity("pokemon:925:standard:legacy:Maushold%20(Family%20of%20Three)",'',"Maushold (Family of Three)",["Maushold"],[],925),
    identity("pokemon:982:standard:legacy:Dudunsparce%20(Two-Segment%20Form)",'',"Dudunsparce (Two-Segment Form)",["Dudunsparce"],[],982),
    identity("pokemon:79:standard:legacy:Slowpoke%20(Detective)",'',"Slowpoke (Detective)",["Slowpoke (Cowboy)"],[],79)
  ]);
  // Reviewed aliases share one picker identity. Keep every former ID for saved records.
  const REVIEWED_PICKER_ALIASES=Object.freeze([{"id":"pokemon:1:standard:legacy:Bulbasaur%20(Red%20Party)","no":1,"primary":"Bulbasaur (Red Party)","names":["Bulbasaur (Red Party)","Bulbasaur Party Hat"],"old":{"Bulbasaur (Red Party)":"pokemon:1:standard:legacy:Bulbasaur%20(Red%20Party)","Bulbasaur Party Hat":"pokemon:1:standard:legacy:Bulbasaur%20Party%20Hat"}},{"id":"pokemon:1:standard:legacy:Bulbasaur%20(Visor)","no":1,"primary":"Bulbasaur (Visor)","names":["Bulbasaur (Visor)","Bulbasaur Pikachu Visor"],"old":{"Bulbasaur (Visor)":"pokemon:1:standard:legacy:Bulbasaur%20(Visor)","Bulbasaur Pikachu Visor":"pokemon:1:standard:legacy:Bulbasaur%20Pikachu%20Visor"}},{"id":"pokemon:4:standard:legacy:Charmander%20(Red%20Party)","no":4,"primary":"Charmander (Red Party)","names":["Charmander (Red Party)","Charmander Party Hat"],"old":{"Charmander (Red Party)":"pokemon:4:standard:legacy:Charmander%20(Red%20Party)","Charmander Party Hat":"pokemon:4:standard:legacy:Charmander%20Party%20Hat"}},{"id":"pokemon:4:standard:legacy:Charmander%20(Visor)","no":4,"primary":"Charmander (Visor)","names":["Charmander (Visor)","Charmander Pikachu Visor"],"old":{"Charmander (Visor)":"pokemon:4:standard:legacy:Charmander%20(Visor)","Charmander Pikachu Visor":"pokemon:4:standard:legacy:Charmander%20Pikachu%20Visor"}},{"id":"pokemon:7:standard:legacy:Squirtle%20(Red%20Party)","no":7,"primary":"Squirtle (Red Party)","names":["Squirtle (Red Party)","Squirtle Party Hat"],"old":{"Squirtle (Red Party)":"pokemon:7:standard:legacy:Squirtle%20(Red%20Party)","Squirtle Party Hat":"pokemon:7:standard:legacy:Squirtle%20Party%20Hat"}},{"id":"pokemon:7:standard:legacy:Squirtle%20(Visor)","no":7,"primary":"Squirtle (Visor)","names":["Squirtle (Visor)","Squirtle Pikachu Visor"],"old":{"Squirtle (Visor)":"pokemon:7:standard:legacy:Squirtle%20(Visor)","Squirtle Pikachu Visor":"pokemon:7:standard:legacy:Squirtle%20Pikachu%20Visor"}},{"id":"pokemon:7:standard:legacy:Squirtle%20(Yamask)","no":7,"primary":"Squirtle (Yamask)","names":["Squirtle (Yamask)","Squirtle Halloween"],"old":{"Squirtle (Yamask)":"pokemon:7:standard:legacy:Squirtle%20(Yamask)","Squirtle Halloween":"pokemon:7:standard:legacy:Squirtle%20Halloween"}},{"id":"pokemon:12:standard:legacy:Butterfree%20(Bow)","no":12,"primary":"Butterfree (Bow)","names":["Butterfree (Bow)","Butterfree Fashionable"],"old":{"Butterfree (Bow)":"pokemon:12:standard:legacy:Butterfree%20(Bow)","Butterfree Fashionable":"pokemon:12:standard:legacy:Butterfree%20Fashionable"}},{"id":"pokemon:25:standard:legacy:Pikachu%20(Saree)","no":25,"primary":"Pikachu (Saree)","names":["Pikachu (Saree)","Pikachu (Sari)"],"old":{"Pikachu (Saree)":"pokemon:25:standard:legacy:Pikachu%20(Saree)","Pikachu (Sari)":"pokemon:25:standard:legacy:Pikachu%20(Sari)"}},{"id":"pokemon:37:standard:legacy:Vulpix%20(Halloween)","no":37,"primary":"Vulpix (Halloween)","names":["Vulpix (Halloween)","Vulpix Spooky Festival"],"old":{"Vulpix (Halloween)":"pokemon:37:standard:legacy:Vulpix%20(Halloween)","Vulpix Spooky Festival":"pokemon:37:standard:legacy:Vulpix%20Spooky%20Festival"}},{"id":"pokemon:54:standard:legacy:Psyduck%20(Holiday%202023)","no":54,"primary":"Psyduck (Holiday 2023)","names":["Psyduck (Holiday 2023)","Psyduck Holiday Attire"],"old":{"Psyduck (Holiday 2023)":"pokemon:54:standard:legacy:Psyduck%20(Holiday%202023)","Psyduck Holiday Attire":"pokemon:54:standard:legacy:Psyduck%20Holiday%20Attire"}},{"id":"pokemon:77:standard:legacy:G_%20Ponyta%20(Meloetta%20Hat)","no":77,"primary":"G_ Ponyta (Meloetta Hat)","names":["G_ Ponyta (Meloetta Hat)","Ponyta Galarian GO Fest 2021"],"old":{"G_ Ponyta (Meloetta Hat)":"pokemon:77:standard:legacy:G_%20Ponyta%20(Meloetta%20Hat)","Ponyta Galarian GO Fest 2021":"pokemon:77:standard:legacy:Ponyta%20Galarian%20GO%20Fest%202021"}},{"id":"pokemon:79:standard:legacy:Slowpoke%20(Detective)","no":79,"primary":"Slowpoke (Detective)","names":["Slowpoke (Detective)","Slowpoke Hat"],"old":{"Slowpoke (Detective)":"pokemon:79:standard:legacy:Slowpoke%20(Detective)","Slowpoke Hat":"pokemon:79:standard:legacy:Slowpoke%20Hat"}},{"id":"pokemon:79:standard:legacy:Slowpoke%20(New%20Year)","no":79,"primary":"Slowpoke (New Year)","names":["Slowpoke (New Year)","Slowpoke 2020"],"old":{"Slowpoke (New Year)":"pokemon:79:standard:legacy:Slowpoke%20(New%20Year)","Slowpoke 2020":"pokemon:79:standard:legacy:Slowpoke%202020"}},{"id":"pokemon:94:standard:legacy:Gengar%20(Halloween%202023)","no":94,"primary":"Gengar (Halloween 2023)","names":["Gengar (Halloween 2023)","Gengar Fall 2023"],"old":{"Gengar (Halloween 2023)":"pokemon:94:standard:legacy:Gengar%20(Halloween%202023)","Gengar Fall 2023":"pokemon:94:standard:legacy:Gengar%20Fall%202023"}},{"id":"pokemon:94:standard:legacy:Gengar%20(Spooky%20Hat)","no":94,"primary":"Gengar (Spooky Hat)","names":["Gengar (Halloween 2022)","Gengar (Spooky Hat)","Gengar Halloween","Gengar Spooky Festival","Gengar (Halloween 2024)"],"old":{"Gengar (Halloween 2022)":"pokemon:94:standard:legacy:Gengar%20(Halloween%202022)","Gengar (Spooky Hat)":"pokemon:94:standard:legacy:Gengar%20(Spooky%20Hat)","Gengar Halloween":"pokemon:94:standard:legacy:Gengar%20Halloween","Gengar Spooky Festival":"pokemon:94:standard:legacy:Gengar%20Spooky%20Festival","Gengar (Halloween 2024)":"pokemon:94:standard:legacy:Gengar%20(Halloween%202024)"}},{"id":"pokemon:104:standard:legacy:Cubone%20(Cempasuchil)","no":104,"primary":"Cubone (Cempasuchil)","names":["Cubone (Cempasuchil)","Cubone Cempasuchil Crown"],"old":{"Cubone (Cempasuchil)":"pokemon:104:standard:legacy:Cubone%20(Cempasuchil)","Cubone Cempasuchil Crown":"pokemon:104:standard:legacy:Cubone%20Cempasuchil%20Crown"}},{"id":"pokemon:133:standard:legacy:Eevee%20(Cherry%20Blossom)","no":133,"primary":"Eevee (Cherry Blossom)","names":["Eevee (Cherry Blossom)","Eevee Cherry Blossoms"],"old":{"Eevee (Cherry Blossom)":"pokemon:133:standard:legacy:Eevee%20(Cherry%20Blossom)","Eevee Cherry Blossoms":"pokemon:133:standard:legacy:Eevee%20Cherry%20Blossoms"}},{"id":"pokemon:133:standard:legacy:Eevee%20(Holiday)","no":133,"primary":"Eevee (Holiday)","names":["Eevee (Holiday)","Eevee Holiday 2023"],"old":{"Eevee (Holiday)":"pokemon:133:standard:legacy:Eevee%20(Holiday)","Eevee Holiday 2023":"pokemon:133:standard:legacy:Eevee%20Holiday%202023"}},{"id":"pokemon:133:standard:legacy:Eevee%20(Moon)","no":133,"primary":"Eevee (Moon)","names":["Eevee (Moon)","Eevee Moon Crown"],"old":{"Eevee (Moon)":"pokemon:133:standard:legacy:Eevee%20(Moon)","Eevee Moon Crown":"pokemon:133:standard:legacy:Eevee%20Moon%20Crown"}},{"id":"pokemon:133:standard:legacy:Eevee%20(Red%20Party)","no":133,"primary":"Eevee (Red Party)","names":["Eevee (Red Party)","Eevee Party Hat"],"old":{"Eevee (Red Party)":"pokemon:133:standard:legacy:Eevee%20(Red%20Party)","Eevee Party Hat":"pokemon:133:standard:legacy:Eevee%20Party%20Hat"}},{"id":"pokemon:133:standard:legacy:Eevee%20(Sun)","no":133,"primary":"Eevee (Sun)","names":["Eevee (Sun)","Eevee Sun Crown"],"old":{"Eevee (Sun)":"pokemon:133:standard:legacy:Eevee%20(Sun)","Eevee Sun Crown":"pokemon:133:standard:legacy:Eevee%20Sun%20Crown"}},{"id":"pokemon:143:standard:legacy:Snorlax%20(Nightcap)","no":143,"primary":"Snorlax (Nightcap)","names":["Snorlax (Nightcap)","Snorlax Night Cap"],"old":{"Snorlax (Nightcap)":"pokemon:143:standard:legacy:Snorlax%20(Nightcap)","Snorlax Night Cap":"pokemon:143:standard:legacy:Snorlax%20Night%20Cap"}},{"id":"pokemon:149:standard:legacy:Dragonite%20(Bow)","no":149,"primary":"Dragonite (Bow)","names":["Dragonite (Bow)","Dragonite Fashionable"],"old":{"Dragonite (Bow)":"pokemon:149:standard:legacy:Dragonite%20(Bow)","Dragonite Fashionable":"pokemon:149:standard:legacy:Dragonite%20Fashionable"}},{"id":"pokemon:163:standard:legacy:Hoothoot%20(New%20Year)","no":163,"primary":"Hoothoot (New Year)","names":["Hoothoot (New Year)","Hoothoot New Years"],"old":{"Hoothoot (New Year)":"pokemon:163:standard:legacy:Hoothoot%20(New%20Year)","Hoothoot New Years":"pokemon:163:standard:legacy:Hoothoot%20New%20Years"}},{"id":"pokemon:172:standard:legacy:Pichu%20(Ash)","no":172,"primary":"Pichu (Ash)","names":["Pichu (Ash)","Pichu Original Cap"],"old":{"Pichu (Ash)":"pokemon:172:standard:legacy:Pichu%20(Ash)","Pichu Original Cap":"pokemon:172:standard:legacy:Pichu%20Original%20Cap"}},{"id":"pokemon:172:standard:legacy:Pichu%20(Cherry%20Blossom)","no":172,"primary":"Pichu (Cherry Blossom)","names":["Pichu (Cherry Blossom)","Pichu Cherry Blossoms"],"old":{"Pichu (Cherry Blossom)":"pokemon:172:standard:legacy:Pichu%20(Cherry%20Blossom)","Pichu Cherry Blossoms":"pokemon:172:standard:legacy:Pichu%20Cherry%20Blossoms"}},{"id":"pokemon:172:standard:legacy:Pichu%20(Winter)","no":172,"primary":"Pichu (Winter)","names":["Pichu (Winter)","Pichu Beanie"],"old":{"Pichu (Winter)":"pokemon:172:standard:legacy:Pichu%20(Winter)","Pichu Beanie":"pokemon:172:standard:legacy:Pichu%20Beanie"}},{"id":"pokemon:194:standard:legacy:Wooper%20(Cap)","no":194,"primary":"Wooper (Cap)","names":["Wooper (Cap)","Wooper Fashionable"],"old":{"Wooper (Cap)":"pokemon:194:standard:legacy:Wooper%20(Cap)","Wooper Fashionable":"pokemon:194:standard:legacy:Wooper%20Fashionable"}},{"id":"pokemon:196:standard:legacy:Espeon%20(Scarf)","no":196,"primary":"Espeon (Scarf)","names":["Espeon (Scarf)","Espeon Day Scarf"],"old":{"Espeon (Scarf)":"pokemon:196:standard:legacy:Espeon%20(Scarf)","Espeon Day Scarf":"pokemon:196:standard:legacy:Espeon%20Day%20Scarf"}},{"id":"pokemon:197:standard:legacy:Umbreon%20(Scarf)","no":197,"primary":"Umbreon (Scarf)","names":["Umbreon (Scarf)","Umbreon Night Scarf"],"old":{"Umbreon (Scarf)":"pokemon:197:standard:legacy:Umbreon%20(Scarf)","Umbreon Night Scarf":"pokemon:197:standard:legacy:Umbreon%20Night%20Scarf"}},{"id":"pokemon:215:standard:legacy:Sneasel%20(Hipster)","no":215,"primary":"Sneasel (Hipster)","names":["Sneasel (Hipster)","Sneasel Fashion"],"old":{"Sneasel (Hipster)":"pokemon:215:standard:legacy:Sneasel%20(Hipster)","Sneasel Fashion":"pokemon:215:standard:legacy:Sneasel%20Fashion"}},{"id":"pokemon:225:standard:legacy:Delibird%20(Bow)","no":225,"primary":"Delibird (Bow)","names":["Delibird (Bow)","Delibird Holidays"],"old":{"Delibird (Bow)":"pokemon:225:standard:legacy:Delibird%20(Bow)","Delibird Holidays":"pokemon:225:standard:legacy:Delibird%20Holidays"}},{"id":"pokemon:263:standard:legacy:G_%20Zigzagoon%20(Meloetta%20Hat)","no":263,"primary":"G_ Zigzagoon (Meloetta Hat)","names":["G_ Zigzagoon (Meloetta Hat)","Zigzagoon Galarian GO Fest 2021"],"old":{"G_ Zigzagoon (Meloetta Hat)":"pokemon:263:standard:legacy:G_%20Zigzagoon%20(Meloetta%20Hat)","Zigzagoon Galarian GO Fest 2021":"pokemon:263:standard:legacy:Zigzagoon%20Galarian%20GO%20Fest%202021"}},{"id":"pokemon:282:standard:legacy:Gardevoir%20(Meloetta%20Hat)","no":282,"primary":"Gardevoir (Meloetta Hat)","names":["Gardevoir (Meloetta Hat)","Gardevoir GO Fest 2021"],"old":{"Gardevoir (Meloetta Hat)":"pokemon:282:standard:legacy:Gardevoir%20(Meloetta%20Hat)","Gardevoir GO Fest 2021":"pokemon:282:standard:legacy:Gardevoir%20GO%20Fest%202021"}},{"id":"pokemon:330:standard:legacy:Flygon%20(Meloetta%20Hat)","no":330,"primary":"Flygon (Meloetta Hat)","names":["Flygon (Meloetta Hat)","Flygon GO Fest 2021"],"old":{"Flygon (Meloetta Hat)":"pokemon:330:standard:legacy:Flygon%20(Meloetta%20Hat)","Flygon GO Fest 2021":"pokemon:330:standard:legacy:Flygon%20GO%20Fest%202021"}},{"id":"pokemon:355:standard:legacy:Duskull%20(Cempasuchil)","no":355,"primary":"Duskull (Cempasuchil)","names":["Duskull (Cempasuchil)","Duskull Cempasuchil Crown"],"old":{"Duskull (Cempasuchil)":"pokemon:355:standard:legacy:Duskull%20(Cempasuchil)","Duskull Cempasuchil Crown":"pokemon:355:standard:legacy:Duskull%20Cempasuchil%20Crown"}},{"id":"pokemon:359:standard:legacy:Absol%20(Fashion)","no":359,"primary":"Absol (Fashion)","names":["Absol (Fashion)","Absol Fashionable Costume"],"old":{"Absol (Fashion)":"pokemon:359:standard:legacy:Absol%20(Fashion)","Absol Fashionable Costume":"pokemon:359:standard:legacy:Absol%20Fashionable%20Costume"}},{"id":"pokemon:393:standard:legacy:Piplup%20(Halloween)","no":393,"primary":"Piplup (Halloween)","names":["Piplup (Halloween)","Piplup Halloween Mischief"],"old":{"Piplup (Halloween)":"pokemon:393:standard:legacy:Piplup%20(Halloween)","Piplup Halloween Mischief":"pokemon:393:standard:legacy:Piplup%20Halloween%20Mischief"}},{"id":"pokemon:426:standard:legacy:Drifblim%20(Halloween)","no":426,"primary":"Drifblim (Halloween)","names":["Drifblim (Halloween)","Drifblim Halloween Mischief"],"old":{"Drifblim (Halloween)":"pokemon:426:standard:legacy:Drifblim%20(Halloween)","Drifblim Halloween Mischief":"pokemon:426:standard:legacy:Drifblim%20Halloween%20Mischief"}},{"id":"pokemon:453:standard:legacy:Croagunk%20(Cap)","no":453,"primary":"Croagunk (Cap)","names":["Croagunk (Cap)","Croagunk Backwards Cap"],"old":{"Croagunk (Cap)":"pokemon:453:standard:legacy:Croagunk%20(Cap)","Croagunk Backwards Cap":"pokemon:453:standard:legacy:Croagunk%20Backwards%20Cap"}},{"id":"pokemon:522:standard:legacy:Blitzle%20(Collar)","no":522,"primary":"Blitzle (Collar)","names":["Blitzle (Collar)","Blitzle Fashionable"],"old":{"Blitzle (Collar)":"pokemon:522:standard:legacy:Blitzle%20(Collar)","Blitzle Fashionable":"pokemon:522:standard:legacy:Blitzle%20Fashionable"}},{"id":"pokemon:613:standard:legacy:Cubchoo%20(Bow)","no":613,"primary":"Cubchoo (Bow)","names":["Cubchoo (Bow)","Cubchoo Holidays"],"old":{"Cubchoo (Bow)":"pokemon:613:standard:legacy:Cubchoo%20(Bow)","Cubchoo Holidays":"pokemon:613:standard:legacy:Cubchoo%20Holidays"}},{"id":"pokemon:656:standard:legacy:Froakie%20(Halloween)","no":656,"primary":"Froakie (Halloween)","names":["Froakie (Halloween)","Froakie Witch Hat"],"old":{"Froakie (Halloween)":"pokemon:656:standard:legacy:Froakie%20(Halloween)","Froakie Witch Hat":"pokemon:656:standard:legacy:Froakie%20Witch%20Hat"}},{"id":"pokemon:710:standard:legacy:Pumpkaboo%20Average%20Size","no":710,"primary":"Pumpkaboo Average Size","names":["Pumpkaboo Average Size","Pumpkaboo - Average"],"old":{"Pumpkaboo Average Size":"pokemon:710:standard:legacy:Pumpkaboo%20Average%20Size","Pumpkaboo - Average":"pokemon:710:standard:legacy:Pumpkaboo%20-%20Average"}},{"id":"pokemon:710:standard:legacy:Pumpkaboo%20Small%20Size","no":710,"primary":"Pumpkaboo Small Size","names":["Pumpkaboo Small Size","Pumpkaboo - Small"],"old":{"Pumpkaboo Small Size":"pokemon:710:standard:legacy:Pumpkaboo%20Small%20Size","Pumpkaboo - Small":"pokemon:710:standard:legacy:Pumpkaboo%20-%20Small"}},{"id":"pokemon:710:standard:legacy:Pumpkaboo%20Large%20Size","no":710,"primary":"Pumpkaboo Large Size","names":["Pumpkaboo Large Size","Pumpkaboo - Large"],"old":{"Pumpkaboo Large Size":"pokemon:710:standard:legacy:Pumpkaboo%20Large%20Size","Pumpkaboo - Large":"pokemon:710:standard:legacy:Pumpkaboo%20-%20Large"}},{"id":"pokemon:710:standard:legacy:Pumpkaboo%20Super%20Size","no":710,"primary":"Pumpkaboo Super Size","names":["Pumpkaboo Super Size","Pumpkaboo - Super"],"old":{"Pumpkaboo Super Size":"pokemon:710:standard:legacy:Pumpkaboo%20Super%20Size","Pumpkaboo - Super":"pokemon:710:standard:legacy:Pumpkaboo%20-%20Super"}},{"id":"pokemon:25:costume:PIKACHU_WINTER_2020","no":25,"primary":"Pikachu (Holiday 2020)","names":["Pikachu (Holiday 2020)","Pikachu Winter Carnival Outfit","Pikachu (Holiday 2022)","Pikachu (Holiday 2024)"],"old":{"Pikachu (Holiday 2020)":"pokemon:25:standard:legacy:Pikachu%20(Holiday%202020)","Pikachu Winter Carnival Outfit":"pokemon:25:standard:legacy:Pikachu%20Winter%20Carnival%20Outfit","Pikachu (Holiday 2022)":"pokemon:25:standard:legacy:Pikachu%20(Holiday%202022)","Pikachu (Holiday 2024)":"pokemon:25:standard:legacy:Pikachu%20(Holiday%202024)"}},{"id":"pokemon:25:costume:halloween-2021","no":25,"primary":"Pikachu (Halloween 2021)","names":["Pikachu (Halloween 2021)","Pikachu Halloween Mischief","Pikachu (Halloween 2022)"],"old":{"Pikachu (Halloween 2021)":"pokemon:25:standard:legacy:Pikachu%20(Halloween%202021)","Pikachu Halloween Mischief":"pokemon:25:standard:legacy:Pikachu%20Halloween%20Mischief","Pikachu (Halloween 2022)":"pokemon:25:standard:legacy:Pikachu%20(Halloween%202022)"}},{"id":"pokemon:25:standard:legacy:Pikachu%20(Witch)","no":25,"primary":"Pikachu (Witch)","names":["Pikachu (Witch)","Pikachu (Halloween 2024)"],"old":{"Pikachu (Witch)":"pokemon:25:standard:legacy:Pikachu%20(Witch)","Pikachu (Halloween 2024)":"pokemon:25:standard:legacy:Pikachu%20(Halloween%202024)"}}]);
  const catalogIdentityDefinitions=Object.freeze([...VERIFIED_IDENTITIES,...LEGACY_LABEL_CORRECTIONS,...REVIEWED_FORM_ALIASES,...REVIEWED_PICKER_ALIASES.map(row=>identity(row.id,'',row.primary,row.names,row.names.filter(name=>/New Years?/.test(name)).map(name=>name.replace(/New Years?/,"New Year's")),row.no))]);
  // These definitions are immutable. Index once instead of repeatedly scanning
  // and normalizing every alias while constructing a large list's catalog.
  const definitionById=new Map(),legacyIdByName=new Map(),legacyIdsByCanonical=new Map();
  for(const def of catalogIdentityDefinitions)if(!definitionById.has(def.catalogId))definitionById.set(def.catalogId,def);
  for(const row of REVIEWED_PICKER_ALIASES){
    const ids=legacyIdsByCanonical.get(row.id)||[];ids.push(...Object.values(row.old));legacyIdsByCanonical.set(row.id,ids);
    for(const [label,id] of Object.entries(row.old)){const key=normalizeCatalogKey(label);if(!legacyIdByName.has(key))legacyIdByName.set(key,id);}
  }
  function legacyCatalogIdForName(name){return legacyIdByName.get(normalizeCatalogKey(name))||'';}
  function legacyCatalogIds(catalogId){return [...(legacyIdsByCanonical.get(catalogId)||[])];}


  const UNRESOLVED_COSTUME_KEYS=Object.freeze([

    'Pikachu (Victor)','Pikachu (Gloria)',
    'Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)'
  ]);

  const verifiedAliasIndex=new Map();
  const verifiedIdentityByCatalogKey=new Map();
  catalogIdentityDefinitions.forEach(def=>def.aliases.forEach(alias=>{
    const key=normalizeCatalogKey(alias),prior=verifiedAliasIndex.get(key);
    if(prior&&prior.catalogId!==def.catalogId)throw new Error(`Ambiguous Pokemon catalog alias: ${alias}`);
    verifiedAliasIndex.set(key,def);
  }));
  catalogIdentityDefinitions.forEach(def=>verifiedIdentityByCatalogKey.set(normalizeCatalogKey(def.catalogId),def));
  // Only approved aliases participate. Ambiguous token sets remain unresolved;
  // years, gender, region, form and costume descriptors are never discarded.
  function semanticAliasKey(value){return String(value||'').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/\bnew years?\b/g,'new year').replace(/[^a-z0-9!?]+/g,' ').trim().split(/\s+/).sort().join(' ');}
  const semanticAliasIndex=new Map();
  catalogIdentityDefinitions.forEach(def=>def.aliases.forEach(alias=>{
    const key=semanticAliasKey(alias);
    if(!semanticAliasIndex.has(key))semanticAliasIndex.set(key,def);
    else if(semanticAliasIndex.get(key)?.catalogId!==def.catalogId)semanticAliasIndex.set(key,null);
  }));
  function catalogDefinition(value){return verifiedAliasIndex.get(normalizeCatalogKey(value))||semanticAliasIndex.get(semanticAliasKey(value))||null;}


  const verifiedMissingEntries=Object.freeze([
    Object.freeze({"no":555,"name":"Darmanitan (Zen Mode)","displayName":"Darmanitan (Zen Mode)","users":{}}),
    Object.freeze({"no":555,"name":"Darmanitan (Galarian Zen Mode)","displayName":"Darmanitan (Galarian Zen Mode)","users":{}}),
    Object.freeze({"no":658,"name":"Ash-Greninja","displayName":"Ash-Greninja","users":{}}),
    Object.freeze({"no":800,"name":"Ultra Necrozma","displayName":"Ultra Necrozma","users":{}}),
    Object.freeze({"no":875,"name":"Eiscue (Noice Face)","displayName":"Eiscue (Noice Face)","users":{}}),
    Object.freeze({"no":25,"name":"Pikachu (Hat and Capelet)","displayName":"Pikachu (Hat and Capelet)","users":{}}),
    Object.freeze({"no":41,"name":"Zubat (Top Hat)","displayName":"Zubat (Top Hat)","users":{}}),
    Object.freeze({"no":854,"name":"Sinistea (Bow, Phony)","displayName":"Sinistea (Bow, Phony)","users":{}}),
    Object.freeze({"no":854,"name":"Sinistea (Bow, Antique)","displayName":"Sinistea (Bow, Antique)","users":{}}),
    Object.freeze({no:25,name:'Pikachu (Orange Hanbok)',displayName:'Pikachu (Orange Hanbok)',users:{}}),
    Object.freeze({no:4,name:"Charmander (Friede's Goggles)",displayName:"Charmander (Friede's Goggles)",users:{}}),
    Object.freeze({no:5,name:"Charmeleon (Friede's Goggles)",displayName:"Charmeleon (Friede's Goggles)",users:{}}),
    Object.freeze({no:6,name:"Charizard (Friede's Goggles)",displayName:"Charizard (Friede's Goggles)",users:{}}),
    Object.freeze({no:25,name:'Pikachu (PokeXciting Turquoise)',displayName:'Pikachu (PokeXciting Turquoise)',users:{}}),
    Object.freeze({no:25,name:'Pikachu (PokeXciting Blue)',displayName:'Pikachu (PokeXciting Blue)',users:{}}),
    Object.freeze({no:25,name:'Pikachu (Astronaut)',displayName:'Pikachu (Astronaut)',users:{}}),
    Object.freeze({
      no:25,
      name:"Pikachu (Professor Willow's Assistant)",
      displayName:"Pikachu (Professor Willow's Assistant)",
      users:{},
      goFormId:'PIKACHU_ANNIVERSARY_2026',
      goCostumeId:'PIKACHU_ANNIVERSARY_2026'
    }),
    Object.freeze({
      no:25,
      name:'Pikachu (Cosmog Spacesuit)',
      displayName:'Pikachu (Cosmog Spacesuit)',
      users:{},
      goFormId:'PIKACHU_PXP_2026',
      goCostumeId:'PIKACHU_PXP_2026'
    }),
    Object.freeze({
      no:25,
      name:'Pikachu (Worlds 2026)',
      displayName:'Pikachu (Worlds 2026)',
      users:{},
      goFormId:'PIKACHU_WCS_2026',
      goCostumeId:'PIKACHU_WCS_2026'
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
    const def=catalogDefinition(entry.name);
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
      const rows=groups.get(catalogId),def=definitionById.get(catalogId);
      const primary=(def&&rows.find(row=>row.name===def.primary))||rows[0];
      const legacyAliases=Object.freeze([...new Set(rows.flatMap(row=>row.legacyAliases||[row.name]))]);
      const searchAliases=Object.freeze([...new Set(rows.flatMap(row=>row.searchAliases||[]))]);
      const spriteLookupKeys=Object.freeze([...new Set(rows.flatMap(row=>row.spriteLookupKeys||[row.name]))]);
      return{...primary,legacyAliases,searchAliases,spriteLookupKeys,sourceRows:Object.freeze(rows.map(row=>row.name))};
    });
  }

  function resolveLegacyKey(value){
    const raw=String(value||'').normalize('NFKC').trim();if(!raw)return null;
    const def=catalogDefinition(raw);
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
  const legendaryEntries=[
    [144,'Articuno'],[144,'G-Articuno','Galarian Articuno'],[145,'Zapdos'],[145,'G-Zapdos','Galarian Zapdos'],[146,'Moltres'],[146,'G-Moltres','Galarian Moltres'],[150,'Mewtwo'],[151,'Mew'],
    [243,'Raikou'],[244,'Entei'],[245,'Suicune'],[249,'Lugia'],[250,'Ho-Oh'],[251,'Celebi'],
    [377,'Regirock'],[378,'Regice'],[379,'Registeel'],[380,'Latias'],[381,'Latios'],[382,'Kyogre'],[383,'Groudon'],[384,'Rayquaza'],[385,'Jirachi'],
    // Deoxys — Normal + Attack/Defense/Speed Forme (all tradeable in GO)
    [386,'Deoxys (Normal)'],[386,'Deoxys (Attack)'],[386,'Deoxys (Defense)'],[386,'Deoxys (Speed)'],
    [480,'Uxie'],[481,'Mesprit'],[482,'Azelf'],
    // Sinnoh creation trio — Dialga & Palkia got Hisuian Origin Formes; Giratina has Altered + Origin
    [483,'Dialga'],[483,'Dialga (Origin)'],
    [484,'Palkia'],[484,'Palkia (Origin)'],
    [485,'Heatran'],[486,'Regigigas'],
    [487,'Giratina (Altered)'],[487,'Giratina (Origin)'],
    [488,'Cresselia'],[489,'Phione'],[490,'Manaphy'],[491,'Darkrai'],
    [492,'Shaymin (Land)'],[492,'Shaymin (Sky)'],
    [493,'Arceus'],
    [638,'Cobalion'],[639,'Terrakion'],[640,'Virizion'],
    // Kami trio — Incarnate + Therian
    [641,'Tornadus (Incarnate)'],[641,'Tornadus (Therian)'],
    [642,'Thundurus (Incarnate)'],[642,'Thundurus (Therian)'],
    [643,'Reshiram'],[644,'Zekrom'],
    [645,'Landorus (Incarnate)'],[645,'Landorus (Therian)'],
    [646,'Kyurem'],
    [647,'Keldeo (Ordinary)'],[647,'Keldeo (Resolute)'],
    [648,'Meloetta'],[649,'Genesect'],
    [716,'Xerneas'],[717,'Yveltal'],
    // Zygarde — 10% / 50% / Complete
    [718,'Zygarde (50%)'],[718,'Zygarde (10%)'],[718,'Zygarde (Complete)'],
    [719,'Diancie'],
    [720,'Hoopa (Confined)'],[720,'Hoopa (Unbound)'],
    [721,'Volcanion'],
    [772,'Type: Null'],[773,'Silvally'],[785,'Tapu Koko'],[786,'Tapu Lele'],[787,'Tapu Bulu'],[788,'Tapu Fini'],[789,'Cosmog'],[790,'Cosmoem'],[791,'Solgaleo'],[792,'Lunala'],[793,'Nihilego'],[794,'Buzzwole'],[795,'Pheromosa'],[796,'Xurkitree'],[797,'Celesteela'],[798,'Kartana'],[799,'Guzzlord'],
    // Necrozma — base + fused Dusk Mane (Solgaleo) / Dawn Wings (Lunala)
    [800,'Necrozma'],[800,'Necrozma (Dusk Mane)'],[800,'Necrozma (Dawn Wings)'],
    [801,'Magearna'],[802,'Marshadow'],
    // Ultra Beasts released after Marshadow (Ultra Sun / Ultra Moon batch)
    [803,'Poipole'],[804,'Naganadel'],[805,'Stakataka'],[806,'Blacephalon'],
    [807,'Zeraora'],[808,'Meltan'],[809,'Melmetal'],
    // Zacian / Zamazenta — Hero + Crowned forms
    [888,'Zacian (Hero)'],[888,'Zacian (Crowned)'],
    [889,'Zamazenta (Hero)'],[889,'Zamazenta (Crowned)'],
    [890,'Eternatus'],[891,'Kubfu'],[892,'Urshifu'],[893,'Zarude'],[894,'Regieleki'],[895,'Regidrago'],[896,'Glastrier'],[897,'Spectrier'],
    // Calyrex — base + Ice Rider (Glastrier-fused) / Shadow Rider (Spectrier-fused)
    [898,'Calyrex'],[898,'Calyrex (Ice Rider)'],[898,'Calyrex (Shadow Rider)'],
    [905,'Enamorus (Incarnate)'],[905,'Enamorus (Therian)'],
    [1001,'Wo-Chien'],[1002,'Chien-Pao'],[1003,'Ting-Lu'],[1004,'Chi-Yu'],[1007,'Koraidon'],[1008,'Miraidon'],[1009,'Walking Wake'],[1010,'Iron Leaves'],[1014,'Okidogi'],[1015,'Munkidori'],[1016,'Fezandipiti'],
    // Ogerpon — four masks
    [1017,'Ogerpon (Teal Mask)'],[1017,'Ogerpon (Wellspring Mask)'],[1017,'Ogerpon (Hearthflame Mask)'],[1017,'Ogerpon (Cornerstone Mask)'],
    [1020,'Gouging Fire'],[1021,'Raging Bolt'],[1022,'Iron Boulder'],[1023,'Iron Crown'],[1024,'Terapagos'],[1025,'Pecharunt']
  ].map(([no,name,displayName])=>({no,name,displayName:displayName||name,users:{}}));
  root.pokemonCatalog=Object.freeze({
    legendaryEntries,
    VERIFIED_IDENTITIES,
    UNRESOLVED_COSTUME_KEYS,
    verifiedMissingEntries,
    normalizeCatalogKey,
    legacyCatalogIdForName,
    legacyCatalogIds,
    fallbackCatalogId,
    decorateCatalogEntry,
    canonicalizeEntries,
    resolveLegacyKey,
    catalogKey,
    entryMap,
    entryForLegacyKey
  });
})(window);
