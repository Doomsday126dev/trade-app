(function(global){
  const root = global.PogoUi = global.PogoUi || {};
  const searchStrings = global.PogoDomain && global.PogoDomain.searchStrings;
  if(!searchStrings)throw new Error('Search string helpers must load before string HTML helpers');
  const {strLenInfo,POGO_STR_LIMIT}=searchStrings;

  function strLenHtml(str){
    const{len,cls}=strLenInfo(str);
    const limit=POGO_STR_LIMIT;
    return `<span class="str-meta ${cls}" title="PoGo search limit is ~${limit} chars">${len}/${limit}</span>`;
  }
  function strWarnHtml(str){
    const{len,cls}=strLenInfo(str);
    if(!cls)return'';
    if(cls==='danger')return `<div class="str-warn-banner danger">⚠️ This string exceeds PoGo's ~${POGO_STR_LIMIT} char limit (${len}). It will be truncated in-game. Consider splitting into multiple priority lists.</div>`;
    return `<div class="str-warn-banner">⚠️ Approaching PoGo's ~${POGO_STR_LIMIT} char limit (${len}). Consider splitting soon.</div>`;
  }

  root.stringHtml = Object.freeze({
    strLenHtml,
    strWarnHtml
  });
})(window);
