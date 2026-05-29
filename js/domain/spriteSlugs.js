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
    REGIONAL_SLUG_MAP,
    pokemondbSlug
  });
})(window);
