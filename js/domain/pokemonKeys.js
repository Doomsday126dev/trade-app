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
      return{
        qty:Math.max(0,Math.min(999,parseInt(entry.qty)||0)),
        mirrorOnly,dontNeedBack,giveaway,
        note:String(entry.note||'').slice(0,140),
        mode
      };
    }
    return{qty:Math.max(0,Math.min(999,parseInt(entry)||0)),mirrorOnly:false,dontNeedBack:false,giveaway:false,note:'',mode:'any'};
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
    if(mode==='any')return q;
    const obj={qty:q};
    if(mode==='mirror')obj.mirrorOnly=true;
    else if(mode==='dontNeedBack')obj.dontNeedBack=true;
    else if(mode==='giveaway'){obj.giveaway=true;if(note)obj.note=note;}
    return obj;
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
})(window);
