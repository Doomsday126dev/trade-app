(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};
  const PALETTES=Object.freeze({
    location:Object.freeze([
      Object.freeze(['#0ea5a4','#2563eb','#8b5cf6']),
      Object.freeze(['#0891b2','#0f766e','#84cc16']),
      Object.freeze(['#2563eb','#7c3aed','#db2777']),
      Object.freeze(['#0284c7','#14b8a6','#f59e0b'])
    ]),
    special:Object.freeze([
      Object.freeze(['#7c3aed','#db2777','#f59e0b']),
      Object.freeze(['#4338ca','#0891b2','#22c55e']),
      Object.freeze(['#be123c','#7c3aed','#2563eb']),
      Object.freeze(['#c2410c','#ca8a04','#0f766e'])
    ])
  });
  const PATTERNS=Object.freeze(['horizon','rings','prism','constellation']);
  const ID_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function hash(value){
    let out=2166136261;
    for(const char of String(value||'')){out^=char.charCodeAt(0);out=Math.imul(out,16777619);}
    return out>>>0;
  }
  function resolve(id,record=null){
    const normalized=String(id||'').trim().toLowerCase();
    if(!ID_RE.test(normalized))return null;
    const type=record?.type==='special'?'special':'location';
    const value=hash(normalized),palette=PALETTES[type][value%PALETTES[type].length];
    return Object.freeze({
      id:normalized,
      type,
      pattern:PATTERNS[Math.floor(value/PALETTES[type].length)%PATTERNS.length],
      colorA:palette[0],
      colorB:palette[1],
      colorC:palette[2]
    });
  }
  function className(visual){return visual?`background-visual-${visual.type} background-pattern-${visual.pattern}`:'';}
  function style(visual){
    if(!visual)return'';
    return`--background-visual-a:${visual.colorA};--background-visual-b:${visual.colorB};--background-visual-c:${visual.colorC}`;
  }
  root.backgroundVisual=Object.freeze({schemaVersion:1,resolve,className,style,patterns:PATTERNS});
})(window);
