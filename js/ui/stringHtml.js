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

  function contextualSearchHtml(plan,{t,title,compact=false,copyLabel:scopedCopyLabel}={}){
    const {escHtml,escAttr}=global.PogoUtils.textSafety;
    const label=t('contextSearch.species');
    const omitted=plan.manual.filter(entry=>entry.unresolved);
    const exception=omitted.length||plan.parts.length>1;
    const summary=omitted.length?t('workflow.notIncluded',{count:omitted.length}):t(plan.parts.length>1?'workflow.splitSearch':'restored.searchDetails');
    const buttons=plan.parts.map((value,index)=>{
      const copyLabel=plan.parts.length===1?(scopedCopyLabel||t('restored.copySearch')):t('contextSearch.copyPart',{part:index+1,total:plan.parts.length});
      return `<button type="button" class="btn ${compact?'btn-secondary':'btn-primary'}" data-contextual-copy="${escAttr(value)}" data-copy-index="${index}" aria-label="${escAttr(copyLabel)}"><svg class="ui-icon ui-icon-sm" aria-hidden="true"><use href="#ui-icon-copy"></use></svg>${escHtml(compact&&plan.parts.length===1?t('restored.copySearch'):copyLabel)}</button>`;
    }).join('');
    // Only omissions and splitting need routine disclosure. Known requirements
    // remain ordinary wants; no per-entry checklist is built or retained.
    return`<section class="contextual-search${compact?' wants-compact-search':''}" aria-label="${escAttr(title)}"><div class="contextual-copy-actions">${buttons||`<span class="type-meta">${escHtml(t(plan.total?'workflow.searchUnavailable':'contextSearch.empty'))}</span>`}</div><details class="contextual-details wants-search-details"${compact&&!exception?' hidden':''}><summary>${escHtml(summary)}</summary><div class="contextual-search-body">${omitted.length?`<p class="contextual-unresolved">${escHtml(t('workflow.omittedHelp'))}</p><p class="contextual-omitted">${omitted.map(entry=>escHtml(entry.dn||entry.name||t('contextSearch.unknown'))).join('\n')}</p>`:''}${plan.parts.length>1?`<p>${escHtml(t('contextSearch.split',{count:plan.parts.length}))}</p>`:''}${!compact?`<p>${escHtml(t('contextSearch.warning'))}</p>`:''}${plan.parts.map(value=>`<div class="contextual-search-part"><textarea class="strbox" readonly rows="1" aria-label="${escAttr(label)}">${escHtml(value)}</textarea></div>`).join('')}</div></details><span class="contextual-copy-status" role="status" aria-live="polite"></span></section>`;
  }
  if(global.document)global.document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-contextual-copy]');if(!button)return;
    const value=button.dataset.contextualCopy,panel=button.closest('.contextual-search');
    if(!value||value.length>POGO_STR_LIMIT||!panel)return;
    const status=panel.querySelector('.contextual-copy-status'),t=global.PogoI18n.core.t;
    try{await global.navigator.clipboard.writeText(value);if(status.isConnected)status.textContent=t('share.copySuccess');}
    catch{if(status.isConnected){const details=panel.querySelector('.contextual-details');details.hidden=false;details.open=true;status.textContent=t('strings.copyFailed');const field=panel.querySelectorAll('textarea')[Number(button.dataset.copyIndex)];field?.focus();field?.select();}}
  });
  root.stringHtml = Object.freeze({
    strLenHtml,
    strWarnHtml,
    contextualSearchHtml
  });
})(window);
