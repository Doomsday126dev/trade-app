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
    Object.freeze({id:'pokemondb-go',name:'Pokémon Database GO sprites',homepage:'https://pokemondb.net/',role:'Exact mapped Pokémon GO costume sprites',fallback:true,hosts:Object.freeze(['img.pokemondb.net'])}),
    Object.freeze({id:'weserv',name:'weserv.nl image proxy',homepage:'https://images.weserv.nl/',role:'CORS image proxy used only for local optical-bound detection and exports',fallback:false,hosts:Object.freeze(['images.weserv.nl'])})
  ]);
  const CANONICAL_SPRITE_OVERRIDES=Object.freeze({});
  const UNRESOLVED_SPRITE_KEYS=Object.freeze([
    'Pikachu (Sari)','Pikachu (Halloween 2022)','Pikachu (Holiday 2022)',
    'Pikachu (Victor)','Pikachu (Gloria)','Pikachu (Halloween 2024)',
    'Pikachu (Holiday 2024)','Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)'
  ]);
  const unresolvedSpriteLookup=new Set(UNRESOLVED_SPRITE_KEYS.map(normalizeSpriteKey));
  function canonicalSpriteOverride(catalogId=''){
    return CANONICAL_SPRITE_OVERRIDES[String(catalogId||'')]||null;
  }
  function isUnresolvedSpriteKey(value=''){
    return unresolvedSpriteLookup.has(normalizeSpriteKey(value));
  }
  function spriteSourceForUrl(value=''){
    let host='';try{host=new URL(String(value||'')).hostname;}catch{return null;}
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
  function publicSpriteUrls(name='',gender=''){
    const display=publicSpriteDisplayName(name),base=publicSpriteBaseName(display),urls=[];
    const push=(candidate,candidateGender='')=>{
      const slug=pokemondbSlug(candidate,candidate,candidateGender);
      const url=slug?`https://img.pokemondb.net/sprites/home/normal/${slug}.png`:'';
      if(url&&spriteSourceForUrl(url)?.id==='pokemondb-home'&&!urls.includes(url))urls.push(url);
    };
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
    publicSpriteUrls
  });
})(window);
