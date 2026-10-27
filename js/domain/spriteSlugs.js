(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function padDex(no){
    const n=parseInt(no);
    return Number.isFinite(n)?String(n).padStart(3,'0'):'';
  }
  function normalizeCostumeLookupKey(name=''){
    return String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
  }
  function pokemondbGoSpeciesSlug(name=''){
    return String(name||'').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/[.'’]/g,'')
      .replace(/♀|♂/g,'')
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-|-$/g,'');
  }
  function normalizeSpriteKey(s){
    return String(s||'').toLowerCase()
      .replace(/!/g,' exclamation ')
      .replace(/\?/g,' question ')
      .replace(/[._-]+/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  }
  const SPRITE_SOURCE_REGISTRY=Object.freeze([
    Object.freeze({id:'pokeapi',name:'PokéAPI sprite repository',homepage:'https://pokeapi.co/',role:'Base, form, regional, and gender sprites',fallback:true,hosts:Object.freeze(['raw.githubusercontent.com'])}),
    Object.freeze({id:'pokemondb-home',name:'Pokémon Database',homepage:'https://pokemondb.net/',role:'Pokémon HOME form and gender fallback renders',fallback:true,hosts:Object.freeze(['img.pokemondb.net'])}),
    Object.freeze({id:'pokemondb-go',name:'Pokémon Database GO sprites',homepage:'https://pokemondb.net/',role:'Reviewed source for self-hosted exact Pokémon GO costume sprites',fallback:false,hosts:Object.freeze([]),localPrefix:'assets/sprites/go/'}),
    Object.freeze({id:'weserv',name:'weserv.nl image proxy',homepage:'https://images.weserv.nl/',role:'Legacy export transport restricted to validated Pokémon Database sprite targets',fallback:false,hosts:Object.freeze(['images.weserv.nl'])})
  ]);
  const CANONICAL_SPRITE_OVERRIDES=Object.freeze({});
  const UNRESOLVED_SPRITE_KEYS=Object.freeze([
    'Pikachu (Victor)','Pikachu (Gloria)',
    'Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)'
  ]);
  const unresolvedSpriteLookup=new Set(UNRESOLVED_SPRITE_KEYS.map(normalizeSpriteKey));
  function canonicalSpriteOverride(catalogId=''){
    return CANONICAL_SPRITE_OVERRIDES[String(catalogId||'')]||null;
  }
  function isUnresolvedSpriteKey(value=''){
    const reviewed=root.costumeSpriteCatalog?.resolution?.({name:value});
    return reviewed?.knownVariant?reviewed.status==='unavailable':unresolvedSpriteLookup.has(normalizeSpriteKey(value));
  }
  function spriteSourceForUrl(value=''){
    const raw=String(value||'').replace(/^\.\//,'');
    if(raw.startsWith('assets/sprites/go/'))return SPRITE_SOURCE_REGISTRY.find(source=>source.id==='pokemondb-go')||null;
    let host='';try{host=new URL(raw).hostname;}catch{return null;}
    return SPRITE_SOURCE_REGISTRY.find(source=>source.hosts.includes(host))||null;
  }
  const REGIONAL_SLUG_MAP={A:'alolan',G:'galarian',H:'hisuian',P:'paldean'};
  function pokemondbSlug(name,dn,gender=''){
    let s=String(dn||name||'').trim();
    if(!s)return'';
    // "A-Raichu" → "Raichu (Alolan)" intermediate, then normalize
    const regional=s.match(/^([AGHP])-(.+)/);
    if(regional){
      const region=REGIONAL_SLUG_MAP[regional[1]];
      const rest=regional[2];
      // "P-Tauros (Aqua)" → "Tauros (Paldean) (Aqua)" → "tauros-paldean-aqua"
      const m=rest.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if(m){s=`${m[1]} ${region} ${m[2]}`;}
      else{s=`${rest} ${region}`;}
    }else{
      // "Vivillon (Garden)" → "vivillon garden"
      s=s.replace(/\s*\(([^)]+)\)\s*/,' $1 ');
    }
    s=s.replace(/\b(alolan|galarian|hisuian|paldean)\s+forme?\b/gi,'$1');
    // Normalize: lowercase, strip accents, replace special chars
    let slug=s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g,'')  // strip accents é→e
      .replace(/♀|♂/g,'')
      .replace(/['.]/g,'')                              // Mr. Mime, Farfetch'd
      .replace(/[^a-z0-9\s-]/g,' ')
      .replace(/\s+/g,'-')
      .replace(/-+/g,'-')
      .replace(/^-|-$/g,'');
    // PokemonDB HOME naming quirks (verified against actual URLs)
    slug=slug
      .replace(/^basculin-(red|blue|white)(?:-(?:stripe|striped))?$/,'basculin-$1-striped') // Basculin needs "-striped"
      .replace(/^flabebe-(red|yellow|orange|blue|white)-flower$/,'flabebe-$1')// Flabébé drops " Flower"
      .replace(/^oricorio-pa-u$/,'oricorio-pau')                              // Pa'u → pau
      .replace(/^shellos-pink$/,'shellos-west')                               // PokemonDB uses sea names
      .replace(/^shellos-blue$/,'shellos-east')
      .replace(/^cherrim-sunny$/,'cherrim-sunshine');
    // Female gender: append if not already there
    if(gender==='f'&&!/female/.test(slug))slug+='-female';
    return slug;
  }

  const PUBLIC_VIVILLON_PATTERNS=Object.freeze([
    'Archipelago','Continental','Elegant','Fancy','Garden','High Plains','Icy Snow','Jungle',
    'Marine','Meadow','Modern','Monsoon','Ocean','Polar','Poké Ball','Poke Ball','River',
    'Sandstorm','Savanna','Sun','Tundra'
  ]);
  const publicVivillonPatterns=new Map(PUBLIC_VIVILLON_PATTERNS.map(value=>[normalizeSpriteKey(value),value]));
  // Pattern labels identify different eventual Vivillon trades. The supported
  // Scatterbug stage has the same reviewed appearance for each of these IDs.
  const SCATTERBUG_VISUAL_EQUIVALENTS=Object.freeze([
    'Archipelago','Continental','Elegant','Garden','High Plains','Icy Snow','Jungle',
    'Marine','Meadow','Modern','Monsoon','Ocean','Polar','River','Sandstorm',
    'Savanna','Sun','Tundra'
  ]);
  const scatterbugEquivalentNames=new Set(SCATTERBUG_VISUAL_EQUIVALENTS.map(pattern=>normalizeSpriteKey(`Scatterbug (${pattern})`)));
  const SCATTERBUG_EQUIVALENT_URL='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/664.png';
  // Dynamax changes the trade identity and adds the renderer's D badge, but
  // does not change the underlying species/form artwork. Only entries in the
  // generated public Max catalog qualify, including in the anonymous shell
  // (which deliberately does not load the private data.js seed).
  function reviewedDynamaxBase(name='',no=0){
    return root.publicPokemonDex?.dynamaxBase?.(name,no)||'';
  }
  function isAmbiguousVisibleForm(name='',no=0){
    // The selectable legacy key omits Single/Rapid Strike style, whose Gmax
    // artwork differs. Neither style may be guessed from the species number.
    // Generic Spinda also omits its GO pattern; main-series spot art is not
    // a verified substitute. Keep the want/ID and use the existing placeholder.
    return Number(no)===892&&normalizeSpriteKey(name)==='urshifu gigantamax'||Number(no)===327&&normalizeSpriteKey(name)==='spinda';
  }
  function verifiedEquivalentSpriteUrl(name='',no=0,gender='',shiny=false){
    if(Number(no)===664&&scatterbugEquivalentNames.has(normalizeSpriteKey(name)))return shiny?SCATTERBUG_EQUIVALENT_URL.replace('/home/','/home/shiny/'):SCATTERBUG_EQUIVALENT_URL;
    // Own-Tempo Rockruff is a distinct trade/evolution identity, not a
    // different-looking Rockruff stage.
    if(Number(no)===744&&normalizeSpriteKey(name)==='rockruff dusk')
      return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny?'shiny/':''}10151.png`;
    const dynamaxBase=reviewedDynamaxBase(name,no);
    if(!dynamaxBase)return'';
    // Keep real Amped/Low Key and Single/Rapid Strike forms distinct.
    if(spriteSemanticIdentity(dynamaxBase,'',no).explicitForm)
      return publicSpriteUrls(dynamaxBase,gender,no,shiny)[0]||'';
    const genderPath=gender==='f'&&genderDistinctSpeciesLookup.has(Number(no))?'female/':'';
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny?'shiny/':''}${genderPath}${Number(no)}.png`;
  }
  function publicSpriteDisplayName(name=''){
    const raw=String(name||'').normalize('NFKC').trim();
    const pattern=publicVivillonPatterns.get(normalizeSpriteKey(raw));
    return pattern?`Vivillon (${pattern==='Poke Ball'?'Poké Ball':pattern})`:raw;
  }
  function publicSpriteBaseName(name=''){
    const display=publicSpriteDisplayName(name);
    if(/^Vivillon\b/i.test(display))return'Vivillon';
    if(/^Scatterbug\b/i.test(display))return'Scatterbug';
    if(/^Unown\b/i.test(display))return'Unown';
    const regional=display.match(/^[AGHP]-(.+)/i);
    const withoutRegion=regional?regional[1]:display;
    return withoutRegion.replace(/\s*\([^)]*\)\s*$/,'').replace(/\s+-\s+(?:Average|Small|Large|Super)$/i,'').trim()||display;
  }
  // Pinned PokéAPI species metadata plus the audited sprite tree. Female art may
  // fall back to the same-form default only for species outside this set.
  const GENDER_DISTINCT_SPECIES_IDS=Object.freeze([
    3,12,19,20,25,26,41,42,44,45,64,65,84,85,97,111,112,118,119,123,129,130,
    154,165,166,178,185,186,190,194,195,198,202,203,207,208,212,214,215,217,
    221,224,229,232,255,256,257,267,269,272,274,275,307,308,315,316,317,322,
    323,332,350,369,396,397,398,399,400,401,402,403,404,405,407,415,417,418,
    419,424,443,444,445,449,450,453,454,456,457,459,460,461,464,465,473,521,
    592,593,668,678,876,916
  ]);
  const genderDistinctSpeciesLookup=new Set(GENDER_DISTINCT_SPECIES_IDS);
  function spriteSemanticIdentity(name='',gender='',no=0){
    const display=publicSpriteDisplayName(name),base=publicSpriteBaseName(display);
    const explicitForm=normalizeSpriteKey(display)!==normalizeSpriteKey(base);
    const normalizedGender=gender==='f'?'f':gender==='m'?'m':'';
    const genderDistinct=normalizedGender==='f'&&genderDistinctSpeciesLookup.has(Number.parseInt(no,10));
    return Object.freeze({display,base,gender:normalizedGender,genderDistinct,genderEquivalent:normalizedGender==='f'&&!genderDistinct,explicitForm,exactRequired:explicitForm||genderDistinct});
  }
  // Same exact form IDs used by the normal renderer; shared by Shiny and anonymous paths.
  // These are artwork identities, not a release-eligibility allowlist.
  // Same exact form IDs used by the normal renderer; shared by Shiny and anonymous paths.
  // These are artwork identities, not a release-eligibility allowlist.
  const PUBLIC_EXACT_FORM_IDS=Object.freeze({
    "a rattata": 10091,
    "rattata alolan form": 10091,
    "rattata alolan forme": 10091,
    "alolan rattata": 10091,
    "a raichu": 10100,
    "raichu alolan form": 10100,
    "raichu alolan forme": 10100,
    "alolan raichu": 10100,
    "a sandshrew": 10101,
    "sandshrew alolan form": 10101,
    "sandshrew alolan forme": 10101,
    "alolan sandshrew": 10101,
    "a vulpix": 10103,
    "vulpix alolan form": 10103,
    "vulpix alolan forme": 10103,
    "alolan vulpix": 10103,
    "a diglett": 10105,
    "diglett alolan form": 10105,
    "diglett alolan forme": 10105,
    "alolan diglett": 10105,
    "a meowth": 10107,
    "meowth alolan form": 10107,
    "meowth alolan forme": 10107,
    "alolan meowth": 10107,
    "a geodude": 10109,
    "geodude alolan form": 10109,
    "geodude alolan forme": 10109,
    "alolan geodude": 10109,
    "a grimer": 10112,
    "grimer alolan form": 10112,
    "grimer alolan forme": 10112,
    "alolan grimer": 10112,
    "a exeggutor": 10114,
    "exeggutor alolan form": 10114,
    "exeggutor alolan forme": 10114,
    "alolan exeggutor": 10114,
    "a marowak": 10115,
    "marowak alolan form": 10115,
    "marowak alolan forme": 10115,
    "alolan marowak": 10115,
    "g meowth": 10161,
    "meowth galarian form": 10161,
    "meowth galarian forme": 10161,
    "galarian meowth": 10161,
    "g ponyta": 10162,
    "ponyta galarian form": 10162,
    "ponyta galarian forme": 10162,
    "galarian ponyta": 10162,
    "g slowpoke": 10164,
    "slowpoke galarian form": 10164,
    "slowpoke galarian forme": 10164,
    "galarian slowpoke": 10164,
    "g farfetchd": 10166,
    "farfetchd galarian form": 10166,
    "farfetchd galarian forme": 10166,
    "galarian farfetchd": 10166,
    "g weezing": 10167,
    "weezing galarian form": 10167,
    "weezing galarian forme": 10167,
    "galarian weezing": 10167,
    "g mr mime": 10168,
    "mr mime galarian form": 10168,
    "mr mime galarian forme": 10168,
    "galarian mr mime": 10168,
    "g articuno": 10169,
    "articuno galarian form": 10169,
    "articuno galarian forme": 10169,
    "galarian articuno": 10169,
    "g zapdos": 10170,
    "zapdos galarian form": 10170,
    "zapdos galarian forme": 10170,
    "galarian zapdos": 10170,
    "g moltres": 10171,
    "moltres galarian form": 10171,
    "moltres galarian forme": 10171,
    "galarian moltres": 10171,
    "g corsola": 10173,
    "corsola galarian form": 10173,
    "corsola galarian forme": 10173,
    "galarian corsola": 10173,
    "g zigzagoon": 10174,
    "zigzagoon galarian form": 10174,
    "zigzagoon galarian forme": 10174,
    "galarian zigzagoon": 10174,
    "g darumaka": 10176,
    "darumaka galarian form": 10176,
    "darumaka galarian forme": 10176,
    "galarian darumaka": 10176,
    "g yamask": 10179,
    "yamask galarian form": 10179,
    "yamask galarian forme": 10179,
    "galarian yamask": 10179,
    "g stunfisk": 10180,
    "stunfisk galarian form": 10180,
    "stunfisk galarian forme": 10180,
    "galarian stunfisk": 10180,
    "h growlithe": 10229,
    "growlithe hisuian form": 10229,
    "growlithe hisuian forme": 10229,
    "hisuian growlithe": 10229,
    "h voltorb": 10231,
    "voltorb hisuian form": 10231,
    "voltorb hisuian forme": 10231,
    "hisuian voltorb": 10231,
    "h typhlosion": 10233,
    "typhlosion hisuian form": 10233,
    "typhlosion hisuian forme": 10233,
    "hisuian typhlosion": 10233,
    "h qwilfish": 10234,
    "qwilfish hisuian form": 10234,
    "qwilfish hisuian forme": 10234,
    "hisuian qwilfish": 10234,
    "h sneasel": 10235,
    "sneasel hisuian form": 10235,
    "sneasel hisuian forme": 10235,
    "hisuian sneasel": 10235,
    "h samurott": 10236,
    "samurott hisuian form": 10236,
    "samurott hisuian forme": 10236,
    "hisuian samurott": 10236,
    "h lilligant": 10237,
    "lilligant hisuian form": 10237,
    "lilligant hisuian forme": 10237,
    "hisuian lilligant": 10237,
    "h zorua": 10238,
    "zorua hisuian form": 10238,
    "zorua hisuian forme": 10238,
    "hisuian zorua": 10238,
    "h braviary": 10240,
    "braviary hisuian form": 10240,
    "braviary hisuian forme": 10240,
    "hisuian braviary": 10240,
    "h sliggoo": 10241,
    "sliggoo hisuian form": 10241,
    "sliggoo hisuian forme": 10241,
    "hisuian sliggoo": 10241,
    "h avalugg": 10243,
    "avalugg hisuian form": 10243,
    "avalugg hisuian forme": 10243,
    "hisuian avalugg": 10243,
    "h decidueye": 10244,
    "decidueye hisuian form": 10244,
    "decidueye hisuian forme": 10244,
    "hisuian decidueye": 10244,
    "p tauros": 10250,
    "tauros paldean form": 10250,
    "tauros paldean forme": 10250,
    "paldean tauros": 10250,
    "p tauros combat": 10250,
    "tauros combat paldean form": 10250,
    "tauros combat paldean forme": 10250,
    "paldean tauros combat": 10250,
    "p tauros blaze": 10251,
    "tauros blaze paldean form": 10251,
    "tauros blaze paldean forme": 10251,
    "paldean tauros blaze": 10251,
    "p tauros fire": 10251,
    "tauros fire paldean form": 10251,
    "tauros fire paldean forme": 10251,
    "paldean tauros fire": 10251,
    "p tauros aqua": 10252,
    "tauros aqua paldean form": 10252,
    "tauros aqua paldean forme": 10252,
    "paldean tauros aqua": 10252,
    "p tauros water": 10252,
    "tauros water paldean form": 10252,
    "tauros water paldean forme": 10252,
    "paldean tauros water": 10252,
    "p wooper": 10253,
    "wooper paldean form": 10253,
    "wooper paldean forme": 10253,
    "paldean wooper": 10253,
    "castform sunny": 10013,
    "castform rainy": 10014,
    "castform snowy": 10015,
    "unown a": 201,
    "castform normal": 351,
    "burmy plant": 412,
    "wormadam plant": 413,
    "wormadam sandy": 10004,
    "wormadam trash": 10005,
    "cherrim overcast": 421,
    "shellos pink": 422,
    "rotom": 479,
    "rotom heat": 10008,
    "rotom wash": 10009,
    "rotom frost": 10010,
    "rotom fan": 10011,
    "rotom mow": 10012,
    "basculin red stripe": 550,
    "basculin blue stripe": 10016,
    "basculin white stripe": 10247,
    "deerling spring": 585,
    "sawsbuck spring": 586,
    "flabb red flower": 669,
    "pumpkaboo average": 710,
    "pumpkaboo small": 10027,
    "pumpkaboo large": 10028,
    "pumpkaboo super": 10029,
    "oricorio baile": 741,
    "oricorio pom pom": 10123,
    "oricorio pau": 10124,
    "oricorio sensu": 10125,
    "wishiwashi solo": 746,
    "wishiwashi school": 10127,
    "toxtricity amped": 849,
    "toxtricity low key": 10184,
    "squawkabilly green": 931,
    "squawkabilly blue": 10260,
    "squawkabilly yellow": 10261,
    "squawkabilly white": 10262,
    "tatsugiri curly": 978,
    "tatsugiri": 978,
    "tatsugiri droopy": 10258,
    "tatsugiri stretchy": 10259,
    "pikachu libre": 10084,
    "pikachu rock star": 10080,
    "pikachu pop star": 10082,
    "pikachu ph d": 10083,
    "deoxys normal": 386,
    "deoxys attack": 10001,
    "deoxys defense": 10002,
    "deoxys speed": 10003,
    "giratina altered": 487,
    "giratina origin": 10007,
    "shaymin land": 492,
    "shaymin sky": 10006,
    "tornadus incarnate": 641,
    "tornadus therian": 10019,
    "thundurus incarnate": 642,
    "thundurus therian": 10020,
    "landorus incarnate": 645,
    "landorus therian": 10021,
    "keldeo ordinary": 647,
    "keldeo resolute": 10024,
    "zygarde 50": 718,
    "zygarde 10": 10118,
    "zygarde complete": 10120,
    "hoopa confined": 720,
    "hoopa unbound": 10086,
    "necrozma dusk mane": 10155,
    "necrozma dawn wings": 10156,
    "zacian hero": 888,
    "zacian crowned": 10188,
    "zamazenta hero": 889,
    "zamazenta crowned": 10189,
    "calyrex ice rider": 10193,
    "calyrex shadow rider": 10194,
    "dialga origin": 10245,
    "palkia origin": 10246,
    "enamorus incarnate": 905,
    "enamorus therian": 10249,
    "ogerpon teal mask": 1017,
    "ogerpon wellspring mask": 10273,
    "ogerpon hearthflame mask": 10274,
    "ogerpon cornerstone mask": 10275,
    "urshifu rapid strike": 10191,
    "urshifu single strike": 892,
    "a raticate": 10092,
    "raticate alola form": 10092,
    "a sandslash": 10102,
    "sandslash alola form": 10102,
    "a ninetales": 10104,
    "ninetales alola form": 10104,
    "a dugtrio": 10106,
    "dugtrio alola form": 10106,
    "a persian": 10108,
    "persian alola form": 10108,
    "h arcanine": 10230,
    "arcanine hisuian form": 10230,
    "a graveler": 10110,
    "graveler alola form": 10110,
    "a golem": 10111,
    "golem alola form": 10111,
    "g rapidash": 10163,
    "rapidash galarian form": 10163,
    "g slowbro": 10165,
    "slowbro galarian form": 10165,
    "a muk": 10113,
    "muk alola form": 10113,
    "h electrode": 10232,
    "electrode hisuian form": 10232,
    "g slowking": 10172,
    "slowking galarian form": 10172,
    "g linoone": 10175,
    "linoone galarian form": 10175,
    "h zoroark": 10239,
    "zoroark hisuian form": 10239,
    "h goodra": 10242,
    "goodra hisuian form": 10242,
    "venusaur gigantamax": 10195,
    "blastoise gigantamax": 10197,
    "butterfree gigantamax": 10198,
    "pikachu gigantamax": 10199,
    "meowth gigantamax": 10200,
    "machamp gigantamax": 10201,
    "gengar gigantamax": 10202,
    "kingler gigantamax": 10203,
    "lapras gigantamax": 10204,
    "eevee gigantamax": 10205,
    "snorlax gigantamax": 10206,
    "garbodor gigantamax": 10207,
    "melmetal gigantamax": 10208,
    "rillaboom gigantamax": 10209,
    "inteleon gigantamax": 10211,
    "corviknight gigantamax": 10212,
    "orbeetle gigantamax": 10213,
    "drednaw gigantamax": 10214,
    "coalossal gigantamax": 10215,
    "flapple gigantamax": 10216,
    "appletun gigantamax": 10217,
    "sandaconda gigantamax": 10218,
    "toxtricity gigantamax": 10219,
    "centiskorch gigantamax": 10220,
    "hatterene gigantamax": 10221,
    "grimmsnarl gigantamax": 10222,
    "alcremie gigantamax": 10223,
    "duraludon gigantamax": 10225,
    "rockruff dusk": 10151,
    "urshifu single strike style gigantamax": 10226,
    "urshifu rapid strike style gigantamax": 10227,
    "gimmighoul roaming form": 10263
});
  let publicDexDatabase=null,publicDexLookup=null;
  function publicSpriteDex(name='',database=global.POGO_TRADE_DB){
    const generated=root.publicPokemonDex?.dex?.(name)||0;
    if(generated)return generated;
    if(database!==publicDexDatabase||!publicDexLookup){
      publicDexDatabase=database;publicDexLookup=new Map();
      const add=entry=>{
        const no=Number.parseInt(entry?.no,10);if(!Number.isInteger(no)||no<=0)return;
        for(const label of [entry.name,entry.displayName])if(label)publicDexLookup.set(normalizeSpriteKey(label),no);
      };
      if(database&&typeof database==='object')for(const list of [database.wishlist,database.dynamax,database.gmax,database.gigantamax,database.costumes])for(const entry of Array.isArray(list)?list:[])add(entry);
      for(const entry of root.pokemonCatalog?.verifiedMissingEntries||[])add(entry);
    }
    return publicDexLookup.get(normalizeSpriteKey(name))||0;
  }
  // Preferred front PNGs for these size IDs are one shared drawing. Their
  // independently bound HOME models retain the exact size-form artwork.
  function reviewedPreferredForm(name='',no=0){return Number(no)===710&&['Pumpkaboo - Small','Pumpkaboo - Large','Pumpkaboo - Super'].includes(String(name||'').trim());}
  function publicSpriteUrls(name='',gender='',no=0,shiny=false){
    const eligibility=root.publicPokemonDex?.variantStatus?.(name);
    if(eligibility&&gender&&!eligibility.genders.includes(gender))return Object.freeze([]);
    if(eligibility?.assets){const exact=eligibility.assets[shiny?'shiny':'default'];return Object.freeze(exact?[exact]:[]);}
    const identity=spriteSemanticIdentity(name,gender,no),display=identity.display,base=identity.base,urls=[];
    if(isAmbiguousVisibleForm(name,no))return Object.freeze([]);
    const reviewed=root.costumeSpriteCatalog?.resolution?.({names:[name,display],gender,shiny});
    if(reviewed?.knownVariant)return reviewed.urls;
    const equivalent=verifiedEquivalentSpriteUrl(name,no,gender,shiny);
    if(equivalent)return Object.freeze([equivalent]);
    const dex=Number.parseInt(no,10);
    const exactId=PUBLIC_EXACT_FORM_IDS[normalizeSpriteKey(display)];
    const pushPokeapi=(candidateGender='',id=dex)=>{
      if(!Number.isInteger(id)||id<=0)return;
      const genderPath=candidateGender==='f'?'female/':'';
      const url=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny?'shiny/':''}${genderPath}${id}.png`;
      if(spriteSourceForUrl(url)?.id==='pokeapi'&&!urls.includes(url))urls.push(url);
    };
    const push=(candidate,candidateGender='')=>{
      const slug=pokemondbSlug(candidate,candidate,candidateGender);
      const url=slug?`https://img.pokemondb.net/sprites/home/${shiny?'shiny':'normal'}/${slug}.png`:'';
      if(url&&spriteSourceForUrl(url)?.id==='pokemondb-home'&&!urls.includes(url))urls.push(url);
    };
    if(exactId&&!(identity.gender==='f'&&identity.genderDistinct))pushPokeapi('',exactId);
    else if(!identity.explicitForm&&identity.gender==='f'){
      pushPokeapi('f');
      if(identity.genderEquivalent)pushPokeapi();
    }
    else if(!identity.explicitForm)pushPokeapi();
    if(identity.gender==='f'){
      push(display,'f');
      if(identity.genderEquivalent)push(display);
    }else push(display);
    // Exact form/gender requests never fall through to a base or ungendered
    // identity. Exhaustion is presented as unavailable by each renderer.
    if(!identity.exactRequired&&base!==display)push(base);
    return Object.freeze(urls);
  }

  root.spriteSlugs=Object.freeze({
    padDex,
    normalizeCostumeLookupKey,
    pokemondbGoSpeciesSlug,
    normalizeSpriteKey,
    SPRITE_SOURCE_REGISTRY,
    CANONICAL_SPRITE_OVERRIDES,
    UNRESOLVED_SPRITE_KEYS,
    canonicalSpriteOverride,
    isUnresolvedSpriteKey,
    spriteSourceForUrl,
    REGIONAL_SLUG_MAP,
    pokemondbSlug,
    PUBLIC_VIVILLON_PATTERNS,
    SCATTERBUG_VISUAL_EQUIVALENTS,
    reviewedDynamaxBase,
    isAmbiguousVisibleForm,
    verifiedEquivalentSpriteUrl,
    publicSpriteDisplayName,
    publicSpriteBaseName,
    GENDER_DISTINCT_SPECIES_IDS,
    spriteSemanticIdentity,
    PUBLIC_EXACT_FORM_IDS,
    publicSpriteDex,
    publicSpriteUrls,
    reviewedPreferredForm
  });
})(window);
