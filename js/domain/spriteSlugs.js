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
    Object.freeze({id:'pokeminers',name:'PokeMiners asset repository',homepage:'https://github.com/PokeMiners/pogo_assets',role:'Pokémon GO species and Unown assets',fallback:true,hosts:Object.freeze(['raw.githubusercontent.com'])}),
    Object.freeze({id:'serebii-go',name:'Serebii Pokémon GO Pokédex',homepage:'https://www.serebii.net/pokemongo/',role:'Verified Pokémon GO costume sprites and final visual fallback',fallback:true,hosts:Object.freeze(['www.serebii.net','serebii.net'])}),
    Object.freeze({id:'pokemon-go-hub-legacy',name:'Pokémon GO Hub legacy sprite archive',homepage:'https://pokemongohub.net/',role:'Exact legacy costume assets retained for compatibility',fallback:true,hosts:Object.freeze(['cdn08.net'])}),
    Object.freeze({id:'weserv',name:'weserv.nl image proxy',homepage:'https://images.weserv.nl/',role:'CORS image proxy used only for local optical-bound detection and exports',fallback:false,hosts:Object.freeze(['images.weserv.nl'])})
  ]);
  const CANONICAL_SPRITE_OVERRIDES=Object.freeze({
    'pokemon:25:costume:PIKACHU_COSTUME_2020':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-flying.png',opticalScale:0.96,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_5TH_ANNIV':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-flying5th.png',opticalScale:0.94,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_OKINAWA':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-okinawaballoons.png',opticalScale:0.91,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_01':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-flyinggreen.png',opticalScale:0.91,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_02':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-flyingpurple.png',opticalScale:0.91,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_03':Object.freeze({sourceId:'pokemon-go-hub-legacy',url:'https://cdn08.net/pokemongo/data/img15/img15561_5.png',opticalScale:0.92,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_FLYING_04':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-indballoon.png',opticalScale:0.91,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_WCS_2025':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-worlds25.png',opticalScale:1,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:costume:PIKACHU_ANNIVERSARY_2026':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-willow.png',opticalScale:1,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:standard:legacy:Pikachu%20(Detective)':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-detective.png',opticalScale:1,opticalOffsetX:0,opticalOffsetY:0}),
    'pokemon:25:standard:legacy:Pikachu%20(Detective%202023)':Object.freeze({sourceId:'serebii-go',url:'https://www.serebii.net/pokemongo/pokemon/025-detective.png',opticalScale:1,opticalOffsetX:0,opticalOffsetY:0})
  });
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
    pokemondbSlug
  });
})(window);
