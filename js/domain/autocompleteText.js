(function(global){
  const root=global.PogoDomain=global.PogoDomain||{};

  function normalizeAcText(s){
    return String(s||'').normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/ph[._\s-]*d/g,'phd')
      .replace(/\b(gmax|gigantamax)\b/g,'gigantamax')
      .replace(/\b(d[ -]?max|dynamax)\b/g,'dynamax')
      .replace(/\bsizzlepede\b/g,'sizzlipede')
      .replace(/\bpika\b/g,'pikachu')
      .replace(/\?/g,' question ')
      .replace(/!/g,' exclamation ')
      .replace(/[^\p{L}\p{N}]+/gu,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  root.autocompleteText=Object.freeze({
    normalizeAcText
  });
})(window);
