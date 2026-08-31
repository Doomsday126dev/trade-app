(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  // Background artwork is opt-in and exact-ID only. Keep this registry empty
  // until a reviewed, distributable asset is approved for a canonical ID.
  const APPROVED_ARTWORK=Object.freeze({});
  const ID_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function resolve(id){
    const normalized=String(id||'').trim().toLowerCase();
    if(!ID_RE.test(normalized))return null;
    return APPROVED_ARTWORK[normalized]||null;
  }
  function className(visual){return visual?'background-artwork-exact':'';}
  function style(visual){
    if(!visual)return'';
    return`--background-artwork:url("${visual.assetUrl}")`;
  }
  root.backgroundVisual=Object.freeze({schemaVersion:2,resolve,className,style,approvedArtwork:APPROVED_ARTWORK});
})(window);
