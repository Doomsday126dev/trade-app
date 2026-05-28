(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function _phoneticCode(s){
    // Simple phonetic normalization: strip vowels except leading, collapse similar consonants
    return String(s||'').toLowerCase()
      .replace(/[^a-z]/g,'')
      .replace(/ph/g,'f').replace(/ck/g,'k').replace(/qu/g,'kw').replace(/x/g,'ks')
      .replace(/(.)\1+/g,'$1') // collapse doubles
      .replace(/([^aeiouy])[aeiouy]+/g,'$1') // strip vowels after consonants
      .replace(/y/g,'i');
  }
  function _levenshtein(a,b){
    if(a===b)return 0;
    const m=a.length,n=b.length;
    if(!m)return n;if(!n)return m;
    const prev=Array(n+1).fill(0).map((_,i)=>i);
    for(let i=1;i<=m;i++){
      let curr=[i];
      for(let j=1;j<=n;j++){
        const cost=a[i-1]===b[j-1]?0:1;
        curr[j]=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+cost);
      }
      for(let j=0;j<=n;j++)prev[j]=curr[j];
    }
    return prev[n];
  }

  root.fuzzyText=Object.freeze({
    _phoneticCode,
    _levenshtein
  });
})(window);
