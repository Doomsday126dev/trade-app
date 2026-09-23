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
    'Pikachu (GO Fest 2023)','Pikachu (GO Fest 2024)',
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
  // Pattern labels identify different eventual Vivillon trades. The supported
  // Scatterbug stage has the same reviewed appearance for each of these IDs.
  const SCATTERBUG_VISUAL_EQUIVALENTS=Object.freeze([
    'Archipelago','Continental','Elegant','Garden','High Plains','Icy Snow','Jungle',
    'Marine','Meadow','Modern','Monsoon','Ocean','Polar','River','Sandstorm',
    'Savanna','Sun','Tundra'
  ]);
  const scatterbugEquivalentNames=new Set(SCATTERBUG_VISUAL_EQUIVALENTS.map(pattern=>normalizeSpriteKey(`Scatterbug (${pattern})`)));
  const SCATTERBUG_EQUIVALENT_URL='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/664.png';
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
    return Number(no)===892&&normalizeSpriteKey(name)==='urshifu gigantamax';
  }
  function verifiedEquivalentSpriteUrl(name='',no=0){
    if(Number(no)===664&&scatterbugEquivalentNames.has(normalizeSpriteKey(name)))return SCATTERBUG_EQUIVALENT_URL;
    // Own-Tempo Rockruff is a distinct trade/evolution identity, not a
    // different-looking Rockruff stage.
    if(Number(no)===744&&normalizeSpriteKey(name)==='rockruff dusk')
      return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/744.png';
    const dynamaxBase=reviewedDynamaxBase(name,no);
    if(!dynamaxBase)return'';
    // Keep real Amped/Low Key and Single/Rapid Strike forms distinct.
    if(spriteSemanticIdentity(dynamaxBase,'',no).explicitForm)
      return publicSpriteUrls(dynamaxBase,'',no)[0]||'';
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${Number(no)}.png`;
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
    592,593,668,678,876
  ]);
  const genderDistinctSpeciesLookup=new Set(GENDER_DISTINCT_SPECIES_IDS);
  function spriteSemanticIdentity(name='',gender='',no=0){
    const display=publicSpriteDisplayName(name),base=publicSpriteBaseName(display);
    const explicitForm=normalizeSpriteKey(display)!==normalizeSpriteKey(base);
    const normalizedGender=gender==='f'?'f':gender==='m'?'m':'';
    const genderDistinct=normalizedGender==='f'&&genderDistinctSpeciesLookup.has(Number.parseInt(no,10));
    return Object.freeze({display,base,gender:normalizedGender,genderDistinct,genderEquivalent:normalizedGender==='f'&&!genderDistinct,explicitForm,exactRequired:explicitForm||genderDistinct});
  }
  const PUBLIC_EXACT_FORM_IDS=Object.freeze({
    'pumpkaboo small':10027,'pumpkaboo large':10028,'pumpkaboo super':10029
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
  function publicSpriteUrls(name='',gender='',no=0){
    const identity=spriteSemanticIdentity(name,gender,no),display=identity.display,base=identity.base,urls=[];
    if(isAmbiguousVisibleForm(name,no))return Object.freeze([]);
    const reviewed=root.costumeSpriteCatalog?.resolution?.({names:[name,display],gender});
    if(reviewed?.knownVariant)return reviewed.urls;
    const equivalent=verifiedEquivalentSpriteUrl(name,no);
    if(equivalent)return Object.freeze([equivalent]);
    const dex=Number.parseInt(no,10);
    const exactId=PUBLIC_EXACT_FORM_IDS[normalizeSpriteKey(display)];
    const pushPokeapi=(candidateGender='',id=dex)=>{
      if(!Number.isInteger(id)||id<=0)return;
      const genderPath=candidateGender==='f'?'female/':'';
      const url=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${genderPath}${id}.png`;
      if(spriteSourceForUrl(url)?.id==='pokeapi'&&!urls.includes(url))urls.push(url);
    };
    const push=(candidate,candidateGender='')=>{
      const slug=pokemondbSlug(candidate,candidate,candidateGender);
      const url=slug?`https://img.pokemondb.net/sprites/home/normal/${slug}.png`:'';
      if(url&&spriteSourceForUrl(url)?.id==='pokemondb-home'&&!urls.includes(url))urls.push(url);
    };
    if(exactId)pushPokeapi('',exactId);
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
    publicSpriteUrls
  });
})(window);
