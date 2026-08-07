(function(global){
  const root = global.PogoUi = global.PogoUi || {};
  const searchStrings = global.PogoDomain && global.PogoDomain.searchStrings;
  if(!searchStrings)throw new Error('Search string helpers must load before string HTML helpers');
  const {strLenInfo,POGO_STR_LIMIT}=searchStrings;

  function strLenHtml(str,{t,formatNumber}={}){
    const{len,cls}=strLenInfo(str);
    const limit=POGO_STR_LIMIT;
    const display=value=>typeof formatNumber==='function'?formatNumber(value):value;
    const title=typeof t==='function'?t('share.searchLimitTitle',{limit:display(limit)}):`PoGo search limit is ~${limit} chars`;
    return `<span class="str-meta ${cls}" title="${title}">${display(len)}/${display(limit)}</span>`;
  }
  function strWarnHtml(str,{t,formatNumber}={}){
    const{len,cls}=strLenInfo(str);
    if(!cls)return'';
    if(typeof t==='function'){
      const display=value=>typeof formatNumber==='function'?formatNumber(value):value;
      const key=cls==='danger'?'share.searchLimitExceeded':'share.searchLimitApproaching';
      return `<div class="str-warn-banner${cls==='danger'?' danger':''}">⚠️ ${t(key,{limit:display(POGO_STR_LIMIT),count:display(len)})}</div>`;
    }
    if(cls==='danger')return `<div class="str-warn-banner danger">⚠️ This string exceeds PoGo's ~${POGO_STR_LIMIT} char limit (${len}). It will be truncated in-game. Consider splitting into multiple priority lists.</div>`;
    return `<div class="str-warn-banner">⚠️ Approaching PoGo's ~${POGO_STR_LIMIT} char limit (${len}). Consider splitting soon.</div>`;
  }

  root.stringHtml = Object.freeze({
    strLenHtml,
    strWarnHtml
  });
})(window);
