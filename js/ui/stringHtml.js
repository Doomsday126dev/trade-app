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

  function contextualSearchHtml(plan,{t,title}={}){
    const {escHtml,escAttr}=global.PogoUtils.textSafety;
    const label=t('contextSearch.species');
    const flags={shiny:'share.flagShiny',lucky:'share.flagLucky',xxl:'share.flagXxl',xxs:'share.flagXxs'};
    const manual=plan.manual.map(entry=>{
      const qualifiers=[entry.mod,entry.variant,entry.gender,entry.maxType,entry.category==='wishlist'?'':entry.category||entry.type];
      for(const [flag,key]of Object.entries(flags))if(entry[flag])qualifiers.push(t(key));
      return`<li><strong>${escHtml(entry.dn||entry.name||t('contextSearch.unknown'))}</strong>${qualifiers.filter(Boolean).length?` · ${escHtml([...new Set(qualifiers.filter(Boolean))].join(' · '))}`:''}${entry.unresolved?` <span class="contextual-unresolved">${escHtml(t('contextSearch.unresolved'))}</span>`:''}</li>`;
    }).join('');
    return`<details class="contextual-search" open><summary><svg class="ui-icon ui-icon-sm" aria-hidden="true"><use href="#ui-icon-search"></use></svg><span>${escHtml(title)} <small>${escHtml(label)}</small></span></summary><div class="contextual-search-body">${!plan.total?`<p>${escHtml(t('contextSearch.empty'))}</p>`:''}${plan.unresolved?`<p role="status">${escHtml(t('contextSearch.unresolvedCount',{count:plan.unresolved}))}</p>`:''}${plan.parts.length>1?`<p>${escHtml(t('contextSearch.split',{count:plan.parts.length}))}</p>`:''}${plan.parts.map((value,index)=>`<div class="contextual-search-part"><button type="button" class="btn btn-secondary" data-contextual-copy="${escAttr(value)}" aria-label="${escAttr(t('contextSearch.copyPart',{part:index+1,total:plan.parts.length}))}"><svg class="ui-icon ui-icon-sm" aria-hidden="true"><use href="#ui-icon-copy"></use></svg>${escHtml(t('contextSearch.copyPart',{part:index+1,total:plan.parts.length}))}</button><textarea class="strbox" readonly rows="1" aria-label="${escAttr(label)}">${escHtml(value)}</textarea></div>`).join('')}<span class="contextual-copy-status" role="status" aria-live="polite"></span>${manual?`<details class="contextual-manual"><summary>${escHtml(t('contextSearch.manual',{count:plan.total}))}</summary><p>${escHtml(t('contextSearch.warning'))}</p><ul>${manual}</ul></details>`:''}</div></details>`;
  }
  if(global.document)global.document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-contextual-copy]');if(!button)return;
    const value=button.dataset.contextualCopy,panel=button.closest('.contextual-search');
    if(!value||value.length>POGO_STR_LIMIT||!panel)return;
    const status=panel.querySelector('.contextual-copy-status'),t=global.PogoI18n.core.t;
    try{await global.navigator.clipboard.writeText(value);if(status.isConnected)status.textContent=t('share.copySuccess');}
    catch{if(status.isConnected){status.textContent=t('strings.copyFailed');const field=button.parentElement.querySelector('textarea');field?.focus();field?.select();}}
  });

  root.stringHtml = Object.freeze({
    strLenHtml,
    strWarnHtml,
    contextualSearchHtml
  });
})(window);
