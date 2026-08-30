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
    return String(s||'').toLowerCase().replace(/[._-]+/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  }
  const SPRITE_SOURCE_REGISTRY=Object.freeze([
    Object.freeze({id:'pokeapi',name:'PokéAPI sprite repository',homepage:'https://pokeapi.co/',role:'Base, form, regional, and gender sprites',fallback:true,hosts:Object.freeze(['raw.githubusercontent.com'])}),
    Object.freeze({id:'pokemondb-home',name:'Pokémon Database',homepage:'https://pokemondb.net/',role:'Pokémon HOME form and gender fallback renders',fallback:true,hosts:Object.freeze(['img.pokemondb.net'])}),
    Object.freeze({id:'pokemondb-go',name:'Pokémon Database GO sprites',homepage:'https://pokemondb.net/',role:'Reviewed source for self-hosted exact Pokémon GO costume sprites',fallback:false,hosts:Object.freeze([]),localPrefix:'assets/sprites/go/'}),
    Object.freeze({id:'weserv',name:'weserv.nl image proxy',homepage:'https://images.weserv.nl/',role:'Legacy export transport restricted to validated Pokémon Database sprite targets',fallback:false,hosts:Object.freeze(['images.weserv.nl'])})
  ]);
  const CANONICAL_SPRITE_OVERRIDES=Object.freeze({});
  const UNRESOLVED_SPRITE_KEYS=Object.freeze([
    'Pikachu (Halloween 2022)','Pikachu (Holiday 2022)',
    'Pikachu (Victor)','Pikachu (Gloria)','Pikachu (Halloween 2024)',
    'Pikachu (Holiday 2024)','Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)',
    "Pikachu (Professor Willow's Assistant)",'Pikachu (Cosmog Spacesuit)','Pikachu (Worlds 2026)'
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
      .replace(/^basculin-(red|blue|white)$/,'basculin-$1-striped')           // Basculin needs "-striped"
      .replace(/^flabebe-(red|yellow|orange|blue|white)-flower$/,'flabebe-$1')// Flabébé drops " Flower"
      .replace(/^oricorio-pa-u$/,'oricorio-pau')                              // Pa'u → pau
      .replace(/^shellos-pink$/,'shellos-west')                               // PokemonDB uses sea names
      .replace(/^shellos-blue$/,'shellos-east');
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
    return withoutRegion.replace(/\s*\([^)]*\)\s*$/,'').trim()||display;
  }
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
  function publicSpriteUrls(name='',gender='',no=0){
    const display=publicSpriteDisplayName(name),base=publicSpriteBaseName(display),urls=[];
    const reviewed=root.costumeSpriteCatalog?.resolution?.({names:[name,display],gender});
    if(reviewed?.knownVariant)return reviewed.urls;
    const dex=Number.parseInt(no,10);
    const isPlainSpecies=normalizeSpriteKey(display)===normalizeSpriteKey(base);
    const pushPokeapi=(candidateGender='')=>{
      if(!Number.isInteger(dex)||dex<=0||!isPlainSpecies)return;
      const genderPath=candidateGender==='f'?'female/':'';
      const url=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${genderPath}${dex}.png`;
      if(spriteSourceForUrl(url)?.id==='pokeapi'&&!urls.includes(url))urls.push(url);
    };
    const push=(candidate,candidateGender='')=>{
      const slug=pokemondbSlug(candidate,candidate,candidateGender);
      const url=slug?`https://img.pokemondb.net/sprites/home/normal/${slug}.png`:'';
      if(url&&spriteSourceForUrl(url)?.id==='pokemondb-home'&&!urls.includes(url))urls.push(url);
    };
    if(gender==='f')pushPokeapi('f');
    pushPokeapi();
    if(gender==='f')push(display,'f');
    push(display);
    if(base!==display){
      if(gender==='f')push(base,'f');
      push(base);
    }
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
    publicSpriteDisplayName,
    publicSpriteBaseName,
    publicSpriteDex,
    publicSpriteUrls
  });
})(window);
